/**
 * Voice Authentication Service - Pro Grade
 * 
 * Gère l'authentification vocale avec:
 * - Niveaux d'auth (reject/limited/full)
 * - Policies par action (SUGU, pronos, domotique...)
 * - Cache de session (30s)
 * - Intégration Speaker Service
 */

import fetch from "node-fetch";
import FormData from "form-data";
import {
  verifySpeaker,
  isSpeakerServiceAvailable,
  hasVoiceProfile,
  type VerificationResult,
} from "../speakerVerification";

const SPEAKER_SERVICE_URL = process.env.SPEAKER_SERVICE_URL || "http://localhost:5001";

// ============================================================================
// Types
// ============================================================================

export type VoiceAuthLevel = "reject" | "limited" | "full";

export type VoiceAction =
  | "generic_chat"
  | "private_info"
  | "sports_pronos"
  | "sugu_management"
  | "domotics_control"
  | "settings_change"
  | "email_access"
  | "calendar_access"
  | "file_access"
  | "memory_access";

export interface VoiceAuthResult {
  allowed: boolean;
  level: VoiceAuthLevel;
  confidence: number;
  reason?: string;
  serviceAvailable: boolean;
  profileReady: boolean;
}

export interface EnrollmentStatus {
  userId: string;
  sampleCount: number;
  minRequired: number;
  ready: boolean;
}

interface VoiceSession {
  level: VoiceAuthLevel;
  confidence: number;
  verified: boolean;  // SÉCURITÉ: On stocke aussi le flag verified
  lastVerifiedAt: number;
}

// ============================================================================
// Configuration
// ============================================================================

const VOICE_POLICY: Record<VoiceAction, VoiceAuthLevel> = {
  generic_chat: "limited",
  private_info: "full",
  sports_pronos: "full",
  sugu_management: "full",
  domotics_control: "full",
  settings_change: "full",
  email_access: "full",
  calendar_access: "full",
  file_access: "full",
  memory_access: "full",
};

const VOICE_SESSION_TTL_MS = 30 * 1000; // 30 secondes
const SPEAKER_SERVICE_CHECK_TTL_MS = 10 * 1000; // 10 secondes
const MIN_SAMPLES_REQUIRED = 5; // Pro: 5 samples minimum

// Seuils d'authentification (pro/exigeants)
const THRESHOLD_FULL = 0.85;
const THRESHOLD_LIMITED = 0.65;

// ============================================================================
// State
// ============================================================================

const voiceSessionCache = new Map<string, VoiceSession>();

let speakerServiceLastCheck = 0;
let speakerServiceAvailableCache = false;

// Compteur d'échecs pour détection d'anomalies
const failureCounter = new Map<string, { count: number; firstFailAt: number }>();
const FAILURE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_FAILURES_BEFORE_ALERT = 5;

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Convertit un score de confiance en niveau d'auth
 */
export function evaluateVoiceAuth(confidence: number): VoiceAuthLevel {
  if (confidence >= THRESHOLD_FULL) return "full";
  if (confidence >= THRESHOLD_LIMITED) return "limited";
  return "reject";
}

/**
 * Vérifie si le niveau atteint est suffisant pour l'action
 */
export function isVoiceAllowedFor(action: VoiceAction, level: VoiceAuthLevel): boolean {
  const required = VOICE_POLICY[action];
  if (required === "full") return level === "full";
  if (required === "limited") return level === "full" || level === "limited";
  return true;
}

/**
 * Retourne le niveau minimum requis pour une action
 */
export function getRequiredLevel(action: VoiceAction): VoiceAuthLevel {
  return VOICE_POLICY[action];
}

/**
 * Vérifie si le speaker service est disponible (avec cache)
 */
async function checkSpeakerService(): Promise<boolean> {
  const now = Date.now();
  if (now - speakerServiceLastCheck < SPEAKER_SERVICE_CHECK_TTL_MS) {
    return speakerServiceAvailableCache;
  }
  const available = await isSpeakerServiceAvailable();
  speakerServiceAvailableCache = available;
  speakerServiceLastCheck = now;
  return available;
}

/**
 * Récupère une session cachée si valide
 */
function getCachedSession(userId: string): VoiceSession | null {
  const sess = voiceSessionCache.get(userId);
  if (!sess) return null;
  if (Date.now() - sess.lastVerifiedAt > VOICE_SESSION_TTL_MS) {
    voiceSessionCache.delete(userId);
    return null;
  }
  return sess;
}

