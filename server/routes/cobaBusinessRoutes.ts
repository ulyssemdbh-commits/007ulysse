import { Router, Request, Response } from "express";
import multer from "multer";
import * as path from "path";
import * as fs from "fs";
import { cobaBusinessService } from "../services/cobaBusinessService";

const MIME_MAP: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".csv": "text/csv",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] || "application/octet-stream";
}

const router = Router();

const COBA_API_KEY = process.env.COBA_API_KEY || "coba-apptoorder-2025";

const ALLOWED_ORIGINS = [
  "https://macommande.shop",
  "https://www.macommande.shop",
  "https://ulysseproject.org",
  "https://www.ulysseproject.org",
  "https://ulyssepro.org",
  "https://www.ulyssepro.org",
  "http://localhost:3000",
  "http://localhost:5000",
];

function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.some(o => origin.startsWith(o))) return true;
  if (/\.replit\.dev$/.test(origin) || /\.replit\.app$/.test(origin)) return true;
  return false;
}

router.use((req: Request, res: Response, next) => {
  const origin = req.headers.origin as string;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "https://macommande.shop");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-coba-key");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function authMiddleware(req: Request, res: Response, next: Function) {
  const key = req.headers["x-coba-key"] as string;
  if (!key || key !== COBA_API_KEY) {
    return res.status(401).json({ error: "Invalid COBA API key" });
  }
  next();
}

function validateTenantId(req: Request, res: Response, next: Function) {
  const { tenantId } = req.params;
  if (!tenantId || !/^[a-z0-9_-]+$/i.test(tenantId)) {
    return res.status(400).json({ error: "Invalid tenantId. Use alphanumeric, dash or underscore only." });
  }
  next();
}

router.use(authMiddleware);

