/**
 * VOICE CONTEXT MEMORY V3 PRO
 * 
 * Mémoire conversationnelle vocale pour résolution de références.
 * Permet de comprendre "Et le prochain ?" après "Score du dernier match de l'OM"
 * 
 * Features:
 * - 5 derniers sujets en mémoire par session
 * - Résolution de références ("il", "ça", "le prochain", "et lui ?")
 * - Contexte par domaine (foot, sugu, etc.)
 * - TTL automatique (expire après 10 minutes d'inactivité)
 */

export interface ContextSubject {
  domain: string;
  type: string;
  entity: string;
  entityType: "team" | "league" | "player" | "restaurant" | "location" | "person" | "generic";
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface VoiceSessionContext {
  userId: number;
  subjects: ContextSubject[];
  lastActivity: number;
  conversationTurn: number;
}

const SESSION_TTL = 10 * 60 * 1000; // 10 minutes
const MAX_SUBJECTS = 5;

const sessionContexts = new Map<number, VoiceSessionContext>();

// Reference patterns for each language
const REFERENCE_PATTERNS = {
  // Pronouns and demonstratives
  pronouns: [
    /\b(il|elle|ils|elles|lui|leur)\b/i,
    /\b(ça|cela|ceci|celui-ci|celle-ci)\b/i,
    /\b(le même|la même|les mêmes)\b/i,
  ],
  // Elliptical references
  elliptical: [
    /\bet\s+(le|la|les|l')\s*(prochain|prochaine|suivant|suivante)\b/i,
    /\bet\s+(celui|celle|ceux)\s*(d'avant|d'après)\b/i,
    /\bet\s+(maintenant|hier|demain|aujourd'hui)\b/i,
    /\bquoi\s+d'autre\b/i,
    /\bet\s+pour\b/i,
    /\bpareil\s+pour\b/i,
  ],
  // Implicit team/player references
  implicit: [
    /\b(leur|son|sa|ses)\s+(match|score|classement|buteur|joueur)\b/i,
    /\b(chez|pour)\s+(eux|lui|elle)\b/i,
  ],
};

export function getSessionContext(userId: number): VoiceSessionContext {
  let context = sessionContexts.get(userId);
  
  if (!context || Date.now() - context.lastActivity > SESSION_TTL) {
    context = {
      userId,
      subjects: [],
      lastActivity: Date.now(),
      conversationTurn: 0,
    };
    sessionContexts.set(userId, context);
  }
  
  return context;
}

export function addContextSubject(
  userId: number, 
  subject: Omit<ContextSubject, "timestamp">
): void {
  const context = getSessionContext(userId);
  
  // Remove duplicate entities
  context.subjects = context.subjects.filter(
    s => !(s.entity === subject.entity && s.entityType === subject.entityType)
  );
  
  // Add new subject at the beginning
  context.subjects.unshift({
    ...subject,
    timestamp: Date.now(),
  });
  
  // Keep only last N subjects
  if (context.subjects.length > MAX_SUBJECTS) {
    context.subjects = context.subjects.slice(0, MAX_SUBJECTS);
  }
  
  context.lastActivity = Date.now();
  context.conversationTurn++;
  
  console.log(`[VoiceContext] Added subject: ${subject.entityType}="${subject.entity}" (${context.subjects.length} total)`);
}

export function getLastSubjectByType(
  userId: number, 
  entityType: ContextSubject["entityType"]
): ContextSubject | null {
  const context = getSessionContext(userId);
  return context.subjects.find(s => s.entityType === entityType) || null;
}

export function getLastSubjectByDomain(
  userId: number, 
  domain: string
): ContextSubject | null {
  const context = getSessionContext(userId);
  return context.subjects.find(s => s.domain === domain) || null;
}

export function getMostRecentSubject(userId: number): ContextSubject | null {
  const context = getSessionContext(userId);
  return context.subjects[0] || null;
}

export function hasReferencePattern(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  
  for (const patterns of Object.values(REFERENCE_PATTERNS)) {
    if (patterns.some(p => p.test(lowerMessage))) {
      return true;
    }
  }
  
  return false;
}

export function resolveReferences(
  userId: number, 
  message: string
): { resolvedMessage: string; usedContext: ContextSubject | null } {
  const context = getSessionContext(userId);
  const lowerMessage = message.toLowerCase();
  
  if (context.subjects.length === 0) {
    return { resolvedMessage: message, usedContext: null };
  }
  
  let resolvedMessage = message;
  let usedContext: ContextSubject | null = null;
  
  // Check for elliptical references like "et le prochain ?"
  const nextMatchPattern = /\b(et\s+)?(le\s+)?(prochain|prochaine|suivant|suivante)\s*\??\s*$/i;
  if (nextMatchPattern.test(lowerMessage)) {
    const lastTeam = getLastSubjectByType(userId, "team");
    if (lastTeam) {
      resolvedMessage = `prochain match de ${lastTeam.entity}`;
      usedContext = lastTeam;
      console.log(`[VoiceContext] Resolved "prochain" → "${resolvedMessage}"`);
    }
  }
  
  // Check for "et le dernier ?"
  const lastMatchPattern = /\b(et\s+)?(le\s+)?(dernier|précédent|avant)\s*\??\s*$/i;
  if (lastMatchPattern.test(lowerMessage)) {
    const lastTeam = getLastSubjectByType(userId, "team");
    if (lastTeam) {
      resolvedMessage = `dernier match de ${lastTeam.entity}`;
      usedContext = lastTeam;
      console.log(`[VoiceContext] Resolved "dernier" → "${resolvedMessage}"`);
    }
  }
  
  // Check for "et lui ?" / "et eux ?"
  const pronounPattern = /\b(et\s+)?(lui|eux|elle|elles)\s*\??\s*$/i;
  if (pronounPattern.test(lowerMessage)) {
    const lastSubject = getMostRecentSubject(userId);
    if (lastSubject) {
      // Repeat the last query type with the same entity
      resolvedMessage = `${lastSubject.type} de ${lastSubject.entity}`;
      usedContext = lastSubject;
      console.log(`[VoiceContext] Resolved pronoun → "${resolvedMessage}"`);
    }
  }
  
  // Check for "pareil pour X"
  const sameForPattern = /\bpareil\s+pour\s+(.+)/i;
  const sameForMatch = lowerMessage.match(sameForPattern);
  if (sameForMatch && context.subjects.length > 0) {
    const newEntity = sameForMatch[1].trim();
    const lastSubject = getMostRecentSubject(userId);
    if (lastSubject) {
      resolvedMessage = `${lastSubject.type} de ${newEntity}`;
      console.log(`[VoiceContext] Resolved "pareil pour" → "${resolvedMessage}"`);
    }
  }
  
  // Check for implicit references in short messages
  if (message.split(/\s+/).length <= 3) {
    // Very short message, might need context
    const classementPattern = /\b(classement|ranking)\s*\??\s*$/i;
    if (classementPattern.test(lowerMessage)) {
      const lastLeague = getLastSubjectByType(userId, "league");
      if (lastLeague) {
        resolvedMessage = `classement ${lastLeague.entity}`;
        usedContext = lastLeague;
        console.log(`[VoiceContext] Resolved short "classement" → "${resolvedMessage}"`);
      }
    }
    
    const buteursPattern = /\b(buteurs?|meilleurs?\s+buteurs?)\s*\??\s*$/i;
    if (buteursPattern.test(lowerMessage)) {
      const lastLeague = getLastSubjectByType(userId, "league");
      if (lastLeague) {
        resolvedMessage = `meilleurs buteurs ${lastLeague.entity}`;
        usedContext = lastLeague;
        console.log(`[VoiceContext] Resolved short "buteurs" → "${resolvedMessage}"`);
      }
    }
  }
  
  return { resolvedMessage, usedContext };
}

export function clearSessionContext(userId: number): void {
  sessionContexts.delete(userId);
  console.log(`[VoiceContext] Cleared context for user ${userId}`);
}

export function getContextStats(): {
  activeSessions: number;
  totalSubjects: number;
  avgSubjectsPerSession: number;
} {
  const now = Date.now();
  let totalSubjects = 0;
  let activeSessions = 0;
  
  for (const [userId, context] of sessionContexts.entries()) {
    if (now - context.lastActivity < SESSION_TTL) {
      activeSessions++;
      totalSubjects += context.subjects.length;
    } else {
      // Clean up expired sessions
      sessionContexts.delete(userId);
    }
  }
  
  return {
    activeSessions,
    totalSubjects,
    avgSubjectsPerSession: activeSessions > 0 ? totalSubjects / activeSessions : 0,
  };
}

// Clean up expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [userId, context] of sessionContexts.entries()) {
    if (now - context.lastActivity > SESSION_TTL) {
      sessionContexts.delete(userId);
    }
  }
}, 60000); // Every minute
