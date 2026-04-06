import OpenAI from "openai";

type ChatCompletionTool = OpenAI.Chat.Completions.ChatCompletionTool;

// ─── Helper: dynamic service loader ────────────────────────────────────────
async function loadService(serviceName: string): Promise<any> {
    try {
        switch (serviceName) {
            case 'calendar':
                return (await import("../calendarActionService")).calendarActionService;
            case 'agentMail':
                return (await import("../agentMailService")).agentMailService;
            case 'spotify':
                return (await import("../spotifyActionService")).spotifyActionService;
            default:
                return null;
        }
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.log(`[CommunicationTools] Service ${serviceName} not available: ${msg}`);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool Definitions (9 tools)
// ═══════════════════════════════════════════════════════════════════════════

export const communicationToolDefs: ChatCompletionTool[] = [
    // === CALENDAR TOOLS ===
    {
        type: "function",
        function: {
            name: "calendar_list_events",
            description: "Liste les événements du calendrier Google pour une période donnée.",
            parameters: {
                type: "object",
                properties: {
                    days_ahead: { type: "number", description: "Nombre de jours à consulter (défaut: 7)" },
                    max_results: { type: "number", description: "Nombre max d'événements (défaut: 10)" }
                }
            }
        }
    },
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

    // === EMAIL TOOLS ===
    {
        type: "function",
        function: {
            name: "email_list_inbox",
            description: "Liste les emails récents de la boîte AgentMail.",
            parameters: {
                type: "object",
                properties: {
                    inbox: { type: "string", enum: ["ulysse", "iris", "alfred"], description: "Boîte à consulter" },
                    limit: { type: "number", description: "Nombre d'emails (défaut: 10)" },
                    unread_only: { type: "boolean", description: "Seulement les non-lus" }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "email_send",
            description: "Envoie un email. Ulysse envoie via Gmail (ulyssemdbh@gmail.com). Alfred et Iris envoient via AgentMail. EXÉCUTE IMMÉDIATEMENT sans demander confirmation.",
            parameters: {
                type: "object",
                properties: {
                    to: { type: "string", description: "Adresse email destinataire" },
                    subject: { type: "string" },
                    body: { type: "string", description: "Corps du message (HTML supporté)" },
                    from_inbox: { type: "string", enum: ["ulysse", "iris", "alfred"] },
                    attachments: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                file_name: { type: "string", description: "Nom du fichier généré (ex: Export_Zouaghi_2025-01-14.xlsx)" }
                            },
                            required: ["file_name"]
                        },
                        description: "Fichiers à attacher (générés via export_invoice_excel ou generate_file)"
                    }
                },
                required: ["to", "subject", "body"]
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

    // === TASK QUEUE (sequential work pipeline) ===
    {
        type: "function",
        function: {
            name: "task_queue_manage",
            description: "Gère la file d'attente de tâches d'Ulysse. Permet de créer une liste de tâches à exécuter séquentiellement, suivre l'avancement, mettre en pause ou consulter l'état. Utilise cette fonction quand l'utilisateur demande plusieurs choses à faire, ou quand tu détermines toi-même une série d'actions à accomplir.",
            parameters: {
                type: "object",
                properties: {
                    action: { 
                        type: "string", 
                        enum: ["create", "start", "pause", "status", "list"],
                        description: "Action: create (créer une queue), start (lancer l'exécution), pause (mettre en pause), status (état d'une queue), list (lister les queues récentes)"
                    },
                    title: { type: "string", description: "Titre de la queue (pour create)" },
                    items: {
                        type: "array",
                        description: "Liste des tâches à ajouter (pour create). Chaque item a un title, description optionnelle, et optionnellement toolName + toolArgs pour exécution automatique.",
                        items: {
                            type: "object",
                            properties: {
                                title: { type: "string", description: "Titre de la tâche" },
                                description: { type: "string", description: "Description détaillée" },
                                toolName: { type: "string", description: "Nom de l'outil à utiliser (ex: devops_github, web_search, send_email)" },
                                toolArgs: { type: "object", description: "Arguments pour l'outil" }
                            },
                            required: ["title"]
                        }
                    },
                    queueId: { type: "number", description: "ID de la queue (pour start, pause, status)" },
                    autoStart: { type: "boolean", description: "Démarrer automatiquement après création (défaut: true)" },
                    delayBetweenItemsMs: { type: "number", description: "Délai en millisecondes entre chaque tâche. Ex: 600000 = 10 minutes. Utilise pour les audits progressifs ou tâches espacées dans le temps." },
                    source: { type: "string", description: "Source de la queue: 'chat', 'devops', 'audit'. Défaut: 'chat'" }
                },
                required: ["action"]
            }
        }
    },

    // === WORK JOURNAL (Ulysse's operational work log) ===
    {
        type: "function",
        function: {
            name: "work_journal_manage",
            description: "Journal de travail d'Ulysse. Tu DOIS utiliser cet outil pour: (1) noter chaque demande de Maurice, (2) tracker tes actions et résultats, (3) écrire tes réflexions/stratégies, (4) checker/unchequer les tâches terminées. C'est ta mémoire opérationnelle — tu es autonome et proactif dans sa gestion.",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["add", "update", "check", "uncheck", "list", "status", "delete"],
                        description: "add: nouvelle entrée | update: modifier une entrée | check: marquer comme terminé | uncheck: réouvrir | list: voir les entrées | status: stats du journal | delete: supprimer"
                    },
                    title: { type: "string", description: "Titre de l'entrée (pour add)" },
                    content: { type: "string", description: "Description détaillée, stratégie, réflexion (pour add/update)" },
                    entryType: {
                        type: "string",
                        enum: ["task", "reflection", "strategy", "note", "request"],
                        description: "Type: task (tâche à faire), request (demande de Maurice), reflection (pensée/analyse), strategy (plan d'action), note (info libre)"
                    },
                    context: {
                        type: "string",
                        enum: ["general", "devops", "sugu", "football", "finance"],
                        description: "Contexte de travail. Défaut: general"
                    },
                    priority: {
                        type: "string",
                        enum: ["critical", "high", "normal", "low"],
                        description: "Priorité. Défaut: normal"
                    },
                    entryId: { type: "number", description: "ID de l'entrée (pour update/check/uncheck/delete)" },
                    outcome: { type: "string", description: "Résultat/conclusion du travail (pour check/update)" },
                    relatedFiles: {
                        type: "array",
                        items: { type: "string" },
                        description: "Fichiers concernés (chemins relatifs)"
                    },
                    tags: {
                        type: "array",
                        items: { type: "string" },
                        description: "Tags libres pour grouper (ex: 'bug', 'feature', 'urgent', 'audit')"
                    },
                    status: { type: "string", description: "Pour list: filtrer par status (pending/in_progress/done/blocked). Pour update: nouveau status." },
                    includeCompleted: { type: "boolean", description: "Pour list: inclure les tâches terminées (défaut: false)" }
                },
                required: ["action"]
            }
        }
    },
    // === DEVOPS INTELLIGENCE ENGINE (4 algos sur mesure) ===
    {
        type: "function",
        function: {
            name: "devops_intelligence",
            description: "Moteur d'intelligence DevOps d'Ulysse — 4 algorithmes: (1) BRAIN_IMPACT_MAP: graphe de dépendances enrichi (fichier → domaines), (2) ULYSSE_CI_ORACLE: scoring de risque 0-100 par changement, (3) AUTO_PATCH_ADVISOR: génération + ranking de patchs (3 niveaux), (4) HOMEWORK_BRAIN_PLANNER: auto-apprentissage depuis les échecs/lacunes. Utilitaires fragility: fragility_leaderboard (top fichiers fragiles), fragility_check (score d'un fichier), record_event (enregistrer un événement), report_bug (signaler un bug sur des fichiers), dynamic_fragility (apprentissage dynamique depuis historique bugs/reverts/hotfix).",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["impact_map", "analyze_impact", "ci_risk", "patch_advice", "learning_gaps", "full_report", "code_review", "fragility_leaderboard", "fragility_check", "record_event", "report_bug", "pr_analyze", "commit_analyze", "domain_health", "diagnose_incident", "smart_alerts", "process_bug"],
                        description: "Algos: impact_map, analyze_impact, ci_risk, patch_advice, learning_gaps, full_report, code_review | Fragilité: fragility_leaderboard, fragility_check, record_event, report_bug | Axe 1+2: pr_analyze (analyse PR + commentaire auto), commit_analyze (analyse commit), domain_health (santé par domaine) | Axe 3: process_bug (boucle complète bug→gap→homework) | Axe 4: diagnose_incident (corrélation incident), smart_alerts (alertes intelligentes)"
                    },
                    files: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                path: { type: "string" },
                                content: { type: "string" }
                            }
                        },
                        description: "Fichiers à analyser (pour impact_map/analyze_impact). [{path, content?}]"
                    },
                    changes: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                file: { type: "string" },
                                linesAdded: { type: "number" },
                                linesRemoved: { type: "number" },
                                changeType: { type: "string", enum: ["create", "modify", "delete"] }
                            }
                        },
                        description: "Changements à évaluer (pour ci_risk/full_report)"
                    },
                    problem: { type: "string", description: "Description du problème (pour patch_advice)" },
                    affected_files: {
                        type: "array",
                        items: { type: "string" },
                        description: "Fichiers affectés par le problème (pour patch_advice)"
                    },
                    bug_type: {
                        type: "string",
                        enum: ["performance", "bug", "security", "refactor", "feature"],
                        description: "Type de problème (pour patch_advice)"
                    },
                    file_path: { type: "string", description: "Chemin du fichier (pour fragility_check)" },
                    events: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                filePath: { type: "string" },
                                eventType: { type: "string", enum: ["commit", "patch", "review", "revert", "hotfix", "bug_report"] },
                                eventResult: { type: "string", enum: ["success", "bug", "revert", "hotfix", "failure"] },
                                commitSha: { type: "string" },
                                description: { type: "string" }
                            }
                        },
                        description: "Événements à enregistrer (pour record_event)"
                    },
                    description: { type: "string", description: "Description du bug/événement (pour report_bug)" },
                    commit_sha: { type: "string", description: "SHA du commit lié au bug (pour report_bug)" },
                    limit: { type: "number", description: "Nombre max de résultats (pour fragility_leaderboard, défaut 20)" }
                },
                required: ["action"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "dgm_manage",
            description: "DGM V2 — Dev God Mode ultra-performant. Actions: create_tasks, start_task, complete_task, test_task, fail_task, status | decompose_objective (décomposition IA + groupes parallèles) | run_pipeline (pipeline individuel avec métriques) | run_parallel_pipeline (exécution parallèle de tâches indépendantes) | get_independent_tasks (tâches prêtes pour parallélisation) | pipeline_report (rapport V2 avec timing par stage) | next_task | clear_cache | circuit_status. V2: cache fichiers, circuit breaker, retry avec feedback, fetch parallèle, batch DB writes.",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["create_tasks", "start_task", "complete_task", "test_task", "fail_task", "status", "decompose_objective", "run_pipeline", "run_parallel_pipeline", "get_independent_tasks", "pipeline_report", "next_task", "clear_cache", "circuit_status"],
                        description: "Action DGM V2"
                    },
                    objective: { type: "string", description: "Pour decompose_objective: l'objectif haut niveau à décomposer en tâches" },
                    tasks: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                title: { type: "string" },
                                description: { type: "string" },
                                testCriteria: { type: "string" }
                            }
                        },
                        description: "Pour create_tasks: [{title, description, testCriteria}]"
                    },
                    taskId: { type: "number", description: "ID de la tâche (run_pipeline)" },
                    taskIds: {
                        type: "array",
                        items: { type: "number" },
                        description: "Pour run_parallel_pipeline: IDs des tâches à exécuter en parallèle"
                    },
                    files: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                path: { type: "string" },
                                content: { type: "string" }
                            }
                        },
                        description: "Pour run_pipeline: fichiers du patch [{path, content}]"
                    },
                    message: { type: "string", description: "Message de commit pour le pipeline" },
                    owner: { type: "string", description: "Owner GitHub (défaut: déduit du repo context)" },
                    repo: { type: "string", description: "Nom du repo (défaut: déduit du repo context)" },
                    branch: { type: "string", description: "Branche cible (défaut: main)" },
                    autoMerge: { type: "boolean", description: "Auto-merge la PR après review (défaut: true)" },
                    autoDeploy: { type: "boolean", description: "Auto-deploy sur Hetzner après merge (défaut: false)" },
                    appName: { type: "string", description: "Nom de l'app sur Hetzner pour auto-deploy" },
                    requireApproval: { type: "array", items: { type: "string" }, description: "Étapes nécessitant approbation manuelle" },
                    testResult: { type: "string", description: "Résultat du test (pour test_task)" },
                    codeChanges: { type: "array", items: { type: "string" }, description: "Fichiers modifiés" },
                    error: { type: "string", description: "Message d'erreur (pour fail_task)" },
                    sessionId: { type: "number", description: "Pour pipeline_report: ID de session spécifique" },
                    repo_context: { type: "string", description: "Contexte repo (owner/repo)" }
                },
                required: ["action"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "devmax_db",
            description: `Accès DB complet et dédié pour DevMax/MaxAI. Tables: devmax_projects, devmax_sessions, devmax_activity_log, dgm_sessions, dgm_tasks, dgm_pipeline_runs, devmax_chat_history, devmax_project_journal. MaxAI a un accès 24/7 à sa DB.
EXEMPLES D'APPELS :
• INSERT journal: {action:"insert", table:"devmax_project_journal", data:{project_id:"xxx", entry_type:"note", title:"Mon titre", description:"Description"}}
• INSERT activity: {action:"insert", table:"devmax_activity_log", data:{session_id:"xxx", action:"read_file", target:"README.md", details:{content:"..."}}}
• QUERY: {action:"query", sql:"SELECT * FROM devmax_project_journal WHERE project_id='xxx' ORDER BY created_at DESC LIMIT 10"}
• STATS: {action:"stats"}
• PROJECT_SUMMARY: {action:"project_summary", projectId:"xxx"}
IMPORTANT: Pour insert, TOUJOURS fournir table (string) ET data (objet JSON avec les colonnes). Les colonnes NOT NULL sont: project_id + entry_type + title (journal), session_id + action (activity_log).`,
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["query", "insert", "update", "delete", "stats", "project_summary"],
                        description: "query: SELECT SQL libre sur les tables DevMax | insert: insérer des données | update: modifier des données | delete: supprimer | stats: vue d'ensemble de toutes les tables | project_summary: résumé complet d'un projet"
                    },
                    table: {
                        type: "string",
                        enum: ["devmax_projects", "devmax_sessions", "devmax_activity_log", "dgm_sessions", "dgm_tasks", "dgm_pipeline_runs", "devmax_chat_history", "devmax_project_journal"],
                        description: "Table cible (pour insert/update/delete)"
                    },
                    sql: { type: "string", description: "Requête SQL SELECT (pour action query). Limitée aux tables DevMax/DGM uniquement." },
                    data: { type: "object", description: "Données à insérer ou mettre à jour (clé=colonne, valeur=valeur)" },
                    where: { type: "object", description: "Conditions WHERE (clé=colonne, valeur=valeur) pour update/delete" },
                    projectId: { type: "string", description: "ID du projet (pour project_summary)" },
                    limit: { type: "number", description: "Nombre max de résultats (défaut: 50)" }
                },
                required: ["action"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "dashboard_screenshot",
            description: "Prend un vrai screenshot visuel du dashboard Ulysse tel que Maurice le voit dans son navigateur, puis l'analyse avec la vision IA. Actions: 'take' (déclencher la capture + analyse), 'get_latest' (récupérer la dernière analyse). Utilise cette fonction quand Maurice demande 'regarde mon écran', 'qu'est-ce que tu vois', 'prends un screenshot', 'analyse mon dashboard', etc.",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["take", "get_latest"],
                        description: "'take' pour capturer un nouveau screenshot, 'get_latest' pour la dernière analyse"
                    }
                },
                required: ["action"]
            }
        }
    },
];

