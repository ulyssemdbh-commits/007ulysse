import { codeSnapshotService } from "./codeSnapshot";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

interface CodeContextAccess {
  timestamp: Date;
  userId: number;
  reason: "auto_diagnostics" | "owner_request" | "conversation_context";
  component?: string;
  filesAccessed?: string[];
}

const CODE_KEYWORDS = [
  "code", "codebase", "implementation", "function", "method", "class",
  "bug", "error", "fix", "debug", "issue", "problem", "crash",
  "file", "source", "script", "component", "service", "route",
  "backend", "frontend", "server", "client", "api", "endpoint",
  "analyze", "review", "check", "examine", "look at", "inspect",
  "improve", "optimize", "refactor", "update", "modify", "change",
  "schema", "database", "migration", "table", "column",
  "hook", "state", "props", "render", "style", "css",
  "typescript", "javascript", "react", "express", "node"
];

const DIAGNOSTIC_KEYWORDS = [
  "diagnostic", "health", "status", "monitor", "performance",
  "memory", "cpu", "latency", "slow", "fast", "speed",
  "working", "broken", "failing", "success", "failure"
];

const accessLog: CodeContextAccess[] = [];
const MAX_ACCESS_LOG = 100;
const CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CONTEXT_LENGTH = 50000;
const MAX_FILES_PER_REQUEST = 10;
const ACCESS_RATE_LIMIT_PER_HOUR = 20;
const accessCountPerHour = new Map<number, { count: number; resetAt: number }>();

const ALLOWED_FILE_PATTERNS = [
  /^server\//,
  /^client\/src\//,
  /^shared\//,
  /^replit\.md$/,
  /^package\.json$/,
  /^tsconfig\.json$/,
];

interface CachedContext {
  content: string;
  timestamp: number;
  ownerId: number;
}

let cachedContext: CachedContext | null = null;

async function getOwnerId(): Promise<number | null> {
  const [owner] = await db.select().from(users).where(eq(users.isOwner, true));
  return owner?.id || null;
}

async function isUserOwner(userId: number): Promise<boolean> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  return user?.isOwner || false;
}

function logAccess(access: CodeContextAccess): void {
  accessLog.unshift(access);
  if (accessLog.length > MAX_ACCESS_LOG) {
    accessLog.pop();
  }
  console.log(`[CODE_CONTEXT] Auto-access: userId=${access.userId}, reason=${access.reason}, files=${access.filesAccessed?.length || 0}`);
}

function checkAccessRateLimit(userId: number): boolean {
  const now = Date.now();
  const userLimit = accessCountPerHour.get(userId);
  
  if (!userLimit || now > userLimit.resetAt) {
    accessCountPerHour.set(userId, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  
  if (userLimit.count >= ACCESS_RATE_LIMIT_PER_HOUR) {
    console.warn(`[CODE_CONTEXT] Rate limit exceeded for user ${userId}`);
    return false;
  }
  
  userLimit.count++;
  return true;
}

function isFileAllowed(filePath: string): boolean {
  return ALLOWED_FILE_PATTERNS.some(pattern => pattern.test(filePath));
}

function sanitizeSpecificFiles(files?: string[]): string[] | undefined {
  if (!files || files.length === 0) return undefined;
  
  const sanitized = files
    .filter(f => isFileAllowed(f))
    .slice(0, MAX_FILES_PER_REQUEST);
  
  return sanitized.length > 0 ? sanitized : undefined;
}

function containsCodeKeywords(text: string): boolean {
  const lower = text.toLowerCase();
  return CODE_KEYWORDS.some(kw => lower.includes(kw));
}

function containsDiagnosticKeywords(text: string): boolean {
  const lower = text.toLowerCase();
  return DIAGNOSTIC_KEYWORDS.some(kw => lower.includes(kw));
}

function extractFileReferences(text: string): string[] {
  const patterns = [
    /[a-zA-Z0-9_-]+\.(ts|tsx|js|jsx|css|json|md)/g,
    /(?:server|client|shared)\/[a-zA-Z0-9_\-/.]+/g,
  ];
  
  const files: string[] = [];
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      files.push(...matches);
    }
  }
  return Array.from(new Set(files));
}

