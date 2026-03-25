/**
 * Feature Flags Service - Configuration dynamique sans redéploiement
 * Permet d'activer/désactiver des fonctionnalités en temps réel
 */

interface FeatureFlag {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  category: "sugu" | "ulysse" | "system" | "experimental";
  updatedAt: number;
  config?: Record<string, unknown>;
}

const defaultFlags: Record<string, FeatureFlag> = {
  // SUGU Restaurant features
  "sugu.suguval.enabled": {
    id: "sugu.suguval.enabled",
    name: "Suguval Module",
    description: "Active le module Suguval pour les courses",
    enabled: true,
    category: "sugu",
    updatedAt: Date.now()
  },
  "sugu.sugumaillane.enabled": {
    id: "sugu.sugumaillane.enabled",
    name: "Sugumaillane Module",
    description: "Active le module Sugumaillane pour les courses",
    enabled: true,
    category: "sugu",
    updatedAt: Date.now()
  },
  "sugu.auto_email_23h59.enabled": {
    id: "sugu.auto_email_23h59.enabled",
    name: "Email automatique 23h59",
    description: "Envoie automatiquement les listes de courses à 23h59",
    enabled: true,
    category: "sugu",
    updatedAt: Date.now()
  },
  "sugu.weekend_extended.enabled": {
    id: "sugu.weekend_extended.enabled",
    name: "Weekend étendu",
    description: "Liste vendredi ouverte jusqu'à dimanche 23h59 (email dimanche pour lundi)",
    enabled: true,
    category: "sugu",
    updatedAt: Date.now()
  },

  // Ulysse AI features
  "ulysse.ocr.enabled": {
    id: "ulysse.ocr.enabled",
    name: "OCR Documents",
    description: "Permet à Ulysse d'analyser les images/documents",
    enabled: true,
    category: "ulysse",
    updatedAt: Date.now()
  },
  "ulysse.rag.enabled": {
    id: "ulysse.rag.enabled",
    name: "RAG Documents",
    description: "Recherche vectorielle dans les documents",
    enabled: true,
    category: "ulysse",
    updatedAt: Date.now()
  },
  "ulysse.voice.enabled": {
    id: "ulysse.voice.enabled",
    name: "Voice Mode",
    description: "Active le mode vocal pour Ulysse",
    enabled: true,
    category: "ulysse",
    updatedAt: Date.now()
  },
  "ulysse.hub_brief.enabled": {
    id: "ulysse.hub_brief.enabled",
    name: "Hub Brief",
    description: "Brief matinal agrégé (Todoist, Calendar, SUGU)",
    enabled: true,
    category: "ulysse",
    updatedAt: Date.now()
  },
  "ulysse.autonomous_learning.enabled": {
    id: "ulysse.autonomous_learning.enabled",
    name: "Apprentissage autonome",
    description: "Système Russian Dolls d'apprentissage en 4 couches",
    enabled: true,
    category: "ulysse",
    updatedAt: Date.now()
  },
  "ulysse.mars.enabled": {
    id: "ulysse.mars.enabled",
    name: "MARS Research",
    description: "Multi-source Accurate Research System",
    enabled: true,
    category: "ulysse",
    updatedAt: Date.now()
  },

  // System features
  "system.monitoring.enabled": {
    id: "system.monitoring.enabled",
    name: "Monitoring avancé",
    description: "Métriques et alertes système",
    enabled: true,
    category: "system",
    updatedAt: Date.now()
  },
  "system.job_scheduler.enhanced": {
    id: "system.job_scheduler.enhanced",
    name: "Scheduler amélioré",
    description: "Job scheduler avec retry et métriques",
    enabled: true,
    category: "system",
    updatedAt: Date.now()
  },
  "system.rate_limiting.strict": {
    id: "system.rate_limiting.strict",
    name: "Rate limiting strict",
    description: "Limites plus strictes pour les API",
    enabled: false,
    category: "system",
    updatedAt: Date.now()
  },

  // Experimental features
  "experimental.local_llm.enabled": {
    id: "experimental.local_llm.enabled",
    name: "LLM Local (Ollama)",
    description: "Utilise un LLM local pour certaines tâches",
    enabled: false,
    category: "experimental",
    updatedAt: Date.now()
  },
  "experimental.vector_search.enabled": {
    id: "experimental.vector_search.enabled",
    name: "Recherche vectorielle",
    description: "Recherche sémantique dans les documents",
    enabled: false,
    category: "experimental",
    updatedAt: Date.now()
  }
};

