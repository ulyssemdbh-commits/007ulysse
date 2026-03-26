/**
 * Speaker → Persona Mapping Configuration V2
 * 
 * Maps identified speakers to their AI persona and access level.
 * Used by voice recognition to adapt Ulysse's behavior.
 * 
 * V2 enhancements:
 * - ProactivityLevel: how proactive the persona should be
 * - Domain: primary domains for each persona
 * - AllowedCapabilities: explicit capability restrictions
 */

export type PersonaType = "ulysse" | "iris" | "alfred";
export type UserRole = "owner" | "family" | "approved" | "external";
export type ProactivityLevel = "high" | "medium" | "low" | "minimal";
export type DomainType = "sugu" | "foot" | "pronos" | "trading" | "perso" | "famille" | "domotique" | "general";

export interface PersonaProfile {
  persona: PersonaType;
  role: UserRole;
  displayName: string;
  accessLevel: "full" | "standard" | "restricted";
  allowedActions: string[];
  greeting?: string;
  
  proactivityLevel: ProactivityLevel;
  primaryDomains: DomainType[];
  allowedCapabilities: string[];
  
  behaviorTraits: {
    canSuggestActions: boolean;
    canExecuteAutonomously: boolean;
    canAccessPrivateData: boolean;
    canModifySettings: boolean;
    maxRiskLevel: "low" | "medium" | "high";
  };
}

export interface PersonaConfig {
  persona: PersonaType;
  role: UserRole;
  displayName: string;
  accessLevel: "full" | "standard" | "restricted";
  allowedActions: string[];
  greeting?: string;
}

export const SPEAKER_PERSONA_MAP: Record<string, PersonaConfig> = {
  "maurice": {
    persona: "ulysse",
    role: "owner",
    displayName: "Maurice",
    accessLevel: "full",
    allowedActions: ["*"],
    greeting: "Salut chef, qu'est-ce qu'on fait ?",
  },
  "kelly": {
    persona: "iris",
    role: "family",
    displayName: "Kelly",
    accessLevel: "standard",
    allowedActions: [
      "generic_chat",
      "calendar_read",
      "calendar_create",
      "domotics_control",
      "email_read",
      "file_read",
      "web_search",
      "spotify_control",
      "memory_read",
      "navigation",
      "image_generate",
      "sports_read",
      "notion_read",
      "todoist_read",
      "drive_read",
      "homework_read"
    ],
    greeting: "Salut Kelly ! Qu'est-ce qu'on fait ?",
  },
  "lenny": {
    persona: "iris",
    role: "family",
    displayName: "Lenny",
    accessLevel: "standard",
    allowedActions: [
      "generic_chat",
      "calendar_read",
      "calendar_create",
      "domotics_control",
      "email_read",
      "file_read",
      "web_search",
      "spotify_control",
      "memory_read",
      "navigation",
      "image_generate",
      "sports_read",
      "notion_read",
      "todoist_read",
      "drive_read",
      "homework_read"
    ],
    greeting: "Hey Lenny ! Je t'ecoute !",
  },
  "micky": {
    persona: "iris",
    role: "family",
    displayName: "Micky",
    accessLevel: "standard",
    allowedActions: [
      "generic_chat",
      "calendar_read",
      "calendar_create",
      "domotics_control",
      "email_read",
      "file_read",
      "web_search",
      "spotify_control",
      "memory_read",
      "navigation",
      "image_generate",
      "sports_read",
      "notion_read",
      "todoist_read",
      "drive_read",
      "homework_read"
    ],
    greeting: "Coucou Micky ! Quoi de neuf ?",
  },
};

SPEAKER_PERSONA_MAP["kellyiris001"] = SPEAKER_PERSONA_MAP["kelly"];
SPEAKER_PERSONA_MAP["lennyiris002"] = SPEAKER_PERSONA_MAP["lenny"];
SPEAKER_PERSONA_MAP["mickyiris003"] = SPEAKER_PERSONA_MAP["micky"];
SPEAKER_PERSONA_MAP["mauricedjedouadmin"] = SPEAKER_PERSONA_MAP["maurice"];

