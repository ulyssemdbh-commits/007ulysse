import { db } from "../db";
import { ulysseFiles } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { persistentStorageService } from "./persistentStorageService";
import { fileService } from "./fileService";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import AdmZip from "adm-zip";
import OpenAI from "openai";
import * as mm from "music-metadata";
import { smartExtract, ContentType } from "./structuredExtractor";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

interface FileReadAction {
  type: 'read';
  fileId: number;
}

interface FileGenerateExcelAction {
  type: 'generate_excel';
  title: string;
  headers: string[];
  data: string[][];
  sheetName?: string;
}

interface ExtractJsonAction {
  type: 'extract_json';
  url: string;
  contentType?: ContentType;
}

type FileAction = FileReadAction | FileGenerateExcelAction | ExtractJsonAction;

interface FileReadResult {
  success: boolean;
  type: 'read';
  action: FileReadAction;
  fileName?: string;
  fileType?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

interface FileGenerateExcelResult {
  success: boolean;
  type: 'generate_excel';
  action: FileGenerateExcelAction;
  fileName?: string;
  fileId?: number;
  filePath?: string;
  error?: string;
}

interface ExtractJsonResult {
  success: boolean;
  type: 'extract_json';
  action: ExtractJsonAction;
  contentType?: string;
  data?: any;
  confidence?: number;
  error?: string;
}

type FileActionResult = FileReadResult | FileGenerateExcelResult | ExtractJsonResult;

const READ_FILE_PATTERN = /\[LIRE_FICHIER:\s*id=(\d+)\]/gi;
const GENERATE_EXCEL_PATTERN = /\[GENERER_EXCEL:\s*titre="([^"]+)"\s*headers=\[([^\]]+)\]\s*data=\[((?:\[[^\]]*\],?\s*)+)\](?:\s*feuille="([^"]+)")?\]/gi;
const EXTRACT_JSON_PATTERN = /\[EXTRAIRE_JSON:\s*url="([^"]+)"(?:\s*type="([^"]+)")?\]/gi;