/**
 * Met en cache une session vocale
 */
function setCachedSession(userId: string, level: VoiceAuthLevel, confidence: number, verified: boolean) {
  voiceSessionCache.set(userId, {
    level,
    confidence,
    verified,
    lastVerifiedAt: Date.now(),
  });
}

/**
 * Invalide la session d'un utilisateur
 */
export function invalidateVoiceSession(userId: string): void {
  voiceSessionCache.delete(userId);
}

/**
 * Track les échecs pour détection d'anomalies
 */
function trackFailure(userId: string): boolean {
  const now = Date.now();
  const entry = failureCounter.get(userId);
  
  if (!entry || now - entry.firstFailAt > FAILURE_WINDOW_MS) {
    failureCounter.set(userId, { count: 1, firstFailAt: now });
    return false;
  }
  
  entry.count++;
  
  if (entry.count >= MAX_FAILURES_BEFORE_ALERT) {
    console.warn(`[VoiceAuth] ALERT: ${entry.count} failed attempts for user ${userId} in ${FAILURE_WINDOW_MS/1000}s`);
    return true;
  }
  
  return false;
}

/**
 * Reset le compteur d'échecs après succès
 */
function clearFailures(userId: string): void {
  failureCounter.delete(userId);
}

// ============================================================================
// Main Authorization Function
// ============================================================================

/**
 * Fonction principale d'autorisation vocale
 * 
 * @param userId - ID de l'utilisateur authentifié
 * @param audioBuffer - Audio de la requête vocale
 * @param action - Type d'action à autoriser
 */
export async function authorizeVoiceAction(
  userId: string,
  audioBuffer: Buffer,
  action: VoiceAction
): Promise<VoiceAuthResult> {
  // 1) Vérifier disponibilité du service
  const available = await checkSpeakerService();
  if (!available) {
    if (action === "generic_chat") {
      return {
        allowed: true,
        level: "limited",
        confidence: 0,
        reason: "Service de reconnaissance vocale indisponible, mode limité activé.",
        serviceAvailable: false,
        profileReady: false,
      };
    }
    return {
      allowed: false,
      level: "reject",
      confidence: 0,
      reason: "Service de reconnaissance vocale indisponible.",
      serviceAvailable: false,
      profileReady: false,
    };
  }

  // 2) Vérifier que le profil vocal est prêt
  const profileReady = await hasVoiceProfile(userId);
  if (!profileReady) {
    if (action === "generic_chat") {
      return {
        allowed: true,
        level: "limited",
        confidence: 0,
        reason: "Profil vocal incomplet. Chat autorisé, actions sensibles bloquées.",
        serviceAvailable: true,
        profileReady: false,
      };
    }
    return {
      allowed: false,
      level: "reject",
      confidence: 0,
      reason: "Profil vocal incomplet. Enrôle ta voix avant d'utiliser cette action.",
      serviceAvailable: true,
      profileReady: false,
    };
  }

  // 3) Vérifier le cache de session
  const cached = getCachedSession(userId);
  if (cached) {
    // SÉCURITÉ: Pour les actions sensibles, on exige que le cache ait verified=true
    const requiredLevelForCache = VOICE_POLICY[action];
    const needsVerifiedCache = requiredLevelForCache === "full";
    
    // Re-vérifier que le service et le profil sont toujours OK (même avec cache)
    const serviceStillAvailable = await checkSpeakerService();
    const profileStillReady = serviceStillAvailable ? await hasVoiceProfile(userId) : false;
    
    if (!serviceStillAvailable || !profileStillReady) {
      // Service ou profil plus disponible - invalider le cache
      voiceSessionCache.delete(userId);
    } else if (needsVerifiedCache && !cached.verified) {
      // Cache invalide pour action sensible - forcer re-vérification
      voiceSessionCache.delete(userId);
    } else {
      const allowed = cached.verified 
        ? isVoiceAllowedFor(action, cached.level)
        : (action === "generic_chat" && cached.level !== "reject");
      
      return {
        allowed,
        level: cached.level,
        confidence: cached.confidence,
        reason: allowed
          ? "Session vocale récente réutilisée."
          : `Niveau d'auth vocal insuffisant pour "${action}" (cache).`,
        serviceAvailable: true,
        profileReady: true,
      };
    }
  }

  // 4) Vérification vocale live
  const verification = await verifySpeaker(audioBuffer, userId);
  const level = evaluateVoiceAuth(verification.confidence);

  // SÉCURITÉ CRITIQUE: Si verifySpeaker dit verified=false, 
  // on REFUSE toute action sensible même si la confidence est haute
  // Cela empêche les faux positifs de contourner l'auth
  const isVerifiedByService = verification.verified === true;
  
  // Pour les actions sensibles (full required), on exige verified=true
  const requiredLevel = VOICE_POLICY[action];
  const needsStrictVerification = requiredLevel === "full";
  
  if (needsStrictVerification && !isVerifiedByService) {
    trackFailure(userId);
    return {
      allowed: false,
      level: "reject",
      confidence: verification.confidence,
      reason: "Voix non vérifiée par le service. Action sensible refusée.",
      serviceAvailable: true,
      profileReady: true,
    };
  }

  // SÉCURITÉ: Ne cache QUE si level >= limited
  // On stocke le flag verified pour que le cache sache si c'était une vraie vérif
  if (level !== "reject") {
    setCachedSession(userId, level, verification.confidence, isVerifiedByService);
  }

  // Pour generic_chat (limited), on peut tolérer verified=false si confidence >= limited
  const allowed = isVerifiedByService 
    ? isVoiceAllowedFor(action, level)
    : (action === "generic_chat" && level !== "reject");

  // Track succès/échecs
  if (!allowed) {
    const tooManyFailures = trackFailure(userId);
    if (tooManyFailures) {
      return {
        allowed: false,
        level: "reject",
        confidence: verification.confidence,
        reason: "Trop de tentatives échouées. Authentification vocale temporairement bloquée.",
        serviceAvailable: true,
        profileReady: true,
      };
    }
  } else {
    clearFailures(userId);
  }

  let reason: string;
  if (!verification.verified) {
    reason = level === "reject"
      ? verification.error || "Voix non reconnue."
      : "Voix partiellement reconnue, confiance insuffisante.";
  } else {
    reason = `Voix reconnue avec confiance ${Math.round(verification.confidence * 100)}%.`;
  }

  if (!allowed) {
    return {
      allowed: false,
      level,
      confidence: verification.confidence,
      reason: `Niveau d'auth vocal insuffisant pour "${action}". ${reason}`,
      serviceAvailable: true,
      profileReady: true,
    };
  }

  return {
    allowed: true,
    level,
    confidence: verification.confidence,
    reason,
    serviceAvailable: true,
    profileReady: true,
  };
}

