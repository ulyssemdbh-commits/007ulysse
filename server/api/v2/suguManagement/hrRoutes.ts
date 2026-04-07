import { Router, Request, Response } from "express";
import multer from "multer";
import { hybridUpload } from "../../../middleware/base64Upload";
import { db } from "../../../db";
import {
    suguEmployees, insertSuguEmployeeSchema,
    suguPayroll, insertSuguPayrollSchema,
    suguAbsences, insertSuguAbsenceSchema,
    suguFiles, insertSuguFileSchema,
} from "@shared/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { emitSuguEmployeesUpdated, emitSuguPayrollUpdated, emitSuguAbsencesUpdated, emitSuguFilesUpdated } from "../../../services/realtimeSync";
import { parsePayrollPDF } from "../../../services/payrollParserService";
import { tablesReady, importStatusMap, uploadToObjectStorage } from "./shared";

const router = Router();

// ============ GESTION RH / EMPLOYEES ============

router.get("/employees", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const data = await db.select().from(suguEmployees).orderBy(suguEmployees.lastName);
        console.log(`[SUGU] Fetched ${data.length} employees`);
        res.json(data);
    } catch (error: any) {
        console.error("[SUGU] Error fetching employees:", error?.message || error);
        if (error?.message?.includes("does not exist") || error?.message?.includes("relation")) {
            res.json([]);
        } else {
            res.status(500).json({ error: "Failed to fetch employees" });
        }
    }
});

router.post("/employees", async (req: Request, res: Response) => {
    console.log("[SUGU] POST /employees body:", JSON.stringify(req.body));
    try {
        await tablesReady;
        let parsed: any;
        try {
            parsed = insertSuguEmployeeSchema.parse(req.body);
        } catch (zodErr: any) {
            console.error("[SUGU] Employee Zod validation failed:", zodErr?.issues || zodErr?.message || zodErr);
            const b = req.body || {};
            parsed = {
                firstName: b.firstName || "Inconnu",
                lastName: b.lastName || "Inconnu",
                role: b.role || "Non spécifié",
                contractType: b.contractType || "CDI",
                monthlySalary: typeof b.monthlySalary === "number" ? b.monthlySalary : b.monthlySalary ? parseFloat(b.monthlySalary) : null,
                hourlyRate: typeof b.hourlyRate === "number" ? b.hourlyRate : b.hourlyRate ? parseFloat(b.hourlyRate) : null,
                weeklyHours: typeof b.weeklyHours === "number" ? b.weeklyHours : b.weeklyHours ? parseFloat(b.weeklyHours) : 35,
                startDate: b.startDate || new Date().toISOString().substring(0, 10),
                endDate: b.endDate || null,
                isActive: b.isActive === true || b.isActive === "true",
                phone: b.phone || null,
                email: b.email || null,
                notes: b.notes || null,
            };
            console.log("[SUGU] Using manual fallback for employee:", JSON.stringify(parsed));
        }

        try {
            const [result] = await db.insert(suguEmployees).values(parsed).returning();
            console.log("[SUGU] Employee created via Drizzle:", result?.id);
            res.json(result);
            emitSuguEmployeesUpdated();
            return;
        } catch (drizzleErr: any) {
            console.error("[SUGU] Drizzle insert failed for employee:", drizzleErr?.message || drizzleErr);
            console.log("[SUGU] Trying raw SQL fallback for employee...");
            const result = await db.execute(sql`
                INSERT INTO sugu_employees (first_name, last_name, role, contract_type, monthly_salary, hourly_rate, weekly_hours, start_date, end_date, is_active, phone, email, notes)
                VALUES (${parsed.firstName}, ${parsed.lastName}, ${parsed.role}, ${parsed.contractType || 'CDI'}, ${parsed.monthlySalary}, ${parsed.hourlyRate}, ${parsed.weeklyHours || 35}, ${parsed.startDate}, ${parsed.endDate}, ${parsed.isActive !== false}, ${parsed.phone}, ${parsed.email}, ${parsed.notes})
                RETURNING *
            `);
            const row = (result as any).rows?.[0] || (result as any)[0];
            console.log("[SUGU] Employee created via raw SQL:", row?.id);
            res.json(row);
            emitSuguEmployeesUpdated();
            return;
        }
    } catch (error: any) {
        console.error("[SUGU] FATAL Error creating employee:", error?.message || error);
        res.status(500).json({ error: "Erreur serveur: " + (error?.message || "Unknown") });
    }
});

