import { db } from "../db";
import { suguPurchases, suguMaillanePurchases, suguSupplierKnowledge } from "@shared/schema";
import { sql, eq, and } from "drizzle-orm";

function normalizeSupplierName(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 80);
}

export async function consolidateSupplierKnowledge(restaurant: "val" | "maillane" = "val"): Promise<{ updated: number; total: number }> {
    try {
        const table = restaurant === "val" ? suguPurchases : suguMaillanePurchases;
        const purchases = await db.select({
            supplier: (table as any).supplier,
            category: (table as any).category,
            amount: (table as any).amount,
        }).from(table as any);

        const grouped = new Map<string, {
            display: string;
            displayCounts: Map<string, number>;
            categories: Map<string, number>;
            amounts: number[];
        }>();

        for (const p of purchases) {
            if (!p.supplier || p.supplier.trim().length < 2) continue;
            const norm = normalizeSupplierName(p.supplier);
            if (!norm || norm.length < 2) continue;

            if (!grouped.has(norm)) {
                grouped.set(norm, {
                    display: p.supplier,
                    displayCounts: new Map(),
                    categories: new Map(),
                    amounts: [],
                });
            }
            const g = grouped.get(norm)!;
            g.displayCounts.set(p.supplier, (g.displayCounts.get(p.supplier) || 0) + 1);
            const cat = p.category || "autre";
            g.categories.set(cat, (g.categories.get(cat) || 0) + 1);
            if (p.amount && p.amount > 0) g.amounts.push(p.amount);
        }

        let updated = 0;
        for (const [norm, data] of grouped) {
            const totalInvoices = Array.from(data.categories.values()).reduce((a, b) => a + b, 0);
            if (totalInvoices < 1) continue;

            const topDisplay = Array.from(data.displayCounts.entries()).sort((a, b) => b[1] - a[1])[0][0];
            const topCat = Array.from(data.categories.entries()).sort((a, b) => b[1] - a[1])[0];
            const category = topCat[0];
            const confidence = topCat[1] / totalInvoices;
            const avgAmount = data.amounts.length > 0
                ? Math.round((data.amounts.reduce((a, b) => a + b, 0) / data.amounts.length) * 100) / 100
                : null;
            const minAmount = data.amounts.length > 0 ? Math.min(...data.amounts) : null;
            const maxAmount = data.amounts.length > 0 ? Math.max(...data.amounts) : null;
            const breakdown = Object.fromEntries(data.categories.entries());

            await db.execute(sql`
                INSERT INTO sugu_supplier_knowledge
                    (restaurant, supplier_norm, supplier_display, category, category_confidence, total_invoices, avg_amount, min_amount, max_amount, category_breakdown, last_learned)
                VALUES
                    (${restaurant}, ${norm}, ${topDisplay}, ${category}, ${confidence}, ${totalInvoices}, ${avgAmount}, ${minAmount}, ${maxAmount}, ${JSON.stringify(breakdown)}::jsonb, NOW())
                ON CONFLICT (restaurant, supplier_norm)
                DO UPDATE SET
                    supplier_display = EXCLUDED.supplier_display,
                    category = EXCLUDED.category,
                    category_confidence = EXCLUDED.category_confidence,
                    total_invoices = EXCLUDED.total_invoices,
                    avg_amount = EXCLUDED.avg_amount,
                    min_amount = EXCLUDED.min_amount,
                    max_amount = EXCLUDED.max_amount,
                    category_breakdown = EXCLUDED.category_breakdown,
                    last_learned = NOW()
            `);
            updated++;
        }

        console.log(`[SuguLearning] ${restaurant}: consolidated ${updated}/${grouped.size} suppliers from ${purchases.length} invoices`);
        return { updated, total: grouped.size };
    } catch (err: any) {
        console.error(`[SuguLearning] Consolidation error (${restaurant}):`, err?.message);
        return { updated: 0, total: 0 };
    }
}

