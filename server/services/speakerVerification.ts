/**
 * Speaker Verification Service
 * Internal service to verify speaker identity before allowing AI responses
 */

import fetch from "node-fetch";
import FormData from "form-data";

const SPEAKER_SERVICE_URL = process.env.SPEAKER_SERVICE_URL || "http://localhost:5001";

export interface VerificationResult {
  verified: boolean;
  userId?: string;
  confidence: number;
  error?: string;
}

/**
 * Verify if the audio matches the expected user
 * Returns true only if the speaker is the authenticated user
 */
export async function verifySpeaker(audioBuffer: Buffer, expectedUserId: string): Promise<VerificationResult> {
  try {
    const formData = new FormData();
    formData.append("audio", audioBuffer, {
      filename: "audio.webm",
      contentType: "audio/webm",
    });
    formData.append("user_id", expectedUserId);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${SPEAKER_SERVICE_URL}/verify`, {
      method: "POST",
      body: formData as any,
      headers: formData.getHeaders(),
      signal: controller.signal as any,
    });

    clearTimeout(timeout);

    // Safe JSON parsing - speaker service might return HTML or nothing on error
    let data: any = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      return {
        verified: false,
        confidence: 0,
        error: data.error || "Verification failed",
      };
    }

    return {
      verified: data.verified === true,
      userId: expectedUserId,
      confidence: data.confidence || 0,
    };
  } catch (error: any) {
    // Explicit message for timeout vs other errors
    const msg = error.name === "AbortError"
      ? "Speaker verification timeout"
      : error.message || "Unknown error";
    console.error("[SpeakerVerification] Error:", msg);
    return {
      verified: false,
      confidence: 0,
      error: msg,
    };
  }
}

/**
 * Identify the speaker from audio
 * Returns the userId of the identified speaker or null if unknown
 */
export async function identifySpeaker(audioBuffer: Buffer): Promise<{ userId: string | null; confidence: number }> {
  try {
    const formData = new FormData();
    formData.append("audio", audioBuffer, {
      filename: "audio.webm",
      contentType: "audio/webm",
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${SPEAKER_SERVICE_URL}/identify`, {
      method: "POST",
      body: formData as any,
      headers: formData.getHeaders(),
      signal: controller.signal as any,
    });

    clearTimeout(timeout);

    // Safe JSON parsing
    let data: any = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      console.error("[SpeakerVerification] Identify non-OK:", response.status);
      return { userId: null, confidence: 0 };
    }

    if (!data.speaker) {
      return { userId: null, confidence: 0 };
    }

    return {
      userId: data.speaker,
      confidence: data.confidence || 0,
    };
  } catch (error: any) {
    // Explicit message for timeout vs other errors
    const msg = error.name === "AbortError"
      ? "Speaker identification timeout"
      : error.message || "Unknown error";
    console.error("[SpeakerVerification] Identify error:", msg);
    return { userId: null, confidence: 0 };
  }
}

/**
 * Check if the speaker service is available
 */
export async function isSpeakerServiceAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${SPEAKER_SERVICE_URL}/health`, {
      signal: controller.signal as any,
    });

    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if a user has enrolled their voice
 */
export async function hasVoiceProfile(userId: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${SPEAKER_SERVICE_URL}/profiles`, {
      signal: controller.signal as any,
    });

    clearTimeout(timeout);

    if (!response.ok) return false;

    // Safe JSON parsing
    let data: { profiles?: Array<{ user_id: string; sample_count: number }> } = {};
    try {
      data = await response.json() as typeof data;
    } catch {
      return false;
    }

    const profile = data.profiles?.find((p) => p.user_id === userId);
    // Pro: 5 samples minimum pour un profil fiable
    return profile ? profile.sample_count >= 5 : false;
  } catch {
    return false;
  }
}
