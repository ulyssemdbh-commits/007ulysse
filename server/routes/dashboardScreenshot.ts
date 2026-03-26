import { Router, Request, Response } from "express";
import { db } from "../db";
import { uiSnapshots } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import OpenAI from "openai";

const router = Router();
const LOG = "[DashboardScreenshot]";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

let lastAnalysis: { timestamp: number; analysis: string; requestId: string } | null = null;

router.post("/api/dashboard-screenshot", async (req: Request, res: Response) => {
  try {
    const { imageBase64, browserUrl, requestId, currentPage, viewport } = req.body;

    if (!imageBase64 && !browserUrl) {
      return res.status(400).json({ error: "imageBase64 or browserUrl required" });
    }

    let base64Data: string;
    let analysisContext: string;

    if (browserUrl) {
      console.log(`${LOG} Browser URL detected: ${browserUrl} — using Playwright crawler`);
      try {
        const { captureScreenshot } = await import("../services/scraper/screenshot");
        const screenshotResult = await captureScreenshot(browserUrl);

        if (!screenshotResult || !screenshotResult.success || !screenshotResult.imageBase64) {
          console.log(`${LOG} Playwright capture failed: ${screenshotResult?.error || "unknown"}`);
          return res.status(500).json({ error: "Playwright screenshot capture failed" });
        }

        base64Data = screenshotResult.imageBase64;
        console.log(`${LOG} Playwright screenshot captured (${Math.round(base64Data.length / 1024)}KB) for ${browserUrl}`);
        analysisContext = `Screenshot du site web ${browserUrl} affiché dans le navigateur DevOps intégré d'Ulysse. Page actuelle de Maurice: ${currentPage || "inconnue"}.`;
      } catch (crawlErr: any) {
        console.error(`${LOG} Playwright error:`, crawlErr.message);
        return res.status(500).json({ error: `Crawler error: ${crawlErr.message}` });
      }
    } else {
      console.log(`${LOG} Screenshot received (${Math.round(imageBase64.length / 1024)}KB) from page: ${currentPage}`);
      base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      analysisContext = `Screenshot du dashboard Ulysse. Page actuelle: ${currentPage || "inconnue"}. Viewport: ${viewport?.width}x${viewport?.height}.`;
    }

    const visionResp = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `Tu es l'œil visuel d'Ulysse, l'assistant IA de Maurice. Tu regardes cette image exactement comme un humain regarde un écran — tu VOIS et tu INTERPRÈTES visuellement.

RÈGLE ABSOLUE : Décris ce que tu VOIS réellement sur l'image. Ne devine pas, n'invente pas. Si tu vois une horloge mondiale, dis-le. Si tu vois un graphique, décris-le. Si tu vois du texte, lis-le.

Analyse VISUELLE complète :

1. PREMIÈRE IMPRESSION — Qu'est-ce que tu vois d'un coup d'œil ? Quel est le sujet principal de l'image ? Décris la scène comme si tu la racontais à quelqu'un qui ne la voit pas.

2. ESTHÉTIQUE & GRAPHISME
   - Palette de couleurs dominantes (nomme les couleurs exactes que tu vois)
   - Harmonie visuelle — est-ce cohérent, agréable, professionnel ?
   - Contrastes — le texte est-il lisible ? Les éléments se détachent-ils bien du fond ?
   - Qualité visuelle globale (amateur, correct, soigné, premium)

3. COMPOSITION & LAYOUT
   - Comment l'espace est-il organisé ? (grille, centré, asymétrique...)
   - Hiérarchie visuelle — qu'est-ce qui attire l'œil en premier ?
   - Densité d'information — trop chargé, équilibré, trop vide ?
   - Espacement et alignement des éléments

4. ERGONOMIE & UX (si c'est une interface)
   - Les actions sont-elles claires et visibles ?
   - La navigation est-elle intuitive ?
   - Les informations importantes sont-elles mises en avant ?
   - Y a-t-il des éléments confus ou mal placés ?

5. CONTENU VISIBLE
   - Textes lisibles, données affichées, chiffres, statuts
   - État de l'interface (normal, chargement, erreur, vide)

6. VERDICT & SUGGESTIONS
   - Note globale sur 10
   - Points forts visuels
   - Points faibles et améliorations concrètes

Réponds en français, comme si tu parlais à Maurice. Format JSON:
{
  "impression": "description visuelle immédiate de ce que tu vois",
  "page": "nom/type de contenu détecté",
  "url": "${browserUrl || "dashboard"}",
  "esthetique": {
    "couleurs": "palette exacte observée",
    "harmonie": "cohérence visuelle",
    "contrastes": "lisibilité et détachement",
    "qualite": "amateur|correct|soigne|premium"
  },
  "composition": {
    "layout": "organisation de l'espace",
    "hierarchie": "ce qui attire l'œil en premier",
    "densite": "trop_charge|equilibre|trop_vide",
    "alignement": "qualité des espacements"
  },
  "ergonomie": {
    "clarte_actions": "visibilité des actions",
    "navigation": "intuitivité",
    "mise_en_avant": "infos importantes visibles ou non"
  },
  "contenu": {
    "elements_visibles": ["liste de ce qui est visible"],
    "donnees_cles": {"clé": "valeur lue sur l'écran"},
    "etat": "normal|loading|error|empty"
  },
  "verdict": {
    "note": 7,
    "points_forts": ["..."],
    "points_faibles": ["..."],
    "ameliorations": ["suggestions concrètes"]
  },
  "summary": "résumé visuel en 2-3 phrases, comme si tu décrivais ce que tu vois à Maurice"
}`
        },
        {
          role: "user",
          content: [
            { type: "text", text: analysisContext },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Data}`, detail: "high" } },
          ],
        },
      ],
      temperature: 0.3,
      max_tokens: 2500,
      response_format: { type: "json_object" },
    });

    const analysisText = visionResp.choices[0]?.message?.content || "{}";
    let analysis: any;
    try {
      analysis = JSON.parse(analysisText);
    } catch {
      analysis = { summary: analysisText, page: currentPage };
    }

    console.log(`${LOG} Analysis complete: ${analysis.summary?.slice(0, 100)}`);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await db.insert(uiSnapshots).values({
      userId: 1,
      actionType: "screenshot_analysis",
      currentPage: browserUrl || currentPage || "/",
      elementClicked: `screenshot:${requestId}`,
      visibleComponents: analysis.elements?.slice(0, 20) || null,
      formState: analysis,
      viewportWidth: viewport?.width || null,
      viewportHeight: viewport?.height || null,
      metadata: { requestId, browserUrl, imageSize: base64Data.length, analysisTokens: visionResp.usage?.total_tokens },
      expiresAt,
    });

    lastAnalysis = {
      timestamp: Date.now(),
      analysis: analysisText,
      requestId: requestId || "unknown",
    };

    res.json({ ok: true, analysis, summary: analysis.summary, requestId });
  } catch (err: any) {
    console.error(`${LOG} Error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/dashboard-screenshot/latest", async (_req: Request, res: Response) => {
  try {
    const [latest] = await db.select().from(uiSnapshots)
      .where(eq(uiSnapshots.actionType, "screenshot_analysis"))
      .orderBy(desc(uiSnapshots.createdAt))
      .limit(1);

    if (!latest) {
      return res.json({ available: false, message: "Aucun screenshot disponible. Demande à Maurice de capturer son écran." });
    }

    res.json({
      available: true,
      analysis: latest.formState,
      page: latest.currentPage,
      timestamp: latest.createdAt,
      requestId: (latest.metadata as any)?.requestId,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/dashboard-screenshot/trigger", async (_req: Request, res: Response) => {
  try {
    const { broadcastToUser } = await import("../services/realtimeSync");
    const requestId = `ulysse-${Date.now()}`;

    broadcastToUser(1, {
      type: "dashboard.command",
      data: { action: "take_screenshot", requestId },
      timestamp: Date.now(),
    });

    console.log(`${LOG} Screenshot trigger sent via WebSocket (requestId: ${requestId})`);
    res.json({ ok: true, requestId, message: "Commande envoyée au navigateur de Maurice" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
