/**
 * Google Drive Service - Direct API
 * Manages files and documents in Google Drive
 */

import { google, drive_v3 } from 'googleapis';
import { connectorBridge } from './connectorBridge';

let cachedToken: string | null = null;
let lastTokenFetch = 0;
let driveCircuitOpen = false;
let driveCircuitUntil = 0;
const DRIVE_CIRCUIT_DURATION = 60 * 60 * 1000;

function isDriveCircuitOpen(): boolean {
  if (!driveCircuitOpen) return false;
  if (Date.now() > driveCircuitUntil) {
    driveCircuitOpen = false;
    console.log('[GoogleDrive] Circuit breaker reset');
    return false;
  }
  return true;
}

function tripDriveCircuit(reason: string): void {
  driveCircuitOpen = true;
  driveCircuitUntil = Date.now() + DRIVE_CIRCUIT_DURATION;
  console.warn(`[GoogleDrive] Circuit breaker OPEN for 1h — ${reason}`);
}

async function getAccessToken(): Promise<string> {
  if (isDriveCircuitOpen()) {
    throw new Error('Google Drive circuit breaker open. Will retry later.');
  }

  const now = Date.now();
  if (cachedToken && now - lastTokenFetch < 300000) return cachedToken;

  const conn = await connectorBridge.getGoogleDrive();
  if (conn.source === 'none' || !conn.accessToken) {
    tripDriveCircuit('not configured');
    throw new Error('Google Drive not configured. Set GOOGLE_ACCESS_TOKEN.');
  }

  if (conn.refreshToken && conn.clientId && conn.clientSecret) {
    try {
      const oauth2 = new google.auth.OAuth2(conn.clientId, conn.clientSecret);
      oauth2.setCredentials({ refresh_token: conn.refreshToken });
      const { credentials } = await oauth2.refreshAccessToken();
      cachedToken = credentials.access_token || conn.accessToken;
    } catch { cachedToken = conn.accessToken; }
  } else {
    cachedToken = conn.accessToken;
  }

  lastTokenFetch = now;
  return cachedToken!;
}

async function getUncachableGoogleDriveClient(): Promise<drive_v3.Drive> {
  const accessToken = await getAccessToken();

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: accessToken
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parents?: string[];
}

export interface DriveSearchResult {
  files: DriveFile[];
  nextPageToken?: string;
}

/**
 * Check if Google Drive is connected and available
 */
export async function checkDriveConnection(): Promise<boolean> {
  if (isDriveCircuitOpen()) return false;
  try {
    const drive = await getUncachableGoogleDriveClient();
    await drive.about.get({ fields: 'user' });
    return true;
  } catch (error: any) {
    const status = error?.response?.status || error?.code || error?.status;
    if (status === 401 || status === 403 || (error?.message && (error.message.includes('Invalid Credentials') || error.message.includes('invalid_token')))) {
      tripDriveCircuit(`${status} ${error?.message?.substring(0, 50) || 'auth error'}`);
    }
    console.warn('[GoogleDrive] Connection check failed:', error?.message || 'unknown');
    return false;
  }
}

/**
 * List files in a folder (default: root)
 */
export async function listFiles(
  folderId: string = 'root',
  pageSize: number = 20,
  pageToken?: string
): Promise<DriveSearchResult> {
  const drive = await getUncachableGoogleDriveClient();
  
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink, parents)',
    pageSize,
    pageToken,
    orderBy: 'modifiedTime desc'
  });

  return {
    files: (response.data.files || []) as DriveFile[],
    nextPageToken: response.data.nextPageToken || undefined
  };
}

/**
 * Escape a string for use in Drive query literals
 */
function escapeDriveQueryLiteral(str: string): string {
  // Escape single quotes and backslashes for Drive API q parameter
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Search files by name or content
 */
export async function searchFiles(
  query: string,
  pageSize: number = 20
): Promise<DriveSearchResult> {
  const drive = await getUncachableGoogleDriveClient();
  const escapedQuery = escapeDriveQueryLiteral(query);
  
  const response = await drive.files.list({
    q: `name contains '${escapedQuery}' and trashed = false`,
    fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink, parents)',
    pageSize,
    orderBy: 'modifiedTime desc'
  });

  return {
    files: (response.data.files || []) as DriveFile[],
    nextPageToken: response.data.nextPageToken || undefined
  };
}

