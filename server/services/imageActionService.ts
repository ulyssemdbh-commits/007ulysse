import { searchImages, getQuotaStatus, getRemainingQuota } from "./googleImageService";
import { broadcastToUser } from "./realtimeSync";
import { persistentStorageService } from "./persistentStorageService";
import { db } from "../db";
import { ulysseFiles } from "@shared/schema";
import * as path from "path";
import * as faceCatalogService from "./faceCatalogService";
import { generateImageBuffer } from "../replit_integrations/image/client";

interface ImageSearchAction {
  type: 'search';
  query: string;
  count: number;
}

interface ImageDownloadAction {
  type: 'download';
  url: string;
  name?: string;
}

interface ImageGenerateAction {
  type: 'generate';
  prompt: string;
  size?: '1024x1024' | '512x512' | '256x256';
}

type ImageAction = ImageSearchAction | ImageDownloadAction | ImageGenerateAction;

interface ImageSearchResult {
  success: boolean;
  type: 'search';
  action: ImageSearchAction;
  images?: Array<{
    title: string;
    link: string;
    thumbnailLink: string;
    contextLink: string;
    width: number;
    height: number;
  }>;
  totalResults?: number;
  remainingQuota?: number;
  error?: string;
}

interface ImageDownloadResult {
  success: boolean;
  type: 'download';
  action: ImageDownloadAction;
  savedPath?: string;
  fileName?: string;
  downloadUrl?: string;
  error?: string;
}

interface ImageGenerateResult {
  success: boolean;
  type: 'generate';
  action: ImageGenerateAction;
  savedPath?: string;
  fileName?: string;
  downloadUrl?: string;
  error?: string;
}

type ImageActionResult = ImageSearchResult | ImageDownloadResult | ImageGenerateResult;

const SEARCH_IMAGES_PATTERN = /\[RECHERCHE_IMAGES:\s*query="([^"]+)"(?:\s*,\s*count=(\d+))?\]/gi;
const DOWNLOAD_IMAGE_PATTERN = /\[TÉLÉCHARGER_IMAGE:\s*url="([^"]+)"(?:\s*,\s*name="([^"]+)")?\]/gi;
const GENERATE_IMAGE_PATTERN = /\[GÉNÉRER_IMAGE:\s*prompt="([^"]+)"(?:\s*,\s*size="(1024x1024|512x512|256x256)")?\]/gi;

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp'];

const BLOCKED_HOSTS = [
  'localhost', '127.0.0.1', '0.0.0.0', '[::1]',
  '169.254.169.254', 'metadata.google.internal',
  '10.', '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.', '172.24.',
  '172.25.', '172.26.', '172.27.', '172.28.', '172.29.',
  '172.30.', '172.31.', '192.168.'
];

function isUrlSafe(urlString: string): { safe: boolean; error?: string } {
  try {
    const url = new URL(urlString);
    
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { safe: false, error: 'Only HTTP/HTTPS URLs are allowed' };
    }
    
    const hostname = url.hostname.toLowerCase();
    for (const blocked of BLOCKED_HOSTS) {
      if (hostname === blocked || hostname.startsWith(blocked)) {
        return { safe: false, error: 'Internal/private addresses are not allowed' };
      }
    }
    
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      const parts = hostname.split('.').map(Number);
      if (parts[0] === 10 || 
          (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
          (parts[0] === 192 && parts[1] === 168) ||
          parts[0] === 127) {
        return { safe: false, error: 'Private IP addresses are not allowed' };
      }
    }
    
    return { safe: true };
  } catch {
    return { safe: false, error: 'Invalid URL format' };
  }
}

