export interface DialogueStyle {
  maxTokens: number;
  maxSpokenChars: number;
  tone: "casual" | "structured" | "minimal" | "data-rich" | "warm";
  verbosity: "ultra-short" | "short" | "medium" | "detailed";
  fillerEnabled: boolean;
  fillerText?: string;
  systemHint: string;
}

interface HearingContext {
  domain?: string;
  intent?: { name?: string; category?: string } | null;
  sentiment?: string;
}

const DOMAIN_STYLES: Record<string, Partial<DialogueStyle>> = {
  dev: {
    tone: "structured",
    verbosity: "medium",
    maxTokens: 500,
    maxSpokenChars: 1500,
    systemHint: "Réponds de façon structurée, step-by-step si nécessaire. Sois précis et technique.",
  },
  personal: {
    tone: "casual",
    verbosity: "short",
    maxTokens: 300,
    maxSpokenChars: 800,
    systemHint: "Réponds simplement, comme un ami. Court et naturel.",
  },
  sugu: {
    tone: "minimal",
    verbosity: "ultra-short",
    maxTokens: 250,
    maxSpokenChars: 600,
    fillerEnabled: true,
    fillerText: "Je regarde ça...",
    systemHint: "Réponse ultra-courte, orientée action. Chiffres et faits, pas de blabla.",
  },
  sports: {
    tone: "data-rich",
    verbosity: "short",
    maxTokens: 350,
    maxSpokenChars: 1000,
    systemHint: "Donne les données clés : scores, cotes, stats. Concis mais complet sur les chiffres.",
  },
  betting: {
    tone: "data-rich",
    verbosity: "short",
    maxTokens: 350,
    maxSpokenChars: 1000,
    systemHint: "Focus sur les cotes, value bets, et résultats. Chiffres précis, pas de bavardage.",
  },
  finance: {
    tone: "structured",
    verbosity: "short",
    maxTokens: 300,
    maxSpokenChars: 800,
    systemHint: "Montants précis, résumé clair. Pas de disclaimers inutiles.",
  },
  music: {
    tone: "casual",
    verbosity: "ultra-short",
    maxTokens: 200,
    maxSpokenChars: 400,
    systemHint: "Court et fun. Action immédiate.",
  },
  home: {
    tone: "minimal",
    verbosity: "ultra-short",
    maxTokens: 150,
    maxSpokenChars: 300,
    systemHint: "Confirme l'action en 1 phrase max.",
  },
  system: {
    tone: "minimal",
    verbosity: "ultra-short",
    maxTokens: 100,
    maxSpokenChars: 200,
    systemHint: "Confirmation ultra-brève.",
  },
};

const INTENT_OVERRIDES: Record<string, Partial<DialogueStyle>> = {
  "action.execute": {
    tone: "minimal",
    verbosity: "ultra-short",
    maxTokens: 150,
    maxSpokenChars: 300,
    systemHint: "Exécute et confirme en 1-2 phrases. Pas d'explication.",
  },
  "action.create": {
    tone: "minimal",
    verbosity: "ultra-short",
    maxTokens: 200,
    maxSpokenChars: 400,
    systemHint: "Confirme la création en 1-2 phrases.",
  },
  "query.status": {
    tone: "data-rich",
    verbosity: "short",
    maxTokens: 300,
    maxSpokenChars: 800,
    systemHint: "Donne le statut avec les chiffres clés. Concis.",
  },
  "query.search": {
    tone: "structured",
    verbosity: "medium",
    maxTokens: 400,
    maxSpokenChars: 1200,
    systemHint: "Résultats structurés avec les éléments importants.",
  },
  "greeting": {
    tone: "warm",
    verbosity: "ultra-short",
    maxTokens: 100,
    maxSpokenChars: 200,
    systemHint: "Salutation courte et chaleureuse.",
  },
};

const DEFAULT_STYLE: DialogueStyle = {
  maxTokens: 400,
  maxSpokenChars: 1200,
  tone: "casual",
  verbosity: "short",
  fillerEnabled: false,
  systemHint: "Réponses courtes et naturelles, orientées action.",
};

export function resolveDialogueStyle(ctx: HearingContext): DialogueStyle {
  const style = { ...DEFAULT_STYLE };

  const domainKey = ctx.domain?.toLowerCase();
  if (domainKey && DOMAIN_STYLES[domainKey]) {
    Object.assign(style, DOMAIN_STYLES[domainKey]);
  }

  const intentName = ctx.intent?.name;
  if (intentName) {
    for (const [pattern, overrides] of Object.entries(INTENT_OVERRIDES)) {
      if (intentName.startsWith(pattern) || intentName === pattern) {
        Object.assign(style, overrides);
        break;
      }
    }
  }

  const intentCategory = ctx.intent?.category;
  if (intentCategory === "action") {
    style.verbosity = "ultra-short";
    style.maxTokens = Math.min(style.maxTokens, 200);
  }

  return style;
}

export function buildDialogueSystemHint(style: DialogueStyle): string {
  const hints: string[] = [];
  hints.push(style.systemHint);

  switch (style.verbosity) {
    case "ultra-short":
      hints.push("MAX 1-2 phrases.");
      break;
    case "short":
      hints.push("MAX 3-4 phrases.");
      break;
    case "medium":
      hints.push("5-8 phrases max si nécessaire.");
      break;
    case "detailed":
      hints.push("Développe si le sujet le demande.");
      break;
  }

  return `[STYLE VOCAL] ${hints.join(" ")}`;
}
