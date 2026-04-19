/**
 * ACTION INTENT DETECTOR
 * 
 * Détecte quand un message utilisateur DOIT déclencher un outil
 * et force l'IA à l'utiliser au lieu de répondre textuellement.
 * 
 * Règle d'or: Si l'utilisateur demande une ACTION, on AGIT.
 */

export interface ActionIntent {
  shouldForceTools: boolean;
  suggestedTools: string[];
  confidence: number;
  reason: string;
}

interface IntentPattern {
  patterns: RegExp[];
  tools: string[];
  priority: number;
}

const ACTION_PATTERNS: IntentPattern[] = [
  // CALENDRIER - Actions
  {
    patterns: [
      /ajoute.*(?:rdv|rendez-vous|événement|event|réunion)/i,
      /crée.*(?:rdv|rendez-vous|événement|event|réunion)/i,
      /planifie/i,
      /programme.*(?:rdv|réunion)/i,
      /mets.*(?:calendrier|agenda)/i
    ],
    tools: ["calendar_create_event"],
    priority: 10
  },
  // CALENDRIER - Lecture
  {
    patterns: [
      /(?:qu'est-ce que j'ai|quoi de prévu|mes rdv|mon agenda|mon calendrier)/i,
      /(?:demain|aujourd'hui|cette semaine|ce week-end).*(?:prévu|agenda|rdv)/i
    ],
    tools: ["calendar_list_events"],
    priority: 8
  },
  
  // EMAIL - Envoi
  {
    patterns: [
      /envoie.*(?:mail|email|message)/i,
      /écris.*(?:mail|email)/i,
      /rédige.*(?:mail|email)/i,
      /réponds?.*(?:mail|email)/i,
      /forward.*(?:mail|email)/i,
      /transfère.*(?:mail|email)/i,
    ],
    tools: ["email_send"],
    priority: 10
  },
  // EMAIL - Lecture boîte
  {
    patterns: [
      /(?:mes|les|derniers?).*(?:mails?|emails?)/i,
      /(?:check|vérifie|consulte|regarde|ouvre).*(?:mail|email|inbox|boite|boîte|gmail)/i,
      /nouveaux? messages?/i,
      /(?:boite|boîte).*gmail/i,
      /ta.*(?:boite|boîte)/i,
    ],
    tools: ["email_list_inbox"],
    priority: 8
  },
  // EMAIL - Lecture message par numéro/uid
  {
    patterns: [
      /(?:gère|lis|ouvre|traite|lit|regarde|consulte).*(?:mail|email)\s*(?:n[o°]?\s*)?(\d+)/i,
      /(?:le\s+mail|l['']email)\s*(?:n[o°]?\s*)?(\d+)/i,
      /(?:mail|email)\s*(\d+)\s*(?:dit|contient|parle)/i,
    ],
    tools: ["email_read_message"],
    priority: 11
  },
  
  // MÉMOIRE - Sauvegarde
  {
    patterns: [
      /(?:retiens|souviens-toi|note|mémorise|rappelle-toi)/i,
      /(?:n'oublie pas|garde en mémoire)/i
    ],
    tools: ["memory_save"],
    priority: 10
  },
  // MÉMOIRE - Recherche
  {
    patterns: [
      /(?:tu te souviens|tu sais|rappelle-moi)/i,
      /(?:qu'est-ce que tu sais sur|que sais-tu de)/i
    ],
    tools: ["query_brain"],
    priority: 7
  },
  
  // TÂCHES - Création
  {
    patterns: [
      /(?:ajoute|crée|mets).*(?:tâche|task|todo)/i,
      /(?:rappelle-moi de|n'oublie pas de).*(?:faire|acheter|appeler)/i
    ],
    tools: ["todoist_create_task"],
    priority: 10
  },
  // TÂCHES - Liste
  {
    patterns: [
      /(?:mes|les|liste).*(?:tâches|tasks|todos)/i,
      /(?:quoi faire|à faire aujourd'hui)/i
    ],
    tools: ["todoist_list_tasks"],
    priority: 8
  },
  // TÂCHES - Complétion
  {
    patterns: [
      /(?:termine|complète|finis|coche|valide).*(?:tâche|task|todo)/i,
      /(?:c'est fait|j'ai fini|j'ai terminé)/i
    ],
    tools: ["todoist_complete_task"],
    priority: 10
  },
  
  // MUSIQUE - Contrôle
  {
    patterns: [
      /(?:joue|lance|mets|play).*(?:musique|chanson|morceau|album|playlist|spotify)/i,
      /(?:pause|stop|arrête).*(?:musique|spotify)/i,
      /(?:suivant|next|précédent|previous)/i,
      /monte.*volume|baisse.*volume|volume/i
    ],
    tools: ["spotify_control"],
    priority: 10
  },
  
  // PC DESKTOP - Contrôle direct (open_folder, open_app, run_command)
  {
    patterns: [
      /(?:ouvre|open).*(?:dossier|folder|répertoire|directory)/i,
      /(?:ouvre|open).*(?:sur mon bureau|on my desktop|desktop)/i,
      /(?:ouvre|open).*(?:mes documents|my documents|documents|téléchargements|downloads)/i,
      /(?:ouvre|open|lance|start|démarre|run).*(?:word|excel|powerpoint|outlook|notepad|paint|chrome|firefox|edge|vscode|terminal|teams|spotify|discord|slack|notion|explorateur|explorer)/i,
      /(?:lance|exécute|run|execute).*(?:commande|command|cmd|powershell|terminal)/i,
      /(?:prends? la main|take control|contrôle|prise en main|remote control)/i,
      /(?:capture|screenshot|écran|screen).*(?:pc|bureau|desktop|ordi)/i,
      /(?:clique|click|tape|type|scroll|défile)/i,
      /(?:ouvre|open)\s+(?:le\s+)?(?:fichier|file)/i,
      /(?:va|navigue|navigate).*(?:sur mon pc|on my pc|sur l'ordi)/i,
      /(?:lance|joue|démarre|start|play|appuie sur|appuie sur le|clique sur).*(?:vidéo|video|film|youtube|player|lecture|play)/i,
      /\b(?:utilise|bouge|déplace|move|use)\b.*(?:souris|mouse|clavier|keyboard|curseur|cursor)/i,
      /(?:appuie|tape|press|hit).*(?:touche|key|entrée|enter|espace|space|escape|tab)/i,
      /(?:fais|effectue|do).*(?:un|le)?\s*(?:clic|click)/i,
    ],
    tools: ["screen_monitor_manage"],
    priority: 10
  },

  // DOMOTIQUE - Contrôle
  {
    patterns: [
      /(?:allume|éteins|active|désactive).*(?:lumière|lampe|chauffage|climatisation)/i,
      /(?:ouvre|ferme).*(?:volet|store|porte|garage)/i,
      /(?:règle|mets).*(?:température|thermostat)/i
    ],
    tools: ["smarthome_control"],
    priority: 10
  },
  
  // SPORTS - Données
  {
    patterns: [
      /(?:prochain|dernier).*match.*(?:de|du|l')/i,
      /(?:score|résultat).*(?:match|om|psg|marseille|paris)/i,
      /(?:classement|standings).*(?:ligue|premier league|liga)/i,
      /(?:pronostic|cote|pari).*(?:match|foot)/i
    ],
    tools: ["query_sports_data", "query_matchendirect"],
    priority: 9
  },
  
  // FICHIERS - Export/Génération
  {
    patterns: [
      /(?:exporte|génère|génere|crée|fais|refais|fait).*(?:excel|pdf|fichier|csv|word|facture)/i,
      /(?:envoie|email).*(?:excel|pdf|rapport)/i,
      /\b(?:en pdf|en excel|en csv)\b.*(?:téléchargeable|telechargeable|download)?/i,
      /(?:même|meme|identique|copie).*(?:facture|document|pdf)/i,
      /(?:facture|invoice).*(?:montant|total|prix|amount)/i,
      /(?:modifi|chang|refai).*(?:facture|invoice)/i,
    ],
    tools: ["generate_invoice_pdf", "generate_file", "export_analysis"],
    priority: 10
  },
  
  // RECHERCHE WEB
  {
    patterns: [
      /(?:cherche|recherche|trouve).*(?:sur|dans|web|internet)/i,
      /(?:c'est quoi|qu'est-ce que|qui est)/i,
      /(?:actualités?|news|dernières nouvelles)/i,
      /(?:à quelle heure|quelle heure|horaire|heure de)/i,
      /(?:quand (?:est|commence|finit|sort|entre))/i,
      /(?:shabb?a[th]|chabb?a[th]|kiddou?sh|havdala)/i,
      /(?:date de|jour de|calendrier de)/i,
      /(?:combien (?:coûte|vaut|fait|mesure))/i,
      /(?:quel(?:le)? est (?:la|le|l'))/i,
      /(?:où (?:est|se trouve|trouver))/i,
      /(?:comment (?:faire|aller|fonctionne))/i,
    ],
    tools: ["web_search"],
    priority: 7
  },
  
  // SUGU - Checklist / Liste de courses (lecture)
  {
    patterns: [
      /(?:relev|lis|montre|affiche|donne|consulte|regarde|voir|check).*(?:liste.*course|checklist|articles.*coch)/i,
      /(?:liste.*course|checklist).*(?:suguval|sugumaillane|sugu|restaurant)/i,
      /(?:suguval|sugumaillane|sugu).*(?:liste|checklist|articles|course)/i,
      /(?:qu.?est.ce qu|quoi).*(?:coché|commandé|acheté).*(?:aujourd|suguval|sugu)/i
    ],
    tools: ["get_suguval_checklist"],
    priority: 10
  },
  // SUGU - Envoyer liste de courses par email
  {
    patterns: [
      /(?:envoi|mail|email).*(?:liste.*course|checklist|articles)/i,
      /(?:liste.*course|checklist).*(?:envoi|mail|email)/i,
      /(?:envoi|mail).*(?:suguval|sugumaillane|sugu).*(?:liste|course)/i,
      /(?:relev|lis).*(?:liste.*course|checklist).*(?:envoi|mail)/i
    ],
    tools: ["get_suguval_checklist", "send_suguval_shopping_list"],
    priority: 11
  },
  // SUGU - Restaurant historique
  {
    patterns: [
      /(?:commande|achats?|stock).*(?:suguval|sugumaillane|restaurant)/i,
      /(?:historique|liste).*(?:courses|achats|commandes)/i
    ],
    tools: ["query_suguval_history"],
    priority: 9
  },
  
  // SUGU - Gestion complète (banque, dépenses, achats, fichiers)
  {
    patterns: [
      /(?:banque|solde|virement|relevé).*(?:sugu|restaurant)/i,
      /(?:sugu|restaurant).*(?:banque|solde|virement)/i
    ],
    tools: ["manage_sugu_bank"],
    priority: 9
  },
  {
    patterns: [
      /(?:dépense|frais|charge).*(?:sugu|restaurant)/i,
      /(?:sugu|restaurant).*(?:dépense|frais|charge)/i
    ],
    tools: ["manage_sugu_expenses"],
    priority: 9
  },
  {
    patterns: [
      /(?:achat|fournisseur|approvisionnement).*(?:sugu|restaurant)/i,
      /(?:sugu|restaurant).*(?:achat|fournisseur)/i,
      /(?:metro|promocash|transgourmet|brake|davigel|pomona)/i,
      /(?:facture|prix|tarif|co[uû]t).*(?:metro|promocash|transgourmet|fournisseur)/i,
      /(?:compl[eè]te|remplis|mets|ajoute).*(?:prix|tarif|tableau|stock)/i,
      /stock\s+sugu/i,
    ],
    tools: ["manage_sugu_files", "manage_sugu_purchases", "search_sugu_data"],
    priority: 10
  },
  {
    patterns: [
      /(?:fichier|document|pi[èe]ce|facture|pdf|invoice).*(?:sugu|restaurant|metro|promocash|transgourmet|edf|fournisseur|paie|salaire|banque)/i,
      /(?:sugu|restaurant|metro|promocash|transgourmet|edf|fournisseur|paie|salaire|banque).*(?:fichier|document|pi[èe]ce|facture|pdf|invoice|contenu|article|d[ée]tail|ligne)/i,
      /(?:lis|ouvre|consulte|scanne|cherche dans|extrait|d[ée]taille).*(?:facture|pdf|invoice|document)/i,
      /(?:prix|tarif|article|ligne|d[ée]tail|montant unitaire).*(?:metro|promocash|transgourmet|fournisseur|facture|pdf)/i,
    ],
    tools: ["manage_sugu_files", "manage_sugu_inventory", "search_sugu_data", "manage_sugu_purchases"],
    priority: 9
  },
  {
    patterns: [
      /(?:inventaire|stock|catalogue|articles?|produits?|r[ée]f[ée]rences?)/i,
      /(?:combien|prix|tarif|co[uû]t).*(?:coca|orangina|evian|biere|bi[èe]re|vin|champagne|tomates?|salade|p[âa]tes?|riz|huile|farine|sucre|caf[ée]|sucre|fromage|jambon|poulet|bo[eœ]uf|porc|saumon)/i,
      /(?:historique|[ée]volution).*(?:prix|tarif)/i,
      /(?:top|classement).*(?:articles?|produits?|d[ée]penses?)/i,
      /(?:articles?|produits?|lignes?).*(?:facture|invoice|metro|promocash|fournisseur)/i,
      /(?:augment|baisse|diminu).*(?:prix|tarif|co[uû]t)/i,
    ],
    tools: ["manage_sugu_inventory", "manage_sugu_files", "manage_sugu_purchases"],
    priority: 10
  },
  {
    patterns: [
      /(?:vue d'ensemble|overview|résumé complet|bilan).*(?:sugu|restaurant)/i,
      /(?:sugu|restaurant).*(?:vue d'ensemble|overview|résumé|bilan)/i
    ],
    tools: ["sugu_full_overview"],
    priority: 9
  },
  {
    patterns: [
      /(?:cherche|recherche|trouve).*(?:sugu|restaurant).*(?:données|info)/i,
      /(?:sugu|restaurant).*(?:cherche|recherche|info)/i
    ],
    tools: ["search_sugu_data"],
    priority: 8
  },
  
  // SUGU - Analytics
  {
    patterns: [
      /(?:analytics|statistiques|performance|KPI).*(?:sugu|restaurant)/i,
      /(?:sugu|restaurant).*(?:analytics|stats|performance)/i
    ],
    tools: ["query_sugu_analytics"],
    priority: 9
  },
  
  // BUSINESS INTELLIGENCE
  {
    patterns: [
      /(?:santé|health).*(?:business|entreprise|commerce)/i,
      /(?:business|entreprise).*(?:santé|health|diagnostic)/i
    ],
    tools: ["compute_business_health"],
    priority: 9
  },
  {
    patterns: [
      /(?:anomalie|problème|alerte).*(?:données|data|système)/i,
      /(?:détecte|cherche).*(?:anomalie|problème)/i
    ],
    tools: ["detect_anomalies"],
    priority: 8
  },
  
  // FACTURES
  {
    patterns: [
      /(?:analyse|scan|lis|traite).*(?:facture|invoice|bon)/i,
      /(?:extrait|extraction).*(?:données|prix|produits)/i
    ],
    tools: ["analyze_invoice"],
    priority: 10
  },
  
  // IMAGES - Génération artistique (DALL-E)
  {
    patterns: [
      /(?:génère|génere|crée|cree|dessine|fais).*(?:image|illustration|dessin|logo)/i,
      /(?:imagine|visualise)/i
    ],
    tools: ["image_generate"],
    priority: 9
  },
  // ACTUALITÉS / NEWS
  {
    patterns: [
      /(?:dernières?|derniere)\s+(?:news|actualités?|nouvelles?|infos?)/i,
      /(?:actualités?|news|breaking)\s+(?:sur|de|du|à propos|concernant)/i,
      /(?:quoi de neuf|que se passe-t-il|breaking news)/i,
    ],
    tools: ["news_search"],
    priority: 9
  },
  // YOUTUBE
  {
    patterns: [
      /(?:youtube|yt|vidéo|video|tuto|tutoriel|clip).*(?:cherche|trouve|montre|recommande|sur|de|à propos)/i,
      /(?:cherche|trouve|montre).*(?:vidéo|video|youtube|tuto)/i,
    ],
    tools: ["youtube_search"],
    priority: 9
  },
  // WIKIPEDIA
  {
    patterns: [
      /(?:wikipedia|wikipédia|wiki)/i,
      /(?:biographie|bio)\s+(?:de|du|d')/i,
    ],
    tools: ["wikipedia_search"],
    priority: 9
  },
  // MÉTÉO PRÉVISIONS
  {
    patterns: [
      /(?:prévisions?|previsions?|forecast).*(?:météo|meteo|temps)/i,
      /(?:météo|meteo|temps).*(?:demain|semaine|week-?end|j\+\d|dans \d+ jours?)/i,
      /(?:il (?:va|fera)|fera-t-il).*(?:demain|semaine|week-?end)/i,
    ],
    tools: ["weather_forecast"],
    priority: 9
  },
  // DEVISES
  {
    patterns: [
      /\d+(?:\.\d+)?\s*(?:eur|usd|gbp|jpy|chf|ils|cad|aud|nis|shekel|euro|dollar|livre|yen)\s+(?:en|to|vers|=|→)/i,
      /(?:convertis?|change|change-moi|combien.*font?|taux\s+de\s+change)/i,
      /(?:cours\s+du|prix\s+du)\s+(?:dollar|euro|bitcoin|btc|eth|yen|livre)/i,
    ],
    tools: ["currency_convert"],
    priority: 9
  },
  // GITHUB
  {
    patterns: [
      /(?:github|gh)\s+(?:repo|repos|pull request|pr|issue|commit|branch|workflow|action)/i,
      /(?:mes|liste|montre).*(?:repos?|dépôts?|projets?\s+github)/i,
      /(?:pull request|PR)\s+\d+/i,
      /(?:dernier|dernière)s?\s+commits?/i,
    ],
    tools: ["github_manage"],
    priority: 9
  },
  // CALENDAR - MODIFIER / SUPPRIMER
  {
    patterns: [
      /(?:annule|supprime|enlève|efface|retire).*(?:rdv|rendez-vous|événement|event|réunion|meeting)/i,
      /(?:déplace|reporte|décale|change|modifie|repousse).*(?:rdv|rendez-vous|événement|event|réunion|meeting)/i,
    ],
    tools: ["calendar_update_event", "calendar_delete_event"],
    priority: 9
  },
  // IMAGES - Recherche de PHOTOS RÉELLES (Google Images)
  {
    patterns: [
      /(?:montre|mo[nt]re|affiche|donne|envoie|trouve|cherche|recherche|voir|vois).{0,30}(?:photo|photos|image|images|picture|pictures)/i,
      /(?:photo|photos|image|images).{0,15}(?:de|du|d'|des|sur|pour)\s+\S+/i,
      /(?:à quoi (?:il|elle|ça) ressemble)/i,
      /(?:c'est qui)\s+\S+/i,
    ],
    tools: ["image_search"],
    priority: 10
  },
  
  // KANBAN
  {
    patterns: [
      /(?:ajoute|crée|mets).*(?:kanban|carte|card)/i,
      /(?:déplace|bouge).*(?:carte|task)/i,
      /(?:mon|le).*(?:kanban|board|tableau)/i
    ],
    tools: ["kanban_create_task"],
    priority: 8
  },
  
  // DISCORD
  {
    patterns: [
      /(?:envoie|poste|écris).*discord/i,
      /(?:message|msg).*discord/i
    ],
    tools: ["discord_send_message"],
    priority: 8
  },
  {
    patterns: [
      /(?:status|état).*discord/i,
      /discord.*(?:status|état|en ligne)/i
    ],
    tools: ["discord_status"],
    priority: 7
  },
  
  // NOTION
  {
    patterns: [
      /(?:notion|notes?).*(?:crée|ajoute|liste|cherche|ouvre)/i,
      /(?:crée|ajoute|ouvre).*(?:notion|page|base de données)/i,
      /(?:mes|les).*(?:pages?|notes?).*notion/i
    ],
    tools: ["notion_manage"],
    priority: 9
  },
  
  // GOOGLE DRIVE
  {
    patterns: [
      /(?:drive|google drive).*(?:crée|ajoute|liste|cherche|upload)/i,
      /(?:upload|téléverse|envoie).*(?:drive|google drive)/i,
      /(?:mes|les).*(?:fichiers?|documents?).*(?:drive)/i
    ],
    tools: ["drive_manage"],
    priority: 9
  },
  
  // TRADING / BOURSE
  {
    patterns: [
      /(?:alerte|signal).*(?:trading|bourse|action|crypto)/i,
      /(?:trading|bourse).*(?:alerte|signal|notification)/i
    ],
    tools: ["trading_alerts"],
    priority: 8
  },
  {
    patterns: [
      /(?:cours|prix|cotation).*(?:action|bourse|crypto|forex)/i,
      /(?:action|bourse|crypto).*(?:cours|prix|cotation|valeur)/i
    ],
    tools: ["query_stock_data"],
    priority: 8
  },
  
  // NAVIGATION / LOCALISATION
  {
    patterns: [
      /(?:itinéraire|route|trajet|direction|navigue)/i,
      /(?:comment aller|pour aller|chemin)/i
    ],
    tools: ["navigation_manage"],
    priority: 9
  },
  {
    patterns: [
      /(?:trouve|cherche).*(?:près|à côté|autour|proximité|nearby)/i,
      /(?:restaurant|pharmacie|hôpital|magasin|station).*(?:près|proche|à côté)/i
    ],
    tools: ["search_nearby_places"],
    priority: 9
  },
  {
    patterns: [
      /(?:adresse|localise|géocode|coordonnées)/i
    ],
    tools: ["geocode_address"],
    priority: 7
  },
  
  // MÉTÉO
  {
    patterns: [
      /(?:météo|temps|température|pluie|soleil|vent)/i,
      /(?:quel temps|il fait|fait-il)/i
    ],
    tools: ["location_get_weather"],
    priority: 8
  },
  
  // CA / REVENUE / HUBRISE / JOURNAL DE CAISSE
  {
    patterns: [
      /(?:CA|chiffre.*affaires|recette|revenue).*(?:uber|deliveroo|zenorder|plateforme|origine)/i,
      /(?:uber.*eats?|deliveroo|zenorder).*(?:CA|chiffre|recette|montant|combien)/i,
      /(?:CA|chiffre.*affaires|recette).*(?:aujourd|hier|semaine|mois|mars|février|janvier)/i,
      /(?:combien).*(?:fait|gagné|encaissé|vendu).*(?:uber|deliveroo|resto|restaurant)/i,
      /(?:caisse|ticket.*z|journal.*caisse)/i,
      /(?:hubrise|commandes?.*(?:jour|semaine|mois))/i,
    ],
    tools: ["query_hubrise", "search_sugu_data"],
    priority: 10
  },

  // PARIS SPORTIFS
  {
    patterns: [
      /(?:paris?|pari|bet|mise).*(?:sportif|foot|match|résultat)/i,
      /(?:suivi|historique|bilan).*(?:paris?|bets?|mises?)/i
    ],
    tools: ["query_bets_tracker"],
    priority: 9
  },
  
  // RÉSUMÉ QUOTIDIEN
  {
    patterns: [
      /(?:résumé|récap|bilan).*(?:journée|jour|quotidien)/i,
      /(?:qu'est-ce qui s'est passé|quoi de neuf)/i,
      /(?:brief|briefing|morning brief)/i
    ],
    tools: ["query_daily_summary"],
    priority: 8
  },
  
  // MONITORING
  {
    patterns: [
      /(?:monitoring|surveillance|uptime).*(?:site|serveur|service)/i,
      /(?:site|serveur|service).*(?:monitoring|en ligne|down|up)/i
    ],
    tools: ["monitoring_manage"],
    priority: 8
  },
  
  // VIDEO ANALYSIS
  {
    patterns: [
      /(?:analyse|regarde|décris).*(?:vidéo|video|clip)/i
    ],
    tools: ["analyze_video"],
    priority: 9
  },
  
  // ANALYSE FICHIER
  {
    patterns: [
      /(?:analyse|lis|ouvre|traite).*(?:fichier|document|pdf|image)/i
    ],
    tools: ["analyze_file"],
    priority: 8
  },

  // AI SYSTEM MANAGEMENT
  {
    patterns: [
      /(?:diagnostic|diagnostique|auto-diagnostic|santé système|health check)/i,
      /(?:mode|passe en|switch).*(?:ship|craft|audit)/i,
      /(?:stats?|statistiques?).*(?:utilisation|usage|outils?)/i,
      /(?:patterns?|comportement|habitudes)/i,
      /(?:suggestions? proactives?|propositions?)/i,
      /(?:ton|tes).*(?:performances?|métriques?)/i,
      /(?:introspection|auto-analyse|self-awareness)/i
    ],
    tools: ["manage_ai_system"],
    priority: 8
  },
  {
    patterns: [
      /(?:va|aller|ouvre?|montre|affiche|navigue|bascule|switch).*(?:page|onglet|tab|section|écran|dashboard|devops|sports|finances|emails|projets|brain|insights|réglages|settings|diagnostics)/i,
      /(?:emmène|amène|redirige|envoie).*(?:vers|sur|à)/i,
      /(?:clique|click|appuie|press).*(?:bouton|button|btn)/i,
      /(?:ouvre|open).*(?:modal|popup|dialog)/i,
      /(?:montre|show).*(?:moi|me).*(?:la page|l'onglet|le|les)/i
    ],
    tools: ["app_navigate"],
    priority: 7
  }
];

export function detectActionIntent(message: string): ActionIntent {
  const normalizedMessage = message.toLowerCase().trim();
  
  let bestMatch: { pattern: IntentPattern; confidence: number } | null = null;
  
  for (const intentPattern of ACTION_PATTERNS) {
    for (const pattern of intentPattern.patterns) {
      if (pattern.test(normalizedMessage)) {
        const confidence = intentPattern.priority / 10;
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { pattern: intentPattern, confidence };
        }
      }
    }
  }
  
  if (bestMatch && bestMatch.confidence >= 0.7) {
    console.log(`[ActionIntent] DETECTED: ${bestMatch.pattern.tools.join(', ')} (${Math.round(bestMatch.confidence * 100)}%)`);
    return {
      shouldForceTools: true,
      suggestedTools: bestMatch.pattern.tools,
      confidence: bestMatch.confidence,
      reason: `Action détectée: ${bestMatch.pattern.tools[0]}`
    };
  }
  
  // Détection de verbes d'action génériques
  const actionVerbs = /^(fais|fait|crée|envoie|ajoute|supprime|modifie|change|mets|met|lance|arrête|active|désactive|cherche|trouve|montre|affiche)/i;
  if (actionVerbs.test(normalizedMessage)) {
    console.log(`[ActionIntent] GENERIC ACTION VERB detected, suggesting tools`);
    return {
      shouldForceTools: true,
      suggestedTools: [],
      confidence: 0.6,
      reason: "Verbe d'action détecté"
    };
  }
  
  return {
    shouldForceTools: false,
    suggestedTools: [],
    confidence: 0,
    reason: "Pas d'action détectée"
  };
}

export function shouldForceToolChoice(intent: ActionIntent): "required" | "auto" {
  return intent.shouldForceTools && intent.confidence >= 0.6 ? "required" : "auto";
}

const MAX_TOOLS_PER_CALL = 128;

const CORE_TOOLS = new Set([
  "query_brain", "memory_save", "web_search", "image_search", "news_search", "youtube_search",
  "wikipedia_search", "weather_forecast", "currency_convert", "github_manage",
  "calendar_update_event", "calendar_delete_event", "read_url", "image_generate",
  "calendar_list_events", "calendar_create_event", "email_list_inbox", "email_send",
  "email_read_message", "email_reply", "email_forward",
  "todoist_list_tasks", "todoist_create_task", "todoist_complete_task", "homework_manage",
  "notes_manage", "projects_manage", "tasks_manage",
  "conversations_manage", "traces_query", "security_audit", "superchat_manage",
  "spotify_control", "smarthome_control", "location_get_weather",
  "discord_send_message", "discord_status", "notion_manage", "drive_manage",
  "query_sports_data", "query_match_intelligence", "query_stock_data",
  "query_suguval_history", "sugu_full_overview", "manage_sugu_purchases",
  "manage_sugu_expenses", "manage_sugu_bank", "manage_sugu_employees",
  "search_sugu_data", "compute_business_health", "detect_anomalies",
  "devops_github", "devops_server", "devops_intelligence", "dgm_manage",
  "analyze_file", "generate_file", "pdf_master", "translate_text",
  "commax_manage", "screen_monitor_manage", "navigation_manage",
  "query_coba", "coba_business", "superchat_search", "manage_ai_system",
  "generate_morning_briefing", "monitoring_manage", "push_notify",
  "mars_search", "deep_research", "decision_engine", "decision_coach",
  "trading_analysis", "trading_alerts", "itinerary_plan", "google_maps",
  "agent_mail", "tools_checkup", "generate_report", "brain_context",
  "analyze_invoice", "homework_intelligence", "music_search",
  "sports_watch", "api_football", "value_bets", "sports_prediction",
  "ifttt_trigger", "camera_manage", "run_diagnostics", "health_probe",
  "kpi_dashboard", "self_heal", "autonomous_execute",
  "sentiment_analyze", "behavior_analysis", "anticipation_engine",
  "export_analysis", "generate_invoice_pdf", "export_invoice_excel",
  "query_bets_tracker", "betting_profile",
]);

export function getRelevantTools(intent: ActionIntent, allTools: any[]): any[] {
  // ════════════════════════════════════════════════════════════════════════════
  // STRATÉGIE PRIORITY-ORDER (jamais filter-out):
  // 1. Outils suggérés par l'intent → en TÊTE de liste (le LLM les pondère plus fort)
  // 2. Outils core (haute utilité quotidienne) → ensuite
  // 3. TOUS les autres outils → ensuite, jusqu'à MAX_TOOLS_PER_CALL
  // → Aucun outil n'est jamais "invisible" à cause d'une règle d'intent incomplète.
  // → Le LLM choisit librement, biaisé par l'ordre, jamais bloqué.
  // ════════════════════════════════════════════════════════════════════════════
  const seen = new Set<string>();
  const ordered: any[] = [];
  const pushIfNew = (t: any) => {
    const n = t?.function?.name;
    if (!n || seen.has(n)) return;
    seen.add(n);
    ordered.push(t);
  };

  // Tier 1: outils suggérés par l'intent (priorité max)
  if (intent.suggestedTools.length > 0) {
    const suggestedSet = new Set(intent.suggestedTools);
    for (const t of allTools) {
      if (suggestedSet.has(t?.function?.name)) pushIfNew(t);
    }
  }

  // Tier 2: outils core (toujours présents — fallback safety net)
  for (const t of allTools) {
    if (CORE_TOOLS.has(t?.function?.name)) pushIfNew(t);
  }

  // Tier 3: tout le reste (orphelins, outils rares mais disponibles si besoin)
  for (const t of allTools) pushIfNew(t);

  // Cap à la limite du modèle (OpenAI: 128, Gemini: ~512)
  return ordered.slice(0, MAX_TOOLS_PER_CALL);
}
