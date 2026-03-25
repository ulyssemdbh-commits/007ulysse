import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { fileService } from "../services/fileService";
import { persistentStorageService } from "../services/persistentStorageService";
import * as videoAnalysisService from "../services/videoAnalysisService";
import { validateVideoPathWithOwnership } from "../services/fileOwnershipService";
import { agentMailService } from "../services/agentMailService";
import { emitFilesUpdated } from "../services/realtimeSync";
import OpenAI from "openai";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = Router();

function getUserId(req: Request): number {
  const userId = (req.session as any)?.userId;
  if (!userId) {
    throw new Error("User not authenticated");
  }
  return userId;
}

const fileUpload = multer({
  storage: multer.diskStorage({
    destination: "uploads/",
    filename: (req, file, cb) => {
      const uniqueName = `${Date.now()}-${file.originalname}`;
      cb(null, uniqueName);
    }
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB for videos
  fileFilter: (req, file, cb) => {
    const allowed = [".pdf", ".docx", ".doc", ".xlsx", ".xls", ".zip", ".txt", ".csv", ".json", ".xml", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".mp4", ".webm", ".mov", ".avi", ".mkv"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Type de fichier non supporté: ${ext}`));
    }
  }
});

const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: "media_library/",
    filename: (req, file, cb) => {
      const uniqueName = `${Date.now()}-${file.originalname}`;
      cb(null, uniqueName);
    }
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB for videos
  fileFilter: (req, file, cb) => {
    const allowedImages = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif"];
    const allowedVideos = [".mp4", ".mov", ".webm", ".avi", ".mkv"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedImages.includes(ext) || allowedVideos.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Type de fichier non supporté: ${ext}`));
    }
  }
});

const audioTranslateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB for audio
  fileFilter: (req, file, cb) => {
    const allowed = [".mp3", ".wav", ".webm", ".m4a", ".ogg", ".flac", ".mp4"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext) || file.mimetype.startsWith("audio/") || file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error(`Type de fichier audio non supporté: ${ext}`));
    }
  }
});

// Ulysse Generated Files API
router.get("/files", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const files = await storage.getUlysseFiles(userId);
    res.json(files);
  } catch (err) {
    console.error("Failed to get files:", err);
    res.status(500).json({ message: "Failed to get files" });
  }
});

router.get("/files/:id/download", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const fileId = Number(req.params.id);
    const file = await storage.getUlysseFile(fileId, userId);
    
    if (!file) {
      return res.status(404).json({ message: "File not found" });
    }

    if (file.storagePath.startsWith('/replit-objstore-') || file.storagePath.includes('replit-objstore') || file.storagePath.startsWith('/ulysse-files/')) {
      await persistentStorageService.streamFile(
        file.storagePath,
        res,
        file.originalName,
        file.mimeType || undefined
      );
      return;
    }

    const fs = await import("fs");
    const path = await import("path");
    
    let filePath = file.storagePath;
    if (!path.isAbsolute(filePath)) {
      filePath = path.join(process.cwd(), filePath);
    }
    
    if (!fs.existsSync(filePath)) {
      const fallbackPath = path.join(process.cwd(), "generated_files", file.filename || file.originalName);
      if (fs.existsSync(fallbackPath)) {
        filePath = fallbackPath;
      } else {
        try {
          await persistentStorageService.streamFile(
            file.storagePath,
            res,
            file.originalName,
            file.mimeType || undefined
          );
          return;
        } catch {
          console.error(`[FileDownload] File not found anywhere: ${file.storagePath}`);
          return res.status(404).json({ message: "File not found on disk" });
        }
      }
    }

    const stat = fs.statSync(filePath);
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.originalName)}"`);
    res.setHeader("Content-Length", stat.size);
    
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err) {
    console.error("Failed to download file:", err);
    res.status(500).json({ message: "Failed to download file" });
  }
});

