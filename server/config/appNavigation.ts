export interface AppTab {
  id: string;
  label: string;
  description: string;
  actions: string[];
}

export interface AppPage {
  path: string;
  pageId: string;
  label: string;
  description: string;
  managedBy: string[];
  tabs?: AppTab[];
}

export const APP_PAGES: AppPage[] = [
  {
    path: "/",
    pageId: "dashboard",
    label: "Dashboard",
    description: "Tableau de bord principal — vue d'ensemble, accès rapide, panels",
    managedBy: ["ulysse"],
    tabs: [
      { id: "history", label: "Historique", description: "Historique des conversations et interactions passées", actions: ["consulter conversations passées", "rechercher un échange"] },
      { id: "memory", label: "Mémoire", description: "Mémoire persistante d'Ulysse — faits mémorisés, préférences", actions: ["consulter la mémoire", "ajouter un souvenir", "supprimer un souvenir"] },
      { id: "diagnostics", label: "Diagnostics", description: "État de santé du système — services, APIs, performances", actions: ["vérifier l'état des services", "lancer un diagnostic"] },
      { id: "files", label: "Fichiers", description: "Gestionnaire de fichiers — documents, images, exports", actions: ["parcourir les fichiers", "uploader", "supprimer"] },
      { id: "studio", label: "Studio", description: "Studio créatif — génération d'images, édition", actions: ["générer une image", "éditer un visuel"] },
      { id: "homework", label: "Devoirs", description: "Gestion des devoirs — tâches planifiées, automatisations", actions: ["voir les devoirs actifs", "créer un devoir", "exécuter un devoir"] },
      { id: "geolocation", label: "Géolocalisation", description: "Position GPS, historique de déplacements", actions: ["voir la position actuelle", "historique GPS"] },
      { id: "email", label: "Email", description: "Lecture et envoi d'emails via Gmail", actions: ["lire les emails", "envoyer un email", "rechercher"] },
      { id: "camera", label: "Caméra", description: "Capture photo/vidéo depuis l'appareil", actions: ["prendre une photo", "analyser une image"] },
      { id: "liveVision", label: "Vision Live", description: "Analyse visuelle en temps réel via la caméra", actions: ["activer la vision live", "analyser ce que je vois"] },
      { id: "integrations", label: "Intégrations", description: "Services connectés — Notion, Todoist, Google, Spotify", actions: ["vérifier les intégrations", "configurer un service"] },
      { id: "codeSnapshot", label: "Code Snapshot", description: "Aperçu du code source du projet Ulysse", actions: ["voir la structure du projet", "analyser le code"] },
    ]
  },
  {
    path: "/superchat",
    pageId: "superchat",
    label: "SuperChat",
    description: "Chat multi-personas — Ulysse, Iris, Alfred discutent ensemble",
    managedBy: ["ulysse", "iris", "alfred"],
  },
  {
    path: "/sports/predictions",
    pageId: "sports",
    label: "Sports & Pronostics",
    description: "Pronostics sportifs, matchs, analyses",
    managedBy: ["ulysse"],
    tabs: [
      { id: "matches", label: "Matchs Big 5", description: "Matchs des 5 grands championnats européens", actions: ["voir les matchs du jour", "détails d'un match"] },
      { id: "predictions", label: "Pronostics", description: "Pronostics IA avec probabilités et cotes", actions: ["voir les pronostics", "analyser un match"] },
      { id: "classement", label: "Classement", description: "Classements des championnats", actions: ["voir le classement d'une ligue"] },
      { id: "buteurs", label: "Buteurs", description: "Classement des buteurs", actions: ["top buteurs d'un championnat"] },
      { id: "blessures", label: "Blessures", description: "Joueurs blessés et suspendus", actions: ["blessés d'une équipe"] },
      { id: "historique", label: "Historique", description: "Historique des pronostics passés et performances", actions: ["taux de réussite", "pronostics passés"] },
    ]
  },
  {
    path: "/finances",
    pageId: "finances",
    label: "Finances",
    description: "Marchés financiers, watchlist, portfolio, crypto",
    managedBy: ["ulysse", "alfred"],
    tabs: [
      { id: "markets", label: "Marchés", description: "Vue d'ensemble des marchés boursiers", actions: ["voir les indices", "tendances du marché"] },
      { id: "watchlist", label: "Watchlist", description: "Actions et actifs suivis", actions: ["voir la watchlist", "ajouter/supprimer un actif"] },
      { id: "detail", label: "Analyse", description: "Analyse technique et fondamentale d'un actif", actions: ["analyser une action", "prédictions"] },
      { id: "portfolio", label: "Portfolio", description: "Portefeuille d'investissement", actions: ["voir le portfolio", "performance"] },
      { id: "crypto", label: "Crypto", description: "Cryptomonnaies — cours, analyses", actions: ["voir les crypto", "analyser Bitcoin/ETH"] },
      { id: "news", label: "News", description: "Actualités financières", actions: ["dernières news marché"] },
    ]
  },
  {
    path: "/brain",
    pageId: "brain",
    label: "Brain Dashboard",
    description: "Système d'apprentissage autonome — domaines, patterns, santé",
    managedBy: ["ulysse"],
    tabs: [
      { id: "domains", label: "Domaines", description: "Domaines de connaissance appris", actions: ["voir les domaines maîtrisés"] },
      { id: "patterns", label: "Top Patterns", description: "Patterns d'usage les plus fréquents", actions: ["analyser les patterns"] },
      { id: "health", label: "Santé", description: "Santé du système d'apprentissage", actions: ["vérifier la santé du brain"] },
    ]
  },
  {
    path: "/traces",
    pageId: "traces",
    label: "Traces",
    description: "Observabilité — traces d'exécution des agents IA",
    managedBy: ["ulysse", "maxai"],
    tabs: [
      { id: "list", label: "Liste", description: "Liste de toutes les traces d'exécution", actions: ["voir les traces récentes", "filtrer par agent"] },
      { id: "stats", label: "Statistiques", description: "Statistiques d'utilisation — latence, tokens, taux de succès", actions: ["voir les stats globales", "comparer les agents"] },
    ]
  },
  {
    path: "/skills",
    pageId: "skills",
    label: "Skills",
    description: "Skills composables — pipelines d'actions automatisées",
    managedBy: ["ulysse", "maxai"],
    tabs: [
      { id: "catalog", label: "Catalogue", description: "Catalogue des skills disponibles", actions: ["voir les skills", "activer/désactiver une skill"] },
      { id: "executions", label: "Exécutions", description: "Historique d'exécution des skills", actions: ["voir les exécutions récentes", "relancer une skill"] },
    ]
  },
  {
    path: "/projects",
    pageId: "projects",
    label: "Projets",
    description: "Gestion de projets — création, suivi, organisation",
    managedBy: ["ulysse"],
  },
  {
    path: "/tasks",
    pageId: "tasks",
    label: "Tâches",
    description: "Gestion des tâches — todo, priorités, deadlines",
    managedBy: ["ulysse"],
  },
  {
    path: "/notes",
    pageId: "notes",
    label: "Notes",
    description: "Notes personnelles — création, recherche, organisation",
    managedBy: ["ulysse"],
  },
  {
    path: "/emails",
    pageId: "emails",
    label: "Emails",
    description: "Client email — lecture, envoi, recherche Gmail",
    managedBy: ["ulysse"],
  },
  {
    path: "/assistant",
    pageId: "assistant",
    label: "Assistant",
    description: "Assistant IA complet avec toutes les capacités",
    managedBy: ["ulysse"],
  },
  {
    path: "/talking",
    pageId: "talking",
    label: "Appel Vocal",
    description: "Conversation vocale avec Ulysse",
    managedBy: ["ulysse"],
  },
  {
    path: "/talking-v2",
    pageId: "talking-v2",
    label: "Appel Vocal V2",
    description: "Conversation vocale V2 améliorée",
    managedBy: ["ulysse"],
  },
  {
    path: "/settings",
    pageId: "settings",
    label: "Réglages",
    description: "Paramètres de l'application — voix, thème, intégrations",
    managedBy: ["ulysse"],
  },
  {
    path: "/diagnostics",
    pageId: "diagnostics",
    label: "Diagnostics",
    description: "Diagnostics système — état de santé, erreurs, performances",
    managedBy: ["ulysse"],
  },
  {
    path: "/ulysse-insights",
    pageId: "insights",
    label: "Ulysse Insights",
    description: "Observabilité dev++ — tests, erreurs, performance, codebase",
    managedBy: ["ulysse", "maxai"],
    tabs: [
      { id: "overview", label: "Vue d'ensemble", description: "Métriques globales du système", actions: ["voir l'état général"] },
      { id: "tests", label: "Tests & Build", description: "État des tests et builds", actions: ["voir les résultats de tests"] },
      { id: "errors", label: "Erreurs", description: "Erreurs récentes et stack traces", actions: ["analyser les erreurs"] },
      { id: "performance", label: "Performance", description: "Métriques de performance", actions: ["analyser les performances"] },
      { id: "usage", label: "Usage", description: "Statistiques d'utilisation", actions: ["voir les stats d'usage"] },
      { id: "codebase", label: "Codebase", description: "Analyse du code source", actions: ["analyser la codebase"] },
      { id: "patches", label: "Patches", description: "Patches et corrections appliquées", actions: ["voir les patches récents"] },
    ]
  },
  {
    path: "/security",
    pageId: "security",
    label: "Sécurité",
    description: "Dashboard de sécurité — monitoring, alertes, audit",
    managedBy: ["ulysse", "maxai"],
  },
  {
    path: "/analytics",
    pageId: "analytics",
    label: "Analytics",
    description: "Tableau de bord unifié — métriques business et système",
    managedBy: ["ulysse", "alfred"],
    tabs: [
      { id: "overview", label: "Aperçu", description: "Vue d'ensemble des métriques", actions: ["voir les métriques globales"] },
      { id: "hubrise", label: "HubRise", description: "Données HubRise restauration", actions: ["voir les commandes", "analyse CA"] },
      { id: "predictions", label: "Prédictions", description: "Prédictions IA", actions: ["voir les prédictions"] },
      { id: "sports", label: "Sports", description: "Métriques sportives", actions: ["stats pronostics"] },
      { id: "system", label: "Système", description: "Métriques système", actions: ["état du système"] },
    ]
  },
  {
    path: "/devops",
    pageId: "devops",
    label: "DevOps",
    description: "Console DevOps standard — GitHub, déploiements, serveurs",
    managedBy: ["ulysse"],
    tabs: [
      { id: "projects", label: "Projets", description: "Projets GitHub", actions: ["voir les projets", "créer un projet"] },
      { id: "branches", label: "Branches", description: "Branches Git", actions: ["voir les branches", "créer/supprimer"] },
      { id: "commits", label: "Commits", description: "Historique des commits", actions: ["voir les commits récents"] },
      { id: "prs", label: "PRs", description: "Pull Requests", actions: ["voir les PRs", "créer/merger"] },
      { id: "cicd", label: "CI/CD", description: "Pipelines CI/CD GitHub Actions", actions: ["voir les workflows", "relancer"] },
      { id: "library", label: "Library", description: "Explorateur de fichiers", actions: ["parcourir les fichiers du repo"] },
      { id: "library-test", label: "Library Test", description: "Explorateur de fichiers staging", actions: ["parcourir le staging"] },
      { id: "preview", label: "Preview", description: "Prévisualisation des URLs déployées", actions: ["voir les previews"] },
      { id: "server", label: "Server", description: "Gestion serveur", actions: ["état du serveur", "restart"] },
      { id: "rollback", label: "Rollback", description: "Retour à une version précédente", actions: ["rollback un commit"] },
    ]
  },
  {
    path: "/devops-iris",
    pageId: "devops-iris",
    label: "DevOps Iris",
    description: "Panneau DevOps pour Iris",
    managedBy: ["iris", "ulysse"],
  },
  {
    path: "/commax",
    pageId: "commax",
    label: "Commax",
    description: "Community Management — réseaux sociaux, posts, analytics",
    managedBy: ["iris"],
    tabs: [
      { id: "overview", label: "Analytics", description: "Statistiques réseaux sociaux", actions: ["voir les stats sociales"] },
      { id: "composer", label: "Iris CM", description: "Rédaction de posts avec Iris", actions: ["rédiger un post", "planifier"] },
      { id: "posts", label: "Posts", description: "Posts publiés et planifiés", actions: ["voir les posts", "modifier"] },
      { id: "inbox", label: "Inbox", description: "Messages et commentaires reçus", actions: ["voir les messages", "répondre"] },
      { id: "accounts", label: "Comptes", description: "Comptes réseaux sociaux connectés", actions: ["gérer les comptes"] },
      { id: "journal", label: "Journal CM", description: "Journal d'activité community management", actions: ["voir l'historique CM"] },
    ]
  },
  {
    path: "/iris",
    pageId: "iris",
    label: "Iris Dashboard",
    description: "Tableau de bord d'Iris — assistant familial et CM",
    managedBy: ["iris"],
  },
  {
    path: "/iris-homework",
    pageId: "iris-homework",
    label: "Devoirs Iris",
    description: "Gestion des devoirs et aide scolaire par Iris",
    managedBy: ["iris"],
  },
  {
    path: "/iris-files",
    pageId: "iris-files",
    label: "Fichiers Iris",
    description: "Documents et fichiers gérés par Iris",
    managedBy: ["iris"],
  },
  {
    path: "/iris-talking",
    pageId: "iris-talking",
    label: "Appel Iris",
    description: "Conversation vocale avec Iris",
    managedBy: ["iris"],
  },
  {
    path: "/suguval",
    pageId: "suguval",
    label: "SUGU Valentine",
    description: "Gestion restaurant SUGU Valentine — achats, comptabilité, RH",
    managedBy: ["alfred", "ulysse"],
  },
  {
    path: "/sugumaillane",
    pageId: "sugumaillane",
    label: "SUGU Maillane",
    description: "Gestion restaurant SUGU Maillane — achats, comptabilité, RH",
    managedBy: ["alfred", "ulysse"],
  },
  {
    path: "/courses/suguval",
    pageId: "suguval-checklist",
    label: "Checklist SUGU Val",
    description: "Checklist de formation SUGU Valentine",
    managedBy: ["alfred"],
  },
  {
    path: "/courses/sugumaillane",
    pageId: "sugumaillane-checklist",
    label: "Checklist SUGU Maillane",
    description: "Checklist de formation SUGU Maillane",
    managedBy: ["alfred"],
  },
  {
    path: "/max",
    pageId: "alfred-app",
    label: "Alfred App",
    description: "Interface Alfred — assistant financier et gestion SUGU",
    managedBy: ["alfred"],
  },
  {
    path: "/devmax",
    pageId: "devmax",
    label: "DevMax",
    description: "Dashboard DevMax — IDE DevOps complet par MaxAI",
    managedBy: ["maxai"],
    tabs: [
      { id: "overview", label: "Aperçu", description: "Vue d'ensemble du projet — branches, commits, CI/CD", actions: ["voir l'état du projet"] },
      { id: "branches", label: "Branches", description: "Gestion des branches Git", actions: ["voir/créer/supprimer branches"] },
      { id: "commits", label: "Commits", description: "Historique des commits", actions: ["voir les commits récents"] },
      { id: "prs", label: "PRs", description: "Pull Requests GitHub", actions: ["voir/créer/merger PRs"] },
      { id: "cicd", label: "CI/CD", description: "Pipelines GitHub Actions", actions: ["voir/relancer workflows"] },
      { id: "files", label: "Fichiers", description: "Explorateur de fichiers du repo", actions: ["parcourir/éditer fichiers"] },
      { id: "files-test", label: "Tests", description: "Explorateur de fichiers staging", actions: ["parcourir le staging"] },
      { id: "rollback", label: "Rollback", description: "Retour à une version précédente", actions: ["rollback un commit"] },
      { id: "deploy", label: "Deploy", description: "Déploiement de l'application", actions: ["déployer", "vérifier URLs"] },
      { id: "preview", label: "Preview", description: "Prévisualisation des URLs", actions: ["ouvrir staging/production"] },
      { id: "dgm", label: "DGM", description: "DevOps Grand Master — pipeline automatisé complet", actions: ["lancer DGM", "voir les tâches"] },
      { id: "github", label: "GitHub", description: "Connexion et configuration GitHub", actions: ["configurer le repo"] },
      { id: "journal", label: "Journal", description: "Journal de projet — actions, décisions, notes", actions: ["voir le journal", "ajouter une entrée"] },
      { id: "envvars", label: "Env Vars", description: "Variables d'environnement du projet", actions: ["voir/modifier env vars"] },
      { id: "logs", label: "Logs", description: "Logs serveur en temps réel", actions: ["voir les logs", "rechercher"] },
      { id: "metrics", label: "Métriques", description: "Métriques de performance du projet", actions: ["voir les métriques"] },
      { id: "domains", label: "Domaines", description: "Gestion des noms de domaine", actions: ["configurer un domaine"] },
      { id: "costs", label: "Coûts", description: "Coûts d'utilisation IA par modèle", actions: ["voir les coûts"] },
      { id: "events", label: "Events", description: "Événements GitHub récents", actions: ["voir les events"] },
      { id: "health", label: "Health", description: "Health checks des URLs déployées", actions: ["vérifier la santé"] },
      { id: "secrets", label: "Secrets", description: "Gestionnaire de secrets sécurisés", actions: ["gérer les secrets"] },
      { id: "deploy-history", label: "Historique", description: "Historique des déploiements", actions: ["voir l'historique deploy"] },
      { id: "notifications", label: "Notifs", description: "Notifications DevMax", actions: ["voir les notifications"] },
      { id: "plan", label: "Plan", description: "Plan et facturation DevMax", actions: ["voir le plan"] },
      { id: "skills", label: "Skills", description: "Skills IA composables — pipelines automatisés", actions: ["voir/exécuter skills"] },
      { id: "traces", label: "Traces", description: "Traces d'exécution des agents IA", actions: ["voir les traces", "filtrer"] },
      { id: "chat", label: "MaxAI", description: "Chat avec MaxAI — assistant DevOps", actions: ["discuter avec MaxAI"] },
      { id: "account", label: "Compte", description: "Mon compte DevMax", actions: ["voir/modifier mon profil"] },
    ]
  },
  {
    path: "/screen-monitor",
    pageId: "screen-monitor",
    label: "Screen Monitor",
    description: "Monitoring d'écran en temps réel",
    managedBy: ["ulysse"],
  },
];

