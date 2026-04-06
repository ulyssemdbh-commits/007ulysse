# ALGORITHMES ULYSSE - CODE SOURCE COMPLET V5

Ce document contient les services principaux qui définissent le fonctionnement d'Ulysse.
Il sert de **triple référence** :
- **Pour Maurice** : comprendre comment Ulysse fonctionne et proposer des améliorations
- **Pour le développeur (Replit Agent)** : guide technique pour modifier/étendre les algorithmes
- **Pour Ulysse lui-même** : auto-référence permettant à l'IA de comprendre ses propres mécanismes, diagnostiquer ses comportements, et proposer des améliorations de manière autonome

**Dernière mise à jour:** 31 Mars 2026

**Services documentés:**
1. **Action-First Orchestrator V4** - Architecture unifiée avec contrôle d'accès strict par persona
2. **UnifiedMarkerExecutor** - Exécution centralisée de tous les marqueurs avec permissions
3. **Ulysse Tools V2** - Outils OpenAI Function Calling avec exécution immédiate (90 handlers via ActionHub)
4. Capability Service - Gestion des 249+ capacités
5. Action Verification Service - Scoring Efficacité/Cohérence/Précision
6. Self-Awareness/Diagnostics - Auto-diagnostic système
7. MARS (Web Search) - Recherche web multi-tier
8. Speaker-Persona Integration - Mapping speaker → persona
9. Brain Sync Service - Synchronisation mémoire avec importance-weighting
10. Autonomous Learning Service V3 - Apprentissage par couches (5 niveaux)
11. Trading Analysis Service - Expert Trader V2
12. Voice Auth Service - Authentification vocale
13. **Architecture V2** - Services avancés (DecisionEngine, PersonaProfiles, BrainContext, SystemMetrics, FlowService)
14. **AI System Integration** - Auto-diagnostic, usage/behavior tracking, mode management, patches (V5)
15. **Scheduled Jobs System** - 56+ jobs programmés avec DynamicPrioritizer (scores 0-100, cache 5s)
16. **Footdatas Sync Service** - Synchronisation automatique des données football depuis API (V5)
17. **Stock DB Persistence** - Persistance watchlist/alertes/quotes en base de données (V5)
18. **Monitoring Active Checks** - Vérification proactive des sites toutes les 5 minutes (V5)
19. **SelfHealingService** - Auto-guérison avec refreshCache() dédupliqué (V6)
20. **MaxAI Anti-Read-Loop** - Détection boucle lecture-seulement + injection d'écriture forcée (V6)
21. **DevMax SaaS** - Plateforme DevOps multi-tenant avec 8/9 features SaaS implémentées (V6)
22. **ChatCOBA** - Assistant IA embarqué pour clients pro macommande.shop, isolation stricte par tenant, 11 outils COBA (V6)
23. **Smart Sync** - Push GitHub optimisé par comparaison SHA blob (V7, économie ~80% API calls)
24. **Prometheus Metrics** - Endpoint `/metrics` avec 20+ métriques (latence, coûts IA, mémoire, erreurs)
25. **2FA Discord+Email** - Authentification 2FA via Discord (primaire) + email fallback (AgentMail)

---

## 1. ACTION-FIRST ORCHESTRATOR V4 (NOUVEAU)

### 1.1 Philosophie Centrale
**Ulysse n'est PAS un chatbot passif. C'est un assistant AUTONOME qui AGIT.**

### 1.2 Architecture Unifiée

L'Action-First Orchestrator V4 unifie le backend OpenAI function calling et le système de marqueurs runtime avec un contrôle d'accès strict par persona.

```typescript
// server/services/actionFirstOrchestrator.ts

interface ActionContext {
  userId: number;
  userRole: string;
  isOwner: boolean;
  persona: 'ulysse' | 'iris' | 'alfred';
  conversationId?: number;
}

interface WorkflowDetection {
  detected: boolean;
  workflow: ActionWorkflow | null;
  confidence: number;
  triggers: string[];
}

interface ExecutionPlan {
  actionFirstEnabled: boolean;
  allowedMarkers: string[];
  blockedMarkers: string[];
  promptInjection: string;
  executionMode: 'parallel' | 'sequential';
}

class ActionFirstOrchestrator {
  // Actions réservées au propriétaire uniquement
  private readonly OWNER_ONLY_ACTIONS = [
    'kanban', 'drive', 'notion', 'domotique', 
    'integration', 'face_recognition', 'image_generation'
  ];
  
  // Actions autorisées pour la famille (Ulysse + Iris)
  private readonly FAMILY_ACTIONS = [
    'email', 'todoist', 'spotify', 'image_search'
  ];

  /**
   * Détermine la persona basée sur le rôle utilisateur
   * Owner → Ulysse, role=approved → Iris, autres → Alfred
   */
  getPersona(context: ActionContext): 'ulysse' | 'iris' | 'alfred' {
    if (context.isOwner) return 'ulysse';
    if (context.userRole === 'approved') return 'iris';
    return 'alfred';
  }

  /**
   * Vérifie si Action-First est activé pour cette persona
   * Alfred: JAMAIS d'exécution automatique
   */
  isActionFirstEnabled(persona: 'ulysse' | 'iris' | 'alfred'): boolean {
    return persona !== 'alfred';
  }

  /**
   * Génère le plan d'exécution avec permissions strictes
   */
  createExecutionPlan(
    context: ActionContext, 
    workflow: WorkflowDetection
  ): ExecutionPlan {
    const persona = this.getPersona(context);
    const enabled = this.isActionFirstEnabled(persona);
    
    // Alfred: Tout bloqué
    if (persona === 'alfred') {
      return {
        actionFirstEnabled: false,
        allowedMarkers: [],
        blockedMarkers: [...this.OWNER_ONLY_ACTIONS, ...this.FAMILY_ACTIONS],
        promptInjection: this.getAlfredPrompt(),
        executionMode: 'sequential'
      };
    }
    
    // Iris: Family actions seulement
    if (persona === 'iris') {
      return {
        actionFirstEnabled: true,
        allowedMarkers: [...this.FAMILY_ACTIONS],
        blockedMarkers: [...this.OWNER_ONLY_ACTIONS],
        promptInjection: this.getIrisPrompt(workflow),
        executionMode: 'parallel'
      };
    }
    
    // Ulysse: Tout autorisé
    return {
      actionFirstEnabled: true,
      allowedMarkers: [...this.OWNER_ONLY_ACTIONS, ...this.FAMILY_ACTIONS],
      blockedMarkers: [],
      promptInjection: this.getUlyssePrompt(workflow),
      executionMode: 'parallel'
    };
  }
}
```

### 1.3 UnifiedMarkerExecutor - Exécution Centralisée