router.get("/files/:id/versions", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const fileId = Number(req.params.id);
    const file = await storage.getUlysseFile(fileId, userId);
    if (!file) return res.status(404).json({ message: "File not found" });
    
    const rootId = file.parentFileId || file.id;
    const allFiles = await storage.getUlysseFiles(userId);
    const versions = allFiles.filter(f => 
      f.id === rootId || f.parentFileId === rootId
    ).sort((a, b) => a.version - b.version);
    
    res.json(versions);
  } catch (err) {
    console.error("Failed to get file versions:", err);
    res.status(500).json({ message: "Failed to get file versions" });
  }
});

router.patch("/files/:id/label", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const fileId = Number(req.params.id);
    const { label } = req.body;
    const file = await storage.getUlysseFile(fileId, userId);
    if (!file) return res.status(404).json({ message: "File not found" });
    
    await storage.updateUlysseFileLabel(fileId, label || null);
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to update file label:", err);
    res.status(500).json({ message: "Failed to update label" });
  }
});

router.post("/files/:id/edit", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const fileId = Number(req.params.id);
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ message: "Prompt required" });
    
    const file = await storage.getUlysseFile(fileId, userId);
    if (!file) return res.status(404).json({ message: "File not found" });
    
    const isImage = file.mimeType.startsWith("image/");
    
    if (isImage) {
      const openai = new OpenAI();
      
      let imageBuffer: Buffer;
      if (file.storagePath.startsWith('/replit-objstore-') || file.storagePath.includes('replit-objstore') || file.storagePath.startsWith('/ulysse-files/')) {
        imageBuffer = await persistentStorageService.downloadFile(file.storagePath);
      } else {
        let filePath = file.storagePath;
        if (!path.isAbsolute(filePath)) filePath = path.join(process.cwd(), filePath);
        if (!fs.existsSync(filePath)) {
          imageBuffer = await persistentStorageService.downloadFile(file.storagePath);
        } else {
          imageBuffer = fs.readFileSync(filePath);
        }
      }
      
      const pngBuffer = imageBuffer;
      const imageFile = new File([pngBuffer], "image.png", { type: "image/png" });
      
      const result = await openai.images.edit({
        model: "gpt-image-1",
        image: imageFile,
        prompt: prompt,
        size: "1024x1024",
      });
      
      const b64 = result.data?.[0]?.b64_json;
      if (!b64) throw new Error("No image data returned");
      
      const editedBuffer = Buffer.from(b64, "base64");
      const rootId = file.parentFileId || file.id;
      const allFiles = await storage.getUlysseFiles(userId);
      const versionCount = allFiles.filter(f => f.id === rootId || f.parentFileId === rootId).length;
      const newVersion = versionCount + 1;
      
      const newFilename = `studio_v${newVersion}_${Date.now()}.png`;
      const stored = await persistentStorageService.uploadBuffer(
        editedBuffer, newFilename, "generated", userId
      );
      const storagePath = stored.objectPath;
      
      const newFile = await storage.createUlysseFile({
        userId,
        filename: newFilename,
        originalName: `${file.originalName.replace(/\.[^.]+$/, '')}_v${newVersion}.png`,
        mimeType: "image/png",
        sizeBytes: editedBuffer.length,
        storagePath,
        description: `Edited: ${prompt}`,
        generatedBy: "ulysse",
        category: "generated",
        parentFileId: rootId,
        version: newVersion,
        editPrompt: prompt,
      });
      
      emitFilesUpdated(userId);
      
      const dataUrl = `data:image/png;base64,${b64}`;
      res.json({ file: newFile, dataUrl, version: newVersion });
    } else {
      res.status(400).json({ message: "Only image editing is supported in Studio for now" });
    }
  } catch (err: any) {
    console.error("Failed to edit file:", err);
    res.status(500).json({ message: err.message || "Failed to edit file" });
  }
});