export function getPagesForAgent(agent: string): AppPage[] {
  return APP_PAGES.filter(p => p.managedBy.includes(agent));
}

export function getPageByPath(path: string): AppPage | undefined {
  return APP_PAGES.find(p => p.path === path);
}

export function getPageById(pageId: string): AppPage | undefined {
  return APP_PAGES.find(p => p.pageId === pageId);
}

export function buildNavigationContext(agent: string, activePageId?: string, activeTabId?: string): string {
  const pages = getPagesForAgent(agent);
  if (pages.length === 0) return "";

  const lines: string[] = [];
  lines.push(`[ENVIRONNEMENT APP — Pages gérées par ${agent}]`);

  for (const page of pages) {
    const isActivePage = page.pageId === activePageId;
    const prefix = isActivePage ? "📍" : "•";
    lines.push(`${prefix} ${page.label} (${page.path}) — ${page.description}`);

    if (page.tabs && page.tabs.length > 0) {
      for (const tab of page.tabs) {
        const isActiveTab = isActivePage && tab.id === activeTabId;
        const tabPrefix = isActiveTab ? "  ➤" : "  ◦";
        if (isActiveTab) {
          lines.push(`${tabPrefix} [ACTIF] ${tab.label} — ${tab.description}`);
          lines.push(`    Actions: ${tab.actions.join(", ")}`);
        } else {
          lines.push(`${tabPrefix} ${tab.label} — ${tab.description}`);
        }
      }
    }
  }

  if (activePageId) {
    const activePage = pages.find(p => p.pageId === activePageId);
    if (activePage) {
      lines.push(`\n[CONTEXTE ACTIF] L'utilisateur est sur "${activePage.label}" (${activePage.path}).`);
      if (activeTabId && activePage.tabs) {
        const activeTab = activePage.tabs.find(t => t.id === activeTabId);
        if (activeTab) {
          lines.push(`Onglet actif: "${activeTab.label}" — ${activeTab.description}`);
          lines.push(`Tu dois adapter ta réponse à ce contexte. Actions pertinentes: ${activeTab.actions.join(", ")}.`);
        }
      }
    }
  }

  return lines.join("\n");
}