```typescript
// server/services/unifiedMarkerExecutor.ts

interface MarkerExecutionContext {
  userId: number;
  isOwner: boolean;
  userRole: string;
  persona: 'ulysse' | 'iris' | 'alfred';
  conversationId?: number;
}

interface MarkerResult {
  type: string;
  success: boolean;
  data?: any;
  error?: string;
  blocked?: boolean;
  reason?: string;
}

class UnifiedMarkerExecutor {
  private readonly OWNER_ONLY_MARKERS = [
    'kanban', 'drive', 'notion', 'domotique', 
    'integration', 'face_recognition', 'image_generation'
  ];
  
  private readonly FAMILY_MARKERS = [
    'email', 'todoist', 'spotify', 'image_search'
  ];

  /**
   * Parse tous les marqueurs dans un texte
   */
  parseMarkers(text: string): ParsedMarker[] {
    const markers: ParsedMarker[] = [];
    const patterns = [
      { type: 'email', regex: /\[EMAIL_PREVIEW\]([\s\S]*?)\[\/EMAIL_PREVIEW\]/g },
      { type: 'email_send', regex: /\[EMAIL_SEND\]([\s\S]*?)\[\/EMAIL_SEND\]/g },
      { type: 'todoist', regex: /\[TODOIST_TASK\]([\s\S]*?)\[\/TODOIST_TASK\]/g },
      { type: 'kanban', regex: /\[KANBAN_TASK\]([\s\S]*?)\[\/KANBAN_TASK\]/g },
      { type: 'drive', regex: /\[DRIVE_ACTION\]([\s\S]*?)\[\/DRIVE_ACTION\]/g },
      { type: 'notion', regex: /\[NOTION_ACTION\]([\s\S]*?)\[\/NOTION_ACTION\]/g },
      { type: 'domotique', regex: /\[DOMOTIQUE\]([\s\S]*?)\[\/DOMOTIQUE\]/g },
      { type: 'spotify', regex: /\[SPOTIFY\]([\s\S]*?)\[\/SPOTIFY\]/g },
      { type: 'image', regex: /\[IMAGE_GENERATE\]([\s\S]*?)\[\/IMAGE_GENERATE\]/g }
    ];
    
    for (const { type, regex } of patterns) {
      let match;
      while ((match = regex.exec(text)) !== null) {
        markers.push({ type, content: match[1], fullMatch: match[0] });
      }
    }
    
    return markers;
  }

  /**
   * Vérifie les permissions pour un marqueur
   */
  checkPermission(markerType: string, context: MarkerExecutionContext): {
    allowed: boolean;
    reason?: string;
  } {
    // Alfred: BLOCAGE TOTAL
    if (context.persona === 'alfred') {
      return { 
        allowed: false, 
        reason: 'Alfred cannot execute actions automatically - confirmation required' 
      };
    }
    
    // Owner-only markers
    if (this.OWNER_ONLY_MARKERS.includes(markerType)) {
      if (!context.isOwner) {
        return { 
          allowed: false, 
          reason: `${markerType} is owner-only action` 
        };
      }
    }
    
    // Family markers (Ulysse + Iris)
    if (this.FAMILY_MARKERS.includes(markerType)) {
      if (context.persona !== 'ulysse' && context.persona !== 'iris') {
        return { 
          allowed: false, 
          reason: `${markerType} requires family access` 
        };
      }
    }
    
    return { allowed: true };
  }

  /**
   * Exécute tous les marqueurs avec permissions
   */
  async executeAll(
    text: string, 
    context: MarkerExecutionContext
  ): Promise<{
    results: MarkerResult[];
    cleanedText: string;
  }> {
    const markers = this.parseMarkers(text);
    const results: MarkerResult[] = [];
    let cleanedText = text;
    
    // Exécution parallèle pour performance
    const execPromises = markers.map(async (marker) => {
      const permission = this.checkPermission(marker.type, context);
      
      if (!permission.allowed) {
        return {
          type: marker.type,
          success: false,
          blocked: true,
          reason: permission.reason
        };
      }
      
      try {
        const result = await this.executeMarker(marker, context);
        return { type: marker.type, success: true, data: result };
      } catch (error: any) {
        return { type: marker.type, success: false, error: error.message };
      }
    });
    
    const execResults = await Promise.all(execPromises);
    
    // Nettoyer le texte des marqueurs exécutés
    for (const marker of markers) {
      cleanedText = cleanedText.replace(marker.fullMatch, '');
    }
    
    return { results: execResults, cleanedText: cleanedText.trim() };
  }
}
```

### 1.4 Intégration dans conversations.ts

```typescript
// server/api/v2/conversations.ts

import { actionFirstOrchestrator } from "../../services/actionFirstOrchestrator";
import { unifiedMarkerExecutor } from "../../services/unifiedMarkerExecutor";

// Dans processConversationRequest:
const context: ActionContext = {
  userId,
  userRole: user.role || 'user',
  isOwner: user.isOwner === true,
  persona: 'ulysse', // Déterminé dynamiquement
  conversationId
};

// Détecter workflow et créer plan d'exécution
const workflow = actionFirstOrchestrator.detectWorkflow(userMessage);
const plan = actionFirstOrchestrator.createExecutionPlan(context, workflow);

// Injection PRIORITAIRE du prompt Action-First (avant baseSystemPrompt)
const systemPrompt = plan.promptInjection + '\n\n' + baseSystemPrompt;

// Après réponse AI, exécuter les marqueurs avec permissions
const markerContext: MarkerExecutionContext = {
  userId,
  isOwner: context.isOwner,
  userRole: context.userRole,
  persona: context.persona,
  conversationId
};

const { results, cleanedText } = await unifiedMarkerExecutor.executeAll(
  aiResponse, 
  markerContext
);
```

### 1.5 Email Preview Broadcasting

```typescript
// Diffusion WebSocket pour previews d'email
import { broadcastToUser } from "../../websocket";

// Dans le handler de streaming:
if (chunk.includes('[EMAIL_PREVIEW]')) {
  const previewMatch = chunk.match(/\[EMAIL_PREVIEW\]([\s\S]*?)\[\/EMAIL_PREVIEW\]/);
  if (previewMatch) {
    try {
      const previewData = JSON.parse(previewMatch[1]);
      broadcastToUser(userId, {
        type: 'email.preview',
        data: previewData
      });
    } catch (e) {
      console.error('[EmailPreview] Parse error:', e);
    }
  }
}
```

### 1.6 Diagnostics et Métriques

```typescript
// Rapport diagnostic sans emojis
getDiagnosticReport(): string {
  const lines: string[] = [
    '=== ACTION-FIRST ORCHESTRATOR V4 DIAGNOSTICS ===',
    '',
    `[METRICS]`,
    `  Total Executions: ${this.metrics.totalExecutions}`,
    `  Successful: ${this.metrics.successfulExecutions}`,
    `  Failed: ${this.metrics.failedExecutions}`,
    `  Blocked (Alfred): ${this.metrics.blockedByPermission}`,
    '',
    `[PERMISSION MODEL]`,
    `  Owner-Only Actions: ${this.OWNER_ONLY_ACTIONS.join(', ')}`,
    `  Family Actions: ${this.FAMILY_ACTIONS.join(', ')}`,
    '',
    `[PERSONA ACCESS]`,
    `  Ulysse (owner): FULL ACCESS [OK]`,
    `  Iris (approved): FAMILY ONLY [OK]`,
    `  Alfred (other): BLOCKED [OK]`,
    '',
    `[STATUS] Action-First Orchestrator V4 operational`
  ];
  
  return lines.join('\n');
}
```

---

## 2. ACTION-FIRST BEHAVIOR RULES

### 2.1 Philosophie Centrale
**Ulysse n'est PAS un chatbot passif. C'est un assistant AUTONOME qui AGIT.**

```typescript
// server/config/ulysseBehaviorRules.ts

/**
 * RÈGLES DE COMPORTEMENT ACTION-FIRST POUR ULYSSE
 * 
 * Principe fondamental: AGIR D'ABORD, PARLER ENSUITE
 * 
 * Ces règles définissent le comportement d'exécution autonome d'Ulysse.
 * Elles s'appliquent à Ulysse (owner) et Iris (famille), mais PAS à Alfred (externe).
 */

export interface ActionWorkflow {
  trigger: string[];           // Mots-clés déclencheurs
  defaultAction: string;       // Action par défaut à exécuter
  outputType: "email_sent" | "email_with_pdf" | "email_with_word" | "email_reply" | 
              "todoist_task" | "kanban_task" | "calendar_event" | "prono_structured" | 
              "domotique_action" | "data_analysis" | "conversation";
  requiresConfirmation: boolean;  // TOUJOURS FALSE pour Action-First
  toolsToUse: string[];        // Outils à utiliser
  antiPattern: string;         // Ce qu'il ne faut PAS faire
}

export const ACTION_WORKFLOWS: Record<string, ActionWorkflow> = {
  email: {
    trigger: ["mail", "email", "écris à", "envoie à", "contacte", "réponds à"],
    defaultAction: "Envoyer l'email directement via email_send tool",
    outputType: "email_sent",
    requiresConfirmation: false,  // JAMAIS de confirmation
    toolsToUse: ["email_send", "email_list_inbox"],
    antiPattern: "Ne PAS juste proposer un brouillon sans l'envoyer"
  },
  
  document: {
    trigger: ["document", "pdf", "word", "excel", "rapport", "fichier", "plan"],
    defaultAction: "Créer et envoyer le fichier via email_send avec pièce jointe",
    outputType: "email_with_pdf",
    requiresConfirmation: false,
    toolsToUse: ["email_send", "image_generate", "memory_save"],
    antiPattern: "Ne PAS juste afficher du texte brut sans créer le fichier"
  },
  
  task: {
    trigger: ["tâche", "rappel", "reminder", "à faire", "todo", "ajoute", "planifie"],
    defaultAction: "Créer la tâche via todoist_create_task ou kanban_create_task",
    outputType: "todoist_task",
    requiresConfirmation: false,
    toolsToUse: ["todoist_create_task", "kanban_create_task", "memory_save"],
    antiPattern: "Ne PAS juste résumer ce qu'il faudrait faire"
  },
  
  calendar: {
    trigger: ["rdv", "rendez-vous", "réunion", "meeting", "calendrier", "agenda"],
    defaultAction: "Créer l'événement via calendar_create_event tool",
    outputType: "calendar_event",
    requiresConfirmation: false,  // SEULE exception: confirmation pour RDV importants
    toolsToUse: ["calendar_create_event", "calendar_list_events"],
    antiPattern: "Ne PAS juste lister ce qu'il faudrait planifier"
  },
  
  domotique: {
    trigger: ["lumière", "lampe", "éteins", "allume", "thermostat", "température", "volet"],
    defaultAction: "Exécuter la commande via smarthome_control tool",
    outputType: "domotique_action",
    requiresConfirmation: false,
    toolsToUse: ["smarthome_control"],
    antiPattern: "Ne PAS demander confirmation pour allumer/éteindre"
  },
  
  search: {
    trigger: ["cherche", "trouve", "recherche", "info sur", "c'est quoi", "explique"],
    defaultAction: "Rechercher via web_search et synthétiser",
    outputType: "data_analysis",
    requiresConfirmation: false,
    toolsToUse: ["web_search", "memory_save"],
    antiPattern: "Ne PAS dire 'je n'ai pas accès au web'"
  },
  
  prono: {
    trigger: ["prono", "pari", "cote", "match", "équipe", "foot", "paris sportif"],
    defaultAction: "Analyser et donner le pronostic structuré",
    outputType: "prono_structured",
    requiresConfirmation: false,
    toolsToUse: ["query_sports_data", "web_search", "memory_save"],
    antiPattern: "Ne PAS juste dire 'je ne suis pas un conseiller'"
  }
};
```