router.get("/files/:id/preview", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const fileId = Number(req.params.id);
    const file = await storage.getUlysseFile(fileId, userId);
    if (!file) return res.status(404).json({ message: "File not found" });
    
    if (file.storagePath.startsWith('/replit-objstore-') || file.storagePath.includes('replit-objstore') || file.storagePath.startsWith('/ulysse-files/')) {
      res.setHeader("Cache-Control", "public, max-age=3600");
      await persistentStorageService.streamFile(
        file.storagePath, res, file.originalName, file.mimeType || undefined
      );
      return;
    }
    
    let filePath = file.storagePath;
    if (!path.isAbsolute(filePath)) {
      filePath = path.join(process.cwd(), filePath);
    }
    if (!fs.existsSync(filePath)) {
      const fallbackPath = path.join(process.cwd(), "generated_files", file.filename || file.originalName);
      if (fs.existsSync(fallbackPath)) {
        filePath = fallbackPath;
      } else {
        try {
          res.setHeader("Cache-Control", "public, max-age=3600");
          await persistentStorageService.streamFile(
            file.storagePath, res, file.originalName, file.mimeType || undefined
          );
          return;
        } catch {
          console.error(`[FilePreview] File not found anywhere: ${file.storagePath}`);
          return res.status(404).json({ message: "File not found on disk" });
        }
      }
    }
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error("Failed to preview file:", err);
    res.status(500).json({ message: "Failed to preview file" });
  }
});

router.delete("/files/:id", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const fileId = Number(req.params.id);
    const file = await storage.getUlysseFile(fileId, userId);
    
    if (!file) {
      return res.status(404).json({ message: "File not found" });
    }

    const fs = await import("fs");
    const path = await import("path");
    
    if (file.storagePath.startsWith('/ulysse-files/') || file.storagePath.startsWith('/replit-objstore-') || file.storagePath.includes('replit-objstore')) {
      try { await persistentStorageService.deleteFile(file.storagePath); } catch {}
    } else {
      let filePath = file.storagePath;
      if (!path.isAbsolute(filePath)) filePath = path.join(process.cwd(), filePath);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    
    await storage.deleteUlysseFile(fileId, userId);
    emitFilesUpdated(userId);
    res.status(204).send();
  } catch (err) {
    console.error("Failed to delete file:", err);
    res.status(500).json({ message: "Failed to delete file" });
  }
});