class FeatureFlagsService {
  private flags: Map<string, FeatureFlag> = new Map();
  private listeners: Map<string, ((enabled: boolean) => void)[]> = new Map();

  constructor() {
    // Initialize with default flags
    for (const [id, flag] of Object.entries(defaultFlags)) {
      this.flags.set(id, { ...flag });
    }
  }

  isEnabled(flagId: string): boolean {
    const flag = this.flags.get(flagId);
    return flag?.enabled ?? false;
  }

  getFlag(flagId: string): FeatureFlag | undefined {
    return this.flags.get(flagId);
  }

  setFlag(flagId: string, enabled: boolean, config?: Record<string, unknown>): boolean {
    const flag = this.flags.get(flagId);
    if (!flag) {
      console.warn(`[FeatureFlags] Unknown flag: ${flagId}`);
      return false;
    }

    const wasEnabled = flag.enabled;
    flag.enabled = enabled;
    flag.updatedAt = Date.now();
    if (config) {
      flag.config = { ...flag.config, ...config };
    }

    console.log(`[FeatureFlags] ${flagId}: ${wasEnabled ? 'ON' : 'OFF'} → ${enabled ? 'ON' : 'OFF'}`);

    // Notify listeners
    const callbacks = this.listeners.get(flagId) || [];
    for (const cb of callbacks) {
      try {
        cb(enabled);
      } catch (e) {
        console.error(`[FeatureFlags] Listener error for ${flagId}:`, e);
      }
    }

    return true;
  }

  toggleFlag(flagId: string): boolean {
    const flag = this.flags.get(flagId);
    if (!flag) return false;
    return this.setFlag(flagId, !flag.enabled);
  }

  onFlagChange(flagId: string, callback: (enabled: boolean) => void): () => void {
    const callbacks = this.listeners.get(flagId) || [];
    callbacks.push(callback);
    this.listeners.set(flagId, callbacks);

    // Return unsubscribe function
    return () => {
      const cbs = this.listeners.get(flagId) || [];
      const idx = cbs.indexOf(callback);
      if (idx >= 0) cbs.splice(idx, 1);
    };
  }

  getAllFlags(): FeatureFlag[] {
    return Array.from(this.flags.values());
  }

  getFlagsByCategory(category: FeatureFlag["category"]): FeatureFlag[] {
    return this.getAllFlags().filter(f => f.category === category);
  }

  getEnabledFlags(): string[] {
    return this.getAllFlags().filter(f => f.enabled).map(f => f.id);
  }

  getDisabledFlags(): string[] {
    return this.getAllFlags().filter(f => !f.enabled).map(f => f.id);
  }

  getSummary(): {
    total: number;
    enabled: number;
    disabled: number;
    byCategory: Record<string, { enabled: number; total: number }>;
  } {
    const flags = this.getAllFlags();
    const byCategory: Record<string, { enabled: number; total: number }> = {};

    for (const flag of flags) {
      if (!byCategory[flag.category]) {
        byCategory[flag.category] = { enabled: 0, total: 0 };
      }
      byCategory[flag.category].total++;
      if (flag.enabled) byCategory[flag.category].enabled++;
    }

    return {
      total: flags.length,
      enabled: flags.filter(f => f.enabled).length,
      disabled: flags.filter(f => !f.enabled).length,
      byCategory
    };
  }

  toJSON() {
    return {
      flags: Object.fromEntries(this.flags),
      summary: this.getSummary()
    };
  }
}

export const featureFlagsService = new FeatureFlagsService();
