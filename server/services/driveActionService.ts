import * as driveService from "./googleDriveService";

type DriveActionType = 'list' | 'search' | 'recent' | 'create_folder' | 'create_doc' | 'create_sheet' | 'trash' | 'quota';

interface DriveListAction {
  type: 'list';
  folderId?: string;
}

interface DriveSearchAction {
  type: 'search';
  query: string;
}

interface DriveRecentAction {
  type: 'recent';
  limit?: number;
}

interface DriveCreateFolderAction {
  type: 'create_folder';
  name: string;
  parentId?: string;
}

interface DriveCreateDocAction {
  type: 'create_doc';
  name: string;
  parentId?: string;
}

interface DriveCreateSheetAction {
  type: 'create_sheet';
  name: string;
  parentId?: string;
}

interface DriveTrashAction {
  type: 'trash';
  fileId: string;
}

interface DriveQuotaAction {
  type: 'quota';
}

type DriveAction = DriveListAction | DriveSearchAction | DriveRecentAction | 
                   DriveCreateFolderAction | DriveCreateDocAction | DriveCreateSheetAction |
                   DriveTrashAction | DriveQuotaAction;

interface DriveActionResult {
  success: boolean;
  type: DriveActionType;
  data?: any;
  summary: string;
  error?: string;
}

const LIST_DRIVE_PATTERN = /\[LISTE_DRIVE(?:\s*:\s*dossier\s*=\s*([^\]]+))?\]/gi;
const SEARCH_DRIVE_PATTERN = /\[RECHERCHE_DRIVE\s*:\s*query\s*=\s*([^\]]+)\]/gi;
const RECENT_DRIVE_PATTERN = /\[FICHIERS_RECENTS_DRIVE(?:\s*:\s*limite\s*=\s*(\d+))?\]/gi;
const CREATE_FOLDER_PATTERN = /\[CREER_DOSSIER_DRIVE\s*:\s*nom\s*=\s*([^\],]+)(?:\s*,\s*parent\s*=\s*([^\]]+))?\]/gi;
const CREATE_DOC_PATTERN = /\[CREER_DOC_DRIVE\s*:\s*nom\s*=\s*([^\],]+)(?:\s*,\s*parent\s*=\s*([^\]]+))?\]/gi;
const CREATE_SHEET_PATTERN = /\[CREER_SHEET_DRIVE\s*:\s*nom\s*=\s*([^\],]+)(?:\s*,\s*parent\s*=\s*([^\]]+))?\]/gi;
const TRASH_DRIVE_PATTERN = /\[SUPPRIMER_DRIVE\s*:\s*id\s*=\s*([^\]]+)\]/gi;
const QUOTA_DRIVE_PATTERN = /\[QUOTA_DRIVE\]/gi;

