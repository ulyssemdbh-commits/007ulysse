import { Router, Request, Response } from "express";
import { db } from "../../../db";
import {
    suguPurchases, suguExpenses, suguFiles,
    suguCashRegister, suguPayroll, suguBankEntries,
    suguEmployees, suguLoans, suguAbsences,
    suguSuppliers, suguBackups,
} from "@shared/schema";
import { eq, desc, sql, and, gte, lte } from "drizzle-orm";
import { suguFinancialLimiter } from "../../../middleware/security";
import { hubriseService } from "../../../services/hubriseService";
import { uploadToObjectStorage, downloadFromObjectStorage, tablesReady } from "./shared";
import { getKnowledgeStats, consolidateSupplierKnowledge } from "../../../services/suguLearningService";

const router = Router();

// ======== EXPERT ACCOUNTING REPORT (AI ANALYSIS) ========

router.post("/analytics/expert-report", suguFinancialLimiter, async (req: Request, res: Response) => {
    try {
        const { year, month, type = "annual" } = req.body;
        if (!year) return res.status(400).json({ error: "year is required" });

        console.log(`[SUGU-EXPERT] Generating ${type} report for ${month ? `${year}-${month}` : year}`);

        const periodFilter = month
            ? (col: string) => sql`SUBSTRING(${sql.raw(col)}, 1, 7) = ${`${year}-${month}`}`
            : (col: string) => sql`SUBSTRING(${sql.raw(col)}, 1, 4) = ${year}`;

        const [cashEntries, purchases, expenses, payrollData, bankEntries, loans, employees] = await Promise.all([
            db.select().from(suguCashRegister).where(periodFilter("entry_date")),
            db.select().from(suguPurchases).where(periodFilter("invoice_date")),
            db.select().from(suguExpenses).where(periodFilter("period")),
            db.select().from(suguPayroll).where(periodFilter("period")),
            db.select().from(suguBankEntries).where(periodFilter("entry_date")),
            db.select().from(suguLoans),
            db.select().from(suguEmployees),
        ]);

        const totalCA = cashEntries.reduce((s, e) => s + Number(e.totalRevenue || 0), 0);
        const totalAchats = purchases.reduce((s, p) => s + Number(p.amount || 0), 0);
        const totalFrais = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
        const totalSalaires = payrollData.reduce((s, p) => s + Number(p.grossSalary || 0), 0);
        const totalChargesSalariales = payrollData.reduce((s, p) => s + Number(p.socialCharges || 0), 0);
        const totalChargesPatronales = payrollData.reduce((s, p) => {
            if (p.employerCharges && Number(p.employerCharges) > 0) return s + Number(p.employerCharges);
            return s + Math.round(Number(p.grossSalary || 0) * 0.13 * 100) / 100;
        }, 0);
        const totalMasseSalariale = totalSalaires + totalChargesPatronales;
        const totalCredits = bankEntries.filter(b => Number(b.credit || 0) > 0).reduce((s, b) => s + Number(b.credit || 0), 0);
        const totalDebits = bankEntries.filter(b => Number(b.debit || 0) > 0).reduce((s, b) => s + Number(b.debit || 0), 0);
        const bankBalance = totalCredits - totalDebits;
        const resultat = totalCA - totalAchats - totalFrais - totalMasseSalariale;
        const marge = totalCA > 0 ? ((resultat / totalCA) * 100).toFixed(1) : "0.0";
        const ratioAchats = totalCA > 0 ? ((totalAchats / totalCA) * 100).toFixed(1) : "0.0";
        const ratioFrais = totalCA > 0 ? ((totalFrais / totalCA) * 100).toFixed(1) : "0.0";
        const ratioMasseS = totalCA > 0 ? ((totalMasseSalariale / totalCA) * 100).toFixed(1) : "0.0";
        const joursOuverture = cashEntries.length;
        const caMoyenJour = joursOuverture > 0 ? (totalCA / joursOuverture).toFixed(2) : "0.00";
        const tvaColl = totalCA * 0.10;
        const tvaDed = [...purchases, ...expenses].reduce((s, i) => s + Number((i as any).taxAmount || 0), 0);
        const tvaSolde = tvaColl - tvaDed;

        const unpaidPurchases = purchases.filter(p => !p.isPaid).reduce((s, p) => s + Number(p.amount || 0), 0);
        const unpaidExpenses = expenses.filter(e => !e.isPaid).reduce((s, e) => s + Number(e.amount || 0), 0);
        const totalRemainingLoans = loans.reduce((s, l) => s + Number(l.remainingAmount || 0), 0);
        const monthlyLoanPayments = loans.reduce((s, l) => s + Number(l.monthlyPayment || 0), 0);
        const activeEmployees = employees.filter(e => e.isActive).length;

        const monthlyBreakdown: Record<string, any> = {};
        for (let m = 1; m <= 12; m++) {
            const ms = m.toString().padStart(2, "0");
            const prefix = `${year}-${ms}`;
            if (month && ms !== month) continue;
            const mCA = cashEntries.filter(e => e.entryDate.startsWith(prefix)).reduce((s, e) => s + Number(e.totalRevenue || 0), 0);
            const mAch = purchases.filter(p => p.invoiceDate?.startsWith(prefix)).reduce((s, p) => s + Number(p.amount || 0), 0);
            const mFr = expenses.filter(e => e.period?.startsWith(prefix)).reduce((s, e) => s + Number(e.amount || 0), 0);
            const mSal = payrollData.filter(p => p.period.startsWith(prefix)).reduce((s, p) => s + Number(p.grossSalary || 0) + Number(p.socialCharges || 0), 0);
            if (mCA > 0 || mAch > 0 || mFr > 0 || mSal > 0) {
                monthlyBreakdown[prefix] = { ca: mCA, achats: mAch, frais: mFr, masseSalariale: mSal, resultat: mCA - mAch - mFr - mSal };
            }
        }

        const periodLabel = month
            ? new Date(`${year}-${month}-01`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })
            : `Exercice ${year}`;

        const dataContext = `
DONNÉES FINANCIÈRES — SUGU Valentine (Restaurant, Marseille 13011)
Période: ${periodLabel}

CHIFFRE D'AFFAIRES: ${totalCA.toFixed(2)}€
- Jours d'ouverture: ${joursOuverture}
- CA moyen/jour: ${caMoyenJour}€

CHARGES:
- Achats fournisseurs: ${totalAchats.toFixed(2)}€ (${ratioAchats}% du CA)
- Frais généraux: ${totalFrais.toFixed(2)}€ (${ratioFrais}% du CA)
- Masse salariale brute: ${totalSalaires.toFixed(2)}€
- Charges salariales: ${totalChargesSalariales.toFixed(2)}€
- Charges patronales (estimées): ${totalChargesPatronales.toFixed(2)}€
- Masse salariale chargée: ${totalMasseSalariale.toFixed(2)}€ (${ratioMasseS}% du CA)

RÉSULTAT D'EXPLOITATION: ${resultat.toFixed(2)}€
MARGE OPÉRATIONNELLE: ${marge}%

TVA:
- TVA collectée (10%): ${tvaColl.toFixed(2)}€
- TVA déductible: ${tvaDed.toFixed(2)}€
- Solde TVA à reverser: ${tvaSolde.toFixed(2)}€

TRÉSORERIE BANCAIRE:
- Total crédits: ${totalCredits.toFixed(2)}€
- Total débits: ${totalDebits.toFixed(2)}€
- Solde bancaire estimé: ${bankBalance.toFixed(2)}€

ENGAGEMENTS:
- Impayés fournisseurs: ${unpaidPurchases.toFixed(2)}€
- Impayés frais généraux: ${unpaidExpenses.toFixed(2)}€
- Capital restant emprunts: ${totalRemainingLoans.toFixed(2)}€
- Mensualités emprunts: ${monthlyLoanPayments.toFixed(2)}€

EFFECTIFS: ${activeEmployees} salarié(s) actif(s)

VENTILATION MENSUELLE:
${Object.entries(monthlyBreakdown).map(([m, d]: [string, any]) => `${m}: CA=${d.ca.toFixed(0)}€ Achats=${d.achats.toFixed(0)}€ Frais=${d.frais.toFixed(0)}€ Masse Sal.=${d.masseSalariale.toFixed(0)}€ Résultat=${d.resultat.toFixed(0)}€`).join("\n")}
`;

        const OpenAI = (await import("openai")).default;
        const openai = new OpenAI({
            apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
            baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
        });

        const systemPrompt = `Tu es un expert-comptable français expérimenté, spécialisé dans la restauration à Marseille. Tu travailles pour le cabinet qui accompagne le restaurant SUGU Valentine (13011 Marseille).

Ton rôle est de produire une VRAIE analyse comptable professionnelle, comme un expert-comptable le ferait dans un cabinet à Marseille. Tu dois :
1. Analyser les données financières fournies avec rigueur
2. Identifier les points forts, les faiblesses et les risques
3. Comparer aux ratios sectoriels de la restauration traditionnelle en France
4. Formuler des recommandations concrètes et actionnables
5. Signaler toute anomalie ou incohérence dans les données

Ratios sectoriels de référence (restauration traditionnelle France) :
- Coût matière (achats/CA) : 25-35%
- Masse salariale chargée/CA : 30-45%
- Frais généraux/CA : 15-25%
- Marge opérationnelle : 5-15%
- Prime cost (matière + main d'œuvre) : 55-70%

Rédige en français professionnel. Utilise le format Markdown avec des titres, sous-titres, tableaux et listes. Sois précis dans les chiffres. Ne mentionne jamais que tu es une IA — tu es un expert-comptable.`;

        const userPrompt = `Produis ${type === "monthly" ? "une synthèse comptable mensuelle" : "un bilan comptable annuel"} professionnel pour la période suivante.

${dataContext}

Structure attendue :
${type === "monthly" ? `
## Synthèse Comptable — [Mois Année]
### 1. Activité du mois
### 2. Analyse des charges
### 3. Résultat et marge
### 4. TVA du mois
### 5. Points d'attention
### 6. Recommandations
` : `
## Bilan Comptable Annuel — Exercice [Année]
### 1. Synthèse de l'exercice
### 2. Évolution du chiffre d'affaires (analyse mensuelle)
### 3. Structure des coûts et ratios clés
### 4. Compte de résultat simplifié
### 5. Analyse de la trésorerie et engagements
### 6. Obligations fiscales (TVA)
### 7. Analyse des effectifs et masse salariale
### 8. Points de vigilance et risques identifiés
### 9. Recommandations stratégiques
### 10. Conclusion et perspectives
`}

Important : si les données sont insuffisantes ou incohérentes, signale-le clairement plutôt que d'inventer des chiffres.`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            temperature: 0.3,
            max_tokens: 4000,
        });

        const analysis = completion.choices[0]?.message?.content || "Analyse non disponible";

        console.log(`[SUGU-EXPERT] Report generated: ${analysis.length} chars`);

        res.json({
            success: true,
            period: periodLabel,
            type,
            analysis,
            data: {
                ca: totalCA, achats: totalAchats, frais: totalFrais,
                masseSalariale: totalMasseSalariale, resultat, marge,
                tvaColl, tvaDed, tvaSolde,
                bankBalance, unpaidPurchases, unpaidExpenses,
                totalRemainingLoans, activeEmployees, joursOuverture,
                monthlyBreakdown
            }
        });
    } catch (error: any) {
        console.error("[SUGU-EXPERT] Report generation error:", error);
        res.status(500).json({ error: "Erreur lors de la génération du rapport", detail: error?.message });
    }
});