/**
 * Get file metadata by ID
 */
export async function getFileMetadata(fileId: string): Promise<DriveFile | null> {
  try {
    const drive = await getUncachableGoogleDriveClient();
    
    const response = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType, size, modifiedTime, webViewLink, parents'
    });

    return response.data as DriveFile;
  } catch (error) {
    console.error('[GoogleDrive] Get file metadata failed:', error);
    return null;
  }
}

/**
 * Create a new folder
 */
export async function createFolder(
  name: string,
  parentId: string = 'root'
): Promise<DriveFile | null> {
  try {
    const drive = await getUncachableGoogleDriveClient();
    
    const response = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId]
      },
      fields: 'id, name, mimeType, webViewLink, parents'
    });

    console.log(`[GoogleDrive] Created folder: ${name}`);
    return response.data as DriveFile;
  } catch (error) {
    console.error('[GoogleDrive] Create folder failed:', error);
    return null;
  }
}

/**
 * Create a new Google Doc (empty document - edit content in Google Docs)
 */
export async function createGoogleDoc(
  name: string,
  parentId: string = 'root'
): Promise<DriveFile | null> {
  try {
    const drive = await getUncachableGoogleDriveClient();
    
    const response = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.document',
        parents: [parentId]
      },
      fields: 'id, name, mimeType, webViewLink, parents'
    });

    console.log(`[GoogleDrive] Created Google Doc: ${name}`);
    return response.data as DriveFile;
  } catch (error) {
    console.error('[GoogleDrive] Create Google Doc failed:', error);
    return null;
  }
}

/**
 * Create a new Google Sheet
 */
export async function createGoogleSheet(
  name: string,
  parentId: string = 'root'
): Promise<DriveFile | null> {
  try {
    const drive = await getUncachableGoogleDriveClient();
    
    const response = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: [parentId]
      },
      fields: 'id, name, mimeType, webViewLink, parents'
    });

    console.log(`[GoogleDrive] Created Google Sheet: ${name}`);
    return response.data as DriveFile;
  } catch (error) {
    console.error('[GoogleDrive] Create Google Sheet failed:', error);
    return null;
  }
}

/**
 * Delete a file (move to trash)
 */
export async function trashFile(fileId: string): Promise<boolean> {
  try {
    const drive = await getUncachableGoogleDriveClient();
    
    await drive.files.update({
      fileId,
      requestBody: {
        trashed: true
      }
    });

    console.log(`[GoogleDrive] Trashed file: ${fileId}`);
    return true;
  } catch (error) {
    console.error('[GoogleDrive] Trash file failed:', error);
    return false;
  }
}

/**
 * Get recent files
 */
export async function getRecentFiles(limit: number = 10): Promise<DriveFile[]> {
  const drive = await getUncachableGoogleDriveClient();
  
  const response = await drive.files.list({
    q: 'trashed = false',
    fields: 'files(id, name, mimeType, size, modifiedTime, webViewLink)',
    pageSize: limit,
    orderBy: 'viewedByMeTime desc'
  });

  return (response.data.files || []) as DriveFile[];
}

/**
 * Get storage quota info
 */
export async function getStorageQuota(): Promise<{
  used: number;
  total: number;
  usedPercent: number;
} | null> {
  try {
    const drive = await getUncachableGoogleDriveClient();
    
    const response = await drive.about.get({
      fields: 'storageQuota'
    });

    const quota = response.data.storageQuota;
    if (!quota || !quota.usage || !quota.limit) {
      return null;
    }

    const used = parseInt(quota.usage);
    const total = parseInt(quota.limit);
    
    return {
      used,
      total,
      usedPercent: Math.round((used / total) * 100)
    };
  } catch (error) {
    console.error('[GoogleDrive] Get storage quota failed:', error);
    return null;
  }
}

export default {
  checkDriveConnection,
  listFiles,
  searchFiles,
  getFileMetadata,
  createFolder,
  createGoogleDoc,
  createGoogleSheet,
  trashFile,
  getRecentFiles,
  getStorageQuota
};