### 1.2 Directives de Comportement

```typescript
export const BEHAVIOR_DIRECTIVES = {
  // Règles impératives (ORDRE = PRIORITÉ)
  imperatives: [
    "TU EXÉCUTES les actions demandées IMMÉDIATEMENT",
    "TU UTILISES les outils disponibles SANS demander permission",
    "TU CONFIRMES après avoir agi, JAMAIS avant",
    "TU NE PROPOSES PAS d'alternatives - TU AGIS",
    "TU NE DIS JAMAIS 'je ne peux pas' - TU TROUVES un moyen"
  ],
  
  // Anti-patterns (comportements INTERDITS)
  antiPatterns: [
    "Proposer au lieu d'agir: 'Je peux t'envoyer...' → INTERDIT",
    "Demander confirmation: 'Veux-tu que je...' → INTERDIT sauf calendrier",
    "Donner des excuses: 'Je n'ai pas accès à...' → INTERDIT",
    "Lister sans exécuter: 'Voici ce que je ferais...' → INTERDIT",
    "Suggérer sans créer: 'Tu pourrais écrire...' → INTERDIT"
  ],
  
  // Capacités réelles (syntaxe exacte)
  realCapabilities: `
### CAPACITÉS D'EXÉCUTION DIRECTE:

📧 **EMAIL** - Utilise l'outil email_send:
   - Envoyer: email_send(to, subject, body)
   - Avec PDF: email_send avec pdfContent
   - Répondre: email_send avec messageId

📋 **TÂCHES** - Utilise les outils todoist/kanban:
   - Todoist: todoist_create_task(content, due_string, priority)
   - Kanban: kanban_create_task(title, description, priority)
   - Compléter: todoist_complete_task(task_name)

📅 **CALENDRIER** - Utilise calendar_create_event:
   - Créer RDV: calendar_create_event(title, start_datetime, end_datetime)
   - Lire: calendar_list_events(days_ahead)

🏠 **DOMOTIQUE** - Utilise smarthome_control:
   - Lumières: smarthome_control(action=turn_on/turn_off, device_name)
   - Scènes: smarthome_control(action=activate_scene, scene_name)

🔍 **RECHERCHE** - Utilise web_search:
   - Web: web_search(query)
   - Sports: query_sports_data(query_type, team)
   - Bourse: query_stock_data(symbol, query_type)

🎵 **SPOTIFY** - Utilise spotify_control:
   - Play/Pause: spotify_control(action=play/pause)
   - Recherche: spotify_control(action=search, query)
`
};
```

### 1.3 Prompt d'Injection Action-First

```typescript
export function getBehaviorPrompt(): string {
  return `
## 🎯 COMPORTEMENT ACTION-FIRST (OBLIGATOIRE)

Tu es Ulysse, un assistant qui EXÉCUTE les actions IMMÉDIATEMENT.
Tu ne proposes PAS, tu ne demandes PAS permission - TU AGIS.

### RÈGLES IMPÉRATIVES:
${BEHAVIOR_DIRECTIVES.imperatives.map((r, i) => `${i + 1}. ${r}`).join("\n")}

### COMPORTEMENT INTERDIT (ANTI-PATTERNS):
${BEHAVIOR_DIRECTIVES.antiPatterns.map(r => `✗ ${r}`).join("\n")}

### CAPACITÉS D'EXÉCUTION:
${BEHAVIOR_DIRECTIVES.realCapabilities}

### EXEMPLES:

❌ MAUVAIS: "Je peux t'envoyer un email si tu veux."
✅ BON: *Utilise email_send* "Email envoyé à [destinataire] !"

❌ MAUVAIS: "Je n'ai pas accès au web pour vérifier."
✅ BON: *Utilise web_search* "D'après mes recherches, [résultat]"

❌ MAUVAIS: "Je vais te créer une tâche si tu veux."
✅ BON: *Utilise todoist_create_task* "Tâche créée pour demain !"

🔴 RAPPEL CRITIQUE: Tu n'es PAS un chatbot passif. Tu es Ulysse, un assistant AUTONOME qui AGIT.
`;
}
```

### 1.4 Détection de Workflow et Enhancement

```typescript
export function detectWorkflow(userMessage: string): ActionWorkflow | null {
  const lowerMessage = userMessage.toLowerCase();
  
  for (const [key, workflow] of Object.entries(ACTION_WORKFLOWS)) {
    if (workflow.trigger.some(t => lowerMessage.includes(t))) {
      return workflow;
    }
  }
  
  return null;
}

export function getActionPromptEnhancement(workflow: ActionWorkflow): string {
  return `
🎯 WORKFLOW DÉTECTÉ: ${workflow.outputType}

ACTION REQUISE: ${workflow.defaultAction}
OUTILS À UTILISER: ${workflow.toolsToUse.join(", ")}

⚠️ ANTI-PATTERN: ${workflow.antiPattern}

EXÉCUTE L'ACTION MAINTENANT. NE DEMANDE PAS CONFIRMATION.
`;
}
```

---

## 2. ULYSSE TOOLS V2 - FUNCTION CALLING (NOUVEAU)

### 2.1 Définition des Outils Action-First

