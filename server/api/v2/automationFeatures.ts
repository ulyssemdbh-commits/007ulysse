import { Router, Request, Response } from "express";
import { morningBriefingService } from "../../services/morningBriefingService";
import { telegramBotService } from "../../services/telegramBotService";
import { documentVisionService } from "../../services/documentVisionService";
import { reportGeneratorService } from "../../services/reportGeneratorService";
import { bankStatementImportService } from "../../services/bankStatementImportService";

const router = Router();

router.post("/briefing/generate", async (req: Request, res: Response) => {
  try {
    const briefing = await morningBriefingService.generateBriefing();
    res.json({ success: true, briefing });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/briefing/send", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    const result = await morningBriefingService.sendBriefingEmail(email);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/briefing/last", (req: Request, res: Response) => {
  const briefing = morningBriefingService.getLastBriefing();
  res.json({ success: true, briefing });
});

router.get("/briefing/config", (req: Request, res: Response) => {
  res.json({ success: true, config: morningBriefingService.getBriefingConfig() });
});

router.put("/briefing/config", (req: Request, res: Response) => {
  const config = morningBriefingService.updateBriefingConfig(req.body);
  res.json({ success: true, config });
});

router.post("/telegram/init", async (req: Request, res: Response) => {
  try {
    const result = await telegramBotService.init();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/telegram/webhook/set", async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    const result = await telegramBotService.setWebhook(url);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/telegram/webhook", async (req: Request, res: Response) => {
  try {
    const result = await telegramBotService.removeWebhook();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/telegram/status", (req: Request, res: Response) => {
  res.json({ success: true, ...telegramBotService.getStatus() });
});

router.post("/telegram/send", async (req: Request, res: Response) => {
  try {
    const { chatId, text } = req.body;
    const result = await telegramBotService.sendMessage(chatId, text);
    res.json({ success: true, result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/telegram/allowed-chats", (req: Request, res: Response) => {
  const { chatId } = req.body;
  telegramBotService.addAllowedChat(chatId);
  res.json({ success: true });
});

router.delete("/telegram/allowed-chats/:chatId", (req: Request, res: Response) => {
  telegramBotService.removeAllowedChat(Number(req.params.chatId));
  res.json({ success: true });
});

router.post("/document-vision/analyze", async (req: Request, res: Response) => {
  try {
    const { imageBase64, mimeType, context } = req.body;
    if (!imageBase64) return res.status(400).json({ error: "imageBase64 required" });
    const result = await documentVisionService.analyzeDocumentImage(imageBase64, mimeType, context);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/document-vision/analyze-and-file", async (req: Request, res: Response) => {
  try {
    const { imageBase64, mimeType, restaurant, fileAs } = req.body;
    if (!imageBase64 || !restaurant) return res.status(400).json({ error: "imageBase64 and restaurant required" });
    const result = await documentVisionService.analyzeAndAutoFile(imageBase64, mimeType, restaurant, fileAs);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/document-vision/batch", async (req: Request, res: Response) => {
  try {
    const { documents } = req.body;
    if (!documents || !Array.isArray(documents)) return res.status(400).json({ error: "documents array required" });
    const result = await documentVisionService.analyzeMultipleDocuments(documents);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/reports/generate", async (req: Request, res: Response) => {
  try {
    const { restaurant, periodType, customStart, customEnd } = req.body;
    const report = await reportGeneratorService.generateReport(
      restaurant || "both",
      periodType || "month",
      customStart,
      customEnd
    );
    res.json({ success: true, report: { data: report.data, generatedAt: report.generatedAt } });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/reports/generate-html", async (req: Request, res: Response) => {
  try {
    const { restaurant, periodType, customStart, customEnd } = req.body;
    const report = await reportGeneratorService.generateReport(
      restaurant || "both",
      periodType || "month",
      customStart,
      customEnd
    );
    res.setHeader("Content-Type", "text/html");
    res.send(report.html);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/reports/email", async (req: Request, res: Response) => {
  try {
    const { restaurant, periodType, email, customStart, customEnd } = req.body;
    if (!email) return res.status(400).json({ error: "email required" });
    const result = await reportGeneratorService.generateAndEmailReport(
      restaurant || "both",
      periodType || "month",
      email,
      customStart,
      customEnd
    );
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/reports/schedule", (req: Request, res: Response) => {
  res.json({ success: true, schedule: reportGeneratorService.getReportSchedule() });
});

router.put("/reports/schedule", (req: Request, res: Response) => {
  const schedule = reportGeneratorService.updateReportSchedule(req.body);
  res.json({ success: true, schedule });
});

router.post("/bank-import/parse-csv", async (req: Request, res: Response) => {
  try {
    const { csvContent, restaurant } = req.body;
    if (!csvContent || !restaurant) return res.status(400).json({ error: "csvContent and restaurant required" });
    let preview = await bankStatementImportService.parseCSV(csvContent, restaurant);
    if (req.body.enhanceWithAI !== false) {
      preview = await bankStatementImportService.enhanceWithAI(preview);
    }
    res.json({ success: true, preview });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/bank-import/parse-pdf", async (req: Request, res: Response) => {
  try {
    const { base64Content, restaurant } = req.body;
    if (!base64Content || !restaurant) return res.status(400).json({ error: "base64Content and restaurant required" });
    let preview = await bankStatementImportService.parsePDF(base64Content, restaurant);
    if (req.body.enhanceWithAI !== false) {
      preview = await bankStatementImportService.enhanceWithAI(preview);
    }
    res.json({ success: true, preview });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/bank-import/confirm", async (req: Request, res: Response) => {
  try {
    const { preview, selectedIndices } = req.body;
    if (!preview) return res.status(400).json({ error: "preview required" });
    const result = await bankStatementImportService.confirmImport(preview, selectedIndices);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
