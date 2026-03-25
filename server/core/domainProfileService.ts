/**
 * Domain Profile Service - apprend et mémorise les stratégies efficaces par domaine
 * - Cache mémoire + persistance DB
 */

import { db } from "../db";
import { domainProfiles } from "@shared/schema";
import { eq } from "drizzle-orm";
import { DomainProfile, RenderStrategy } from "./strategyTypes";

const inMemoryCache = new Map<string, DomainProfile>();

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function createDefaultProfile(domain: string): DomainProfile {
  const now = new Date().toISOString();
  return {
    domain,
    successCount: 0,
    failureCount: 0,
    lastSuccessStrategy: undefined,
    failedStrategies: [],
    jsRequired: false,
    avgQualityScore: 0,
    lastUpdatedAt: now,
  };
}

/**
 * Chargement du profil de domaine (cache mémoire + DB)
 */
export async function getDomainProfile(url: string): Promise<DomainProfile> {
  const domain = extractDomain(url);

  if (inMemoryCache.has(domain)) {
    return inMemoryCache.get(domain)!;
  }

  try {
    const [dbProfile] = await db
      .select()
      .from(domainProfiles)
      .where(eq(domainProfiles.domain, domain))
      .limit(1);

    if (dbProfile) {
      const profile: DomainProfile = {
        domain: dbProfile.domain,
        successCount: dbProfile.successCount ?? 0,
        failureCount: dbProfile.attemptCount
          ? Math.max(dbProfile.attemptCount - (dbProfile.successCount ?? 0), 0)
          : 0,
        lastSuccessStrategy: dbProfile.lastSuccessStrategy as RenderStrategy | undefined,
        failedStrategies: (dbProfile.failedStrategies || []) as RenderStrategy[],
        jsRequired: dbProfile.jsRequired ?? false,
        avgQualityScore: Number(dbProfile.avgQualityScore) || 0,
        lastUpdatedAt: dbProfile.updatedAt?.toISOString() || new Date().toISOString(),
      };

      inMemoryCache.set(domain, profile);
      return profile;
    }
  } catch (error) {
    console.warn(`[DomainProfile] DB read failed for ${domain}:`, error);
  }

  const defaultProfile = createDefaultProfile(domain);
  inMemoryCache.set(domain, defaultProfile);
  return defaultProfile;
}

/**
 * Met à jour le profil de domaine après chaque tentative de stratégie
 */