// File upload
router.post("/files/upload", (req, res, next) => {
  console.log(`[UPLOAD] Request received: content-type=${req.headers['content-type']}, content-length=${req.headers['content-length']}`);
  next();
}, requireAuth, (req, res, next) => {
  fileUpload.single("file")(req, res, (err) => {
    if (err) {
      console.error("[UPLOAD] Multer error:", err.message);
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ message: "Fichier trop volumineux (max 100 MB)" });
      }
      return res.status(400).json({ message: err.message || "Erreur lors de l'upload" });
    }
    next();
  });
}, async (req, res) => {
  try {
    console.log(`[UPLOAD] Received file: ${req.file?.originalname || 'none'} (${req.file?.size || 0} bytes)`);
    if (!req.file) {
      return res.status(400).json({ message: "Aucun fichier fourni" });
    }
    
    const userId = getUserId(req);
    
    // RULE: Always reprocess invoice PDFs, skip duplicates for other files
    const existingFiles = await storage.getUlysseFiles(userId);
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    const isInvoicePdf = fileExt === '.pdf' && /facture|invoice|zouaghi|metro|promocash/i.test(req.file.originalname);
    
    const isDuplicate = existingFiles.some(f => 
      f.originalName === req.file!.originalname && 
      f.sizeBytes === req.file!.size &&
      f.category === 'received'
    );
    
    if (isDuplicate && !isInvoicePdf) {
      // Return the existing file instead of creating a duplicate (but NOT for invoice PDFs)
      const existingFile = existingFiles.find(f => 
        f.originalName === req.file!.originalname && 
        f.sizeBytes === req.file!.size
      );
      console.log(`[UPLOAD] Skipping duplicate file: ${req.file.originalname} (already exists)`);
      
      // Still analyze the file for AI context
      const analysis = await fileService.readFile(req.file.path);
      
      return res.json({
        success: true,
        analysis,
        file: existingFile,
        filePath: req.file.path,
        duplicate: true
      });
    }
    
    if (isDuplicate && isInvoicePdf) {
      console.log(`[UPLOAD] Reprocessing invoice PDF: ${req.file.originalname} (forced re-extraction)`);
    }
    
    let analysis = await fileService.readFile(req.file.path);
    
    // For video files, perform deep analysis with GPT-4V and Whisper
    const videoExtensions = [".mp4", ".webm", ".mov", ".avi", ".mkv"];
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (videoExtensions.includes(ext)) {
      try {
        const openai = new OpenAI({
          apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
          baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
        });
        
        console.log(`[VIDEO_UPLOAD] Starting deep analysis for ${req.file.originalname}`);
        const videoAnalysis = await videoAnalysisService.analyzeVideo(
          req.file.path,
          userId,
          openai,
          { maxFrames: 10, transcribeAudio: true, intervalSeconds: 5 }
        );
        
        // Enhance the analysis with video-specific data
        analysis.content = videoAnalysis.summary;
        analysis.metadata = {
          ...analysis.metadata,
          videoAnalysis: {
            duration: videoAnalysis.metadata.duration,
            resolution: `${videoAnalysis.metadata.width}x${videoAnalysis.metadata.height}`,
            hasAudio: videoAnalysis.metadata.hasAudio,
            frameCount: videoAnalysis.frames.length,
            transcriptLength: videoAnalysis.transcript.length,
            keyMoments: videoAnalysis.keyMoments.slice(0, 5),
            facesDetected: videoAnalysis.facesDetected.length,
            processingTimeMs: videoAnalysis.processingTimeMs,
          },
          fullTranscript: videoAnalysis.transcript.map(s => s.text).join(" "),
          frameDescriptions: videoAnalysis.frames.map(f => ({
            timestamp: f.timestamp,
            description: f.description,
            objects: f.objects,
          })),
        };
        
        console.log(`[VIDEO_UPLOAD] Analysis complete: ${videoAnalysis.frames.length} frames, ${videoAnalysis.transcript.length} transcript segments`);
      } catch (videoErr) {
        console.error("[VIDEO_UPLOAD] Deep analysis failed, using basic analysis:", videoErr);
      }
    }
    
    // Create a content summary for AI context (first 500 chars of content)
    const contentSummary = analysis?.content 
      ? analysis.content.slice(0, 500).replace(/\n+/g, ' ').trim()
      : req.body.description || "Fichier envoye par l'utilisateur";
    
    // Upload to permanent Object Storage for persistence across republishes
    let permanentPath = `uploads/${req.file.filename}`;
    try {
      const stored = await persistentStorageService.uploadFile(
        req.file.path,
        "received",
        userId
      );
      permanentPath = stored.objectPath;
      console.log(`[STORAGE] File uploaded to permanent storage: ${permanentPath}`);
    } catch (storageErr) {
      console.warn("[STORAGE] Failed to upload to permanent storage, using local:", storageErr);
    }
    
    // Save to database as "received" file with content summary
    const savedFile = await storage.createUlysseFile({
      userId,
      filename: req.file.filename,
      originalName: req.file.originalname,
      storagePath: permanentPath,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      description: contentSummary,
      category: "received",
    });
    
    emitFilesUpdated(userId);
    res.json({
      success: true,
      analysis,
      file: savedFile,
      filePath: req.file.path
    });
  } catch (err: any) {
    console.error("File upload error:", err);
    res.status(500).json({ message: err.message || "Erreur lors de l'analyse du fichier" });
  }
});

// Generate PDF
router.post("/files/generate/pdf", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { content, title } = req.body;
    if (!content) {
      return res.status(400).json({ message: "Contenu requis" });
    }
    
    const file = await fileService.generatePDF(content, { title });
    emitFilesUpdated(userId);
    res.json({ success: true, file });
  } catch (err: any) {
    console.error("PDF generation error:", err);
    res.status(500).json({ message: err.message || "Erreur lors de la génération du PDF" });
  }
});