class ImageActionService {
  parseImageActions(response: string): ImageAction[] {
    const actions: ImageAction[] = [];
    let match;

    while ((match = SEARCH_IMAGES_PATTERN.exec(response)) !== null) {
      actions.push({
        type: 'search',
        query: match[1].trim(),
        count: match[2] ? parseInt(match[2], 10) : 5
      });
    }
    SEARCH_IMAGES_PATTERN.lastIndex = 0;

    while ((match = DOWNLOAD_IMAGE_PATTERN.exec(response)) !== null) {
      actions.push({
        type: 'download',
        url: match[1].trim(),
        name: match[2]?.trim()
      });
    }
    DOWNLOAD_IMAGE_PATTERN.lastIndex = 0;

    while ((match = GENERATE_IMAGE_PATTERN.exec(response)) !== null) {
      actions.push({
        type: 'generate',
        prompt: match[1].trim(),
        size: (match[2] as '1024x1024' | '512x512' | '256x256') || '1024x1024'
      });
    }
    GENERATE_IMAGE_PATTERN.lastIndex = 0;

    return actions;
  }

  async executeActions(actions: ImageAction[], userId?: number): Promise<ImageActionResult[]> {
    const results: ImageActionResult[] = [];

    for (const action of actions) {
      if (action.type === 'search') {
        const result = await this.executeSearchAction(action, userId);
        results.push(result);
      } else if (action.type === 'download') {
        const result = await this.executeDownloadAction(action, userId);
        results.push(result);
      } else if (action.type === 'generate') {
        const result = await this.executeGenerateAction(action, userId);
        results.push(result);
      }
    }

    return results;
  }