// ─── ADMIN: All tenants overview (MaxAI only) ───
router.get("/tenants", async (_req: Request, res: Response) => {
  try {
    const tenants = await cobaBusinessService.listRegisteredTenants();
    res.json({ ok: true, tenants });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/overview", async (req: Request, res: Response) => {
  try {
    const year = req.query.year as string | undefined;
    const overview = await cobaBusinessService.getAllTenantsOverview(year);
    res.json(overview);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── SYNTHESIS (per tenant, isolated) ───
router.get("/synthesis/:tenantId", validateTenantId, async (req: Request, res: Response) => {
  try {
    const synthesis = await cobaBusinessService.getFinancialSynthesis(req.params.tenantId, req.query.year as string);
    res.json(synthesis);
  } catch (err: any) {
    console.error("[COBA-Biz] Synthesis error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PURCHASES (isolated per tenant schema) ───
router.get("/purchases/:tenantId", validateTenantId, async (req: Request, res: Response) => {
  try {
    const rows = await cobaBusinessService.listPurchases(req.params.tenantId, {
      year: req.query.year as string,
      isPaid: req.query.isPaid === "true" ? true : req.query.isPaid === "false" ? false : undefined,
    });
    res.json({ ok: true, data: rows, count: rows.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/purchases/:tenantId", validateTenantId, async (req: Request, res: Response) => {
  try {
    const row = await cobaBusinessService.addPurchase(req.params.tenantId, req.body);
    res.json({ ok: true, data: row });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put("/purchases/:tenantId/:id", validateTenantId, async (req: Request, res: Response) => {
  try {
    const row = await cobaBusinessService.updatePurchase(req.params.tenantId, parseInt(req.params.id), req.body);
    res.json({ ok: true, data: row });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/purchases/:tenantId/:id", validateTenantId, async (req: Request, res: Response) => {
  try {
    await cobaBusinessService.deletePurchase(req.params.tenantId, parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── EXPENSES (isolated per tenant schema) ───
router.get("/expenses/:tenantId", validateTenantId, async (req: Request, res: Response) => {
  try {
    const rows = await cobaBusinessService.listExpenses(req.params.tenantId, {
      year: req.query.year as string,
      category: req.query.category as string,
    });
    res.json({ ok: true, data: rows, count: rows.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/expenses/:tenantId", validateTenantId, async (req: Request, res: Response) => {
  try {
    const row = await cobaBusinessService.addExpense(req.params.tenantId, req.body);
    res.json({ ok: true, data: row });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put("/expenses/:tenantId/:id", validateTenantId, async (req: Request, res: Response) => {
  try {
    const row = await cobaBusinessService.updateExpense(req.params.tenantId, parseInt(req.params.id), req.body);
    res.json({ ok: true, data: row });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/expenses/:tenantId/:id", validateTenantId, async (req: Request, res: Response) => {
  try {
    await cobaBusinessService.deleteExpense(req.params.tenantId, parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── BANK (isolated per tenant schema) ───
router.get("/bank/:tenantId", validateTenantId, async (req: Request, res: Response) => {
  try {
    const rows = await cobaBusinessService.listBankEntries(req.params.tenantId, {
      year: req.query.year as string,
    });
    res.json({ ok: true, data: rows, count: rows.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/bank/:tenantId", validateTenantId, async (req: Request, res: Response) => {
  try {
    const row = await cobaBusinessService.addBankEntry(req.params.tenantId, req.body);
    res.json({ ok: true, data: row });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put("/bank/:tenantId/:id", validateTenantId, async (req: Request, res: Response) => {
  try {
    const row = await cobaBusinessService.updateBankEntry(req.params.tenantId, parseInt(req.params.id), req.body);
    res.json({ ok: true, data: row });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/bank/:tenantId/:id", validateTenantId, async (req: Request, res: Response) => {
  try {
    await cobaBusinessService.deleteBankEntry(req.params.tenantId, parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── LOANS (isolated per tenant schema) ───
router.get("/loans/:tenantId", validateTenantId, async (req: Request, res: Response) => {
  try {
    const rows = await cobaBusinessService.listLoans(req.params.tenantId);
    res.json({ ok: true, data: rows, count: rows.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/loans/:tenantId", validateTenantId, async (req: Request, res: Response) => {
  try {
    const row = await cobaBusinessService.addLoan(req.params.tenantId, req.body);
    res.json({ ok: true, data: row });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put("/loans/:tenantId/:id", validateTenantId, async (req: Request, res: Response) => {
  try {
    const row = await cobaBusinessService.updateLoan(req.params.tenantId, parseInt(req.params.id), req.body);
    res.json({ ok: true, data: row });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/loans/:tenantId/:id", validateTenantId, async (req: Request, res: Response) => {
  try {
    await cobaBusinessService.deleteLoan(req.params.tenantId, parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── CASH REGISTER (isolated per tenant schema) ───
router.get("/cash/:tenantId", validateTenantId, async (req: Request, res: Response) => {
  try {
    const rows = await cobaBusinessService.listCashEntries(req.params.tenantId, {
      year: req.query.year as string,
      month: req.query.month as string,
    });
    res.json({ ok: true, data: rows, count: rows.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/cash/:tenantId", validateTenantId, async (req: Request, res: Response) => {
  try {
    const row = await cobaBusinessService.addCashEntry(req.params.tenantId, req.body);
    res.json({ ok: true, data: row });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put("/cash/:tenantId/:id", validateTenantId, async (req: Request, res: Response) => {
  try {
    const row = await cobaBusinessService.updateCashEntry(req.params.tenantId, parseInt(req.params.id), req.body);
    res.json({ ok: true, data: row });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/cash/:tenantId/:id", validateTenantId, async (req: Request, res: Response) => {
  try {
    await cobaBusinessService.deleteCashEntry(req.params.tenantId, parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── EMPLOYEES (isolated per tenant schema) ───
router.get("/employees/:tenantId", validateTenantId, async (req: Request, res: Response) => {
  try {
    const activeOnly = req.query.all !== "true";
    const rows = await cobaBusinessService.listEmployees(req.params.tenantId, activeOnly);
    res.json({ ok: true, data: rows, count: rows.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/employees/:tenantId", validateTenantId, async (req: Request, res: Response) => {
  try {
    const row = await cobaBusinessService.addEmployee(req.params.tenantId, req.body);
    res.json({ ok: true, data: row });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put("/employees/:tenantId/:id", validateTenantId, async (req: Request, res: Response) => {
  try {
    const row = await cobaBusinessService.updateEmployee(req.params.tenantId, parseInt(req.params.id), req.body);
    res.json({ ok: true, data: row });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/employees/:tenantId/:id", validateTenantId, async (req: Request, res: Response) => {
  try {
    await cobaBusinessService.deleteEmployee(req.params.tenantId, parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── PAYROLL (isolated per tenant schema) ───
router.get("/payroll/:tenantId", validateTenantId, async (req: Request, res: Response) => {
  try {
    const rows = await cobaBusinessService.listPayroll(req.params.tenantId, {
      period: req.query.period as string,
      employeeId: req.query.employeeId ? parseInt(req.query.employeeId as string) : undefined,
    });
    res.json({ ok: true, data: rows, count: rows.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/payroll/:tenantId", validateTenantId, async (req: Request, res: Response) => {
  try {
    const row = await cobaBusinessService.addPayroll(req.params.tenantId, req.body);
    res.json({ ok: true, data: row });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put("/payroll/:tenantId/:id", validateTenantId, async (req: Request, res: Response) => {
  try {
    const row = await cobaBusinessService.updatePayroll(req.params.tenantId, parseInt(req.params.id), req.body);
    res.json({ ok: true, data: row });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── SUPPLIERS / FOURNISSEURS (isolated per tenant schema) ───
router.get("/suppliers/:tenantId", validateTenantId, async (req: Request, res: Response) => {
  try {
    const activeOnly = req.query.all !== "true";
    const rows = await cobaBusinessService.listSuppliers(req.params.tenantId, { active: activeOnly ? true : undefined });
    res.json({ ok: true, data: rows, count: rows.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/suppliers/:tenantId", validateTenantId, async (req: Request, res: Response) => {
  try {
    const row = await cobaBusinessService.addSupplier(req.params.tenantId, req.body);
    res.json({ ok: true, data: row });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put("/suppliers/:tenantId/:id", validateTenantId, async (req: Request, res: Response) => {
  try {
    const row = await cobaBusinessService.updateSupplier(req.params.tenantId, parseInt(req.params.id), req.body);
    res.json({ ok: true, data: row });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/suppliers/:tenantId/:id", validateTenantId, async (req: Request, res: Response) => {
  try {
    await cobaBusinessService.deleteSupplier(req.params.tenantId, parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── ABSENCES (isolated per tenant schema) ───
router.get("/absences/:tenantId", validateTenantId, async (req: Request, res: Response) => {
  try {
    const rows = await cobaBusinessService.listAbsences(req.params.tenantId, {
      employeeId: req.query.employeeId ? parseInt(req.query.employeeId as string) : undefined,
      year: req.query.year as string,
    });
    res.json({ ok: true, data: rows, count: rows.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/absences/:tenantId", validateTenantId, async (req: Request, res: Response) => {
  try {
    const row = await cobaBusinessService.addAbsence(req.params.tenantId, req.body);
    res.json({ ok: true, data: row });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put("/absences/:tenantId/:id", validateTenantId, async (req: Request, res: Response) => {
  try {
    const row = await cobaBusinessService.updateAbsence(req.params.tenantId, parseInt(req.params.id), req.body);
    res.json({ ok: true, data: row });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete("/absences/:tenantId/:id", validateTenantId, async (req: Request, res: Response) => {
  try {
    await cobaBusinessService.deleteAbsence(req.params.tenantId, parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── AUDIT (isolated per tenant schema) ───
router.get("/audit/:tenantId", validateTenantId, async (req: Request, res: Response) => {
  try {
    const overview = await cobaBusinessService.getAuditOverview(req.params.tenantId, req.query.year as string);
    res.json({ ok: true, data: overview });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── FILES (per tenant) ───
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const tenantId = req.params.tenantId;
      cb(null, cobaBusinessService.tenantUploadDir(tenantId));
    },
    filename: (_req, file, cb) => {
      const unique = Date.now() + "-" + Math.round(Math.random() * 1e4);
      cb(null, `${unique}-${file.originalname}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.get("/files/:tenantId", validateTenantId, async (req: Request, res: Response) => {
  try {
    const files = await cobaBusinessService.listFiles(req.params.tenantId, { category: req.query.category as string });
    res.json({ ok: true, data: files });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/files/:tenantId/stats", validateTenantId, async (req: Request, res: Response) => {
  try {
    const stats = await cobaBusinessService.getFileStats(req.params.tenantId);
    res.json({ ok: true, data: stats });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/files/:tenantId/upload", validateTenantId, upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier reçu" });
    const { category, description } = req.body;
    const result = await cobaBusinessService.addFile(req.params.tenantId, {
      fileName: req.file.originalname,
      fileType: path.extname(req.file.originalname).replace(".", "") || "document",
      filePath: req.file.path,
      fileSize: req.file.size,
      category: category || "autre",
      description: description || "",
      uploadSource: "upload",
    });
    res.json({ ok: true, data: result });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/files/:tenantId/:id/download", validateTenantId, async (req: Request, res: Response) => {
  try {
    const file = await cobaBusinessService.getFile(req.params.tenantId, parseInt(req.params.id));
    if (!file) return res.status(404).json({ error: "Fichier introuvable" });
    const filePath = file.file_path as string;
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Fichier physique introuvable sur le serveur" });
    }
    const contentType = getMimeType(filePath);
    const fileName = (file.file_name as string) || path.basename(filePath);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(fileName)}"`);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erreur download";
    res.status(500).json({ error: msg });
  }
});

router.delete("/files/:tenantId/:id", validateTenantId, async (req: Request, res: Response) => {
  try {
    await cobaBusinessService.deleteFile(req.params.tenantId, parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── BANK STATEMENT PARSING ───
router.post("/files/:tenantId/parse-bank", validateTenantId, upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier PDF reçu" });
    const result = await cobaBusinessService.parseBankStatementForTenant(req.params.tenantId, req.file.path, req.file.originalname);
    res.json({ ok: true, data: result });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── PAYROLL PARSING ───
router.post("/files/:tenantId/parse-payroll", validateTenantId, upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier PDF reçu" });
    const result = await cobaBusinessService.parsePayrollForTenant(req.params.tenantId, req.file.path, req.file.originalname);
    res.json({ ok: true, data: result });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── HUBRISE (per tenant) ───
router.get("/hubrise/:tenantId/config", validateTenantId, async (req: Request, res: Response) => {
  try {
    const config = await cobaBusinessService.getHubriseConfig(req.params.tenantId);
    if (config) {
      config.access_token = "***";
    }
    res.json({ ok: true, data: config });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/hubrise/:tenantId/config", validateTenantId, async (req: Request, res: Response) => {
  try {
    const { accessToken, accountId, locationId, catalogId, customerListId } = req.body;
    if (!accessToken) return res.status(400).json({ error: "accessToken requis" });
    const result = await cobaBusinessService.setHubriseConfig(req.params.tenantId, { accessToken, accountId, locationId, catalogId, customerListId });
    res.json({ ok: true, data: result });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/hubrise/:tenantId/sync", validateTenantId, async (req: Request, res: Response) => {
  try {
    const result = await cobaBusinessService.syncHubriseOrders(req.params.tenantId);
    res.json({ ok: true, data: result });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/hubrise/:tenantId/orders", validateTenantId, async (req: Request, res: Response) => {
  try {
    const orders = await cobaBusinessService.listHubriseOrders(req.params.tenantId, {
      limit: parseInt(req.query.limit as string) || 100,
      from: req.query.from as string,
      to: req.query.to as string,
    });
    res.json({ ok: true, data: orders });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/hubrise/:tenantId/summary", validateTenantId, async (req: Request, res: Response) => {
  try {
    const summary = await cobaBusinessService.getHubriseOrdersSummary(req.params.tenantId, {
      from: req.query.from as string,
      to: req.query.to as string,
    });
    res.json({ ok: true, data: summary });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ─── PER-TENANT CHAT HISTORY ROUTES ───
router.get("/chat-history/:tenantId/stats", validateTenantId, async (req: Request, res: Response) => {
  try {
    const stats = await cobaBusinessService.getChatStats(req.params.tenantId);
    res.json({ ok: true, data: stats });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/chat-history/:tenantId/user/:proUserId", validateTenantId, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const history = await cobaBusinessService.getChatHistoryForUser(req.params.tenantId, req.params.proUserId, limit);
    res.json({ ok: true, data: history });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/chat-history/:tenantId/session/:sessionId", validateTenantId, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 30;
    const history = await cobaBusinessService.getChatHistory(req.params.tenantId, req.params.sessionId, limit);
    res.json({ ok: true, data: history });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