// Generate Word document
router.post("/files/generate/word", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { content, title } = req.body;
    if (!content) {
      return res.status(400).json({ message: "Contenu requis" });
    }
    
    const file = await fileService.generateWord(content, { title });
    emitFilesUpdated(userId);
    res.json({ success: true, file });
  } catch (err: any) {
    console.error("Word generation error:", err);
    res.status(500).json({ message: err.message || "Erreur lors de la génération du document Word" });
  }
});

// Generate Excel file
router.post("/files/generate/excel", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { data, headers, sheetName } = req.body;
    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ message: "Données requises (tableau)" });
    }
    
    const file = await fileService.generateExcel(data, { headers, sheetName });
    emitFilesUpdated(userId);
    res.json({ success: true, file });
  } catch (err: any) {
    console.error("Excel generation error:", err);
    res.status(500).json({ message: err.message || "Erreur lors de la génération du fichier Excel" });
  }
});

// Generate ZIP archive
router.post("/files/generate/zip", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { files, title } = req.body;
    if (!files || !Array.isArray(files)) {
      return res.status(400).json({ message: "Fichiers requis (tableau avec name et content)" });
    }
    
    const file = await fileService.generateZip(files, { title });
    emitFilesUpdated(userId);
    res.json({ success: true, file });
  } catch (err: any) {
    console.error("ZIP generation error:", err);
    res.status(500).json({ message: err.message || "Erreur lors de la création de l'archive" });
  }
});

// Analyze video file in depth (secure - validates path with ownership)
router.post("/files/analyze-video", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { videoPath, options } = req.body;
    
    if (!videoPath) {
      return res.status(400).json({ message: "Chemin vidéo requis" });
    }
    
    // Security: Validate path with ownership check to prevent traversal and cross-user access
    const validation = await validateVideoPathWithOwnership(videoPath, userId);
    if (!validation.valid) {
      console.warn(`[VIDEO_ANALYSIS] Path validation failed for user ${userId}: ${videoPath} - ${validation.error}`);
      return res.status(403).json({ message: validation.error });
    }
    
    const openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
    
    console.log(`[VIDEO_ANALYSIS] Starting analysis for user ${userId}: ${validation.resolvedPath}`);
    
    const analysisResult = await videoAnalysisService.analyzeVideo(
      validation.resolvedPath,
      userId,
      openai,
      {
        maxFrames: options?.maxFrames || 15,
        transcribeAudio: options?.transcribeAudio !== false,
        detectFaces: options?.detectFaces !== false,
        intervalSeconds: options?.intervalSeconds || 3,
      }
    );
    
    console.log(`[VIDEO_ANALYSIS] Complete in ${analysisResult.processingTimeMs}ms`);
    
    res.json({
      success: true,
      analysis: analysisResult,
    });
  } catch (err: any) {
    console.error("Video analysis error:", err);
    res.status(500).json({ message: err.message || "Erreur lors de l'analyse vidéo" });
  }
});

// Get quick video preview (thumbnail + metadata) - secure
router.post("/files/video-preview", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { videoPath } = req.body;
    
    if (!videoPath) {
      return res.status(400).json({ message: "Chemin vidéo requis" });
    }
    
    // Security: Validate path with ownership check
    const validation = await validateVideoPathWithOwnership(videoPath, userId);
    if (!validation.valid) {
      return res.status(403).json({ message: validation.error });
    }
    
    const openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
    
    const preview = await videoAnalysisService.getQuickVideoPreview(validation.resolvedPath, openai);
    
    res.json({
      success: true,
      preview,
    });
  } catch (err: any) {
    console.error("Video preview error:", err);
    res.status(500).json({ message: err.message || "Erreur lors de la prévisualisation" });
  }
});