class FileActionService {
  parseFileActions(text: string): FileAction[] {
    const actions: FileAction[] = [];
    
    let match;
    while ((match = READ_FILE_PATTERN.exec(text)) !== null) {
      actions.push({
        type: 'read',
        fileId: parseInt(match[1], 10)
      });
    }
    READ_FILE_PATTERN.lastIndex = 0;
    
    // Parse Excel generation actions
    while ((match = GENERATE_EXCEL_PATTERN.exec(text)) !== null) {
      try {
        const title = match[1];
        const headersStr = match[2];
        const dataStr = match[3];
        const sheetName = match[4];
        
        // Parse headers: "col1", "col2", "col3" -> ["col1", "col2", "col3"]
        const headers = headersStr.split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
        
        // Parse data: ["a","b"],["c","d"] -> [["a","b"],["c","d"]]
        const dataRows: string[][] = [];
        const rowMatches = dataStr.match(/\[[^\]]*\]/g) || [];
        for (const rowStr of rowMatches) {
          const row = rowStr.slice(1, -1).split(',').map(cell => cell.trim().replace(/^["']|["']$/g, ''));
          dataRows.push(row);
        }
        
        actions.push({
          type: 'generate_excel',
          title,
          headers,
          data: dataRows,
          sheetName: sheetName || undefined
        });
        console.log(`[FileAction] Parsed Excel generation: "${title}" with ${headers.length} columns, ${dataRows.length} rows`);
      } catch (err) {
        console.error('[FileAction] Error parsing Excel generation pattern:', err);
      }
    }
    GENERATE_EXCEL_PATTERN.lastIndex = 0;
    
    // Parse JSON extraction actions
    while ((match = EXTRACT_JSON_PATTERN.exec(text)) !== null) {
      try {
        const url = match[1];
        const contentType = match[2] as ContentType | undefined;
        
        actions.push({
          type: 'extract_json',
          url,
          contentType
        });
        console.log(`[FileAction] Parsed JSON extraction: "${url}" (type: ${contentType || 'auto-detect'})`);
      } catch (err) {
        console.error('[FileAction] Error parsing JSON extraction pattern:', err);
      }
    }
    EXTRACT_JSON_PATTERN.lastIndex = 0;
    
    return actions;
  }

  async executeActions(actions: FileAction[], userId: number): Promise<FileActionResult[]> {
    const results: FileActionResult[] = [];

    for (const action of actions) {
      if (action.type === 'read') {
        const result = await this.executeReadAction(action, userId);
        results.push(result);
      } else if (action.type === 'generate_excel') {
        const result = await this.executeGenerateExcelAction(action, userId);
        results.push(result);
      } else if (action.type === 'extract_json') {
        const result = await this.executeExtractJsonAction(action);
        results.push(result);
      }
    }

    return results;
  }

  private async executeExtractJsonAction(action: ExtractJsonAction): Promise<ExtractJsonResult> {
    try {
      console.log(`[FileAction] Extracting JSON from URL: ${action.url}`);
      
      const result = await smartExtract(action.url, action.contentType);
      
      if (!result.success) {
        return {
          success: false,
          type: 'extract_json',
          action,
          error: result.error || 'Échec de l\'extraction'
        };
      }
      
      console.log(`[FileAction] JSON extracted: type=${result.contentType}, confidence=${result.confidence}`);
      
      return {
        success: true,
        type: 'extract_json',
        action,
        contentType: result.contentType,
        data: result.data,
        confidence: result.confidence
      };
    } catch (err: any) {
      console.error('[FileAction] Error extracting JSON:', err);
      return {
        success: false,
        type: 'extract_json',
        action,
        error: err.message || 'Erreur lors de l\'extraction'
      };
    }
  }

  private async executeGenerateExcelAction(action: FileGenerateExcelAction, userId: number): Promise<FileGenerateExcelResult> {
    try {
      console.log(`[FileAction] Generating Excel: "${action.title}" for user ${userId}`);
      
      // Generate the Excel file using fileService
      const generatedFile = await fileService.generateExcel(action.data, {
        headers: action.headers,
        sheetName: action.sheetName || action.title,
        title: action.title
      });
      
      console.log(`[FileAction] Excel generated: ${generatedFile.fileName} (${generatedFile.size} bytes)`);
      
      // Read the file content
      const fileBuffer = fs.readFileSync(generatedFile.filePath);
      
      // Upload to persistent storage if configured
      let storagePath: string | null = null;
      if (persistentStorageService.isConfigured()) {
        const storageResult = await persistentStorageService.uploadBuffer(fileBuffer, generatedFile.fileName, 'generated', userId);
        storagePath = storageResult.objectPath;
        console.log(`[FileAction] Excel uploaded to storage: ${storagePath}`);
      }
      
      // Register in database
      const [savedFile] = await db.insert(ulysseFiles).values({
        userId,
        filename: generatedFile.fileName,
        originalName: generatedFile.fileName,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: generatedFile.size,
        storagePath: storagePath || generatedFile.filePath,
        category: 'generated',
        isProcessed: true,
        aiDescription: `Fichier Excel généré: ${action.title} - ${action.headers.length} colonnes, ${action.data.length} lignes`,
        createdAt: new Date()
      }).returning();
      
      console.log(`[FileAction] Excel registered in DB with ID: ${savedFile.id}`);
      
      // Clean up local file if uploaded to storage
      if (storagePath && fs.existsSync(generatedFile.filePath)) {
        fs.unlinkSync(generatedFile.filePath);
      }
      
      return {
        success: true,
        type: 'generate_excel',
        action,
        fileName: generatedFile.fileName,
        fileId: savedFile.id,
        filePath: storagePath || generatedFile.filePath
      };
    } catch (err: any) {
      console.error('[FileAction] Error generating Excel:', err);
      return {
        success: false,
        type: 'generate_excel',
        action,
        error: err.message || 'Erreur lors de la génération du fichier Excel'
      };
    }
  }

  private async executeReadAction(action: FileReadAction, userId: number): Promise<FileReadResult> {
    try {
      console.log(`[FileAction] Reading file ID: ${action.fileId} for user ${userId}`);
      
      const file = await db.query.ulysseFiles.findFirst({
        where: and(
          eq(ulysseFiles.id, action.fileId),
          eq(ulysseFiles.userId, userId)
        )
      });

      if (!file) {
        return {
          success: false,
          type: 'read',
          action,
          error: `Fichier #${action.fileId} introuvable ou accès non autorisé`
        };
      }

      const ext = path.extname(file.filename).toLowerCase();
      
      let tempFilePath = '';
      let buffer: Buffer | null = null;

      try {
        if (file.storagePath && persistentStorageService.isConfigured()) {
          buffer = await persistentStorageService.downloadFile(file.storagePath);
          tempFilePath = path.join(os.tmpdir(), `ulysse_read_${Date.now()}_${file.filename}`);
          fs.writeFileSync(tempFilePath, buffer);
        } else if (file.storagePath) {
          tempFilePath = file.storagePath;
          if (fs.existsSync(tempFilePath)) {
            buffer = fs.readFileSync(tempFilePath);
          }
        }

        if (!tempFilePath || !fs.existsSync(tempFilePath)) {
          return {
            success: false,
            type: 'read',
            action,
            fileName: file.originalName,
            error: 'Fichier non accessible dans le stockage'
          };
        }

        let content = '';
        let metadata: Record<string, unknown> = {};

        switch (ext) {
          case '.pdf':
            const pdfResult = await this.readPDF(tempFilePath);
            content = pdfResult.content;
            metadata = pdfResult.metadata;
            break;

          case '.xlsx':
          case '.xls':
            const excelResult = await this.readExcel(tempFilePath);
            content = excelResult.content;
            metadata = excelResult.metadata;
            break;

          case '.docx':
          case '.doc':
            const wordResult = await this.readWord(tempFilePath);
            content = wordResult.content;
            metadata = wordResult.metadata;
            break;

          case '.txt':
          case '.md':
          case '.json':
          case '.csv':
          case '.html':
          case '.xml':
          case '.js':
          case '.ts':
          case '.py':
          case '.css':
            content = fs.readFileSync(tempFilePath, 'utf-8');
            metadata = { encoding: 'utf-8', size: buffer?.length || 0 };
            break;

          case '.zip':
            const zipResult = await this.readZip(tempFilePath);
            content = zipResult.content;
            metadata = zipResult.metadata;
            break;

          case '.png':
          case '.jpg':
          case '.jpeg':
          case '.gif':
          case '.webp':
          case '.bmp':
            const imageResult = await this.analyzeImage(buffer!, file.mimeType || 'image/png', file.originalName);
            content = imageResult.content;
            metadata = imageResult.metadata;
            break;

          case '.mp3':
          case '.wav':
          case '.flac':
          case '.m4a':
          case '.ogg':
          case '.aac':
            const audioResult = await this.readAudio(tempFilePath, buffer!);
            content = audioResult.content;
            metadata = audioResult.metadata;
            break;

          case '.mp4':
          case '.avi':
          case '.mov':
          case '.mkv':
          case '.webm':
            const videoResult = await this.readVideo(tempFilePath, file.originalName);
            content = videoResult.content;
            metadata = videoResult.metadata;
            break;

          default:
            return {
              success: false,
              type: 'read',
              action,
              fileName: file.originalName,
              error: `Type de fichier non supporté: ${ext}. Types supportés: PDF, Excel, Word, images, audio, vidéo, ZIP, texte.`
            };
        }

        if (tempFilePath.startsWith(os.tmpdir())) {
          try { fs.unlinkSync(tempFilePath); } catch {}
        }

        const truncatedContent = content.length > 100000 
          ? content.substring(0, 100000) + '\n\n[... contenu tronqué, fichier trop long ...]'
          : content;

        console.log(`[FileAction] Successfully read file: ${file.originalName} (${content.length} chars)`);

        return {
          success: true,
          type: 'read',
          action,
          fileName: file.originalName,
          fileType: ext.replace('.', ''),
          content: truncatedContent,
          metadata
        };

      } catch (readError) {
        if (tempFilePath.startsWith(os.tmpdir()) && fs.existsSync(tempFilePath)) {
          try { fs.unlinkSync(tempFilePath); } catch {}
        }
        console.error(`[FileAction] Error reading file content:`, readError);
        return {
          success: false,
          type: 'read',
          action,
          fileName: file.originalName,
          error: `Erreur lors de la lecture: ${readError instanceof Error ? readError.message : 'Erreur inconnue'}`
        };
      }

    } catch (error) {
      console.error(`[FileAction] Failed to read file:`, error);
      return {
        success: false,
        type: 'read',
        action,
        error: error instanceof Error ? error.message : 'Erreur inconnue'
      };
    }
  }

  private async readPDF(filePath: string): Promise<{ content: string; metadata: Record<string, unknown> }> {
    const analysis = await fileService.readFile(filePath);
    return {
      content: analysis.content,
      metadata: analysis.metadata
    };
  }

  private async readExcel(filePath: string): Promise<{ content: string; metadata: Record<string, unknown> }> {
    const analysis = await fileService.readFile(filePath);
    return {
      content: analysis.content,
      metadata: analysis.metadata
    };
  }

  private async readWord(filePath: string): Promise<{ content: string; metadata: Record<string, unknown> }> {
    const analysis = await fileService.readFile(filePath);
    return {
      content: analysis.content,
      metadata: analysis.metadata
    };
  }

  private async readZip(filePath: string): Promise<{ content: string; metadata: Record<string, unknown> }> {
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();
    
    const fileList: string[] = [];
    const textContents: string[] = [];
    let totalSize = 0;

    for (const entry of entries) {
      fileList.push(`${entry.entryName} (${this.formatSize(entry.header.size)})`);
      totalSize += entry.header.size;

      if (!entry.isDirectory) {
        const ext = path.extname(entry.entryName).toLowerCase();
        const textExtensions = ['.txt', '.md', '.json', '.csv', '.xml', '.html', '.js', '.ts', '.py', '.css'];
        
        if (textExtensions.includes(ext) && entry.header.size < 100000) {
          try {
            const text = entry.getData().toString('utf-8');
            textContents.push(`\n--- ${entry.entryName} ---\n${text}`);
          } catch {}
        }
      }
    }

    let content = `Archive ZIP contenant ${entries.length} fichiers:\n\n`;
    content += fileList.join('\n');
    
    if (textContents.length > 0) {
      content += '\n\n=== CONTENU DES FICHIERS TEXTE ===';
      content += textContents.join('\n');
    }

    return {
      content,
      metadata: {
        fileCount: entries.length,
        totalSize,
        totalSizeFormatted: this.formatSize(totalSize)
      }
    };
  }

  private async analyzeImage(buffer: Buffer, mimeType: string, fileName: string): Promise<{ content: string; metadata: Record<string, unknown> }> {
    try {
      const base64 = buffer.toString('base64');
      const dataUrl = `data:${mimeType};base64,${base64}`;

      console.log(`[FileAction] Analyzing image with Vision API: ${fileName}`);

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Analyse cette image en détail. Décris:
1. Ce que tu vois (objets, personnes, texte, scène)
2. Les couleurs dominantes et le style
3. Si c'est un document/screenshot, transcris le texte visible
4. Tout élément notable ou important

Sois précis et exhaustif dans ta description.`
              },
              {
                type: 'image_url',
                image_url: {
                  url: dataUrl,
                  detail: 'high'
                }
              }
            ]
          }
        ],
        max_tokens: 2000
      });

      const description = response.choices[0]?.message?.content || 'Impossible d\'analyser cette image';

      return {
        content: `🖼️ **Analyse de l'image "${fileName}"**\n\n${description}`,
        metadata: {
          type: 'image',
          mimeType,
          sizeBytes: buffer.length,
          analyzed: true
        }
      };
    } catch (error) {
      console.error(`[FileAction] Image analysis failed:`, error);
      return {
        content: `Image: ${fileName} (${this.formatSize(buffer.length)}) - Analyse non disponible`,
        metadata: {
          type: 'image',
          mimeType,
          sizeBytes: buffer.length,
          analyzed: false,
          error: error instanceof Error ? error.message : 'Erreur inconnue'
        }
      };
    }
  }

  private async readAudio(filePath: string, buffer: Buffer): Promise<{ content: string; metadata: Record<string, unknown> }> {
    try {
      const audioMetadata = await mm.parseBuffer(buffer);
      
      const duration = audioMetadata.format.duration || 0;
      const minutes = Math.floor(duration / 60);
      const seconds = Math.floor(duration % 60);

      let content = `🎵 **Fichier audio**: ${path.basename(filePath)}\n\n`;
      content += `**Durée**: ${minutes}:${seconds.toString().padStart(2, '0')}\n`;
      content += `**Format**: ${audioMetadata.format.codec || audioMetadata.format.container || 'Inconnu'}\n`;
      content += `**Bitrate**: ${audioMetadata.format.bitrate ? Math.round(audioMetadata.format.bitrate / 1000) + ' kbps' : 'Inconnu'}\n`;
      content += `**Échantillonnage**: ${audioMetadata.format.sampleRate ? audioMetadata.format.sampleRate + ' Hz' : 'Inconnu'}\n`;

      if (audioMetadata.common.title || audioMetadata.common.artist || audioMetadata.common.album) {
        content += `\n**Métadonnées ID3**:\n`;
        if (audioMetadata.common.title) content += `- Titre: ${audioMetadata.common.title}\n`;
        if (audioMetadata.common.artist) content += `- Artiste: ${audioMetadata.common.artist}\n`;
        if (audioMetadata.common.album) content += `- Album: ${audioMetadata.common.album}\n`;
        if (audioMetadata.common.year) content += `- Année: ${audioMetadata.common.year}\n`;
        if (audioMetadata.common.genre) content += `- Genre: ${audioMetadata.common.genre.join(', ')}\n`;
      }

      if (duration > 0 && duration < 300) {
        try {
          console.log(`[FileAction] Transcribing audio with Whisper...`);
          const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(filePath),
            model: 'whisper-1',
            language: 'fr'
          });
          
          if (transcription.text) {
            content += `\n**Transcription**:\n${transcription.text}`;
          }
        } catch (transcriptError) {
          console.error(`[FileAction] Audio transcription failed:`, transcriptError);
          content += `\n_Transcription non disponible_`;
        }
      } else if (duration >= 300) {
        content += `\n_Audio trop long pour transcription automatique (> 5 min)_`;
      }

      return {
        content,
        metadata: {
          type: 'audio',
          duration,
          durationFormatted: `${minutes}:${seconds.toString().padStart(2, '0')}`,
          codec: audioMetadata.format.codec,
          bitrate: audioMetadata.format.bitrate,
          sampleRate: audioMetadata.format.sampleRate,
          title: audioMetadata.common.title,
          artist: audioMetadata.common.artist,
          album: audioMetadata.common.album
        }
      };
    } catch (error) {
      console.error(`[FileAction] Audio metadata extraction failed:`, error);
      return {
        content: `Fichier audio: ${path.basename(filePath)} - Métadonnées non disponibles`,
        metadata: {
          type: 'audio',
          error: error instanceof Error ? error.message : 'Erreur inconnue'
        }
      };
    }
  }

  private async readVideo(filePath: string, fileName: string): Promise<{ content: string; metadata: Record<string, unknown> }> {
    try {
      const stats = fs.statSync(filePath);
      
      let content = `🎬 **Fichier vidéo**: ${fileName}\n\n`;
      content += `**Taille**: ${this.formatSize(stats.size)}\n`;
      content += `**Extension**: ${path.extname(fileName)}\n`;
      
      try {
        const buffer = fs.readFileSync(filePath);
        const audioMetadata = await mm.parseBuffer(buffer);
        
        if (audioMetadata.format.duration) {
          const duration = audioMetadata.format.duration;
          const hours = Math.floor(duration / 3600);
          const minutes = Math.floor((duration % 3600) / 60);
          const seconds = Math.floor(duration % 60);
          
          const durationStr = hours > 0 
            ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
            : `${minutes}:${seconds.toString().padStart(2, '0')}`;
          
          content += `**Durée**: ${durationStr}\n`;
        }
        
        if (audioMetadata.format.codec) {
          content += `**Codec**: ${audioMetadata.format.codec}\n`;
        }
      } catch {}

      content += `\n_Note: Pour une analyse complète du contenu vidéo, veuillez fournir des captures d'écran spécifiques._`;

      return {
        content,
        metadata: {
          type: 'video',
          sizeBytes: stats.size,
          fileName
        }
      };
    } catch (error) {
      return {
        content: `Fichier vidéo: ${fileName} - Informations limitées disponibles`,
        metadata: {
          type: 'video',
          error: error instanceof Error ? error.message : 'Erreur inconnue'
        }
      };
    }
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  formatResultForUser(result: FileActionResult): string {
    if (result.type === 'read') {
      if (result.success) {
        return `\n\n📄 **Contenu de ${result.fileName}**:\n\n${result.content}\n`;
      } else {
        return `\n\n❌ **Erreur de lecture**: ${result.error}\n`;
      }
    } else if (result.type === 'generate_excel') {
      if (result.success) {
        return `\n\n✅ **Fichier Excel créé**: ${result.fileName}\n📁 Disponible dans FICHIERS > Générés (ID: #${result.fileId})\n`;
      } else {
        return `\n\n❌ **Erreur de génération Excel**: ${result.error}\n`;
      }
    } else if (result.type === 'extract_json') {
      if (result.success) {
        const jsonFormatted = JSON.stringify(result.data, null, 2);
        return `\n\n📊 **JSON EXTRAIT** (type: ${result.contentType}, confiance: ${Math.round((result.confidence || 0) * 100)}%):

\`\`\`json
${jsonFormatted}
\`\`\`
`;
      } else {
        return `\n\n❌ **Erreur d'extraction JSON**: ${result.error}\n`;
      }
    }
    return '';
  }
}

export const fileActionService = new FileActionService();