router.put("/employees/:id", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const id = parseInt(req.params.id);
        const { firstName, lastName, role, contractType, monthlySalary, hourlyRate, weeklyHours, startDate, endDate, isActive, phone, email, notes } = req.body;
        const [result] = await db.update(suguEmployees).set({ firstName, lastName, role, contractType, monthlySalary, hourlyRate, weeklyHours, startDate, endDate, isActive, phone, email, notes }).where(eq(suguEmployees.id, id)).returning();
        res.json(result);
        emitSuguEmployeesUpdated();
    } catch (error) {
        console.error("[SUGU] Error updating employee:", error);
        res.status(500).json({ error: "Failed to update employee" });
    }
});

router.delete("/employees/:id", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const id = parseInt(req.params.id);
        await db.delete(suguEmployees).where(eq(suguEmployees.id, id));
        res.json({ success: true });
        emitSuguEmployeesUpdated();
    } catch (error) {
        console.error("[SUGU] Error deleting employee:", error);
        res.status(500).json({ error: "Failed to delete employee" });
    }
});

// Payroll
router.get("/payroll", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const period = req.query.period as string;
        let query = db.select().from(suguPayroll);
        if (period) {
            query = query.where(eq(suguPayroll.period, period)) as any;
        }
        const data = await query.orderBy(desc(suguPayroll.period));
        res.json(data);
    } catch (error) {
        console.error("[SUGU] Error fetching payroll:", error);
        res.status(500).json({ error: "Failed to fetch payroll" });
    }
});

router.post("/payroll", async (req: Request, res: Response) => {
    console.log("[SUGU] POST /payroll body:", JSON.stringify(req.body));
    try {
        await tablesReady;
        let parsed: any;
        try {
            parsed = insertSuguPayrollSchema.parse(req.body);
        } catch (zodErr: any) {
            console.error("[SUGU] Payroll Zod validation failed:", zodErr?.issues || zodErr?.message || zodErr);
            const b = req.body || {};
            parsed = {
                employeeId: typeof b.employeeId === "number" ? b.employeeId : parseInt(b.employeeId) || 0,
                period: b.period || new Date().toISOString().substring(0, 7),
                grossSalary: typeof b.grossSalary === "number" ? b.grossSalary : parseFloat(b.grossSalary) || 0,
                netSalary: typeof b.netSalary === "number" ? b.netSalary : parseFloat(b.netSalary) || 0,
                socialCharges: typeof b.socialCharges === "number" ? b.socialCharges : b.socialCharges ? parseFloat(b.socialCharges) : 0,
                bonus: typeof b.bonus === "number" ? b.bonus : b.bonus ? parseFloat(b.bonus) : 0,
                overtime: typeof b.overtime === "number" ? b.overtime : b.overtime ? parseFloat(b.overtime) : 0,
                isPaid: b.isPaid === true || b.isPaid === "true",
                paidDate: b.paidDate || null,
                notes: b.notes || null,
            };
            console.log("[SUGU] Using manual fallback for payroll:", JSON.stringify(parsed));
        }

        try {
            const [result] = await db.insert(suguPayroll).values(parsed).returning();
            console.log("[SUGU] Payroll created via Drizzle:", result?.id);
            res.json(result);
            emitSuguPayrollUpdated();
            return;
        } catch (drizzleErr: any) {
            console.error("[SUGU] Drizzle insert failed for payroll:", drizzleErr?.message || drizzleErr);
            const result = await db.execute(sql`
                INSERT INTO sugu_payroll (employee_id, period, gross_salary, net_salary, social_charges, employer_charges, total_employer_cost, bonus, overtime, is_paid, paid_date, notes)
                VALUES (${parsed.employeeId}, ${parsed.period}, ${parsed.grossSalary}, ${parsed.netSalary}, ${parsed.socialCharges || 0}, ${parsed.employerCharges || null}, ${parsed.totalEmployerCost || null}, ${parsed.bonus || 0}, ${parsed.overtime || 0}, ${parsed.isPaid || false}, ${parsed.paidDate}, ${parsed.notes})
                RETURNING *
            `);
            const row = (result as any).rows?.[0] || (result as any)[0];
            console.log("[SUGU] Payroll created via raw SQL:", row?.id);
            res.json(row);
            emitSuguPayrollUpdated();
            return;
        }
    } catch (error: any) {
        console.error("[SUGU] FATAL Error creating payroll:", error?.message || error);
        res.status(500).json({ error: "Erreur serveur: " + (error?.message || "Unknown") });
    }
});