// Audio Translation Pipeline - Audio → Transcription → Translation → TTS
router.post("/audio/translate", requireAuth, audioTranslateUpload.single("audio"), async (req, res) => {
  try {
    const userId = getUserId(req);
    const { audioTranslateService } = await import("../services/audioTranslateService");
    
    const {
      targetLang = "fr",
      sourceLang = "auto",
      domain = "general",
      tone = "neutral",
      generateAudio = "true",
      fileId,
    } = req.body;

    let result;
    
    if (req.file) {
      result = await audioTranslateService.translateAudio({
        userId,
        audioBuffer: req.file.buffer,
        audioMimeType: req.file.mimetype,
        targetLang,
        sourceLang,
        domain,
        tone,
        generateAudio: generateAudio === "true" || generateAudio === true,
      });
    } else if (fileId) {
      result = await audioTranslateService.translateAudio({
        userId,
        fileId: parseInt(fileId),
        targetLang,
        sourceLang,
        domain,
        tone,
        generateAudio: generateAudio === "true" || generateAudio === true,
      });
    } else {
      return res.status(400).json({ error: "Fichier audio ou fileId requis" });
    }

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    if (result.audioBuffer) {
      res.json({
        success: true,
        sourceLang: result.sourceLang,
        targetLang: result.targetLang,
        originalTranscript: result.originalTranscript,
        translatedTranscript: result.translatedTranscript,
        audioFileId: result.audioFileId,
        audioBase64: result.audioBuffer.toString("base64"),
        metadata: result.metadata,
      });
    } else {
      res.json({
        success: true,
        sourceLang: result.sourceLang,
        targetLang: result.targetLang,
        originalTranscript: result.originalTranscript,
        translatedTranscript: result.translatedTranscript,
        metadata: result.metadata,
      });
    }
  } catch (err: any) {
    console.error("[AudioTranslate] Route error:", err);
    res.status(500).json({ error: err.message || "Erreur lors de la traduction audio" });
  }
});

// Download generated file (whitelist-based security)
router.get("/files/download/:filename", requireAuth, (req, res) => {
  try {
    const { filename } = req.params;
    
    const generatedFiles = fileService.getGeneratedFiles();
    const matchingFile = generatedFiles.find(f => f.fileName === filename);
    
    if (!matchingFile) {
      return res.status(404).json({ message: "Fichier non trouvé" });
    }
    
    res.download(matchingFile.filePath, matchingFile.fileName);
  } catch (err: any) {
    console.error("Download error:", err);
    res.status(500).json({ message: err.message || "Erreur lors du téléchargement" });
  }
});

// Download file from permanent Object Storage (by file ID) - uses streaming for large files
router.get("/storage/download/:fileId", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const fileId = parseInt(req.params.fileId);
    
    if (isNaN(fileId)) {
      return res.status(400).json({ message: "ID de fichier invalide" });
    }
    
    // Get file metadata from database
    const files = await storage.getUlysseFiles(userId);
    const file = files.find(f => f.id === fileId);
    
    if (!file) {
      return res.status(404).json({ message: "Fichier non trouve" });
    }
    
    // Validate path - prevent path traversal attacks
    if (file.storagePath.includes("..")) {
      return res.status(400).json({ message: "Chemin invalide" });
    }
    
    // Check if file is in Object Storage (path starts with /)
    if (file.storagePath.startsWith("/")) {
      // Stream from Object Storage (memory-efficient for large files)
      await persistentStorageService.streamFile(
        file.storagePath,
        res,
        file.originalName,
        file.mimeType || undefined
      );
    } else {
      // Fallback to local file
      const localPath = path.join(process.cwd(), file.storagePath);
      const fs = require("fs");
      if (fs.existsSync(localPath)) {
        res.download(localPath, file.originalName);
      } else {
        return res.status(404).json({ message: "Fichier non trouve sur le disque" });
      }
    }
  } catch (err: any) {
    console.error("Storage download error:", err);
    if (!res.headersSent) {
      res.status(500).json({ message: err.message || "Erreur lors du telechargement" });
    }
  }
});

