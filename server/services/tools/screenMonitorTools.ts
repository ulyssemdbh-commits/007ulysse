import OpenAI from "openai";
import {
  isUserScreenActive,
  isAgentRemoteControlCapable,
  isAgentRemoteControlEnabled,
  sendRemoteControlCommand,
} from "../../services/screenMonitorWs";
import { screenMonitorService } from "../../services/screenMonitorService";

type ChatCompletionTool = OpenAI.Chat.Completions.ChatCompletionTool;

export const screenMonitorToolDefs: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "screen_monitor_manage",
      description: `Ulysse Vision — Outil de contrôle du bureau de l'utilisateur via l'agent Windows.

Permet à Ulysse de :
- Voir l'état de la connexion avec l'agent bureau
- Demander un screenshot immédiat de l'écran
- Activer/désactiver la prise en main à distance
- Déplacer la souris, cliquer, saisir du texte, appuyer sur des touches

IMPORTANT : N'utilise jamais la prise en main sans l'accord explicite de l'utilisateur. Propose toujours d'abord. Si l'utilisateur dit "prends le contrôle", "aide-moi directement", "fais-le pour moi" ou "prise en main" → active le contrôle et exécute les commandes nécessaires.

Actions disponibles :
- status : Vérifie si l'agent est connecté et si la prise en main est active/disponible
- screenshot : Demande une capture d'écran immédiate à l'agent
- enable_control : Active la prise en main (demande l'accord si pas encore fait)
- disable_control : Désactive la prise en main
- mouse_move : Déplace la souris vers (x, y)
- click : Clic gauche/droit/milieu à (x, y)
- double_click : Double-clic à (x, y)
- right_click : Clic droit à (x, y)
- scroll : Défilement vertical/horizontal à (x, y)
- key_press : Appui sur une touche ou combinaison (ex: "ctrl+c", "alt+tab", "enter")
- type_text : Saisie de texte au clavier`,
      parameters: {
        type: "object",
        required: ["action"],
        properties: {
          action: {
            type: "string",
            enum: [
              "status",
              "screenshot",
              "enable_control",
              "disable_control",
              "mouse_move",
              "click",
              "double_click",
              "right_click",
              "scroll",
              "key_press",
              "type_text",
            ],
            description: "Action à effectuer",
          },
          x: { type: "number", description: "Coordonnée X de la souris (pixels)" },
          y: { type: "number", description: "Coordonnée Y de la souris (pixels)" },
          button: {
            type: "string",
            enum: ["left", "right", "middle"],
            description: "Bouton de souris à utiliser (défaut: left)",
          },
          key: {
            type: "string",
            description: "Touche ou combinaison à appuyer (ex: 'ctrl+c', 'alt+tab', 'enter', 'escape', 'win')",
          },
          text: { type: "string", description: "Texte à saisir au clavier" },
          clicks: { type: "number", description: "Nombre de clics" },
          dx: { type: "number", description: "Défilement horizontal (pour scroll)" },
          dy: { type: "number", description: "Défilement vertical (pour scroll, positif = bas)" },
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

      return JSON.stringify({
        agentConnected: connected,
        remoteControlCapable: capable,
        remoteControlEnabled: enabled,
        currentContext: context,
        message: !connected
          ? "Agent bureau non connecté. L'utilisateur doit lancer ulysse_screen_agent.py sur son PC Windows."
          : !capable
          ? "Agent connecté mais pyautogui non installé — la prise en main n'est pas disponible."
          : enabled
          ? "Prise en main ACTIVE. Prêt à contrôler le bureau."
          : "Agent connecté et capable. Prise en main désactivée — demande accord utilisateur avant d'activer.",
      });
    }

    case "screenshot": {
      const connected = isUserScreenActive(userId);
      if (!connected) {
        return JSON.stringify({ success: false, error: "Agent non connecté — impossible de prendre une capture." });
      }
      const sent = sendRemoteControlCommand(userId, { type: "remote_control.cmd", cmd: "screenshot" });
      return JSON.stringify({
        success: sent,
        message: sent
          ? "Capture d'écran demandée à l'agent. L'analyse arrivera dans le contexte sous quelques secondes."
          : "Impossible d'envoyer la commande — agent déconnecté.",
      });
    }

    case "enable_control": {
      const connected = isUserScreenActive(userId);
      if (!connected) {
        return JSON.stringify({ success: false, error: "Agent non connecté. L'utilisateur doit lancer l'agent bureau Windows." });
      }
      const capable = isAgentRemoteControlCapable(userId);
      if (!capable) {
        return JSON.stringify({ success: false, error: "pyautogui non installé sur le bureau. Demandez à l'utilisateur d'exécuter: pip install pyautogui" });
      }
      const sent = sendRemoteControlCommand(userId, { type: "remote_control.enable" });
      return JSON.stringify({
        success: sent,
        message: sent
          ? "✅ Prise en main activée. Je peux maintenant contrôler la souris et le clavier. RAPPEL SÉCURITÉ : l'utilisateur peut désactiver en déplaçant la souris en haut à gauche de l'écran."
          : "Erreur lors de l'activation.",
      });
    }

    case "disable_control": {
      const sent = sendRemoteControlCommand(userId, { type: "remote_control.disable" });
      return JSON.stringify({
        success: sent,
        message: "Prise en main désactivée.",
      });
    }

    case "mouse_move": {
      if (!isAgentRemoteControlEnabled(userId)) {
        return JSON.stringify({ success: false, error: "Prise en main non activée. Utilise enable_control d'abord." });
      }
      if (args.x === undefined || args.y === undefined) {
        return JSON.stringify({ success: false, error: "x et y requis pour mouse_move" });
      }
      const sent = sendRemoteControlCommand(userId, {
        type: "remote_control.cmd",
        cmd: "mouse_move",
        x: args.x,
        y: args.y,
      });
      return JSON.stringify({ success: sent, message: sent ? `Souris déplacée vers (${args.x}, ${args.y})` : "Erreur" });
    }

    case "click":
    case "double_click":
    case "right_click": {
      if (!isAgentRemoteControlEnabled(userId)) {
        return JSON.stringify({ success: false, error: "Prise en main non activée." });
      }
      const cmdMap: Record<string, string> = {
        click: "click",
        double_click: "double_click",
        right_click: "right_click",
      };
      const sent = sendRemoteControlCommand(userId, {
        type: "remote_control.cmd",
        cmd: cmdMap[action],
        x: args.x,
        y: args.y,
        button: args.button || "left",
        clicks: args.clicks,
      });
      return JSON.stringify({
        success: sent,
        message: sent ? `${action} exécuté à (${args.x ?? "?"}, ${args.y ?? "?"})` : "Erreur",
      });
    }

    case "scroll": {
      if (!isAgentRemoteControlEnabled(userId)) {
        return JSON.stringify({ success: false, error: "Prise en main non activée." });
      }
      const sent = sendRemoteControlCommand(userId, {
        type: "remote_control.cmd",
        cmd: "scroll",
        x: args.x,
        y: args.y,
        dx: args.dx,
        dy: args.dy,
      });
      return JSON.stringify({ success: sent, message: sent ? `Défilement exécuté` : "Erreur" });
    }

    case "key_press": {
      if (!isAgentRemoteControlEnabled(userId)) {
        return JSON.stringify({ success: false, error: "Prise en main non activée." });
      }
      if (!args.key) {
        return JSON.stringify({ success: false, error: "key requis pour key_press" });
      }
      const sent = sendRemoteControlCommand(userId, {
        type: "remote_control.cmd",
        cmd: "key_press",
        key: args.key,
      });
      return JSON.stringify({ success: sent, message: sent ? `Touche "${args.key}" envoyée` : "Erreur" });
    }

    case "type_text": {
      if (!isAgentRemoteControlEnabled(userId)) {
        return JSON.stringify({ success: false, error: "Prise en main non activée." });
      }
      if (!args.text) {
        return JSON.stringify({ success: false, error: "text requis pour type_text" });
      }
      const sent = sendRemoteControlCommand(userId, {
        type: "remote_control.cmd",
        cmd: "type_text",
        text: args.text,
      });
      return JSON.stringify({ success: sent, message: sent ? `Texte saisi: "${args.text.substring(0, 50)}${args.text.length > 50 ? "..." : ""}"` : "Erreur" });
    }

    default:
      return JSON.stringify({ error: `Action inconnue: ${action}` });
  }
}