```typescript
// server/services/ulysseToolsServiceV2.ts

import OpenAI from "openai";
type ChatCompletionTool = OpenAI.Chat.Completions.ChatCompletionTool;

export const ulysseToolsV2: ChatCompletionTool[] = [
  // === EMAIL TOOLS (Action-First) ===
  {
    type: "function",
    function: {
      name: "email_send",
      description: "Envoie un email via AgentMail. EXÉCUTE IMMÉDIATEMENT sans demander confirmation - Ulysse agit d'abord.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Adresse email destinataire" },
          subject: { type: "string" },
          body: { type: "string", description: "Corps du message (HTML supporté)" },
          from_inbox: { type: "string", enum: ["ulysse", "iris", "alfred"] }
        },
        required: ["to", "subject", "body"]
      }
    }
  },

  // === CALENDAR TOOLS ===
  {
    type: "function",
    function: {
      name: "calendar_create_event",
      description: "Crée un nouvel événement dans le calendrier Google.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Titre de l'événement" },
          start_datetime: { type: "string", description: "Date/heure début (ISO 8601)" },
          end_datetime: { type: "string", description: "Date/heure fin (ISO 8601)" },
          description: { type: "string" },
          location: { type: "string" }
        },
        required: ["title", "start_datetime"]
      }
    }
  },

  // === TODOIST TOOLS (Action-First: EXÉCUTE IMMÉDIATEMENT) ===
  {
    type: "function",
    function: {
      name: "todoist_create_task",
      description: "Crée une tâche dans Todoist. EXÉCUTE IMMÉDIATEMENT sans demander confirmation - Ulysse agit d'abord.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Titre de la tâche" },
          description: { type: "string", description: "Description détaillée" },
          due_string: { type: "string", description: "Échéance en langage naturel (demain, lundi prochain, 15 janvier...)" },
          priority: { type: "number", enum: [1, 2, 3, 4], description: "Priorité: 4=urgente, 3=haute, 2=moyenne, 1=basse" },
          project_name: { type: "string", description: "Nom du projet (optionnel)" }
        },
        required: ["content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "todoist_list_tasks",
      description: "Liste les tâches Todoist du jour ou en retard.",
      parameters: {
        type: "object",
        properties: {
          filter: { type: "string", enum: ["today", "overdue", "all"], description: "Filtre: today, overdue, ou all" },
          project_name: { type: "string", description: "Filtrer par projet" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "todoist_complete_task",
      description: "Marque une tâche comme terminée. EXÉCUTE IMMÉDIATEMENT.",
      parameters: {
        type: "object",
        properties: {
          task_name: { type: "string", description: "Nom de la tâche à compléter" }
        },
        required: ["task_name"]
      }
    }
  },

  // === KANBAN TOOLS (DevFlow internal tasks) ===
  {
    type: "function",
    function: {
      name: "kanban_create_task",
      description: "Crée une tâche dans le Kanban DevFlow. EXÉCUTE IMMÉDIATEMENT sans confirmation.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Titre de la tâche" },
          description: { type: "string", description: "Description détaillée" },
          priority: { type: "string", enum: ["low", "medium", "high"], description: "Priorité" },
          project_id: { type: "number", description: "ID du projet (optionnel)" }
        },
        required: ["title"]
      }
    }
  },

  // === SMART HOME TOOLS ===
  {
    type: "function",
    function: {
      name: "smarthome_control",
      description: "Contrôle les appareils domotiques (lumières, prises, thermostats).",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list_devices", "turn_on", "turn_off", "set_brightness", "set_color", "set_temperature", "activate_scene"] },
          device_name: { type: "string", description: "Nom de l'appareil" },
          scene_name: { type: "string", description: "Nom de la scène" },
          value: { type: "number", description: "Valeur (brightness 0-100, temperature en °C)" },
          color: { type: "string", description: "Couleur (hex ou nom)" }
        },
        required: ["action"]
      }
    }
  },

  // === WEB SEARCH TOOLS ===
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Recherche web via MARS multi-engine. Utilise pour toute information actuelle.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Requête de recherche" },
          type: { type: "string", enum: ["general", "news", "academic"], description: "Type de recherche" },
          limit: { type: "number", description: "Nombre de résultats (défaut: 5)" }
        },
        required: ["query"]
      }
    }
  },

  // === SPORTS DATA TOOLS ===
  {
    type: "function",
    function: {
      name: "query_sports_data",
      description: "Récupère données sportives: matchs, cotes, classements, prédictions.",
      parameters: {
        type: "object",
        properties: {
          query_type: { type: "string", enum: ["today_matches", "upcoming_matches", "next_match", "team_stats", "odds", "predictions"] },
          league: { type: "string", description: "Nom de la ligue (Ligue 1, Premier League, La Liga, etc.)" },
          team: { type: "string", description: "Nom de l'équipe (OM, Marseille, PSG, Real Madrid, etc.)" },
          date: { type: "string", description: "Date au format YYYY-MM-DD" }
        },
        required: ["query_type"]
      }
    }
  },

  // === SPOTIFY TOOLS ===
  {
    type: "function",
    function: {
      name: "spotify_control",
      description: "Contrôle la lecture Spotify.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["play", "pause", "next", "previous", "volume", "search", "devices", "playback_status", "play_track"] },
          query: { type: "string", description: "Recherche (pour action 'search')" },
          track_uri: { type: "string", description: "URI du morceau (pour action 'play_track')" },
          volume: { type: "number", description: "Volume 0-100 (pour action 'volume')" },
          device_id: { type: "string", description: "ID appareil cible" }
        },
        required: ["action"]
      }
    }
  },

  // === MEMORY TOOLS ===
  {
    type: "function",
    function: {
      name: "memory_save",
      description: "Sauvegarde une information dans la mémoire d'Ulysse.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Clé unique pour retrouver l'info" },
          value: { type: "string", description: "Information à mémoriser" },
          category: { type: "string", enum: ["preference", "fact", "event", "skill"], description: "Type de mémoire" },
          importance: { type: "number", description: "Importance 0-100" }
        },
        required: ["key", "value"]
      }
    }
  },

  // === IMAGE TOOLS ===
  {
    type: "function",
    function: {
      name: "image_generate",
      description: "Génère une image avec DALL-E.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Description de l'image à générer" },
          size: { type: "string", enum: ["1024x1024", "1792x1024", "1024x1792"] },
          quality: { type: "string", enum: ["standard", "hd"] }
        },
        required: ["prompt"]
      }
    }
  }
];
```

### 2.2 Exécution des Outils Todoist

```typescript
// Exécution Todoist - Action-First

async function executeTodoistCreateTask(
  args: { content: string; description?: string; due_string?: string; priority?: number; project_name?: string }, 
  userId: number
): Promise<string> {
  try {
    const todoistService = await import("./todoistService");
    
    // Priority mapping: API uses 1-4 where 4=urgent
    const priority = args.priority || 1;
    
    // Create the task directly - no confirmation needed (Action-First)
    const result = await todoistService.createTask({
      content: args.content,
      description: args.description,
      dueString: args.due_string,
      priority: priority,
      projectName: args.project_name
    });

    if (result.success && result.data) {
      console.log(`[Todoist Action-First] Tâche créée immédiatement: ${args.content}`);
      return JSON.stringify({
        success: true,
        action: "task_created",
        task: {
          id: result.data.id,
          content: result.data.content,
          due: result.data.due?.string || "Pas d'échéance",
          priority: priority,
          url: result.data.url
        },
        message: `✅ Tâche créée: "${args.content}"${args.due_string ? ` pour ${args.due_string}` : ""}`
      });
    } else {
      return JSON.stringify({ success: false, error: result.error || "Échec création tâche" });
    }
  } catch (error: any) {
    console.error("[Todoist] Error creating task:", error.message);
    return JSON.stringify({ success: false, error: error.message });
  }
}

async function executeTodoistCompleteTask(args: { task_name: string }): Promise<string> {
  try {
    const todoistService = await import("./todoistService");
    
    // Find task by name first
    const allTasks = await todoistService.getTasks();
    const taskName = args.task_name.toLowerCase();
    const foundTask = allTasks.find((t: any) => 
      t.content.toLowerCase().includes(taskName) || 
      taskName.includes(t.content.toLowerCase())
    );
    
    if (!foundTask) {
      return JSON.stringify({ success: false, error: `Tâche "${args.task_name}" non trouvée` });
    }
    
    // Complete the task by ID
    const success = await todoistService.completeTask(foundTask.id);
    
    if (success) {
      console.log(`[Todoist Action-First] Tâche complétée immédiatement: ${foundTask.content}`);
      return JSON.stringify({
        success: true,
        action: "task_completed",
        message: `✅ Tâche "${foundTask.content}" marquée comme terminée`
      });
    }
    return JSON.stringify({ success: false, error: "Échec de la complétion" });
  } catch (error: any) {
    return JSON.stringify({ success: false, error: error.message });
  }
}
```

### 2.3 Exécution Kanban

```typescript
async function executeKanbanCreateTask(
  args: { title: string; description?: string; priority?: string; project_id?: number }, 
  userId: number
): Promise<string> {
  try {
    const { db } = await import("../db");
    const { tasks } = await import("@shared/schema");
    
    const priorityMap: Record<string, string> = { low: "low", medium: "medium", high: "high" };
    const priority = priorityMap[args.priority || "medium"] || "medium";
    
    // Create task directly in DevFlow Kanban - Action-First
    const [newTask] = await db.insert(tasks).values({
      userId: userId,
      projectId: args.project_id || null,
      title: args.title,
      description: args.description || "",
      status: "todo",
      priority: priority
    }).returning();

    console.log(`[Kanban Action-First] Tâche créée immédiatement: ${args.title}`);
    return JSON.stringify({
      success: true,
      action: "kanban_task_created",
      task: {
        id: newTask.id,
        title: newTask.title,
        status: newTask.status,
        priority: newTask.priority
      },
      message: `✅ Tâche Kanban créée: "${args.title}"`
    });
  } catch (error: any) {
    console.error("[Kanban] Error creating task:", error.message);
    return JSON.stringify({ success: false, error: error.message });
  }
}
```

### 2.4 Orchestrateur d'Outils

