import { Router, Request, Response } from "express";
import { db } from "../../../db";
import { suguFiles, suguTrash } from "@shared/schema";
import { eq, desc, sql, inArray } from "drizzle-orm";
import { emitSuguFilesUpdated } from "../../../services/realtimeSync";
import { downloadFromObjectStorage, deleteFromObjectStorage, getArchiver } from "./shared";

const router = Router();

router.get("/files/:id/download", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const [file] = await db.select().from(suguFiles).where(eq(suguFiles.id, id));
        if (!file) {
            return res.status(404).json({ error: "File not found" });
        }

        const { buffer } = await downloadFromObjectStorage(file.storagePath);
        res.setHeader("Content-Type", file.mimeType);
        res.setHeader("Content-Disposition", `inline; filename="${file.originalName}"`);
        res.send(buffer);

    } catch (error) {
        console.error("[SUGU] Error downloading file:", error);
        res.status(500).json({ error: "Failed to download file" });
    }
});

// POST /files/send-email-bulk — send ONE email with multiple file attachments
router.post("/files/send-email-bulk", async (req: Request, res: Response) => {
    try {
        const { to, fileIds } = req.body;
        if (!to || typeof to !== "string" || !to.includes("@")) {
            return res.status(400).json({ error: "Adresse email destinataire invalide" });
        }
        if (!Array.isArray(fileIds) || fileIds.length === 0) {
            return res.status(400).json({ error: "Aucun fichier sélectionné" });
        }

        const files = await db.select().from(suguFiles).where(inArray(suguFiles.id, fileIds.map(Number)));
        if (files.length === 0) return res.status(404).json({ error: "Aucun fichier trouvé" });

        const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
        const fileDetails: string[] = [];
        for (const file of files) {
            const { buffer } = await downloadFromObjectStorage(file.storagePath);
            attachments.push({ filename: file.originalName, content: buffer, contentType: file.mimeType });
            const categoryLabel = CATEGORY_LABELS[file.category] || file.category;
            const parts = [`  • ${file.originalName} (${categoryLabel})`];
            if (file.supplier) parts[0] += ` — ${file.supplier}`;
            fileDetails.push(parts[0]);
        }

        const dateStr = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
        const subject = `[SUGU Valentine] ${files.length} document${files.length > 1 ? "s" : ""} — ${dateStr}`;
        const body = [
            `Bonjour,`,
            ``,
            `Veuillez trouver ci-joint ${files.length} document${files.length > 1 ? "s" : ""} depuis SUGU Valentine :`,
            ``,
            ...fileDetails,
            ``,
            `  • Envoyé le : ${dateStr}`,
            ``,
            `Cordialement,`,
            `SUGU Valentine`,
        ].join("\n");

        const { googleMailService } = await import("../../../services/googleMailService");
        await googleMailService.sendWithAttachment({ to, subject, body, attachments });

        for (const file of files) {
            await db.update(suguFiles)
                .set({ emailedTo: sql`array_append(coalesce(emailed_to, '{}'::text[]), ${to}::text)` })
                .where(eq(suguFiles.id, file.id));
        }

        console.log(`[SUGU] Bulk email: ${files.length} files sent to ${to} (${files.map(f => f.originalName).join(", ")})`);
        res.json({ success: true, message: `${files.length} fichier(s) envoyé(s) à ${to}`, count: files.length });
    } catch (error: any) {
        console.error("[SUGU] Error sending bulk email:", error);
        res.status(500).json({ error: "Échec de l'envoi : " + error?.message });
    }
});

// POST /files/:id/send-email — send file as attachment to a given email address
router.post("/files/:id/send-email", async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const { to } = req.body;
        if (!to || typeof to !== "string" || !to.includes("@")) {
            return res.status(400).json({ error: "Adresse email destinataire invalide" });
        }

        const [file] = await db.select().from(suguFiles).where(eq(suguFiles.id, id));
        if (!file) return res.status(404).json({ error: "Fichier introuvable" });

        const { buffer } = await downloadFromObjectStorage(file.storagePath);

        const categoryLabel = CATEGORY_LABELS[file.category] || file.category;
        const dateStr = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
        const subject = `[SUGU Valentine] ${file.originalName}`;
        const body = [
            `Bonjour,`,
            ``,
            `Veuillez trouver ci-joint le document suivant depuis SUGU Valentine :`,
            ``,
            `  • Fichier   : ${file.originalName}`,
            `  • Catégorie : ${categoryLabel}`,
            file.supplier ? `  • Fournisseur : ${file.supplier}` : null,
            file.fileDate ? `  • Date doc.  : ${file.fileDate}` : null,
            file.description ? `  • Description : ${file.description}` : null,
            `  • Envoyé le  : ${dateStr}`,
            ``,
            `Cordialement,`,
            `SUGU Valentine`,
        ].filter(Boolean).join("\n");

        const attachment = { filename: file.originalName, content: buffer, contentType: file.mimeType };

        const { googleMailService } = await import("../../../services/googleMailService");
        await googleMailService.sendWithAttachment({ to, subject, body, attachments: [attachment] });

        await db.update(suguFiles)
            .set({ emailedTo: sql`array_append(coalesce(emailed_to, '{}'::text[]), ${to}::text)` })
            .where(eq(suguFiles.id, id));

        console.log(`[SUGU] File ${file.originalName} sent by email to ${to}`);
        res.json({ success: true, message: `Fichier envoyé à ${to}` });
    } catch (error: any) {
        console.error("[SUGU] Error sending file by email:", error);
        res.status(500).json({ error: "Échec de l'envoi : " + error?.message });
    }
});

