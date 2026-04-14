/**
 * VISION HUB BRIDGE - Harmonisation du système visuel
 * 
 * Connecte VisionHub avec les services existants:
 * - ocrService (analyse de documents)
 * - screenMonitorWs (capture d'écran)
 * - crawlService (scraping web)
 * - screenshotService (captures d'URL)
 * 
 * Flow unifié:
 * [Source Visuelle] → VisionHub.see() → [Analyse + Tracking] → [Résultat]
 */

import { visionHub } from "./VisionHub";
import type { VisionSource, ContentType } from "./VisionHub";

let bridgeInitialized = false;

export function initializeVisionHubBridge(): void {
  if (bridgeInitialized) {
    console.log("[VisionHubBridge] Déjà initialisé");
    return;
  }

  console.log("[VisionHubBridge] Initialisation du bridge visuel...");
  bridgeInitialized = true;
  console.log("[VisionHubBridge] ✅ Bridge visuel initialisé");
}

export async function analyzeDocumentViaVisionHub(
  imageInput: Buffer | string,
  filename: string,
  mimeType: string,
  userId: number
): Promise<{ text: string; structured?: any; insights: any[] }> {
  const content = typeof imageInput === "string"
    ? imageInput
    : imageInput.toString("base64");

  const result = await visionHub.seeDocument(
    content,
    filename,
    mimeType,
    userId
  );

  return {
    text: result.text || "",
    structured: result.structuredData,
    insights: result.insights
  };
}

export async function analyzeScreenViaVisionHub(
  imageBase64: string,
  sessionId: number,
  appName: string,
  windowTitle: string,
  frameNumber: number,
  userId: number
): Promise<{ summary: string; insights: any[] }> {
  const result = await visionHub.seeScreen(
    imageBase64,
    userId,
    {
      sessionId,
      appName,
      windowTitle,
      frameNumber,
    }
  );

  return {
    summary: result.text || "",
    insights: result.insights
  };
}

export async function analyzeWebpageViaVisionHub(
  url: string,
  htmlContent: string,
  userId: number
): Promise<{ text: string; structured?: any; insights: any[] }> {
  const result = await visionHub.seeWebpage(
    htmlContent,
    url,
    userId
  );

  return {
    text: result.text || "",
    structured: result.structuredData,
    insights: result.insights
  };
}

export async function analyzeScreenshotViaVisionHub(
  imageBase64: string,
  url: string,
  userId: number
): Promise<{ text: string; insights: any[] }> {
  const result = await visionHub.seeScreenshot(imageBase64, url, userId);

  return {
    text: result.text || "",
    insights: result.insights
  };
}

export function getVisionHubStats() {
  return {
    bridgeInitialized,
    hubStats: visionHub.getStats()
  };
}