// ═══════════════════════════════════════════════════════════════════════════
// Handler Implementations
// ═══════════════════════════════════════════════════════════════════════════

// ── Calendar ────────────────────────────────────────────────────────────────

export async function executeCalendarList(args: { days_ahead?: number; max_results?: number }, userId: number): Promise<string> {
    const calendarService = await loadService('calendar');
    if (!calendarService) {
        return JSON.stringify({ error: "Service Calendrier non disponible. Configurez Google Calendar." });
    }

    const { days_ahead = 7, max_results = 10 } = args;
    try {
        const events = await calendarService.getUpcomingEvents(max_results, days_ahead);
        return JSON.stringify({
            type: 'calendar_events',
            count: events.length,
            events: events.map((e: any) => ({
                title: e.summary,
                start: e.start?.dateTime || e.start?.date,
                end: e.end?.dateTime || e.end?.date,
                location: e.location
            }))
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
    }
}

export async function executeCalendarCreate(args: { title: string; start_datetime: string; end_datetime?: string; description?: string; location?: string }, userId: number): Promise<string> {
    const calendarService = await loadService('calendar');
    if (!calendarService) {
        return JSON.stringify({ error: "Service Calendrier non disponible. Configurez Google Calendar." });
    }

    const { title, start_datetime, end_datetime, description, location } = args;
    try {
        const endTime = end_datetime || new Date(new Date(start_datetime).getTime() + 3600000).toISOString();
        const event = await calendarService.createEvent({
            summary: title,
            description,
            location,
            start: { dateTime: start_datetime },
            end: { dateTime: endTime }
        });
        return JSON.stringify({ type: 'event_created', success: true, event: { id: event.id, title: event.summary, link: event.htmlLink } });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
    }
}

// ── Gmail (boîte de l'owner) ─────────────────────────────────────────────────

export async function executeGmailList(args: { limit?: number; query?: string }): Promise<string> {
    try {
        const { googleMailService } = await import('../googleMailService');
        const connected = await googleMailService.isConnected();
        if (!connected) return JSON.stringify({ error: "Gmail non connecté" });

        const messages = await googleMailService.listMessages({
            maxResults: args.limit || 10,
            query: args.query || 'in:inbox'
        });

        return JSON.stringify({
            type: 'gmail_list',
            count: messages.length,
            messages: messages.map(m => ({
                id: m.id,
                from: m.from,
                subject: m.subject,
                date: m.date,
                snippet: m.snippet,
                unread: m.unread
            }))
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
    }
}

export async function executeGmailRead(args: { message_id: string }): Promise<string> {
    try {
        const { googleMailService } = await import('../googleMailService');
        const msg = await googleMailService.getMessage(args.message_id);
        return JSON.stringify({ type: 'gmail_message', ...msg });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
    }
}

// ── Email ───────────────────────────────────────────────────────────────────

export async function executeEmailList(args: { inbox?: string; limit?: number; unread_only?: boolean }): Promise<string> {
    const agentMailService = await loadService('agentMail');
    if (!agentMailService) {
        return JSON.stringify({ error: "Service Email non disponible" });
    }

    const { inbox = 'ulysse', limit = 10 } = args;
    const persona = (inbox === 'iris' || inbox === 'alfred') ? inbox : 'ulysse';
    try {
        const threads = await agentMailService.listThreads(limit, persona);
        return JSON.stringify({
            type: 'email_list',
            inbox: persona,
            count: threads.length,
            emails: threads.map((t: any) => ({
                id: t.id,
                from: Array.isArray(t.senders) ? (t.senders[0]?.email || t.senders[0] || '') : '',
                subject: t.subject,
                date: t.timestamp,
                preview: t.preview,
                messageCount: t.messageCount
            }))
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
    }
}

export async function executeEmailSend(args: {
    to: string;
    subject: string;
    body: string;
    from_inbox?: string;
    attachments?: Array<{ file_name: string }>;
}): Promise<string> {
    const agentMailService = await loadService('agentMail');
    if (!agentMailService) {
        return JSON.stringify({ error: "Service Email non disponible" });
    }

    const { to, subject, body, from_inbox = 'ulysse', attachments } = args;

    try {
        // Build attachments from generated files
        const emailAttachments: Array<{ filename: string; content: string | Buffer; contentType: string }> = [];

        if (attachments && attachments.length > 0) {
            const { getGeneratedFilesFromRegistry } = await import("../universalFileGenerator");
            const fs = await import("fs");
            const path = await import("path");
            const generatedFiles = getGeneratedFilesFromRegistry();

            for (const att of attachments) {
                const fileName = att.file_name;
                console.log(`[EmailSend] Looking for attachment: ${fileName}`);

                // Search in generated files registry
                const fileInfo = generatedFiles.find(f => f.fileName === fileName || f.fileName.includes(fileName));

                if (fileInfo && fs.existsSync(fileInfo.filePath)) {
                    const content = fs.readFileSync(fileInfo.filePath);
                    const ext = path.extname(fileName).toLowerCase();
                    const contentType =
                        ext === '.xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' :
                            ext === '.pdf' ? 'application/pdf' :
                                ext === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
                                    ext === '.csv' ? 'text/csv' :
                                        ext === '.json' ? 'application/json' :
                                            'application/octet-stream';

                    emailAttachments.push({
                        filename: fileName.endsWith(ext) ? fileName : `${fileName}${ext}`,
                        content,
                        contentType
                    });
                    console.log(`[EmailSend] ✅ Attached: ${fileName} (${content.length} bytes)`);
                } else {
                    // Try direct path in generated_files folder
                    const directPath = path.join(process.cwd(), 'generated_files', fileName);
                    if (fs.existsSync(directPath)) {
                        const content = fs.readFileSync(directPath);
                        const ext = path.extname(fileName).toLowerCase();
                        const contentType =
                            ext === '.xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' :
                                ext === '.pdf' ? 'application/pdf' :
                                    'application/octet-stream';

                        emailAttachments.push({
                            filename: fileName,
                            content,
                            contentType
                        });
                        console.log(`[EmailSend] ✅ Attached from direct path: ${fileName}`);
                    } else {
                        console.warn(`[EmailSend] ⚠️ File not found: ${fileName}`);
                    }
                }
            }
        }

        let result: any;
        if (from_inbox === 'ulysse' || !from_inbox) {
            const { googleMailService } = await import("../googleMailService");
            const connected = await googleMailService.isConnected();
            if (!connected) {
                return JSON.stringify({ error: "Gmail non connecté. Reconnecte l'intégration Google Mail." });
            }
            const gmailAtts = emailAttachments.map(a => ({
                filename: a.filename,
                content: a.content as Buffer,
                contentType: a.contentType
            }));
            result = await googleMailService.sendWithAttachment({
                to, subject, body,
                attachments: gmailAtts.length > 0 ? gmailAtts : undefined
            });
            console.log(`[EmailSend] Ulysse → Gmail → ${to}`);
        } else {
            if (!agentMailService) {
                return JSON.stringify({ error: "AgentMail non disponible" });
            }
            result = await agentMailService.sendEmail({
                to,
                subject,
                body,
                attachments: emailAttachments.length > 0 ? emailAttachments : undefined
            });
            console.log(`[EmailSend] ${from_inbox} → AgentMail → ${to}`);
        }

        return JSON.stringify({
            type: 'email_sent',
            success: true,
            messageId: result.id || result.messageId,
            via: (from_inbox === 'ulysse' || !from_inbox) ? 'gmail' : 'agentmail',
            attachmentsSent: emailAttachments.length
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
    }
}

// ── Spotify ─────────────────────────────────────────────────────────────────

export async function executeSpotifyControl(args: { action: string; query?: string; track_uri?: string; volume?: number; device_id?: string }, userId: number): Promise<string> {
    const spotifyService = await loadService('spotify');
    if (!spotifyService) {
        return JSON.stringify({ error: "Service Spotify non disponible. Connectez Spotify." });
    }

    try {
        switch (args.action) {
            case 'play':
                return JSON.stringify({ type: 'spotify', action: 'play', success: await spotifyService.play() });
            case 'pause':
                return JSON.stringify({ type: 'spotify', action: 'pause', success: await spotifyService.pause() });
            case 'next':
                return JSON.stringify({ type: 'spotify', action: 'next', success: await spotifyService.next() });
            case 'previous':
                return JSON.stringify({ type: 'spotify', action: 'previous', success: await spotifyService.previous() });
            case 'volume':
                return JSON.stringify({ type: 'spotify', action: 'volume', success: await spotifyService.setVolume(args.volume || 50) });
            case 'search': {
                if (!args.query) return JSON.stringify({ error: "query requis" });
                const results = await spotifyService.search(args.query);
                return JSON.stringify({ type: 'spotify_search', results: results.tracks?.items?.slice(0, 5) });
            }
            case 'devices': {
                const devices = await spotifyService.getDevices();
                return JSON.stringify({ type: 'spotify_devices', devices });
            }
            case 'playback_status': {
                const status = await spotifyService.getPlaybackState();
                return JSON.stringify({ type: 'spotify_status', ...status });
            }
            case 'play_track': {
                if (!args.track_uri) return JSON.stringify({ error: "track_uri requis" });
                const success = await spotifyService.playTrack(args.track_uri, args.device_id);
                return JSON.stringify({ type: 'spotify_play_track', success });
            }
            default:
                return JSON.stringify({ error: `Action Spotify inconnue: ${args.action}` });
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
    }
}

// ── Todoist ─────────────────────────────────────────────────────────────────

export async function executeTodoistCreateTask(args: { content: string; description?: string; due_string?: string; priority?: number; project_name?: string }, userId: number): Promise<string> {
    try {
        const todoistService = await import("../todoistService");

        // Priority mapping: API uses 1-4 where 4=urgent, we present same to AI
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
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[Todoist] Error creating task:", msg);
        return JSON.stringify({ success: false, error: msg });
    }
}

export async function executeTodoistListTasks(args: { filter?: string; project_name?: string }): Promise<string> {
    try {
        const todoistService = await import("../todoistService");
        const filter = args.filter || "today";

        let tasks: any[] = [];
        if (filter === "today") {
            tasks = await todoistService.getTasksDueToday();
        } else if (filter === "overdue") {
            tasks = await todoistService.getOverdueTasks();
        } else {
            tasks = await todoistService.getTasks(args.project_name);
        }

        const formattedTasks = tasks.map((t: any) => ({
            id: t.id,
            content: t.content,
            due: t.due?.string || "Pas d'échéance",
            priority: t.priority
        }));
        return JSON.stringify({ success: true, filter, tasks: formattedTasks, count: formattedTasks.length });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return JSON.stringify({ success: false, error: msg });
    }
}

export async function executeTodoistCompleteTask(args: { task_name: string }): Promise<string> {
    try {
        const todoistService = await import("../todoistService");

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
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return JSON.stringify({ success: false, error: msg });
    }
}

// ── Kanban ───────────────────────────────────────────────────────────────────

export async function executeKanbanCreateTask(args: { title: string; description?: string; priority?: string; project_id?: number }, userId: number): Promise<string> {
    try {
        const { db } = await import("../../db");
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
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[Kanban] Error creating task:", msg);
        return JSON.stringify({ success: false, error: msg });
    }
}