export async function getKnowledgePromptHints(restaurant: "val" | "maillane"): Promise<string> {
    try {
        const rows = await db.execute(sql`
            SELECT supplier_display, category, category_confidence, total_invoices, avg_amount
            FROM sugu_supplier_knowledge
            WHERE restaurant = ${restaurant}
              AND total_invoices >= 2
            ORDER BY total_invoices DESC
            LIMIT 60
        `);

        if (!rows.rows || rows.rows.length === 0) return "";

        const lines = rows.rows.map((r: any) => {
            const conf = Math.round((r.category_confidence || 0) * 100);
            const avg = r.avg_amount ? `, moy. ${Math.round(r.avg_amount)}€` : "";
            return `  - ${r.supplier_display}: catégorie="${r.category}" (${conf}% sur ${r.total_invoices} factures${avg})`;
        });

        return `\nCONNAISSANCES FOURNISSEURS (base historique validée du restaurant — priorité haute):\n${lines.join("\n")}\nSi le fournisseur extrait correspond à l'un de ces noms, utilise la catégorie indiquée.\n`;
    } catch {
        return "";
    }
}

export async function overrideCategoryFromKnowledge(
    supplierName: string,
    restaurant: "val" | "maillane",
    minConfidence = 0.8,
    minInvoices = 3,
): Promise<string | null> {
    if (!supplierName || supplierName.trim().length < 2) return null;
    const norm = normalizeSupplierName(supplierName);
    try {
        const exact = await db.execute(sql`
            SELECT category, category_confidence, total_invoices
            FROM sugu_supplier_knowledge
            WHERE restaurant = ${restaurant}
              AND supplier_norm = ${norm}
              AND category_confidence >= ${minConfidence}
              AND total_invoices >= ${minInvoices}
            LIMIT 1
        `);
        if (exact.rows.length > 0) {
            return exact.rows[0].category as string;
        }

        const firstWord = norm.split(" ")[0];
        if (firstWord.length >= 4) {
            const fuzzy = await db.execute(sql`
                SELECT category, category_confidence, total_invoices
                FROM sugu_supplier_knowledge
                WHERE restaurant = ${restaurant}
                  AND (supplier_norm LIKE ${firstWord + "%"} OR ${norm} LIKE supplier_norm || "%")
                  AND category_confidence >= 0.9
                  AND total_invoices >= 5
                ORDER BY total_invoices DESC
                LIMIT 1
            `);
            if (fuzzy.rows.length > 0) {
                return fuzzy.rows[0].category as string;
            }
        }
    } catch {}
    return null;
}

export async function getKnowledgeStats(restaurant: "val" | "maillane"): Promise<{
    totalSuppliers: number;
    highConfidence: number;
    lastUpdated: string | null;
    topSuppliers: Array<{ supplier: string; category: string; confidence: number; invoices: number }>;
}> {
    try {
        const stats = await db.execute(sql`
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE category_confidence >= 0.9) as high_conf,
                MAX(last_learned) as last_updated
            FROM sugu_supplier_knowledge
            WHERE restaurant = ${restaurant}
        `);
        const top = await db.execute(sql`
            SELECT supplier_display, category, category_confidence, total_invoices
            FROM sugu_supplier_knowledge
            WHERE restaurant = ${restaurant}
            ORDER BY total_invoices DESC
            LIMIT 20
        `);
        const r = stats.rows[0] as any;
        return {
            totalSuppliers: parseInt(r.total) || 0,
            highConfidence: parseInt(r.high_conf) || 0,
            lastUpdated: r.last_updated ? new Date(r.last_updated).toLocaleDateString("fr-FR") : null,
            topSuppliers: (top.rows as any[]).map(row => ({
                supplier: row.supplier_display,
                category: row.category,
                confidence: Math.round(row.category_confidence * 100),
                invoices: row.total_invoices,
            })),
        };
    } catch {
        return { totalSuppliers: 0, highConfidence: 0, lastUpdated: null, topSuppliers: [] };
    }
}