router.put("/payroll/:id", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const id = parseInt(req.params.id);
        const { employeeId, period, grossSalary, netSalary, socialCharges, bonus, overtime, isPaid, paidDate, pdfPath, notes } = req.body;
        const [result] = await db.update(suguPayroll).set({ employeeId, period, grossSalary, netSalary, socialCharges, bonus, overtime, isPaid, paidDate, pdfPath, notes }).where(eq(suguPayroll.id, id)).returning();
        res.json(result);
        emitSuguPayrollUpdated();
    } catch (error) {
        console.error("[SUGU] Error updating payroll:", error);
        res.status(500).json({ error: "Failed to update payroll" });
    }
});

router.delete("/payroll/:id", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const id = parseInt(req.params.id);
        const [result] = await db.delete(suguPayroll).where(eq(suguPayroll.id, id)).returning();
        if (!result) return res.status(404).json({ error: "Payroll not found" });
        res.json({ success: true });
        emitSuguPayrollUpdated();
    } catch (error) {
        console.error("[SUGU] Error deleting payroll:", error);
        res.status(500).json({ error: "Failed to delete payroll" });
    }
});

// POST /payroll/import-pdf — Parse payroll PDF and create employee + payroll entries
router.post("/payroll/import-pdf", hybridUpload({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }), async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const file = (req as any).file;
        if (!file) {
            return res.status(400).json({ error: "No file uploaded" });
        }
        const importId = `imp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        console.log(`[SUGU] Payroll PDF import queued: ${file.originalname}, ${file.size} bytes (${importId})`);

        const userId = (req as any).session?.userId || 1;
        const autoCreate = req.body?.autoCreate !== "false";
        const fileBuffer = Buffer.from(file.buffer);
        const fileName = file.originalname;
        const fileSize = file.size;
        const fileMime = file.mimetype || "application/pdf";

        res.json({
            success: true,
            async: true,
            importId,
            message: "Bulletin en cours de traitement...",
        });

        processPayrollImportAsync(importId, fileBuffer, fileName, fileSize, fileMime, autoCreate, userId).catch(err => {
            console.error(`[SUGU] Background import ${importId} failed:`, err?.message || err);
        });
    } catch (error: any) {
        console.error("[SUGU] Error importing payroll PDF:", error?.message || error);
        res.status(500).json({ error: "Erreur serveur: " + (error?.message || "Unknown") });
    }
});

router.get("/payroll/import-status/:importId", async (req: Request, res: Response) => {
    const { importId } = req.params;
    const status = importStatusMap.get(importId);
    if (!status) {
        return res.json({ status: "processing", step: "En traitement..." });
    }
    res.json(status);
});

async function processPayrollImportAsync(
    importId: string,
    fileBuffer: Buffer,
    fileName: string,
    fileSize: number,
    fileMime: string,
    autoCreate: boolean,
    userId: number,
) {
    const { broadcastToUser } = await import("../../../services/realtimeSync");

    const sendProgress = (step: string) => {
        importStatusMap.set(importId, { status: "processing", step, updatedAt: Date.now() });
        broadcastToUser(userId, {
            type: "sugu.payroll.import.progress",
            userId,
            data: { importId, step, fileName },
            timestamp: Date.now(),
        });
    };

    try {
        sendProgress("Lecture du PDF...");
        const result = await parsePayrollPDF(fileBuffer, fileName);

        if (!result.success || !result.data) {
            importStatusMap.set(importId, { status: "error", error: "Impossible de lire le bulletin", updatedAt: Date.now() });
            broadcastToUser(userId, {
                type: "sugu.payroll.import.error",
                userId,
                data: { importId, fileName, error: "Impossible de lire le bulletin", details: result.errors },
                timestamp: Date.now(),
            });
            return;
        }

        const parsed = result.data;
        let employeeId: number | null = null;
        let employeeCreated = false;
        let payrollCreated = false;

        if (autoCreate && parsed.employee?.lastName) {
            sendProgress("Recherche de l'employé...");
            const existingEmps = await db.select().from(suguEmployees);
            const parsedSSN = parsed.employee.socialSecurityNumber?.replace(/\s/g, "") || null;

            let match = null as typeof existingEmps[0] | null;
            if (parsedSSN && parsedSSN.length >= 13) {
                match = existingEmps.find(e => e.socialSecurityNumber && e.socialSecurityNumber.replace(/\s/g, "") === parsedSSN) || null;
                if (match) console.log(`[SUGU] SSN match: ${parsedSSN} → employee ${match.firstName} ${match.lastName} (ID ${match.id})`);
            }
            if (!match) {
                match = existingEmps.find(e =>
                    e.lastName.toLowerCase() === parsed.employee.lastName.toLowerCase() &&
                    e.firstName.toLowerCase() === (parsed.employee.firstName || "").toLowerCase()
                ) || null;
            }
            if (!match) {
                const pLast = parsed.employee.lastName.toUpperCase().trim();
                const pFirst = (parsed.employee.firstName || "").toUpperCase().trim();
                match = existingEmps.find(e => {
                    const eLast = e.lastName.toUpperCase().trim();
                    const eFirst = e.firstName.toUpperCase().trim();
                    if (eLast === pLast) return true;
                    if (eFirst === pLast && eLast === pFirst) return true;
                    const pFull = `${pFirst} ${pLast}`;
                    const eFull = `${eFirst} ${eLast}`;
                    if (pFull.includes(eLast) && pFull.includes(eFirst)) return true;
                    if (eFull.includes(pLast) || pFull.includes(eLast)) return true;
                    return false;
                }) || null;
            }

            if (match) {
                employeeId = match.id;
                console.log(`[SUGU] Found existing employee: ${match.firstName} ${match.lastName} (ID ${match.id})`);

                const updates: any = {};
                if (parsed.employee.role && parsed.employee.role !== "Non précisé" && (!match.role || match.role === "Non précisé")) {
                    updates.role = parsed.employee.role;
                }
                if (parsed.hourlyRate && !match.hourlyRate) {
                    updates.hourlyRate = parsed.hourlyRate;
                }
                if (parsed.employee.weeklyHours && !match.weeklyHours) {
                    updates.weeklyHours = parsed.employee.weeklyHours;
                }
                if (parsed.grossSalary && (!match.monthlySalary || match.monthlySalary === 0)) {
                    updates.monthlySalary = parsed.grossSalary;
                }
                if (parsedSSN && parsedSSN.length >= 13 && !match.socialSecurityNumber) {
                    updates.socialSecurityNumber = parsedSSN;
                }
                if (Object.keys(updates).length > 0) {
                    await db.update(suguEmployees).set(updates).where(eq(suguEmployees.id, match.id));
                    console.log(`[SUGU] Updated employee ${match.id} with payroll data:`, updates);
                }
            } else {
                const [newEmp] = await db.insert(suguEmployees).values({
                    firstName: parsed.employee.firstName || "Inconnu",
                    lastName: parsed.employee.lastName,
                    role: parsed.employee.role || "Non précisé",
                    contractType: parsed.employee.contractType || "CDI",
                    monthlySalary: parsed.grossSalary || null,
                    hourlyRate: parsed.hourlyRate || null,
                    weeklyHours: parsed.employee.weeklyHours || 35,
                    startDate: parsed.employee.startDate || new Date().toISOString().substring(0, 10),
                    isActive: true,
                    socialSecurityNumber: parsedSSN,
                }).returning();
                employeeId = newEmp.id;
                employeeCreated = true;
                console.log(`[SUGU] Created new employee: ${newEmp.firstName} ${newEmp.lastName} (ID ${newEmp.id}) SSN=${parsedSSN || "N/A"}`);
                emitSuguEmployeesUpdated();
            }

            if (employeeId && parsed.period && parsed.grossSalary) {
                const existingPayroll = await db.select().from(suguPayroll)
                    .where(and(
                        eq(suguPayroll.employeeId, employeeId),
                        eq(suguPayroll.period, parsed.period)
                    ));

                sendProgress("Archivage du PDF...");
                let pdfStoragePath: string | null = null;
                try {
                    const timestamp = Date.now();
                    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
                    const storedName = `${timestamp}-${safeName}`;
                    const objectPath = await uploadToObjectStorage(fileBuffer, storedName, fileMime);

                    const [fileRecord] = await db.insert(suguFiles).values({
                        fileName: storedName,
                        originalName: fileName,
                        mimeType: fileMime,
                        fileSize: fileSize,
                        category: "rh",
                        fileType: "bulletin_paie",
                        supplier: null,
                        description: `Bulletin de paie - ${parsed.employee.firstName || ""} ${parsed.employee.lastName} - ${parsed.period}`,
                        fileDate: parsed.paymentDate || new Date().toISOString().substring(0, 10),
                        storagePath: objectPath,
                        employeeId: employeeId || null,
                    }).returning();
                    pdfStoragePath = fileRecord.id.toString();
                    console.log(`[SUGU] Payroll PDF archived: ${fileName} → sugu_files ID ${fileRecord.id}`);
                    emitSuguFilesUpdated();
                } catch (pdfErr: any) {
                    console.error("[SUGU] Failed to archive payroll PDF (continuing):", pdfErr?.message);
                }

                if (existingPayroll.length === 0) {
                    sendProgress("Création de la fiche de paie...");
                    await db.insert(suguPayroll).values({
                        employeeId,
                        period: parsed.period,
                        grossSalary: parsed.grossSalary,
                        netSalary: parsed.netSalary || 0,
                        socialCharges: parsed.socialCharges || 0,
                        employerCharges: parsed.employerCharges || null,
                        totalEmployerCost: parsed.totalEmployerCost || null,
                        bonus: parsed.bonus || 0,
                        overtime: parsed.overtime || 0,
                        isPaid: true,
                        paidDate: parsed.paymentDate || null,
                        pdfPath: pdfStoragePath,
                        notes: `Import PDF: ${fileName}`,
                    });
                    payrollCreated = true;
                    console.log(`[SUGU] Created payroll for employee ${employeeId}, period ${parsed.period}`);
                    emitSuguPayrollUpdated();
                } else {
                    if (pdfStoragePath && !existingPayroll[0].pdfPath) {
                        await db.update(suguPayroll).set({ pdfPath: pdfStoragePath }).where(eq(suguPayroll.id, existingPayroll[0].id));
                        emitSuguPayrollUpdated();
                    }
                    console.log(`[SUGU] Payroll already exists for employee ${employeeId}, period ${parsed.period} - skipping`);
                    result.warnings.push(`Fiche de paie déjà existante pour ${parsed.period}`);
                }
            }
        }

        const completeResult = {
            parsed: {
                employee: parsed.employee,
                period: parsed.period,
                grossSalary: parsed.grossSalary,
                netSalary: parsed.netSalary,
            },
            actions: { employeeCreated, employeeId, payrollCreated },
            confidence: result.confidence,
            source: result.source,
            warnings: result.warnings,
        };

        importStatusMap.set(importId, { status: "complete", result: completeResult, updatedAt: Date.now() });

        broadcastToUser(userId, {
            type: "sugu.payroll.import.complete",
            userId,
            data: { importId, fileName, ...completeResult },
            timestamp: Date.now(),
        });

        console.log(`[SUGU] Import ${importId} completed successfully`);
    } catch (error: any) {
        console.error(`[SUGU] Import ${importId} error:`, error?.message || error);
        importStatusMap.set(importId, { status: "error", error: error?.message || "Erreur interne", updatedAt: Date.now() });
        broadcastToUser(userId, {
            type: "sugu.payroll.import.error",
            userId,
            data: { importId, fileName, error: error?.message || "Erreur interne" },
            timestamp: Date.now(),
        });
    }
}

// POST /payroll/reparse-all — Re-parse all RH PDFs from storage and update payroll records
router.post("/payroll/reparse-all", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const { persistentStorageService } = await import("../../../services/persistentStorageService");
        
        const rhFiles = await db.select().from(suguFiles)
            .where(and(eq(suguFiles.category, "rh"), eq(suguFiles.fileType, "bulletin_paie")))
            .orderBy(suguFiles.id);

        if (rhFiles.length === 0) {
            const allRhFiles = await db.select().from(suguFiles)
                .where(eq(suguFiles.category, "rh"))
                .orderBy(suguFiles.id);
            if (allRhFiles.length === 0) {
                return res.json({ message: "No RH files found", results: [] });
            }
            // Use all RH files if none are tagged as bulletin_paie
            rhFiles.push(...allRhFiles.filter(f => f.originalName.toLowerCase().includes("bs ") || f.originalName.toLowerCase().includes("bulletin")));
        }

        console.log(`[SUGU] Reparse: Found ${rhFiles.length} payroll PDFs to re-parse`);
        const results: any[] = [];

        for (const file of rhFiles) {
            try {
                if (!file.storagePath) {
                    results.push({ fileId: file.id, fileName: file.originalName, status: "skipped", reason: "No storage path" });
                    continue;
                }
                
                const buffer = await persistentStorageService.downloadFile(file.storagePath);
                console.log(`[SUGU] Reparsing: ${file.originalName} (${buffer.length} bytes)`);
                
                const parsed = await parsePayrollPDF(buffer, file.originalName);
                
                if (!parsed.grossSalary || !parsed.netSalary) {
                    console.log(`[SUGU] Reparse: ${file.originalName} - no salary data (gross=${parsed.grossSalary}, net=${parsed.netSalary})`);
                    results.push({ fileId: file.id, fileName: file.originalName, status: "failed", reason: "Could not extract salary data", parsed });
                    continue;
                }

                const period = parsed.period || (() => {
                    const m = file.originalName.match(/(\d{2})(\d{2})\s/);
                    if (m) {
                        const month = parseInt(m[1]);
                        const yearSuffix = parseInt(m[2]);
                        const year = yearSuffix >= 50 ? 1900 + yearSuffix : 2000 + yearSuffix;
                        return `${year}-${String(month).padStart(2, '0')}`;
                    }
                    return null;
                })();

                if (!period) {
                    results.push({ fileId: file.id, fileName: file.originalName, status: "failed", reason: "Could not determine period", parsed });
                    continue;
                }

                let employeeId = file.employeeId;
                console.log(`[SUGU] Reparse: Processing ${file.originalName} - empId=${employeeId}, period=${period}, gross=${parsed.grossSalary}, net=${parsed.netSalary}`);
                
                if (employeeId) {
                    const empExists = await db.select({ id: suguEmployees.id }).from(suguEmployees).where(eq(suguEmployees.id, employeeId));
                    if (empExists.length === 0) {
                        console.log(`[SUGU] Reparse: File ${file.originalName} linked to deleted employee ${employeeId}, clearing`);
                        employeeId = null;
                        await db.update(suguFiles).set({ employeeId: null }).where(eq(suguFiles.id, file.id));
                    }
                }

                const existingEmps = await db.select().from(suguEmployees);
                const parsedSSN = parsed.employee?.socialSecurityNumber?.replace(/\s/g, "") || null;

                if (!employeeId && parsedSSN && parsedSSN.length >= 13) {
                    const ssnMatch = existingEmps.find(e => e.socialSecurityNumber && e.socialSecurityNumber.replace(/\s/g, "") === parsedSSN);
                    if (ssnMatch) {
                        employeeId = ssnMatch.id;
                        await db.update(suguFiles).set({ employeeId }).where(eq(suguFiles.id, file.id));
                        console.log(`[SUGU] Reparse: SSN match ${parsedSSN} → ${ssnMatch.firstName} ${ssnMatch.lastName} (id=${ssnMatch.id})`);
                    }
                }

                if (!employeeId && parsed.employee?.lastName) {
                    const pFirst = (parsed.employee?.firstName || "").toUpperCase().trim();
                    const pLast = (parsed.employee?.lastName || "").toUpperCase().trim();
                    const pFull = `${pFirst} ${pLast}`.trim();
                    const match = existingEmps.find(e => {
                        const eFirst = e.firstName.toUpperCase().trim();
                        const eLast = e.lastName.toUpperCase().trim();
                        const eFull = `${eFirst} ${eLast}`.trim();
                        if (eLast === pLast) return true;
                        if (eFirst === pFirst && eLast === pLast) return true;
                        if (eFirst === pLast && eLast === pFirst) return true;
                        if (eFull === pFull || eFull === `${pLast} ${pFirst}`.trim()) return true;
                        if (pFull.includes(eLast) && pFull.includes(eFirst)) return true;
                        if (eFull.includes(pLast) || pFull.includes(eLast)) return true;
                        return false;
                    });
                    if (match) {
                        employeeId = match.id;
                        await db.update(suguFiles).set({ employeeId }).where(eq(suguFiles.id, file.id));
                        console.log(`[SUGU] Reparse: Matched ${pFirst} ${pLast} to employee ${match.firstName} ${match.lastName} (id=${match.id})`);
                        if (parsedSSN && parsedSSN.length >= 13 && !match.socialSecurityNumber) {
                            await db.update(suguEmployees).set({ socialSecurityNumber: parsedSSN }).where(eq(suguEmployees.id, match.id));
                            console.log(`[SUGU] Reparse: Saved SSN ${parsedSSN} for employee ${match.id}`);
                        }
                    }
                }

                if (!employeeId && parsed.employee?.lastName && parsed.employee?.firstName) {
                    const [newEmp] = await db.insert(suguEmployees).values({
                        firstName: parsed.employee.firstName,
                        lastName: parsed.employee.lastName,
                        role: parsed.employee.role || "Non précisé",
                        contractType: (parsed.employee.contractType as any) || "CDI",
                        startDate: parsed.employee.startDate || null,
                        isActive: true,
                        socialSecurityNumber: parsedSSN,
                    }).returning();
                    employeeId = newEmp.id;
                    await db.update(suguFiles).set({ employeeId }).where(eq(suguFiles.id, file.id));
                    console.log(`[SUGU] Reparse: Created new employee from PDF: ${parsed.employee.lastName} ${parsed.employee.firstName} (id=${newEmp.id}) SSN=${parsedSSN || "N/A"}`);
                }

                if (!employeeId) {
                    console.log(`[SUGU] Reparse: No employee match for ${file.originalName} (parsed name: ${parsed.employee?.firstName} ${parsed.employee?.lastName})`);
                    results.push({ fileId: file.id, fileName: file.originalName, status: "failed", reason: "No employee match", parsed });
                    continue;
                }

                const existingPayroll = await db.select().from(suguPayroll)
                    .where(and(eq(suguPayroll.employeeId, employeeId), eq(suguPayroll.period, period)));
                
                const payrollData = {
                    grossSalary: parsed.grossSalary,
                    netSalary: parsed.netSalary,
                    socialCharges: parsed.socialCharges || null,
                    employerCharges: parsed.employerCharges || null,
                    totalEmployerCost: parsed.totalEmployerCost || null,
                    bonus: parsed.bonus || null,
                    overtime: parsed.overtime || null,
                    pdfStoragePath: String(file.id),
                };

                if (existingPayroll.length > 0) {
                    const old = existingPayroll[0];
                    await db.update(suguPayroll).set(payrollData).where(eq(suguPayroll.id, old.id));
                    const changed = old.grossSalary !== parsed.grossSalary || old.netSalary !== parsed.netSalary;
                    console.log(`[SUGU] Reparse: Updated payroll ${old.id} for emp ${employeeId} period ${period} (changed=${changed})`);
                    results.push({ 
                        fileId: file.id, fileName: file.originalName, status: "updated", 
                        employeeId, period,
                        old: { gross: old.grossSalary, net: old.netSalary, charges: old.socialCharges },
                        new: { gross: parsed.grossSalary, net: parsed.netSalary, charges: parsed.socialCharges },
                        changed
                    });
                } else {
                    await db.insert(suguPayroll).values({
                        employeeId,
                        period,
                        ...payrollData,
                    });
                    console.log(`[SUGU] Reparse: Created payroll for emp ${employeeId} period ${period} (net=${parsed.netSalary})`);
                    results.push({ 
                        fileId: file.id, fileName: file.originalName, status: "created", 
                        employeeId, period,
                        data: { gross: parsed.grossSalary, net: parsed.netSalary, charges: parsed.socialCharges }
                    });
                }
            } catch (err: any) {
                console.error(`[SUGU] Reparse error for ${file.originalName}:`, err?.message);
                results.push({ fileId: file.id, fileName: file.originalName, status: "error", error: err?.message });
            }
        }

        const updated = results.filter(r => r.status === "updated" && r.changed).length;
        const created = results.filter(r => r.status === "created").length;
        const failed = results.filter(r => r.status === "failed" || r.status === "error").length;
        
        console.log(`[SUGU] Reparse complete: ${updated} updated, ${created} created, ${failed} failed out of ${rhFiles.length} files`);
        res.json({ message: `Reparse complete`, total: rhFiles.length, updated, created, failed, results });
    } catch (error: any) {
        console.error("[SUGU] Error reparsing payrolls:", error?.message || error);
        res.status(500).json({ error: "Erreur serveur: " + (error?.message || "Unknown") });
    }
});

// Absences
router.get("/absences", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const employeeId = req.query.employeeId ? parseInt(req.query.employeeId as string) : undefined;
        let query = db.select().from(suguAbsences);
        if (employeeId) {
            query = query.where(eq(suguAbsences.employeeId, employeeId)) as any;
        }
        const data = await query.orderBy(desc(suguAbsences.startDate));
        res.json(data);
    } catch (error) {
        console.error("[SUGU] Error fetching absences:", error);
        res.status(500).json({ error: "Failed to fetch absences" });
    }
});

router.post("/absences", async (req: Request, res: Response) => {
    console.log("[SUGU] POST /absences body:", JSON.stringify(req.body));
    try {
        await tablesReady;
        let parsed: any;
        try {
            parsed = insertSuguAbsenceSchema.parse(req.body);
        } catch (zodErr: any) {
            console.error("[SUGU] Absence Zod validation failed:", zodErr?.issues || zodErr?.message || zodErr);
            const b = req.body || {};
            parsed = {
                employeeId: typeof b.employeeId === "number" ? b.employeeId : parseInt(b.employeeId) || 0,
                type: b.type || "conge",
                startDate: b.startDate || new Date().toISOString().substring(0, 10),
                endDate: b.endDate || null,
                duration: typeof b.duration === "number" ? b.duration : b.duration ? parseFloat(b.duration) : null,
                isApproved: b.isApproved === true || b.isApproved === "true",
                reason: b.reason || null,
                notes: b.notes || null,
            };
            console.log("[SUGU] Using manual fallback for absence:", JSON.stringify(parsed));
        }

        try {
            const [result] = await db.insert(suguAbsences).values(parsed).returning();
            console.log("[SUGU] Absence created via Drizzle:", result?.id);
            res.json(result);
            emitSuguAbsencesUpdated();
            return;
        } catch (drizzleErr: any) {
            console.error("[SUGU] Drizzle insert failed for absence:", drizzleErr?.message || drizzleErr);
            const result = await db.execute(sql`
                INSERT INTO sugu_absences (employee_id, type, start_date, end_date, duration, is_approved, reason, notes)
                VALUES (${parsed.employeeId}, ${parsed.type}, ${parsed.startDate}, ${parsed.endDate}, ${parsed.duration}, ${parsed.isApproved || false}, ${parsed.reason}, ${parsed.notes})
                RETURNING *
            `);
            const row = (result as any).rows?.[0] || (result as any)[0];
            console.log("[SUGU] Absence created via raw SQL:", row?.id);
            res.json(row);
            emitSuguAbsencesUpdated();
            return;
        }
    } catch (error: any) {
        console.error("[SUGU] FATAL Error creating absence:", error?.message || error);
        res.status(500).json({ error: "Erreur serveur: " + (error?.message || "Unknown") });
    }
});

router.delete("/absences/:id", async (req: Request, res: Response) => {
    try {
        await tablesReady;
        const id = parseInt(req.params.id);
        await db.delete(suguAbsences).where(eq(suguAbsences.id, id));
        res.json({ success: true });
        emitSuguAbsencesUpdated();
    } catch (error) {
        console.error("[SUGU] Error deleting absence:", error);
        res.status(500).json({ error: "Failed to delete absence" });
    }
});


export default router;
