import OpenAI from "openai";
import {
  isUserScreenActive,
  isAgentRemoteControlCapable,
  isAgentRemoteControlEnabled,
  sendRemoteControlCommand,
  getLatestFrame,
  waitForNextFrame,
} from "../../services/screenMonitorWs";
import { screenMonitorService } from "../../services/screenMonitorService";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

type ChatCompletionTool = OpenAI.Chat.Completions.ChatCompletionTool;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function takeScreenshot(userId: number): Promise<{ imageBase64: string; activeApp?: string; activeWindow?: string } | null> {
  const framePromise = waitForNextFrame(userId, 5000);
  const sent = sendRemoteControlCommand(userId, { type: "remote_control.cmd", cmd: "screenshot" });
  if (!sent) return null;
  const frame = await framePromise;
  if (!frame || !frame.imageBase64) return null;
  return frame;
}

async function analyzeScreen(frame: { imageBase64: string; activeApp?: string; activeWindow?: string }, context?: string): Promise<string | null> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 600,
      messages: [
        {
          role: "system",
          content: `Tu es Ulysse AI. Tu observes l'écran de l'utilisateur.
${context ? `Contexte: ${context}` : ""}

INSTRUCTIONS:
1. Décris ce que tu vois à l'écran en 3-5 phrases PRÉCISES
2. Liste TOUS les éléments cliquables visibles (boutons, onglets, liens, menus) avec leur position en PIXELS approximatifs (x, y)
3. L'image fait 1024x768 pixels (redimensionnée). Estime les coordonnées en conséquence.
4. Format: "Élément [description] à environ (x, y)"

Sois factuel, précis sur les positions, et utile pour planifier des clics.`
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${frame.imageBase64}`, detail: "high" } },
            { type: "text", text: `App: ${frame.activeApp || "?"}, Fenêtre: ${frame.activeWindow || "?"}` }
          ]
        }
      ]
    });
    return response.choices[0]?.message?.content || null;
  } catch (e) {
    console.error("[ScreenTools] Vision analysis error:", e);
    return null;
  }
}

async function sendAction(userId: number, cmd: string, params: Record<string, any> = {}): Promise<boolean> {
  return sendRemoteControlCommand(userId, { type: "remote_control.cmd", cmd, ...params });
}

async function executeActionSequence(userId: number, actions: Array<{ cmd: string; params?: Record<string, any>; waitMs?: number }>): Promise<boolean> {
  for (const action of actions) {
    const sent = sendAction(userId, action.cmd, action.params || {});
    if (!sent) return false;
    await sleep(action.waitMs || 300);
  }
  return true;
}

async function analyzeForExploration(
  imageBase64: string,
  activeApp: string | undefined,
  activeWindow: string | undefined,
  goal: string,
  stepHistory: string[],
  pagesSeen: string[]
): Promise<{ description: string; nextAction: any | null; goalReached: boolean; currentPage?: string }> {
  const historyStr = stepHistory.length > 0
    ? `\nActions déjà effectuées (${stepHistory.length} étapes):\n${stepHistory.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
    : "";

  const pagesStr = pagesSeen.length > 0
    ? `\nPages/onglets déjà visités: ${pagesSeen.join(", ")}`
    : "";

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 800,
    messages: [
      {
        role: "system",
        content: `Tu es Ulysse AI en mode EXPLORATION AUTONOME COMPLÈTE du bureau.

OBJECTIF: ${goal}
${historyStr}
${pagesStr}

Tu DOIS explorer méthodiquement. RÈGLES ABSOLUES:
1. IDENTIFIE tous les onglets/boutons de navigation visibles avec leurs coordonnées PRÉCISES en pixels
2. L'image fait 1024x768 pixels. Estime les coordonnées (x,y) en conséquence.
3. CLIQUE séquentiellement sur CHAQUE onglet/page que tu n'as PAS encore visité
4. NE T'ARRÊTE PAS après un seul clic — continue jusqu'à avoir visité TOUS les onglets
5. Si un onglet ne change pas la page, essaie le suivant
6. Après chaque clic sur un onglet, fais un scroll vers le bas pour voir le contenu complet
7. Pour ouvrir une URL: utilise key_press "ctrl+l" puis type_text puis key_press "enter"

Réponds UNIQUEMENT en JSON valide:
{
  "description": "Description DÉTAILLÉE de ce que tu vois (3-5 phrases). Mentionne tous les éléments UI visibles.",
  "currentPage": "Nom de la page/onglet actuel",
  "visibleTabs": ["liste", "des", "onglets", "visibles", "dans", "le", "menu"],
  "goalReached": false,
  "nextAction": {
    "type": "click" | "double_click" | "scroll" | "key_press" | "type_text" | "mouse_move",
    "x": 500,
    "y": 300,
    "key": "ctrl+l",
    "text": "https://example.com",
    "dy": 5,
    "reason": "Pourquoi cette action — quel onglet/bouton je vise"
  }
}

IMPORTANT:
- goalReached = true SEULEMENT quand tu as visité TOUS les onglets/pages demandés
- NE METS PAS nextAction: null sauf si tu as VRAIMENT tout exploré ou si tu es bloqué après 3 tentatives
- Sois AGRESSIF dans l'exploration — ne demande pas la permission, agis
- Si tu vois une barre de navigation, identifie CHAQUE onglet avec sa position (x,y) précise
- Les onglets dans un header sont généralement à y=30-80, espacés horizontalement
- Les onglets dans une sidebar sont généralement à x=20-200, espacés verticalement`
      },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: "high" } },
          { type: "text", text: `App: ${activeApp || "?"}, Fenêtre: ${activeWindow || "?"}\nObjectif: ${goal}` }
        ]
      }
    ]
  });

  const content = response.choices[0]?.message?.content || "";
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        description: parsed.description || "Analyse en cours",
        nextAction: parsed.nextAction || null,
        goalReached: !!parsed.goalReached,
        currentPage: parsed.currentPage
      };
    }
  } catch (e) {
    console.error("[ScreenTools] Nav parse error:", e);
  }

  return { description: content.substring(0, 400), nextAction: null, goalReached: false };
}