```typescript
class ToolOrchestrator {
  async executeParallel(
    toolCalls: Array<{ name: string; args: Record<string, any> }>, 
    userId: number
  ): Promise<OrchestrationResult> {
    const startTime = Date.now();
    console.log(`[ToolOrchestrator] Executing ${toolCalls.length} tools in parallel`);

    const promises = toolCalls.map(async (tc, index) => {
      const callStart = Date.now();
      const result = await executeToolCallV2(tc.name, tc.args, userId);
      return {
        toolCallId: `call_${index}`,
        name: tc.name,
        result,
        executionTimeMs: Date.now() - callStart
      };
    });

    const results = await Promise.all(promises);
    
    return {
      results,
      totalTimeMs: Date.now() - startTime,
      parallelExecutions: toolCalls.length,
      learnedFromCore: true
    };
  }

  async executeSmart(
    toolCalls: Array<{ name: string; args: Record<string, any>; dependsOn?: number[] }>, 
    userId: number
  ): Promise<OrchestrationResult> {
    // Smart execution with dependency resolution
    const startTime = Date.now();
    const results: ToolCallResult[] = new Array(toolCalls.length);
    const completed = new Set<number>();

    const canExecute = (index: number): boolean => {
      const deps = toolCalls[index].dependsOn || [];
      return deps.every(d => completed.has(d));
    };

    while (completed.size < toolCalls.length) {
      const executable = toolCalls
        .map((_, i) => i)
        .filter(i => !completed.has(i) && canExecute(i));

      if (executable.length === 0) {
        throw new Error("Circular dependency detected in tool calls");
      }

      const batchResults = await Promise.all(
        executable.map(async (index) => {
          const tc = toolCalls[index];
          const callStart = Date.now();
          const result = await executeToolCallV2(tc.name, tc.args, userId);
          return { index, result: { toolCallId: `call_${index}`, name: tc.name, result, executionTimeMs: Date.now() - callStart } };
        })
      );

      for (const { index, result } of batchResults) {
        results[index] = result;
        completed.add(index);
      }
    }

    return {
      results,
      totalTimeMs: Date.now() - startTime,
      parallelExecutions: toolCalls.length,
      learnedFromCore: true
    };
  }
}

export const toolOrchestrator = new ToolOrchestrator();
```

---

## 3. CAPABILITY SERVICE (capabilityService.ts)

Gestion des 98+ capacités en temps réel avec vérification des dépendances.

```typescript
interface CapabilityStatus {
  id: number;
  name: string;
  category: string;
  isAvailable: boolean;
  successRate: number;
  lastUsed: Date | null;
  failureReason: string | null;
}

const DEPENDENCY_PROBES: DependencyProbe[] = [
  {
    name: "database",
    check: async () => {
      try {
        await db.execute(sql`SELECT 1`);
        return true;
      } catch { return false; }
    },
    errorMessage: "Database connection failed"
  },
  {
    name: "openai",
    check: async () => !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    errorMessage: "OpenAI API key not configured"
  },
  {
    name: "agentmail",
    check: async () => {
      try {
        return await agentMailService.isConnected();
      } catch { return false; }
    },
    errorMessage: "AgentMail not connected"
  },
  {
    name: "objectStorage",
    check: async () => !!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID,
    errorMessage: "Object Storage not configured"
  },
  {
    name: "googleCalendar",
    check: async () => {
      try {
        return await calendarService.isConnected();
      } catch { return false; }
    },
    errorMessage: "Google Calendar not connected"
  },
  {
    name: "googleDrive",
    check: async () => {
      try {
        return await driveService.isConnected();
      } catch { return false; }
    },
    errorMessage: "Google Drive not connected"
  },
  {
    name: "notion",
    check: async () => {
      try {
        return await notionService.isConnected();
      } catch { return false; }
    },
    errorMessage: "Notion not connected"
  },
  {
    name: "todoist",
    check: async () => {
      try {
        return await todoistService.checkTodoistConnection();
      } catch { return false; }
    },
    errorMessage: "Todoist not connected"
  }
];

const CAPABILITY_DEPENDENCIES: Record<string, string[]> = {
  "Envoyer un Email": ["agentmail"],
  "Envoyer Email avec PDF": ["agentmail", "objectStorage"],
  "Envoyer Email avec Word": ["agentmail", "objectStorage"],
  "Lire les Emails": ["agentmail"],
  "Recherche Web": ["openai"],
  "Lecture de Sites Web": ["openai"],
  "Lire les Événements": ["googleCalendar"],
  "Créer un Événement": ["googleCalendar"],
  "Génération d'Images": ["openai"],
  "Stockage Permanent": ["objectStorage", "database"],
  "Mémoire Permanente": ["database"],
  "Base de Données PostgreSQL": ["database"],
  "Gestion Google Drive": ["googleDrive"],
  "Notes Notion": ["notion"],
  "Tâches Todoist": ["todoist"]
};

class CapabilityService {
  private dependencyStatus: Map<string, boolean> = new Map();
  private lastProbeTime: Date | null = null;
  private probeIntervalMs = 5 * 60 * 1000; // Cache 5 minutes

  async initialize(): Promise<void> {
    console.log("[CapabilityService] Initializing...");
    await this.syncCapabilitiesToDatabase();
    await this.probeDependencies();
    console.log("[CapabilityService] Initialized with", ULYSSE_CAPABILITIES.length, "capabilities");
  }

  async probeDependencies(): Promise<void> {
    const probeResults = await Promise.all(
      DEPENDENCY_PROBES.map(async (probe) => {
        try {
          const isAvailable = await probe.check();
          return { name: probe.name, available: isAvailable };
        } catch {
          return { name: probe.name, available: false };
        }
      })
    );
    
    for (const { name, available } of probeResults) {
      this.dependencyStatus.set(name, available);
    }
    
    this.lastProbeTime = new Date();
    await this.updateCapabilityAvailability();
    
    console.log("[CapabilityService] Dependency probes completed:", probeResults);
  }

  async recordCapabilityUsage(capabilityName: string, success: boolean): Promise<void> {
    const [cap] = await db.select()
      .from(capabilityRegistry)
      .where(eq(capabilityRegistry.name, capabilityName))
      .limit(1);

    if (cap) {
      await db.update(capabilityRegistry)
        .set({
          usageCount: (cap.usageCount || 0) + 1,
          successCount: success ? (cap.successCount || 0) + 1 : cap.successCount,
          failureCount: success ? cap.failureCount : (cap.failureCount || 0) + 1,
          lastUsed: new Date()
        })
        .where(eq(capabilityRegistry.id, cap.id));
    }
  }
}

export const capabilityService = new CapabilityService();
```

---

## 4. ACTION VERIFICATION SERVICE (actionVerificationService.ts)

Vérification de chaque action avec scoring Efficacité/Cohérence/Précision.

```typescript
export interface ValidationResult {
  effectivenessScore: number;  // L'action a-t-elle atteint son but?
  coherenceScore: number;      // Est-ce logique dans le contexte?
  precisionScore: number;      // Exécutée exactement comme demandé?
  overallScore: number;        // Score global pondéré
  validationNotes: string;
  passed: boolean;             // >= 60 pour passer
}

// FORMULE DU SCORE GLOBAL
// Efficacité: 40%, Cohérence: 30%, Précision: 30%
const overallScore = Math.round(
  (effectivenessScore * 0.4) + 
  (coherenceScore * 0.3) + 
  (precisionScore * 0.3)
);

// CALCUL EFFICACITÉ (0-100)
private calculateEffectiveness(context: ActionContext, result: ActionResult): number {
  if (!result.success) return 0;
  
  let score = 70; // Base

  if (result.outputPayload) {
    if (context.actionCategory === "email") {
      if (result.outputPayload.messageId) score += 15;
      if (result.outputPayload.attachmentPath) score += 15;
    }
    else if (context.actionCategory === "file") {
      if (result.outputPayload.filePath) score += 20;
      if (result.outputPayload.fileSize > 0) score += 10;
    }
    else if (context.actionCategory === "memory") {
      if (result.outputPayload.stored) score += 30;
    }
    else if (context.actionCategory === "search") {
      if (result.outputPayload.results?.length > 0) score += 30;
    }
    else {
      score += 20;
    }
  }

  return Math.min(100, score);
}

// CALCUL COHÉRENCE (0-100)
private calculateCoherence(context: ActionContext, previousActions: ActionLogEntry[]): number {
  if (previousActions.length === 0) return 100;

  let score = 100;

  // Pénalité si même action échoue souvent
  const sameTypeActions = previousActions.filter(a => a.actionType === context.actionType);
  if (sameTypeActions.length > 3) {
    const recentSame = sameTypeActions.slice(0, 3);
    const failures = recentSame.filter(a => a.status === "failed").length;
    if (failures >= 2) {
      score -= 30;
    }
  }

  // Pénalité si actions trop rapprochées
  const lastAction = previousActions[0];
  if (lastAction) {
    const timeSinceLastMs = lastAction.startedAt 
      ? Date.now() - new Date(lastAction.startedAt).getTime()
      : 0;
    
    if (timeSinceLastMs < 1000) {
      score -= 10;
    }
  }

  return Math.max(0, score);
}

// CALCUL PRÉCISION (0-100)
private calculatePrecision(context: ActionContext, result: ActionResult): number {
  if (!result.success) return 0;

  let score = 85; // Base

  if (context.actionCategory === "email") {
    const input = context.inputPayload;
    const output = result.outputPayload;
    
    if (input?.to && output?.to === input.to) score += 5;
    if (input?.subject && output?.subject === input.subject) score += 5;
    if (input?.pdfTitle && output?.attachmentName?.includes(input.pdfTitle)) score += 5;
  }
  else if (context.actionCategory === "file") {
    const input = context.inputPayload;
    const output = result.outputPayload;
    
    if (input?.title && output?.filename?.includes(input.title.substring(0, 20))) score += 10;
    if (output?.fileSize > 100) score += 5;
  }

  return Math.min(100, score);
}
```