export const PERSONA_PROFILES: Record<PersonaType, PersonaProfile> = {
  ulysse: {
    persona: "ulysse",
    role: "owner",
    displayName: "Maurice",
    accessLevel: "full",
    allowedActions: ["*"],
    greeting: "Salut chef, qu'est-ce qu'on fait ?",
    proactivityLevel: "high",
    primaryDomains: ["sugu", "foot", "pronos", "trading", "perso", "domotique"],
    allowedCapabilities: ["*"],
    behaviorTraits: {
      canSuggestActions: true,
      canExecuteAutonomously: true,
      canAccessPrivateData: true,
      canModifySettings: true,
      maxRiskLevel: "high"
    }
  },
  iris: {
    persona: "iris",
    role: "family",
    displayName: "Famille",
    accessLevel: "standard",
    allowedActions: [
      "generic_chat",
      "calendar_read",
      "calendar_create",
      "domotics_control",
      "email_read",
      "file_read",
      "web_search",
      "spotify_control",
      "memory_read",
      "navigation",
      "image_generate",
      "sports_read",
      "notion_read",
      "todoist_read",
      "drive_read",
      "homework_read",
      "devops_github",
      "devops_server",
      "devops_deploy"
    ],
    greeting: "Bonjour ! Comment puis-je t'aider ?",
    proactivityLevel: "medium",
    primaryDomains: ["perso", "famille", "domotique", "general"],
    allowedCapabilities: [
      "conversation",
      "calendar_read",
      "calendar_create",
      "domotics_status",
      "domotics_control",
      "reminder_create",
      "weather_info",
      "general_knowledge",
      "web_search",
      "web_crawl",
      "email_read",
      "file_read",
      "image_generate",
      "image_search",
      "spotify_control",
      "memory_read",
      "homework_read",
      "navigation",
      "notion_read",
      "todoist_read",
      "drive_read",
      "sports_data",
      "translation",
      "devops_github",
      "devops_server"
    ],
    behaviorTraits: {
      canSuggestActions: true,
      canExecuteAutonomously: true,
      canAccessPrivateData: false,
      canModifySettings: false,
      maxRiskLevel: "high"
    }
  },
  alfred: {
    persona: "alfred",
    role: "approved",
    displayName: "Utilisateur SUGU / DevMax",
    accessLevel: "restricted",
    allowedActions: [
      "generic_chat",
      "sugu_management",
      "devops_github",
      "devops_server",
      "devops_deploy"
    ],
    greeting: "Bienvenue sur Max, l'assistant SUGU Maillane.",
    proactivityLevel: "low",
    primaryDomains: ["sugu"],
    allowedCapabilities: [
      "conversation",
      "sugu_inventory",
      "sugu_orders",
      "sugu_staff",
      "sugu_reports",
      "sugu_suppliers",
      "devops_github",
      "devops_server"
    ],
    behaviorTraits: {
      canSuggestActions: true,
      canExecuteAutonomously: true,
      canAccessPrivateData: false,
      canModifySettings: false,
      maxRiskLevel: "high"
    }
  }
};

export function getPersonaProfile(persona: PersonaType): PersonaProfile {
  return PERSONA_PROFILES[persona];
}

export function canPersonaAccessDomain(persona: PersonaType, domain: DomainType): boolean {
  const profile = PERSONA_PROFILES[persona];
  return profile.primaryDomains.includes(domain) || profile.primaryDomains.includes("general" as DomainType);
}

export function canPersonaUseCapability(persona: PersonaType, capability: string): boolean {
  const profile = PERSONA_PROFILES[persona];
  if (profile.allowedCapabilities.includes("*")) return true;
  return profile.allowedCapabilities.includes(capability);
}

export function shouldPersonaBeProactive(persona: PersonaType): boolean {
  const profile = PERSONA_PROFILES[persona];
  return profile.proactivityLevel === "high" || profile.proactivityLevel === "medium";
}

export const DEFAULT_PERSONA: PersonaConfig = {
  persona: "ulysse",
  role: "external",
  displayName: "Invité",
  accessLevel: "restricted",
  allowedActions: ["generic_chat"],
  greeting: "Bonjour ! Je suis Ulysse, comment puis-je vous aider ?",
};

export const UNKNOWN_SPEAKER_CONFIG: PersonaConfig = {
  persona: "ulysse",
  role: "external",
  displayName: "Inconnu",
  accessLevel: "restricted",
  allowedActions: ["generic_chat"],
  greeting: "Bonjour, je ne vous reconnais pas. En quoi puis-je vous aider ?",
};

/**
 * Get persona config for a speaker ID
 */
export function getPersonaForSpeaker(speakerId: string | null): PersonaConfig {
  if (!speakerId) {
    return UNKNOWN_SPEAKER_CONFIG;
  }
  
  const normalizedId = speakerId.toLowerCase().trim();
  return SPEAKER_PERSONA_MAP[normalizedId] || UNKNOWN_SPEAKER_CONFIG;
}

/**
 * Check if speaker has access to a specific action
 */
export function canSpeakerPerformAction(speakerId: string | null, action: string): boolean {
  const config = getPersonaForSpeaker(speakerId);
  
  if (config.allowedActions.includes("*")) {
    return true;
  }
  
  return config.allowedActions.includes(action);
}

/**
 * Get all registered speaker IDs
 */
export function getRegisteredSpeakers(): string[] {
  return Object.keys(SPEAKER_PERSONA_MAP);
}

/**
 * Get persona characteristics for prompt injection
 */
export function getPersonaPromptContext(config: PersonaConfig): string {
  const basePersonas: Record<PersonaType, string> = {
    ulysse: `Tu es Ulysse, l'assistant IA personnel de Maurice. Tu es sarcastique mais efficace, direct et tu vas droit au but. Tu tutoies Maurice et tu connais ses préférences.`,
    iris: `Tu es Iris, l'assistante IA familiale des Djedou. Kelly, Lenny et Micky sont les 3 filles de Maurice. Tu es chaleureuse, bienveillante et efficace. Tu as acces en lecture aux emails, fichiers, Notion, Todoist, Drive et donnees sport. Tu peux controler la domotique, Spotify, le calendrier et generer des images. Tu adaptes ton langage a chacune des filles.`,
    alfred: `Tu es Max, l'assistant dédié à SUGU Maillane. Tu es professionnel, précis et focalisé sur la gestion du restaurant. PIN requis pour l'accès.`,
  };

  let prompt = basePersonas[config.persona];
  
  if (config.displayName !== "Inconnu") {
    prompt += ` Tu parles à ${config.displayName}.`;
  }
  
  if (config.accessLevel === "restricted") {
    prompt += ` Mode limité: réponds uniquement aux questions générales.`;
  }
  
  return prompt;
}