// ============================================================================
// Enrollment Workflow
// ============================================================================

export interface SampleQualityResult {
  valid: boolean;
  reason?: string;
  durationMs?: number;
}

/**
 * Valide la qualité d'un échantillon audio avant enrôlement
 * - Durée cible: 5-10 secondes (pro)
 * - Taille minimum: 25KB (évite les silences)
 * - Taille maximum: ~150KB pour 10s
 */
export function validateSampleQuality(audioBuffer: Buffer): SampleQualityResult {
  // Taille minimum (25KB = audio non-vide d'au moins ~5s @ 40kbps WebM)
  const MIN_SIZE_BYTES = 25 * 1024;
  // Taille maximum (~10s @ ~120kbps = 150KB)
  const MAX_SIZE_BYTES = 150 * 1024;
  // Durée cible: 5-10 secondes
  const MIN_DURATION_MS = 5000;
  const MAX_DURATION_MS = 10000;
  
  if (audioBuffer.length < MIN_SIZE_BYTES) {
    return {
      valid: false,
      reason: "Audio trop court (minimum 5 secondes de parole, parle normalement).",
    };
  }
  
  // Estimation durée basée sur bitrate WebM moyen (~40kbps pour voix)
  const estimatedDurationMs = (audioBuffer.length * 8) / 40;
  
  if (estimatedDurationMs < MIN_DURATION_MS) {
    return {
      valid: false,
      reason: `Audio trop court (${Math.round(estimatedDurationMs / 1000)}s). Cible: 5-10 secondes.`,
      durationMs: estimatedDurationMs,
    };
  }
  
  if (estimatedDurationMs > MAX_DURATION_MS * 2) {
    return {
      valid: false,
      reason: `Audio trop long (${Math.round(estimatedDurationMs / 1000)}s). Cible: 5-10 secondes.`,
      durationMs: estimatedDurationMs,
    };
  }
  
  // Vérification basique de l'énergie: sample trop homogène = probablement silence/bruit
  const sampleSlice = audioBuffer.slice(0, Math.min(audioBuffer.length, 10000));
  let variance = 0;
  for (let i = 1; i < sampleSlice.length; i++) {
    variance += Math.abs(sampleSlice[i] - sampleSlice[i - 1]);
  }
  const avgVariance = variance / sampleSlice.length;
  
  // Si la variance moyenne est trop faible, c'est probablement du silence ou du bruit
  if (avgVariance < 5) {
    return {
      valid: false,
      reason: "Audio semble être du silence ou du bruit. Parle clairement.",
      durationMs: estimatedDurationMs,
    };
  }
  
  return { valid: true, durationMs: estimatedDurationMs };
}

