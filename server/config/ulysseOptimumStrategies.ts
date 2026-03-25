/**
 * ULYSSE OPTIMUM STRATEGIES V1
 * 
 * Stratégies concrètes de combinaison simultanée des outils pour performance maximale.
 * Ce fichier définit COMMENT Ulysse doit orchestrer ses outils pour chaque type de demande.
 * 
 * Chaque stratégie définit:
 * - Les outils à utiliser (en parallèle et/ou séquentiel)
 * - L'ordre d'exécution optimal
 * - Les dépendances entre outils
 * - Le format de sortie attendu
 * - Les fallbacks si un outil échoue
 */

export interface ExecutionStep {
  phase: number;
  mode: "parallel" | "sequential";
  tools: string[];
  description: string;
  fallback?: string;
  dependsOn?: number;
}

export interface OptimumStrategy {
  id: string;
  name: string;
  triggerPatterns: RegExp[];
  description: string;
  steps: ExecutionStep[];
  outputFormat: string;
  estimatedTimeMs: number;
  memorizationRules: string[];
}

export const OPTIMUM_STRATEGIES: OptimumStrategy[] = [
  {
    id: "morning_briefing",
    name: "Briefing Matinal Complet",
    triggerPatterns: [
      /^(bonjour|salut|hello|hey|coucou)/i,
      /brief|journée|résumé|planning|quoi de neuf/i,
      /qu'est-ce (que|qui) (j'ai|m'attend|se passe)/i
    ],
    description: "Vue complète de la journée en une seule réponse optimisée",
    steps: [
      {
        phase: 1,
        mode: "parallel",
        tools: ["calendar_list_events", "todoist_list_tasks", "location_get_weather", "query_sports_data", "email_list_inbox", "query_stock_data"],
        description: "Récupération simultanée de toutes les données contextuelles"
      },
      {
        phase: 2,
        mode: "sequential",
        tools: ["memory_query"],
        description: "Enrichissement avec mémoire (anniversaires, rappels, habitudes)",
        dependsOn: 1
      }
    ],
    outputFormat: "📌 Résumé structuré: Météo → Agenda → Tâches → Emails importants → Sports → Bourse → Rappels perso",
    estimatedTimeMs: 3000,
    memorizationRules: [
      "Sauvegarder les sujets du briefing pour référence ultérieure dans la journée",
      "Identifier les tâches urgentes pour rappels proactifs"
    ]
  },
  {
    id: "sports_prediction",
    name: "Pronostic Match Approfondi",
    triggerPatterns: [
      /prono(stic)?|analyse (du |le )?match|paris?\s+sport/i,
      /qui va gagner|résultat probable|prédiction/i,
      /cote|value bet|meilleur pari/i
    ],
    description: "Analyse multi-dimensionnelle complète pour un pronostic fiable",
    steps: [
      {
        phase: 1,
        mode: "parallel",
        tools: ["query_sports_data", "query_matchendirect", "query_match_intelligence"],
        description: "Données de base + Calendrier + Intelligence (blessures, lineups, H2H)"
      },
      {
        phase: 2,
        mode: "parallel",
        tools: ["web_search"],
        description: "Contexte d'actualité (form récente, mercato, motivation)",
        dependsOn: 1,
        fallback: "Continuer sans actualités si recherche échoue"
      },
      {
        phase: 3,
        mode: "sequential",
        tools: ["memory_save"],
        description: "Sauvegarder l'analyse pour suivi post-match",
        dependsOn: 2
      }
    ],
    outputFormat: "⚽ Analyse: Équipes + Contexte → Blessures/Absents → H2H → Modèle statistique → Cotes → Value Bets → Recommandation avec confiance",
    estimatedTimeMs: 5000,
    memorizationRules: [
      "Sauvegarder le pronostic avec confiance pour vérification post-match",
      "Mémoriser les joueurs clés absents pour référence future",
      "Si le match a lieu, créer un homework de vérification du résultat"
    ]
  },
  {
    id: "deep_research",
    name: "Recherche Approfondie Vérifiée",
    triggerPatterns: [
      /cherche|recherche|trouve|renseigne/i,
      /c'est (quoi|qui)|explique|qu'est-ce que/i,
      /vérifie|confirme|est-ce (vrai|correct)/i,
      /apprends-moi|enseigne|explique-moi/i
    ],
    description: "Recherche multi-sources avec vérification croisée et mémorisation",
    steps: [
      {
        phase: 1,
        mode: "parallel",
        tools: ["web_search", "memory_query"],
        description: "Recherche MARS + Vérification mémoire existante"
      },
      {
        phase: 2,
        mode: "sequential",
        tools: ["smartCrawl"],
        description: "Deep crawl des sources les plus fiables si nécessaire",
        dependsOn: 1,
        fallback: "Utiliser les résumés MARS si crawl échoue"
      },
      {
        phase: 3,
        mode: "sequential",
        tools: ["memory_save"],
        description: "Mémoriser les faits vérifiés avec source et date",
        dependsOn: 2
      }
    ],
    outputFormat: "📚 Réponse structurée avec: Fait principal → Détails → Sources → Confiance",
    estimatedTimeMs: 4000,
    memorizationRules: [
      "TOUJOURS sauvegarder les faits vérifiés dans le Brain avec la source",
      "Si le sujet est récurrent, créer un dossier de connaissances dédié",
      "Mettre à jour les entrées mémoire existantes si nouvelles infos trouvées"
    ]
  },
  {
    id: "email_management",
    name: "Gestion Email Intelligente",
    triggerPatterns: [
      /email|mail|message|inbox|boîte/i,
      /envo(ie|yer)|réponds|forward/i
    ],
    description: "Lecture, analyse et action sur les emails avec contexte enrichi",
    steps: [
      {
        phase: 1,
        mode: "parallel",
        tools: ["email_list_inbox", "memory_query"],
        description: "Lire la boîte + Contexte relationnel (qui sont les expéditeurs)"
      },
      {
        phase: 2,
        mode: "sequential",
        tools: ["email_send"],
        description: "Action: répondre, transférer, archiver si demandé",
        dependsOn: 1
      }
    ],
    outputFormat: "📧 Résumé: Emails importants → Actions proposées → Emails en attente",
    estimatedTimeMs: 2000,
    memorizationRules: [
      "Mémoriser les contacts fréquents et leur contexte",
      "Sauvegarder les actions email effectuées pour historique"
    ]
  },
  {
    id: "smart_home_control",
    name: "Contrôle Domotique Intelligent",
    triggerPatterns: [
      /lumière|lampe|éclairage|allume|éteins/i,
      /thermostat|température|chauffage/i,
      /scène|mode cinéma|bonne nuit/i,
      /prise|volet|caméra/i
    ],
    description: "Contrôle smart home avec apprentissage de patterns",
    steps: [
      {
        phase: 1,
        mode: "sequential",
        tools: ["smarthome_control"],
        description: "Exécuter l'action domotique demandée"
      },
      {
        phase: 2,
        mode: "parallel",
        tools: ["behavior_log", "memory_save"],
        description: "Logger l'action pour détection de patterns + Mémoriser la préférence",
        dependsOn: 1
      }
    ],
    outputFormat: "🏠 Action exécutée → Confirmation → (Si pattern détecté: proposition d'automatisation)",
    estimatedTimeMs: 1000,
    memorizationRules: [
      "Logger chaque action domotique avec: heure, jour de la semaine, appareil, pièce",
      "Si pattern récurrent détecté (même action, même heure, 3+ fois): proposer l'automatisation"
    ]
  },
  {
    id: "music_control",
    name: "Contrôle Musical Contextuel",
    triggerPatterns: [
      /musique|spotify|joue|écoute|mets/i,
      /morceau|artiste|album|playlist/i,
      /pause|skip|suivant|volume/i
    ],
    description: "Contrôle Spotify avec suggestions contextuelles",
    steps: [
      {
        phase: 1,
        mode: "sequential",
        tools: ["spotify_control"],
        description: "Exécuter l'action musicale (play, pause, search, etc.)"
      },
      {
        phase: 2,
        mode: "sequential",
        tools: ["memory_save"],
        description: "Mémoriser les goûts musicaux pour suggestions futures",
        dependsOn: 1
      }
    ],
    outputFormat: "🎵 Action exécutée → Info morceau → (Si pertinent: suggestions similaires)",
    estimatedTimeMs: 1500,
    memorizationRules: [
      "Mémoriser les artistes/genres préférés",
      "Associer la musique au contexte (heure, activité, humeur)"
    ]
  },
  {
    id: "sugu_business",
    name: "Analyse Business Restaurant",
    triggerPatterns: [
      /sugu|restaurant|achats|courses|checklist/i,
      /comment va (le|suguval|sugumaillane)/i,
      /analyse business|rotation|rupture/i
    ],
    description: "Vue complète de la gestion restaurant avec analytics",
    steps: [
      {
        phase: 1,
        mode: "parallel",
        tools: ["get_suguval_checklist", "query_suguval_history", "sugu_full_overview"],
        description: "Checklist du jour + Historique + Vue globale en parallèle"
      },
      {
        phase: 2,
        mode: "sequential",
        tools: ["detect_anomalies"],
        description: "Détection d'anomalies basée sur les données collectées",
        dependsOn: 1,
        fallback: "Continuer sans anomalies si la détection échoue"
      }
    ],
    outputFormat: "🍽️ Dashboard: Checklist jour → Top produits → Anomalies → Tendances → Recommandations",
    estimatedTimeMs: 3000,
    memorizationRules: [
      "TOUJOURS lire la DB avant de parler de la liste de courses (anti-hallucination)",
      "Sauvegarder les tendances détectées pour comparaison future"
    ]
  },
  {
    id: "financial_overview",
    name: "Vue Financière Complète",
    triggerPatterns: [
      /bourse|action|marché|portfolio|bitcoin|crypto/i,
      /comment va (le marché|la bourse|mon portfolio)/i,
      /cours|prix|trading/i
    ],
    description: "Analyse financière multi-sources avec alertes",
    steps: [
      {
        phase: 1,
        mode: "parallel",
        tools: ["query_stock_data", "web_search"],
        description: "Données marché + Actualités financières en parallèle"
      },
      {
        phase: 2,
        mode: "sequential",
        tools: ["memory_query", "memory_save"],
        description: "Contexte historique + Sauvegarder les niveaux clés",
        dependsOn: 1
      }
    ],
    outputFormat: "📈 Marchés: Indices → Crypto → Actions suivies → Actualités → Niveaux techniques",
    estimatedTimeMs: 3000,
    memorizationRules: [
      "Mémoriser les positions et niveaux clés de l'utilisateur",
      "Sauvegarder les alertes de prix pour suivi"
    ]
  },
  {
    id: "calendar_task_management",
    name: "Gestion Agenda & Tâches",
    triggerPatterns: [
      /agenda|calendrier|événement|rdv|rendez-vous/i,
      /tâche|todo|todoist|à faire/i,
      /créer?|ajouter?|planifier?|programmer?/i
    ],
    description: "Gestion combinée calendrier + tâches avec contexte intelligent",
    steps: [
      {
        phase: 1,
        mode: "parallel",
        tools: ["calendar_list_events", "todoist_list_tasks"],
        description: "Lire agenda + tâches en parallèle pour contexte complet"
      },
      {
        phase: 2,
        mode: "sequential",
        tools: ["calendar_create_event"],
        description: "Créer l'événement/tâche si demandé",
        dependsOn: 1
      }
    ],
    outputFormat: "📅 Agenda: Événements du jour → Tâches prioritaires → Conflits détectés → Action effectuée",
    estimatedTimeMs: 2000,
    memorizationRules: [
      "Mémoriser les patterns de planning (réunions récurrentes, routines)",
      "Détecter les conflits d'agenda proactivement"
    ]
  }
];