function formatFileSize(bytes: string | undefined): string {
  if (!bytes) return "N/A";
  const size = parseInt(bytes);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "N/A";
  const date = new Date(dateStr);
  return date.toLocaleDateString('fr-FR', { 
    day: '2-digit', 
    month: '2-digit', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getMimeTypeLabel(mimeType: string): string {
  const types: Record<string, string> = {
    'application/vnd.google-apps.folder': 'Dossier',
    'application/vnd.google-apps.document': 'Google Doc',
    'application/vnd.google-apps.spreadsheet': 'Google Sheet',
    'application/vnd.google-apps.presentation': 'Google Slides',
    'application/pdf': 'PDF',
    'image/jpeg': 'Image JPEG',
    'image/png': 'Image PNG',
    'text/plain': 'Texte',
    'application/zip': 'ZIP',
  };
  return types[mimeType] || mimeType.split('/').pop() || 'Fichier';
}

class DriveActionService {
  parseDriveActions(text: string): DriveAction[] {
    const actions: DriveAction[] = [];
    let match;

    LIST_DRIVE_PATTERN.lastIndex = 0;
    while ((match = LIST_DRIVE_PATTERN.exec(text)) !== null) {
      actions.push({ type: 'list', folderId: match[1]?.trim() });
    }

    SEARCH_DRIVE_PATTERN.lastIndex = 0;
    while ((match = SEARCH_DRIVE_PATTERN.exec(text)) !== null) {
      if (match[1]) {
        actions.push({ type: 'search', query: match[1].trim() });
      }
    }

    RECENT_DRIVE_PATTERN.lastIndex = 0;
    while ((match = RECENT_DRIVE_PATTERN.exec(text)) !== null) {
      actions.push({ type: 'recent', limit: match[1] ? parseInt(match[1]) : 10 });
    }

    CREATE_FOLDER_PATTERN.lastIndex = 0;
    while ((match = CREATE_FOLDER_PATTERN.exec(text)) !== null) {
      if (match[1]) {
        actions.push({ 
          type: 'create_folder', 
          name: match[1].trim(),
          parentId: match[2]?.trim()
        });
      }
    }

    CREATE_DOC_PATTERN.lastIndex = 0;
    while ((match = CREATE_DOC_PATTERN.exec(text)) !== null) {
      if (match[1]) {
        actions.push({ 
          type: 'create_doc', 
          name: match[1].trim(),
          parentId: match[2]?.trim()
        });
      }
    }

    CREATE_SHEET_PATTERN.lastIndex = 0;
    while ((match = CREATE_SHEET_PATTERN.exec(text)) !== null) {
      if (match[1]) {
        actions.push({ 
          type: 'create_sheet', 
          name: match[1].trim(),
          parentId: match[2]?.trim()
        });
      }
    }

    TRASH_DRIVE_PATTERN.lastIndex = 0;
    while ((match = TRASH_DRIVE_PATTERN.exec(text)) !== null) {
      if (match[1]) {
        actions.push({ type: 'trash', fileId: match[1].trim() });
      }
    }

    QUOTA_DRIVE_PATTERN.lastIndex = 0;
    if (QUOTA_DRIVE_PATTERN.test(text)) {
      actions.push({ type: 'quota' });
    }

    return actions;
  }

  async executeActions(actions: DriveAction[]): Promise<DriveActionResult[]> {
    const results: DriveActionResult[] = [];

    for (const action of actions) {
      let result: DriveActionResult;
      
      switch (action.type) {
        case 'list':
          result = await this.executeListAction(action);
          break;
        case 'search':
          result = await this.executeSearchAction(action);
          break;
        case 'recent':
          result = await this.executeRecentAction(action);
          break;
        case 'create_folder':
          result = await this.executeCreateFolderAction(action);
          break;
        case 'create_doc':
          result = await this.executeCreateDocAction(action);
          break;
        case 'create_sheet':
          result = await this.executeCreateSheetAction(action);
          break;
        case 'trash':
          result = await this.executeTrashAction(action);
          break;
        case 'quota':
          result = await this.executeQuotaAction();
          break;
        default:
          result = { success: false, type: 'list', summary: 'Action non reconnue', error: 'Unknown action type' };
      }
      
      results.push(result);
    }

    return results;
  }

  private async executeListAction(action: DriveListAction): Promise<DriveActionResult> {
    try {
      console.log(`[DriveAction] Listing files in folder: ${action.folderId || 'root'}`);
      
      const result = await driveService.listFiles(action.folderId || 'root', 20);
      const files = result.files;
      
      let summary = `**Google Drive - Contenu du dossier**\n`;
      summary += `${files.length} element(s) trouve(s)\n\n`;
      
      if (files.length > 0) {
        for (const file of files) {
          const typeLabel = getMimeTypeLabel(file.mimeType);
          const size = file.mimeType.includes('folder') ? '' : ` (${formatFileSize(file.size)})`;
          summary += `- **${file.name}** [${typeLabel}]${size}\n`;
          summary += `  ID: ${file.id}\n`;
          if (file.webViewLink) {
            summary += `  Lien: ${file.webViewLink}\n`;
          }
        }
      } else {
        summary += '_Aucun fichier dans ce dossier._\n';
      }
      
      return {
        success: true,
        type: 'list',
        data: { files },
        summary
      };
    } catch (error: any) {
      console.error('[DriveAction] List error:', error);
      return {
        success: false,
        type: 'list',
        summary: 'Erreur lors de la lecture du Drive',
        error: error.message || 'Erreur inconnue'
      };
    }
  }

  private async executeSearchAction(action: DriveSearchAction): Promise<DriveActionResult> {
    try {
      console.log(`[DriveAction] Searching for: ${action.query}`);
      
      const result = await driveService.searchFiles(action.query, 20);
      const files = result.files;
      
      let summary = `**Google Drive - Recherche: "${action.query}"**\n`;
      summary += `${files.length} resultat(s)\n\n`;
      
      if (files.length > 0) {
        for (const file of files) {
          const typeLabel = getMimeTypeLabel(file.mimeType);
          const size = file.mimeType.includes('folder') ? '' : ` (${formatFileSize(file.size)})`;
          const modified = formatDate(file.modifiedTime);
          summary += `- **${file.name}** [${typeLabel}]${size}\n`;
          summary += `  Modifie: ${modified} | ID: ${file.id}\n`;
          if (file.webViewLink) {
            summary += `  Lien: ${file.webViewLink}\n`;
          }
        }
      } else {
        summary += `_Aucun fichier trouve pour "${action.query}"._\n`;
      }
      
      return {
        success: true,
        type: 'search',
        data: { files, query: action.query },
        summary
      };
    } catch (error: any) {
      console.error('[DriveAction] Search error:', error);
      return {
        success: false,
        type: 'search',
        summary: `Erreur lors de la recherche "${action.query}"`,
        error: error.message || 'Erreur inconnue'
      };
    }
  }

  private async executeRecentAction(action: DriveRecentAction): Promise<DriveActionResult> {
    try {
      const limit = action.limit || 10;
      console.log(`[DriveAction] Getting ${limit} recent files`);
      
      const files = await driveService.getRecentFiles(limit);
      
      let summary = `**Google Drive - Fichiers recents**\n`;
      summary += `${files.length} fichier(s) recent(s)\n\n`;
      
      if (files.length > 0) {
        for (const file of files) {
          const typeLabel = getMimeTypeLabel(file.mimeType);
          const size = file.mimeType.includes('folder') ? '' : ` (${formatFileSize(file.size)})`;
          const modified = formatDate(file.modifiedTime);
          summary += `- **${file.name}** [${typeLabel}]${size}\n`;
          summary += `  Modifie: ${modified} | ID: ${file.id}\n`;
        }
      } else {
        summary += '_Aucun fichier recent._\n';
      }
      
      return {
        success: true,
        type: 'recent',
        data: { files },
        summary
      };
    } catch (error: any) {
      console.error('[DriveAction] Recent files error:', error);
      return {
        success: false,
        type: 'recent',
        summary: 'Erreur lors de la recuperation des fichiers recents',
        error: error.message || 'Erreur inconnue'
      };
    }
  }

  private async executeCreateFolderAction(action: DriveCreateFolderAction): Promise<DriveActionResult> {
    try {
      console.log(`[DriveAction] Creating folder: ${action.name}`);
      
      const folder = await driveService.createFolder(action.name, action.parentId || 'root');
      
      if (!folder) {
        throw new Error('Echec de la creation du dossier');
      }
      
      let summary = `**Dossier cree avec succes**\n\n`;
      summary += `- Nom: **${folder.name}**\n`;
      summary += `- ID: ${folder.id}\n`;
      if (folder.webViewLink) {
        summary += `- Lien: ${folder.webViewLink}\n`;
      }
      
      return {
        success: true,
        type: 'create_folder',
        data: { folder },
        summary
      };
    } catch (error: any) {
      console.error('[DriveAction] Create folder error:', error);
      return {
        success: false,
        type: 'create_folder',
        summary: `Erreur lors de la creation du dossier "${action.name}"`,
        error: error.message || 'Erreur inconnue'
      };
    }
  }

  private async executeCreateDocAction(action: DriveCreateDocAction): Promise<DriveActionResult> {
    try {
      console.log(`[DriveAction] Creating Google Doc: ${action.name}`);
      
      const doc = await driveService.createGoogleDoc(action.name, action.parentId || 'root');
      
      if (!doc) {
        throw new Error('Echec de la creation du document');
      }
      
      let summary = `**Google Doc cree avec succes**\n\n`;
      summary += `- Nom: **${doc.name}**\n`;
      summary += `- ID: ${doc.id}\n`;
      if (doc.webViewLink) {
        summary += `- Lien pour editer: ${doc.webViewLink}\n`;
      }
      
      return {
        success: true,
        type: 'create_doc',
        data: { doc },
        summary
      };
    } catch (error: any) {
      console.error('[DriveAction] Create doc error:', error);
      return {
        success: false,
        type: 'create_doc',
        summary: `Erreur lors de la creation du document "${action.name}"`,
        error: error.message || 'Erreur inconnue'
      };
    }
  }

  private async executeCreateSheetAction(action: DriveCreateSheetAction): Promise<DriveActionResult> {
    try {
      console.log(`[DriveAction] Creating Google Sheet: ${action.name}`);
      
      const sheet = await driveService.createGoogleSheet(action.name, action.parentId || 'root');
      
      if (!sheet) {
        throw new Error('Echec de la creation de la feuille');
      }
      
      let summary = `**Google Sheet cree avec succes**\n\n`;
      summary += `- Nom: **${sheet.name}**\n`;
      summary += `- ID: ${sheet.id}\n`;
      if (sheet.webViewLink) {
        summary += `- Lien pour editer: ${sheet.webViewLink}\n`;
      }
      
      return {
        success: true,
        type: 'create_sheet',
        data: { sheet },
        summary
      };
    } catch (error: any) {
      console.error('[DriveAction] Create sheet error:', error);
      return {
        success: false,
        type: 'create_sheet',
        summary: `Erreur lors de la creation de la feuille "${action.name}"`,
        error: error.message || 'Erreur inconnue'
      };
    }
  }

  private async executeTrashAction(action: DriveTrashAction): Promise<DriveActionResult> {
    try {
      console.log(`[DriveAction] Trashing file: ${action.fileId}`);
      
      const success = await driveService.trashFile(action.fileId);
      
      if (!success) {
        throw new Error('Echec de la suppression');
      }
      
      return {
        success: true,
        type: 'trash',
        data: { fileId: action.fileId },
        summary: `**Fichier supprime (mis a la corbeille)**\n\nID: ${action.fileId}`
      };
    } catch (error: any) {
      console.error('[DriveAction] Trash error:', error);
      return {
        success: false,
        type: 'trash',
        summary: `Erreur lors de la suppression du fichier`,
        error: error.message || 'Erreur inconnue'
      };
    }
  }

  private async executeQuotaAction(): Promise<DriveActionResult> {
    try {
      console.log('[DriveAction] Getting storage quota');
      
      const quota = await driveService.getStorageQuota();
      
      if (!quota) {
        throw new Error('Impossible de recuperer les informations de stockage');
      }
      
      let summary = `**Google Drive - Espace de stockage**\n\n`;
      summary += `- Utilise: ${formatFileSize(quota.used.toString())}\n`;
      summary += `- Total: ${formatFileSize(quota.total.toString())}\n`;
      summary += `- Pourcentage utilise: ${quota.usedPercent}%\n`;
      
      return {
        success: true,
        type: 'quota',
        data: { quota },
        summary
      };
    } catch (error: any) {
      console.error('[DriveAction] Quota error:', error);
      return {
        success: false,
        type: 'quota',
        summary: 'Erreur lors de la recuperation du quota',
        error: error.message || 'Erreur inconnue'
      };
    }
  }

  stripDriveMarkers(text: string): string {
    return text
      .replace(LIST_DRIVE_PATTERN, '')
      .replace(SEARCH_DRIVE_PATTERN, '')
      .replace(RECENT_DRIVE_PATTERN, '')
      .replace(CREATE_FOLDER_PATTERN, '')
      .replace(CREATE_DOC_PATTERN, '')
      .replace(CREATE_SHEET_PATTERN, '')
      .replace(TRASH_DRIVE_PATTERN, '')
      .replace(QUOTA_DRIVE_PATTERN, '')
      .trim();
  }

  formatResultForUser(result: DriveActionResult): string {
    if (result.success) {
      return `\n\n${result.summary}`;
    } else {
      return `\n\n**Erreur Google Drive:** ${result.error || result.summary}`;
    }
  }
}

export const driveActionService = new DriveActionService();
