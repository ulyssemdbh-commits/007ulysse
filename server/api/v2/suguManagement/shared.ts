import { db } from "../../../db";
import { sql, eq, and, isNull } from "drizzle-orm";
import { suguFiles, suguEmployees, suguExpenses, suguPurchases, suguBankEntries } from "@shared/schema";
import { objectStorageClient } from "../../../replit_integrations/object_storage/objectStorage";

export let _archiver: any = null;
export async function getArchiver() {
  if (!_archiver) { try { _archiver = (await import("archiver")).default; } catch { console.warn("[SuguMgmt] archiver not available"); } }
  return _archiver;
}

export const importStatusMap = new Map<string, { status: string; step?: string; result?: any; error?: string; updatedAt: number }>();

setInterval(() => {
    const now = Date.now();
    for (const [key, val] of importStatusMap) {
        if (now - val.updatedAt > 300000) importStatusMap.delete(key);
    }
}, 60000);

export function normalizeExpenseCategory(cat: string | null | undefined): string {
    if (!cat) return "autre";
    const lower = cat.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (["electricite", "energie", "energy"].includes(lower)) return "energie";
    if (["telecom", "telecommunication", "telecommunications", "telecomunications"].includes(lower)) return "telecom";
    if (lower === "eau" || lower === "water") return "eau";
    if (lower === "loyer" || lower === "rent") return "loyer";
    if (lower === "assurance" || lower === "insurance") return "assurance";
    return cat.toLowerCase();
}

export const SUGU_BUCKET_PREFIX = "sugu-valentine-files";
export const IS_REPLIT = !!(process.env.REPL_ID || process.env.REPLIT_CONNECTORS_HOSTNAME);
export const LOCAL_STORAGE_ROOT = process.env.LOCAL_STORAGE_PATH || "/opt/ulysse/storage";

export async function uploadToObjectStorage(buffer: Buffer, fileName: string, mimeType: string): Promise<string> {
    if (!IS_REPLIT) {
        const fs = await import("fs");
        const path = await import("path");
        const dir = path.join(LOCAL_STORAGE_ROOT, SUGU_BUCKET_PREFIX);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, fileName);
        fs.writeFileSync(filePath, buffer);
        return `${SUGU_BUCKET_PREFIX}/${fileName}`;
    }
    const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!privateDir) throw new Error("PRIVATE_OBJECT_DIR not set");
    const fullPath = `${privateDir}/${SUGU_BUCKET_PREFIX}/${fileName}`;
    const parts = fullPath.startsWith("/") ? fullPath.slice(1).split("/") : fullPath.split("/");
    const bucketName = parts[0];
    const objectName = parts.slice(1).join("/");
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    await file.save(buffer, { contentType: mimeType });
    return fullPath;
}

export async function downloadFromObjectStorage(storagePath: string): Promise<{ buffer: Buffer; }> {
    if (!IS_REPLIT) {
        const fs = await import("fs");
        const path = await import("path");
        const filePath = path.join(LOCAL_STORAGE_ROOT, storagePath);
        if (!fs.existsSync(filePath)) throw new Error("File not found: " + filePath);
        return { buffer: fs.readFileSync(filePath) };
    }
    const parts = storagePath.startsWith("/") ? storagePath.slice(1).split("/") : storagePath.split("/");
    const bucketName = parts[0];
    const objectName = parts.slice(1).join("/");
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    const [exists] = await file.exists();
    if (!exists) throw new Error("File not found in object storage");
    const [contents] = await file.download();
    return { buffer: contents };
}

export async function deleteFromObjectStorage(storagePath: string): Promise<void> {
    if (!IS_REPLIT) {
        const fs = await import("fs");
        const path = await import("path");
        const filePath = path.join(LOCAL_STORAGE_ROOT, storagePath);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`[SUGU] Deleted local file: ${filePath}`);
        }
        return;
    }
    const parts = storagePath.startsWith("/") ? storagePath.slice(1).split("/") : storagePath.split("/");
    const bucketName = parts[0];
    const objectName = parts.slice(1).join("/");
    if (!bucketName || !objectName) throw new Error(`Invalid storagePath: ${storagePath}`);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    const [exists] = await file.exists();
    if (exists) {
        await file.delete();
        console.log(`[SUGU] Permanently deleted from storage: ${objectName}`);
    } else {
        console.warn(`[SUGU] File not found in storage (already gone?): ${objectName}`);
    }
}

async function waitForDb(maxWaitMs = 300000) {
    const start = Date.now();
    let attempt = 0;
    while (Date.now() - start < maxWaitMs) {
        attempt++;
        try {
            await db.execute(sql`SELECT 1`);
            console.log(`[SUGU] DB ready after ${attempt} ping(s) (${((Date.now() - start) / 1000).toFixed(1)}s)`);
            return true;
        } catch {
            // Wait with exponential backoff: 5s, 10s, 15s, 20s, 20s...
            const wait = Math.min(attempt * 5000, 20000);
            await new Promise(r => setTimeout(r, wait));
        }
    }
    console.error(`[SUGU] ❌ DB not responsive after ${maxWaitMs / 1000}s`);
    return false;
}