/**
 * Ajoute un échantillon vocal au profil d'un utilisateur
 * avec validation qualité préalable
 */
export async function addEnrollmentSample(
  userId: string,
  audioBuffer: Buffer
): Promise<EnrollmentStatus & { error?: string }> {
  // 1) Validation qualité
  const quality = validateSampleQuality(audioBuffer);
  if (!quality.valid) {
    const current = await getEnrollmentStatus(userId);
    return { ...current, error: quality.reason };
  }
  
  // 2) Envoi au Speaker Service
  try {
    const formData = new FormData();
    formData.append("audio", audioBuffer, {
      filename: "enrollment.webm",
      contentType: "audio/webm",
    });
    formData.append("user_id", userId);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    
    const response = await fetch(`${SPEAKER_SERVICE_URL}/enroll`, {
      method: "POST",
      body: formData as any,
      headers: formData.getHeaders(),
      signal: controller.signal as any,
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      let errorMsg = "Erreur lors de l'enrôlement.";
      try {
        const data = await response.json() as { error?: string };
        errorMsg = data.error || errorMsg;
      } catch {}
      
      const current = await getEnrollmentStatus(userId);
      return { ...current, error: errorMsg };
    }
    
    const data = await response.json() as { sample_count?: number };
    const sampleCount = data.sample_count || 0;
    
    return {
      userId,
      sampleCount,
      minRequired: MIN_SAMPLES_REQUIRED,
      ready: sampleCount >= MIN_SAMPLES_REQUIRED,
    };
  } catch (error: any) {
    const msg = error.name === "AbortError"
      ? "Timeout lors de l'enrôlement."
      : error.message || "Erreur inconnue.";
    
    const current = await getEnrollmentStatus(userId);
    return { ...current, error: msg };
  }
}

/**
 * Récupère le statut d'enrôlement d'un utilisateur
 */
export async function getEnrollmentStatus(userId: string): Promise<EnrollmentStatus> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${SPEAKER_SERVICE_URL}/profiles`, {
      signal: controller.signal as any,
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      return {
        userId,
        sampleCount: 0,
        minRequired: MIN_SAMPLES_REQUIRED,
        ready: false,
      };
    }
    
    const data = await response.json() as { profiles?: Array<{ user_id: string; sample_count: number }> };
    const profile = data.profiles?.find((p) => p.user_id === userId);
    
    const sampleCount = profile?.sample_count || 0;
    
    return {
      userId,
      sampleCount,
      minRequired: MIN_SAMPLES_REQUIRED,
      ready: sampleCount >= MIN_SAMPLES_REQUIRED,
    };
  } catch {
    return {
      userId,
      sampleCount: 0,
      minRequired: MIN_SAMPLES_REQUIRED,
      ready: false,
    };
  }
}

/**
 * Supprime le profil vocal d'un utilisateur
 */
export async function deleteVoiceProfile(userId: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${SPEAKER_SERVICE_URL}/profiles/${userId}`, {
      method: "DELETE",
      signal: controller.signal as any,
    });
    
    clearTimeout(timeout);
    
    if (response.ok) {
      invalidateVoiceSession(userId);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ============================================================================
// Utility Exports
// ============================================================================

export const voiceAuthService = {
  authorizeVoiceAction,
  evaluateVoiceAuth,
  isVoiceAllowedFor,
  getRequiredLevel,
  getEnrollmentStatus,
  addEnrollmentSample,
  validateSampleQuality,
  deleteVoiceProfile,
  invalidateVoiceSession,
};

export default voiceAuthService;