// DELETE /files/:id — soft-delete: move to trash (kept 7 days), file stays in storage
router.delete("/files/:id", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    try {
        const [file] = await db.select().from(suguFiles).where(eq(suguFiles.id, id));
        if (!file) return res.status(404).json({ error: "File not found" });

        const now = new Date();
        const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        await db.insert(suguTrash).values({
            originalFileId: file.id,
            fileName: file.fileName,
            originalName: file.originalName,
            mimeType: file.mimeType,
            fileSize: file.fileSize,
            category: file.category,
            fileType: file.fileType,
            supplier: file.supplier,
            description: file.description,
            fileDate: file.fileDate,
            storagePath: file.storagePath,
            emailedTo: file.emailedTo,
            deletedAt: now,
            expiresAt,
        });

        await db.delete(suguFiles).where(eq(suguFiles.id, id));

        console.log(`[SUGU] File ${id} (${file.originalName}) moved to trash — expires ${expiresAt.toISOString()}`);
        emitSuguFilesUpdated();
        res.json({ success: true, expiresAt: expiresAt.toISOString() });
    } catch (error) {
        console.error(`[SUGU] Error moving file ${id} to trash:`, error);
        res.status(500).json({ error: "Failed to move file to trash" });
    }
});

// GET /trash — list trash files
router.get("/trash", async (_req: Request, res: Response) => {
    try {
        const items = await db.select().from(suguTrash).orderBy(desc(suguTrash.deletedAt));
        res.json(items);
    } catch (error) {
        console.error("[SUGU] Error listing trash:", error);
        res.status(500).json({ error: "Failed to list trash" });
    }
});

// POST /trash/:id/restore — restore a file from trash back to suguFiles
router.post("/trash/:id/restore", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    try {
        const [item] = await db.select().from(suguTrash).where(eq(suguTrash.id, id));
        if (!item) return res.status(404).json({ error: "Trash item not found" });

        if (new Date() > new Date(item.expiresAt)) {
            return res.status(410).json({ error: "Fichier expiré — suppression définitive déjà effectuée" });
        }

        await db.insert(suguFiles).values({
            fileName: item.fileName,
            originalName: item.originalName,
            mimeType: item.mimeType,
            fileSize: item.fileSize,
            category: item.category,
            fileType: item.fileType,
            supplier: item.supplier,
            description: item.description,
            fileDate: item.fileDate,
            storagePath: item.storagePath,
            emailedTo: item.emailedTo,
        });

        await db.delete(suguTrash).where(eq(suguTrash.id, id));

        console.log(`[SUGU] Trash item ${id} (${item.originalName}) restored to files`);
        emitSuguFilesUpdated();
        res.json({ success: true });
    } catch (error) {
        console.error(`[SUGU] Error restoring trash item ${id}:`, error);
        res.status(500).json({ error: "Failed to restore file" });
    }
});

// DELETE /trash/:id — permanently delete a trash item (removes from storage too)
router.delete("/trash/:id", async (req: Request, res: Response) => {
    const id = parseInt(req.params.id);
    try {
        const [item] = await db.select().from(suguTrash).where(eq(suguTrash.id, id));
        if (!item) return res.status(404).json({ error: "Trash item not found" });

        try { await deleteFromObjectStorage(item.storagePath); } catch (e) { console.error(`[SUGU] Storage delete failed for trash ${id}:`, e); }
        await db.delete(suguTrash).where(eq(suguTrash.id, id));

        console.log(`[SUGU] Trash item ${id} (${item.originalName}) permanently deleted`);
        res.json({ success: true });
    } catch (error) {
        console.error(`[SUGU] Error permanently deleting trash item ${id}:`, error);
        res.status(500).json({ error: "Failed to permanently delete" });
    }
});

// Cleanup: permanently delete trash files older than 7 days (auto-purge)
async function purgeExpiredTrash() {
    try {
        const expired = await db.select().from(suguTrash).where(sql`expires_at < NOW()`);
        for (const item of expired) {
            try { await deleteFromObjectStorage(item.storagePath); } catch { /* ignore storage errors */ }
            await db.delete(suguTrash).where(eq(suguTrash.id, item.id));
        }
        if (expired.length > 0) console.log(`[SUGU] Auto-purged ${expired.length} expired trash file(s)`);
    } catch (err) {
        console.error("[SUGU] Error purging expired trash:", err);
    }
}
// Run 10s after startup (table must be ensured first) + schedule every hour
setTimeout(purgeExpiredTrash, 10_000);
setInterval(purgeExpiredTrash, 60 * 60 * 1000);


export default router;
