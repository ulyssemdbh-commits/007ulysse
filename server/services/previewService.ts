import { broadcastToUser } from "./realtimeSync";

export type PreviewContentType = "image" | "text" | "markdown" | "pdf" | "file";

export interface PreviewRequest {
  id: string;
  type: PreviewContentType;
  title: string;
  content: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  metadata?: {
    filename?: string;
    mimeType?: string;
    source?: string;
    fileSize?: number;
  };
}

interface PendingPreview {
  request: PreviewRequest;
  userId: number;
  resolve: (confirmed: boolean) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

const pendingPreviews = new Map<string, PendingPreview>();

const PREVIEW_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function generatePreviewId(): string {
  return `preview-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export async function requestPreview(
  userId: number,
  options: Omit<PreviewRequest, "id">
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const id = generatePreviewId();
    const request: PreviewRequest = { id, ...options };
    
    const timeout = setTimeout(() => {
      pendingPreviews.delete(id);
      console.log(`[PreviewService] Preview ${id} timed out`);
      resolve(false);
    }, PREVIEW_TIMEOUT_MS);
    
    pendingPreviews.set(id, {
      request,
      userId,
      resolve,
      reject,
      timeout
    });
    
    console.log(`[PreviewService] Sending preview request ${id} to user ${userId}`);
    
    broadcastToUser(userId, {
      type: "preview.request",
      userId,
      data: request,
      timestamp: Date.now()
    });
  });
}

export async function requestImagePreview(
  userId: number,
  imageUrl: string,
  title: string,
  options?: {
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
  }
): Promise<boolean> {
  return requestPreview(userId, {
    type: "image",
    title,
    content: imageUrl,
    ...options
  });
}

export async function requestTextPreview(
  userId: number,
  text: string,
  title: string,
  options?: {
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
  }
): Promise<boolean> {
  return requestPreview(userId, {
    type: "text",
    title,
    content: text,
    ...options
  });
}

export async function requestMarkdownPreview(
  userId: number,
  markdown: string,
  title: string,
  options?: {
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
  }
): Promise<boolean> {
  return requestPreview(userId, {
    type: "markdown",
    title,
    content: markdown,
    ...options
  });
}

export async function requestFilePreview(
  userId: number,
  fileUrl: string,
  title: string,
  metadata?: PreviewRequest["metadata"],
  options?: {
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
  }
): Promise<boolean> {
  return requestPreview(userId, {
    type: "file",
    title,
    content: fileUrl,
    metadata,
    ...options
  });
}

export function handlePreviewResponse(requestId: string, confirmed: boolean): boolean {
  const pending = pendingPreviews.get(requestId);
  
  if (!pending) {
    console.log(`[PreviewService] No pending preview found for ${requestId}`);
    return false;
  }
  
  clearTimeout(pending.timeout);
  pendingPreviews.delete(requestId);
  
  console.log(`[PreviewService] Preview ${requestId} ${confirmed ? "confirmed" : "cancelled"}`);
  pending.resolve(confirmed);
  
  return true;
}

export function cancelPendingPreview(requestId: string): boolean {
  const pending = pendingPreviews.get(requestId);
  
  if (!pending) {
    return false;
  }
  
  clearTimeout(pending.timeout);
  pendingPreviews.delete(requestId);
  pending.resolve(false);
  
  return true;
}

export function getPendingPreviewsForUser(userId: number): PreviewRequest[] {
  const userPreviews: PreviewRequest[] = [];
  
  pendingPreviews.forEach((pending) => {
    if (pending.userId === userId) {
      userPreviews.push(pending.request);
    }
  });
  
  return userPreviews;
}

export function hasPendingPreviews(userId: number): boolean {
  let found = false;
  pendingPreviews.forEach((pending) => {
    if (pending.userId === userId) {
      found = true;
    }
  });
  return found;
}