export async function updateDomainProfile(
  url: string,
  strategyUsed: RenderStrategy,
  success: boolean,
  qualityScore: number,
  jsDetected: boolean = false,
): Promise<DomainProfile> {
  const domain = extractDomain(url);
  const existing = await getDomainProfile(url);

  const now = new Date().toISOString();

  const failedStrategies = new Set(existing.failedStrategies);

  let successCount = existing.successCount;
  let failureCount = existing.failureCount;
  let lastSuccessStrategy = existing.lastSuccessStrategy;
  let avgQuality = existing.avgQualityScore;

  if (success) {
    successCount += 1;
    lastSuccessStrategy = strategyUsed;
    failedStrategies.delete(strategyUsed);

    // moyenne pondérée simple sur les succès
    avgQuality =
      successCount === 1
        ? qualityScore
        : ((existing.avgQualityScore * (successCount - 1)) + qualityScore) / successCount;
  } else {
    failureCount += 1;
    failedStrategies.add(strategyUsed);
  }

  const updated: DomainProfile = {
    domain,
    successCount,
    failureCount,
    lastSuccessStrategy,
    failedStrategies: Array.from(failedStrategies),
    jsRequired: existing.jsRequired || jsDetected,
    avgQualityScore: avgQuality,
    lastUpdatedAt: now,
  };

  inMemoryCache.set(domain, updated);

  // Persistance DB (en s'alignant sur ton schema existant)
  try {
    const [existingDb] = await db
      .select()
      .from(domainProfiles)
      .where(eq(domainProfiles.domain, domain))
      .limit(1);

    if (existingDb) {
      const attemptCount = (existingDb.attemptCount ?? 0) + 1;
      const successCountDb = success
        ? (existingDb.successCount ?? 0) + 1
        : (existingDb.successCount ?? 0);

      await db
        .update(domainProfiles)
        .set({
          jsRequired: updated.jsRequired,
          failedStrategies: updated.failedStrategies,
          lastSuccessStrategy: updated.lastSuccessStrategy,
          lastAttempt: new Date(),
          lastSuccess: success ? new Date() : existingDb.lastSuccess,
          attemptCount,
          successCount: successCountDb,
          avgQualityScore: updated.avgQualityScore.toFixed(4),
          updatedAt: new Date(),
        })
        .where(eq(domainProfiles.domain, domain));
    } else {
      await db.insert(domainProfiles).values({
        domain: updated.domain,
        defaultStrategy: "http", // legacy, plus vraiment utilisé côté TS
        jsRequired: updated.jsRequired,
        rateLimitPerMinute: 60,
        successfulStrategies: success ? [strategyUsed] : [],
        failedStrategies: updated.failedStrategies,
        lastSuccessStrategy: updated.lastSuccessStrategy,
        lastAttempt: new Date(),
        lastSuccess: success ? new Date() : null,
        attemptCount: 1,
        successCount: success ? 1 : 0,
        avgQualityScore: updated.avgQualityScore.toFixed(4),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  } catch (error) {
    console.warn(`[DomainProfile] DB write failed for ${domain}:`, error);
  }

  console.log(
    `[DomainProfile] Updated ${domain}: strategy=${strategyUsed}, success=${success}, quality=${qualityScore.toFixed(
      2,
    )}, jsRequired=${updated.jsRequired}`,
  );

  return updated;
}

/**
 * Renvoie la meilleure stratégie à tester en premier pour un domaine
 */
export async function getBestStrategy(url: string): Promise<RenderStrategy> {
  const profile = await getDomainProfile(url);

  if (profile.lastSuccessStrategy && profile.successCount > 0) {
    return profile.lastSuccessStrategy;
  }

  if (profile.jsRequired) {
    // Si on sait que le domaine est SPA/JS, on favorise les stratégies adaptées
    return "playwright";
  }

  // fallback très simple: HTTP par défaut
  return "http";
}

/**
 * Supprime le profil d'un domaine (cache + DB)
 */
export async function clearDomainProfile(url: string): Promise<void> {
  const domain = extractDomain(url);
  inMemoryCache.delete(domain);

  try {
    await db.delete(domainProfiles).where(eq(domainProfiles.domain, domain));
  } catch (error) {
    console.warn(
      `[DomainProfile] Failed to clear profile for ${domain}:`,
      error,
    );
  }
}

/**
 * Récupère tous les profils (pour debug / dashboard)
 */
export async function getAllProfiles(): Promise<DomainProfile[]> {
  try {
    const dbProfiles = await db.select().from(domainProfiles).limit(1000);
    return dbProfiles.map((p) => ({
      domain: p.domain,
      successCount: p.successCount ?? 0,
      failureCount: p.attemptCount
        ? Math.max(p.attemptCount - (p.successCount ?? 0), 0)
        : 0,
      lastSuccessStrategy: p.lastSuccessStrategy as RenderStrategy | undefined,
      failedStrategies: (p.failedStrategies || []) as RenderStrategy[],
      jsRequired: p.jsRequired ?? false,
      avgQualityScore: Number(p.avgQualityScore) || 0,
      lastUpdatedAt: p.updatedAt?.toISOString() || new Date().toISOString(),
    }));
  } catch (error) {
    console.warn(`[DomainProfile] Failed to get all profiles:`, error);
    return Array.from(inMemoryCache.values());
  }
}