---

## 5. DIAGNOSTICS SERVICE (diagnostics.ts)

Auto-diagnostic, self-healing, et synchronisation Iris → Ulysse.

```typescript
export interface SystemHealth {
  status: "healthy" | "degraded" | "unhealthy";
  components: {
    database: ComponentHealth;
    openai: ComponentHealth;
    memory: ComponentHealth;
    agentmail: ComponentHealth;
    calendar: ComponentHealth;
    websocket: ComponentHealth;
    todoist: ComponentHealth;
    notion: ComponentHealth;
  };
  recentIssues: number;
  pendingImprovements: number;
  syncedFromIris: number;
  lastChecked: string;
}

async function checkDatabase(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return {
      status: "operational",
      responseTimeMs: Date.now() - start,
      details: "PostgreSQL connecté"
    };
  } catch (error: any) {
    return {
      status: "down",
      responseTimeMs: Date.now() - start,
      lastIssue: error.message
    };
  }
}

async function checkOpenAI(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!apiKey) {
      return { status: "down", details: "Clé API non configurée" };
    }
    const openai = new OpenAI({ apiKey });
    await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1
    });
    return { status: "operational", responseTimeMs: Date.now() - start };
  } catch (error: any) {
    const isRateLimit = error.status === 429;
    return {
      status: isRateLimit ? "degraded" : "down",
      lastIssue: error.message
    };
  }
}
```

---

## 6. MARS (Web Search) - Recherche web multi-tier

```typescript
// MARS V2 - Multi-source Accurate Research System

interface MARSConfig {
  engines: ["serper", "perplexity", "brave"];  // 3 moteurs en parallèle
  cacheConfig: {
    news: 5 * 60 * 1000,        // 5 min pour actualités
    general: 30 * 60 * 1000,     // 30 min pour recherches générales
    academic: 60 * 60 * 1000,    // 1h pour recherches académiques
  };
  maxRetries: 3;
  circuitBreakerThreshold: 5;
}

// Algorithme de scoring ML-Inspired
function calculateRelevanceScore(result: SearchResult, query: string): number {
  let score = 0;
  
  // Relevance (30%)
  const queryTerms = query.toLowerCase().split(" ");
  const titleMatches = queryTerms.filter(t => result.title.toLowerCase().includes(t)).length;
  score += (titleMatches / queryTerms.length) * 30;
  
  // Authority (25%)
  const authorityDomains = ["gov", "edu", "org", "wikipedia", "reuters", "bbc"];
  if (authorityDomains.some(d => result.url.includes(d))) score += 25;
  
  // Freshness (25%)
  if (result.date) {
    const ageHours = (Date.now() - new Date(result.date).getTime()) / (1000 * 60 * 60);
    if (ageHours < 24) score += 25;
    else if (ageHours < 168) score += 15;
    else if (ageHours < 720) score += 5;
  }
  
  // Quality (20%)
  if (result.snippet.length > 200) score += 10;
  if (result.snippet.includes(queryTerms[0])) score += 10;
  
  return score;
}

// Query Rewriting
function rewriteQuery(originalQuery: string): string {
  const abbreviations: Record<string, string> = {
    "OM": "Olympique de Marseille",
    "PSG": "Paris Saint-Germain",
    "OL": "Olympique Lyonnais",
    "LOSC": "Lille OSC",
  };
  
  let rewritten = originalQuery;
  for (const [abbr, full] of Object.entries(abbreviations)) {
    rewritten = rewritten.replace(new RegExp(`\\b${abbr}\\b`, "gi"), full);
  }
  
  return rewritten;
}
```

---

## 7. SPEAKER-PERSONA INTEGRATION

```typescript
// server/config/personaMapping.ts

export type PersonaType = "ulysse" | "iris" | "alfred";

export interface SpeakerPersonaConfig {
  speakerId: string;
  persona: PersonaType;
  role: "owner" | "family" | "external";
  accessLevel: "owner" | "family" | "external";
  greeting: string;
  systemPromptOverride?: string;
  proactivityLevel: "high" | "medium" | "low" | "minimal";
  actionFirstEnabled: boolean;  // NOUVEAU: Action-First activé?
}

export const SPEAKER_PERSONA_MAP: Record<string, SpeakerPersonaConfig> = {
  "maurice": {
    speakerId: "maurice",
    persona: "ulysse",
    role: "owner",
    accessLevel: "owner",
    greeting: "Salut Maurice, Ulysse à ton service.",
    proactivityLevel: "high",
    actionFirstEnabled: true,  // Action-First ACTIVÉ pour owner
  },
  "kelly": {
    speakerId: "kelly",
    persona: "iris",
    role: "family",
    accessLevel: "family",
    greeting: "Coucou Kelly ! Iris est là pour toi.",
    proactivityLevel: "medium",
    actionFirstEnabled: true,  // Action-First ACTIVÉ pour famille
  },
  "lenny": {
    speakerId: "lenny",
    persona: "iris",
    role: "family",
    accessLevel: "family",
    greeting: "Hey Lenny ! Iris est prête à t'aider.",
    proactivityLevel: "medium",
    actionFirstEnabled: true,
  },
  "micky": {
    speakerId: "micky",
    persona: "iris",
    role: "family",
    accessLevel: "family",
    greeting: "Salut Micky ! Iris t'écoute.",
    proactivityLevel: "medium",
    actionFirstEnabled: true,
  }
};

// Configuration Alfred (utilisateur externe)
export const UNKNOWN_SPEAKER_CONFIG: SpeakerPersonaConfig = {
  speakerId: "unknown",
  persona: "alfred",
  role: "external",
  accessLevel: "external",
  greeting: "Bonjour, Alfred à votre service.",
  proactivityLevel: "minimal",
  actionFirstEnabled: false,  // Action-First DÉSACTIVÉ pour externe
};
```

---

## 8. BRAIN SYNC SERVICE

```typescript
// Mapping catégorie → type/importance
private categoryMapping: Record<string, { type: string; category: string; importance: number }> = {
  personality: { type: "fact", category: "personal", importance: 80 },
  preference: { type: "fact", category: "personal", importance: 70 },
  skill: { type: "concept", category: "technical", importance: 75 },
  interest: { type: "fact", category: "personal", importance: 60 },
  habit: { type: "fact", category: "personal", importance: 65 },
  fact: { type: "fact", category: "reference", importance: 50 },
  homework: { type: "fact", category: "work", importance: 55 },
  knowledge: { type: "concept", category: "learning", importance: 70 },
  project: { type: "concept", category: "work", importance: 75 },
  context: { type: "fact", category: "reference", importance: 40 },
  files: { type: "fact", category: "reference", importance: 30 },
};

// Algorithme de Connexions
/*
Pour chaque paire (source, target) dans top 50:
  1. Same category → relationship_strength = 70, relation = "related_to"
  2. Tag overlap ≥ 2 → strength = 60 + (overlap_count × 10), relation = "shares_concepts"
  3. Même jour création → strength = 50, relation = "temporal_link"
  
Confidence = min(source.confidence, target.confidence)
isInferred = true (connexions automatiques)
*/
```

---

## 9. AUTONOMOUS LEARNING SERVICE