async function ensureSuguTables() {
    const isNeon = (process.env.DATABASE_URL || '').includes('neon.tech');
    if (isNeon) {
        console.log("[SUGU] Neon detected — waiting 45s for DB warmup before table creation...");
        await new Promise(r => setTimeout(r, 45000));
    } else {
        console.log("[SUGU] Local/non-Neon DB — skipping warmup delay, creating tables now...");
    }
    const dbReady = await waitForDb();
    if (!dbReady) return;

    const tables: Array<{ name: string; ddl: ReturnType<typeof sql> }> = [
        {
            name: "sugu_purchases", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugu_purchases (
                id SERIAL PRIMARY KEY, supplier TEXT NOT NULL, description TEXT,
                category TEXT NOT NULL DEFAULT 'alimentaire', amount REAL NOT NULL,
                tax_amount REAL DEFAULT 0, invoice_number TEXT, invoice_date TEXT,
                due_date TEXT, is_paid BOOLEAN NOT NULL DEFAULT FALSE, paid_date TEXT,
                payment_method TEXT, notes TEXT, created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugu_general_expenses", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugu_general_expenses (
                id SERIAL PRIMARY KEY, label TEXT DEFAULT 'Non spécifié',
                category TEXT NOT NULL DEFAULT 'energie', description TEXT NOT NULL DEFAULT '',
                amount REAL NOT NULL, tax_amount REAL DEFAULT 0, period TEXT,
                frequency TEXT DEFAULT 'mensuel', due_date TEXT,
                is_paid BOOLEAN NOT NULL DEFAULT FALSE, paid_date TEXT,
                payment_method TEXT, is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
                notes TEXT, created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugu_files", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugu_files (
                id SERIAL PRIMARY KEY, file_name TEXT NOT NULL, original_name TEXT NOT NULL,
                mime_type TEXT NOT NULL, file_size INTEGER NOT NULL, category TEXT NOT NULL,
                file_type TEXT NOT NULL DEFAULT 'file', supplier TEXT, description TEXT,
                file_date TEXT, storage_path TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugu_bank_entries", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugu_bank_entries (
                id SERIAL PRIMARY KEY, bank_name TEXT NOT NULL DEFAULT 'Banque Principale',
                entry_date TEXT NOT NULL, label TEXT NOT NULL, amount REAL NOT NULL,
                balance REAL, category TEXT, is_reconciled BOOLEAN NOT NULL DEFAULT FALSE,
                notes TEXT, created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugu_loans", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugu_loans (
                id SERIAL PRIMARY KEY, bank_name TEXT NOT NULL, loan_label TEXT NOT NULL,
                total_amount REAL NOT NULL, remaining_amount REAL NOT NULL,
                monthly_payment REAL NOT NULL, interest_rate REAL,
                start_date TEXT NOT NULL, end_date TEXT, notes TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugu_cash_entries", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugu_cash_entries (
                id SERIAL PRIMARY KEY, entry_date TEXT NOT NULL, total_revenue REAL NOT NULL,
                cash_amount REAL DEFAULT 0, cb_amount REAL DEFAULT 0,
                cbzen_amount REAL DEFAULT 0, tr_amount REAL DEFAULT 0, ctr_amount REAL DEFAULT 0,
                ubereats_amount REAL DEFAULT 0, deliveroo_amount REAL DEFAULT 0,
                cheque_amount REAL DEFAULT 0, virement_amount REAL DEFAULT 0,
                ticket_resto_amount REAL DEFAULT 0, online_amount REAL DEFAULT 0,
                covers_count INTEGER DEFAULT 0, average_ticket REAL DEFAULT 0,
                notes TEXT, created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugu_employees", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugu_employees (
                id SERIAL PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
                role TEXT NOT NULL, contract_type TEXT NOT NULL DEFAULT 'CDI',
                monthly_salary REAL, hourly_rate REAL, weekly_hours REAL DEFAULT 35,
                start_date TEXT NOT NULL, end_date TEXT,
                is_active BOOLEAN NOT NULL DEFAULT TRUE, phone TEXT, email TEXT,
                notes TEXT, created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugu_payroll", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugu_payroll (
                id SERIAL PRIMARY KEY, employee_id INTEGER NOT NULL, period TEXT NOT NULL,
                gross_salary REAL NOT NULL, net_salary REAL NOT NULL,
                social_charges REAL DEFAULT 0, bonus REAL DEFAULT 0, overtime REAL DEFAULT 0,
                is_paid BOOLEAN NOT NULL DEFAULT FALSE, paid_date TEXT,
                notes TEXT, created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugu_absences", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugu_absences (
                id SERIAL PRIMARY KEY, employee_id INTEGER NOT NULL, type TEXT NOT NULL,
                start_date TEXT NOT NULL, end_date TEXT, duration REAL,
                is_approved BOOLEAN NOT NULL DEFAULT FALSE, reason TEXT, notes TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )` },
        {
            name: "sugu_trash", ddl: sql`
            CREATE TABLE IF NOT EXISTS sugu_trash (
                id SERIAL PRIMARY KEY, original_file_id INTEGER,
                file_name TEXT NOT NULL, original_name TEXT NOT NULL,
                mime_type TEXT NOT NULL, file_size INTEGER NOT NULL,
                category TEXT NOT NULL, file_type TEXT NOT NULL DEFAULT 'file',
                supplier TEXT, description TEXT, file_date TEXT,
                storage_path TEXT NOT NULL, emailed_to TEXT[],
                deleted_at TIMESTAMP DEFAULT NOW(),
                expires_at TIMESTAMP NOT NULL
            )` },
    ];

    let ok = 0;
    for (const t of tables) {
        try {
            await db.execute(t.ddl);
            ok++;
            console.log(`[SUGU] ✅ ${t.name} ensured`);
        } catch (err: any) {
            console.error(`[SUGU] ⚠️ Failed to create ${t.name}:`, err?.message);
        }
    }
    console.log(`[SUGU] Tables: ${ok}/${tables.length} ensured`);

    // Ensure all columns exist (ALTER TABLE ADD COLUMN IF NOT EXISTS)
    // This handles tables created by older schema versions missing newer columns
    const alterStatements = [
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS label TEXT DEFAULT 'Non spécifié'`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'energie'`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS amount REAL NOT NULL DEFAULT 0`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS tax_amount REAL DEFAULT 0`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS period TEXT`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS frequency TEXT DEFAULT 'mensuel'`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS due_date TEXT`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS is_paid BOOLEAN NOT NULL DEFAULT FALSE`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS paid_date TEXT`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS payment_method TEXT`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT FALSE`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS notes TEXT`,
        sql`ALTER TABLE sugu_general_expenses ADD COLUMN IF NOT EXISTS invoice_number TEXT`,
        sql`ALTER TABLE sugu_purchases ADD COLUMN IF NOT EXISTS supplier TEXT NOT NULL DEFAULT ''`,
        sql`ALTER TABLE sugu_purchases ADD COLUMN IF NOT EXISTS description TEXT`,
        sql`ALTER TABLE sugu_purchases ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'alimentaire'`,
        sql`ALTER TABLE sugu_purchases ADD COLUMN IF NOT EXISTS amount REAL NOT NULL DEFAULT 0`,
        sql`ALTER TABLE sugu_purchases ADD COLUMN IF NOT EXISTS invoice_number TEXT`,
        sql`ALTER TABLE sugu_purchases ADD COLUMN IF NOT EXISTS invoice_date TEXT`,
        sql`ALTER TABLE sugu_purchases ADD COLUMN IF NOT EXISTS due_date TEXT`,
        sql`ALTER TABLE sugu_purchases ADD COLUMN IF NOT EXISTS is_paid BOOLEAN NOT NULL DEFAULT FALSE`,
        sql`ALTER TABLE sugu_purchases ADD COLUMN IF NOT EXISTS paid_date TEXT`,
        sql`ALTER TABLE sugu_purchases ADD COLUMN IF NOT EXISTS payment_method TEXT`,
        sql`ALTER TABLE sugu_purchases ADD COLUMN IF NOT EXISTS notes TEXT`,
        sql`ALTER TABLE sugu_loans ADD COLUMN IF NOT EXISTS original_file_id INTEGER`,
        sql`ALTER TABLE sugu_loans ADD COLUMN IF NOT EXISTS loan_type TEXT NOT NULL DEFAULT 'emprunt'`,
        sql`ALTER TABLE sugu_files ADD COLUMN IF NOT EXISTS employee_id INTEGER`,
    ];
    for (const stmt of alterStatements) {
        try { await db.execute(stmt); } catch { /* column already exists or table missing — ignore */ }
    }
    const cashColumnAlters = [
        sql`ALTER TABLE sugu_cash_entries ADD COLUMN IF NOT EXISTS cbzen_amount REAL DEFAULT 0`,
        sql`ALTER TABLE sugu_cash_entries ADD COLUMN IF NOT EXISTS tr_amount REAL DEFAULT 0`,
        sql`ALTER TABLE sugu_cash_entries ADD COLUMN IF NOT EXISTS ctr_amount REAL DEFAULT 0`,
        sql`ALTER TABLE sugu_cash_entries ADD COLUMN IF NOT EXISTS ubereats_amount REAL DEFAULT 0`,
        sql`ALTER TABLE sugu_cash_entries ADD COLUMN IF NOT EXISTS deliveroo_amount REAL DEFAULT 0`,
        sql`ALTER TABLE sugu_cash_entries ADD COLUMN IF NOT EXISTS cheque_amount REAL DEFAULT 0`,
        sql`ALTER TABLE sugu_cash_entries ADD COLUMN IF NOT EXISTS virement_amount REAL DEFAULT 0`,
    ];
    for (const alter of cashColumnAlters) {
        try { await db.execute(alter); } catch {}
    }

    console.log("[SUGU] ✅ Column schema sync complete");

    try {
        await db.execute(sql`UPDATE sugu_general_expenses SET category = 'energie' WHERE category != 'energie' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(category, 'é', 'e'), 'É', 'E'), 'è', 'e'), 'È', 'E')) ~* '^[eé]lectricit[eé]$|^[eé]nergie?$|^energy$'`);
        await db.execute(sql`UPDATE sugu_general_expenses SET category = 'telecom' WHERE LOWER(REPLACE(REPLACE(category, 'é', 'e'), 'É', 'e')) IN ('telecom', 'telecommunications', 'telecomunications') AND category != 'telecom'`);
        await db.execute(sql`UPDATE sugu_general_expenses SET category = 'eau' WHERE category != 'eau' AND LOWER(category) = 'eau'`);
    } catch {}

    try {
        await db.execute(sql`UPDATE sugu_general_expenses SET "paymentMethod" = 'prelevement' WHERE ("paymentMethod" IS NULL OR "paymentMethod" = '') AND notes LIKE '%Prélèvement%'`);
        await db.execute(sql`UPDATE sugu_general_expenses SET "paymentMethod" = 'virement' WHERE ("paymentMethod" IS NULL OR "paymentMethod" = '') AND notes LIKE '%Virement%'`);
        await db.execute(sql`UPDATE sugu_general_expenses SET "paymentMethod" = 'cheque' WHERE ("paymentMethod" IS NULL OR "paymentMethod" = '') AND notes LIKE '%Chèque%'`);
        await db.execute(sql`UPDATE sugu_general_expenses SET "paymentMethod" = 'carte' WHERE ("paymentMethod" IS NULL OR "paymentMethod" = '') AND notes LIKE '%Carte%'`);
        await db.execute(sql`UPDATE sugu_general_expenses SET "paymentMethod" = 'especes' WHERE ("paymentMethod" IS NULL OR "paymentMethod" = '') AND notes LIKE '%Espèces%'`);
    } catch {}

    // Backfill: extract invoice numbers from notes into the dedicated invoice_number column
    try {
        const orphans = await db.execute(sql`SELECT id, notes FROM sugu_general_expenses WHERE invoice_number IS NULL AND notes LIKE '%Facture: %'`);
        const rows: any[] = (orphans as any).rows ?? (Array.isArray(orphans) ? orphans : []);
        for (const row of rows) {
            const m = (row.notes || "").match(/Facture:\s*([^\s|]{2,50})/);
            if (m?.[1]) {
                await db.execute(sql`UPDATE sugu_general_expenses SET invoice_number = ${m[1].trim()} WHERE id = ${row.id} AND invoice_number IS NULL`);
            }
        }
        if (rows.length > 0) console.log(`[SUGU] Backfilled invoice_number for ${rows.length} expense(s)`);
    } catch (e: any) { console.error("[SUGU] invoice_number backfill error:", e?.message); }

    try {
        const orphanRhFiles = await db.select().from(suguFiles)
            .where(and(eq(suguFiles.category, "rh"), isNull(suguFiles.employeeId)));
        if (orphanRhFiles.length > 0) {
            const allEmps = await db.select().from(suguEmployees);
            let linked = 0;
            for (const f of orphanRhFiles) {
                const name = (f.originalName || "").toUpperCase();
                const match = allEmps.find(e => {
                    const fullA = `${e.lastName} ${e.firstName}`.toUpperCase();
                    const fullB = `${e.firstName} ${e.lastName}`.toUpperCase();
                    return name.includes(fullA) || name.includes(fullB);
                });
                if (match) {
                    await db.update(suguFiles).set({ employeeId: match.id }).where(eq(suguFiles.id, f.id));
                    linked++;
                }
            }
            if (linked > 0) console.log(`[SUGU] Auto-linked ${linked}/${orphanRhFiles.length} orphaned RH files to employees`);
        }
    } catch (e: any) { console.error("[SUGU] RH auto-link error:", e?.message); }
}

export const tablesReady = ensureSuguTables();