// Download Ulysse file by storage path (for chat card links)
router.get("/ulysse-files/download", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const storagePath = req.query.path as string;
    
    if (!storagePath) {
      return res.status(400).json({ message: "Chemin de fichier requis" });
    }
    
    // Security: Validate path - prevent path traversal and ensure user owns the file
    if (storagePath.includes("..")) {
      return res.status(400).json({ message: "Chemin invalide" });
    }
    
    // Verify file belongs to user by checking database
    const files = await storage.getUlysseFiles(userId);
    const file = files.find(f => f.storagePath === storagePath);
    
    if (!file) {
      return res.status(404).json({ message: "Fichier non trouvé ou accès refusé" });
    }
    
    // Stream from Object Storage
    await persistentStorageService.streamFile(
      storagePath,
      res,
      file.originalName,
      file.mimeType || undefined
    );
  } catch (err: any) {
    console.error("Ulysse file download error:", err);
    if (!res.headersSent) {
      res.status(500).json({ message: err.message || "Erreur lors du téléchargement" });
    }
  }
});

// List generated files
router.get("/files/generated", requireAuth, (req, res) => {
  try {
    const files = fileService.getGeneratedFiles();
    res.json({ files });
  } catch (err: any) {
    console.error("List files error:", err);
    res.status(500).json({ message: err.message || "Erreur lors de la liste des fichiers" });
  }
});

// Delete generated file (whitelist-based security)
router.delete("/files/generated/:filename", requireAuth, (req, res) => {
  try {
    const userId = getUserId(req);
    const { filename } = req.params;
    
    const generatedFiles = fileService.getGeneratedFiles();
    const matchingFile = generatedFiles.find(f => f.fileName === filename);
    
    if (!matchingFile) {
      return res.status(404).json({ message: "Fichier non trouvé" });
    }
    
    const deleted = fileService.deleteGeneratedFile(matchingFile.fileName);
    
    if (!deleted) {
      return res.status(404).json({ message: "Fichier non trouvé" });
    }
    
    emitFilesUpdated(userId);
    res.json({ success: true, message: "Fichier supprimé" });
  } catch (err: any) {
    console.error("Delete file error:", err);
    res.status(500).json({ message: err.message || "Erreur lors de la suppression" });
  }
});

// Sync all files: local generated files + AgentMail emails with attachments
router.post("/files/sync", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const fs = await import("fs");
    const path = await import("path");
    
    let syncedCount = 0;
    let emailResult: { newEmails: number; processed: number; attachmentsDownloaded: number; summary?: string } = { newEmails: 0, processed: 0, attachmentsDownloaded: 0, summary: "" };
    
    // 1. Sync local generated files to database
    const generatedDir = path.join(process.cwd(), "generated_files");
    
    if (fs.existsSync(generatedDir)) {
      const filesOnDisk = fs.readdirSync(generatedDir);
      const existingFiles = await storage.getUlysseFiles(userId);
      const existingPaths = new Set(existingFiles.map(f => f.storagePath));
      
      for (const fileName of filesOnDisk) {
        const storagePath = `generated_files/${fileName}`;
        
        if (existingPaths.has(storagePath)) {
          continue;
        }
        
        const filePath = path.join(generatedDir, fileName);
        const stats = fs.statSync(filePath);
        
        let mimeType = "application/octet-stream";
        if (fileName.endsWith(".pdf")) mimeType = "application/pdf";
        else if (fileName.endsWith(".docx")) mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        else if (fileName.endsWith(".xlsx")) mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        else if (fileName.endsWith(".zip")) mimeType = "application/zip";
        
        await storage.createUlysseFile({
          userId,
          filename: fileName,
          originalName: fileName,
          storagePath,
          mimeType,
          sizeBytes: stats.size,
          description: "Fichier synchronise depuis le systeme",
          category: "generated",
        });
        
        syncedCount++;
      }
    }
    
    // 2. Fetch emails from AgentMail (this also downloads attachments to ulysseFiles)
    try {
      emailResult = await agentMailService.fetchAndStoreEmails();
      console.log(`[SYNC] AgentMail fetch: ${emailResult.newEmails} new emails`);
    } catch (emailErr: any) {
      console.warn("[SYNC] AgentMail fetch failed:", emailErr.message);
      // Continue - local sync is still valuable
    }
    
    // Notify frontend of updates
    emitFilesUpdated(userId);
    
    res.json({ 
      synced: syncedCount, 
      emailsProcessed: emailResult.processed,
      newEmails: emailResult.newEmails,
      attachmentsDownloaded: emailResult.attachmentsDownloaded,
      message: `${syncedCount} fichier(s) local, ${emailResult.newEmails} email(s), ${emailResult.attachmentsDownloaded} pièce(s) jointe(s)`
    });
  } catch (err: any) {
    console.error("Sync files error:", err);
    res.status(500).json({ message: err.message || "Erreur lors de la synchronisation" });
  }
});