router.post("/analytics/expert-report/download", suguFinancialLimiter, async (req: Request, res: Response) => {
    try {
        const { analysis, period, type } = req.body;
        if (!analysis) return res.status(400).json({ error: "analysis content required" });

        const title = type === "monthly"
            ? `Synthèse Comptable — ${period}`
            : `Bilan Comptable Annuel — ${period}`;

        const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
@page { margin: 2cm; size: A4; }
body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 40px; line-height: 1.7; color: #1a1a2e; font-size: 13px; }
.header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: white; padding: 30px; border-radius: 12px; margin-bottom: 30px; }
.header h1 { margin: 0 0 5px 0; font-size: 22px; }
.header .subtitle { opacity: 0.8; font-size: 13px; }
.header .logo { font-size: 28px; font-weight: bold; color: #f97316; }
h2 { color: #1a1a2e; border-bottom: 2px solid #f97316; padding-bottom: 8px; margin-top: 30px; font-size: 16px; }
h3 { color: #16213e; margin-top: 20px; font-size: 14px; }
table { border-collapse: collapse; width: 100%; margin: 15px 0; font-size: 12px; }
th { background: #1a1a2e; color: white; padding: 10px 12px; text-align: left; font-weight: 600; }
td { border: 1px solid #e2e8f0; padding: 8px 12px; }
tr:nth-child(even) { background: #f8fafc; }
strong { color: #1a1a2e; }
ul, ol { padding-left: 20px; }
li { margin-bottom: 4px; }
.footer { margin-top: 40px; padding-top: 15px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }
@media print { body { padding: 20px; } .header { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<div class="header">
<div class="logo">S SUGU Valentine</div>
<h1>${title}</h1>
<div class="subtitle">Restaurant — 13011 Marseille | Généré le ${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</div>
</div>
${markdownToHtmlBasic(analysis)}
<div class="footer">
Document généré par Ulysse — Système de gestion SUGU Valentine<br>
Ce document est une analyse automatisée. Il ne remplace pas l'avis d'un expert-comptable diplômé.
</div>
</body>
</html>`;

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(title.replace(/[^a-zA-ZÀ-ÿ0-9 _-]/g, ""))}.html"`);
        res.send(html);
    } catch (error: any) {
        console.error("[SUGU-EXPERT] Download error:", error);
        res.status(500).json({ error: "Erreur téléchargement" });
    }
});

router.post("/analytics/expert-report/email", suguFinancialLimiter, async (req: Request, res: Response) => {
    try {
        const { analysis, period, type, email } = req.body;
        if (!analysis || !email) return res.status(400).json({ error: "analysis and email required" });

        const title = type === "monthly"
            ? `Synthèse Comptable — ${period}`
            : `Bilan Comptable Annuel — ${period}`;

        const htmlContent = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><style>
body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:800px;margin:0 auto;padding:20px}
h1{color:#1a1a2e;border-bottom:2px solid #f97316;padding-bottom:8px}
h2{color:#16213e;margin-top:25px}h3{color:#334155}
table{border-collapse:collapse;width:100%;margin:10px 0}
th{background:#1a1a2e;color:#fff;padding:8px 10px;text-align:left}
td{border:1px solid #e2e8f0;padding:6px 10px}
tr:nth-child(even){background:#f8fafc}
</style></head><body>
<h1>🔶 ${title}</h1>
<p style="color:#64748b;font-size:13px">SUGU Valentine — 13011 Marseille | ${new Date().toLocaleDateString("fr-FR")}</p>
${markdownToHtmlBasic(analysis)}
<hr style="margin-top:30px;border:none;border-top:1px solid #e2e8f0">
<p style="font-size:11px;color:#94a3b8;text-align:center">Document généré par Ulysse — Système de gestion SUGU Valentine</p>
</body></html>`;

        const { googleMailService } = await import("../../../services/googleMailService");
        await googleMailService.sendWithAttachment({
            to: email,
            subject: `${title} — SUGU Valentine`,
            body: `Veuillez trouver ci-joint le rapport : ${title}.\n\nCordialement,\nUlysse — Gestion SUGU Valentine`,
            attachments: [{
                filename: `${title.replace(/[^a-zA-ZÀ-ÿ0-9 _-]/g, "")}.html`,
                content: Buffer.from(htmlContent, "utf-8"),
                contentType: "text/html"
            }]
        });

        console.log(`[SUGU-EXPERT] Report emailed to ${email}`);
        res.json({ success: true, message: `Rapport envoyé à ${email}` });
    } catch (error: any) {
        console.error("[SUGU-EXPERT] Email error:", error);
        res.status(500).json({ error: "Erreur envoi email", detail: error?.message });
    }
});

function markdownToHtmlBasic(md: string): string {
    return md
        .replace(/^### (.*$)/gm, '<h3>$1</h3>')
        .replace(/^## (.*$)/gm, '<h2>$1</h2>')
        .replace(/^# (.*$)/gm, '<h1>$1</h1>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/^\- (.*$)/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
        .replace(/\|(.+)\|/g, (match) => {
            const cells = match.split('|').filter(c => c.trim());
            if (cells.every(c => c.trim().match(/^[-:]+$/))) return '';
            const tag = cells.every(c => c.trim().match(/^[-:]+$/)) ? 'td' : 'td';
            return '<tr>' + cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
        })
        .replace(/(<tr>.*<\/tr>\n?)+/g, '<table>$&</table>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/^(?!<[hultop])/gm, (line) => line ? `<p>${line}` : '')
        .replace(/<p><\/p>/g, '');
}

// ======== SUPPLIER KNOWLEDGE (AUTONOMOUS LEARNING) ROUTES ========

router.get("/knowledge/stats", async (req: Request, res: Response) => {
    try {
        const restaurant = (req.query.restaurant as string) === "maillane" ? "maillane" : "val";
        const stats = await getKnowledgeStats(restaurant);
        res.json({ success: true, restaurant, ...stats });
    } catch (err: any) {
        res.status(500).json({ error: "Erreur knowledge stats", detail: err?.message });
    }
});

router.post("/knowledge/consolidate", async (req: Request, res: Response) => {
    try {
        const restaurant = req.body?.restaurant === "maillane" ? "maillane" : "val";
        const result = await consolidateSupplierKnowledge(restaurant);
        res.json({ success: true, restaurant, ...result, message: `${result.updated} fournisseurs appris sur ${result.total} distincts` });
    } catch (err: any) {
        res.status(500).json({ error: "Erreur consolidation", detail: err?.message });
    }
});

// ======== BACKUP ROUTES ========

// GET /backups - List all backups (metadata only, no data)
router.get("/backups", async (_req: Request, res: Response) => {
    try {
        const backups = await db.select({
            id: suguBackups.id,
            label: suguBackups.label,
            createdAt: suguBackups.createdAt,
            tableCounts: suguBackups.tableCounts,
            sizeBytes: suguBackups.sizeBytes,
        }).from(suguBackups).orderBy(desc(suguBackups.createdAt));
        res.json(backups);
    } catch (error: any) {
        console.error("[SUGU] Error fetching backups:", error?.message);
        res.status(500).json({ error: "Erreur lors de la récupération des sauvegardes" });
    }
});

// POST /backup - Create a new full backup
router.post("/backup", async (req: Request, res: Response) => {
    try {
        const label = (req.body?.label as string)?.trim() || `Sauvegarde du ${new Date().toLocaleDateString("fr-FR")} à ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;

        const [suppliers, purchases, expenses, bankEntries, loans, cashEntries, employees, payroll, absences, files, hubriseResult] = await Promise.all([
            db.select().from(suguSuppliers),
            db.select().from(suguPurchases),
            db.select().from(suguExpenses),
            db.select().from(suguBankEntries),
            db.select().from(suguLoans),
            db.select().from(suguCashRegister),
            db.select().from(suguEmployees),
            db.select().from(suguPayroll),
            db.select().from(suguAbsences),
            db.select().from(suguFiles),
            db.execute(sql`SELECT id, status, created_at, total, service_type, channel, data, synced_at FROM hubrise_orders ORDER BY created_at DESC`).catch(() => ({ rows: [] })),
        ]);
        const hubriseOrders = (hubriseResult as any).rows || [];

        const tableCounts = {
            suppliers: suppliers.length,
            purchases: purchases.length,
            expenses: expenses.length,
            bankEntries: bankEntries.length,
            loans: loans.length,
            cashEntries: cashEntries.length,
            employees: employees.length,
            payroll: payroll.length,
            absences: absences.length,
            files: files.length,
            hubriseOrders: hubriseOrders.length,
        };

        const dataJson = JSON.stringify({
            version: "1.1",
            createdAt: new Date().toISOString(),
            restaurant: "SUGU Valentine",
            suppliers, purchases, expenses, bankEntries, loans, cashEntries, employees, payroll, absences, files, hubriseOrders,
        });

        const sizeBytes = Buffer.byteLength(dataJson, "utf8");

        const [backup] = await db.insert(suguBackups).values({
            label,
            dataJson,
            tableCounts: JSON.stringify(tableCounts),
            sizeBytes,
        }).returning({ id: suguBackups.id, label: suguBackups.label, createdAt: suguBackups.createdAt, tableCounts: suguBackups.tableCounts, sizeBytes: suguBackups.sizeBytes });

        console.log(`[SUGU] Backup created: "${label}" — ${sizeBytes} bytes, ${Object.values(tableCounts).reduce((a, b) => a + b, 0)} records`);
        res.json(backup);
    } catch (error: any) {
        console.error("[SUGU] Error creating backup:", error?.message);
        res.status(500).json({ error: "Erreur lors de la création de la sauvegarde" });
    }
});

// Helper: timestamp fields stored as ISO strings in JSON must be Date objects for Drizzle
function fixDates(records: any[]): any[] {
    return records.map((r) => {
        const fixed: any = { ...r };
        // Convert any ISO string timestamps back to Date objects
        if (fixed.createdAt && typeof fixed.createdAt === 'string') {
            fixed.createdAt = new Date(fixed.createdAt);
        }
        if (fixed.updatedAt && typeof fixed.updatedAt === 'string') {
            fixed.updatedAt = new Date(fixed.updatedAt);
        }
        return fixed;
    });
}

// POST /backups/:id/restore - Restore from a backup (replaces all data — 100% identical snapshot)
router.post("/backups/:id/restore", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID invalide" });
    try {
        const [backup] = await db.select().from(suguBackups).where(eq(suguBackups.id, id)).limit(1);
        if (!backup) return res.status(404).json({ error: "Sauvegarde introuvable" });

        const data = JSON.parse(backup.dataJson);

        await db.transaction(async (tx) => {
            await tx.delete(suguPayroll);
            await tx.delete(suguAbsences);
            await tx.delete(suguPurchases);
            await tx.delete(suguExpenses);
            await tx.delete(suguBankEntries);
            await tx.delete(suguLoans);
            await tx.delete(suguCashRegister);
            await tx.delete(suguFiles);
            await tx.delete(suguEmployees);
            await tx.delete(suguSuppliers);

            if (data.suppliers?.length) await tx.insert(suguSuppliers).values(fixDates(data.suppliers));
            if (data.employees?.length) await tx.insert(suguEmployees).values(fixDates(data.employees));
            if (data.purchases?.length) await tx.insert(suguPurchases).values(fixDates(data.purchases));
            if (data.expenses?.length) await tx.insert(suguExpenses).values(fixDates(data.expenses));
            if (data.bankEntries?.length) await tx.insert(suguBankEntries).values(fixDates(data.bankEntries));
            if (data.loans?.length) await tx.insert(suguLoans).values(fixDates(data.loans));
            if (data.cashEntries?.length) await tx.insert(suguCashRegister).values(fixDates(data.cashEntries));
            if (data.payroll?.length) await tx.insert(suguPayroll).values(fixDates(data.payroll));
            if (data.absences?.length) await tx.insert(suguAbsences).values(fixDates(data.absences));
            if (data.files?.length) await tx.insert(suguFiles).values(fixDates(data.files));
        });

        if (data.hubriseOrders?.length) {
            await db.execute(sql`DELETE FROM hubrise_orders`);
            for (const order of data.hubriseOrders) {
                await db.execute(sql`INSERT INTO hubrise_orders (id, status, created_at, total, service_type, channel, data, synced_at) VALUES (${order.id}, ${order.status}, ${order.created_at}, ${order.total}, ${order.service_type}, ${order.channel}, ${JSON.stringify(order.data)}::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data`);
            }
        }

        const seqResets: [string, string][] = [
            ["sugu_suppliers", "sugu_suppliers_id_seq"],
            ["sugu_purchases", "sugu_purchases_id_seq"],
            ["sugu_general_expenses", "sugu_general_expenses_id_seq"],
            ["sugu_bank_entries", "sugu_bank_entries_id_seq"],
            ["sugu_loans", "sugu_loans_id_seq"],
            ["sugu_cash_entries", "sugu_cash_entries_id_seq"],
            ["sugu_employees", "sugu_employees_id_seq"],
            ["sugu_payroll", "sugu_payroll_id_seq"],
            ["sugu_absences", "sugu_absences_id_seq"],
            ["sugu_files", "sugu_files_id_seq"],
        ];
        for (const [table, seq] of seqResets) {
            await db.execute(sql.raw(`SELECT setval('${seq}', COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`));
        }

        console.log(`[SUGU] Backup ${id} restored: "${backup.label}" — all data + sequences reset`);
        res.json({ success: true, label: backup.label });
    } catch (error: any) {
        console.error("[SUGU] Error restoring backup:", error?.message);
        res.status(500).json({ error: "Erreur lors de la restauration" });
    }
});

// GET /backups/:id/download - Download backup JSON
router.get("/backups/:id/download", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID invalide" });
    try {
        const [backup] = await db.select().from(suguBackups).where(eq(suguBackups.id, id)).limit(1);
        if (!backup) return res.status(404).json({ error: "Sauvegarde introuvable" });

        const filename = `sugu_valentine_backup_${backup.id}_${backup.createdAt?.toISOString().slice(0, 10)}.json`;
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Type", "application/json");
        res.send(backup.dataJson);
    } catch (error: any) {
        console.error("[SUGU] Error downloading backup:", error?.message);
        res.status(500).json({ error: "Erreur lors du téléchargement" });
    }
});

// GET /backups/:id/download-zip - Download backup as ZIP with actual files
router.get("/backups/:id/download-zip", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID invalide" });
    try {
        const [backup] = await db.select().from(suguBackups).where(eq(suguBackups.id, id)).limit(1);
        if (!backup) return res.status(404).json({ error: "Sauvegarde introuvable" });

        const data = JSON.parse(backup.dataJson);
        const dateStr = backup.createdAt?.toISOString().slice(0, 10) || "unknown";
        const zipName = `sugu_valentine_backup_${backup.id}_${dateStr}.zip`;

        res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);
        res.setHeader("Content-Type", "application/zip");

        const archive = archiver("zip", { zlib: { level: 6 } });
        archive.on("error", (err: any) => { throw err; });
        archive.pipe(res);

        archive.append(backup.dataJson, { name: "donnees.json" });

        const fileRecords = (data.files || []).filter((f: any) => f.storagePath);
        let filesIncluded = 0;
        const BATCH = 5;
        for (let i = 0; i < fileRecords.length; i += BATCH) {
            const batch = fileRecords.slice(i, i + BATCH);
            const results = await Promise.allSettled(batch.map(async (f: any) => {
                const { buffer } = await downloadFromObjectStorage(f.storagePath);
                return { f, buffer };
            }));
            for (const r of results) {
                if (r.status === "fulfilled") {
                    const { f, buffer } = r.value;
                    const safeCategory = (f.category || "autre").replace(/[^a-zA-Z0-9_-]/g, "_");
                    const safeName = (f.originalName || f.fileName || `file_${f.id}`).replace(/[/\\]/g, "_");
                    archive.append(buffer, { name: `fichiers/${safeCategory}/${safeName}` });
                    filesIncluded++;
                } else {
                    console.warn(`[SUGU] ZIP: skipping file: ${r.reason?.message}`);
                }
            }
        }

        const summary = [
            `SAUVEGARDE SUGU VALENTINE`,
            `Date: ${backup.createdAt?.toISOString() || dateStr}`,
            `Label: ${backup.label}`,
            ``,
            `CONTENU:`,
            `- donnees.json : toutes les donnees (fournisseurs, achats, depenses, banque, prets, caisse, employes, paie, absences, fichiers metadata, commandes HubRise)`,
            `- fichiers/ : ${filesIncluded} fichier(s) classes par categorie`,
            ``,
            `TABLES:`,
            ...(data.suppliers?.length ? [`  Fournisseurs: ${data.suppliers.length}`] : []),
            ...(data.purchases?.length ? [`  Achats: ${data.purchases.length}`] : []),
            ...(data.expenses?.length ? [`  Depenses: ${data.expenses.length}`] : []),
            ...(data.bankEntries?.length ? [`  Banque: ${data.bankEntries.length}`] : []),
            ...(data.loans?.length ? [`  Prets: ${data.loans.length}`] : []),
            ...(data.cashEntries?.length ? [`  Caisse: ${data.cashEntries.length}`] : []),
            ...(data.employees?.length ? [`  Employes: ${data.employees.length}`] : []),
            ...(data.payroll?.length ? [`  Paie: ${data.payroll.length}`] : []),
            ...(data.absences?.length ? [`  Absences: ${data.absences.length}`] : []),
            ...(data.files?.length ? [`  Fichiers: ${data.files.length}`] : []),
            ...(data.hubriseOrders?.length ? [`  Commandes HubRise: ${data.hubriseOrders.length}`] : []),
        ].join("\n");
        archive.append(summary, { name: "LISEZ-MOI.txt" });

        console.log(`[SUGU] ZIP backup ${id}: ${filesIncluded} files included`);
        await archive.finalize();
    } catch (error: any) {
        console.error("[SUGU] Error creating ZIP backup:", error?.message);
        if (!res.headersSent) res.status(500).json({ error: "Erreur lors de la creation du ZIP" });
    }
});

// DELETE /backups/:id - Delete a backup
router.delete("/backups/:id", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID invalide" });
    try {
        await db.delete(suguBackups).where(eq(suguBackups.id, id));
        res.json({ success: true });
    } catch (error: any) {
        console.error("[SUGU] Error deleting backup:", error?.message);
        res.status(500).json({ error: "Erreur lors de la suppression" });
    }
});

// ============================================================
// HUBRISE INTEGRATION (auth-protected routes)
// ============================================================

router.get("/hubrise/status", async (_req: Request, res: Response) => {
    try {
        await hubriseService.ensureTable();
        res.json(hubriseService.getStatus());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get("/hubrise/authorize", async (req: Request, res: Response) => {
    const host = req.headers.host || req.hostname;
    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const redirectUri = `${proto}://${host}/api/v2/sugu-management/hubrise/callback`;
    const url = hubriseService.getAuthorizeUrl(redirectUri);
    res.json({ url });
});

router.post("/hubrise/disconnect", async (_req: Request, res: Response) => {
    try {
        await hubriseService.disconnect();
        res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get("/hubrise/account", async (_req: Request, res: Response) => {
    try {
        const data = await hubriseService.getAccount();
        res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get("/hubrise/location", async (_req: Request, res: Response) => {
    try {
        const data = await hubriseService.getLocation();
        res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get("/hubrise/orders", async (req: Request, res: Response) => {
    try {
        const { after, before, status, count } = req.query;
        const data = await hubriseService.getOrders({
            after: after as string,
            before: before as string,
            status: status as string,
            count: count ? parseInt(count as string) : 100,
        });
        res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get("/hubrise/orders/summary", async (req: Request, res: Response) => {
    try {
        const { from, to } = req.query;
        const data = await hubriseService.getOrdersSummary(from as string, to as string);
        res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post("/hubrise/sync", async (_req: Request, res: Response) => {
    try {
        await hubriseService.forceSync();
        res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get("/hubrise/catalog", async (_req: Request, res: Response) => {
    try {
        const data = await hubriseService.getCatalog();
        res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
});


export default router;