  private async executeSearchAction(action: ImageSearchAction, userId?: number): Promise<ImageSearchResult> {
    try {
      console.log(`[ImageAction] Executing search for: ${action.query} (count: ${action.count})`);
      
      const searchResult = await searchImages(action.query, action.count);
      
      if (searchResult.success) {
        if (userId && searchResult.images.length > 0) {
          broadcastToUser(userId, {
            type: 'search.results',
            userId,
            data: {
              source: 'google_images',
              query: action.query,
              images: searchResult.images,
              totalResults: searchResult.totalResults,
              remainingQuota: searchResult.remainingQuota
            },
            timestamp: Date.now()
          });
          
          // Auto-save images to database for future use / learning
          this.autoSaveSearchImages(searchResult.images, action.query, userId);
        }

        return {
          success: true,
          type: 'search',
          action,
          images: searchResult.images,
          totalResults: searchResult.totalResults,
          remainingQuota: searchResult.remainingQuota
        };
      } else {
        return {
          success: false,
          type: 'search',
          action,
          error: searchResult.error,
          remainingQuota: searchResult.remainingQuota
        };
      }
    } catch (error) {
      console.error(`[ImageAction] Failed to execute search:`, error);
      return {
        success: false,
        type: 'search',
        action,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async executeGenerateAction(action: ImageGenerateAction, userId?: number): Promise<ImageGenerateResult> {
    try {
      console.log(`[ImageAction] Generating image with prompt: "${action.prompt.substring(0, 100)}..."`);
      
      if (!userId) {
        return {
          success: false,
          type: 'generate',
          action,
          error: 'User ID required for image generation'
        };
      }

      // Generate image using DALL-E
      const imageBuffer = await generateImageBuffer(action.prompt, action.size || '1024x1024');
      
      // Save to object storage
      if (!persistentStorageService.isConfigured()) {
        return {
          success: false,
          type: 'generate',
          action,
          error: 'Object Storage not configured'
        };
      }

      const fileName = `generated_${Date.now()}.png`;
      const uploadResult = await persistentStorageService.uploadBuffer(
        imageBuffer,
        fileName,
        'generated',
        userId
      );

      // Save to database
      await db.insert(ulysseFiles).values({
        userId,
        filename: fileName,
        originalName: fileName,
        mimeType: 'image/png',
        sizeBytes: imageBuffer.length,
        category: 'generated',
        storagePath: uploadResult.objectPath,
        description: `Generated: ${action.prompt.substring(0, 200)}`,
        generatedBy: userId === 1 ? 'ulysse' : (userId || 1) >= 5 ? 'alfred' : 'iris'
      });

      const downloadUrl = persistentStorageService.getPublicUrl(uploadResult.objectPath);

      // Broadcast to UI for immediate display
      broadcastToUser(userId, {
        type: 'image.generated',
        userId,
        data: {
          prompt: action.prompt,
          fileName,
          downloadUrl,
          savedPath: uploadResult.objectPath
        },
        timestamp: Date.now()
      });

      console.log(`[ImageAction] Successfully generated and saved image: ${fileName}`);

      return {
        success: true,
        type: 'generate',
        action,
        savedPath: uploadResult.objectPath,
        fileName,
        downloadUrl
      };
    } catch (error) {
      console.error(`[ImageAction] Failed to generate image:`, error);
      return {
        success: false,
        type: 'generate',
        action,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Auto-save search images to database for future use and learning.
   * Downloads images in the background without blocking the main response.
   */
  private async autoSaveSearchImages(
    images: Array<{ title: string; link: string; thumbnailLink: string; contextLink: string; width: number; height: number }>,
    query: string,
    userId: number
  ): Promise<void> {
    if (!persistentStorageService.isConfigured()) {
      console.log('[ImageAction] Object storage not configured, skipping auto-save');
      return;
    }
    
    console.log(`[ImageAction] Auto-saving ${images.length} images for query: "${query}"`);
    
    // Process in background, don't block the response
    setImmediate(async () => {
      let savedCount = 0;
      const savedImages: Array<{ url: string; title: string; storagePath: string; buffer: Buffer; fileName: string; mimeType: string; sizeBytes: number }> = [];
      
      for (const image of images) {
        try {
          const urlCheck = isUrlSafe(image.link);
          if (!urlCheck.safe) {
            console.log(`[ImageAction] Skipping unsafe URL: ${image.link}`);
            continue;
          }
          
          const response = await fetch(image.link, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; UlysseBot/1.0)' },
            redirect: 'follow',
            signal: AbortSignal.timeout(10000) // 10s timeout per image
          });
          
          if (!response.ok) continue;
          
          const contentType = response.headers.get('content-type') || '';
          const baseContentType = contentType.split(';')[0].trim().toLowerCase();
          
          if (!ALLOWED_IMAGE_TYPES.includes(baseContentType)) continue;
          
          const buffer = Buffer.from(await response.arrayBuffer());
          if (buffer.length > MAX_IMAGE_SIZE) continue;
          
          const ext = this.getExtensionFromMime(baseContentType);
          const sanitizedTitle = image.title
            .replace(/[^a-zA-Z0-9\s\-_àâäéèêëïîôùûüç]/gi, '')
            .replace(/\s+/g, '_')
            .substring(0, 50);
          const fileName = `${sanitizedTitle}_${Date.now()}${ext}`;
          
          const uploadResult = await persistentStorageService.uploadBuffer(
            buffer,
            fileName,
            'received',
            userId
          );
          
          await db.insert(ulysseFiles).values({
            userId,
            filename: fileName,
            originalName: image.title || fileName,
            mimeType: baseContentType,
            sizeBytes: buffer.length,
            category: 'received',
            storagePath: uploadResult.objectPath,
            description: `Google Images: "${query}" | Source: ${image.contextLink}`,
            generatedBy: userId === 1 ? 'ulysse' : (userId || 1) >= 5 ? 'alfred' : 'iris'
          });
          
          savedImages.push({
            url: image.link,
            title: image.title,
            storagePath: uploadResult.objectPath,
            buffer,
            fileName,
            mimeType: baseContentType,
            sizeBytes: buffer.length
          });
          
          savedCount++;
        } catch (err) {
          // Silent fail for individual images
          console.log(`[ImageAction] Failed to save image: ${image.link.substring(0, 50)}...`);
        }
      }
      
      console.log(`[ImageAction] Auto-saved ${savedCount}/${images.length} images for query: "${query}"`);
      
      // Auto-catalog faces for person name queries (runs after image save completes)
      if (savedImages.length > 0) {
        try {
          const catalogResult = await faceCatalogService.batchCatalogFromQuery(
            userId,
            savedImages,
            query,
            3 // Max 3 images to catalog per query
          );
          
          if (catalogResult.successful > 0) {
            console.log(`[ImageAction] Face catalog: ${catalogResult.successful} faces cataloged for "${catalogResult.personName}"`);
          }
        } catch (catalogError) {
          console.log(`[ImageAction] Face cataloging skipped or failed:`, catalogError);
        }
      }
    });
  }

  private async executeDownloadAction(action: ImageDownloadAction, userId?: number): Promise<ImageDownloadResult> {
    try {
      console.log(`[ImageAction] Downloading image from: ${action.url}`);
      
      if (!userId) {
        return {
          success: false,
          type: 'download',
          action,
          error: 'User ID required for download'
        };
      }

      const urlCheck = isUrlSafe(action.url);
      if (!urlCheck.safe) {
        console.warn(`[ImageAction] SSRF blocked: ${action.url} - ${urlCheck.error}`);
        return {
          success: false,
          type: 'download',
          action,
          error: urlCheck.error || 'URL not allowed'
        };
      }

      if (!persistentStorageService.isConfigured()) {
        return {
          success: false,
          type: 'download',
          action,
          error: 'Object Storage not configured'
        };
      }

      const response = await fetch(action.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; UlysseBot/1.0)'
        },
        redirect: 'manual'
      });
      
      if (response.status >= 300 && response.status < 400) {
        const redirectUrl = response.headers.get('location');
        if (redirectUrl) {
          const redirectCheck = isUrlSafe(redirectUrl);
          if (!redirectCheck.safe) {
            console.warn(`[ImageAction] SSRF blocked redirect: ${redirectUrl}`);
            return {
              success: false,
              type: 'download',
              action,
              error: 'Redirect vers une adresse non autorisée'
            };
          }
          const redirectResponse = await fetch(redirectUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; UlysseBot/1.0)' },
            redirect: 'error'
          });
          if (!redirectResponse.ok) {
            return {
              success: false,
              type: 'download',
              action,
              error: `HTTP ${redirectResponse.status}: ${redirectResponse.statusText}`
            };
          }
          const contentType = redirectResponse.headers.get('content-type') || '';
          const baseContentType = contentType.split(';')[0].trim().toLowerCase();
          
          if (!ALLOWED_IMAGE_TYPES.includes(baseContentType)) {
            return { success: false, type: 'download', action, error: `Type non supporté: ${contentType}` };
          }
          
          const buffer = Buffer.from(await redirectResponse.arrayBuffer());
          if (buffer.length > MAX_IMAGE_SIZE) {
            return { success: false, type: 'download', action, error: 'Image trop grande (max 10 Mo)' };
          }
          
          const ext = this.getExtensionFromMime(baseContentType);
          const baseName = action.name || this.extractFileNameFromUrl(action.url) || `image_${Date.now()}`;
          const fileName = baseName.includes('.') ? baseName : `${baseName}${ext}`;
          
          const uploadResult = await persistentStorageService.uploadBuffer(buffer, fileName, 'received', userId);
          await db.insert(ulysseFiles).values({
            userId,
            filename: fileName,
            originalName: fileName,
            mimeType: baseContentType,
            sizeBytes: buffer.length,
            category: 'received',
            storagePath: uploadResult.objectPath,
            description: `Downloaded from: ${action.url}`,
            generatedBy: userId === 1 ? 'ulysse' : (userId || 1) >= 5 ? 'alfred' : 'iris'
          });
          
          return {
            success: true,
            type: 'download',
            action,
            savedPath: uploadResult.objectPath,
            fileName,
            downloadUrl: persistentStorageService.getPublicUrl(uploadResult.objectPath)
          };
        }
      }

      if (!response.ok) {
        return {
          success: false,
          type: 'download',
          action,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }

      const contentType = response.headers.get('content-type') || '';
      const baseContentType = contentType.split(';')[0].trim().toLowerCase();
      
      if (!ALLOWED_IMAGE_TYPES.includes(baseContentType)) {
        return {
          success: false,
          type: 'download',
          action,
          error: `Type de fichier non supporté: ${contentType}. Seules les images sont autorisées.`
        };
      }

      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE) {
        return {
          success: false,
          type: 'download',
          action,
          error: `Image trop grande (max 10 Mo)`
        };
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      
      if (buffer.length > MAX_IMAGE_SIZE) {
        return {
          success: false,
          type: 'download',
          action,
          error: `Image trop grande (max 10 Mo)`
        };
      }

      const ext = this.getExtensionFromMime(baseContentType);
      const baseName = action.name || this.extractFileNameFromUrl(action.url) || `image_${Date.now()}`;
      const fileName = baseName.includes('.') ? baseName : `${baseName}${ext}`;

      const uploadResult = await persistentStorageService.uploadBuffer(
        buffer,
        fileName,
        'received',
        userId
      );

      await db.insert(ulysseFiles).values({
        userId,
        filename: fileName,
        originalName: fileName,
        mimeType: contentType,
        sizeBytes: buffer.length,
        category: 'received',
        storagePath: uploadResult.objectPath,
        description: `Downloaded from: ${action.url}`,
        generatedBy: userId === 1 ? 'ulysse' : (userId || 1) >= 5 ? 'alfred' : 'iris'
      });

      const downloadUrl = persistentStorageService.getPublicUrl(uploadResult.objectPath);

      console.log(`[ImageAction] Successfully saved image: ${fileName}`);

      return {
        success: true,
        type: 'download',
        action,
        savedPath: uploadResult.objectPath,
        fileName,
        downloadUrl
      };
    } catch (error) {
      console.error(`[ImageAction] Failed to download image:`, error);
      return {
        success: false,
        type: 'download',
        action,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private getExtensionFromMime(mimeType: string): string {
    const mimeToExt: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/svg+xml': '.svg',
      'image/bmp': '.bmp'
    };
    return mimeToExt[mimeType] || '.jpg';
  }

  private extractFileNameFromUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname;
      const fileName = path.basename(pathname);
      if (fileName && fileName.length > 0 && fileName !== '/') {
        return fileName.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100);
      }
    } catch {}
    return null;
  }

  formatResultForUser(result: ImageActionResult): string {
    if (result.type === 'search') {
      return this.formatSearchResult(result);
    } else if (result.type === 'download') {
      return this.formatDownloadResult(result);
    } else if (result.type === 'generate') {
      return this.formatGenerateResult(result);
    }
    return '';
  }

  private formatSearchResult(result: ImageSearchResult): string {
    if (!result.success) {
      return `\n\n❌ Recherche d'images échouée: ${result.error}`;
    }

    if (!result.images || result.images.length === 0) {
      return `\n\n📷 Aucune image trouvée pour "${result.action.query}"`;
    }

    const imageLinks = result.images.map((img, idx) => 
      `${idx + 1}. [${img.title}](${img.link})`
    ).join('\n');

    return `\n\n📷 **${result.images.length} images trouvées pour "${result.action.query}":**\n${imageLinks}\n\n_Quota restant: ${result.remainingQuota}/100 recherches aujourd'hui_`;
  }

  private formatDownloadResult(result: ImageDownloadResult): string {
    if (!result.success) {
      return `\n\n❌ Téléchargement échoué: ${result.error}`;
    }

    return `\n\n✅ **Image sauvegardée:** [${result.fileName}](${result.downloadUrl})\n_L'image est maintenant dans ta bibliothèque (Fichiers > Téléchargements)_`;
  }

  private formatGenerateResult(result: ImageGenerateResult): string {
    if (!result.success) {
      return `\n\n❌ Génération d'image échouée: ${result.error}`;
    }

    return `\n\n🎨 **Image générée:** [${result.fileName}](${result.downloadUrl})\n_L'image est sauvegardée dans ta bibliothèque (Fichiers > Générés)_`;
  }

  getStatus(): { configured: boolean; quotaUsed: number; quotaRemaining: number; quotaLimit: number } {
    const quota = getQuotaStatus();
    const configured = !!(process.env.GOOGLE_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID);
    
    return {
      configured,
      quotaUsed: quota.used,
      quotaRemaining: quota.remaining,
      quotaLimit: quota.limit
    };
  }

  isConfigured(): boolean {
    return !!(process.env.GOOGLE_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID);
  }
}

export const imageActionService = new ImageActionService();