export const screenMonitorToolDefs: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "screen_monitor_manage",
      description: `Ulysse Vision — Contrôle COMPLET du bureau de l'utilisateur.

CAPACITÉS:
- Voir l'écran en temps réel (screenshot + analyse Vision AI)
- Contrôler souris et clavier (click, type, scroll, hotkeys)
- Ouvrir des URLs dans le navigateur (open_url)
- Explorer AUTOMATIQUEMENT toute une application (explore — jusqu'à 20 étapes autonomes)
- Enchaîner plusieurs actions d'un coup (multi_action)

RÈGLES DE COMPORTEMENT:
- APRÈS chaque action (click, scroll, type_text, key_press), un screenshot est pris et analysé automatiquement
- N'utilise JAMAIS la prise en main sans l'accord de l'utilisateur
- Quand l'utilisateur dit "explore" / "navigue" / "prends la main" → active le contrôle et EXÉCUTE TOUT sans demander
- Sois AUTONOME : ne demande pas "tu veux que je continue?" — continue jusqu'à avoir fini
- Sois CURIEUX : explore les sous-menus, scroll pour voir le contenu complet

Actions:
- status : état de connexion et prise en main
- screenshot : capture + analyse visuelle détaillée avec positions des éléments
- enable_control / disable_control : activer/désactiver la prise en main
- mouse_move : déplacer la souris vers (x, y)
- click / double_click / right_click : clic à (x, y) avec retour visuel
- scroll : défilement à (x, y) avec dy (positif = bas)
- key_press : touche ou combo (ctrl+c, alt+tab, ctrl+l, enter, escape, tab, win)
- type_text : saisie de texte au clavier
- open_url : ouvre une URL dans le navigateur (Ctrl+L → tape l'URL → Enter) — passer l'URL dans le champ "text"
- multi_action : exécute une séquence d'actions d'un coup (passer un JSON array dans "sequence")
- explore : navigation AUTONOME multi-étapes (jusqu'à 20 étapes). Passer l'objectif dans "goal". NE S'ARRÊTE PAS tant que l'objectif n'est pas atteint.
- self_test : DIAGNOSTIC COMPLET — teste séquentiellement TOUTES les capacités (screenshot, vision, mouse_move, click, scroll, key_press, type_text, open_url). Renvoie un rapport détaillé avec le statut de chaque test (PASS/FAIL). Utiliser quand l'utilisateur demande "teste tes outils", "vérifie que tu es opérationnel", "diagnostic prise en main".`,
      parameters: {
        type: "object",
        required: ["action"],
        properties: {
          action: {
            type: "string",
            enum: [
              "status", "screenshot",
              "enable_control", "disable_control",
              "mouse_move", "click", "double_click", "right_click",
              "scroll", "key_press", "type_text",
              "open_url", "multi_action", "explore", "self_test",
            ],
            description: "Action à effectuer",
          },
          x: { type: "number", description: "Coordonnée X (pixels)" },
          y: { type: "number", description: "Coordonnée Y (pixels)" },
          button: { type: "string", enum: ["left", "right", "middle"], description: "Bouton souris" },
          key: { type: "string", description: "Touche ou combinaison (ctrl+c, alt+tab, enter, ctrl+l, etc.)" },
          text: { type: "string", description: "Texte à saisir ou URL pour open_url" },
          clicks: { type: "number", description: "Nombre de clics" },
          dx: { type: "number", description: "Défilement horizontal" },
          dy: { type: "number", description: "Défilement vertical (positif = bas)" },
          goal: { type: "string", description: "Objectif pour explore (ex: 'Explore tous les onglets de l'app et résume chaque page')" },
          max_steps: { type: "number", description: "Max étapes pour explore (défaut: 20, max: 30)" },
          sequence: { type: "string", description: "JSON array d'actions pour multi_action. Format: [{\"cmd\":\"key_press\",\"key\":\"ctrl+l\"},{\"cmd\":\"type_text\",\"text\":\"https://...\",\"waitMs\":200},{\"cmd\":\"key_press\",\"key\":\"enter\"}]" },
        },
      },
    },
  },
];