export const codeContextOrchestrator = {
  shouldInjectCodeContext(message: string, isOwnerUser: boolean): {
    shouldInject: boolean;
    reason?: "auto_diagnostics" | "owner_request" | "conversation_context";
    specificFiles?: string[];
  } {
    if (!isOwnerUser) {
      return { shouldInject: false };
    }

    const hasCodeKeywords = containsCodeKeywords(message);
    const hasDiagnosticKeywords = containsDiagnosticKeywords(message);
    const fileRefs = extractFileReferences(message);

    if (hasCodeKeywords && hasDiagnosticKeywords) {
      return { 
        shouldInject: true, 
        reason: "auto_diagnostics",
        specificFiles: fileRefs.length > 0 ? fileRefs : undefined
      };
    }

    if (hasCodeKeywords) {
      return { 
        shouldInject: true, 
        reason: "owner_request",
        specificFiles: fileRefs.length > 0 ? fileRefs : undefined
      };
    }

    if (fileRefs.length > 0) {
      return {
        shouldInject: true,
        reason: "conversation_context",
        specificFiles: fileRefs
      };
    }

    return { shouldInject: false };
  },

  async getCodeContextForOwner(
    userId: number,
    reason: "auto_diagnostics" | "owner_request" | "conversation_context",
    specificFiles?: string[]
  ): Promise<string | null> {
    const isOwner = await isUserOwner(userId);
    if (!isOwner) {
      console.warn(`[CODE_CONTEXT] Non-owner user ${userId} attempted to access code context`);
      return null;
    }

    if (!checkAccessRateLimit(userId)) {
      console.warn(`[CODE_CONTEXT] Rate limit exceeded for owner ${userId}`);
      return null;
    }

    const sanitizedFiles = sanitizeSpecificFiles(specificFiles);

    if (cachedContext && 
        cachedContext.ownerId === userId && 
        Date.now() - cachedContext.timestamp < CONTEXT_CACHE_TTL_MS &&
        !sanitizedFiles) {
      logAccess({
        timestamp: new Date(),
        userId,
        reason,
        filesAccessed: ["cached"]
      });
      return cachedContext.content;
    }

    const context = await codeSnapshotService.getCodeContext(userId, sanitizedFiles);
    
    if (!context) {
      return null;
    }

    let truncatedContext = context;
    if (context.length > MAX_CONTEXT_LENGTH) {
      truncatedContext = context.substring(0, MAX_CONTEXT_LENGTH) + "\n\n[... truncated for performance ...]";
    }

    if (!sanitizedFiles) {
      cachedContext = {
        content: truncatedContext,
        timestamp: Date.now(),
        ownerId: userId
      };
    }

    logAccess({
      timestamp: new Date(),
      userId,
      reason,
      filesAccessed: sanitizedFiles
    });

    return truncatedContext;
  },

  async getCodeContextForDiagnostics(
    userId: number,
    component: string,
    issueDescription: string
  ): Promise<string | null> {
    const isOwner = await isUserOwner(userId);
    if (!isOwner) {
      return null;
    }

    const componentFileMap: Record<string, string[]> = {
      "voice": ["client/src/hooks/use-voice.ts", "server/replit_integrations/chat/routes.ts"],
      "chat": ["server/replit_integrations/chat/routes.ts", "client/src/pages/Dashboard.tsx"],
      "memory": ["server/services/memory.ts", "shared/schema/index.ts"],
      "database": ["shared/schema/index.ts", "server/storage.ts", "server/db.ts"],
      "auth": ["server/middleware/auth.ts", "server/routes.ts"],
      "diagnostics": ["server/services/diagnostics.ts"]
    };

    const relevantFiles = componentFileMap[component] || [];
    const issueFiles = extractFileReferences(issueDescription);
    const allFiles = Array.from(new Set([...relevantFiles, ...issueFiles]));

    if (allFiles.length === 0) {
      return null;
    }

    return this.getCodeContextForOwner(userId, "auto_diagnostics", allFiles);
  },

  async checkAndGetContextForMessage(
    userId: number,
    message: string
  ): Promise<{ context: string | null; reason?: string }> {
    const isOwner = await isUserOwner(userId);
    if (!isOwner) {
      return { context: null };
    }

    const analysis = this.shouldInjectCodeContext(message, true);
    
    if (!analysis.shouldInject || !analysis.reason) {
      return { context: null };
    }

    const context = await this.getCodeContextForOwner(
      userId, 
      analysis.reason, 
      analysis.specificFiles
    );

    return { 
      context, 
      reason: analysis.reason 
    };
  },

  getAccessLog(): CodeContextAccess[] {
    return [...accessLog];
  },

  getRecentAccessCount(minutesAgo: number = 60): number {
    const cutoff = Date.now() - (minutesAgo * 60 * 1000);
    return accessLog.filter(a => a.timestamp.getTime() > cutoff).length;
  },

  clearCache(): void {
    cachedContext = null;
  }
};
 