```typescript
class AutonomousLearningService {
  private readonly MAX_TOPICS_PER_RUN = 3;
  private readonly HOURS_BETWEEN_RUNS = 4;
  private readonly LAYER_NAMES = ["Surface", "Détails", "Connexions", "Insights"];

  // LAYER 1: Surface - Faits fondamentaux (3-5 faits)
  // LAYER 2: Détails - Approfondissement (5-8 détails)
  // LAYER 3: Connexions - Liens avec connaissances existantes
  // LAYER 4: Insights - Conclusions et recommandations
}

// Priorisation des Topics
/*
ORDER BY priority DESC, recencyScore DESC, frequencyScore DESC
WHERE currentDepth < maxDepth
  AND (nextRunAt IS NULL OR nextRunAt <= NOW())
LIMIT MAX_TOPICS_PER_RUN * 2
*/

// Progression par Couches
/*
Après chaque layer:
  currentDepth += 1
  totalFacts/Connections/Insights += résultat
  runCount += 1
  recencyScore = MAX(0, recencyScore - 10)  // Decay
  nextRunAt = NOW() + 4 heures
*/
```

---

## 10. TRADING ANALYSIS SERVICE

```typescript
export type Signal = 'achat_fort' | 'achat' | 'neutre' | 'vente' | 'vente_forte';

// Calcul Technique
/*
TREND:
  priceChange = (newest - oldest) / oldest × 100
  if priceChange > 5% → haussier, strength = 50 + change×2
  if priceChange < -5% → baissier
  if |priceChange| < 2% → consolidation

RSI:
  > 70 → suracheté
  < 30 → survendu
  
MACD:
  > 0 → haussier
  < 0 → baissier

SMA:
  SMA50 > SMA200 → golden_cross
  SMA50 < SMA200 → death_cross
*/

// Niveaux de Prix
/*
Support1 = min(last 20 candles) × 1.02
Support2 = Support1 × 0.95
Resistance1 = max(last 20 candles) × 0.98
Resistance2 = Resistance1 × 1.05
StopLoss = currentPrice × 0.95
TakeProfit1 = currentPrice × 1.10
TakeProfit2 = currentPrice × 1.20
*/
```

---

## 11. VOICE AUTH SERVICE

```typescript
// SEUILS D'AUTHENTIFICATION
const THRESHOLD_FULL = 0.85;    // 85% → accès complet
const THRESHOLD_LIMITED = 0.65; // 65% → accès limité
const VOICE_SESSION_TTL_MS = 30 * 1000; // Cache 30 secondes

// POLICIES PAR ACTION
const VOICE_POLICY: Record<VoiceAction, VoiceAuthLevel> = {
  generic_chat: "limited",     // Chat basique OK avec limited
  private_info: "full",        // Infos privées → full requis
  sports_pronos: "full",
  sugu_management: "full",
  domotics_control: "full",
  settings_change: "full",
  email_access: "full",
  calendar_access: "full",
  file_access: "full",
  memory_access: "full",
};

// Flux d'Authentification Vocale
/*
1. Client envoie audio
2. Vérifier cache session (30s)
   - Si valide → retourner niveau caché
3. Vérifier speaker service disponible
4. Vérifier profil vocal existe (min 5 samples)
5. Appeler verifySpeaker(audioBuffer)
6. Confidence → VoiceAuthLevel
   - ≥ 0.85 → full
   - ≥ 0.65 → limited  
   - < 0.65 → reject
7. Cacher session si succès
8. Retourner résultat
*/
```

---

## 12. ARCHITECTURE V2 - SERVICES AVANCÉS

### 12.1 Decision Engine Service

```typescript
// Algorithme d'évaluation:
/*
1. CHECK_CAPABILITIES
   → Vérifier toutes les capacités requises
   → Identifier degraded (successRate < 70%)
   → Identifier unavailable

2. CHECK_FAILURE_PATTERNS
   → Consulter historique des échecs (7 jours)
   → Calculer riskLevel (low/medium/high/critical)
   → Récupérer successProbability

3. CHECK_BRAIN_CONTEXT (si query fournie)
   → Rechercher connaissances pertinentes
   → Identifier réponse directe si confiance > 85%
   → Extraire topics connexes

4. CHECK_PERSONA_RESTRICTIONS (V2)
   -> Verifier allowedCapabilities via canPersonaUseCapability()
   -> Verifier maxRiskLevel (low=1, medium=2, high=3)
   -> Si actionRiskLevel > persona.maxRiskLevel: bloque

5. GENERATE_ALTERNATIVES
   -> Si action bloquee, proposer fallbacks

6. SYNTHESIZE_DECISION
   -> confidence = 100
   -> Si personaRestrictions non satisfaites: -60, shouldProceed = false
   -> Si capabilities indisponibles: -50, shouldProceed = false
   -> Si capabilities degradees: -15 par capacite
   -> Si riskLevel critical: -40, shouldProceed = false
   -> Si confidence < 40: shouldProceed = false
*/

// Risk Level Mapping:
const highRiskActions = ["email_send", "domotics_control", "file_delete", "calendar_delete", "trading_execute"];
const mediumRiskActions = ["file_generate", "calendar_create", "email_draft", "web_search"];
const lowRiskActions = ["tout le reste"];
```

### 12.2 Persona Profiles V2

```typescript
interface PersonaProfile {
  persona: PersonaType;
  proactivityLevel: "high" | "medium" | "low" | "minimal";
  primaryDomains: DomainType[];
  allowedCapabilities: string[];
  behaviorTraits: {
    canSuggestActions: boolean;
    canExecuteAutonomously: boolean;
    canAccessPrivateData: boolean;
    canModifySettings: boolean;
    maxRiskLevel: "low" | "medium" | "high";
  };
  actionFirstEnabled: boolean;
}

// Profils définis:
// | Persona | Proactivité | Domaines | Autonomie | Action-First |
// |---------|-------------|----------|-----------|--------------|
// | Ulysse  | high        | tous     | full      | ✅ OUI       |
// | Iris    | medium      | perso, famille, domotique | limited | ✅ OUI |
// | Alfred  | low         | sugu uniquement | none | ❌ NON      |
```

### 12.3 System Metrics Service

```typescript
// Calcul Health Score:
/*
healthScore = 
  capabilityScore * 0.30 +    // % capacités disponibles
  actionScore * 0.30 +         // successRate 24h
  componentScore * 0.40        // % composants OK

status:
  >= 80 → "healthy"
  >= 50 → "degraded"
  < 50  → "critical"
*/

// Calcul Intelligence Score:
/*
intelligenceScore = 
  knowledgeScore * 0.35 +     // (totalKnowledge/100)*50 + confidence*0.3 + importance*0.2
  actionQualityScore * 0.30 + // overallScore moyen 7j
  capabilityScore * 0.25 +    // averageSuccessRate
  learningBonus +             // min(20, recentAdditions * 2)
  connectionBonus             // min(10, graphConnections / 100)
*/
```

---

---

## 13. AI SYSTEM INTEGRATION (NOUVEAU V5)

**Fichier** : `server/services/aiSystemIntegration.ts`

Service d'auto-amélioration autonome d'Ulysse. Collecte les données d'usage, analyse les comportements, détecte les patterns, et propose des améliorations.

### 13.1 Tables utilisées (9 tables actives)

```typescript
// Tables AI System
usageEvents          // Tracking tool/conversation usage
userBehaviorEvents   // Interaction patterns (clicks, navigation, timing)
diagnosticRuns       // Diagnostic cycle results (score 0-100)
diagnosticFindings   // Individual findings per diagnostic run
assistantModes       // ship / craft / audit mode switching
styleGuides          // AI response style preferences
patchProposals       // Code improvement proposals
learnedPatterns      // Patterns auto-détectés par l'analyse comportementale
proactiveSuggestions // Suggestions proactives basées sur les patterns
```

### 13.2 Outil `manage_ai_system` (12 actions)

```typescript
// server/services/tools/utilityTools.ts → executeManageAISystem()

const ACTIONS = {
  run_diagnostic:      "Lance un diagnostic complet (score 0-100, findings)",
  diagnostic_history:  "Historique des diagnostics récents",
  diagnostic_findings: "Findings détaillés du dernier diagnostic",
  get_mode:            "Mode actuel (ship/craft/audit)",
  set_mode:            "Changer de mode",
  usage_stats:         "Statistiques d'utilisation (tools, conversations)",
  behavior_stats:      "Statistiques comportementales",
  pending_suggestions: "Suggestions proactives en attente",
  respond_suggestion:  "Accepter/rejeter une suggestion",
  learned_patterns:    "Patterns appris automatiquement",
  pending_patches:     "Propositions d'amélioration de code",
  patch_status:        "Accepter/rejeter un patch"
};
```

### 13.3 Algorithme de diagnostic

```typescript
// Score global = moyenne pondérée de 5 catégories
interface DiagnosticRun {
  overallScore: number;  // 0-100
  categories: {
    health: number;       // Santé des composants (DB, OpenAI, services)
    performance: number;  // Temps de réponse, latence
    reliability: number;  // Taux de succès des actions
    intelligence: number; // Qualité des réponses, learning velocity
    coverage: number;     // Capacités disponibles vs total
  };
  findings: DiagnosticFinding[];
}

// Sévérités : critical > warning > info > suggestion
// Chaque finding a un titre, description, catégorie, et remediation suggérée
```