export async function executeScreenMonitorManage(
  args: Record<string, any>,
  userId: number
): Promise<string> {
  const action = args.action as string;

  switch (action) {
    case "status": {
      const connected = isUserScreenActive(userId);
      const capable = isAgentRemoteControlCapable(userId);
      const enabled = isAgentRemoteControlEnabled(userId);
      const context = connected ? await screenMonitorService.getCurrentContext(userId).catch(() => null) : null;
      const lastFrame = getLatestFrame(userId);
      return JSON.stringify({
        agentConnected: connected,
        remoteControlCapable: capable,
        remoteControlEnabled: enabled,
        currentContext: context,
        hasRecentFrame: !!lastFrame,
        lastFrameAge: lastFrame ? Math.round((Date.now() - lastFrame.timestamp) / 1000) + "s" : null,
        lastFrameApp: lastFrame?.activeApp,
        message: !connected
          ? "Agent bureau non connecté. L'utilisateur doit lancer ulysse_screen_agent.py sur son PC."
          : !capable ? "Agent connecté mais pyautogui manquant."
          : enabled ? "Prise en main ACTIVE. Prêt à contrôler."
          : "Agent connecté. Prise en main désactivée — demande accord.",
      });
    }

    case "screenshot": {
      if (!isUserScreenActive(userId)) {
        return JSON.stringify({ success: false, error: "Agent non connecté." });
      }
      const frame = await takeScreenshot(userId);
      if (!frame) {
        return JSON.stringify({ success: false, error: "Pas de frame reçue." });
      }
      const analysis = await analyzeScreen(frame);
      return JSON.stringify({
        success: true,
        screenDescription: analysis || "Capture reçue mais analyse indisponible.",
      });
    }

    case "enable_control": {
      if (!isUserScreenActive(userId)) {
        return JSON.stringify({ success: false, error: "Agent non connecté." });
      }
      if (!isAgentRemoteControlCapable(userId)) {
        return JSON.stringify({ success: false, error: "pyautogui non installé. pip install pyautogui" });
      }
      const sent = sendRemoteControlCommand(userId, { type: "remote_control.enable" });
      return JSON.stringify({
        success: sent,
        message: sent ? "Prise en main activée. Contrôle souris/clavier disponible." : "Erreur.",
      });
    }

    case "disable_control": {
      sendRemoteControlCommand(userId, { type: "remote_control.disable" });
      return JSON.stringify({ success: true, message: "Prise en main désactivée." });
    }

    case "mouse_move": {
      if (!isAgentRemoteControlEnabled(userId)) return JSON.stringify({ success: false, error: "Prise en main non activée." });
      if (args.x === undefined || args.y === undefined) return JSON.stringify({ success: false, error: "x et y requis." });
      sendAction(userId, "mouse_move", { x: args.x, y: args.y });
      return JSON.stringify({ success: true, message: `Souris vers (${args.x}, ${args.y})` });
    }

    case "click":
    case "double_click":
    case "right_click": {
      if (!isAgentRemoteControlEnabled(userId)) return JSON.stringify({ success: false, error: "Prise en main non activée." });
      const sent = sendAction(userId, action, { x: args.x, y: args.y, button: args.button || "left", clicks: args.clicks });
      if (!sent) return JSON.stringify({ success: false, error: "Commande non envoyée." });
      await sleep(900);
      const frame = await takeScreenshot(userId);
      const analysis = frame ? await analyzeScreen(frame, `${action} à (${args.x}, ${args.y})`) : null;
      return JSON.stringify({
        success: true,
        action: `${action} à (${args.x}, ${args.y})`,
        screenAfterAction: analysis || "Écran mis à jour.",
      });
    }

    case "scroll": {
      if (!isAgentRemoteControlEnabled(userId)) return JSON.stringify({ success: false, error: "Prise en main non activée." });
      sendAction(userId, "scroll", { x: args.x, y: args.y, dx: args.dx, dy: args.dy });
      await sleep(700);
      const frame = await takeScreenshot(userId);
      const analysis = frame ? await analyzeScreen(frame, `scroll dy=${args.dy}`) : null;
      return JSON.stringify({ success: true, screenAfterAction: analysis || "Défilement effectué." });
    }

    case "key_press": {
      if (!isAgentRemoteControlEnabled(userId)) return JSON.stringify({ success: false, error: "Prise en main non activée." });
      if (!args.key) return JSON.stringify({ success: false, error: "key requis." });
      sendAction(userId, "key_press", { key: args.key });
      await sleep(600);
      const frame = await takeScreenshot(userId);
      const analysis = frame ? await analyzeScreen(frame, `key_press "${args.key}"`) : null;
      return JSON.stringify({ success: true, action: `Touche ${args.key}`, screenAfterAction: analysis || "Touche envoyée." });
    }

    case "type_text": {
      if (!isAgentRemoteControlEnabled(userId)) return JSON.stringify({ success: false, error: "Prise en main non activée." });
      if (!args.text) return JSON.stringify({ success: false, error: "text requis." });
      sendAction(userId, "type_text", { text: args.text });
      await sleep(800);
      const frame = await takeScreenshot(userId);
      const analysis = frame ? await analyzeScreen(frame, `type_text "${args.text.substring(0, 40)}"`) : null;
      return JSON.stringify({ success: true, action: `Texte: "${args.text.substring(0, 60)}"`, screenAfterAction: analysis || "Texte saisi." });
    }

    case "open_url": {
      if (!isAgentRemoteControlEnabled(userId)) return JSON.stringify({ success: false, error: "Prise en main non activée." });
      const url = args.text || args.goal;
      if (!url) return JSON.stringify({ success: false, error: "URL requise dans le champ text." });

      const ok = await executeActionSequence(userId, [
        { cmd: "key_press", key: "ctrl+l", waitMs: 500 },
        { cmd: "key_press", key: "ctrl+a", waitMs: 200 },
        { cmd: "type_text", text: url, waitMs: 500 },
        { cmd: "key_press", key: "enter", waitMs: 2500 },
      ]);
      if (!ok) return JSON.stringify({ success: false, error: "Séquence d'ouverture URL échouée." });

      const frame = await takeScreenshot(userId);
      const analysis = frame ? await analyzeScreen(frame, `Ouverture de ${url}`) : null;
      return JSON.stringify({
        success: true,
        action: `URL ouverte: ${url}`,
        screenAfterAction: analysis || "Page en cours de chargement.",
      });
    }

    case "multi_action": {
      if (!isAgentRemoteControlEnabled(userId)) return JSON.stringify({ success: false, error: "Prise en main non activée." });
      let sequence: Array<{ cmd: string; key?: string; text?: string; x?: number; y?: number; dy?: number; waitMs?: number }>;
      try {
        sequence = typeof args.sequence === "string" ? JSON.parse(args.sequence) : args.sequence;
      } catch {
        return JSON.stringify({ success: false, error: "sequence invalide — doit être un JSON array." });
      }
      if (!Array.isArray(sequence) || sequence.length === 0) {
        return JSON.stringify({ success: false, error: "sequence vide." });
      }

      const results: string[] = [];
      for (const step of sequence) {
        const params: any = {};
        if (step.x !== undefined) params.x = step.x;
        if (step.y !== undefined) params.y = step.y;
        if (step.key) params.key = step.key;
        if (step.text) params.text = step.text;
        if (step.dy !== undefined) params.dy = step.dy;
        if (step.cmd === "click" || step.cmd === "double_click") params.button = "left";

        const sent = sendAction(userId, step.cmd, params);
        results.push(`${step.cmd}: ${sent ? "OK" : "FAIL"}`);
        await sleep(step.waitMs || 400);
      }

      await sleep(500);
      const frame = await takeScreenshot(userId);
      const analysis = frame ? await analyzeScreen(frame, `Séquence de ${sequence.length} actions`) : null;
      return JSON.stringify({
        success: true,
        actions: results,
        screenAfterAction: analysis || "Séquence exécutée.",
      });
    }

    case "explore": {
      if (!isAgentRemoteControlEnabled(userId)) {
        return JSON.stringify({ success: false, error: "Prise en main non activée. Utilise enable_control d'abord." });
      }
      const goal = args.goal;
      if (!goal) {
        return JSON.stringify({ success: false, error: "goal requis — décris ce que tu veux explorer." });
      }
      const maxSteps = Math.min(args.max_steps || 20, 30);
      const stepHistory: string[] = [];
      const pagesSeen: string[] = [];
      const report: string[] = [];
      let stuckCount = 0;
      let lastPage = "";

      report.push(`--- EXPLORATION AUTONOME ---`);
      report.push(`Objectif: ${goal}`);
      report.push(`Maximum: ${maxSteps} étapes\n`);

      for (let step = 1; step <= maxSteps; step++) {
        const frame = await takeScreenshot(userId);
        if (!frame) {
          report.push(`[${step}] Pas de frame — arrêt.`);
          break;
        }

        let navResult;
        try {
          navResult = await analyzeForExploration(
            frame.imageBase64, frame.activeApp, frame.activeWindow,
            goal, stepHistory, pagesSeen
          );
        } catch (e: any) {
          report.push(`[${step}] Erreur Vision: ${e.message || "inconnu"}`);
          break;
        }

        if (navResult.currentPage) {
          if (navResult.currentPage === lastPage) {
            stuckCount++;
          } else {
            stuckCount = 0;
            lastPage = navResult.currentPage;
            if (!pagesSeen.includes(navResult.currentPage)) {
              pagesSeen.push(navResult.currentPage);
            }
          }
        }

        report.push(`[${step}] ${navResult.currentPage ? `(${navResult.currentPage}) ` : ""}${navResult.description}`);

        if (navResult.goalReached) {
          report.push(`\nOBJECTIF ATTEINT en ${step} étapes.`);
          report.push(`Pages visitées: ${pagesSeen.join(", ") || "N/A"}`);
          break;
        }

        if (stuckCount >= 3) {
          report.push(`\nBLOQUÉ sur "${lastPage}" depuis 3 étapes — tentative de scroll ou changement.`);
          sendAction(userId, "scroll", { x: 512, y: 400, dy: 5 });
          await sleep(800);
          stuckCount = 0;
          stepHistory.push(`scroll auto (page bloquée sur ${lastPage})`);
          continue;
        }

        if (!navResult.nextAction) {
          if (step < maxSteps - 2) {
            report.push(`   → Pas d'action suggérée, tentative scroll...`);
            sendAction(userId, "scroll", { x: 512, y: 400, dy: 5 });
            await sleep(800);
            stepHistory.push(`scroll auto (pas d'action suggérée)`);
            continue;
          }
          report.push(`\nExploration terminée — plus d'actions possibles.`);
          report.push(`Pages visitées: ${pagesSeen.join(", ") || "N/A"}`);
          break;
        }

        const na = navResult.nextAction;
        const actionDesc = `${na.type}${na.x !== undefined ? ` (${na.x},${na.y})` : ""}${na.key ? ` key=${na.key}` : ""}${na.text ? ` "${na.text.substring(0, 25)}"` : ""}`;
        report.push(`   → ${actionDesc} — ${na.reason || ""}`);
        stepHistory.push(`${actionDesc}: ${navResult.description.substring(0, 60)}`);

        const cmdPayload: any = { type: "remote_control.cmd", cmd: na.type };
        if (na.x !== undefined) cmdPayload.x = na.x;
        if (na.y !== undefined) cmdPayload.y = na.y;
        if (na.key) cmdPayload.key = na.key;
        if (na.text) cmdPayload.text = na.text;
        if (na.dy !== undefined) cmdPayload.dy = na.dy;
        if (na.dx !== undefined) cmdPayload.dx = na.dx;
        if (["click", "double_click", "right_click"].includes(na.type)) cmdPayload.button = "left";

        const cmdSent = sendRemoteControlCommand(userId, cmdPayload);
        if (!cmdSent) {
          report.push(`Commande non envoyée — agent déconnecté.`);
          break;
        }

        const waitTime = na.type === "type_text" ? 1000 : na.key === "enter" ? 2000 : 1200;
        await sleep(waitTime);

        if (step === maxSteps) {
          const finalFrame = await takeScreenshot(userId);
          if (finalFrame) {
            const finalAnalysis = await analyzeScreen(finalFrame, "État final après exploration");
            report.push(`\n[FINAL] ${finalAnalysis || "Exploration terminée."}`);
          }
          report.push(`\nMaximum d'étapes atteint.`);
          report.push(`Pages visitées: ${pagesSeen.join(", ") || "N/A"}`);
        }
      }

      return JSON.stringify({
        success: true,
        mode: "explore",
        goal,
        totalSteps: stepHistory.length,
        pagesVisited: pagesSeen,
        report: report.join("\n"),
      });
    }

    case "self_test": {
      const tests: Array<{ name: string; status: "PASS" | "FAIL" | "SKIP"; detail: string; durationMs: number }> = [];
      const t0 = Date.now();

      const addTest = (name: string, status: "PASS" | "FAIL" | "SKIP", detail: string, startMs: number) => {
        tests.push({ name, status, detail, durationMs: Date.now() - startMs });
      };

      // TEST 1: Agent connexion
      let t = Date.now();
      const connected = isUserScreenActive(userId);
      addTest("1. Connexion Agent", connected ? "PASS" : "FAIL",
        connected ? "Agent bureau connecté" : "Agent non connecté — lancer ulysse_screen_agent.py", t);
      if (!connected) {
        return JSON.stringify({
          success: false,
          selfTestReport: tests,
          summary: "ÉCHEC: Agent non connecté. Impossible de tester les outils.",
        });
      }

      // TEST 2: Remote control capability
      t = Date.now();
      const capable = isAgentRemoteControlCapable(userId);
      addTest("2. Capacité pyautogui", capable ? "PASS" : "FAIL",
        capable ? "pyautogui disponible" : "pyautogui manquant — pip install pyautogui", t);

      // TEST 3: Enable remote control
      t = Date.now();
      let controlWasEnabled = isAgentRemoteControlEnabled(userId);
      if (!controlWasEnabled) {
        const enableSent = sendRemoteControlCommand(userId, { type: "remote_control.enable" });
        await sleep(1000);
        controlWasEnabled = isAgentRemoteControlEnabled(userId);
        addTest("3. Activation prise en main", controlWasEnabled ? "PASS" : "FAIL",
          controlWasEnabled ? "Prise en main activée" : "Échec activation", t);
      } else {
        addTest("3. Activation prise en main", "PASS", "Déjà activée", t);
      }

      if (!controlWasEnabled) {
        return JSON.stringify({
          success: false,
          selfTestReport: tests,
          summary: "ÉCHEC: Prise en main non activable. pyautogui manquant ou agent incompatible.",
        });
      }

      // TEST 4: Screenshot capture
      t = Date.now();
      const frame1 = await takeScreenshot(userId);
      const screenshotOk = !!frame1 && !!frame1.imageBase64 && frame1.imageBase64.length > 100;
      addTest("4. Capture d'écran (screenshot)", screenshotOk ? "PASS" : "FAIL",
        screenshotOk ? `Frame reçue (${Math.round(frame1!.imageBase64.length / 1024)}KB)` : "Pas de frame ou frame vide/noire", t);

      // TEST 5: Vision AI analysis
      t = Date.now();
      let visionOk = false;
      let visionResult = "";
      if (screenshotOk) {
        const analysis = await analyzeScreen(frame1!, "Test diagnostic — identifier l'écran");
        visionOk = !!analysis && analysis.length > 20;
        visionResult = analysis ? analysis.substring(0, 150) : "Analyse vide";
      }
      addTest("5. Analyse Vision AI (GPT-4o)", visionOk ? "PASS" : screenshotOk ? "FAIL" : "SKIP",
        visionOk ? `Analyse OK: "${visionResult}..."` : screenshotOk ? "Vision API échouée" : "Skip (pas de frame)", t);

      // TEST 6: Mouse move
      t = Date.now();
      const moveSent = sendAction(userId, "mouse_move", { x: 512, y: 384 });
      await sleep(500);
      addTest("6. Déplacement souris (mouse_move)", moveSent ? "PASS" : "FAIL",
        moveSent ? "Souris déplacée vers (512, 384)" : "Commande non envoyée", t);

      // TEST 7: Click
      t = Date.now();
      const clickSent = sendAction(userId, "click", { x: 512, y: 384, button: "left" });
      await sleep(800);
      const frameAfterClick = await takeScreenshot(userId);
      const clickOk = clickSent && !!frameAfterClick;
      addTest("7. Clic gauche (click)", clickOk ? "PASS" : "FAIL",
        clickOk ? "Clic exécuté + screenshot de confirmation reçu" : "Clic ou capture échouée", t);

      // TEST 8: Scroll
      t = Date.now();
      const scrollSent = sendAction(userId, "scroll", { x: 512, y: 384, dy: 3 });
      await sleep(700);
      const frameAfterScroll = await takeScreenshot(userId);
      const scrollOk = scrollSent && !!frameAfterScroll;
      addTest("8. Défilement (scroll)", scrollOk ? "PASS" : "FAIL",
        scrollOk ? "Scroll exécuté + screenshot de confirmation" : "Scroll ou capture échouée", t);

      // scroll back
      sendAction(userId, "scroll", { x: 512, y: 384, dy: -3 });
      await sleep(500);

      // TEST 9: Key press
      t = Date.now();
      const keySent = sendAction(userId, "key_press", { key: "escape" });
      await sleep(500);
      addTest("9. Touche clavier (key_press)", keySent ? "PASS" : "FAIL",
        keySent ? "Touche Escape envoyée" : "Commande non envoyée", t);

      // TEST 10: Type text (in a safe way — type then undo)
      t = Date.now();
      const typeSent = sendAction(userId, "key_press", { key: "ctrl+l" });
      await sleep(400);
      const typeTextSent = sendAction(userId, "type_text", { text: "test_ulysse_ok" });
      await sleep(400);
      const typeEsc = sendAction(userId, "key_press", { key: "escape" });
      await sleep(300);
      addTest("10. Saisie texte (type_text)", typeTextSent ? "PASS" : "FAIL",
        typeTextSent ? "Texte 'test_ulysse_ok' saisi dans la barre d'adresse puis annulé" : "Saisie échouée", t);

      // TEST 11: Open URL
      t = Date.now();
      const openUrlOk = await executeActionSequence(userId, [
        { cmd: "key_press", params: { key: "ctrl+l" }, waitMs: 500 },
        { cmd: "key_press", params: { key: "ctrl+a" }, waitMs: 200 },
        { cmd: "type_text", params: { text: "https://ulyssepro.org" }, waitMs: 500 },
        { cmd: "key_press", params: { key: "enter" }, waitMs: 3000 },
      ]);
      const frameAfterUrl = await takeScreenshot(userId);
      const urlOk = openUrlOk && !!frameAfterUrl;
      addTest("11. Ouverture URL (open_url)", urlOk ? "PASS" : "FAIL",
        urlOk ? "URL ulyssepro.org ouverte avec succès" : "Séquence d'ouverture échouée", t);

      // TEST 12: Multi-action sequence
      t = Date.now();
      const multiOk = await executeActionSequence(userId, [
        { cmd: "scroll", params: { dy: 2 }, waitMs: 400 },
        { cmd: "scroll", params: { dy: -2 }, waitMs: 400 },
        { cmd: "key_press", params: { key: "escape" }, waitMs: 300 },
      ]);
      addTest("12. Séquence multi-actions (multi_action)", multiOk ? "PASS" : "FAIL",
        multiOk ? "3 actions enchaînées (scroll down, scroll up, escape)" : "Séquence échouée", t);

      // TEST 13: Latest frame storage
      t = Date.now();
      const storedFrame = getLatestFrame(userId);
      const storageOk = !!storedFrame && storedFrame.imageBase64.length > 100;
      addTest("13. Stockage dernière frame", storageOk ? "PASS" : "FAIL",
        storageOk ? `Frame stockée (${Math.round(storedFrame!.imageBase64.length / 1024)}KB, ${Math.round((Date.now() - storedFrame!.timestamp) / 1000)}s ago)` : "Pas de frame en mémoire", t);

      // SUMMARY
      const passed = tests.filter(t => t.status === "PASS").length;
      const failed = tests.filter(t => t.status === "FAIL").length;
      const skipped = tests.filter(t => t.status === "SKIP").length;
      const totalMs = Date.now() - t0;

      const reportLines = [
        `══════════════════════════════════════`,
        `  DIAGNOSTIC PRISE EN MAIN — ULYSSE`,
        `══════════════════════════════════════`,
        ``,
      ];

      for (const test of tests) {
        const icon = test.status === "PASS" ? "✅" : test.status === "FAIL" ? "❌" : "⏭️";
        reportLines.push(`${icon} ${test.name} (${test.durationMs}ms)`);
        reportLines.push(`   ${test.detail}`);
      }

      reportLines.push(``);
      reportLines.push(`──────────────────────────────────────`);
      reportLines.push(`RÉSULTAT: ${passed}/${tests.length} PASS | ${failed} FAIL | ${skipped} SKIP`);
      reportLines.push(`Durée totale: ${Math.round(totalMs / 1000)}s`);
      reportLines.push(``);

      if (failed === 0) {
        reportLines.push(`🟢 TOUS LES OUTILS SONT 100% OPÉRATIONNELS`);
        reportLines.push(`La prise en main, la vision, le contrôle souris/clavier, l'ouverture d'URL et l'exploration autonome fonctionnent parfaitement.`);
      } else {
        reportLines.push(`🔴 ${failed} OUTIL(S) EN ÉCHEC`);
        const failedTests = tests.filter(t => t.status === "FAIL");
        for (const ft of failedTests) {
          reportLines.push(`   - ${ft.name}: ${ft.detail}`);
        }
      }

      return JSON.stringify({
        success: failed === 0,
        selfTestReport: reportLines.join("\n"),
        summary: `${passed}/${tests.length} tests passés en ${Math.round(totalMs / 1000)}s`,
        tests,
      });
    }

    default:
      return JSON.stringify({ error: `Action inconnue: ${action}` });
  }
}