// ==================== MEDIA LIBRARY (Camera Captures) ====================

// Upload media (photo/video from camera)
router.post("/media/upload", requireAuth, mediaUpload.single("media"), async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!req.file) {
      return res.status(400).json({ message: "Aucun fichier fourni" });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const isVideo = [".mp4", ".mov", ".webm", ".avi", ".mkv"].includes(ext);
    const type = isVideo ? "video" : "photo";

    const media = await storage.createMedia({
      userId,
      type,
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      storagePath: `media_library/${req.file.filename}`,
      description: req.body.description || null,
      tags: req.body.tags ? JSON.parse(req.body.tags) : [],
    });

    res.json({ success: true, media });
  } catch (err: any) {
    console.error("Media upload error:", err);
    res.status(500).json({ message: err.message || "Erreur lors de l'upload du média" });
  }
});

// List media library
router.get("/media", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const type = req.query.type as string | undefined;
    const media = await storage.getMedia(userId, type);
    res.json({ media });
  } catch (err: any) {
    console.error("List media error:", err);
    res.status(500).json({ message: err.message || "Erreur lors de la liste des médias" });
  }
});

// Get single media item
router.get("/media/:id", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const id = parseInt(req.params.id);
    const media = await storage.getMediaById(id);
    
    if (!media || media.userId !== userId) {
      return res.status(404).json({ message: "Média non trouvé" });
    }
    
    res.json({ media });
  } catch (err: any) {
    console.error("Get media error:", err);
    res.status(500).json({ message: err.message || "Erreur" });
  }
});

// Serve media file
router.get("/media/file/:filename", requireAuth, (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(process.cwd(), "media_library", filename);
    res.sendFile(filePath);
  } catch (err: any) {
    console.error("Serve media error:", err);
    res.status(500).json({ message: "Erreur" });
  }
});

// Toggle favorite
router.patch("/media/:id/favorite", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const id = parseInt(req.params.id);
    const media = await storage.toggleMediaFavorite(id, userId);
    
    if (!media) {
      return res.status(404).json({ message: "Média non trouvé" });
    }
    
    res.json({ success: true, media });
  } catch (err: any) {
    console.error("Toggle favorite error:", err);
    res.status(500).json({ message: err.message || "Erreur" });
  }
});

// Delete media
router.delete("/media/:id", requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);
    const id = parseInt(req.params.id);
    const fs = await import("fs");
    
    const media = await storage.getMediaById(id);
    if (!media || media.userId !== userId) {
      return res.status(404).json({ message: "Média non trouvé" });
    }

    // Delete file from disk
    const filePath = path.join(process.cwd(), media.storagePath);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await storage.deleteMedia(id, userId);
    res.json({ success: true, message: "Média supprimé" });
  } catch (err: any) {
    console.error("Delete media error:", err);
    res.status(500).json({ message: err.message || "Erreur lors de la suppression" });
  }
});

export default router;