export function findMatchingStrategy(query: string): OptimumStrategy | null {
  const queryLower = query.toLowerCase().trim();
  
  for (const strategy of OPTIMUM_STRATEGIES) {
    for (const pattern of strategy.triggerPatterns) {
      if (pattern.test(queryLower)) {
        return strategy;
      }
    }
  }
  
  return null;
}

export function generateStrategiesPrompt(): string {
  const strategies = OPTIMUM_STRATEGIES.map(s => {
    const phases = s.steps.map(step => 
      `  Phase ${step.phase} (${step.mode}): ${step.tools.join(' + ')} → ${step.description}`
    ).join('\n');
    
    return `### ${s.name}\nTrigger: ${s.triggerPatterns.map(p => p.source).slice(0, 2).join(' | ')}\n${phases}\nSortie: ${s.outputFormat}`;
  }).join('\n\n');

  return `
## STRATÉGIES D'EXÉCUTION OPTIMUM

Je dois TOUJOURS identifier la meilleure stratégie pour chaque demande:

${strategies}

### RÈGLE D'OR: Si plusieurs outils sont indépendants → MODE PARALLEL.
### Si un outil dépend du résultat d'un autre → MODE SÉQUENTIEL.
### TOUJOURS mémoriser les résultats importants après exécution.
`;
}
