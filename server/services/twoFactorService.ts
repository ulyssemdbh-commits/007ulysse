import { randomInt } from "crypto";
import { db } from "../db";
import { sessions } from "@shared/schema";
import { eq } from "drizzle-orm";

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const OWNER_EMAIL = "djedoumaurice@gmail.com";

interface PendingOtp {
  code: string;
  sessionId: string;
  userId: number;
  expiresAt: number;
  attempts: number;
}

const pendingOtps = new Map<string, PendingOtp>();

function generateOtpCode(): string {
  return String(randomInt(100000, 999999));
}

function cleanExpired() {
  const now = Date.now();
  for (const [key, otp] of pendingOtps) {
    if (otp.expiresAt < now) {
      pendingOtps.delete(key);
    }
  }
}

export const twoFactorService = {
  async generateAndSend(sessionId: string, userId: number): Promise<{ success: boolean; error?: string }> {
    try {
      cleanExpired();

      const code = generateOtpCode();
      pendingOtps.set(sessionId, {
        code,
        sessionId,
        userId,
        expiresAt: Date.now() + OTP_EXPIRY_MS,
        attempts: 0,
      });

      try {
        const { discordService } = await import("./discordService");
        await discordService.sendNotification({
          title: "🔐 Code de vérification Ulysse",
          message: `Code: **${code}**\nExpire dans 10 minutes.`,
          type: "info",
        });
        console.log(`[2FA] Code sent via Discord for session ${sessionId.slice(0, 8)}...`);
      } catch (discordErr: any) {
        console.error(`[2FA] Discord send failed:`, discordErr.message);
        pendingOtps.delete(sessionId);
        return { success: false, error: "Impossible d'envoyer le code de vérification via Discord" };
      }

      return { success: true };
    } catch (e: any) {
      console.error("[2FA] Generation error:", e.message);
      return { success: false, error: "Erreur lors de la génération du code" };
    }
  },

  async verify(sessionId: string, code: string): Promise<{ success: boolean; error?: string }> {
    cleanExpired();

    const pending = pendingOtps.get(sessionId);
    if (!pending) {
      return { success: false, error: "Code expiré ou session invalide. Reconnectez-vous." };
    }

    if (pending.attempts >= MAX_VERIFY_ATTEMPTS) {
      pendingOtps.delete(sessionId);
      return { success: false, error: "Trop de tentatives. Reconnectez-vous." };
    }

    pending.attempts++;

    if (pending.code !== code) {
      const remaining = MAX_VERIFY_ATTEMPTS - pending.attempts;
      return { success: false, error: `Code incorrect. ${remaining} tentative(s) restante(s).` };
    }

    try {
      await db.update(sessions)
        .set({ twoFactorVerified: true })
        .where(eq(sessions.id, sessionId));

      pendingOtps.delete(sessionId);
      console.log(`[2FA] Session ${sessionId.slice(0, 8)}... verified successfully`);

      try {
        const { discordService } = await import("./discordService");
        await discordService.sendNotification({
          title: "✅ Connexion 2FA réussie",
          message: `Maurice s'est connecté avec 2FA.\nHeure: ${new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}`,
          type: "info",
        });
      } catch {}

      return { success: true };
    } catch (e: any) {
      console.error("[2FA] DB update error:", e.message);
      return { success: false, error: "Erreur de vérification" };
    }
  },

  async sendViaEmail(sessionId: string, userId: number): Promise<{ success: boolean; error?: string }> {
    try {
      cleanExpired();

      let pending = pendingOtps.get(sessionId);
      if (!pending) {
        const code = generateOtpCode();
        pending = {
          code,
          sessionId,
          userId,
          expiresAt: Date.now() + OTP_EXPIRY_MS,
          attempts: 0,
        };
        pendingOtps.set(sessionId, pending);
      }

      try {
        const { agentMailService } = await import("./agentMailService");
        await agentMailService.sendEmail({
          to: OWNER_EMAIL,
          subject: "🔐 Code de vérification Ulysse 2FA",
          body: `Bonjour Maurice,\n\nVotre code de vérification Ulysse est : ${pending.code}\n\nCe code expire dans 10 minutes.\n\n— Ulysse`,
        }, "ulysse", userId);
        console.log(`[2FA] Code sent via email to ${OWNER_EMAIL} for session ${sessionId.slice(0, 8)}...`);
      } catch (emailErr: any) {
        console.error(`[2FA] Email send failed:`, emailErr.message);
        return { success: false, error: "Impossible d'envoyer le code par e-mail" };
      }

      return { success: true };
    } catch (e: any) {
      console.error("[2FA] Email generation error:", e.message);
      return { success: false, error: "Erreur lors de l'envoi par e-mail" };
    }
  },

  async resend(sessionId: string, userId: number): Promise<{ success: boolean; error?: string }> {
    pendingOtps.delete(sessionId);
    return this.generateAndSend(sessionId, userId);
  },

  hasPending(sessionId: string): boolean {
    cleanExpired();
    return pendingOtps.has(sessionId);
  },
};
