import { Router, Request, Response } from "express";
import { db } from "../../../db";
import { suguCashRegister } from "@shared/schema";
import { eq } from "drizzle-orm";
import { hubriseService } from "../../../services/hubriseService";

import financialRoutes from "./financialRoutes";
import hrRoutes from "./hrRoutes";
import auditBankImportRoutes from "./auditBankImportRoutes";
import filesRoutes from "./filesRoutes";
import fileOpsRoutes from "./fileOpsRoutes";
import suppliersAnalyticsRoutes from "./suppliersAnalyticsRoutes";
import expertBackupRoutes from "./expertBackupRoutes";

(async () => { try { await hubriseService.ensureTable(); console.log("[HubRise] Table ready"); } catch (e: any) { console.error("[HubRise] Init error:", e?.message); } })();

const router = Router();

router.post("/cash/batch-import-init", async (req: Request, res: Response) => {
    const secret = req.headers["x-import-secret"];
    if (!secret || secret !== process.env.SYSTEM_STATUS_SECRET) {
        return res.status(403).json({ error: "Forbidden" });
    }
    try {
        const entries: any[] = req.body;
        if (!Array.isArray(entries)) return res.status(400).json({ error: "Expected array" });
        let inserted = 0, skipped = 0;
        for (const entry of entries) {
            const existing = await db.select({ id: suguCashRegister.id }).from(suguCashRegister).where(eq(suguCashRegister.entryDate, entry.entryDate)).limit(1);
            if (existing.length > 0) { skipped++; continue; }
            await db.insert(suguCashRegister).values({
                entryDate: entry.entryDate, totalRevenue: entry.totalRevenue,
                cashAmount: entry.cashAmount || 0, cbAmount: entry.cbAmount || 0,
                cbzenAmount: entry.cbzenAmount || 0, trAmount: entry.trAmount || 0,
                ctrAmount: entry.ctrAmount || 0, chequeAmount: entry.chequeAmount || 0,
                virementAmount: entry.virementAmount || 0, ubereatsAmount: entry.ubereatsAmount || 0,
                deliverooAmount: entry.deliverooAmount || 0,
            });
            inserted++;
        }
        return res.json({ inserted, skipped });
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

router.get("/hubrise/callback", async (req: Request, res: Response) => {
    const { code } = req.query;
    if (!code || typeof code !== "string") return res.status(400).send("Missing authorization code");
    try {
        const host = req.headers.host || req.hostname;
        const proto = req.headers["x-forwarded-proto"] || req.protocol;
        const redirectUri = `${proto}://${host}/api/v2/sugu-management/hubrise/callback`;
        await hubriseService.handleCallback(code, redirectUri);
        res.send(`<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:white"><div style="text-align:center"><h1 style="color:#f97316">✓ HubRise connecté !</h1><p>Vous pouvez fermer cette fenêtre et retourner sur SUGU.</p><script>setTimeout(()=>window.close(),3000)</script></div></body></html>`);
    } catch (e: any) {
        console.error("[HubRise] Callback error:", e?.message);
        res.status(500).send(`<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:white"><div style="text-align:center"><h1 style="color:#ef4444">Erreur HubRise</h1><p>${e.message}</p></div></body></html>`);
    }
});

router.use((req: Request, res: Response, next) => {
    const user = (req as any).user;
    const isOwner = (req as any).isOwner;
    if (isOwner || user?.role === "approved" || user?.role === "suguval_only") {
        if (user?.role === "suguval_only" && req.method !== "GET") {
            const allowedPostPaths = [/\/files\/\d+\/download$/, /\/files\/\d+\/send-email$/, /\/files\/send-email-bulk$/, /\/cash\/parse-ticket$/];
            const isAllowed = allowedPostPaths.some(p => p.test(req.path));
            if (!isAllowed) {
                return res.status(403).json({ error: "Lecture seule — opération non autorisée" });
            }
        }
        return next();
    }
    return res.status(403).json({ error: "Access denied for SUGU Valentine management" });
});

router.use(financialRoutes);
router.use(hrRoutes);
router.use(auditBankImportRoutes);
router.use(filesRoutes);
router.use(fileOpsRoutes);
router.use(suppliersAnalyticsRoutes);
router.use(expertBackupRoutes);

export default router;