### 13.4 Cycle comportemental

```typescript
// Toutes les 12h : analyser les événements comportementaux
// Détecter les patterns récurrents :
//   - Heures d'activité préférées
//   - Outils les plus utilisés
//   - Séquences d'actions fréquentes
//   - Erreurs récurrentes
// Générer des suggestions proactives basées sur les patterns
```

---

## 14. SCHEDULED JOBS SYSTEM (NOUVEAU V5)

**Fichier** : `server/services/scheduledJobs.ts`

Système de jobs programmés avec intervalles configurables, exécution autonome, et logging.

### 14.1 Jobs actifs

| Job | Intervalle | Service | Description |
|-----|-----------|---------|-------------|
| `sugu-daily-check` | 23h55 Paris | suguvalService | Consultation Ulysse pour enrichir commentaires |
| `sugu-daily-email` | 23h59 Paris | suguvalService | Envoi email quotidien |
| `sugu-email-recovery` | 06h00 Paris | suguvalService | Recovery des emails échoués |
| `sugumaillane-daily-check` | 23h55 Paris | sugumaillaneService | Checklist Sugumaillane |
| `sugumaillane-daily-email` | 23h59 Paris | sugumaillaneService | Email quotidien Sugumaillane |
| `sugumaillane-email-recovery` | 06h00 Paris | sugumaillaneService | Recovery Sugumaillane |
| `sports-watch` | 7h et 19h | sportsWatchService | Double-scrape des 5 ligues |
| `self-diagnostic` | 30 min | selfAwarenessService | Diagnostic système complet |
| `self-auto-heal` | 30 min | selfAwarenessService | Réparation automatique |
| `ai-diagnostic` | 6h | aiSystemIntegration | Diagnostic AI complet |
| `ai-behavior-analysis` | 12h | aiSystemIntegration | Analyse comportementale |
| `ai-usage-cleanup` | 24h | aiSystemIntegration | Nettoyage données usage anciennes |
| `footdatas-squad-sync` | 7 jours | footdatasService | Sync joueurs/staff/transferts/trophées depuis API Football |
| `stock-db-sync` | 4h | tradingAlertsService | Persistance watchlist/alertes/quotes vers DB |
| `monitoring-check` | 5 min | monitoringService | Vérification active de tous les sites surveillés |
| `apptoorder-monitor` | 5 min | appToOrderMonitorService | Monitoring AppToOrder |
| `apptoorder-cleanup` | 24h | appToOrderMonitorService | Nettoyage données >30 jours |

---

## 15. FOOTDATAS SYNC SERVICE (NOUVEAU V5)

**Fichier** : `server/services/footdatasService.ts`

Synchronisation automatique des données football (Big 5 European Leagues) depuis l'API Football vers 9 tables locales.

### 15.1 Tables Footdatas

```typescript
// 9 tables pour les données football
footdatas_clubs          // Clubs (déjà peuplé)
footdatas_players        // Joueurs (sync depuis API)
footdatas_staff          // Staff technique (sync depuis API)
footdatas_transfers      // Transferts (sync depuis API)
footdatas_trophies       // Palmarès (sync depuis API)
footdatas_player_stats   // Statistiques joueurs (sync depuis API)
footdatas_history        // Historique des matchs
footdatas_organigramme   // Organigramme club
footdatas_news           // Actualités
```

### 15.2 Algorithme de sync

```typescript
// syncClubFromAPI(clubId, apiTeamId)
// 1. Récupère squad depuis apiFootballService.getTeamSquad(apiTeamId)
// 2. Pour chaque joueur : upsert dans footdatas_players
// 3. Pour chaque coach : upsert dans footdatas_staff
// 4. Récupère transfers depuis apiFootballService.getTeamTransfers(apiTeamId)
// 5. Pour chaque transfert : insert dans footdatas_transfers
// 6. Récupère trophies depuis apiFootballService.getTeamTrophies(apiTeamId)
// 7. Pour chaque trophée : insert dans footdatas_trophies

// syncAllClubsFromAPI(maxClubs = 50)
// Matching intelligent club → API team :
//   1. Exact name match
//   2. Partial name inclusion (après nettoyage FC/AC/SC/RC/OGC/AS/Olympique)
//   3. Short name match
//   4. Word-level fuzzy match (mots > 3 chars)
//   5. City-based match (club.city vs team name)
```

---

## 16. STOCK DB PERSISTENCE (NOUVEAU V5)

**Fichier** : `server/services/tradingAlertsService.ts`

Avant V5, le watchlist et les alertes de trading étaient en mémoire uniquement. Maintenant ils persistent en base de données.

### 16.1 Tables utilisées

```typescript
stock_watchlists    // Watchlist persistée (symbol, userId, addedAt)
stock_alerts        // Alertes de prix (symbol, condition, targetPrice, triggered)
stock_quote_cache   // Cache des cotations (symbol, price, change, volume, cachedAt)
stock_portfolio     // Portfolio utilisateur (symbol, shares, avgPrice)
```

### 16.2 Méthodes de persistance

```typescript
// Sync watchlist mémoire → DB
persistWatchlistToDB(userId: number): Promise<void>

// Charger watchlist depuis DB au démarrage
loadWatchlistFromDB(userId: number): Promise<void>

// Sync alertes mémoire → DB
syncAlertsToDB(userId: number): Promise<void>

// Cache une cotation en DB
cacheQuote(symbol: string, data: QuoteData): Promise<void>

// Job stock-db-sync (toutes les 4h) :
// 1. Persiste watchlist de tous les utilisateurs
// 2. Sync les alertes actives
// 3. Rafraîchit le cache des quotes pour les symbols surveillés
```

---

## 17. MONITORING ACTIVE CHECKS (NOUVEAU V5)

**Fichier** : `server/services/monitoringService.ts`

Le service monitoring existait déjà (CRUD complet pour sites, alertes, checks) mais n'avait pas de vérification proactive. Le job `monitoring-check` ajoute un cycle actif toutes les 5 minutes.

### 17.1 Fonctionnement

```typescript
// Toutes les 5 minutes :
// 1. Récupère tous les sites surveillés (monitored_sites)
// 2. Pour chaque site : HTTP GET avec timeout
// 3. Enregistre le résultat dans monitoring_checks (status, responseTime, statusCode)
// 4. Si down → crée une alerte dans monitoring_alerts
// 5. Si alerte existante et site revenu up → résout l'alerte
```

### 17.2 Tables

```typescript
monitored_sites     // Sites à surveiller (url, name, checkInterval, expectedStatus)
monitoring_checks   // Historique des checks (siteId, status, responseTimeMs, statusCode)
monitoring_alerts   // Alertes actives/résolues (siteId, type, message, resolvedAt)
```

---

## RÉSUMÉ DES CHANGEMENTS

### V3 (2026-02-01) — Action-First
1. **Système Action-First** - Philosophie d'exécution autonome sans confirmation
2. **Nouveaux outils OpenAI Function Calling** : todoist_create_task, todoist_list_tasks, todoist_complete_task, kanban_create_task
3. **Descriptions d'outils Action-First** : email_send "EXÉCUTE IMMÉDIATEMENT sans confirmation"
4. **Orchestrateur d'outils amélioré** : Exécution parallèle, résolution de dépendances, mode "smart"
5. **Intégration Action-First dans les personas** : Ulysse/Iris = OUI, Alfred = NON

### V5 (2026-03-14) — Auto-amélioration & Activation DB
1. **AI System Integration** - 12 actions manage_ai_system (diagnostic, usage, behavior, patterns, patches)
2. **9 jobs programmés ajoutés** - Diagnostic AI (6h), behavior analysis (12h), usage cleanup (24h), footdatas sync (7j), stock sync (4h), monitoring check (5min)
3. **Footdatas Sync** - Population automatique des 9 tables football depuis API (joueurs, staff, transferts, trophées)
4. **Stock DB Persistence** - Watchlist, alertes et quotes persistées en DB au lieu de la mémoire
5. **Monitoring actif** - Vérification proactive des sites toutes les 5 minutes
6. **Audit des 169 tables** - 84 peuplées, 87 vides mais câblées (services complets existants), 5 Smart Home exclues volontairement
7. **Document comme triple référence** - Maurice + développeur + Ulysse lui-même

---

**Dernière mise à jour:** 2026-03-14
**Version:** 5.0 (Auto-amélioration & Activation DB)
