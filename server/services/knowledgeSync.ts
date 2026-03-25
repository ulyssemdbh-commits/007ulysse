import { db } from "../db";
import { ulysseMemory, ulysseState } from "@shared/schema";
import { eq } from "drizzle-orm";

interface SystemKnowledge {
  category: string;
  key: string;
  value: string;
}

const SYSTEM_KNOWLEDGE: SystemKnowledge[] = [
  {
    category: "infrastructure",
    key: "serveur_dedie",
    value: "Ulysse dispose de deux déploiements indépendants: Replit (dev) et Hetzner AX42 (prod: https://ulyssepro.org). Fonctionnalités: WebSockets stables, 15+ jobs automatiques, cache LRU intelligent, rate limiting API, base de données PostgreSQL, AI System Integration avec auto-diagnostic."
  },
  {
    category: "infrastructure", 
    key: "api_v2",
    value: "API V2 disponible avec: multi-device auth (JWT 15min + refresh 30j), conversations unifiées cross-device, daily summaries, email via AgentMail. Endpoints: /api/v2/devices, /api/v2/conversations, /api/v2/summary/today, /api/v2/emails/last, /api/v2/health"
  },
  {
    category: "infrastructure",
    key: "capabilities_serveur", 
    value: "Capacités serveur: Cache LRU (5min général, 30min summaries, 10min emails), Rate limiting par endpoint (auth:10/15min, chat:20/min, upload:10/min, v2:60/min), Job scheduler automatique pour homework et maintenance"
  },
  {
    category: "infrastructure",
    key: "voice_capabilities",
    value: "Capacités vocales: STT hybride (SpeechRecognition + Whisper fallback), TTS OpenAI (voix: alloy, echo, fable, onyx, nova, shimmer) + fallback navigateur, anti-écho intelligent, gestion iOS spécifique avec mode push-to-talk"
  },
  {
    category: "infrastructure",
    key: "pwa_mobile",
    value: "Application PWA installable sur mobile: service worker avec cache offline, manifest avec shortcuts, synchronisation temps réel via WebSockets /ws/voice et /ws/sync"
  },
  {
    category: "infrastructure",
    key: "geolocation_system",
    value: "Système de géolocalisation temps réel actif: API à /api/v2/location, tracking GPS avec consentement (modes: haute précision, équilibré, économie batterie), géofences circulaires avec triggers entrée/sortie, actions automatisées liées aux homework, historique configurable (30 jours par défaut), nettoyage automatique des anciennes données, contexte de position injecté dans mes réponses"
  }
];

export async function syncSystemKnowledge(ownerUserId: number): Promise<void> {
  console.log("[KnowledgeSync] Starting system knowledge sync...");
  
  try {
    for (const knowledge of SYSTEM_KNOWLEDGE) {
      const existing = await db.select()
        .from(ulysseMemory)
        .where(eq(ulysseMemory.key, knowledge.key))
        .limit(1);
      
      if (existing.length === 0) {
        await db.insert(ulysseMemory).values({
          userId: ownerUserId,
          category: knowledge.category,
          key: knowledge.key,
          value: knowledge.value,
          confidence: 100,
          source: "system_auto_sync"
        });
        console.log(`[KnowledgeSync] Added: ${knowledge.key}`);
      } else if (existing[0].value !== knowledge.value) {
        await db.update(ulysseMemory)
          .set({ 
            value: knowledge.value, 
            updatedAt: new Date(),
            source: "system_auto_sync"
          })
          .where(eq(ulysseMemory.key, knowledge.key));
        console.log(`[KnowledgeSync] Updated: ${knowledge.key}`);
      }
    }
    
    const now = new Date();
    const existingState = await db.select()
      .from(ulysseState)
      .where(eq(ulysseState.userId, ownerUserId))
      .limit(1);
    
    if (existingState.length > 0) {
      await db.update(ulysseState)
        .set({ lastInteraction: now })
        .where(eq(ulysseState.userId, ownerUserId));
    }
    
    console.log(`[KnowledgeSync] Sync complete at ${now.toISOString()}`);
  } catch (error) {
    console.error("[KnowledgeSync] Sync failed:", error);
  }
}

export async function getOwnerUserId(): Promise<number | null> {
  try {
    const result = await db.query.users.findFirst({
      where: (users, { eq }) => eq(users.isOwner, true)
    });
    return result?.id ?? null;
  } catch {
    return 1;
  }
}
