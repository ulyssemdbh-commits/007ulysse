import OpenAI from "openai";

type ChatCompletionTool = OpenAI.Chat.Completions.ChatCompletionTool;

import { analyticsToolDefs, executeBetsTrackerQuery, executeSuguAnalyticsQuery, executeDailySummaryQuery } from "./tools/analyticsTools";
import { integrationToolDefs, executeNotionManage, executeDriveManage, executeTradingAlerts, executeNavigationManage, executeVideoAnalysis, executeMonitoringManage } from "./tools/integrationTools";
import { utilityToolDefs, executeSuguBankManagement, executeSuguFilesManagement, executeSuguFullOverview, executeBusinessHealth, executeDetectAnomalies, executeQueryHubrise, executeManageFeatureFlags, executeSearchNearbyPlaces, executeGeocodeAddress, executeSuguPurchasesManagement, executeSuguExpensesManagement, executeSearchSuguData, executeSuguEmployeesManagement, executeSuguPayrollManagement, executeQueryAppData, executeQueryAppToOrder, executeQueryCoba, executeCobaBusinessTool, executeSensoryHub, executeGenerateSelfReflection, executeManageAISystem, executeAppNavigate, executeDevopsGithub, executeDevopsServer } from "./tools/utilityTools";
import { communicationToolDefs } from "./tools/communicationTools";
import { commaxToolDefs, executeCommaxManage } from "./tools/commaxTools";
import { screenMonitorToolDefs, executeScreenMonitorManage } from "./tools/screenMonitorTools";

export const ulysseToolsV2: ChatCompletionTool[] = [
  // === DATA TOOLS (lecture de données) ===
  {
    type: "function",
    function: {
      name: "query_suguval_history",
      description: "Consulte l'historique des achats Suguval ou Sugumaillane.",
      parameters: {
        type: "object",
        properties: {
          restaurant: { type: "string", enum: ["suguval", "sugumaillane"] },
          action: { type: "string", enum: ["history", "top_products", "current_list"] },
          limit: { type: "number" }
        },
        required: ["restaurant", "action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_suguval_checklist",
      description: "Lit la checklist Suguval du jour avec les articles cochés, catégories et zones. TOUJOURS utiliser cet outil AVANT de parler de la liste de courses — ne jamais inventer de liste. Retourne les vrais articles cochés dans la base de données.",
      parameters: {
        type: "object",
        properties: {
          restaurant: { type: "string", enum: ["suguval", "sugumaillane"], description: "Restaurant cible (défaut: suguval)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "send_suguval_shopping_list",
      description: "Envoie la liste de courses Suguval/Sugumaillane par email avec un formatage professionnel. Lit les articles cochés du jour et envoie un email propre et lisible groupé par zone et catégorie. Destination par défaut: djedoumaurice@gmail.com.",
      parameters: {
        type: "object",
        properties: {
          restaurant: { type: "string", enum: ["suguval", "sugumaillane"], description: "Restaurant cible (défaut: suguval)" },
          to: { type: "string", description: "Email destinataire (défaut: djedoumaurice@gmail.com)" },
          includeStats: { type: "boolean", description: "Inclure les stats hebdo dans l'email (défaut: true)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "query_sports_data",
      description: "Récupère données sportives du système Djedou Pronos: matchs, cotes, classements, prédictions intelligence-enhanced. Dashboard complet sur /sports/predictions avec 5 onglets (Matchs, Pronos, Classements, Buteurs, Blessures). Couvre Big 5 + 20 ligues européennes. 'next_match' = prochain match, 'recent_score' = dernier score, 'team_info' = les deux, 'predictions' = analyse Poisson+Cotes+Intelligence.",
      parameters: {
        type: "object",
        properties: {
          query_type: { type: "string", enum: ["today_matches", "upcoming_matches", "next_match", "recent_score", "team_info", "team_stats", "odds", "predictions", "dashboard_info"] },
          league: { type: "string", description: "Nom de la ligue (Ligue 1, Premier League, La Liga, Bundesliga, Serie A, Champions League, Europa League, etc.)" },
          team: { type: "string", description: "Nom de l'équipe ou alias (OM, Marseille, PSG, Lyon, Lens, Monaco, Real Madrid, Barça, Man City, Liverpool, Arsenal, Juve, Bayern, BVB, etc.)" },
          date: { type: "string", description: "Date au format YYYY-MM-DD" }
        },
        required: ["query_type"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "query_match_intelligence",
      description: "Analyse approfondie d'un match: blessures des 2 équipes, compositions probables, prédiction API Football, buteurs de la ligue. Utilise fixtureId pour un match spécifique ou teamId/leagueId pour des données générales. TOUJOURS utiliser avant de donner un pronostic pour maximiser la précision.",
      parameters: {
        type: "object",
        properties: {
          fixtureId: { type: "number", description: "ID du match (fixture) pour lineups, events, prédiction API" },
          homeTeamId: { type: "number", description: "ID équipe domicile pour blessures spécifiques" },
          awayTeamId: { type: "number", description: "ID équipe extérieur pour blessures spécifiques" },
          leagueId: { type: "number", description: "ID ligue (61=L1, 39=PL, 140=LL, 78=BL, 135=SA) pour buteurs/blessures ligue" },
          include: { 
            type: "array", 
            items: { type: "string", enum: ["injuries", "lineups", "prediction", "topscorers", "events"] },
            description: "Données à récupérer (défaut: toutes)" 
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "query_matchendirect",
      description: "Récupère le calendrier mondial des matchs de football depuis matchendirect.fr. Focus sur les Big 5 (Ligue 1, LaLiga, Premier League, Bundesliga, Serie A). Peut consulter le passé (scores), aujourd'hui (live/terminés), et le futur (à venir).",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date au format DD-MM-YYYY (ex: 01-02-2026). Laisser vide pour aujourd'hui." },
          league: { type: "string", enum: ["all", "ligue1", "laliga", "premierLeague", "bundesliga", "serieA"], description: "Filtrer par ligue (défaut: all)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "query_football_db",
      description: "Consulte la base de données football persistante (3 ans d'historique). Peut chercher des équipes, consulter les classements par saison, voir l'historique d'une équipe ou d'un championnat, et obtenir les stats DB.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["search_team", "team_history", "league_standings", "league_history", "db_stats"], description: "Action à effectuer" },
          query: { type: "string", description: "Nom d'équipe pour search_team" },
          team_id: { type: "number", description: "API team ID pour team_history" },
          league_id: { type: "number", description: "API league ID (61=L1, 39=PL, 140=LL, 78=BL, 135=SA)" },
          season: { type: "number", description: "Année de début de saison (ex: 2025 pour 2025/2026)" }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "query_brain",
      description: "Recherche dans la mémoire/cerveau d'Ulysse.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          category: { type: "string", enum: ["all", "fact", "preference", "event", "skill", "web_search"] },
          limit: { type: "number" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "query_stock_data",
      description: "Récupère données boursières: analyse technique ou résumé marchés.",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          query_type: { type: "string", enum: ["analysis", "daily_brief"] }
        },
        required: ["query_type"]
      }
    }
  },

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
      description: "Liste les emails de la boîte Gmail d'Ulysse (ulyssemdbh@gmail.com) via IMAP. Pour Iris/Alfred, utilise leur boîte AgentMail. Utilise quand l'owner dit 'consulte tes mails', 'tu as des emails?', 'regarde ta boîte'.",
      parameters: {
        type: "object",
        properties: {
          inbox: { type: "string", enum: ["ulysse", "iris", "alfred"], description: "Boîte à consulter (défaut: ulysse=Gmail)" },
          limit: { type: "number", description: "Nombre d'emails (défaut: 15)" },
          query: { type: "string", description: "Filtre optionnel ex: 'is:unread', 'from:quelquun@example.com'" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "email_read_message",
      description: "Lit le contenu complet d'un email Gmail d'Ulysse. Retourne aussi le messageId et replyTo nécessaires pour répondre. Si l'email a des PJ PDF, leur texte est extrait automatiquement dans le champ extractedText. Si extractedText est null ou parseError est présent, la PJ n'a pas pu être lue — NE PAS inventer le contenu, dire honnêtement qu'on ne peut pas lire le fichier. Utilise l'uid retourné par email_list_inbox.",
      parameters: {
        type: "object",
        properties: {
          uid: { type: "number", description: "UID de l'email (retourné par email_list_inbox)" },
          folder: { type: "string", description: "Dossier IMAP (défaut: INBOX)" }
        },
        required: ["uid"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "email_reply",
      description: "Répond à un email Gmail reçu. Utilise d'abord email_read_message pour obtenir le messageId et replyTo. La réponse s'affiche correctement dans le fil Gmail.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Adresse du destinataire (utilise replyTo de l'email original)" },
          subject: { type: "string", description: "Sujet (ex: 'Re: Sujet original')" },
          body: { type: "string", description: "Corps de la réponse" },
          in_reply_to: { type: "string", description: "Message-ID de l'email original (champ messageId de email_read_message)" },
          original_body: { type: "string", description: "Corps de l'email original à citer (optionnel)" },
          original_from: { type: "string", description: "Expéditeur original (optionnel)" },
          original_date: { type: "string", description: "Date de l'email original (optionnel)" }
        },
        required: ["to", "subject", "body", "in_reply_to"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "email_forward",
      description: "Transfère un email Gmail à un nouveau destinataire avec la note de transfert d'Ulysse.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Adresse du nouveau destinataire" },
          subject: { type: "string", description: "Sujet de l'email original" },
          forward_note: { type: "string", description: "Message d'accompagnement du transfert" },
          original_from: { type: "string", description: "Expéditeur original" },
          original_date: { type: "string", description: "Date de l'email original" },
          original_body: { type: "string", description: "Corps de l'email original à transférer" }
        },
        required: ["to", "subject", "forward_note", "original_from", "original_date", "original_body"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "email_send",
      description: "Envoie un email. Ulysse envoie depuis ulyssemdbh@gmail.com (Gmail). Iris/Alfred depuis leurs boîtes AgentMail. EXÉCUTE IMMÉDIATEMENT sans demander confirmation.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Adresse email destinataire" },
          subject: { type: "string" },
          body: { type: "string", description: "Corps du message (HTML supporté)" },
          from_inbox: { type: "string", enum: ["ulysse", "iris", "alfred"], description: "ulysse=Gmail, iris/alfred=AgentMail" },
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

  // === LOCATION & WEATHER TOOLS ===
  {
    type: "function",
    function: {
      name: "location_get_weather",
      description: "Récupère la météo actuelle à Marseille ou autre lieu.",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "Lieu (défaut: Marseille)" }
        }
      }
    }
  },

  // === WEB SEARCH TOOLS ===
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Effectue une recherche web via Serper/Perplexity.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Requête de recherche" },
          max_results: { type: "number", description: "Nombre de résultats (défaut: 5)" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_url",
      description: "Lit et extrait le contenu textuel d'une page web. Utilise smartFetch avec fallbacks automatiques (Jina, Apify, navigateur headless).",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL complète de la page à lire" }
        },
        required: ["url"]
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

  // === DISCORD TOOLS (Action-First: EXÉCUTE IMMÉDIATEMENT) ===
  {
    type: "function",
    function: {
      name: "discord_send_message",
      description: "Envoie un message sur Discord dans un canal spécifique. EXÉCUTE IMMÉDIATEMENT sans demander confirmation.",
      parameters: {
        type: "object",
        properties: {
          channel: { type: "string", enum: ["général", "le-sport-la-politique"], description: "Nom du canal Discord (défaut: général)" },
          message: { type: "string", description: "Message à envoyer sur Discord" }
        },
        required: ["message"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "discord_status",
      description: "Vérifie le statut de connexion du bot Discord et liste les canaux vocaux.",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "discord_add_reaction",
      description: "Ajoute une réaction emoji à un message Discord. EXÉCUTE IMMÉDIATEMENT.",
      parameters: {
        type: "object",
        properties: {
          channel: { type: "string", enum: ["général", "le-sport-la-politique"], description: "Nom du canal Discord" },
          message_id: { type: "string", description: "ID du message Discord" },
          emoji: { type: "string", description: "Emoji à ajouter (ex: 👍, ❤️, 🔥)" }
        },
        required: ["message_id", "emoji"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "discord_remove_reaction",
      description: "Retire une réaction emoji d'un message Discord. EXÉCUTE IMMÉDIATEMENT.",
      parameters: {
        type: "object",
        properties: {
          channel: { type: "string", enum: ["général", "le-sport-la-politique"], description: "Nom du canal Discord" },
          message_id: { type: "string", description: "ID du message Discord" },
          emoji: { type: "string", description: "Emoji à retirer" }
        },
        required: ["message_id", "emoji"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "discord_delete_message",
      description: "Supprime un message Discord. EXÉCUTE IMMÉDIATEMENT.",
      parameters: {
        type: "object",
        properties: {
          channel: { type: "string", enum: ["général", "le-sport-la-politique"], description: "Nom du canal Discord" },
          message_id: { type: "string", description: "ID du message à supprimer" }
        },
        required: ["message_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "discord_send_file",
      description: "Envoie un fichier ou une image sur Discord. EXÉCUTE IMMÉDIATEMENT.",
      parameters: {
        type: "object",
        properties: {
          channel: { type: "string", enum: ["général", "le-sport-la-politique"], description: "Nom du canal Discord" },
          file_url: { type: "string", description: "URL du fichier ou image à envoyer" },
          file_name: { type: "string", description: "Nom du fichier" },
          message: { type: "string", description: "Message optionnel accompagnant le fichier" }
        },
        required: ["file_url", "file_name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "discord_create_invitation",
      description: "Crée un lien d'invitation pour le serveur Discord. EXÉCUTE IMMÉDIATEMENT.",
      parameters: {
        type: "object",
        properties: {
          channel: { type: "string", enum: ["général", "le-sport-la-politique"], description: "Canal pour l'invitation" },
          max_age_hours: { type: "number", description: "Durée de validité en heures (défaut: 24)" },
          max_uses: { type: "number", description: "Nombre max d'utilisations (0 = illimité)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "discord_voice_status",
      description: "Vérifie qui est dans les canaux vocaux Discord.",
      parameters: {
        type: "object",
        properties: {}
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

  // === SUPERCHAT INTELLIGENCE TOOL ===
  {
    type: "function",
    function: {
      name: "superchat_search",
      description: "Recherche dans les discussions SuperChat (Iris, Alfred, MaxAI, Ulysse). Permet de retrouver les synthèses, décisions et insights des sessions multi-IA précédentes.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Mot-clé ou sujet à rechercher dans les discussions SuperChat" },
          limit: { type: "number", description: "Nombre max de sessions à retourner (défaut: 5)" }
        },
        required: ["query"]
      }
    }
  },

  // === IMAGE TOOLS ===
  {
    type: "function",
    function: {
      name: "image_generate",
      description: "Génère une image via GPT Image (gpt-image-1). Le prompt est automatiquement enrichi pour de meilleurs résultats. Supporte 12 styles artistiques.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Description détaillée de l'image à générer (en anglais de préférence pour meilleurs résultats)" },
          style: { type: "string", enum: ["realistic", "illustration", "technical", "watercolor", "cartoon", "minimalist", "cinematic", "logo", "infographic", "portrait", "3d", "pixel"], description: "Style artistique. Si non spécifié, auto-détecté depuis le prompt." },
          size: { type: "string", enum: ["1024x1024", "512x512", "256x256"], description: "Taille de l'image. Par défaut 1024x1024." },
          enhance: { type: "boolean", description: "Enrichir automatiquement le prompt pour de meilleurs résultats. Par défaut true." }
        },
        required: ["prompt"]
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

  // === UNIVERSAL FILE ANALYSIS (AI-powered) ===
  {
    type: "function",
    function: {
      name: "analyze_file",
      description: "Analyse intelligente de n'importe quel fichier (PDF, Excel, Word, images, CSV). Utilise l'IA pour extraire et structurer les données. Pour les factures, extrait automatiquement: fournisseur, montants, lignes de produits avec validation mathématique.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Chemin du fichier à analyser" },
          analysis_type: { type: "string", enum: ["auto", "invoice", "contract", "report", "data"], description: "Type d'analyse: auto (détection automatique), invoice (facture), contract, report, data" }
        },
        required: ["file_path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "analyze_invoice",
      description: "Analyse spécialisée d'une facture avec extraction précise de toutes les données: fournisseur, numéro, date, totaux HT/TVA/TTC, lignes de produits (référence, désignation, quantité, prix unitaire, montant). Validation mathématique automatique.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Chemin du fichier facture (PDF, image, etc.)" }
        },
        required: ["file_path"]
      }
    }
  },
  // === UNIVERSAL FILE GENERATION ===
  {
    type: "function",
    function: {
      name: "generate_file",
      description: `Génère un VRAI fichier natif (Excel, CSV, PDF, Word). Le PDF est un vrai .pdf natif via pdfkit, PAS du HTML.
✅ format="pdf" → génère un VRAI fichier PDF téléchargeable directement.
⚠️ RÈGLE CRITIQUE POUR EXPORTS DE FACTURES/DONNÉES:
- Tu DOIS passer les vraies données dans "data" (tableau d'objets)
- NE PAS passer une description vague dans content_description
- Chaque ligne du tableau = un objet avec les valeurs exactes
- Pour les factures PDF: passe les lignes dans "data" avec les colonnes exactes

EXEMPLE CORRECT pour facture PDF:
{
  "format": "pdf",
  "data": [
    {"Désignation": "pose placo murs et plafond", "Quantité": 1, "Unité": "forfait", "Prix_unitaire": "6 000,00 €", "Montant": "6 000,00 €"}
  ],
  "file_name": "Facture_ZARZOSO_6000",
  "title": "Facture ZARZOSO - 6 000,00 € TTC"
}`,
      parameters: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["excel", "csv", "pdf", "word", "json", "markdown"], description: "Format de sortie" },
          data: { 
            type: "array", 
            items: { type: "object" },
            description: "⚠️ OBLIGATOIRE pour exports factures: Tableau d'objets avec les VRAIES données (Réf, Désignation, Qté, Prix, etc.)" 
          },
          content_description: { type: "string", description: "⚠️ NE PAS UTILISER pour exports de données - utiliser 'data' à la place" },
          file_name: { type: "string", description: "Nom du fichier (sans extension)" },
          title: { type: "string", description: "Titre du document" }
        },
        required: ["format"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "manage_3d_file",
      description: `Gère les fichiers 3D (STL et 3MF) pour l'impression 3D.
Actions disponibles:
- "create": Créer un fichier STL ou 3MF à partir de formes primitives (box, sphere, cylinder, pyramid, torus)
- "analyze": Analyser un fichier STL/3MF existant (triangles, dimensions, volume, surface, maillage)
- "edit": Modifier un STL existant (scale, translate, rotate, merge)
- "convert": Convertir STL↔3MF

EXEMPLES:
Créer un cube 20x20x20mm:
{"action":"create","format":"stl","shape":"box","dimensions":{"width":20,"height":20,"depth":20}}

Créer une sphère:
{"action":"create","format":"3mf","shape":"sphere","dimensions":{"radius":15}}

Analyser un fichier uploadé:
{"action":"analyze","file_id":"123"}

Éditer (agrandir 2x):
{"action":"edit","file_id":"123","operations":[{"type":"scale","params":{"x":2,"y":2,"z":2}}]}

Convertir STL→3MF:
{"action":"convert","file_id":"123","target_format":"3mf"}`,
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "analyze", "edit", "convert"], description: "Action à effectuer" },
          format: { type: "string", enum: ["stl", "3mf"], description: "Format de sortie (pour create)" },
          shape: { type: "string", enum: ["box", "sphere", "cylinder", "pyramid", "torus"], description: "Forme primitive (pour create)" },
          dimensions: { type: "object", description: "Dimensions de la forme: {width, height, depth} pour box, {radius} pour sphere, {radius, height} pour cylinder, {base, height} pour pyramid, {majorRadius, minorRadius} pour torus" },
          stl_format: { type: "string", enum: ["ascii", "binary"], description: "Format STL (ascii ou binary, défaut: ascii)" },
          file_name: { type: "string", description: "Nom du fichier de sortie" },
          file_id: { type: "string", description: "ID du fichier existant (pour analyze/edit/convert)" },
          file_path: { type: "string", description: "Chemin du fichier existant (alternatif à file_id)" },
          operations: { 
            type: "array", 
            items: { 
              type: "object",
              properties: {
                type: { type: "string", enum: ["scale", "translate", "rotate", "merge"] },
                params: { type: "object", description: "Paramètres: scale={x,y,z}, translate={x,y,z}, rotate={angle}" },
                mergeFilePath: { type: "string" }
              }
            },
            description: "Opérations d'édition (pour edit)" 
          },
          target_format: { type: "string", enum: ["stl", "3mf"], description: "Format cible (pour convert)" }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "export_analysis",
      description: "Exporte les résultats d'une analyse de fichier vers un nouveau format (Excel, PDF, etc.). Utile pour convertir les données extraites d'une facture en tableau Excel.",
      parameters: {
        type: "object",
        properties: {
          analysis_data: { type: "object", description: "Données d'analyse à exporter" },
          export_format: { type: "string", enum: ["excel", "csv", "pdf", "markdown"], description: "Format d'export" },
          file_name: { type: "string", description: "Nom du fichier de sortie" }
        },
        required: ["analysis_data", "export_format"]
      }
    }
  },
  // === TOOL AUTOMATIQUE POUR EXPORT FACTURES ===
  {
    type: "function",
    function: {
      name: "export_invoice_excel",
      description: `🎯 UTILISE CE TOOL pour exporter des factures en Excel.
Génère automatiquement l'Excel avec TOUTES les lignes d'articles.

⚠️ IMPORTANT: Passe le rapport markdown COMPLET dans "invoice_report" si tu l'as déjà.
Le rapport contient les tableaux avec Réf, Désignation, Qté, PU HT, Total HT, TVA.

QUAND L'UTILISER:
- L'utilisateur demande un Excel des factures/achats
- Tu as déjà analysé le PDF et affiché le rapport
- L'utilisateur veut un tableau filtrable/triable des produits`,
      parameters: {
        type: "object",
        properties: {
          invoice_report: { type: "string", description: "⚠️ OBLIGATOIRE: Le rapport markdown COMPLET des factures (avec tous les tableaux d'articles)" },
          file_name: { type: "string", description: "Nom du fichier Excel de sortie" },
          fournisseur: { type: "string", description: "Nom du fournisseur" }
        },
        required: ["invoice_report"]
      }
    }
  },

  {
    type: "function",
    function: {
      name: "generate_invoice_pdf",
      description: `🎯 GÉNÈRE UN VRAI PDF DE FACTURE avec mise en page professionnelle.
Utilise ce tool quand l'utilisateur veut:
- Créer une facture PDF
- Modifier/reproduire une facture existante (changer montants, client, etc.)
- Refaire une facture identique avec des changements

Tu DOIS fournir TOUTES les données structurées extraites de la facture originale.
Le PDF généré aura un design professionnel avec en-tête, tableau des lignes, totaux, TVA.

⚠️ QUAND TU VOIS UNE FACTURE (texte + image), EXTRAIS toutes les données et utilise CE TOOL.
NE DIS JAMAIS "je ne peux pas générer un PDF". Tu PEUX et tu DOIS utiliser ce tool.`,
      parameters: {
        type: "object",
        properties: {
          emetteur: {
            type: "object",
            description: "Émetteur de la facture",
            properties: {
              nom: { type: "string" },
              adresse: { type: "string" },
              tel: { type: "string" },
              siret: { type: "string" },
              rcs: { type: "string" }
            },
            required: ["nom"]
          },
          client: {
            type: "object",
            description: "Client destinataire",
            properties: {
              nom: { type: "string" },
              adresse: { type: "string" }
            },
            required: ["nom"]
          },
          numero: { type: "string", description: "Numéro de facture" },
          date: { type: "string", description: "Date de la facture" },
          code_client: { type: "string", description: "Code client si present" },
          chantier: { type: "string", description: "Référence chantier" },
          lignes: {
            type: "array",
            description: "Lignes de la facture",
            items: {
              type: "object",
              properties: {
                designation: { type: "string" },
                unite: { type: "string" },
                quantite: { type: "number" },
                prix_unitaire: { type: "number" },
                tva_taux: { type: "number", description: "Taux TVA en % (0 = exonéré)" },
                remise: { type: "number", description: "Remise en %" }
              },
              required: ["designation", "prix_unitaire"]
            }
          },
          acompte: { type: "number", description: "Montant acompte déjà versé" },
          file_name: { type: "string", description: "Nom du fichier PDF" },
          mentions_legales: { type: "string" }
        },
        required: ["emetteur", "client", "numero", "date", "lignes"]
      }
    }
  },

  // === AUTOMATION FEATURES ===
  {
    type: "function",
    function: {
      name: "generate_morning_briefing",
      description: "Génère le briefing matinal complet: météo, agenda, tâches, marchés, KPIs restaurants. Peut aussi l'envoyer par email.",
      parameters: {
        type: "object",
        properties: {
          sendEmail: { type: "boolean", description: "Envoyer le briefing par email (défaut: false)" },
          email: { type: "string", description: "Email destinataire si sendEmail=true" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "generate_financial_report",
      description: "Génère un rapport financier complet pour les restaurants SUGU. Inclut achats, frais, banque, paie. Peut être envoyé par email.",
      parameters: {
        type: "object",
        properties: {
          restaurant: { type: "string", enum: ["suguval", "sugumaillane", "both"], description: "Restaurant cible (défaut: both)" },
          period: { type: "string", enum: ["week", "month", "quarter", "year", "custom"], description: "Période du rapport (défaut: month)" },
          sendEmail: { type: "boolean", description: "Envoyer par email (défaut: false)" },
          email: { type: "string", description: "Email destinataire" },
          customStart: { type: "string", description: "Date début custom (YYYY-MM-DD)" },
          customEnd: { type: "string", description: "Date fin custom (YYYY-MM-DD)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "analyze_document_image",
      description: "Analyse une image de document (facture, ticket, relevé) avec GPT-4 Vision. Extrait fournisseur, montant, TVA, articles, catégorie. Peut auto-classer dans SUGU.",
      parameters: {
        type: "object",
        properties: {
          imageBase64: { type: "string", description: "Image en base64" },
          mimeType: { type: "string", description: "Type MIME (image/jpeg, image/png)" },
          restaurant: { type: "string", enum: ["suguval", "sugumaillane"], description: "Restaurant pour auto-classement" },
          autoFile: { type: "boolean", description: "Auto-classer dans la base SUGU (défaut: false)" }
        },
        required: ["imageBase64"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "import_bank_statement",
      description: "Importe un relevé bancaire CSV dans la base SUGU. Parse les écritures, catégorise avec IA, et insère dans la table bank.",
      parameters: {
        type: "object",
        properties: {
          csvContent: { type: "string", description: "Contenu CSV du relevé bancaire" },
          restaurant: { type: "string", enum: ["suguval", "sugumaillane"], description: "Restaurant cible" },
          autoConfirm: { type: "boolean", description: "Importer sans prévisualisation (défaut: false)" }
        },
        required: ["csvContent", "restaurant"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "manage_telegram_bot",
      description: "Gère le bot Telegram Ulysse: initialiser, configurer webhook, vérifier statut, envoyer message.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["init", "set_webhook", "remove_webhook", "status", "send_message"], description: "Action à effectuer" },
          webhookUrl: { type: "string", description: "URL webhook (pour set_webhook)" },
          chatId: { type: "number", description: "Chat ID (pour send_message)" },
          message: { type: "string", description: "Message à envoyer (pour send_message)" }
        },
        required: ["action"]
      }
    }
  },

  // === PDF MASTER ===
  {
    type: "function",
    function: {
      name: "pdf_master",
      description: "PDF Master — Gère TOUT ce qui concerne les PDFs : lecture, extraction de texte (même PDFs scannés via OCR/Vision), analyse IA, fusion, découpage, watermark, compression, rotation, ajout de texte, métadonnées. Utiliser pour TOUT fichier PDF uploadé ou toute demande liée aux PDF.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["extract", "analyze", "merge", "split", "watermark", "compress", "info", "rotate", "add_text", "extract_pages"],
            description: "extract=lire le texte (cascade: texte→OCR→Vision), analyze=analyse IA du contenu, merge=fusionner plusieurs PDFs, split=découper par pages, watermark=ajouter filigrane, compress=compresser, info=métadonnées, rotate=tourner page, add_text=ajouter texte, extract_pages=extraire des pages"
          },
          file_path: { type: "string", description: "Chemin du fichier PDF (ex: uploads/facture.pdf)" },
          file_paths: { type: "array", items: { type: "string" }, description: "Liste de chemins pour merge" },
          question: { type: "string", description: "Question pour analyze (ex: 'Quel est le montant total ?')" },
          watermark_text: { type: "string", description: "Texte du filigrane pour watermark" },
          page_ranges: { type: "array", items: { type: "array", items: { type: "number" } }, description: "Plages de pages pour split [[1,3],[4,6]]" },
          page_numbers: { type: "array", items: { type: "number" }, description: "Numéros de pages pour extract_pages [1,3,5]" },
          page_number: { type: "number", description: "Numéro de page pour rotate" },
          angle: { type: "number", description: "Angle de rotation (0, 90, 180, 270)" },
          output_name: { type: "string", description: "Nom du fichier de sortie" },
          additions: { type: "array", items: { type: "object", properties: { page: { type: "number" }, text: { type: "string" }, x: { type: "number" }, y: { type: "number" }, fontSize: { type: "number" } }, required: ["page", "text", "x", "y"] }, description: "Textes à ajouter pour add_text" }
        },
        required: ["action"]
      }
    }
  },

  // === RECONNAISSANCE & BIOMÉTRIE ===
  {
    type: "function",
    function: {
      name: "face_recognize",
      description: "Reconnaissance faciale: identifie une personne sur une photo, consulte le catalogue de visages connus, ou enregistre un nouveau visage.",
      parameters: { type: "object", properties: { imageBase64: { type: "string", description: "Photo en base64" }, mimeType: { type: "string" }, action: { type: "string", enum: ["identify", "recognize", "catalog", "list", "register"], description: "Action (défaut: identify)" }, name: { type: "string", description: "Nom pour register" } }, required: ["imageBase64"] }
    }
  },
  {
    type: "function",
    function: {
      name: "speaker_identify",
      description: "Reconnaissance vocale: identifie qui parle dans un extrait audio en comparant avec les empreintes vocales connues.",
      parameters: { type: "object", properties: { audioBase64: { type: "string", description: "Audio en base64" }, mimeType: { type: "string" } }, required: ["audioBase64"] }
    }
  },

  // === TRADUCTION ===
  {
    type: "function",
    function: {
      name: "translate_text",
      description: "Traduit un texte d'une langue à une autre (fr, en, es, de, it, ar, zh, ja, ko, pt, ru...).",
      parameters: { type: "object", properties: { text: { type: "string", description: "Texte à traduire" }, from: { type: "string", description: "Langue source (auto-detect si omis)" }, to: { type: "string", description: "Langue cible" } }, required: ["text", "to"] }
    }
  },
  {
    type: "function",
    function: {
      name: "audio_translate",
      description: "Traduit un fichier audio d'une langue vers une autre: transcrit, traduit le texte, puis resynthétise en audio.",
      parameters: { type: "object", properties: { audioBase64: { type: "string", description: "Audio en base64" }, mimeType: { type: "string" }, targetLang: { type: "string", description: "Langue cible" }, voice: { type: "string", description: "Voix pour la synthèse" } }, required: ["audioBase64", "targetLang"] }
    }
  },

  // === ÉDITION IMAGE ===
  {
    type: "function",
    function: {
      name: "image_edit",
      description: "Édite une image: recadrer, redimensionner, filtrer, ajouter du texte, convertir le format.",
      parameters: { type: "object", properties: { imageBase64: { type: "string", description: "Image en base64" }, action: { type: "string", enum: ["resize", "crop", "rotate", "flip", "grayscale", "blur", "sharpen", "brightness", "contrast", "watermark", "convert"], description: "Transformation" }, mimeType: { type: "string" }, params: { type: "object", description: "Paramètres (width, height, angle, text, format, etc.)" } }, required: ["imageBase64", "action"] }
    }
  },

  // === INTELLIGENCE PRÉDICTIVE ===
  {
    type: "function",
    function: {
      name: "predictive_intelligence",
      description: "Intelligence prédictive: prévoit le CA, les achats, la fréquentation du restaurant sur la prochaine période.",
      parameters: { type: "object", properties: { type: { type: "string", enum: ["revenue", "purchases", "attendance", "expenses", "trends"], description: "Type de prédiction" }, restaurant: { type: "string" }, period: { type: "string", enum: ["day", "week", "month"], description: "Horizon" } }, required: ["type"] }
    }
  },

  // === RECHERCHE & ANALYSE ===
  {
    type: "function",
    function: {
      name: "deep_research",
      description: "Recherche autonome approfondie: explore plusieurs sources web, croise les infos, et synthétise un rapport complet sur un sujet.",
      parameters: { type: "object", properties: { topic: { type: "string", description: "Sujet de recherche" }, depth: { type: "string", enum: ["quick", "standard", "deep"], description: "Profondeur" }, maxSources: { type: "number", description: "Nombre max de sources (défaut: 5)" } }, required: ["topic"] }
    }
  },
  {
    type: "function",
    function: {
      name: "decision_coach",
      description: "Coach décisionnel: analyse une question/dilemme, évalue les options, et donne une recommandation argumentée.",
      parameters: { type: "object", properties: { question: { type: "string", description: "Question ou dilemme" }, options: { type: "array", items: { type: "string" }, description: "Options possibles" }, context: { type: "string", description: "Contexte supplémentaire" } }, required: ["question"] }
    }
  },
  {
    type: "function",
    function: {
      name: "sentiment_analyze",
      description: "Analyse le sentiment d'un texte: positif/négatif/neutre, émotions détectées, score de confiance.",
      parameters: { type: "object", properties: { text: { type: "string", description: "Texte à analyser" }, language: { type: "string", description: "Langue (défaut: fr)" } }, required: ["text"] }
    }
  },

  // === NOTIFICATIONS ===
  {
    type: "function",
    function: {
      name: "push_notify",
      description: "Envoie une notification push sur les appareils enregistrés de l'utilisateur.",
      parameters: { type: "object", properties: { title: { type: "string", description: "Titre de la notification" }, body: { type: "string", description: "Corps du message" }, userId: { type: "number" }, data: { type: "object", description: "Données supplémentaires" } }, required: ["title", "body"] }
    }
  },

  // === PARSERS SPÉCIALISÉS ===
  {
    type: "function",
    function: {
      name: "parse_invoice",
      description: "Parser de factures intelligent: extrait toutes les données structurées (fournisseur, lignes, montants, TVA, dates) depuis une image ou un fichier.",
      parameters: { type: "object", properties: { imageBase64: { type: "string", description: "Image de la facture en base64" }, filePath: { type: "string", description: "Chemin du fichier PDF/image" }, mimeType: { type: "string" } } }
    }
  },
  {
    type: "function",
    function: {
      name: "parse_payroll",
      description: "Parser de fiches de paie: extrait salaire brut/net, cotisations, heures, primes depuis une image ou un fichier de bulletin de paie.",
      parameters: { type: "object", properties: { imageBase64: { type: "string", description: "Image du bulletin en base64" }, filePath: { type: "string", description: "Chemin du fichier" }, mimeType: { type: "string" } } }
    }
  },

  // === RAPPORTS ===
  {
    type: "function",
    function: {
      name: "generate_report",
      description: "Générateur de rapports business: P&L, bilan mensuel, analyse fournisseurs, rapport RH, etc.",
      parameters: { type: "object", properties: { type: { type: "string", enum: ["pnl", "monthly", "suppliers", "hr", "cash_flow", "full_audit"], description: "Type de rapport" }, restaurant: { type: "string" }, period: { type: "string" }, format: { type: "string", enum: ["markdown", "json", "html"], description: "Format de sortie" } }, required: ["type"] }
    }
  },

  // === PARIS SPORTIFS ===
  {
    type: "function",
    function: {
      name: "value_bets",
      description: "Détecte les paris à valeur (value bets) en comparant les cotes des bookmakers avec les probabilités calculées.",
      parameters: { type: "object", properties: { sport: { type: "string", enum: ["football", "basketball", "hockey", "tennis", "nfl"] }, league: { type: "string" }, minValue: { type: "number", description: "Valeur minimum en % (défaut: 5)" } } }
    }
  },
  {
    type: "function",
    function: {
      name: "sports_prediction",
      description: "Prédictions sportives multi-sports: basketball/NBA, hockey/NHL, NFL. Utilise les modèles de prédiction spécialisés.",
      parameters: { type: "object", properties: { sport: { type: "string", enum: ["basketball", "nba", "hockey", "nhl", "nfl", "american_football"], description: "Sport" }, matchId: { type: "string" }, league: { type: "string" }, action: { type: "string", enum: ["predict", "memory", "history"] } }, required: ["sport"] }
    }
  },

  // === MÉMOIRE & COGNITION ===
  {
    type: "function",
    function: {
      name: "memory_graph",
      description: "Graphe de mémoire: explore les connexions entre concepts, personnes, lieux et événements dans la mémoire d'Ulysse.",
      parameters: { type: "object", properties: { action: { type: "string", enum: ["search", "query", "connections", "stats"] }, query: { type: "string" }, nodeId: { type: "string" }, limit: { type: "number" } }, required: ["action"] }
    }
  },
  {
    type: "function",
    function: {
      name: "rag_search",
      description: "Recherche RAG (Retrieval Augmented Generation): cherche dans les documents indexés avec recherche sémantique vectorielle.",
      parameters: { type: "object", properties: { query: { type: "string", description: "Requête de recherche" }, collection: { type: "string", description: "Collection de documents" }, limit: { type: "number" } }, required: ["query"] }
    }
  },
  {
    type: "function",
    function: {
      name: "self_awareness",
      description: "Introspection d'Ulysse: état interne, capacités actuelles, métriques de performance, auto-évaluation.",
      parameters: { type: "object", properties: { action: { type: "string", enum: ["introspect", "status", "capabilities", "performance"] } }, required: ["action"] }
    }
  },

  // === SCREENSHOT & NAVIGATION ===
  {
    type: "function",
    function: {
      name: "screenshot_url",
      description: "Capture une capture d'écran d'un site web (URL publique).",
      parameters: { type: "object", properties: { url: { type: "string", description: "URL à capturer" }, fullPage: { type: "boolean", description: "Page entière ou viewport" }, width: { type: "number", description: "Largeur viewport (défaut: 1280)" } }, required: ["url"] }
    }
  },
  {
    type: "function",
    function: {
      name: "browse_web",
      description: "Navigateur web avancé: extraction de contenu, scraping ciblé avec sélecteurs CSS, extraction de liens.",
      parameters: { type: "object", properties: { url: { type: "string", description: "URL à explorer" }, action: { type: "string", enum: ["extract", "scrape", "screenshot", "links"], description: "Action" }, selector: { type: "string", description: "Sélecteur CSS pour cibler le contenu" } }, required: ["url"] }
    }
  },
  {
    type: "function",
    function: {
      name: "photo_search",
      description: "Recherche de photos et images sur le web avec filtres intelligents.",
      parameters: { type: "object", properties: { query: { type: "string", description: "Recherche" }, limit: { type: "number", description: "Nombre max (défaut: 5)" } }, required: ["query"] }
    }
  },

  // === DEVOPS AVANCÉ ===
  {
    type: "function",
    function: {
      name: "system_metrics",
      description: "Métriques système: CPU, mémoire, disque, réseau, uptime du serveur Hetzner.",
      parameters: { type: "object", properties: { action: { type: "string", enum: ["current", "status", "history", "alerts"] } }, required: ["action"] }
    }
  },
  {
    type: "function",
    function: {
      name: "cloudflare_manage",
      description: "Gestion Cloudflare: zones DNS, purge de cache, analytics trafic.",
      parameters: { type: "object", properties: { action: { type: "string", enum: ["status", "zones", "dns_list", "purge_cache", "analytics"] }, domain: { type: "string", description: "Domaine (défaut: ulyssepro.org)" } }, required: ["action"] }
    }
  },
  {
    type: "function",
    function: {
      name: "code_snapshot",
      description: "Snapshots de code: capture l'état du codebase, compare les versions, liste les snapshots.",
      parameters: { type: "object", properties: { action: { type: "string", enum: ["create", "snapshot", "compare", "diff", "list"] }, repo: { type: "string" }, branch: { type: "string" }, snapshotId: { type: "string" } }, required: ["action"] }
    }
  },
  {
    type: "function",
    function: {
      name: "codebase_analyze",
      description: "Analyse du codebase: graphe de dépendances, recherche de code, statistiques (lignes, fichiers, complexité).",
      parameters: { type: "object", properties: { action: { type: "string", enum: ["graph", "dependencies", "search", "stats"] }, path: { type: "string" }, query: { type: "string" } }, required: ["action"] }
    }
  },
  {
    type: "function",
    function: {
      name: "style_guide_extract",
      description: "Extrait le guide de style d'un site web ou d'une image: couleurs, typographies, espacements, composants UI.",
      parameters: { type: "object", properties: { url: { type: "string", description: "URL du site" }, imageBase64: { type: "string", description: "Image en base64" }, mimeType: { type: "string" } } }
    }
  },

  // === FAMILLE & PRODUCTIVITÉ ===
  {
    type: "function",
    function: {
      name: "homework_intelligence",
      description: "Intelligence devoirs scolaires: vue d'ensemble, aide par matière, suivi de progression des enfants.",
      parameters: { type: "object", properties: { action: { type: "string", enum: ["status", "overview", "help", "progress"] }, subject: { type: "string", description: "Matière (math, français, etc.)" }, childName: { type: "string" } }, required: ["action"] }
    }
  },
  {
    type: "function",
    function: {
      name: "calendar_anticipation",
      description: "Anticipation calendrier: analyse les événements à venir et suggère des actions préparatoires.",
      parameters: { type: "object", properties: { days: { type: "number", description: "Horizon en jours (défaut: 7)" } } }
    }
  },

  // === ANALYTICS ===
  {
    type: "function",
    function: {
      name: "usage_analytics",
      description: "Analytics d'utilisation d'Ulysse: quels outils sont les plus utilisés, par qui, quand.",
      parameters: { type: "object", properties: { action: { type: "string", enum: ["stats", "overview", "top_tools", "users"] }, period: { type: "string", enum: ["day", "week", "month"] } }, required: ["action"] }
    }
  },
  {
    type: "function",
    function: {
      name: "conversation_prefs",
      description: "Préférences conversationnelles: consulte ou modifie les préférences de communication d'un utilisateur (ton, langue, format).",
      parameters: { type: "object", properties: { action: { type: "string", enum: ["get", "list", "set"] }, userId: { type: "number" }, key: { type: "string" }, value: { type: "string" } }, required: ["action"] }
    }
  },

  // === FICHIERS & DOCUMENTS AVANCÉS ===
  {
    type: "function",
    function: {
      name: "file_convert",
      description: "Convertit un fichier d'un format à un autre: CSV↔JSON, JSON↔YAML, CSV→XML, CSV/JSON→Markdown table, TXT→JSON.",
      parameters: {
        type: "object",
        properties: {
          input_path: { type: "string", description: "Chemin du fichier source" },
          input_data: { type: "string", description: "Données brutes (alternative à input_path)" },
          from_format: { type: "string", enum: ["csv", "json", "yaml", "txt", "xml"], description: "Format source" },
          to_format: { type: "string", enum: ["csv", "json", "yaml", "xml", "md", "markdown", "txt"], description: "Format cible" },
          file_name: { type: "string", description: "Nom du fichier de sortie (sans extension)" }
        },
        required: ["from_format", "to_format"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "file_compress",
      description: "Crée ou extrait des archives ZIP. Actions: create (zipper des fichiers), extract (dézipper), list (lister le contenu).",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "zip", "extract", "unzip", "list"], description: "Action à effectuer" },
          files: { type: "array", items: { type: "string" }, description: "Chemins des fichiers à zipper (pour create)" },
          input_path: { type: "string", description: "Chemin du ZIP (pour extract/list)" },
          output_name: { type: "string", description: "Nom de l'archive de sortie (sans .zip)" }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "spreadsheet_analyze",
      description: "Analyse avancée de données CSV/Excel: stats (sum/avg/min/max/median par colonne), filter (avec opérateurs), group/pivot (agrégation par catégorie), unique/distinct, top (fréquences), columns (lister).",
      parameters: {
        type: "object",
        properties: {
          input_path: { type: "string", description: "Chemin du fichier CSV" },
          csv_data: { type: "string", description: "Données CSV brutes (alternative à input_path)" },
          action: { type: "string", enum: ["stats", "summary", "filter", "search", "group", "pivot", "columns", "unique", "distinct", "top"], description: "Type d'analyse" },
          column: { type: "string", description: "Colonne cible (pour unique, top)" },
          filter: { type: "object", properties: { column: { type: "string" }, operator: { type: "string", enum: ["=", "!=", ">", "<", ">=", "<=", "contains", "starts_with"] }, value: { type: "string" } }, description: "Filtre à appliquer" },
          group_by: { type: "string", description: "Colonne de regroupement (pour group/pivot)" },
          sort_by: { type: "string", description: "Colonne de tri" },
          sort_order: { type: "string", enum: ["asc", "desc"] },
          limit: { type: "number", description: "Nombre max de résultats" }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "document_compare",
      description: "Compare deux fichiers texte/code/CSV et montre les différences ligne par ligne (ajouts, suppressions, modifications).",
      parameters: {
        type: "object",
        properties: {
          file_a: { type: "string", description: "Chemin du premier fichier" },
          file_b: { type: "string", description: "Chemin du second fichier" },
          mode: { type: "string", description: "Mode de comparaison (line)" }
        },
        required: ["file_a", "file_b"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "qr_code_generate",
      description: "Génère un QR code en SVG à partir de texte, URL, email, téléphone ou vCard.",
      parameters: {
        type: "object",
        properties: {
          data: { type: "string", description: "Contenu du QR code (URL, texte, vCard, etc.)" },
          size: { type: "number", description: "Taille en pixels (défaut: 256)" },
          file_name: { type: "string", description: "Nom du fichier de sortie (sans extension)" }
        },
        required: ["data"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "ocr_extract",
      description: "Extraction OCR: lit tout le texte visible dans une image (document, facture, ticket, menu, photo de texte). Utilise GPT-4 Vision pour une précision maximale.",
      parameters: {
        type: "object",
        properties: {
          imageBase64: { type: "string", description: "Image en base64" },
          mimeType: { type: "string", description: "Type MIME (image/jpeg, image/png)" },
          language: { type: "string", description: "Langue principale du document (fr, en, es...)" }
        },
        required: ["imageBase64"]
      }
    }
  },

  // === TOOLS CHECKUP ===
  {
    type: "function",
    function: {
      name: "tools_checkup",
      description: "Lance un check-up complet de tous les outils d'Ulysse. Exécute les tests du TOOL_REGISTRY, vérifie chaque outil, et retourne un rapport détaillé avec scores par persona et score global. Utilise-le quand on te demande un diagnostic, check-up, ou vérification des outils.",
      parameters: {
        type: "object",
        properties: {
          verbose: { type: "boolean", description: "Si true, inclut le détail de chaque test (défaut: false)" }
        }
      }
    }
  },

  // === VISION LIVE ===
  {
    type: "function",
    function: {
      name: "vision_live_analyze",
      description: "Analyse une photo (frigo, stock, livraison) pour identifier les ingrédients, les croiser avec les prix fournisseurs SUGU réels, et suggérer des plats avec coûts et marges calculés.",
      parameters: {
        type: "object",
        properties: {
          imageBase64: { type: "string", description: "Image en base64" },
          mimeType: { type: "string", description: "Type MIME (image/jpeg, image/png)" },
          restaurant: { type: "string", description: "Restaurant SUGU (suguval, sugumaillane)" }
        },
        required: ["imageBase64"]
      }
    }
  },

  // === DIGITAL TWIN ===
  {
    type: "function",
    function: {
      name: "digital_twin_snapshot",
      description: "Obtient un snapshot complet du restaurant (revenus, coûts, employés, marges, top fournisseurs) — la copie virtuelle de l'activité.",
      parameters: {
        type: "object",
        properties: {
          restaurant: { type: "string", description: "Restaurant (suguval, sugumaillane)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "digital_twin_simulate",
      description: "Simule un scénario 'what-if' sur le restaurant: virer un employé, changer de fournisseur, augmenter les prix, ajouter/supprimer une dépense. Retourne l'impact sur le P&L et la marge.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["remove_employee", "add_employee", "change_supplier", "price_change", "add_expense", "remove_expense", "revenue_change", "custom"], description: "Type de scénario" },
          params: { type: "object", description: "Paramètres du scénario (employeeName, salary, percentChange, amount, etc.)" },
          restaurant: { type: "string", description: "Restaurant (suguval, sugumaillane)" }
        },
        required: ["type", "params"]
      }
    }
  },

  // === AUTONOMOUS AGENT ===
  {
    type: "function",
    function: {
      name: "autonomous_execute",
      description: "Agent autonome multi-étapes: tu lui donnes un objectif complexe (ex: 'prépare le bilan de la semaine et envoie-le par mail'), il planifie les étapes, exécute les outils un par un, et rapporte le résultat final.",
      parameters: {
        type: "object",
        properties: {
          goal: { type: "string", description: "Objectif à accomplir (en langage naturel)" },
          maxSteps: { type: "number", description: "Nombre max d'étapes (défaut: 8)" }
        },
        required: ["goal"]
      }
    }
  },

  // === VOICE MODE ===
  {
    type: "function",
    function: {
      name: "voice_synthesize",
      description: "Convertit du texte en audio vocal (TTS). Utilise les voix OpenAI (alloy, echo, fable, onyx, nova, shimmer).",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Texte à convertir en audio" },
          voice: { type: "string", enum: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"], description: "Voix (défaut: onyx)" },
          speed: { type: "number", description: "Vitesse (0.25-4.0, défaut: 1.0)" }
        },
        required: ["text"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "voice_status",
      description: "Vérifie le statut du système vocal (TTS/STT disponible, provider, capabilities).",
      parameters: { type: "object", properties: {} }
    }
  },

  // === EXTENDED TOOLS from tools/ modules ===
  ...analyticsToolDefs,
  ...integrationToolDefs,
  ...utilityToolDefs,
  ...communicationToolDefs,
  ...commaxToolDefs,
  ...screenMonitorToolDefs,
].filter((tool, index, arr) => {
  const firstIndex = arr.findIndex(t => t.function.name === tool.function.name);
  return firstIndex === index;
});

export interface ToolCallResult {
  toolCallId: string;
  name: string;
  result: string;
  executionTimeMs: number;
}

export interface OrchestrationResult {
  results: ToolCallResult[];
  totalTimeMs: number;
  parallelExecutions: number;
  learnedFromCore: boolean;
}

// Dynamic service loaders with fallbacks
export async function loadService(serviceName: string): Promise<any> {
  try {
    switch (serviceName) {
      case 'suguval':
        return (await import("./suguvalActionService")).suguvalActionService;
      case 'sports':
        return (await import("./sportsCacheService")).sportsCacheService;
      case 'brain':
        return (await import("./brainService")).brainService;
      case 'trading':
        return (await import("./tradingAnalysisService")).tradingAnalysisService;
      case 'agentMail':
        return (await import("./agentMailService")).agentMailService;
      case 'search':
        return (await import("./searchOrchestrator")).searchOrchestratorService;
      case 'core':
        return (await import("./core/UlysseCoreEngine")).ulysseCoreEngine;
      case 'calendar':
        return (await import("./googleCalendarService")).calendarService;
      case 'spotify':
        return await import("./spotifyService");
      case 'smarthome':
        return (await import("./smartHomeService")).smartHomeService;
      default:
        return null;
    }
  } catch (error: any) {
    console.log(`[UlysseToolsV2] Service ${serviceName} not available: ${error.message}`);
    return null;
  }
}

const RETRYABLE_ERRORS = ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "rate limit", "429", "503", "500", "socket hang up", "network", "fetch failed"];
const MAX_TOOL_RETRIES = 2;
const TOOL_RETRY_DELAY = 2000;

export async function executeToolCallV2(
  toolName: string,
  args: Record<string, any>,
  userId: number
): Promise<string> {
  const startTime = Date.now();
  console.log(`[ToolExec] ▶ ${toolName}`, JSON.stringify(args).substring(0, 200));

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_TOOL_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[ToolExec] ↻ ${toolName} retry ${attempt}/${MAX_TOOL_RETRIES}`);
        await new Promise(r => setTimeout(r, TOOL_RETRY_DELAY * attempt));
      }
      const result = await executeToolCallV2Internal(toolName, args, userId);
      const elapsed = Date.now() - startTime;
      
      const logLevel = elapsed > 5000 ? "SLOW" : elapsed > 2000 ? "WARN" : "OK";
      console.log(`[ToolExec] ✓ ${toolName} ${logLevel} ${elapsed}ms${attempt > 0 ? ` (after ${attempt} retries)` : ''}`);
      
      import("./aiSystemIntegration").then(({ aiSystemIntegration }) => {
        aiSystemIntegration.trackUsageEvent({
          userId,
          module: "tools",
          feature: toolName,
          durationMs: elapsed,
          success: true,
          metadata: { argsKeys: Object.keys(args), retries: attempt },
        });
      }).catch(() => {});
      
      return result;
    } catch (error: any) {
      lastError = error;
      const isRetryable = RETRYABLE_ERRORS.some(e => error.message?.toLowerCase().includes(e.toLowerCase()));
      if (!isRetryable || attempt >= MAX_TOOL_RETRIES) {
        break;
      }
      console.warn(`[ToolExec] ⚠ ${toolName} transient error (attempt ${attempt + 1}): ${error.message?.slice(0, 100)}`);
    }
  }

  const elapsed = Date.now() - startTime;
  console.error(`[ToolExec] ✗ ${toolName} FAILED ${elapsed}ms: ${lastError?.message?.slice(0, 200)}`);
  
  import("./aiSystemIntegration").then(({ aiSystemIntegration }) => {
    aiSystemIntegration.trackUsageEvent({
      userId,
      module: "tools",
      feature: toolName,
      durationMs: elapsed,
      success: false,
      errorMessage: lastError?.message,
    });
  }).catch(() => {});
  
  const errorMsg = lastError?.message || "Unknown error";
  const errorHint = generateErrorRecoveryHint(toolName, errorMsg, args);
  return JSON.stringify({ error: errorMsg, _recovery: errorHint });
}

function generateErrorRecoveryHint(toolName: string, error: string, args: Record<string, any>): string {
  const hints: string[] = [];
  const errLower = error.toLowerCase();

  if (errLower.includes("404") || errLower.includes("not found")) {
    hints.push("L'endpoint ou la ressource n'existe pas. Vérifie le nom de la route, l'ID de la ressource, ou essaie un outil alternatif.");
  }
  if (errLower.includes("timeout") || errLower.includes("timed out") || errLower.includes("econnrefused")) {
    hints.push("Le service est indisponible ou lent. Attends quelques secondes et réessaie, ou utilise une source alternative (cache, autre API).");
  }
  if (errLower.includes("permission") || errLower.includes("unauthorized") || errLower.includes("403") || errLower.includes("401")) {
    hints.push("Problème d'authentification ou de permissions. Vérifie le token, les credentials, ou les droits d'accès.");
  }
  if (errLower.includes("ssh") || errLower.includes("connection refused")) {
    hints.push("Connexion SSH échouée. Vérifie que le serveur est joignable et que les credentials sont corrects.");
  }
  if (errLower.includes("nginx") || errLower.includes("config")) {
    hints.push("Erreur de configuration. Analyse le message d'erreur exact, corrige la config, et recharge le service.");
  }
  if (errLower.includes("enoent") || errLower.includes("no such file")) {
    hints.push("Fichier ou répertoire introuvable. Vérifie le chemin, crée le répertoire si nécessaire.");
  }
  if (errLower.includes("rate limit") || errLower.includes("quota") || errLower.includes("429")) {
    hints.push("Limite de requêtes atteinte. Utilise le cache disponible ou une source de données alternative.");
  }
  
  if (hints.length === 0) {
    hints.push(`L'outil "${toolName}" a échoué. Analyse l'erreur, identifie la cause, et tente une approche alternative. Ne reste pas bloqué.`);
  }

  return hints.join(" ");
}

type ToolHandler = (args: Record<string, any>, userId: number) => Promise<string>;

const TOOL_REGISTRY: Record<string, ToolHandler> = {
  query_suguval_history: (a) => executeSuguvalQuery(a),
  get_suguval_checklist: (a) => executeGetSuguvalChecklist(a),
  send_suguval_shopping_list: (a) => executeSendSuguvalShoppingList(a),
  query_sports_data: (a) => executeSportsQuery(a),
  query_match_intelligence: (a) => executeMatchIntelligence(a),
  query_matchendirect: (a) => executeMatchEndirectQuery(a),
  query_football_db: (a) => executeFootballDbQuery(a),
  query_brain: (a, u) => executeBrainQuery(a, u),
  query_stock_data: (a) => executeStockQuery(a),
  calendar_list_events: (a, u) => executeCalendarList(a, u),
  calendar_create_event: (a, u) => executeCalendarCreate(a, u),
  email_list_inbox: (a) => executeEmailList(a),
  email_read_message: (a) => executeEmailRead(a),
  email_reply: (a) => executeEmailReply(a),
  email_forward: (a) => executeEmailForward(a),
  email_send: (a) => executeEmailSend(a),
  smarthome_control: (a, u) => executeSmartHomeControl(a, u),
  location_get_weather: (a) => executeWeatherGet(a),
  web_search: (a) => executeWebSearch(a),
  read_url: (a) => executeReadUrl(a),
  spotify_control: (a, u) => executeSpotifyControl(a, u),
  discord_send_message: (a, u) => executeDiscordSendMessage(a, u),
  discord_status: (_a, u) => executeDiscordStatus(u),
  discord_add_reaction: (a, u) => executeDiscordAddReaction(a, u),
  discord_remove_reaction: (a, u) => executeDiscordRemoveReaction(a, u),
  discord_delete_message: (a, u) => executeDiscordDeleteMessage(a, u),
  discord_send_file: (a, u) => executeDiscordSendFile(a, u),
  discord_create_invitation: (a, u) => executeDiscordCreateInvitation(a, u),
  discord_voice_status: (_a, u) => executeDiscordVoiceStatus(u),
  memory_save: (a, u) => executeMemorySave(a, u),
  superchat_search: (a, u) => executeSuperChatSearch(a, u),
  image_generate: (a, u) => executeImageGenerate(a, u),
  todoist_create_task: (a, u) => executeTodoistCreateTask(a, u),
  todoist_list_tasks: (a) => executeTodoistListTasks(a),
  todoist_complete_task: (a) => executeTodoistCompleteTask(a),
  kanban_create_task: (a, u) => executeKanbanCreateTask(a, u),
  task_queue_manage: (a, u) => executeTaskQueueManage(a, u),
  work_journal_manage: (a, u) => executeWorkJournalManage(a, u),
  devops_intelligence: (a, u) => executeDevOpsIntelligence(a, u),
  dgm_manage: (a, u) => executeDgmManage(a, u),
  devmax_db: (a) => executeDevmaxDb(a),
  dashboard_screenshot: (a) => executeDashboardScreenshot(a),
  analyze_file: (a, u) => executeAnalyzeFile(a, u),
  analyze_invoice: (a, u) => executeAnalyzeInvoice(a, u),
  generate_file: (a, u) => executeGenerateFile(a, u),
  manage_3d_file: (a, u) => executeManage3DFile(a, u),
  export_analysis: (a, u) => executeExportAnalysis(a, u),
  export_invoice_excel: (a, u) => executeExportInvoiceExcel(a, u),
  generate_invoice_pdf: (a, u) => executeGenerateInvoicePdf(a, u),
  notion_manage: (a) => executeNotionManage(a),
  drive_manage: (a) => executeDriveManage(a),
  analyze_video: (a) => executeVideoAnalysis(a),
  navigation_manage: (a, u) => executeNavigationManage(a, u),
  monitoring_manage: (a) => executeMonitoringManage(a),
  trading_alerts: (a, u) => executeTradingAlerts(a, u),
  manage_sugu_bank: (a) => executeSuguBankManagement(a),
  manage_sugu_purchases: (a) => executeSuguPurchasesManagement(a),
  manage_sugu_expenses: (a) => executeSuguExpensesManagement(a),
  manage_sugu_files: (a) => executeSuguFilesManagement(a),
  manage_sugu_employees: (a) => executeSuguEmployeesManagement(a),
  manage_sugu_payroll: (a) => executeSuguPayrollManagement(a),
  search_sugu_data: (a) => executeSearchSuguData(a),
  sugu_full_overview: (a) => executeSuguFullOverview(a),
  compute_business_health: (a) => executeBusinessHealth(a),
  detect_anomalies: (a) => executeDetectAnomalies(a),
  query_hubrise: (a) => executeQueryHubrise(a),
  manage_feature_flags: (a) => executeManageFeatureFlags(a),
  search_nearby_places: (a, u) => executeSearchNearbyPlaces(a as any, u),
  geocode_address: (a) => executeGeocodeAddress(a as any),
  query_bets_tracker: (a, u) => executeBetsTrackerQuery(a, u),
  query_sugu_analytics: (a) => executeSuguAnalyticsQuery(a),
  query_daily_summary: (a, u) => executeDailySummaryQuery(a, u),
  commax_manage: (a, u) => executeCommaxManage(a, u),
  screen_monitor_manage: (a, u) => executeScreenMonitorManage(a, u),
  generate_morning_briefing: (a) => executeGenerateMorningBriefing(a),
  generate_financial_report: (a) => executeGenerateFinancialReport(a),
  analyze_document_image: (a) => executeAnalyzeDocumentImage(a),
  import_bank_statement: (a) => executeImportBankStatement(a),
  manage_telegram_bot: (a) => executeManageTelegramBot(a),
  query_app_data: (a) => executeQueryAppData(a),
  query_apptoorder: (a) => executeQueryAppToOrder(a),
  query_coba: (a) => executeQueryCoba(a),
  coba_business: (a) => executeCobaBusinessTool(a),
  sensory_hub: (a, u) => executeSensoryHub(a, u),
  generate_self_reflection: (_a, u) => executeGenerateSelfReflection(u),
  manage_ai_system: (a, u) => executeManageAISystem(a, u),
  app_navigate: (a, u) => executeAppNavigate(a, u),
  devops_github: (a) => executeDevopsGithub(a),
  devops_server: (a) => executeDevopsServer(a),
  pdf_master: (a) => executePdfMaster(a),
  face_recognize: (a) => executeBridge("faceRecognize", a),
  speaker_identify: (a) => executeBridge("speakerIdentify", a),
  translate_text: (a) => executeBridge("translate", a),
  audio_translate: (a) => executeBridge("audioTranslate", a),
  image_edit: (a) => executeBridge("imageEditTool", a),
  predictive_intelligence: (a) => executeBridge("predictiveIntelligence", a),
  deep_research: (a) => executeBridge("deepResearch", a),
  decision_coach: (a) => executeBridge("decisionCoach", a),
  sentiment_analyze: (a) => executeBridge("sentimentAnalyze", a),
  push_notify: (a) => executeBridge("pushNotify", a),
  parse_invoice: (a) => executeBridge("parseInvoice", a),
  parse_payroll: (a) => executeBridge("parsePayroll", a),
  generate_report: (a) => executeBridge("generateReport", a),
  value_bets: (a) => executeBridge("valueBets", a),
  sports_prediction: (a) => executeBridge("sportsPrediction", a),
  memory_graph: (a) => executeBridge("memoryGraph", a),
  rag_search: (a) => executeBridge("ragSearch", a),
  self_awareness: (a) => executeBridge("selfAwareness", a),
  screenshot_url: (a) => executeBridge("screenshotUrl", a),
  browse_web: (a) => executeBridge("browseWeb", a),
  photo_search: (a) => executeBridge("photoSearch", a),
  system_metrics: (a) => executeBridge("systemMetrics", a),
  cloudflare_manage: (a) => executeBridge("cloudflareManage", a),
  code_snapshot: (a) => executeBridge("codeSnapshot", a),
  codebase_analyze: (a) => executeBridge("codebaseAnalyze", a),
  style_guide_extract: (a) => executeBridge("styleGuideExtract", a),
  homework_intelligence: (a) => executeBridge("homeworkIntelligence", a),
  calendar_anticipation: (a) => executeBridge("calendarAnticipation", a),
  usage_analytics: (a) => executeBridge("usageAnalytics", a),
  conversation_prefs: (a) => executeBridge("conversationPrefs", a),
  file_convert: (a) => executeFileConvert(a),
  file_compress: (a) => executeFileCompress(a),
  spreadsheet_analyze: (a) => executeSpreadsheetAnalyze(a),
  document_compare: (a) => executeDocumentCompare(a),
  qr_code_generate: (a) => executeQrCodeGenerate(a),
  ocr_extract: (a) => executeOcrExtract(a),
  tools_checkup: (a) => executeToolsCheckup(a),
  vision_live_analyze: (a) => executeVisionLiveAnalyze(a),
  digital_twin_snapshot: (a) => executeDigitalTwinSnapshot(a),
  digital_twin_simulate: (a) => executeDigitalTwinSimulate(a),
  autonomous_execute: (a, u) => executeAutonomousAgent(a, u),
  voice_synthesize: (a) => executeVoiceSynthesize(a),
  voice_status: () => executeVoiceStatus(),
};

async function executeEmailReply(args: Record<string, any>): Promise<string> {
  try {
    const { googleMailService } = await import('./googleMailService');
    const connected = await googleMailService.isConnected();
    if (!connected) {
      return JSON.stringify({ error: "Gmail non connecté. Reconnecte l'intégration Google Mail." });
    }
    const result = await googleMailService.sendReply({
      to: args.to,
      subject: args.subject,
      body: args.body,
      inReplyTo: args.in_reply_to,
      originalBody: args.original_body,
      originalFrom: args.original_from,
      originalDate: args.original_date,
    });
    return JSON.stringify({ type: 'email_replied', success: true, from: 'ulyssemdbh@gmail.com', to: args.to, messageId: result.messageId });
  } catch (err: any) {
    console.error(`[EmailReply] Error: ${err.message}`);
    return JSON.stringify({ error: `Échec de la réponse Gmail: ${err.message}` });
  }
}

async function executeEmailForward(args: Record<string, any>): Promise<string> {
  try {
    const { googleMailService } = await import('./googleMailService');
    const connected = await googleMailService.isConnected();
    if (!connected) {
      return JSON.stringify({ error: "Gmail non connecté. Reconnecte l'intégration Google Mail." });
    }
    const result = await googleMailService.sendForward({
      to: args.to,
      subject: args.subject,
      forwardNote: args.forward_note,
      originalFrom: args.original_from,
      originalDate: args.original_date,
      originalBody: args.original_body,
    });
    return JSON.stringify({ type: 'email_forwarded', success: true, from: 'ulyssemdbh@gmail.com', to: args.to, messageId: result.messageId });
  } catch (err: any) {
    console.error(`[EmailForward] Error: ${err.message}`);
    return JSON.stringify({ error: `Échec du transfert Gmail: ${err.message}` });
  }
}

// Exported for ActionHubBridge integration
export async function executeToolCallV2Internal(toolName: string, args: Record<string, any>, userId: number): Promise<string> {
  const handler = TOOL_REGISTRY[toolName];
  if (handler) {
    return handler(args, userId);
  }
  return JSON.stringify({ error: `Fonction inconnue: ${toolName}` });
}

// === TOOL IMPLEMENTATIONS ===

async function executeSuguvalQuery(args: { restaurant: string; action: string; limit?: number }): Promise<string> {
  const suguvalService = await loadService('suguval');
  if (!suguvalService) return JSON.stringify({ error: "Service Suguval non disponible" });

  const { restaurant, action, limit = 50 } = args;
  const result = await suguvalService.executeActions([
    { type: action === 'current_list' ? 'consult' : 'history', restaurant: restaurant as any, limit }
  ]);
  if (result.length === 0) return JSON.stringify({ error: "Aucun résultat" });
  const r = result[0];
  if (!r.success) return JSON.stringify({ error: r.error || "Erreur" });

  if (action === 'top_products' && r.type === 'history' && 'data' in r && r.data) {
    const historyData = r.data as { entries: Array<{ itemsList: string }> };
    const productCounts: Record<string, number> = {};
    for (const entry of historyData.entries) {
      const items = entry.itemsList.split(', ');
      for (const item of items) {
        const cleanItem = item.trim().toLowerCase();
        if (cleanItem) productCounts[cleanItem] = (productCounts[cleanItem] || 0) + 1;
      }
    }
    const sorted = Object.entries(productCounts).sort((a, b) => b[1] - a[1]).slice(0, 20);
    return JSON.stringify({ type: 'top_products', restaurant, topProducts: sorted.map(([name, count]) => ({ name, occurrences: count })) });
  }
  return JSON.stringify(r);
}

async function executeGetSuguvalChecklist(args: { restaurant?: string }): Promise<string> {
  try {
    const restaurant = args.restaurant || "suguval";
    const { suguvalService } = await import("./suguvalService");
    
    if (restaurant === "suguval") {
      const categories = await suguvalService.getCategoriesWithItems();
      const todayChecks = await suguvalService.getTodayChecks();
      const checkedItems = await suguvalService.getCheckedItemsForToday();
      
      const today = new Date().toLocaleString("en-CA", { timeZone: "Europe/Paris" }).split(",")[0];
      const totalItems = categories.reduce((acc: number, cat: any) => acc + cat.items.length, 0);

      const byZone: Record<string, { category: string; items: string[] }[]> = {};
      for (const item of checkedItems) {
        const zoneName = item.zoneName || "AUTRE";
        if (!byZone[zoneName]) byZone[zoneName] = [];
        let catGroup = byZone[zoneName].find((g: any) => g.category === item.categoryName);
        if (!catGroup) { catGroup = { category: item.categoryName, items: [] }; byZone[zoneName].push(catGroup); }
        catGroup.items.push(item.itemName);
      }

      return JSON.stringify({
        source: "base_de_données_réelle",
        restaurant: "SUGU Valentine",
        date: today,
        totalItems,
        checkedCount: checkedItems.length,
        completionRate: totalItems > 0 ? Math.round((checkedItems.length / totalItems) * 100) : 0,
        checkedByZone: byZone,
        checkedItemsList: checkedItems.map((i: any) => ({ name: i.itemName, category: i.categoryName, zone: i.zoneName })),
        warning: checkedItems.length === 0 ? "Aucun article coché aujourd'hui. Si Maurice demande la liste, explique qu'aucun article n'est encore coché dans la checklist." : undefined
      });
    }
    if (restaurant === "sugumaillane") {
      const { sugumaillaneService } = await import("./sugumaillaneService");
      const categories = await sugumaillaneService.getAllCategories();
      const checkedItems = await sugumaillaneService.getCheckedItemsForToday();
      
      const today = new Date().toLocaleString("en-CA", { timeZone: "Europe/Paris" }).split(",")[0];
      const totalItems = categories.reduce((acc: number, cat: any) => acc + (cat.items?.length || 0), 0);

      const byZone: Record<string, { category: string; items: string[] }[]> = {};
      for (const item of checkedItems) {
        const zoneName = item.zoneName || "AUTRE";
        if (!byZone[zoneName]) byZone[zoneName] = [];
        let catGroup = byZone[zoneName].find((g: any) => g.category === item.categoryName);
        if (!catGroup) { catGroup = { category: item.categoryName, items: [] }; byZone[zoneName].push(catGroup); }
        catGroup.items.push(item.itemName);
      }

      return JSON.stringify({
        source: "base_de_données_réelle",
        restaurant: "SUGU Maillane",
        date: today,
        totalItems,
        checkedCount: checkedItems.length,
        completionRate: totalItems > 0 ? Math.round((checkedItems.length / totalItems) * 100) : 0,
        checkedByZone: byZone,
        checkedItemsList: checkedItems.map((i: any) => ({ name: i.itemName, category: i.categoryName, zone: i.zoneName })),
        warning: checkedItems.length === 0 ? "Aucun article coché aujourd'hui pour Maillane." : undefined
      });
    }
    return JSON.stringify({ error: `Restaurant inconnu: ${restaurant}. Restaurants disponibles: suguval, sugumaillane.` });
  } catch (error: any) {
    return JSON.stringify({ error: `Erreur lecture checklist: ${error.message}` });
  }
}

async function executeSendSuguvalShoppingList(args: { restaurant?: string; to?: string; includeStats?: boolean }): Promise<string> {
  try {
    const restaurant = args.restaurant || "suguval";
    const toEmail = args.to || "djedoumaurice@gmail.com";
    const includeStats = args.includeStats !== false;
    
    const isMaillane = restaurant === "sugumaillane";
    const restaurantLabel = isMaillane ? "SUGU Maillane" : "SUGU Valentine";
    
    let checkedItems: any[];
    let weeklyStatsGetter: (() => Promise<any>) | null = null;

    if (isMaillane) {
      const { sugumaillaneService } = await import("./sugumaillaneService");
      checkedItems = await sugumaillaneService.getCheckedItemsForToday();
      weeklyStatsGetter = () => sugumaillaneService.getWeeklyStats();
    } else {
      const { suguvalService } = await import("./suguvalService");
      checkedItems = await suguvalService.getCheckedItemsForToday();
      weeklyStatsGetter = () => suguvalService.getWeeklyStats();
    }
    
    const today = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const todayISO = new Date().toLocaleString("en-CA", { timeZone: "Europe/Paris" }).split(",")[0];

    const byZone: Record<string, Record<string, string[]>> = {};
    for (const item of checkedItems) {
      const zoneName = item.zoneName || "AUTRE";
      if (!byZone[zoneName]) byZone[zoneName] = {};
      if (!byZone[zoneName][item.categoryName]) byZone[zoneName][item.categoryName] = [];
      byZone[zoneName][item.categoryName].push(item.itemName);
    }

    let emailBody = `Salut Maurice,\n\nVoici la liste de courses relevée pour ${restaurantLabel}.\n\n`;
    emailBody += `🧾 RÉSUMÉ\n`;
    emailBody += `• Restaurant : ${restaurantLabel}\n`;
    emailBody += `• Date : ${today}\n`;
    emailBody += `• Nombre d'articles cochés : ${checkedItems.length}\n\n`;

    if (checkedItems.length === 0) {
      emailBody += `⚠️ Aucun article n'a été coché aujourd'hui dans la checklist.\n`;
      emailBody += `Ouvre l'app ${isMaillane ? "Sugumaillane" : "Suguval"} pour cocher les articles à commander.\n\n`;
    } else {
      emailBody += `📂 DÉTAIL PAR ZONE\n\n`;
      const ZONE_ORDER = ["CUISINE", "SUSHI BAR", "RÉSERVE SÈCHE", "HYGIÈNE & CONSOMMABLES", "BOISSONS", "LIVRAISON & EMBALLAGES"];
      const sortedZones = [...ZONE_ORDER.filter(z => byZone[z]), ...Object.keys(byZone).filter(z => !ZONE_ORDER.includes(z))];
      
      for (const zone of sortedZones) {
        const categories = byZone[zone];
        const zoneTotal = Object.values(categories).reduce((s, items) => s + items.length, 0);
        emailBody += `═══ ${zone} (${zoneTotal} article${zoneTotal > 1 ? "s" : ""}) ═══\n`;
        for (const [cat, items] of Object.entries(categories)) {
          if (cat !== zone) emailBody += `  ${cat}:\n`;
          for (const item of items) {
            emailBody += `    • ${item}\n`;
          }
        }
        emailBody += `\n`;
      }
    }

    if (includeStats && weeklyStatsGetter) {
      try {
        const weeklyStats = await weeklyStatsGetter();
        emailBody += `📊 STATS HEBDO\n`;
        emailBody += `• Taux moyen de complétion : ${weeklyStats.summary.averageCompletion}%\n`;
        emailBody += `• Articles cochés/jour : ${weeklyStats.summary.averageCheckedItems}\n`;
        emailBody += `• Jours actifs : ${weeklyStats.summary.daysWithActivity}/7\n\n`;
      } catch {}
    }

    emailBody += `---\nEnvoyé par Ulysse • Système de gestion ${restaurantLabel}`;

    const { emailActionService } = await import("./emailActionService");
    const results = await emailActionService.executeActions([{
      type: "send",
      to: toEmail,
      subject: `🧾 Liste de courses ${restaurantLabel} – ${todayISO}`,
      body: emailBody
    }], 'ulysse', 1);

    const success = results[0]?.success ?? false;
    if (success) {
      return JSON.stringify({
        success: true,
        message: `Email envoyé à ${toEmail} avec ${checkedItems.length} articles`,
        itemCount: checkedItems.length,
        destination: toEmail,
        format: "professionnel_groupé_par_zone"
      });
    } else {
      return JSON.stringify({ error: `Échec envoi email: ${results[0]?.error || "erreur inconnue"}` });
    }
  } catch (error: any) {
    return JSON.stringify({ error: `Erreur envoi liste: ${error.message}` });
  }
}

async function executeSportsQuery(args: { query_type: string; league?: string; team?: string; date?: string }): Promise<string> {
  const sportsService = await loadService('sports');
  if (!sportsService) return JSON.stringify({ error: "Service Sports non disponible" });

  const { query_type, league, team, date } = args;
  const targetDate = date ? new Date(date) : new Date();

  // Team name aliases for common abbreviations
  const teamAliases: Record<string, string[]> = {
    'marseille': ['om', 'olympique marseille', 'olympique de marseille', 'marseille'],
    'paris saint-germain': ['psg', 'paris', 'paris saint germain', 'paris sg'],
    'lyon': ['ol', 'olympique lyonnais', 'olympique lyon', 'lyon'],
    'monaco': ['as monaco', 'asm', 'monaco'],
    'lille': ['losc', 'lille osc', 'lille'],
    'nice': ['ogc nice', 'ogcn', 'nice'],
    'lens': ['rc lens', 'rcl', 'lens'],
    'rennes': ['stade rennais', 'srfc', 'rennes'],
    'real madrid': ['real', 'real madrid', 'madrid'],
    'barcelona': ['barça', 'barca', 'fcb', 'barcelona'],
    'manchester city': ['man city', 'city', 'manchester city', 'mci'],
    'manchester united': ['man utd', 'united', 'manchester united', 'manu'],
    'liverpool': ['lfc', 'liverpool'],
    'arsenal': ['afc', 'arsenal', 'gunners'],
    'chelsea': ['cfc', 'chelsea', 'blues'],
    'juventus': ['juve', 'juventus'],
    'inter': ['inter milan', 'inter', 'internazionale'],
    'ac milan': ['milan', 'ac milan', 'rossoneri'],
    'bayern': ['bayern munich', 'bayern', 'fcb', 'bayern münchen'],
    'dortmund': ['bvb', 'borussia dortmund', 'dortmund']
  };
  
  // Function to match team name with aliases
  const matchTeamName = (searchTerm: string, teamName: string): boolean => {
    const searchLower = searchTerm.toLowerCase().trim();
    const teamLower = teamName.toLowerCase().trim();
    
    // Direct match
    if (teamLower.includes(searchLower) || searchLower.includes(teamLower)) return true;
    
    // Check aliases
    for (const [canonical, aliases] of Object.entries(teamAliases)) {
      if (aliases.some(a => a.toLowerCase() === searchLower || searchLower.includes(a.toLowerCase()))) {
        if (teamLower.includes(canonical) || aliases.some(a => teamLower.includes(a.toLowerCase()))) {
          return true;
        }
      }
    }
    return false;
  };

  switch (query_type) {
    case 'next_match': {
      // Search for next match of a specific team over the next 14 days
      if (!team) return JSON.stringify({ error: "Paramètre 'team' requis pour next_match" });
      
      try {
        // Get upcoming matches from cache for the next 14 days
        const upcomingMatches = await sportsService.getUpcomingMatches(league || 'Football', 14);
        
        // Filter by team name with aliases
        const teamMatches = upcomingMatches.filter((m: any) => 
          matchTeamName(team, m.homeTeam) || matchTeamName(team, m.awayTeam)
        );
        
        if (teamMatches.length === 0) {
          // If no matches found in cache, try to get matches for next 7 days from API
          console.log(`[SPORTS-TOOL] No cache matches for ${team}, searching next 7 days...`);
          
          const foundMatches: any[] = [];
          for (let i = 0; i < 7; i++) {
            const checkDate = new Date();
            checkDate.setDate(checkDate.getDate() + i);
            
            try {
              const dayMatches = await sportsService.getMatchesForDate(checkDate);
              const teamDayMatches = dayMatches.filter((m: any) => 
                matchTeamName(team, m.homeTeam) || matchTeamName(team, m.awayTeam)
              );
              foundMatches.push(...teamDayMatches);
              
              // Stop at first found match to save API calls
              if (foundMatches.length > 0) break;
            } catch (err) {
              console.error(`[SPORTS-TOOL] Error checking date ${checkDate.toISOString()}:`, err);
            }
          }
          
          if (foundMatches.length > 0) {
            const match = foundMatches[0];
            const matchDate = new Date(match.date || match.matchDate);
            const dayNames = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
            const monthNames = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
            
            return JSON.stringify({ 
              type: 'next_match', 
              team,
              found: true, 
              match: {
                homeTeam: match.homeTeam,
                awayTeam: match.awayTeam,
                date: match.date || match.matchDate,
                dateFormatted: `${dayNames[matchDate.getDay()]} ${matchDate.getDate()} ${monthNames[matchDate.getMonth()]} ${matchDate.getFullYear()}`,
                time: matchDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
                league: match.league,
                competition: match.league
              },
              message: `Prochain match de ${team} trouvé via API`
            });
          }
          
          return JSON.stringify({ 
            type: 'next_match', 
            team,
            found: false, 
            message: `Aucun match à venir trouvé pour ${team} dans les 7 prochains jours. Vérifie les données homework pour les matchs à venir.`
          });
        }
        
        // Sort by date and get the nearest one
        const sortedMatches = teamMatches.sort((a: any, b: any) => 
          new Date(a.date).getTime() - new Date(b.date).getTime()
        );
        
        const nextMatch = sortedMatches[0];
        const matchDate = new Date(nextMatch.date);
        const dayNames = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
        const monthNames = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
        
        return JSON.stringify({ 
          type: 'next_match', 
          team,
          found: true,
          match: {
            homeTeam: nextMatch.homeTeam,
            awayTeam: nextMatch.awayTeam,
            date: nextMatch.date,
            dateFormatted: `${dayNames[matchDate.getDay()]} ${matchDate.getDate()} ${monthNames[matchDate.getMonth()]} ${matchDate.getFullYear()}`,
            time: matchDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
            league: nextMatch.league,
            competition: nextMatch.league
          },
          upcomingCount: sortedMatches.length,
          message: `Prochain match de ${team}: ${nextMatch.homeTeam} vs ${nextMatch.awayTeam}`
        });
      } catch (error: any) {
        console.error('[SPORTS-TOOL] Error in next_match:', error);
        return JSON.stringify({ error: `Erreur lors de la recherche: ${error.message}` });
      }
    }
    case 'today_matches':
    case 'upcoming_matches': {
      const matches = await sportsService.getMatchesForDate(targetDate);
      const filtered = matches.filter((m: any) => {
        if (league && !m.league.toLowerCase().includes(league.toLowerCase())) return false;
        if (team) {
          if (!matchTeamName(team, m.homeTeam) && !matchTeamName(team, m.awayTeam)) return false;
        }
        return true;
      });
      
      // If no matches found for the specific league, provide helpful feedback
      if (filtered.length === 0 && league) {
        const allLeagues = [...new Set(matches.map((m: any) => m.league))];
        const dateStr = targetDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
        
        return JSON.stringify({ 
          type: query_type, 
          date: targetDate.toISOString().split('T')[0], 
          matchCount: 0, 
          matches: [],
          noMatchesMessage: `Aucun match de ${league} trouvé pour ${dateStr}. ${allLeagues.length > 0 ? `Matchs disponibles dans: ${allLeagues.join(', ')}` : 'Aucun match en cache pour cette date.'}`,
          availableLeagues: allLeagues
        });
      }
      
      return JSON.stringify({ type: query_type, date: targetDate.toISOString().split('T')[0], matchCount: filtered.length, matches: filtered.slice(0, 15) });
    }
    case 'odds': {
      const matchesWithOdds = await sportsService.getMatchesWithOdds(targetDate);
      return JSON.stringify({ type: 'odds', matches: matchesWithOdds.slice(0, 10) });
    }
    case 'team_stats': {
      if (!team) return JSON.stringify({ error: "Paramètre 'team' requis" });
      const stats = await sportsService.getTeamStats(team);
      return JSON.stringify({ type: 'team_stats', team, stats });
    }
    case 'predictions': {
      try {
        const { probabilityModelService } = await import("./probabilityModelService");
        const predictions = await probabilityModelService.analyzeTodayMatches();
        return JSON.stringify({ type: 'predictions', predictions: predictions.slice(0, 10) });
      } catch (e) {
        return JSON.stringify({ error: "Service prédictions non disponible" });
      }
    }
    case 'recent_score': {
      // Get recent match score for a team
      if (!team) return JSON.stringify({ error: "Paramètre 'team' requis pour recent_score" });
      
      try {
        const result = await sportsService.getRecentMatchScore(team);
        return JSON.stringify({
          type: 'recent_score',
          team,
          found: result.found,
          match: result.match || null,
          message: result.message
        });
      } catch (e) {
        console.error(`[SPORTS-TOOL] Error getting recent score for ${team}:`, e);
        return JSON.stringify({ error: `Erreur lors de la récupération du score pour ${team}` });
      }
    }
    case 'team_info': {
      // Quick lookup: both next match and recent score
      if (!team) return JSON.stringify({ error: "Paramètre 'team' requis pour team_info" });
      
      try {
        const info = await sportsService.queryTeamInfo(team, 'both');
        return JSON.stringify({
          type: 'team_info',
          team,
          info
        });
      } catch (e) {
        console.error(`[SPORTS-TOOL] Error getting team info for ${team}:`, e);
        return JSON.stringify({ error: `Erreur lors de la récupération des infos pour ${team}` });
      }
    }
    case 'dashboard_info': {
      const leagueIds: Record<string, number> = {
        'Ligue 1': 61, 'Premier League': 39, 'La Liga': 140, 'Bundesliga': 78, 'Serie A': 135,
        'Champions League': 2, 'Europa League': 3, 'Conference League': 848,
        'Eredivisie': 88, 'Liga Portugal': 94, 'Jupiler Pro': 144, 'Super Lig': 203,
        'Championship': 40, 'Liga MX': 262, 'MLS': 253
      };
      return JSON.stringify({
        type: 'dashboard_info',
        url: '/sports/predictions',
        tabs: ['Matchs', 'Pronos', 'Classements', 'Buteurs', 'Blessures'],
        leagues: leagueIds,
        dataPerMatch: ['Cotes 1X2', 'Over/Under 2.5', 'BTTS', 'Double Chance', 'All Markets', 'Lineups', 'Events', 'API Prediction', 'H2H', 'Injuries'],
        predictionModel: 'Poisson + Stats + Cotes + Intelligence (Blessures, API Prediction, H2H)',
        tools: ['query_sports_data', 'query_match_intelligence', 'query_matchendirect', 'query_football_db'],
        apiStatus: {
          configured: process.env.API_FOOTBALL_KEY ? true : false,
          plan: 'Pro (7500 req/day)'
        }
      });
    }
    default:
      return JSON.stringify({ error: `Type inconnu: ${query_type}` });
  }
}

async function executeMatchIntelligence(args: { fixtureId?: number; homeTeamId?: number; awayTeamId?: number; leagueId?: number; include?: string[] }): Promise<string> {
  try {
    const { apiFootballService } = await import("./apiFootballService");
    if (!apiFootballService.isConfigured()) {
      return JSON.stringify({ error: "API Football non configurée" });
    }

    const { fixtureId, homeTeamId, awayTeamId, leagueId } = args;
    const includes = args.include || ["injuries", "lineups", "prediction", "topscorers"];
    const result: Record<string, any> = { type: "match_intelligence" };

    const fetches: Promise<void>[] = [];

    if (includes.includes("injuries") && fixtureId) {
      fetches.push(
        apiFootballService.getInjuries(undefined, undefined, fixtureId).then(injuries => {
          result.injuries = injuries.length > 0
            ? { count: injuries.length, details: apiFootballService.formatInjuries(injuries), raw: injuries.slice(0, 15) }
            : { count: 0, details: "Aucune blessure signalée pour ce match" };
        }).catch(() => { result.injuries = { count: 0, details: "Données non disponibles" }; })
      );
    } else if (includes.includes("injuries") && leagueId) {
      fetches.push(
        apiFootballService.getInjuries(leagueId, new Date().getFullYear()).then(injuries => {
          const relevantInjuries = injuries.filter(inj => {
            if (homeTeamId && inj.team.id === homeTeamId) return true;
            if (awayTeamId && inj.team.id === awayTeamId) return true;
            if (!homeTeamId && !awayTeamId) return true;
            return false;
          });
          result.injuries = {
            count: relevantInjuries.length,
            details: apiFootballService.formatInjuries(relevantInjuries),
            byTeam: {
              home: relevantInjuries.filter(i => homeTeamId && i.team.id === homeTeamId).map(i => ({ player: i.player.name, type: i.player.type, reason: i.player.reason })),
              away: relevantInjuries.filter(i => awayTeamId && i.team.id === awayTeamId).map(i => ({ player: i.player.name, type: i.player.type, reason: i.player.reason }))
            }
          };
        }).catch(() => { result.injuries = { count: 0, details: "Données non disponibles" }; })
      );
    }

    if (includes.includes("lineups") && fixtureId) {
      fetches.push(
        apiFootballService.getFixtureLineups(fixtureId).then(lineups => {
          result.lineups = lineups.length > 0
            ? { available: true, details: apiFootballService.formatLineups(lineups), formations: lineups.map(l => ({ team: l.team.name, formation: l.formation })) }
            : { available: false, details: "Compositions non encore disponibles (trop tôt avant le match)" };
        }).catch(() => { result.lineups = { available: false, details: "Données non disponibles" }; })
      );
    }

    if (includes.includes("prediction") && fixtureId) {
      fetches.push(
        apiFootballService.getFixturePrediction(fixtureId).then(pred => {
          if (pred) {
            result.apiPrediction = {
              winner: pred.predictions?.winner,
              winOrDraw: pred.predictions?.win_or_draw,
              underOver: pred.predictions?.under_over,
              goals: pred.predictions?.goals,
              advice: pred.predictions?.advice,
              percentHome: pred.predictions?.percent?.home,
              percentDraw: pred.predictions?.percent?.draw,
              percentAway: pred.predictions?.percent?.away,
              comparison: pred.comparison,
              h2h: pred.h2h?.slice(0, 5).map((m: any) => ({
                home: m.teams?.home?.name,
                away: m.teams?.away?.name,
                scoreHome: m.goals?.home,
                scoreAway: m.goals?.away,
                date: m.fixture?.date
              }))
            };
          } else {
            result.apiPrediction = { available: false, details: "Prédiction API non disponible pour ce match" };
          }
        }).catch(() => { result.apiPrediction = { available: false, details: "Données non disponibles" }; })
      );
    }

    if (includes.includes("events") && fixtureId) {
      fetches.push(
        apiFootballService.getFixtureEvents(fixtureId).then(events => {
          result.events = events.length > 0
            ? { count: events.length, details: apiFootballService.formatEvents(events) }
            : { count: 0, details: "Aucun événement (match pas encore joué ou pas de données)" };
        }).catch(() => { result.events = { count: 0, details: "Données non disponibles" }; })
      );
    }

    if (includes.includes("topscorers") && leagueId) {
      fetches.push(
        apiFootballService.getTopScorers(leagueId).then(scorers => {
          result.topScorers = scorers.length > 0
            ? { 
                count: scorers.length,
                top5: scorers.slice(0, 5).map((s, i) => ({
                  rank: i + 1,
                  name: s.player.name,
                  team: s.statistics[0]?.team?.name,
                  goals: s.statistics[0]?.goals?.total || 0,
                  assists: s.statistics[0]?.goals?.assists || 0,
                  matches: s.statistics[0]?.games?.appearences || 0
                }))
              }
            : { count: 0, details: "Classement non disponible" };
        }).catch(() => { result.topScorers = { count: 0, details: "Données non disponibles" }; })
      );
    }

    await Promise.all(fetches);

    const sections: string[] = ["=== INTELLIGENCE MATCH ==="];

    if (result.injuries) {
      sections.push(`\n--- BLESSURES (${result.injuries.count}) ---`);
      sections.push(result.injuries.details);
      if (result.injuries.byTeam) {
        if (result.injuries.byTeam.home?.length) sections.push(`Absents DOM: ${result.injuries.byTeam.home.map((i: any) => `${i.player} (${i.reason})`).join(', ')}`);
        if (result.injuries.byTeam.away?.length) sections.push(`Absents EXT: ${result.injuries.byTeam.away.map((i: any) => `${i.player} (${i.reason})`).join(', ')}`);
      }
    }

    if (result.lineups) {
      sections.push(`\n--- COMPOSITIONS ---`);
      sections.push(result.lineups.details);
    }

    if (result.apiPrediction && result.apiPrediction.advice) {
      sections.push(`\n--- PREDICTION API FOOTBALL ---`);
      sections.push(`Conseil: ${result.apiPrediction.advice}`);
      sections.push(`Favori: ${result.apiPrediction.winner?.name || 'N/A'} (${result.apiPrediction.percentHome || '?'}% / ${result.apiPrediction.percentDraw || '?'}% / ${result.apiPrediction.percentAway || '?'}%)`);
      if (result.apiPrediction.underOver) sections.push(`Under/Over: ${result.apiPrediction.underOver}`);
      if (result.apiPrediction.goals) sections.push(`Buts attendus: DOM ${result.apiPrediction.goals.home || '?'} - EXT ${result.apiPrediction.goals.away || '?'}`);
      if (result.apiPrediction.h2h?.length) {
        sections.push(`H2H récent: ${result.apiPrediction.h2h.map((h: any) => `${h.home} ${h.scoreHome}-${h.scoreAway} ${h.away}`).join(' | ')}`);
      }
    }

    if (result.events?.count > 0) {
      sections.push(`\n--- EVENTS (${result.events.count}) ---`);
      sections.push(result.events.details);
    }

    if (result.topScorers?.top5) {
      sections.push(`\n--- TOP BUTEURS LIGUE ---`);
      sections.push(result.topScorers.top5.map((s: any) => `${s.rank}. ${s.name} (${s.team}) - ${s.goals}B ${s.assists}A`).join('\n'));
    }

    sections.push(`\n--- NOTE ---`);
    sections.push(`Ces données alimentent le modèle Djedou Pronos (Poisson + Intelligence). Dashboard complet: /sports/predictions`);
    sections.push(`Impact blessures: 1-2 absents = -3%, 3+ absents = -6% sur probabilité équipe.`);
    sections.push(`API prediction cross-référencée à 15% du poids final. H2H: 3% par victoire de différence.`);

    result.formattedForAI = sections.join('\n');

    return JSON.stringify(result);
  } catch (error: any) {
    console.error('[MATCH-INTEL] Error:', error.message);
    return JSON.stringify({ error: `Erreur intelligence match: ${error.message}` });
  }
}

async function executeFootballDbQuery(args: { action: string; query?: string; team_id?: number; league_id?: number; season?: number }): Promise<string> {
  try {
    const { footballCacheService } = await import('./footballCacheService');
    const { action, query, team_id, league_id, season } = args;

    switch (action) {
      case "db_stats": {
        const stats = await footballCacheService.getDbStats();
        return JSON.stringify({
          source: "football_db",
          database: {
            standingsEntries: stats.standings,
            squadsCached: stats.squads,
            teamStatsCached: stats.stats,
            teamsInDb: stats.teams,
            seasonsAvailable: stats.seasons.map(s => `${s}/${s + 1}`),
          },
          strategy: "DB-first, API-fallback. Data persists 3 years.",
        });
      }
      case "search_team": {
        if (!query) return JSON.stringify({ error: "query parameter required for search_team" });
        const results = await footballCacheService.searchTeamInDb(query);
        return JSON.stringify({
          source: "football_db",
          query,
          results: results.map(r => ({
            apiTeamId: r.apiTeamId,
            name: r.teamName,
            league: r.apiLeagueId,
            logo: r.teamLogo,
          })),
          count: results.length,
        });
      }
      case "team_history": {
        if (!team_id) return JSON.stringify({ error: "team_id required for team_history" });
        const history = await footballCacheService.getTeamHistoryFromDb(team_id);
        return JSON.stringify({
          source: "football_db",
          team: history.team,
          standings: history.standingsByseason,
          stats: history.stats,
        });
      }
      case "league_standings": {
        if (!league_id) return JSON.stringify({ error: "league_id required for league_standings" });
        const s = season || (await import('./apiFootballService')).APIFootballService.getCurrentFootballSeason();
        const standings = await footballCacheService.getStandings(league_id, s);
        return JSON.stringify({
          source: "football_db",
          league: league_id,
          season: `${s}/${s + 1}`,
          standings: standings.slice(0, 20).map((t: any) => ({
            rank: t.rank,
            team: t.team?.name || t.teamName,
            points: t.points,
            played: t.all?.played || t.played,
            win: t.all?.win || t.win,
            draw: t.all?.draw || t.draw,
            lose: t.all?.lose || t.lose,
            gf: t.all?.goals?.for || t.goalsFor,
            ga: t.all?.goals?.against || t.goalsAgainst,
          })),
        });
      }
      case "league_history": {
        if (!league_id) return JSON.stringify({ error: "league_id required for league_history" });
        const history = await footballCacheService.getLeagueHistoryFromDb(league_id);
        return JSON.stringify({
          source: "football_db",
          league: league_id,
          seasons: history,
        });
      }
      default:
        return JSON.stringify({ error: `Unknown action: ${action}`, availableActions: ["search_team", "team_history", "league_standings", "league_history", "db_stats"] });
    }
  } catch (error: any) {
    console.error('[FOOTBALL-DB-TOOL] Error:', error.message);
    return JSON.stringify({ error: error.message, source: "football_db" });
  }
}

async function executeMatchEndirectQuery(args: { date?: string; league?: string }): Promise<string> {
  try {
    const { date = '', league = 'all' } = args;
    const targetDate = date ? date : formatTodayForMatchEndirect();
    
    // ======= CHECK FOOTDATAS FIRST (from homework injection) =======
    try {
      const { footdatasService } = await import('./footdatasService');
      const storedMatches = await footdatasService.getMatchesByDate(targetDate);
      
      if (storedMatches.length > 0) {
        console.log(`[MATCHENDIRECT-TOOL] 📦 Found ${storedMatches.length} stored matches for ${targetDate}`);
        
        // ======= STALE DATA DETECTION =======
        // If the date is in the past and we have "scheduled" matches, data is STALE - force refresh
        const [day, month, year] = targetDate.split('-').map(Number);
        const matchDate = new Date(year, month - 1, day, 23, 59, 59);
        const now = new Date();
        const dateIsPast = matchDate < now;
        
        const scheduledMatches = storedMatches.filter(m => 
          m.status === 'scheduled' || m.status === 'à venir' || m.status?.toLowerCase().includes('venir')
        );
        
        if (dateIsPast && scheduledMatches.length > 0) {
          console.log(`[MATCHENDIRECT-TOOL] ⚠️ STALE DATA DETECTED: ${scheduledMatches.length} "scheduled" matches for past date ${targetDate} - forcing refresh`);
          throw new Error('STALE_DATA_FORCE_REFRESH');
        }
        
        // Map league codes
        const leagueCodeMap: Record<string, string> = {
          ligue1: 'L1', laliga: 'LL', premierLeague: 'PL', bundesliga: 'BL', serieA: 'SA'
        };
        
        let filteredStored = storedMatches;
        if (league !== 'all') {
          const targetCode = leagueCodeMap[league] || league.toUpperCase();
          filteredStored = storedMatches.filter(m => m.leagueCode === targetCode);
        }
        
        if (filteredStored.length > 0) {
          const formattedMatches = filteredStored.map(m => ({
            competition: m.competition || m.leagueCode,
            home: m.homeTeamName,
            away: m.awayTeamName,
            score: m.homeScore !== null && m.awayScore !== null ? `${m.homeScore}-${m.awayScore}` : null,
            status: m.status,
            time: m.matchTime,
          }));
          
          const byLeague = {
            ligue1: storedMatches.filter(m => m.leagueCode === 'L1').length,
            laliga: storedMatches.filter(m => m.leagueCode === 'LL').length,
            premierLeague: storedMatches.filter(m => m.leagueCode === 'PL').length,
            bundesliga: storedMatches.filter(m => m.leagueCode === 'BL').length,
            serieA: storedMatches.filter(m => m.leagueCode === 'SA').length,
          };
          
          return JSON.stringify({
            type: 'matchendirect',
            date: targetDate,
            source: 'FootdatasService (homework injection from matchendirect.fr)',
            fromCache: true,
            totalMatches: storedMatches.length,
            big5Total: storedMatches.length,
            filteredLeague: league,
            matchCount: filteredStored.length,
            matches: formattedMatches,
            byLeague,
          });
        }
      }
    } catch (cacheErr: any) {
      if (cacheErr?.message !== 'STALE_DATA_FORCE_REFRESH') {
        console.log(`[MATCHENDIRECT-TOOL] Cache check failed, fetching live:`, cacheErr);
      }
    }
    
    // ======= FALLBACK: LIVE FETCH FROM MATCHENDIRECT.FR =======
    console.log(`[MATCHENDIRECT-TOOL] 🌐 Fetching live data for ${targetDate}`);
    const matchEndirectService = await import('./matchEndirectService');
    const result = await matchEndirectService.fetchMatchEndirect(targetDate);
    
    // Store to FootdatasService for future reuse
    try {
      const { footdatasService } = await import('./footdatasService');
      const syncResult = await footdatasService.storeMatchEndirectData(result);
      console.log(`[MATCHENDIRECT-TOOL] 📦 Synced to FootdatasService: ${syncResult.stored} stored, ${syncResult.updated} updated`);
    } catch (syncErr) {
      console.error(`[MATCHENDIRECT-TOOL] Sync error:`, syncErr);
    }
    
    let matches = result.big5Matches;
    if (league !== 'all' && league in result.byLeague) {
      matches = result.byLeague[league as keyof typeof result.byLeague];
    }
    
    const formattedMatches = matches.map(m => ({
      competition: m.competition,
      home: m.homeTeam,
      away: m.awayTeam,
      score: m.homeScore !== null && m.awayScore !== null ? `${m.homeScore}-${m.awayScore}` : null,
      status: m.status,
      time: m.time,
    }));
    
    return JSON.stringify({
      type: 'matchendirect',
      date: targetDate,
      source: 'matchendirect.fr (live)',
      fromCache: false,
      totalMatches: result.totalMatches,
      big5Total: result.big5Matches.length,
      filteredLeague: league,
      matchCount: matches.length,
      matches: formattedMatches,
      byLeague: {
        ligue1: result.byLeague.ligue1.length,
        laliga: result.byLeague.laliga.length,
        premierLeague: result.byLeague.premierLeague.length,
        bundesliga: result.byLeague.bundesliga.length,
        serieA: result.byLeague.serieA.length,
      }
    });
  } catch (error) {
    console.error('[MATCHENDIRECT-TOOL] Error:', error);
    return JSON.stringify({ error: `Erreur matchendirect: ${error instanceof Error ? error.message : 'Unknown'}` });
  }
}

function formatTodayForMatchEndirect(): string {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  return `${day}-${month}-${year}`;
}

async function executeBrainQuery(args: { query: string; category?: string; limit?: number }, userId: number): Promise<string> {
  const brainService = await loadService('brain');
  if (!brainService) return JSON.stringify({ error: "Service Brain non disponible" });

  const { query, category = 'all', limit = 10 } = args;
  const results = await brainService.searchKnowledge(userId, query, { category: category !== 'all' ? category : undefined, limit });
  return JSON.stringify({ 
    type: 'brain_search', 
    query, 
    resultCount: results.length, 
    results: results.map((r: any) => ({ title: r.title, content: r.content?.substring(0, 500), category: r.category })) 
  });
}

async function executeStockQuery(args: { symbol?: string; query_type: string }): Promise<string> {
  const tradingService = await loadService('trading');
  if (!tradingService) return JSON.stringify({ error: "Service Trading non disponible" });

  const { symbol, query_type } = args;
  if (query_type === 'analysis') {
    if (!symbol) return JSON.stringify({ error: "Paramètre 'symbol' requis" });
    const analysis = await tradingService.analyzeInstrument(symbol);
    if (!analysis) return JSON.stringify({ error: `Données non disponibles pour ${symbol}` });
    return JSON.stringify({ type: 'analysis', symbol, ...analysis });
  }
  if (query_type === 'daily_brief') {
    const brief = await tradingService.getDailyBrief();
    return JSON.stringify({ type: 'daily_brief', ...brief });
  }
  return JSON.stringify({ error: `Type inconnu: ${query_type}` });
}

async function executeCalendarList(args: { days_ahead?: number; max_results?: number }, userId: number): Promise<string> {
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
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

async function executeCalendarCreate(args: { title: string; start_datetime: string; end_datetime?: string; description?: string; location?: string }, userId: number): Promise<string> {
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
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

async function executeEmailList(args: { inbox?: string; limit?: number; unread_only?: boolean; query?: string }): Promise<string> {
  const { inbox = 'ulysse', limit = 15, query } = args;
  const persona = (inbox === 'iris' || inbox === 'alfred') ? inbox : 'ulysse';

  // Ulysse reads directly from Gmail via IMAP
  if (persona === 'ulysse') {
    try {
      const { gmailImapService } = await import('./gmailImapService');
      const messages = await gmailImapService.listMessages({ maxResults: limit, query });
      return JSON.stringify({
        type: 'email_list',
        inbox: 'ulyssemdbh@gmail.com',
        instruction: 'Pour lire un email, appelle email_read_message avec le uid correspondant. Ex: "gère le mail 2" → uid du mail position 2.',
        count: messages.length,
        emails: messages.map(m => ({
          position: m.position,
          uid: m.uid,
          from: m.from,
          subject: m.subject,
          date: m.date,
          unread: m.unread,
          hasAttachments: m.hasAttachments
        }))
      });
    } catch (err: any) {
      return JSON.stringify({ error: `Gmail IMAP: ${err.message}` });
    }
  }

  // Iris & Alfred use AgentMail
  const agentMailService = await loadService('agentMail');
  if (!agentMailService) return JSON.stringify({ error: "Service Email non disponible" });
  try {
    const threads = await agentMailService.listThreads(limit, persona);
    return JSON.stringify({
      type: 'email_list',
      inbox: `${persona}-assist@agentmail.to`,
      count: threads.length,
      emails: threads.map((t: any) => ({
        id: t.id,
        from: Array.isArray(t.senders) ? (t.senders[0]?.email || t.senders[0] || '') : '',
        subject: t.subject,
        date: t.timestamp,
        preview: t.preview
      }))
    });
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

async function executeEmailRead(args: { uid: number; folder?: string }): Promise<string> {
  try {
    const { gmailImapService } = await import('./gmailImapService');
    const msg = await gmailImapService.getMessage(args.uid, args.folder || 'INBOX');

    // For each PDF/office attachment, extract text content and save to uploads/
    const fs = await import('fs');
    const path = await import('path');
    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const enrichedAttachments = await Promise.all(
      (msg.attachments || []).map(async (att: any) => {
        const base: any = { filename: att.filename, size: att.size, contentType: att.contentType };

        if (!att.content) return base;

        const buf: Buffer = Buffer.isBuffer(att.content)
          ? att.content
          : Buffer.from(att.content);

        const isPdf = att.contentType?.includes('pdf') || att.filename?.toLowerCase().endsWith('.pdf');

        if (isPdf) {
          try {
            const pdfParse = (await import('pdf-parse')).default;
            const parsed = await pdfParse(buf);
            const extractedText = parsed.text?.trim().slice(0, 8000) || '';

            // Save to uploads so analyze_file can also access it
            const savedFilename = `${Date.now()}-${att.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
            const savedPath = path.join(uploadsDir, savedFilename);
            fs.writeFileSync(savedPath, buf);

            base.extractedText = extractedText;
            base.savedPath = `uploads/${savedFilename}`;
            base.pages = parsed.numpages;
          } catch (parseErr: any) {
            base.extractedText = null;
            base.parseError = `Impossible de lire le PDF : ${parseErr.message}`;
          }
        }

        return base;
      })
    );

    return JSON.stringify({ type: 'email_message', ...msg, attachments: enrichedAttachments });
  } catch (err: any) {
    return JSON.stringify({ error: `Gmail IMAP: ${err.message}` });
  }
}

async function executeEmailSend(args: { 
  to: string; 
  subject: string; 
  body: string; 
  from_inbox?: string;
  attachments?: Array<{ file_name: string }>;
}): Promise<string> {
  const agentMailService = await loadService('agentMail');

  const { to, subject, body, from_inbox = 'ulysse', attachments } = args;
  
  try {
    // Build attachments from generated files
    const emailAttachments: Array<{ filename: string; content: string | Buffer; contentType: string }> = [];
    
    if (attachments && attachments.length > 0) {
      const { getGeneratedFilesFromRegistry } = await import("./universalFileGenerator");
      const fs = await import("fs");
      const path = await import("path");
      const generatedFiles = getGeneratedFilesFromRegistry();
      
      for (const att of attachments) {
        const fileName = att.file_name;
        console.log(`[EmailSend] Looking for attachment: ${fileName}`);
        
        const ext = path.extname(fileName).toLowerCase();
        const mimeMap: Record<string, string> = {
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
          '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '.csv': 'text/csv', '.json': 'application/json'
        };
        const contentType = mimeMap[ext] || 'application/octet-stream';
        
        const fileInfo = generatedFiles.find(f => f.fileName === fileName || f.fileName.includes(fileName));
        
        if (fileInfo && fs.existsSync(fileInfo.filePath)) {
          const content = fs.readFileSync(fileInfo.filePath);
          emailAttachments.push({
            filename: fileName.endsWith(ext) ? fileName : `${fileName}${ext}`,
            content,
            contentType
          });
          console.log(`[EmailSend] ✅ Attached from registry: ${fileName} (${content.length} bytes)`);
        } else {
          const directPath = path.join(process.cwd(), 'generated_files', fileName);
          if (fs.existsSync(directPath)) {
            const content = fs.readFileSync(directPath);
            emailAttachments.push({ filename: fileName, content, contentType });
            console.log(`[EmailSend] ✅ Attached from direct path: ${fileName}`);
          } else {
            try {
              const { db } = await import("../db");
              const { ulysseFiles } = await import("@shared/schema");
              const { eq, like, desc } = await import("drizzle-orm");
              const { persistentStorageService } = await import("./persistentStorageService");
              
              const fileRecord = await db.select().from(ulysseFiles)
                .where(eq(ulysseFiles.filename, fileName))
                .orderBy(desc(ulysseFiles.id))
                .limit(1);
              
              if (!fileRecord.length) {
                const likeRecords = await db.select().from(ulysseFiles)
                  .where(like(ulysseFiles.filename, `%${fileName.replace(/^gen_/, '').replace(/\.png$/, '')}%`))
                  .orderBy(desc(ulysseFiles.id))
                  .limit(1);
                if (likeRecords.length) fileRecord.push(likeRecords[0]);
              }
              
              if (fileRecord.length && fileRecord[0].storagePath) {
                console.log(`[EmailSend] Found in DB: ${fileRecord[0].filename} → ${fileRecord[0].storagePath}`);
                const buffer = await persistentStorageService.downloadFile(fileRecord[0].storagePath);
                emailAttachments.push({
                  filename: fileName,
                  content: buffer,
                  contentType: fileRecord[0].mimeType || contentType
                });
                console.log(`[EmailSend] ✅ Attached from object storage: ${fileName} (${buffer.length} bytes)`);
              } else {
                console.warn(`[EmailSend] ⚠️ File not found anywhere: ${fileName}`);
              }
            } catch (storageErr: any) {
              console.warn(`[EmailSend] ⚠️ Object storage lookup failed for ${fileName}: ${storageErr.message}`);
            }
          }
        }
      }
    }
    
    // Ulysse sends via Gmail (ulyssemdbh@gmail.com); Iris & Alfred use AgentMail
    let result: any;
    if (from_inbox === 'ulysse' || !from_inbox) {
      const { googleMailService } = await import('./googleMailService');
      const connected = await googleMailService.isConnected();
      if (!connected) {
        return JSON.stringify({ error: "Gmail non connecté. Reconnecte l'intégration Google Mail." });
      }
      const gmailAttachments = emailAttachments.map(a => ({
        filename: a.filename,
        content: a.content as Buffer,
        contentType: a.contentType
      }));
      result = await googleMailService.sendWithAttachment({ 
        to, subject, body, 
        attachments: gmailAttachments.length > 0 ? gmailAttachments : undefined 
      });
    } else {
      if (!agentMailService) {
        return JSON.stringify({ error: "AgentMail non disponible pour " + from_inbox });
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
      from: from_inbox === 'ulysse' || !from_inbox ? 'ulyssemdbh@gmail.com' : `${from_inbox}-assist@agentmail.to`,
      messageId: result?.messageId || result?.id,
      attachmentsSent: emailAttachments.length
    });
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

async function executeSmartHomeControl(args: { action: string; device_name?: string; scene_name?: string; value?: number; color?: string }, userId: number): Promise<string> {
  const smartHomeService = await loadService('smarthome');
  if (!smartHomeService) {
    return JSON.stringify({ error: "Service Domotique non disponible. Configurez Philips Hue ou HomeKit." });
  }

  const { action, device_name, scene_name, value } = args;
  try {
    switch (action) {
      case 'list_devices': {
        const devices = await smartHomeService.getDevices(userId);
        return JSON.stringify({ type: 'device_list', count: devices.length, devices });
      }
      case 'turn_on':
      case 'turn_off': {
        if (!device_name) return JSON.stringify({ error: "device_name requis" });
        const result = await smartHomeService.controlDevice(userId, device_name, action === 'turn_on');
        return JSON.stringify({ type: 'device_control', success: result.success, device: device_name, action });
      }
      case 'set_brightness': {
        if (!device_name || value === undefined) return JSON.stringify({ error: "device_name et value requis" });
        const result = await smartHomeService.setBrightness(userId, device_name, value);
        return JSON.stringify({ type: 'brightness_set', success: result.success, device: device_name, brightness: value });
      }
      case 'activate_scene': {
        if (!scene_name) return JSON.stringify({ error: "scene_name requis" });
        const result = await smartHomeService.activateScene(userId, scene_name);
        return JSON.stringify({ type: 'scene_activated', success: result.success, scene: scene_name });
      }
      default:
        return JSON.stringify({ error: `Action inconnue: ${action}` });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

async function executeWeatherGet(args: { location?: string }): Promise<string> {
  const { location = 'Marseille' } = args;
  try {
    const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`);
    const geoData = await geoRes.json() as any;
    if (!geoData.results?.length) return JSON.stringify({ error: `Location "${location}" not found` });
    const { latitude, longitude } = geoData.results[0];
    const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code`);
    const weatherData = await weatherRes.json() as any;
    const current = weatherData.current;
    return JSON.stringify({ 
      type: 'weather', 
      location, 
      temperature: `${current.temperature_2m}°C`,
      humidity: `${current.relative_humidity_2m}%`,
      wind: `${current.wind_speed_10m} km/h`,
      weather_code: current.weather_code
    });
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

async function executeWebSearch(args: { query: string; max_results?: number }): Promise<string> {
  const searchService = await loadService('search');
  if (!searchService) {
    return JSON.stringify({ error: "Service Recherche non disponible" });
  }

  const { query, max_results = 5 } = args;
  try {
    const results = await searchService.orchestrateSearch(query, max_results);
    return JSON.stringify({ 
      type: 'web_search', 
      query, 
      resultCount: results.results?.length || 0, 
      results: results.results?.slice(0, max_results) || [], 
      directAnswers: results.directAnswers,
      success: results.success
    });
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

async function executeReadUrl(args: { url: string }): Promise<string> {
  try {
    const { smartFetch } = await import("./dynamicPageService");
    const result = await smartFetch(args.url);
    
    if (!result.success) {
      return JSON.stringify({ 
        error: result.error || "Impossible de lire cette URL",
        url: args.url
      });
    }
    
    // Limit content to avoid token overflow
    const maxChars = 15000;
    let content = result.content || "";
    const truncated = content.length > maxChars;
    if (truncated) {
      content = content.slice(0, maxChars) + "\n\n[... contenu tronqué ...]";
    }
    
    return JSON.stringify({
      type: 'read_url',
      url: args.url,
      urlFinal: result.urlFinal,
      method: result.method,
      contentLength: result.meta.contentLength,
      loadTimeMs: result.meta.loadTimeMs,
      truncated,
      content
    });
  } catch (err: any) {
    console.error('[read_url] Error:', err.message);
    return JSON.stringify({ 
      error: `Erreur lecture URL: ${err.message}`,
      url: args.url 
    });
  }
}

async function executeSpotifyControl(args: { action: string; query?: string; track_uri?: string; volume?: number; device_id?: string }, userId: number): Promise<string> {
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
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

async function executeDiscordSendMessage(args: { channel?: string; message: string }, userId: number): Promise<string> {
  try {
    const { discordBotService } = await import("./discordBotService");
    
    if (!discordBotService.isReady()) {
      return JSON.stringify({ error: "Bot Discord non connecté" });
    }
    
    const guilds = await discordBotService.getGuilds();
    if (guilds.length === 0) {
      return JSON.stringify({ error: "Bot n'est dans aucun serveur Discord" });
    }
    
    const channels = await discordBotService.getChannels(guilds[0].id);
    const targetChannelName = args.channel || "général";
    
    const channel = channels.find(c => 
      c.name === targetChannelName || 
      c.name === targetChannelName.replace("é", "e") ||
      c.name.toLowerCase() === targetChannelName.toLowerCase()
    );
    
    if (!channel) {
      return JSON.stringify({ 
        error: `Canal "${targetChannelName}" non trouvé`, 
        available_channels: channels.map(c => c.name) 
      });
    }
    
    const success = await discordBotService.sendMessage(channel.id, args.message);
    
    if (success) {
      console.log(`[Discord] Message envoyé dans #${channel.name}: ${args.message.substring(0, 50)}...`);
      return JSON.stringify({ 
        success: true, 
        channel: channel.name,
        server: guilds[0].name,
        message_preview: args.message.substring(0, 100)
      });
    } else {
      return JSON.stringify({ error: "Échec de l'envoi du message" });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

async function executeDiscordStatus(userId: number): Promise<string> {
  try {
    const { discordBotService } = await import("./discordBotService");
    
    const isReady = discordBotService.isReady();
    const botUsername = discordBotService.getBotUsername();
    const guilds = await discordBotService.getGuilds();
    
    let channels: { id: string; name: string }[] = [];
    let voiceChannels: { id: string; name: string; memberCount: number }[] = [];
    if (guilds.length > 0) {
      channels = await discordBotService.getChannels(guilds[0].id);
      voiceChannels = await discordBotService.getVoiceChannels(guilds[0].id);
    }
    
    return JSON.stringify({
      connected: isReady,
      botUsername,
      servers: guilds.map(g => g.name),
      textChannels: channels.map(c => c.name),
      voiceChannels: voiceChannels.map(vc => ({ name: vc.name, members: vc.memberCount }))
    });
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

async function getDiscordChannelId(channelName: string): Promise<{ channelId: string; guildId: string } | null> {
  const { discordBotService } = await import("./discordBotService");
  
  if (!discordBotService.isReady()) return null;
  
  const guilds = await discordBotService.getGuilds();
  if (guilds.length === 0) return null;
  
  const channels = await discordBotService.getChannels(guilds[0].id);
  const targetName = channelName || "général";
  
  const channel = channels.find(c => 
    c.name === targetName || 
    c.name === targetName.replace("é", "e") ||
    c.name.toLowerCase() === targetName.toLowerCase()
  );
  
  if (!channel) return null;
  return { channelId: channel.id, guildId: guilds[0].id };
}

async function executeDiscordAddReaction(args: { channel?: string; message_id: string; emoji: string }, userId: number): Promise<string> {
  try {
    const { discordBotService } = await import("./discordBotService");
    
    const channelInfo = await getDiscordChannelId(args.channel || "général");
    if (!channelInfo) {
      return JSON.stringify({ error: "Canal Discord non trouvé ou bot non connecté" });
    }
    
    const success = await discordBotService.addReaction(channelInfo.channelId, args.message_id, args.emoji);
    
    if (success) {
      console.log(`[Discord] Réaction ${args.emoji} ajoutée au message ${args.message_id}`);
      return JSON.stringify({ success: true, emoji: args.emoji, message_id: args.message_id });
    } else {
      return JSON.stringify({ error: "Échec de l'ajout de la réaction" });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

async function executeDiscordRemoveReaction(args: { channel?: string; message_id: string; emoji: string }, userId: number): Promise<string> {
  try {
    const { discordBotService } = await import("./discordBotService");
    
    const channelInfo = await getDiscordChannelId(args.channel || "général");
    if (!channelInfo) {
      return JSON.stringify({ error: "Canal Discord non trouvé ou bot non connecté" });
    }
    
    const success = await discordBotService.removeReaction(channelInfo.channelId, args.message_id, args.emoji);
    
    if (success) {
      console.log(`[Discord] Réaction ${args.emoji} retirée du message ${args.message_id}`);
      return JSON.stringify({ success: true, emoji: args.emoji, message_id: args.message_id, removed: true });
    } else {
      return JSON.stringify({ error: "Échec du retrait de la réaction" });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

async function executeDiscordDeleteMessage(args: { channel?: string; message_id: string }, userId: number): Promise<string> {
  try {
    const { discordBotService } = await import("./discordBotService");
    
    const channelInfo = await getDiscordChannelId(args.channel || "général");
    if (!channelInfo) {
      return JSON.stringify({ error: "Canal Discord non trouvé ou bot non connecté" });
    }
    
    const success = await discordBotService.deleteMessage(channelInfo.channelId, args.message_id);
    
    if (success) {
      console.log(`[Discord] Message ${args.message_id} supprimé`);
      return JSON.stringify({ success: true, message_id: args.message_id, deleted: true });
    } else {
      return JSON.stringify({ error: "Échec de la suppression du message" });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

async function executeDiscordSendFile(args: { channel?: string; file_url: string; file_name: string; message?: string }, userId: number): Promise<string> {
  try {
    const { discordBotService } = await import("./discordBotService");
    
    const channelInfo = await getDiscordChannelId(args.channel || "général");
    if (!channelInfo) {
      return JSON.stringify({ error: "Canal Discord non trouvé ou bot non connecté" });
    }
    
    const success = await discordBotService.sendFile(channelInfo.channelId, args.file_url, args.file_name, args.message);
    
    if (success) {
      console.log(`[Discord] Fichier ${args.file_name} envoyé`);
      return JSON.stringify({ success: true, file_name: args.file_name, sent: true });
    } else {
      return JSON.stringify({ error: "Échec de l'envoi du fichier" });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

async function executeDiscordCreateInvitation(args: { channel?: string; max_age_hours?: number; max_uses?: number }, userId: number): Promise<string> {
  try {
    const { discordBotService } = await import("./discordBotService");
    
    const channelInfo = await getDiscordChannelId(args.channel || "général");
    if (!channelInfo) {
      return JSON.stringify({ error: "Canal Discord non trouvé ou bot non connecté" });
    }
    
    const maxAgeSeconds = (args.max_age_hours || 24) * 3600;
    const inviteUrl = await discordBotService.createInvitation(channelInfo.channelId, maxAgeSeconds, args.max_uses || 0);
    
    if (inviteUrl) {
      console.log(`[Discord] Invitation créée: ${inviteUrl}`);
      return JSON.stringify({ 
        success: true, 
        invitation_url: inviteUrl,
        expires_in_hours: args.max_age_hours || 24,
        max_uses: args.max_uses || "illimité"
      });
    } else {
      return JSON.stringify({ error: "Échec de la création de l'invitation" });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

async function executeDiscordVoiceStatus(userId: number): Promise<string> {
  try {
    const { discordBotService } = await import("./discordBotService");
    
    if (!discordBotService.isReady()) {
      return JSON.stringify({ error: "Bot Discord non connecté" });
    }
    
    const guilds = await discordBotService.getGuilds();
    if (guilds.length === 0) {
      return JSON.stringify({ error: "Bot n'est dans aucun serveur" });
    }
    
    const voiceChannels = await discordBotService.getVoiceChannels(guilds[0].id);
    
    const voiceStatus = await Promise.all(
      voiceChannels.map(async (vc) => {
        const members = await discordBotService.getVoiceChannelMembers(vc.id);
        return {
          channel: vc.name,
          members: members.map(m => m.username),
          member_count: members.length
        };
      })
    );
    
    return JSON.stringify({
      server: guilds[0].name,
      voice_channels: voiceStatus,
      total_in_voice: voiceStatus.reduce((sum, vc) => sum + vc.member_count, 0)
    });
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

async function executeSuperChatSearch(args: { query: string; limit?: number }, userId: number): Promise<string> {
  try {
    const { db } = await import("../db");
    const { superChatSessions, superChatMessages } = await import("@shared/schema");
    const { eq, desc, asc } = await import("drizzle-orm");

    const query = (args.query || "").toLowerCase();
    const maxResults = Math.min(args.limit || 5, 10);

    const sessions = await db.select()
      .from(superChatSessions)
      .where(eq(superChatSessions.userId, userId))
      .orderBy(desc(superChatSessions.lastMessageAt))
      .limit(20);

    const results = [];
    for (const session of sessions) {
      const msgs = await db.select()
        .from(superChatMessages)
        .where(eq(superChatMessages.sessionId, session.id))
        .orderBy(asc(superChatMessages.createdAt));

      const matches = msgs.filter(m => m.content.toLowerCase().includes(query));
      if (matches.length === 0 && !session.title?.toLowerCase().includes(query)) continue;

      const ulysseSynthesis = [...msgs].reverse().find(m => m.sender === "ulysse");
      const participants = [...new Set(msgs.filter(m => m.sender !== "user").map(m => m.senderName))];
      const userQuestions = msgs.filter(m => m.sender === "user").map(m => m.content.substring(0, 100));

      results.push({
        sessionId: session.id,
        title: session.title,
        date: session.lastMessageAt,
        participants,
        questions: userQuestions,
        synthesis: ulysseSynthesis?.content?.substring(0, 500) || "Pas de synthèse",
        relevantExcerpts: matches.slice(0, 3).map(m => ({
          from: m.senderName,
          excerpt: m.content.substring(0, 200)
        }))
      });

      if (results.length >= maxResults) break;
    }

    if (results.length === 0) {
      return JSON.stringify({ message: `Aucune discussion SuperChat trouvée pour "${args.query}"`, results: [] });
    }

    return JSON.stringify({
      message: `${results.length} discussion(s) SuperChat trouvée(s) pour "${args.query}"`,
      results
    });
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

async function executeMemorySave(args: { key: string; value: string; category?: string; importance?: number }, userId: number): Promise<string> {
  const brainService = await loadService('brain');
  if (!brainService) {
    return JSON.stringify({ error: "Service Brain non disponible" });
  }

  const { key, value, category = 'fact', importance = 50 } = args;
  try {
    await brainService.addKnowledge(userId, { 
      title: key, 
      content: value, 
      type: category as any, 
      category: 'personal', 
      importance, 
      confidence: 100 
    });
    return JSON.stringify({ type: 'memory_saved', success: true, key });
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

async function executeDgmManage(args: any, userId?: number): Promise<string> {
  try {
    const { db } = await import("../db");
    const { dgmSessions, dgmTasks } = await import("@shared/schema");
    const { eq, sql } = await import("drizzle-orm");
    const uid = userId || 1;

    switch (args.action) {
      case "status": {
        const repoFilter = args.repo_context
          ? sql`${dgmSessions.userId} = ${uid} AND ${dgmSessions.repoContext} = ${args.repo_context}`
          : eq(dgmSessions.userId, uid);
        const [session] = await db.select().from(dgmSessions).where(repoFilter).orderBy(sql`${dgmSessions.id} DESC`).limit(1);
        if (!session || !session.active) {
          return JSON.stringify({ action: "status", active: false, message: "DGM n'est pas actif" + (args.repo_context ? ` pour ${args.repo_context}` : "") });
        }
        const tasks = await db.select().from(dgmTasks).where(eq(dgmTasks.sessionId, session.id)).orderBy(sql`${dgmTasks.sortOrder} ASC`);
        return JSON.stringify({
          action: "status",
          active: true,
          sessionId: session.id,
          objective: session.objective,
          repoContext: session.repoContext,
          totalTasks: session.totalTasks,
          completedTasks: session.completedTasks,
          tasks: tasks.map(t => ({ id: t.id, title: t.title, status: t.status, testResult: t.testResult })),
        });
      }

      case "create_tasks": {
        const repoFilterCreate = args.repo_context
          ? sql`${dgmSessions.userId} = ${uid} AND ${dgmSessions.active} = true AND ${dgmSessions.repoContext} = ${args.repo_context}`
          : sql`${dgmSessions.userId} = ${uid} AND ${dgmSessions.active} = true`;
        const [session] = await db.select().from(dgmSessions).where(repoFilterCreate).orderBy(sql`${dgmSessions.id} DESC`).limit(1);
        if (!session) {
          return JSON.stringify({ error: "DGM n'est pas actif. Demande à Maurice d'activer le God Mode d'abord." });
        }
        if (!args.tasks?.length) {
          return JSON.stringify({ error: "Aucune tâche fournie" });
        }
        const created = [];
        for (let i = 0; i < args.tasks.length; i++) {
          const [task] = await db.insert(dgmTasks).values({
            sessionId: session.id,
            sortOrder: i,
            title: args.tasks[i].title,
            description: args.tasks[i].description || null,
            testCriteria: args.tasks[i].testCriteria || null,
          }).returning();
          created.push({ id: task.id, title: task.title, order: i });
        }
        await db.update(dgmSessions).set({ totalTasks: args.tasks.length }).where(eq(dgmSessions.id, session.id));
        console.log(`[DGM] Created ${created.length} tasks for session ${session.id}`);
        return JSON.stringify({ action: "create_tasks", success: true, count: created.length, tasks: created, rule: "Commence par la tâche 1 immédiatement. Ne passe à la suivante que quand elle est TERMINÉE et TESTÉE." });
      }

      case "start_task": {
        if (!args.taskId) return JSON.stringify({ error: "taskId requis" });
        const [updated] = await db.update(dgmTasks).set({ status: "running", startedAt: new Date() }).where(eq(dgmTasks.id, args.taskId)).returning();
        console.log(`[DGM] Task ${args.taskId} STARTED: ${updated?.title}`);
        return JSON.stringify({ action: "start_task", taskId: args.taskId, status: "running", title: updated?.title });
      }

      case "complete_task": {
        if (!args.taskId) return JSON.stringify({ error: "taskId requis" });
        const [updated] = await db.update(dgmTasks).set({
          status: "completed",
          completedAt: new Date(),
          codeChanges: args.codeChanges || null,
        }).where(eq(dgmTasks.id, args.taskId)).returning();
        console.log(`[DGM] Task ${args.taskId} COMPLETED: ${updated?.title}`);
        return JSON.stringify({ action: "complete_task", taskId: args.taskId, status: "completed", title: updated?.title, nextStep: "Tu dois maintenant TESTER cette tâche avant de passer à la suivante. Utilise test_task quand le test est validé." });
      }

      case "test_task": {
        if (!args.taskId) return JSON.stringify({ error: "taskId requis" });
        const [updated] = await db.update(dgmTasks).set({
          status: "tested",
          testedAt: new Date(),
          testResult: args.testResult || "Test validé",
        }).where(eq(dgmTasks.id, args.taskId)).returning();
        if (updated) {
          const completedCount = await db.select({ count: sql<number>`count(*)` }).from(dgmTasks)
            .where(sql`${dgmTasks.sessionId} = ${updated.sessionId} AND ${dgmTasks.status} IN ('tested', 'completed')`);
          const count = Number(completedCount[0]?.count || 0);
          await db.update(dgmSessions).set({ completedTasks: count }).where(eq(dgmSessions.id, updated.sessionId));
        }
        console.log(`[DGM] Task ${args.taskId} TESTED: ${updated?.title} — ${args.testResult || "OK"}`);
        return JSON.stringify({ action: "test_task", taskId: args.taskId, status: "tested", title: updated?.title, testResult: args.testResult, nextStep: "Tâche testée et validée. Tu peux maintenant passer à la tâche suivante." });
      }

      case "fail_task": {
        if (!args.taskId) return JSON.stringify({ error: "taskId requis" });
        const [updated] = await db.update(dgmTasks).set({
          status: "failed",
          error: args.error || "Échec non spécifié",
        }).where(eq(dgmTasks.id, args.taskId)).returning();
        console.log(`[DGM] Task ${args.taskId} FAILED: ${updated?.title} — ${args.error}`);
        return JSON.stringify({ action: "fail_task", taskId: args.taskId, status: "failed", error: args.error, title: updated?.title });
      }

      case "decompose_objective": {
        if (!args.objective) return JSON.stringify({ error: "objective requis" });
        const repoFilterDecompose = args.repo_context
          ? sql`${dgmSessions.userId} = ${uid} AND ${dgmSessions.active} = true AND ${dgmSessions.repoContext} = ${args.repo_context}`
          : sql`${dgmSessions.userId} = ${uid} AND ${dgmSessions.active} = true`;
        const [session] = await db.select().from(dgmSessions).where(repoFilterDecompose).orderBy(sql`${dgmSessions.id} DESC`).limit(1);
        if (!session) return JSON.stringify({ error: "DGM n'est pas actif. Active le God Mode d'abord." });

        const { dgmPipelineOrchestrator } = await import("./dgmPipelineOrchestrator");
        const decomposition = await dgmPipelineOrchestrator.decomposeObjective(args.objective, session.repoContext || "unknown");
        const tasks = await dgmPipelineOrchestrator.createPipelineTasks(session.id, decomposition);

        return JSON.stringify({
          action: "decompose_objective",
          success: true,
          version: "V2",
          objective: args.objective,
          complexity: decomposition.estimatedComplexity,
          estimatedMinutes: decomposition.estimatedDurationMinutes,
          taskCount: tasks.length,
          tasks,
          parallelGroups: decomposition.parallelGroups || [],
          nextStep: "V2: Objectif décomposé. Utilise 'run_parallel_pipeline' pour exécuter les tâches indépendantes en parallèle, ou 'run_pipeline' pour une tâche individuelle."
        });
      }

      case "run_pipeline": {
        if (!args.taskId) return JSON.stringify({ error: "taskId requis" });
        if (!args.files || !Array.isArray(args.files)) return JSON.stringify({ error: "files requis (array de {path, content})" });

        const [task] = await db.select().from(dgmTasks).where(eq(dgmTasks.id, args.taskId));
        if (!task) return JSON.stringify({ error: "Tâche introuvable" });

        const [session] = await db.select().from(dgmSessions).where(eq(dgmSessions.id, task.sessionId));
        if (!session) return JSON.stringify({ error: "Session introuvable" });

        const repoParts = (session.repoContext || "").split("/");
        const config = {
          owner: args.owner || repoParts[0] || "ulyssemdbh-commits",
          repo: args.repo || repoParts[1] || "",
          branch: args.branch || "main",
          autoMerge: args.autoMerge !== false,
          autoDeploy: args.autoDeploy || false,
          appName: args.appName || undefined,
          requireApproval: args.requireApproval || [],
        };

        await db.update(dgmTasks).set({ status: "running", startedAt: new Date() }).where(eq(dgmTasks.id, args.taskId));

        const { dgmPipelineOrchestrator } = await import("./dgmPipelineOrchestrator");
        const result = await dgmPipelineOrchestrator.runFullPipeline(
          session.id, args.taskId, config, args.files, args.message || `[DGM] ${task.title}`
        );

        return JSON.stringify({
          action: "run_pipeline",
          version: "V2",
          taskId: args.taskId,
          title: task.title,
          finalStatus: result.finalStatus,
          stages: Object.fromEntries(
            Object.entries(result.stages).map(([k, v]) => [k, { success: v.success, error: v.error, requiresApproval: v.requiresApproval, durationMs: v.durationMs }])
          ),
          prUrl: result.stages.pr_creation?.data?.prUrl,
          prNumber: result.stages.pr_creation?.data?.prNumber,
          metrics: result.metrics,
        });
      }

      case "run_parallel_pipeline": {
        if (!args.taskIds?.length) return JSON.stringify({ error: "taskIds requis (array d'IDs de tâches)" });
        const [firstTask] = await db.select().from(dgmTasks).where(eq(dgmTasks.id, args.taskIds[0]));
        if (!firstTask) return JSON.stringify({ error: "Première tâche introuvable" });
        const [session] = await db.select().from(dgmSessions).where(eq(dgmSessions.id, firstTask.sessionId));
        if (!session) return JSON.stringify({ error: "Session introuvable" });

        const repoParts = (session.repoContext || "").split("/");
        const config = {
          owner: args.owner || repoParts[0] || "ulyssemdbh-commits",
          repo: args.repo || repoParts[1] || "",
          branch: args.branch || "main",
          autoMerge: args.autoMerge !== false,
          autoDeploy: args.autoDeploy || false,
          appName: args.appName || undefined,
          requireApproval: args.requireApproval || [],
        };

        await Promise.all(args.taskIds.map((id: number) =>
          db.update(dgmTasks).set({ status: "running", startedAt: new Date() }).where(eq(dgmTasks.id, id))
        ));

        const { dgmPipelineOrchestrator } = await import("./dgmPipelineOrchestrator");
        const result = await dgmPipelineOrchestrator.runParallelPipeline(
          session.id, args.taskIds, config, args.message || `[DGM-V2-Parallel]`
        );

        const summary = Object.entries(result.results).map(([tid, r]) => ({
          taskId: Number(tid),
          finalStatus: r.finalStatus,
          durationMs: r.metrics.totalDurationMs,
          retries: r.metrics.retryCount,
          prUrl: r.stages.pr_creation?.data?.prUrl,
        }));

        return JSON.stringify({
          action: "run_parallel_pipeline",
          version: "V2",
          tasksProcessed: args.taskIds.length,
          totalDurationMs: result.totalDurationMs,
          summary,
        });
      }

      case "get_independent_tasks": {
        const repoFilterIndep = args.repo_context
          ? sql`${dgmSessions.userId} = ${uid} AND ${dgmSessions.active} = true AND ${dgmSessions.repoContext} = ${args.repo_context}`
          : sql`${dgmSessions.userId} = ${uid} AND ${dgmSessions.active} = true`;
        const [session] = await db.select().from(dgmSessions).where(repoFilterIndep).orderBy(sql`${dgmSessions.id} DESC`).limit(1);
        if (!session) return JSON.stringify({ error: "DGM n'est pas actif" });

        const { dgmPipelineOrchestrator } = await import("./dgmPipelineOrchestrator");
        const readyTasks = await dgmPipelineOrchestrator.getIndependentPendingTasks(session.id);
        return JSON.stringify({
          action: "get_independent_tasks",
          version: "V2",
          sessionId: session.id,
          readyTasks: readyTasks.map((t: any) => ({ id: t.id, title: t.title, description: t.description })),
          count: readyTasks.length,
          hint: readyTasks.length > 1 ? "Ces tâches sont indépendantes — utilise run_parallel_pipeline pour les exécuter simultanément" : "Une seule tâche prête — utilise run_pipeline",
        });
      }

      case "rollback": {
        if (!args.taskId) return JSON.stringify({ error: "taskId requis" });
        if (!args.reason) return JSON.stringify({ error: "reason requis" });

        const [task] = await db.select().from(dgmTasks).where(eq(dgmTasks.id, args.taskId));
        if (!task) return JSON.stringify({ error: "Tâche introuvable" });
        const [session] = await db.select().from(dgmSessions).where(eq(dgmSessions.id, task.sessionId));
        if (!session) return JSON.stringify({ error: "Session introuvable" });

        const repoParts = (session.repoContext || "").split("/");
        const config = {
          owner: args.owner || repoParts[0] || "ulyssemdbh-commits",
          repo: args.repo || repoParts[1] || "",
          branch: args.branch || "main",
          autoMerge: false,
          autoDeploy: false,
          appName: args.appName || undefined,
          requireApproval: [],
        };

        const { dgmPipelineOrchestrator } = await import("./dgmPipelineOrchestrator");
        const result = await dgmPipelineOrchestrator.runRollback(session.id, args.taskId, config, args.reason);

        return JSON.stringify({
          action: "rollback",
          taskId: args.taskId,
          success: result.success,
          data: result.data,
          error: result.error,
          durationMs: result.durationMs,
        });
      }

      case "clear_cache": {
        const { dgmPipelineOrchestrator } = await import("./dgmPipelineOrchestrator");
        dgmPipelineOrchestrator.clearFileCache();
        return JSON.stringify({ action: "clear_cache", success: true, message: "Cache fichiers vidé" });
      }

      case "circuit_status": {
        const { dgmPipelineOrchestrator } = await import("./dgmPipelineOrchestrator");
        const status = dgmPipelineOrchestrator.getCircuitBreakerStatus();
        return JSON.stringify({ action: "circuit_status", circuits: status });
      }

      case "pipeline_report": {
        const reportSessionId = args.sessionId;
        if (!reportSessionId) {
          const repoFilterReport = args.repo_context
            ? sql`${dgmSessions.userId} = ${uid} AND ${dgmSessions.repoContext} = ${args.repo_context}`
            : eq(dgmSessions.userId, uid);
          const [session] = await db.select().from(dgmSessions).where(repoFilterReport).orderBy(sql`${dgmSessions.id} DESC`).limit(1);
          if (!session) return JSON.stringify({ error: "Aucune session DGM trouvée" });
          const { dgmPipelineOrchestrator } = await import("./dgmPipelineOrchestrator");
          const report = await dgmPipelineOrchestrator.getPipelineReport(session.id);
          return JSON.stringify({ action: "pipeline_report", ...report });
        }
        const { dgmPipelineOrchestrator } = await import("./dgmPipelineOrchestrator");
        const report = await dgmPipelineOrchestrator.getPipelineReport(reportSessionId);
        return JSON.stringify({ action: "pipeline_report", ...report });
      }

      case "next_task": {
        const repoFilterNext = args.repo_context
          ? sql`${dgmSessions.userId} = ${uid} AND ${dgmSessions.active} = true AND ${dgmSessions.repoContext} = ${args.repo_context}`
          : sql`${dgmSessions.userId} = ${uid} AND ${dgmSessions.active} = true`;
        const [session] = await db.select().from(dgmSessions).where(repoFilterNext).orderBy(sql`${dgmSessions.id} DESC`).limit(1);
        if (!session) return JSON.stringify({ error: "DGM n'est pas actif" });

        const { dgmPipelineOrchestrator } = await import("./dgmPipelineOrchestrator");
        const nextTask = await dgmPipelineOrchestrator.getNextPendingTask(session.id);
        if (!nextTask) return JSON.stringify({ action: "next_task", message: "Toutes les tâches sont terminées ou en cours!", sessionId: session.id });
        return JSON.stringify({ action: "next_task", task: { id: nextTask.id, title: nextTask.title, description: nextTask.description, testCriteria: nextTask.testCriteria, impactedFiles: nextTask.impactedFiles } });
      }

      case "auto_execute": {
        if (!args.objective) return JSON.stringify({ error: "objective requis — décris ce que tu veux construire" });
        if (!args.repo_context) return JSON.stringify({ error: "repo_context requis (ex: ulyssemdbh-commits/tetrisv1-test)" });

        const repoParts = args.repo_context.split("/");
        const owner = repoParts[0] || "ulyssemdbh-commits";
        const repo = repoParts[1] || "";
        if (!repo) return JSON.stringify({ error: "repo_context invalide" });

        const config = {
          owner,
          repo,
          branch: args.branch || "main",
          autoMerge: args.autoMerge !== false,
          autoDeploy: args.autoDeploy || false,
          appName: args.appName || undefined,
          requireApproval: [] as string[],
        };

        console.log(`[DGM] 🚀 AUTO_EXECUTE started: "${args.objective}" on ${args.repo_context}`);
        const autoStart = Date.now();

        const { getSessionResume } = await import("./dgmPipelineOrchestrator");
        const previousWork = await getSessionResume(args.repo_context);
        if (previousWork?.hasExistingWork) {
          console.log(`[DGM] AUTO_EXECUTE: Found previous work — ${previousWork.completedTasks.length} completed, ${previousWork.failedTasks.length} failed`);
        }

        const allOldSessions = await db.select().from(dgmSessions)
          .where(sql`${dgmSessions.userId} = ${uid} AND ${dgmSessions.repoContext} = ${args.repo_context}`)
          .orderBy(sql`${dgmSessions.id} DESC`);

        if (allOldSessions.length > 0) {
          const oldSessionIds = allOldSessions.map(s => s.id);
          await db.update(dgmSessions).set({ active: false, deactivatedAt: new Date() })
            .where(sql`${dgmSessions.id} IN (${sql.join(oldSessionIds.map(id => sql`${id}`), sql`,`)})`);
          console.log(`[DGM] AUTO_EXECUTE: Deactivated ${allOldSessions.length} old session(s) for ${args.repo_context}`);
        }

        try {
          const branchesRaw = await executeDevopsGithub({ action: "list_branches", owner, repo });
          const branchesData = JSON.parse(branchesRaw);
          const dgmBranches = (branchesData.branches || [])
            .filter((b: any) => (b.name || b).toString().startsWith("dgm/"))
            .map((b: any) => (b.name || b).toString());

          if (dgmBranches.length > 0) {
            console.log(`[DGM] AUTO_EXECUTE: Cleaning ${dgmBranches.length} stale dgm/ branches...`);
            const closedPRs: string[] = [];
            try {
              const prsRaw = await executeDevopsGithub({ action: "list_prs", owner, repo, state: "open" });
              const prsData = JSON.parse(prsRaw);
              for (const pr of (prsData.pullRequests || [])) {
                if (pr.head?.ref?.startsWith("dgm/") || pr.title?.includes("[DGM]")) {
                  try {
                    await executeDevopsGithub({ action: "close_pr", owner, repo, pullNumber: pr.number });
                    closedPRs.push(`#${pr.number}`);
                  } catch {}
                }
              }
            } catch {}
            if (closedPRs.length > 0) console.log(`[DGM] AUTO_EXECUTE: Closed ${closedPRs.length} old PRs: ${closedPRs.join(", ")}`);

            let deletedCount = 0;
            for (const branchName of dgmBranches) {
              try {
                await executeDevopsGithub({ action: "delete_branch", owner, repo, branch: branchName });
                deletedCount++;
              } catch {}
            }
            console.log(`[DGM] AUTO_EXECUTE: Deleted ${deletedCount}/${dgmBranches.length} stale dgm/ branches`);
          }
        } catch (cleanupErr: any) {
          console.warn(`[DGM] AUTO_EXECUTE: Branch cleanup warning (non-blocking): ${cleanupErr.message}`);
        }

        const [newSession] = await db.insert(dgmSessions).values({
          userId: uid,
          active: true,
          objective: args.objective,
          repoContext: args.repo_context,
          activatedAt: new Date(),
        }).returning();
        const sessionId = newSession.id;

        const { dgmPipelineOrchestrator, ensureProjectStructure } = await import("./dgmPipelineOrchestrator");

        console.log(`[DGM] AUTO_EXECUTE: Running project structure validation...`);
        const structureResult = await ensureProjectStructure(config);
        if (structureResult.fixed.length > 0) {
          console.log(`[DGM] AUTO_EXECUTE: Fixed ${structureResult.fixed.length} structure issues: ${structureResult.fixed.join(", ")}`);
        }
        if (structureResult.errors.length > 0) {
          console.warn(`[DGM] AUTO_EXECUTE: ${structureResult.errors.length} structure warnings: ${structureResult.errors.join(", ")}`);
        }

        const decomposition = await dgmPipelineOrchestrator.decomposeObjective(args.objective, args.repo_context);

        const maxTasks = 8;
        if (decomposition.tasks.length > maxTasks) {
          console.log(`[DGM] AUTO_EXECUTE: Capping tasks from ${decomposition.tasks.length} to ${maxTasks}`);
          decomposition.tasks = decomposition.tasks.slice(0, maxTasks);
        }

        const tasks = await dgmPipelineOrchestrator.createPipelineTasks(sessionId, decomposition);
        console.log(`[DGM] AUTO_EXECUTE: ${tasks.length} tasks created (complexity: ${decomposition.estimatedComplexity}, est: ${decomposition.estimatedDurationMinutes}min)`);

        const taskIds = tasks.map(t => t.id);
        const pipelineResult = await dgmPipelineOrchestrator.runParallelPipeline(
          sessionId, taskIds, config, `[DGM-AUTO] ${args.objective.substring(0, 50)}`
        );

        const succeeded = Object.values(pipelineResult.results).filter(r =>
          r.finalStatus === "pipeline_complete" || r.finalStatus === "pr_created_awaiting_merge"
        ).length;
        const failed = Object.values(pipelineResult.results).filter(r =>
          r.finalStatus.includes("failed") || r.finalStatus.includes("error")
        ).length;

        await db.update(dgmSessions).set({
          completedTasks: succeeded,
          totalTasks: taskIds.length,
          active: false,
          deactivatedAt: new Date(),
        }).where(eq(dgmSessions.id, sessionId));

        const totalMs = Date.now() - autoStart;
        console.log(`[DGM] 🏁 AUTO_EXECUTE completed: ${succeeded}/${taskIds.length} succeeded, ${failed} failed [${totalMs}ms]`);

        const summary = Object.entries(pipelineResult.results).map(([tid, r]) => ({
          taskId: Number(tid),
          title: tasks.find(t => t.id === Number(tid))?.title || "?",
          finalStatus: r.finalStatus,
          durationMs: r.metrics.totalDurationMs,
          retries: r.metrics.retryCount,
          prUrl: r.stages.pr_creation?.data?.prUrl,
        }));

        return JSON.stringify({
          action: "auto_execute",
          version: "V3",
          objective: args.objective,
          repo: args.repo_context,
          sessionId,
          complexity: decomposition.estimatedComplexity,
          totalTasks: taskIds.length,
          succeeded,
          failed,
          totalDurationMs: totalMs,
          totalDurationFormatted: totalMs >= 60000
            ? `${Math.floor(totalMs / 60000)}m ${Math.round((totalMs % 60000) / 1000)}s`
            : `${Math.round(totalMs / 1000)}s`,
          summary,
          previousWork: previousWork?.hasExistingWork ? {
            completedBefore: previousWork.completedTasks.length,
            failedBefore: previousWork.failedTasks.length,
            lastCheckpoint: previousWork.lastCheckpoint,
          } : null,
          message: failed === 0
            ? `✅ Pipeline complet : ${succeeded} tâches exécutées, toutes les PRs créées et mergées.`
            : `⚠️ Pipeline partiel : ${succeeded}/${taskIds.length} réussies, ${failed} échouées. Vérifie les erreurs.`,
        });
      }

      default:
        return JSON.stringify({ error: `Action DGM inconnue: ${args.action}` });
    }
  } catch (err: any) {
    console.error(`[DGM] Error:`, err.message);
    return JSON.stringify({ error: err.message });
  }
}

const DEVMAX_TABLES = ["devmax_projects", "devmax_sessions", "devmax_activity_log", "dgm_sessions", "dgm_tasks", "dgm_pipeline_runs", "devmax_chat_history", "devmax_project_journal"];

function devmaxDbEscapeVal(v: any): string {
  if (v === null || v === undefined) return "NULL";
  if (Array.isArray(v)) return `ARRAY[${v.map((item: any) => `'${String(item).replace(/'/g, "''")}'`).join(",")}]::text[]`;
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return `'${String(v).replace(/'/g, "''")}'`;
}

function toSnakeCase(s: string): string {
  return s.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

const _tenantRateLimits = new Map<number, { count: number; resetAt: number }>();
const TENANT_RATE_LIMIT = 60;
const TENANT_RATE_WINDOW = 60000;

function checkTenantRateLimit(tenantUserId: number): boolean {
  const now = Date.now();
  const entry = _tenantRateLimits.get(tenantUserId);
  if (!entry || now > entry.resetAt) {
    _tenantRateLimits.set(tenantUserId, { count: 1, resetAt: now + TENANT_RATE_WINDOW });
    return true;
  }
  entry.count++;
  if (entry.count > TENANT_RATE_LIMIT) {
    console.warn(`[DevMax-RateLimit] 🚫 Tenant userId=${tenantUserId} exceeded ${TENANT_RATE_LIMIT} calls/min`);
    return false;
  }
  return true;
}

async function executeDevmaxDb(args: any): Promise<string> {
  try {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");

    const tc = args._tenantContext;
    if (tc?.isTenant) {
      if (!checkTenantRateLimit(tc.tenantUserId)) {
        return JSON.stringify({ error: "Limite de requêtes atteinte (60/min). Attends quelques secondes avant de réessayer." });
      }
    }

    switch (args.action) {
      case "query": {
        if (!args.sql) return JSON.stringify({ error: "sql requis pour action query" });
        let queryLower = args.sql.toLowerCase().trim();
        if (!queryLower.startsWith("select")) {
          return JSON.stringify({ error: "Seules les requêtes SELECT sont autorisées via query. Utilise insert/update/delete pour les mutations." });
        }
        const hasDevmaxTable = DEVMAX_TABLES.some(t => queryLower.includes(t));
        if (!hasDevmaxTable) {
          return JSON.stringify({ error: `Accès limité aux tables DevMax: ${DEVMAX_TABLES.join(", ")}` });
        }
        if (tc?.isTenant) {
          const sensitivePatterns = /users\s|password|token|secret|api_key|github_token|stripe|billing/i;
          if (sensitivePatterns.test(args.sql)) {
            console.warn(`[DevMax-DB] 🚫 BLOCKED sensitive query from tenant userId=${tc.tenantUserId}: ${args.sql.slice(0, 80)}`);
            return JSON.stringify({ error: "Requête bloquée: accès aux données sensibles interdit. Tu peux consulter les données de tes projets uniquement." });
          }
          const tenantId = tc.tenantId || tc.projectId;
          if (tenantId && !queryLower.includes("tenant_id") && !queryLower.includes("project_id") && !queryLower.includes(`'${tenantId}'`)) {
            console.warn(`[DevMax-DB] ⚠️ Tenant query without tenant_id filter from userId=${tc.tenantUserId} — auto-restricting`);
            const tableMatch = args.sql.match(/from\s+(\w+)/i);
            if (tableMatch) {
              const hasWhereClause = /\bwhere\b/i.test(args.sql);
              if (hasWhereClause) {
                args.sql = args.sql.replace(/where\b/i, `WHERE tenant_id = '${tenantId.replace(/'/g, "''")}' AND `);
              } else {
                args.sql = args.sql.replace(/(from\s+\w+)/i, `$1 WHERE tenant_id = '${tenantId.replace(/'/g, "''")}'`);
              }
            }
          }
          queryLower = args.sql.toLowerCase().trim();
        }
        const limit = args.limit || 50;
        const finalSql = queryLower.includes("limit") ? args.sql : `${args.sql} LIMIT ${limit}`;
        const result = await db.execute(sql.raw(finalSql));
        const rows = Array.isArray(result) ? result : (result as any).rows || [];
        return JSON.stringify({ action: "query", rowCount: rows.length, rows });
      }

      case "insert": {
        let insertTable = args.table;
        let insertData = args.data;
        if (!insertTable && args.params?.table) insertTable = args.params.table;
        if (!insertData && args.params?.data) insertData = args.params.data;
        if (!insertData && args.record) insertData = args.record;
        if (!insertData && args.values) insertData = args.values;
        if (typeof insertData === 'string') {
          try { insertData = JSON.parse(insertData); } catch { /* keep as-is */ }
        }
        if (!insertTable || !insertData || typeof insertData !== 'object') {
          console.error(`[DevMax-DB] INSERT rejected — table=${insertTable}, data type=${typeof insertData}, raw args keys=${Object.keys(args).filter(k => k !== '_tenantContext').join(',')}`);
          return JSON.stringify({ error: `table (string) et data (objet JSON) requis pour insert. Reçu: table=${insertTable || 'MANQUANT'}, data=${insertData ? typeof insertData : 'MANQUANT'}. Exemple: {action:"insert", table:"devmax_project_journal", data:{project_id:"xxx", entry_type:"note", title:"Mon titre"}}` });
        }
        if (!DEVMAX_TABLES.includes(insertTable)) return JSON.stringify({ error: `Table non autorisée: ${insertTable}. Tables valides: ${DEVMAX_TABLES.join(', ')}` });
        if (tc?.isTenant) {
          const tenantId = tc.tenantId || tc.projectId;
          if (tenantId) insertData.tenant_id = tenantId;
          const sensitiveWriteTables = ['devmax_users', 'devmax_tenants'];
          if (sensitiveWriteTables.includes(insertTable)) {
            return JSON.stringify({ error: `Écriture dans ${insertTable} interdite pour les tenants.` });
          }
        }
        const cols = Object.keys(insertData);
        const vals = Object.values(insertData);
        const colNames = cols.map(c => `"${toSnakeCase(c)}"`).join(", ");
        const escapedVals = vals.map((v: any) => devmaxDbEscapeVal(v)).join(", ");
        const insertSql = `INSERT INTO ${insertTable} (${colNames}) VALUES (${escapedVals}) RETURNING *`;
        const result = await db.execute(sql.raw(insertSql));
        const rows = Array.isArray(result) ? result : (result as any).rows || [];
        console.log(`[DevMax-DB] INSERT into ${insertTable}: ${JSON.stringify(cols)}${tc?.isTenant ? ` (tenant userId=${tc.tenantUserId})` : ''}`);
        return JSON.stringify({ action: "insert", table: insertTable, inserted: rows[0] || insertData });
      }

      case "update": {
        if (!args.table || !args.data || !args.where) return JSON.stringify({ error: "table, data et where requis" });
        if (!DEVMAX_TABLES.includes(args.table)) return JSON.stringify({ error: `Table non autorisée: ${args.table}` });
        if (tc?.isTenant) {
          const tenantId = tc.tenantId || tc.projectId;
          if (tenantId) args.where.tenant_id = tenantId;
          const sensitiveWriteTables = ['devmax_users', 'devmax_tenants'];
          if (sensitiveWriteTables.includes(args.table)) {
            return JSON.stringify({ error: `Écriture dans ${args.table} interdite pour les tenants.` });
          }
        }
        const setClauses = Object.keys(args.data).map((k) => {
          return `"${toSnakeCase(k)}" = ${devmaxDbEscapeVal(args.data[k])}`;
        }).join(", ");
        const whereClauses = Object.keys(args.where).map(k => {
          return `"${toSnakeCase(k)}" = ${devmaxDbEscapeVal(args.where[k])}`;
        }).join(" AND ");
        const updateSql = `UPDATE ${args.table} SET ${setClauses} WHERE ${whereClauses} RETURNING *`;
        const result = await db.execute(sql.raw(updateSql));
        const rows = Array.isArray(result) ? result : (result as any).rows || [];
        console.log(`[DevMax-DB] UPDATE ${args.table} SET ${Object.keys(args.data).join(",")} WHERE ${whereClauses}${tc?.isTenant ? ` (tenant userId=${tc.tenantUserId})` : ''}`);
        return JSON.stringify({ action: "update", table: args.table, updatedCount: rows.length, rows });
      }

      case "delete": {
        if (!args.table || !args.where) return JSON.stringify({ error: "table et where requis" });
        if (!DEVMAX_TABLES.includes(args.table)) return JSON.stringify({ error: `Table non autorisée: ${args.table}` });
        if (tc?.isTenant) {
          const tenantId = tc.tenantId || tc.projectId;
          if (tenantId) args.where.tenant_id = tenantId;
          const sensitiveWriteTables = ['devmax_users', 'devmax_tenants'];
          if (sensitiveWriteTables.includes(args.table)) {
            return JSON.stringify({ error: `Suppression dans ${args.table} interdite pour les tenants.` });
          }
        }
        const delWhere = Object.keys(args.where).map(k => {
          return `"${toSnakeCase(k)}" = ${devmaxDbEscapeVal(args.where[k])}`;
        }).join(" AND ");
        const deleteSql = `DELETE FROM ${args.table} WHERE ${delWhere} RETURNING *`;
        const result = await db.execute(sql.raw(deleteSql));
        const rows = Array.isArray(result) ? result : (result as any).rows || [];
        console.log(`[DevMax-DB] DELETE from ${args.table} WHERE ${delWhere}${tc?.isTenant ? ` (tenant userId=${tc.tenantUserId})` : ''} — ${rows.length} rows`);
        return JSON.stringify({ action: "delete", table: args.table, deletedCount: rows.length });
      }

      case "stats": {
        const counts: Record<string, number> = {};
        for (const table of DEVMAX_TABLES) {
          try {
            const result = await db.execute(sql.raw(`SELECT COUNT(*) as count FROM ${table}`));
            const rows = Array.isArray(result) ? result : (result as any).rows || [];
            counts[table] = parseInt(rows[0]?.count || "0", 10);
          } catch { counts[table] = -1; }
        }
        const activeDgm = await db.execute(sql.raw(`SELECT id, objective, repo_context, total_tasks, completed_tasks, activated_at FROM dgm_sessions WHERE active = true ORDER BY id DESC LIMIT 5`));
        const activeRows = Array.isArray(activeDgm) ? activeDgm : (activeDgm as any).rows || [];
        const recentActivity = await db.execute(sql.raw(`SELECT action, target, created_at FROM devmax_activity_log ORDER BY created_at DESC LIMIT 10`));
        const activityRows = Array.isArray(recentActivity) ? recentActivity : (recentActivity as any).rows || [];
        return JSON.stringify({
          action: "stats",
          tableCounts: counts,
          activeDgmSessions: activeRows,
          recentActivity: activityRows,
          accessLevel: "FULL — Max has 24/7 dedicated DB access"
        });
      }

      case "project_summary": {
        if (!args.projectId) return JSON.stringify({ error: "projectId requis" });
        const projResult = await db.execute(sql.raw(`SELECT * FROM devmax_projects WHERE id = '${args.projectId.replace(/'/g, "''")}'`));
        const projRows = Array.isArray(projResult) ? projResult : (projResult as any).rows || [];
        if (!projRows.length) return JSON.stringify({ error: `Projet ${args.projectId} non trouvé` });
        const project = projRows[0] as any;
        const repoCtx = project.repo_owner && project.repo_name ? `${project.repo_owner}/${project.repo_name}` : null;
        let dgmData: any = { sessions: [], tasks: [], pipelineRuns: [] };
        if (repoCtx) {
          const sessResult = await db.execute(sql.raw(`SELECT * FROM dgm_sessions WHERE repo_context = '${repoCtx}' ORDER BY id DESC LIMIT 5`));
          dgmData.sessions = Array.isArray(sessResult) ? sessResult : (sessResult as any).rows || [];
          if (dgmData.sessions.length > 0) {
            const sessionIds = dgmData.sessions.map((s: any) => s.id).join(",");
            const tasksResult = await db.execute(sql.raw(`SELECT * FROM dgm_tasks WHERE session_id IN (${sessionIds}) ORDER BY sort_order ASC`));
            dgmData.tasks = Array.isArray(tasksResult) ? tasksResult : (tasksResult as any).rows || [];
            const pipeResult = await db.execute(sql.raw(`SELECT * FROM dgm_pipeline_runs WHERE session_id IN (${sessionIds}) ORDER BY created_at DESC LIMIT 20`));
            dgmData.pipelineRuns = Array.isArray(pipeResult) ? pipeResult : (pipeResult as any).rows || [];
          }
        }
        const actResult = await db.execute(sql.raw(`SELECT * FROM devmax_activity_log WHERE target LIKE '%${args.projectId.replace(/'/g, "''")}%' ORDER BY created_at DESC LIMIT 20`));
        const actRows = Array.isArray(actResult) ? actResult : (actResult as any).rows || [];
        return JSON.stringify({
          action: "project_summary",
          project,
          dgm: dgmData,
          activityLog: actRows,
          accessLevel: "FULL — Max has 24/7 dedicated DB access"
        });
      }

      default:
        return JSON.stringify({ error: `Action devmax_db inconnue: ${args.action}. Actions: query, insert, update, delete, stats, project_summary` });
    }
  } catch (err: any) {
    console.error(`[DevMax-DB] Error:`, err.message);
    return JSON.stringify({ error: err.message });
  }
}

async function executeDashboardScreenshot(args: { action: string }): Promise<string> {
  try {
    if (args.action === "take") {
      const { broadcastToUser } = await import("./realtimeSync");
      const requestId = `ulysse-${Date.now()}`;
      const triggerTime = Date.now();

      broadcastToUser(1, {
        type: "dashboard.command",
        data: { action: "take_screenshot", requestId },
        timestamp: triggerTime,
      });

      console.log(`[DashboardScreenshot] Trigger sent via WebSocket (requestId: ${requestId})`);

      const { db } = await import("../db");
      const { uiSnapshots } = await import("@shared/schema");
      const { eq, desc } = await import("drizzle-orm");

      const MAX_WAIT = 45000;
      const POLL_INTERVAL = 3000;
      const startTime = Date.now();

      while (Date.now() - startTime < MAX_WAIT) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));

        const [latest] = await db.select().from(uiSnapshots)
          .where(eq(uiSnapshots.actionType, "screenshot_analysis"))
          .orderBy(desc(uiSnapshots.createdAt))
          .limit(1);

        if (latest && new Date(latest.createdAt!).getTime() > triggerTime - 5000) {
          const analysis = latest.formState as any;
          console.log(`[DashboardScreenshot] Analysis found after ${Math.round((Date.now() - startTime) / 1000)}s — ${analysis?.summary?.slice(0, 80) || "OK"}`);
          return JSON.stringify({
            action: "screenshot_taken",
            analysis: latest.formState,
            page: latest.currentPage,
            timestamp: latest.createdAt,
            summary: analysis?.summary || "Analyse visuelle disponible",
            impression: analysis?.impression || analysis?.summary || "",
            verdict: analysis?.verdict || null,
          });
        }
      }

      console.log(`[DashboardScreenshot] Timeout after ${MAX_WAIT / 1000}s — analysis not yet in DB`);
      return JSON.stringify({
        action: "screenshot_triggered",
        requestId,
        message: "La capture et l'analyse visuelle sont en cours (site capturé via Playwright + GPT-4o Vision). Le résultat sera bientôt disponible. Utilise 'get_latest' pour le récupérer.",
      });
    } else if (args.action === "get_latest") {
      const { db } = await import("../db");
      const { uiSnapshots } = await import("@shared/schema");
      const { eq, desc } = await import("drizzle-orm");

      const [latest] = await db.select().from(uiSnapshots)
        .where(eq(uiSnapshots.actionType, "screenshot_analysis"))
        .orderBy(desc(uiSnapshots.createdAt))
        .limit(1);

      if (!latest) {
        return JSON.stringify({ available: false, message: "Aucun screenshot disponible. Demande à Maurice de capturer son écran." });
      }
      return JSON.stringify({
        available: true,
        analysis: latest.formState,
        page: latest.currentPage,
        timestamp: latest.createdAt,
      });
    }
    return JSON.stringify({ error: "Action inconnue. Utilise 'take' ou 'get_latest'" });
  } catch (err: any) {
    return JSON.stringify({ error: err.message });
  }
}

async function executeImageGenerate(args: { prompt: string; style?: string; size?: string; enhance?: boolean }, userId?: number): Promise<string> {
  try {
    const { generateImage } = await import("./imageGenerationService");

    const result = await generateImage({
      prompt: args.prompt,
      style: args.style,
      size: args.size,
      enhancePrompt: args.enhance,
      userId: userId || 1,
      retryOnFail: true
    });

    if (!result.success) {
      return JSON.stringify({ error: result.error, generationTimeMs: result.generationTimeMs });
    }

    return JSON.stringify({
      type: 'image_generated',
      success: true,
      url: result.url,
      fileName: result.fileName,
      storagePath: result.storagePath,
      sizeBytes: result.sizeBytes,
      style: result.style,
      enhancedPrompt: result.enhancedPrompt,
      generationTimeMs: result.generationTimeMs
    });
  } catch (err: any) {
    console.error(`[ImageGenerate] Error:`, err.message);
    return JSON.stringify({ error: err.message });
  }
}

// === TOOL ORCHESTRATOR ===

export class ToolOrchestrator {
  async executeParallel(toolCalls: Array<{ name: string; args: Record<string, any> }>, userId: number): Promise<OrchestrationResult> {
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

  async executeSequential(toolCalls: Array<{ name: string; args: Record<string, any> }>, userId: number): Promise<OrchestrationResult> {
    const startTime = Date.now();
    const results: ToolCallResult[] = [];

    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      const callStart = Date.now();
      const result = await executeToolCallV2(tc.name, tc.args, userId);
      results.push({
        toolCallId: `call_${i}`,
        name: tc.name,
        result,
        executionTimeMs: Date.now() - callStart
      });
    }

    return {
      results,
      totalTimeMs: Date.now() - startTime,
      parallelExecutions: 0,
      learnedFromCore: true
    };
  }

  async executeSmart(toolCalls: Array<{ name: string; args: Record<string, any>; dependsOn?: number[] }>, userId: number): Promise<OrchestrationResult> {
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

// === TODOIST TOOL IMPLEMENTATIONS (Action-First) ===

async function executeTodoistCreateTask(args: { content: string; description?: string; due_string?: string; priority?: number; project_name?: string }, userId: number): Promise<string> {
  try {
    const todoistService = await import("./todoistService");
    
    // Priority mapping: API uses 1-4 where 4=urgent, we present same to AI
    const priority = args.priority || 1;
    
    const result = await todoistService.createTask({
      content: args.content,
      description: args.description,
      dueString: args.due_string,
      priority: priority,
      projectId: args.project_name
    });

    if (result) {
      console.log(`[Todoist Action-First] Tâche créée immédiatement: ${args.content}`);
      return JSON.stringify({
        success: true,
        action: "task_created",
        task: {
          id: result.id,
          content: result.content,
          due: result.due?.string || "Pas d'échéance",
          priority: priority,
          url: result.url
        },
        message: `✅ Tâche créée: "${args.content}"${args.due_string ? ` pour ${args.due_string}` : ""}`
      });
    } else {
      return JSON.stringify({ success: false, error: "Échec création tâche" });
    }
  } catch (error: any) {
    console.error("[Todoist] Error creating task:", error.message);
    return JSON.stringify({ success: false, error: error.message });
  }
}

async function executeTodoistListTasks(args: { filter?: string; project_name?: string }): Promise<string> {
  try {
    const todoistService = await import("./todoistService");
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
  } catch (error: any) {
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

// === KANBAN TOOL IMPLEMENTATION ===

async function executeKanbanCreateTask(args: { title: string; description?: string; priority?: string; project_id?: number }, userId: number): Promise<string> {
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

// === TASK QUEUE IMPLEMENTATION ===

async function executeTaskQueueManage(args: any, userId: number): Promise<string> {
  try {
    const tq = await import("../services/taskQueueEngine");
    const { action } = args;

    switch (action) {
      case "create": {
        if (!args.items?.length) return JSON.stringify({ error: "items requis pour créer une queue" });
        const result = await tq.createTaskQueue({
          userId,
          title: args.title || "Tâches Ulysse",
          items: args.items,
          source: args.source || "chat",
          threadId: args.threadId,
          delayBetweenItemsMs: args.delayBetweenItemsMs || args.intervalMs,
        });
        if (args.autoStart !== false) {
          const startMsg = await tq.startTaskQueue(result.queueId, userId);
          const delayInfo = args.delayBetweenItemsMs || args.intervalMs ? ` (intervalle: ${((args.delayBetweenItemsMs || args.intervalMs) / 60000).toFixed(0)}min entre chaque tâche)` : '';
          return JSON.stringify({ success: true, queueId: result.queueId, itemCount: result.itemCount, started: true, message: `Queue "${args.title || 'Tâches Ulysse'}" créée et démarrée avec ${result.itemCount} tâches${delayInfo}` });
        }
        return JSON.stringify({ success: true, queueId: result.queueId, itemCount: result.itemCount, started: false, message: `Queue créée avec ${result.itemCount} tâches. Utilise start pour lancer.` });
      }
      case "start": {
        if (!args.queueId) return JSON.stringify({ error: "queueId requis" });
        const msg = await tq.startTaskQueue(args.queueId, userId);
        return JSON.stringify({ success: true, message: msg });
      }
      case "pause": {
        if (!args.queueId) return JSON.stringify({ error: "queueId requis" });
        const msg = await tq.pauseTaskQueue(args.queueId, userId);
        return JSON.stringify({ success: true, message: msg });
      }
      case "status": {
        if (!args.queueId) return JSON.stringify({ error: "queueId requis" });
        const status = await tq.getTaskQueueStatus(args.queueId, userId);
        if (!status) return JSON.stringify({ error: "Queue not found" });
        return JSON.stringify({
          queue: { id: status.queue.id, title: status.queue.title, status: status.queue.status, progress: `${status.queue.completedItems}/${status.queue.totalItems}` },
          items: status.items.map(i => ({ id: i.id, title: i.title, status: i.status, result: i.result?.slice(0, 200), durationMs: i.durationMs })),
        });
      }
      case "list": {
        const queues = await tq.getRecentQueues(userId);
        return JSON.stringify({ queues: queues.map(q => ({ id: q.id, title: q.title, status: q.status, progress: `${q.completedItems}/${q.totalItems}`, createdAt: q.createdAt })) });
      }
      default:
        return JSON.stringify({ error: `Action inconnue: ${action}` });
    }
  } catch (error: any) {
    console.error("[TaskQueue] Error:", error.message);
    return JSON.stringify({ error: error.message });
  }
}

// === DEVOPS INTELLIGENCE IMPLEMENTATIONS ===

async function executeDevOpsIntelligence(args: any, userId: number): Promise<string> {
  try {
    const { devopsIntelligenceEngine } = await import("./devopsIntelligenceEngine");
    const action = args.action || "full_report";

    switch (action) {
      case "impact_map": {
        const files = args.files || [];
        if (!files.length) return "❌ Fournis une liste de fichiers avec leur path (et optionnellement content)";
        const map = devopsIntelligenceEngine.buildImpactMap(files);
        const domainLines = Object.entries(map.domainSummary)
          .sort((a, b) => b[1].avgCriticality - a[1].avgCriticality)
          .map(([d, info]) => `  • ${d}: ${info.files} fichiers, criticité ${info.avgCriticality}/100\n    Clés: ${info.keyFiles.slice(0, 3).join(", ")}`);
        return `🧠 BRAIN IMPACT MAP\n${map.nodes.length} fichiers analysés, ${map.edges.length} connexions, ${Object.keys(map.domainSummary).length} domaines\n\nDomaines:\n${domainLines.join("\n")}\n\nGénéré: ${map.generatedAt}`;
      }

      case "analyze_impact": {
        const filePaths = args.files?.map((f: any) => typeof f === "string" ? f : f.path) || [];
        if (!filePaths.length) return "❌ Fournis les fichiers à analyser (paths)";
        const allFiles = filePaths.map((p: string) => ({ path: p }));
        const map = devopsIntelligenceEngine.buildImpactMap(allFiles);
        const result = devopsIntelligenceEngine.analyzeImpact(filePaths, map);
        return `🎯 ANALYSE D'IMPACT\nRisque: ${result.riskLevel.toUpperCase()}\nFichiers affectés: ${result.directlyAffected.length}\nCascade niveau: ${result.cascadeDepth}\nDomaines: ${Object.entries(result.domainsImpacted).map(([d, c]) => `${d}(${c})`).join(", ")}\n\n${result.explanation}`;
      }

      case "ci_risk": {
        const changes = args.changes || [];
        if (!changes.length) return "❌ Fournis la liste des changements (file, linesAdded, linesRemoved, changeType)";
        const risk = devopsIntelligenceEngine.calculateCIRisk(changes);
        const breakdownLines = Object.entries(risk.breakdown)
          .map(([k, v]) => `  ${k}: ${v}/100`);
        return `🔮 CI ORACLE — RISQUE: ${risk.overall}/100 (${risk.riskLevel.toUpperCase()})\n\nDétail:\n${breakdownLines.join("\n")}\n\n${risk.warnings.length ? "⚠️ Alertes:\n" + risk.warnings.map(w => `  ${w}`).join("\n") : "✅ Aucune alerte"}\n\n💡 Recommandations:\n${risk.recommendations.map(r => `  → ${r}`).join("\n")}`;
      }

      case "patch_advice": {
        const problem = args.problem || "Problème non spécifié";
        const affectedFiles = args.affected_files || args.files || [];
        const bugType = args.bug_type || "bug";
        const advice = devopsIntelligenceEngine.generatePatchAdvice(problem, affectedFiles, bugType);
        const patchLines = advice.patches.map(p =>
          `\n📦 PATCH ${p.level.toUpperCase()}\n  ${p.description}\n  Risque: ${p.riskScore}/100 | Effort: ${p.effort}\n  Bénéfice: ${p.benefit}\n  ${p.recommendation}\n  Fichiers:\n${p.changes.map(c => `    • ${c.file}: ${c.action} — ${c.detail}`).join("\n")}`
        );
        return `🩹 AUTO PATCH ADVISOR\nProblème: ${problem}\nDomaines affectés: ${advice.affectedDomains.join(", ")}\n${patchLines.join("\n")}\n\n✨ MEILLEUR CHOIX: ${advice.bestChoice}\n💡 Raison: ${advice.reasoning}`;
      }

      case "learning_gaps": {
        const gaps = await devopsIntelligenceEngine.analyzeLearningGaps(userId);
        if (!gaps.length) return "✅ Aucune lacune d'apprentissage détectée — Ulysse est à jour!";
        const gapLines = gaps.map(g =>
          `${g.severity === "critical" ? "🔴" : g.severity === "important" ? "🟡" : "🔵"} [${g.domain}] ${g.topic}\n  Evidence: ${g.evidence}\n  Action: ${g.suggestedAction}${g.homeworkSuggestion ? `\n  Homework suggéré: "${g.homeworkSuggestion.title}" (${g.homeworkSuggestion.type})` : ""}`
        );
        return `🧪 HOMEWORK BRAIN PLANNER\n${gaps.length} lacune(s) détectée(s):\n\n${gapLines.join("\n\n")}`;
      }

      case "full_report": {
        const changes = args.changes || [];
        const files = args.files || [];
        const problem = args.problem;

        const report = await devopsIntelligenceEngine.runFullDevOpsIntelligence(userId, {
          files: files.map((f: any) => typeof f === "string" ? { path: f } : f),
          changes,
          problem,
          bugType: args.bug_type,
        });

        const sections: string[] = ["📊 RAPPORT DEVOPS INTELLIGENCE COMPLET"];

        if (report.ciRisk) {
          sections.push(`\n🔮 CI ORACLE: ${report.ciRisk.overall}/100 (${report.ciRisk.riskLevel})\n${report.ciRisk.warnings.slice(0, 3).join("\n")}`);
        }

        if (report.impactMap) {
          const topDomains = Object.entries(report.impactMap.domainSummary)
            .sort((a, b) => b[1].avgCriticality - a[1].avgCriticality)
            .slice(0, 5);
          sections.push(`\n🧠 IMPACT MAP: ${report.impactMap.nodes.length} fichiers, ${Object.keys(report.impactMap.domainSummary).length} domaines\n${topDomains.map(([d, i]) => `  ${d}: criticité ${i.avgCriticality}`).join("\n")}`);
        }

        if (report.patchAdvice) {
          sections.push(`\n🩹 PATCH ADVISOR: ${report.patchAdvice.patches.length} patchs proposés\n  ✨ Best: ${report.patchAdvice.bestChoice}`);
        }

        if (report.learningGaps?.length) {
          const critical = report.learningGaps.filter(g => g.severity === "critical").length;
          const important = report.learningGaps.filter(g => g.severity === "important").length;
          sections.push(`\n🧪 BRAIN PLANNER: ${report.learningGaps.length} lacunes (${critical} critiques, ${important} importantes)`);
        }

        return sections.join("\n");
      }

      case "code_review": {
        const reviewFiles = args.files || [];
        if (!reviewFiles.length) return "❌ Fournis la liste des fichiers avec leur diff (filename, status, additions, deletions, patch)";
        const review = devopsIntelligenceEngine.analyzeDiffForReview(reviewFiles);
        const issueLines = review.issues.map(i => {
          const icon = i.severity === "critical" ? "🔴" : i.severity === "warning" ? "🟡" : i.severity === "info" ? "🔵" : "⚪";
          return `${icon} [${i.category}] ${i.file}: ${i.description}`;
        });
        return `🔍 CODE REVIEW AUTOMATIQUE\nScore: ${review.score}/100 | Verdict: ${review.verdict}\n${review.summary}\n\n${issueLines.length ? "Problèmes:\n" + issueLines.join("\n") : "✅ Aucun problème détecté"}`;
      }

      case "fragility_leaderboard": {
        const limit = args.limit || 20;
        const scores = await devopsIntelligenceEngine.getFragilityLeaderboard(limit);
        if (!scores.length) return "📊 Aucune donnée de fragilité dynamique. L'apprentissage commence dès le premier patch/commit/bug enregistré.";
        const lines = scores.map((s, i) =>
          `${i + 1}. ${s.filePath}\n   Score: ${s.combinedScore}/100 (static: ${s.staticScore}, dynamic: ${s.dynamicScore})\n   Events: ${s.totalEvents} | Bugs: ${Math.round(s.bugRate * 100)}% | Reverts: ${Math.round(s.revertRate * 100)}%\n   Tendance: ${s.recentTrend === "degrading" ? "📈 DÉGRADATION" : s.recentTrend === "improving" ? "📉 Amélioration" : "➡️ Stable"}\n   ${s.reason}`
        );
        return `📊 FRAGILITY LEADERBOARD (Top ${scores.length})\nApprentissage dynamique depuis l'historique réel\n\n${lines.join("\n\n")}`;
      }

      case "fragility_check": {
        const fp = args.file_path || args.path;
        if (!fp) return "❌ Fournis file_path du fichier à vérifier";
        const scores = await devopsIntelligenceEngine.calculateDynamicFragility(fp);
        if (!scores.length) {
          const basename = fp.split("/").pop() || "";
          const staticEntry = devopsIntelligenceEngine.findFragileModule(basename);
          return `📋 ${fp}\nScore statique: ${staticEntry?.fragility || 0}/100\nScore dynamique: 0 (aucun historique)\n${staticEntry ? `Raison: ${staticEntry.reason}` : "Fichier non dans la liste fragile statique"}\n💡 L'apprentissage dynamique démarrera au premier événement enregistré.`;
        }
        const s = scores[0];
        return `📋 FRAGILITY CHECK: ${s.filePath}\nScore combiné: ${s.combinedScore}/100\n  Static: ${s.staticScore} | Dynamic: ${s.dynamicScore}\nEvents: ${s.totalEvents} | Bugs: ${Math.round(s.bugRate * 100)}% | Reverts: ${Math.round(s.revertRate * 100)}%\nTendance: ${s.recentTrend === "degrading" ? "📈 DÉGRADATION" : s.recentTrend === "improving" ? "📉 Amélioration" : "➡️ Stable"}${s.lastIncident ? `\nDernier incident: ${s.lastIncident}` : ""}\n${s.reason}`;
      }

      case "record_event": {
        const events = args.events;
        if (!events?.length) return "❌ Fournis events: [{filePath, eventType, eventResult, commitSha?, description?}]";
        const count = await devopsIntelligenceEngine.recordFileEvent(events.map((e: any) => ({ ...e, userId })));
        return `✅ ${count} événement(s) enregistré(s) dans l'historique de fragilité dynamique.`;
      }

      case "report_bug": {
        const bugFiles = args.files?.map((f: any) => typeof f === "string" ? f : f.path) || args.affected_files || [];
        if (!bugFiles.length) return "❌ Fournis les fichiers concernés par le bug (files ou affected_files)";
        const entries = bugFiles.map((f: string) => ({
          filePath: f,
          eventType: "bug_report",
          eventResult: "bug",
          commitSha: args.commit_sha || null,
          description: args.description || args.problem || "Bug reporté",
          userId,
        }));
        const count = await devopsIntelligenceEngine.recordFileEvent(entries);
        return `🐛 Bug enregistré pour ${count} fichier(s). Leur score de fragilité dynamique va augmenter.\nFichiers: ${bugFiles.join(", ")}`;
      }

      case "pr_analyze": {
        const repo = args.repo || "ulysseproject";
        const prNum = args.pr_number || args.prNumber;
        if (!prNum) return "❌ Fournis pr_number (numéro de la PR)";
        const { devopsIntelligenceService: dis } = await import("./devopsIntelligenceService");
        const report = await dis.runIntelligenceForPR(userId, repo, prNum);
        const commented = args.auto_comment !== false ? await dis.postPRComment(repo, prNum, report) : false;
        const sections: string[] = [`🔬 ANALYSE PR #${prNum} (${repo})`];
        if (report.ciRisk) sections.push(`\n🔮 CI Oracle: ${report.ciRisk.overall}/100 (${report.ciRisk.riskLevel})\n${report.ciRisk.warnings.slice(0, 3).join("\n")}`);
        if (report.codeReview) sections.push(`\n🔍 Code Review: ${report.codeReview.score}/100 — ${report.codeReview.verdict} (${report.codeReview.issueCount} problèmes)`);
        if (report.impactMap) sections.push(`\n🧠 Impact: ${report.impactMap.nodeCount} fichiers, domaines: ${report.impactMap.domains.join(", ")}`);
        if (report.fragilityAlerts.length) sections.push(`\n⚡ ${report.fragilityAlerts.length} alerte(s) fragilité: ${report.fragilityAlerts.map(a => `${a.file}(${a.score})`).join(", ")}`);
        if (report.rollbackPlan) sections.push(`\n${report.rollbackPlan}`);
        if (commented) sections.push("\n✅ Commentaire posté sur la PR GitHub");
        return sections.join("\n");
      }

      case "commit_analyze": {
        const repo = args.repo || "ulysseproject";
        const sha = args.sha || args.commit_sha;
        if (!sha) return "❌ Fournis sha (SHA du commit)";
        const { devopsIntelligenceService: dis } = await import("./devopsIntelligenceService");
        const report = await dis.runIntelligenceForCommit(userId, repo, sha);
        const sections: string[] = [`📊 ANALYSE COMMIT ${sha.slice(0, 7)}`];
        if (report.ciRisk) sections.push(`Risk: ${report.ciRisk.overall}/100 (${report.ciRisk.riskLevel})`);
        if (report.codeReview) sections.push(`Review: ${report.codeReview.score}/100 — ${report.codeReview.verdict}`);
        if (report.fragilityAlerts.length) sections.push(`Fragilité: ${report.fragilityAlerts.map(a => `${a.file}(${a.score})`).join(", ")}`);
        return sections.join("\n");
      }

      case "domain_health": {
        const { devopsIntelligenceService: dis } = await import("./devopsIntelligenceService");
        const health = await dis.getDomainHealthSummary();
        const domains = Object.entries(health);
        if (!domains.length) return "📊 Pas assez de données pour l'analyse de santé des domaines.";
        const lines = domains.map(([d, h]) => {
          const trend = h.trend === "degrading" ? "📈 DÉGRADATION" : h.trend === "improving" ? "📉 Amélioration" : "➡️ Stable";
          return `• **${d}**: fragilité ${h.avgFragility}% | ${h.recentEvents} events récents | ${h.recentBugs} bugs | ${trend}${h.topFiles.length ? `\n  Top: ${h.topFiles.map(f => `${f.file}(${f.score})`).join(", ")}` : ""}`;
        });
        return `🏥 SANTÉ DES DOMAINES\n\n${lines.join("\n\n")}`;
      }

      case "diagnose_incident": {
        const { incidentCorrelationService } = await import("./incidentCorrelationService");
        const diagnosis = await incidentCorrelationService.diagnoseIncident({
          endpoint: args.endpoint,
          errorCode: args.error_code,
          errorMessage: args.error_message,
          domain: args.domain,
          hoursBack: args.hours_back || 24,
        });
        const sections = [`🔎 DIAGNOSTIC INCIDENT — Domaine: ${diagnosis.domain}`];
        sections.push(`Cause suspectée: ${diagnosis.suspectedCause} (confiance: ${diagnosis.confidence}%)`);
        if (diagnosis.recentChanges.length) sections.push(`\nChangements récents:\n${diagnosis.recentChanges.slice(0, 5).map(c => `  • ${c.filePath} (${c.eventResult}, fragilité: ${c.fragilityScore})`).join("\n")}`);
        if (diagnosis.fragilityAlerts.length) sections.push(`\nAlertes fragilité:\n${diagnosis.fragilityAlerts.map(a => `  • ${a.file}: ${a.score}/100 (${a.trend})`).join("\n")}`);
        sections.push(`\n💡 Recommandations:\n${diagnosis.recommendations.map(r => `  → ${r}`).join("\n")}`);
        return sections.join("\n");
      }

      case "smart_alerts": {
        const { incidentCorrelationService } = await import("./incidentCorrelationService");
        const alerts = await incidentCorrelationService.checkSmartAlerts();
        if (!alerts.length) return "✅ Aucune alerte DevOps active.";
        const lines = alerts.map(a => {
          const icon = a.severity === "critical" ? "🔴" : a.severity === "warning" ? "🟡" : "🔵";
          return `${icon} [${a.type}] ${a.message}`;
        });
        return `🚨 SMART ALERTS (${alerts.length})\n\n${lines.join("\n")}`;
      }

      case "process_bug": {
        const bugFiles = args.files?.map((f: any) => typeof f === "string" ? f : f.path) || args.affected_files || [];
        if (!bugFiles.length) return "❌ Fournis les fichiers concernés";
        const desc = args.description || args.problem || "Bug non décrit";
        const { devopsLearningService } = await import("./devopsLearningService");
        const result = await devopsLearningService.processBugAndLearn(userId, bugFiles, desc, args.commit_sha);
        return `🐛 BUG TRAITÉ (Boucle complète)\nEvents: ${result.eventsRecorded} | Gaps: ${result.gapsFound} | Homeworks créés: ${result.homeworksCreated}\n\nActions:\n${result.actions.map(a => `  • [${a.type}] ${a.detail}`).join("\n")}`;
      }

      default:
        return `❌ Action inconnue: ${action}. Actions: impact_map, analyze_impact, ci_risk, patch_advice, learning_gaps, full_report, code_review, fragility_leaderboard, fragility_check, record_event, report_bug, pr_analyze, commit_analyze, domain_health, diagnose_incident, smart_alerts, process_bug`;
    }
  } catch (err: any) {
    return `❌ Erreur DevOps Intelligence: ${err.message}`;
  }
}

// === WORK JOURNAL IMPLEMENTATIONS ===

async function executeWorkJournalManage(args: any, userId: number): Promise<string> {
  try {
    const { workJournalService } = await import("./workJournalService");
    const { action } = args;

    switch (action) {
      case "add": {
        if (!args.title) return JSON.stringify({ error: "title requis" });
        const entry = await workJournalService.addEntry({
          userId,
          title: args.title,
          content: args.content,
          entryType: args.entryType || "task",
          context: args.context || "general",
          priority: args.priority || "normal",
          source: args.source || "user",
          relatedFiles: args.relatedFiles,
          tags: args.tags,
          conversationId: args.conversationId,
        });
        return JSON.stringify({ success: true, action: "added", entry: { id: entry.id, title: entry.title, status: entry.status, context: entry.context, entryType: entry.entryType } });
      }

      case "update": {
        if (!args.entryId) return JSON.stringify({ error: "entryId requis" });
        const updates: any = {};
        if (args.title) updates.title = args.title;
        if (args.content) updates.content = args.content;
        if (args.status) updates.status = args.status;
        if (args.priority) updates.priority = args.priority;
        if (args.outcome) updates.outcome = args.outcome;
        if (args.tags) updates.tags = args.tags;
        if (args.relatedFiles) updates.relatedFiles = args.relatedFiles;
        const entry = await workJournalService.updateEntry(args.entryId, updates);
        if (!entry) return JSON.stringify({ error: `Entrée #${args.entryId} non trouvée` });
        return JSON.stringify({ success: true, action: "updated", entry: { id: entry.id, title: entry.title, status: entry.status } });
      }

      case "check": {
        if (!args.entryId) return JSON.stringify({ error: "entryId requis" });
        const entry = await workJournalService.checkTask(args.entryId, args.outcome);
        if (!entry) return JSON.stringify({ error: `Entrée #${args.entryId} non trouvée` });
        return JSON.stringify({ success: true, action: "checked", entry: { id: entry.id, title: entry.title, status: "done", outcome: entry.outcome } });
      }

      case "uncheck": {
        if (!args.entryId) return JSON.stringify({ error: "entryId requis" });
        const entry = await workJournalService.uncheckTask(args.entryId);
        if (!entry) return JSON.stringify({ error: `Entrée #${args.entryId} non trouvée` });
        return JSON.stringify({ success: true, action: "unchecked", entry: { id: entry.id, title: entry.title, status: "pending" } });
      }

      case "list": {
        const entries = await workJournalService.listEntries(userId, {
          context: args.context,
          status: args.status,
          entryType: args.entryType,
          includeCompleted: args.includeCompleted || false,
          limit: 30,
        });
        return JSON.stringify({
          success: true,
          count: entries.length,
          entries: entries.map(e => ({
            id: e.id,
            title: e.title,
            status: e.status,
            priority: e.priority,
            context: e.context,
            entryType: e.entryType,
            tags: e.tags,
            outcome: e.outcome,
            createdAt: e.createdAt,
            completedAt: e.completedAt,
          }))
        });
      }

      case "status": {
        const stats = await workJournalService.getStats(userId, args.context);
        return JSON.stringify({ success: true, stats });
      }

      case "delete": {
        if (!args.entryId) return JSON.stringify({ error: "entryId requis" });
        await workJournalService.deleteEntry(args.entryId);
        return JSON.stringify({ success: true, action: "deleted", entryId: args.entryId });
      }

      default:
        return JSON.stringify({ error: `Action inconnue: ${action}. Actions: add, update, check, uncheck, list, status, delete` });
    }
  } catch (error: any) {
    console.error("[WorkJournal] Error:", error.message);
    return JSON.stringify({ error: error.message });
  }
}

// === UNIVERSAL FILE ANALYSIS IMPLEMENTATIONS ===

async function downloadFromObjectStorage(storagePath: string): Promise<string | null> {
  const fs = await import("fs");
  const pathMod = await import("path");
  try {
    console.log(`[FileAnalysis] Downloading from object storage: ${storagePath}`);
    const { objectStorageClient } = await import("../../replit_integrations/object_storage/objectStorage");
    const client = objectStorageClient;
    if (!client) return null;
    const cleanPath = storagePath.startsWith("/") ? storagePath.slice(1) : storagePath;
    const parts = cleanPath.split("/");
    const bucketName = parts[0];
    const objectPath = parts.slice(1).join("/");
    const [contents] = await client.bucket(bucketName).file(objectPath).download();
    const ext = pathMod.extname(storagePath) || ".bin";
    const tmpPath = `/tmp/sugu_invoice_${Date.now()}${ext}`;
    fs.writeFileSync(tmpPath, contents);
    console.log(`[FileAnalysis] Downloaded → ${tmpPath} (${contents.length} bytes)`);
    return tmpPath;
  } catch (e: any) {
    console.warn(`[FileAnalysis] Object storage download failed: ${e.message}`);
    return null;
  }
}

async function resolveFilePathForAnalysis(filePath: string): Promise<string> {
  const fs = await import("fs");
  const pathMod = await import("path");
  
  if (fs.existsSync(filePath)) return filePath;
  
  const localAlt = pathMod.join(process.cwd(), filePath);
  if (fs.existsSync(localAlt)) return localAlt;
  
  const IS_REPLIT = !!(process.env.REPL_ID || process.env.REPLIT_CONNECTORS_HOSTNAME);
  const LOCAL_STORAGE_ROOT = process.env.LOCAL_STORAGE_PATH || "/opt/ulysse/storage";

  const isSuguPath = filePath.includes("sugu-valentine") || filePath.includes("sugu-maillane") || filePath.includes("suguval") || filePath.includes("sugumaillane") || filePath.includes("sugu_valentine") || filePath.includes("sugu_maillane");
  
  if (isSuguPath) {
    console.log(`[FileAnalysis] Detected SUGU path: ${filePath} — resolving via DB lookup`);
    const basename = pathMod.basename(filePath);
    try {
      const { db: fileDb } = await import("../db");
      const { suguFiles, suguMaillaneFiles } = await import("@shared/schema");
      const { or, ilike } = await import("drizzle-orm");
      
      const matches = await fileDb.select({ storagePath: suguFiles.storagePath, originalName: suguFiles.originalName })
        .from(suguFiles)
        .where(or(ilike(suguFiles.originalName, `%${basename}%`), ilike(suguFiles.fileName, `%${basename}%`)))
        .limit(1);
      
      const matchesM = matches.length === 0 ? await fileDb.select({ storagePath: suguMaillaneFiles.storagePath, originalName: suguMaillaneFiles.originalName })
        .from(suguMaillaneFiles)
        .where(or(ilike(suguMaillaneFiles.originalName, `%${basename}%`), ilike(suguMaillaneFiles.fileName, `%${basename}%`)))
        .limit(1) : [];
      
      const found = matches[0] || matchesM[0];
      if (found) {
        console.log(`[FileAnalysis] DB match: ${found.originalName} → ${found.storagePath}`);
        if (!IS_REPLIT) {
          const localPath = pathMod.join(LOCAL_STORAGE_ROOT, found.storagePath);
          if (fs.existsSync(localPath)) {
            console.log(`[FileAnalysis] Resolved from local storage: ${localPath}`);
            return localPath;
          }
        }
        const downloaded = await downloadFromObjectStorage(found.storagePath);
        if (downloaded) return downloaded;
      }
    } catch (dbErr: unknown) {
      console.warn(`[FileAnalysis] SUGU DB lookup failed:`, dbErr instanceof Error ? dbErr.message : String(dbErr));
    }
  }

  if (!IS_REPLIT && isSuguPath) {
    const localPath = pathMod.join(LOCAL_STORAGE_ROOT, filePath);
    if (fs.existsSync(localPath)) {
      console.log(`[FileAnalysis] Found on local storage: ${localPath}`);
      return localPath;
    }
  }

  const isObjectStoragePath = filePath.includes("replit-objstore") || filePath.includes(".private/") || isSuguPath;
  if (isObjectStoragePath) {
    const downloaded = await downloadFromObjectStorage(filePath);
    if (downloaded) return downloaded;
  }
  
  const isFilenameOnly = !filePath.includes("/") || (!fs.existsSync(filePath) && !filePath.includes("replit-objstore"));
  if (isFilenameOnly) {
    try {
      console.log(`[FileAnalysis] Looking up file in SUGU DB: ${filePath}`);
      const { db: fileDb } = await import("../db");
      const { suguFiles, suguMaillaneFiles } = await import("@shared/schema");
      const { or, ilike, eq } = await import("drizzle-orm");
      
      const basename = pathMod.basename(filePath);
      
      const matches = await fileDb.select({ storagePath: suguFiles.storagePath, originalName: suguFiles.originalName, fileName: suguFiles.fileName })
        .from(suguFiles)
        .where(or(
          ilike(suguFiles.originalName, `%${basename}%`),
          ilike(suguFiles.fileName, `%${basename}%`),
          eq(suguFiles.originalName, filePath),
          eq(suguFiles.fileName, filePath)
        ))
        .limit(1);
      
      if (matches.length > 0) {
        console.log(`[FileAnalysis] Found in sugu_files: ${matches[0].originalName} → ${matches[0].storagePath}`);
        if (!IS_REPLIT) {
          const localResolved = pathMod.join(LOCAL_STORAGE_ROOT, matches[0].storagePath);
          if (fs.existsSync(localResolved)) {
            console.log(`[FileAnalysis] Resolved from local storage: ${localResolved}`);
            return localResolved;
          }
        }
        const downloaded = await downloadFromObjectStorage(matches[0].storagePath);
        if (downloaded) return downloaded;
      }
      
      const matchesM = await fileDb.select({ storagePath: suguMaillaneFiles.storagePath, originalName: suguMaillaneFiles.originalName, fileName: suguMaillaneFiles.fileName })
        .from(suguMaillaneFiles)
        .where(or(
          ilike(suguMaillaneFiles.originalName, `%${basename}%`),
          ilike(suguMaillaneFiles.fileName, `%${basename}%`),
          eq(suguMaillaneFiles.originalName, filePath),
          eq(suguMaillaneFiles.fileName, filePath)
        ))
        .limit(1);
      
      if (matchesM.length > 0) {
        console.log(`[FileAnalysis] Found in sugu_maillane_files: ${matchesM[0].originalName} → ${matchesM[0].storagePath}`);
        if (!IS_REPLIT) {
          const localResolvedM = pathMod.join(LOCAL_STORAGE_ROOT, matchesM[0].storagePath);
          if (fs.existsSync(localResolvedM)) {
            console.log(`[FileAnalysis] Resolved from local storage: ${localResolvedM}`);
            return localResolvedM;
          }
        }
        const downloaded = await downloadFromObjectStorage(matchesM[0].storagePath);
        if (downloaded) return downloaded;
      }
      
      console.warn(`[FileAnalysis] File not found in SUGU DB: ${basename}`);
    } catch (dbErr: any) {
      console.warn(`[FileAnalysis] DB lookup failed: ${dbErr.message}`);
    }
  }
  
  return filePath;
}

async function executeAnalyzeFile(args: { file_path: string; analysis_type?: string }, userId?: number): Promise<string> {
  try {
    const { universalFileAnalyzer } = await import("./universalFileAnalyzer");
    
    const resolvedPath = await resolveFilePathForAnalysis(args.file_path);
    const isOwner = userId === 1;
    const result = await universalFileAnalyzer.analyzeFile(resolvedPath, args.analysis_type, isOwner);
    
    if (!result.success) {
      return JSON.stringify({ 
        success: false, 
        error: result.error || "Échec de l'analyse" 
      });
    }
    
    console.log(`[FileAnalysis] ${result.fileName}: ${result.analysis.documentType}, confidence: ${result.analysis.confidence}%`);
    
    return JSON.stringify({
      success: true,
      fileName: result.fileName,
      fileType: result.fileType,
      documentType: result.analysis.documentType,
      summary: result.analysis.summary,
      structuredData: result.analysis.structuredData,
      confidence: result.analysis.confidence,
      rawTextPreview: result.rawText.substring(0, 500) + "..."
    });
  } catch (error: any) {
    console.error("[FileAnalysis] Error:", error.message);
    return JSON.stringify({ success: false, error: error.message });
  }
}

async function executeAnalyzeInvoice(args: { file_path: string }, userId?: number): Promise<string> {
  try {
    const { universalFileAnalyzer } = await import("./universalFileAnalyzer");
    
    const resolvedPath = await resolveFilePathForAnalysis(args.file_path);
    const isOwner = userId === 1;
    const invoice = await universalFileAnalyzer.analyzeInvoice(resolvedPath, isOwner);
    
    console.log(`[InvoiceAnalysis] ${invoice.fournisseur} - ${invoice.numeroFacture}: ${invoice.lignes.length} lignes, validated: ${invoice.validated}`);
    
    return JSON.stringify({
      success: true,
      fournisseur: invoice.fournisseur,
      numeroFacture: invoice.numeroFacture,
      date: invoice.date,
      totalHT: invoice.totalHT,
      totalTVA: invoice.totalTVA,
      totalTTC: invoice.totalTTC,
      lignes: invoice.lignes,
      nombreLignes: invoice.lignes.length,
      validated: invoice.validated,
      validationDetails: invoice.validationDetails
    });
  } catch (error: any) {
    console.error("[InvoiceAnalysis] Error:", error.message);
    return JSON.stringify({ success: false, error: error.message });
  }
}

// === FILE PERSISTENCE HELPER ===
function getPersonaForUserId(userId: number): string {
  if (userId === 1) return "ulysse";
  if (userId >= 5) return "alfred";
  return "iris";
}

async function persistGeneratedFile(
  result: { fileName: string; filePath: string; fileType: string; size: number; downloadUrl?: string },
  userId: number,
  description?: string
): Promise<void> {
  try {
    const { storage } = await import("../storage");
    const mimeMap: Record<string, string> = {
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      csv: "text/csv",
      json: "application/json",
      md: "text/markdown",
      html: "text/html",
      doc: "application/msword",
      pdf: "application/pdf",
    };
    const ext = result.fileName.split(".").pop()?.toLowerCase() || "pdf";
    const mimeType = mimeMap[ext] || "application/octet-stream";
    const persona = getPersonaForUserId(userId);
    const storagePath = result.filePath || result.downloadUrl || `/api/files/download/${encodeURIComponent(result.fileName)}`;

    const existingFiles = await storage.getUlysseFiles(userId);
    const duplicate = existingFiles.find(f => 
      f.filename === result.fileName && f.category === "generated" && f.generatedBy === persona
    );

    if (duplicate) {
      try {
        const { db } = await import("../db");
        const { ulysseFiles } = await import("../../shared/schema");
        const { eq } = await import("drizzle-orm");
        await db.update(ulysseFiles).set({
          sizeBytes: result.size || 0,
          storagePath,
          description: description || result.fileName,
        }).where(eq(ulysseFiles.id, duplicate.id));
        console.log(`[FilePersist] ♻️ Updated existing: ${result.fileName} (id=${duplicate.id}, user=${userId})`);
      } catch (updateErr: any) {
        console.warn(`[FilePersist] Update failed, creating new: ${updateErr.message}`);
        await storage.createUlysseFile({
          userId, filename: result.fileName, originalName: result.fileName,
          mimeType, sizeBytes: result.size || 0, storagePath,
          description: description || result.fileName, generatedBy: persona, category: "generated",
        });
      }
    } else {
      await storage.createUlysseFile({
        userId, filename: result.fileName, originalName: result.fileName,
        mimeType, sizeBytes: result.size || 0, storagePath,
        description: description || result.fileName, generatedBy: persona, category: "generated",
      });
      console.log(`[FilePersist] ✅ Saved to DB: ${result.fileName} (user=${userId}, persona=${persona})`);
    }
  } catch (err: any) {
    console.error(`[FilePersist] ❌ DB save failed: ${err.message}`);
  }
}

// === UNIVERSAL FILE GENERATION ===
async function executeManage3DFile(args: {
  action: "create" | "analyze" | "edit" | "convert";
  format?: "stl" | "3mf";
  shape?: "box" | "sphere" | "cylinder" | "pyramid" | "torus";
  dimensions?: Record<string, number>;
  stl_format?: "ascii" | "binary";
  file_name?: string;
  file_id?: string;
  file_path?: string;
  operations?: Array<{ type: string; params: Record<string, number>; mergeFilePath?: string }>;
  target_format?: "stl" | "3mf";
}, userId?: number): Promise<string> {
  try {
    const fs = await import("fs");
    const path = await import("path");
    const { stl3mfService } = await import("./stl3mfService");
    const { action, format, shape, dimensions, stl_format, file_name, file_id, file_path: argFilePath, operations, target_format } = args;

    console.log(`[3DFile] Action: ${action}, format: ${format}, shape: ${shape}`);

    let resolvedPath = argFilePath;
    if (file_id && !resolvedPath) {
      const possibleDirs = ["uploads", "generated_files", "media_library"];
      const allFiles = possibleDirs.flatMap(dir => {
        try { return fs.readdirSync(dir).map(f => path.join(dir, f)); } catch { return []; }
      });
      resolvedPath = allFiles.find(f => f.includes(file_id) || path.basename(f).startsWith(file_id));
      if (!resolvedPath) {
        const { storage } = await import("../storage");
        const files = await (storage as any).getRecentFiles?.(userId || 1, 50);
        if (files) {
          const found = files.find((f: any) => String(f.id) === file_id || f.fileName?.includes(file_id));
          if (found) resolvedPath = found.filePath || found.path;
        }
      }
    }

    switch (action) {
      case "create": {
        if (!shape) return JSON.stringify({ success: false, error: "Forme requise (box, sphere, cylinder, pyramid, torus)" });
        const outputFormat = format || "stl";

        if (outputFormat === "3mf") {
          const result = stl3mfService.generate3MF({ shape, dimensions, fileName: file_name });
          await persistGeneratedFile(result, userId || 1, `3D ${shape} (3MF)`);
          return JSON.stringify({ success: true, message: `Fichier 3MF créé: ${result.fileName}`, ...result });
        } else {
          const result = stl3mfService.generateSTL({ shape, dimensions, format: stl_format || "ascii", fileName: file_name });
          await persistGeneratedFile(result, userId || 1, `3D ${shape} (STL)`);
          return JSON.stringify({
            success: true,
            message: `Fichier STL créé: ${result.fileName}`,
            fileName: result.fileName,
            fileType: result.fileType,
            size: result.size,
            downloadUrl: result.downloadUrl,
            analysis: {
              triangles: result.analysis.triangleCount,
              vertices: result.analysis.vertexCount,
              dimensions: result.analysis.dimensions,
              volume: result.analysis.volume,
              surfaceArea: result.analysis.surfaceArea,
            }
          });
        }
      }
      case "analyze": {
        if (!resolvedPath) return JSON.stringify({ success: false, error: "Fichier non trouvé. Fournir file_id ou file_path." });
        const analysis = stl3mfService.analyzeFile(resolvedPath);
        const formatted = stl3mfService.formatAnalysisForAI(analysis);
        return JSON.stringify({ success: true, analysis: formatted, raw: analysis });
      }
      case "edit": {
        if (!resolvedPath) return JSON.stringify({ success: false, error: "Fichier non trouvé. Fournir file_id ou file_path." });
        if (!operations || operations.length === 0) return JSON.stringify({ success: false, error: "Opérations requises" });
        const result = stl3mfService.editSTL(resolvedPath, operations as any);
        await persistGeneratedFile({ ...result, fileType: "stl", size: fs.statSync(result.filePath).size, downloadUrl: `/api/files/generated/${result.fileName}` }, userId || 1, "STL édité");
        return JSON.stringify({
          success: true,
          message: `Fichier édité: ${result.fileName}`,
          fileName: result.fileName,
          downloadUrl: `/api/files/generated/${result.fileName}`,
          analysis: {
            triangles: result.analysis.triangleCount,
            dimensions: result.analysis.dimensions,
            volume: result.analysis.volume,
          }
        });
      }
      case "convert": {
        if (!resolvedPath) return JSON.stringify({ success: false, error: "Fichier non trouvé. Fournir file_id ou file_path." });
        const ext = path.extname(resolvedPath).toLowerCase();
        let result;
        if (target_format === "3mf" || (ext === ".stl" && !target_format)) {
          result = stl3mfService.convertSTLto3MF(resolvedPath, file_name);
        } else {
          result = stl3mfService.convert3MFtoSTL(resolvedPath, file_name);
        }
        const stats = fs.statSync(result.filePath);
        await persistGeneratedFile({ ...result, fileType: target_format || "3mf", size: stats.size, downloadUrl: `/api/files/generated/${result.fileName}` }, userId || 1, `Conversion → ${target_format || "3mf"}`);
        return JSON.stringify({ success: true, message: `Converti: ${result.fileName}`, ...result, downloadUrl: `/api/files/generated/${result.fileName}` });
      }
      default:
        return JSON.stringify({ success: false, error: `Action inconnue: ${action}` });
    }
  } catch (error: any) {
    console.error("[3DFile] Error:", error.message);
    return JSON.stringify({ success: false, error: error.message });
  }
}

async function executeGenerateFile(args: { 
  format: "excel" | "csv" | "pdf" | "word" | "json" | "markdown";
  content_description?: string;
  data?: any;
  file_name?: string;
  title?: string;
}, userId?: number): Promise<string> {
  try {
    const { fileGenerator } = await import("./universalFileGenerator");
    
    const { format, content_description, data, file_name, title } = args;
    
    console.log(`[FileGenerator] Generating ${format}: ${file_name || content_description}`);
    
    if ((format === "excel" || format === "csv") && !data) {
      console.error(`[FileGenerator] ❌ REJETÉ: Excel/CSV sans données structurées`);
      return JSON.stringify({ 
        success: false, 
        error: `❌ ERREUR: Pour générer un Excel/CSV, tu DOIS passer les vraies données dans "data".

EXEMPLE OBLIGATOIRE:
{
  "format": "excel",
  "data": [
    {"Réf": "F2256V", "Désignation": "FILET DE POULET", "Qté": 55.43, "PU_HT": 13.30, "Total_HT": 737.22},
    {"Réf": "13342", "Désignation": "CUISSES DE POULET", "Qté": 20.5, "PU_HT": 4.50}
  ],
  "file_name": "Export_Facture"
}

⚠️ Tu as les données dans le rapport - extrais chaque ligne et passe-les dans "data"!` 
      });
    }
    
    let result;
    
    if (content_description && !data) {
      result = await fileGenerator.generateWithAI(content_description, format, { title });
    } else if (data) {
      result = await fileGenerator.generate({
        type: format,
        content: data,
        fileName: file_name,
        options: { title }
      });
    } else {
      return JSON.stringify({ 
        success: false, 
        error: "Fournir soit content_description (génération AI) soit data (données brutes)" 
      });
    }
    
    if (result.success) {
      console.log(`[FileGenerator] ✅ Generated: ${result.fileName} (${result.size} bytes)`);
      
      await persistGeneratedFile(result, userId || 1, content_description || title || result.fileName);
      
      return JSON.stringify({
        success: true,
        message: `Fichier ${result.fileName} généré avec succès`,
        fileName: result.fileName,
        fileType: result.fileType,
        size: result.size,
        downloadUrl: result.downloadUrl
      });
    } else {
      return JSON.stringify({ success: false, error: result.error });
    }
  } catch (error: any) {
    console.error("[FileGenerator] Error:", error.message);
    return JSON.stringify({ success: false, error: error.message });
  }
}

async function executeExportAnalysis(args: {
  analysis_data: any;
  export_format: "excel" | "csv" | "pdf" | "markdown";
  file_name?: string;
}, userId?: number): Promise<string> {
  try {
    const { fileGenerator } = await import("./universalFileGenerator");
    
    const { analysis_data, export_format, file_name } = args;
    
    console.log(`[ExportAnalysis] Exporting to ${export_format}`);
    
    const result = await fileGenerator.generateReport(analysis_data, export_format);
    
    if (result.success) {
      console.log(`[ExportAnalysis] ✅ Exported: ${result.fileName}`);
      
      await persistGeneratedFile(result, userId || 1, `Export: ${analysis_data?.summary || result.fileName}`);
      
      return JSON.stringify({
        success: true,
        message: `Export ${result.fileName} créé avec succès`,
        fileName: result.fileName,
        fileType: result.fileType,
        size: result.size,
        downloadUrl: result.downloadUrl
      });
    } else {
      return JSON.stringify({ success: false, error: result.error });
    }
  } catch (error: any) {
    console.error("[ExportAnalysis] Error:", error.message);
    return JSON.stringify({ success: false, error: error.message });
  }
}

// === EXPORT FACTURE AUTOMATIQUE ===
async function executeExportInvoiceExcel(args: { 
  invoice_report: string;
  file_name?: string;
  fournisseur?: string;
}, userId?: number): Promise<string> {
  try {
    const { fileGenerator } = await import("./universalFileGenerator");
    
    const { invoice_report, file_name, fournisseur } = args;
    
    console.log(`[ExportInvoiceExcel] 🎯 Parsing rapport markdown (${invoice_report.length} chars)`);
    
    // Parser le rapport markdown pour extraire les lignes d'articles
    const excelData: any[] = [];
    let currentFacture = "";
    let currentDate = "";
    
    // Regex pour les en-têtes de facture: ### F212340802 - 31/12/2025 (305,67 €)
    const factureHeaderRegex = /###\s+(F\d+)\s+-\s+(\d{2}\/\d{2}\/\d{2,4})/g;
    
    // Regex pour les lignes de tableau: | 13342 | HEN FEUILLES DE BRICKS 170G | 10 | 1,30 € | 13,00 € | 5.5% |
    const tableRowRegex = /\|\s*([A-Z0-9]+)\s*\|\s*(.+?)\s*\|\s*([\d.,]+)\s*\|\s*([\d.,]+)\s*€?\s*\|\s*([\d.,]+)\s*€?\s*\|\s*([\d.,]+)%?\s*\|/g;
    
    // Split par sections de facture
    const sections = invoice_report.split(/###\s+F\d+\s+-/);
    const headers = [...invoice_report.matchAll(/###\s+(F\d+)\s+-\s+(\d{2}\/\d{2}\/\d{2,4})/g)];
    
    for (let i = 0; i < headers.length; i++) {
      const match = headers[i];
      currentFacture = match[1];
      currentDate = match[2];
      
      // Trouver la section correspondante
      const sectionContent = sections[i + 1] || "";
      
      // Extraire les lignes de tableau
      const lines = sectionContent.split('\n');
      for (const line of lines) {
        // Skip header rows
        if (line.includes('Réf') || line.includes('---')) continue;
        
        const rowMatch = line.match(/\|\s*([A-Z0-9]+)\s*\|\s*(.+?)\s*\|\s*([\d.,]+)\s*\|\s*([\d.,]+)\s*€?\s*\|\s*([\d.,]+)\s*€?\s*\|\s*([\d.,]+)%?\s*\|/);
        if (rowMatch) {
          excelData.push({
            "N° Facture": currentFacture,
            "Date": currentDate,
            "Réf": rowMatch[1].trim(),
            "Désignation": rowMatch[2].trim(),
            "Qté": parseFloat(rowMatch[3].replace(',', '.')),
            "PU HT": parseFloat(rowMatch[4].replace(',', '.')),
            "Total HT": parseFloat(rowMatch[5].replace(',', '.')),
            "TVA %": rowMatch[6].trim() + "%",
            "Fournisseur": fournisseur || "Zouaghi"
          });
        }
      }
    }
    
    console.log(`[ExportInvoiceExcel] Parsed ${excelData.length} lignes d'articles`);
    
    if (excelData.length === 0) {
      return JSON.stringify({ 
        success: false, 
        error: "Aucune ligne d'article trouvée dans le rapport. Vérifie que le rapport contient des tableaux avec Réf, Désignation, Qté, etc." 
      });
    }
    
    // Générer l'Excel
    const outputName = file_name || `Export_${fournisseur || 'Factures'}_${new Date().toISOString().split('T')[0]}`;
    
    const result = await fileGenerator.generate({
      type: "excel",
      content: excelData,
      fileName: outputName,
      options: { title: `Factures ${fournisseur || 'Export'}` }
    });
    
    if (result.success) {
      console.log(`[ExportInvoiceExcel] ✅ Excel généré: ${result.fileName} (${result.size} bytes, ${excelData.length} lignes)`);
      
      await persistGeneratedFile(result, userId || 1, `Factures ${fournisseur || 'Export'}`);
      
      return JSON.stringify({
        success: true,
        message: `✅ Excel généré avec ${excelData.length} lignes d'articles`,
        fileName: result.fileName,
        fileType: result.fileType,
        size: result.size,
        downloadUrl: result.downloadUrl,
        lignesExportees: excelData.length,
        fournisseur: fournisseur || "Zouaghi"
      });
    } else {
      return JSON.stringify({ success: false, error: result.error });
    }
  } catch (error: any) {
    console.error("[ExportInvoiceExcel] Error:", error.message);
    return JSON.stringify({ success: false, error: error.message });
  }
}

// === GENERATE INVOICE PDF ===
async function executeGenerateInvoicePdf(args: {
  emetteur: { nom: string; adresse?: string; tel?: string; siret?: string; rcs?: string };
  client: { nom: string; adresse?: string };
  numero: string;
  date: string;
  code_client?: string;
  chantier?: string;
  lignes: Array<{ designation: string; unite?: string; quantite?: number; prix_unitaire: number; tva_taux?: number; remise?: number }>;
  acompte?: number;
  file_name?: string;
  mentions_legales?: string;
}, userId?: number): Promise<string> {
  try {
    const { fileGenerator } = await import("./universalFileGenerator");
    const fileName = (args.file_name || `Facture_${args.numero}`).replace(/[^a-zA-Z0-9_-]/g, "_");
    console.log(`[InvoicePDF] Generating: ${fileName} (${args.lignes.length} lignes)`);
    
    const result = await fileGenerator.generateInvoicePDF({
      emetteur: args.emetteur,
      client: args.client,
      numero: args.numero,
      date: args.date,
      code_client: args.code_client,
      chantier: args.chantier,
      lignes: args.lignes,
      acompte: args.acompte,
      mentions_legales: args.mentions_legales
    }, fileName);

    if (result.success) {
      await persistGeneratedFile(result, userId || 1, `Facture ${args.numero}`);
      console.log(`[InvoicePDF] ✅ Generated: ${result.fileName} (${result.size} bytes)`);
      return JSON.stringify({
        success: true,
        message: `Facture PDF générée: ${result.fileName}`,
        fileName: result.fileName,
        fileType: "pdf",
        size: result.size,
        downloadUrl: result.downloadUrl
      });
    }
    return JSON.stringify({ success: false, error: result.error });
  } catch (error: any) {
    console.error("[InvoicePDF] Error:", error.message);
    return JSON.stringify({ success: false, error: error.message });
  }
}

// === AUTOMATION FEATURE IMPLEMENTATIONS ===

async function executeGenerateMorningBriefing(args: Record<string, any>): Promise<string> {
  try {
    const { morningBriefingService } = await import("./morningBriefingService");
    if (args.sendEmail) {
      const result = await morningBriefingService.sendBriefingEmail(args.email);
      if (result.success) {
        const briefing = morningBriefingService.getLastBriefing();
        return JSON.stringify({ success: true, message: "Briefing envoyé par email", briefing });
      }
      return JSON.stringify(result);
    }
    const briefing = await morningBriefingService.generateBriefing();
    let text = `${briefing.greeting}\n📅 ${briefing.date}\n\n`;
    for (const s of briefing.sections) {
      text += `${s.icon} ${s.title}\n${s.content}\n\n`;
    }
    return text;
  } catch (e: any) {
    return JSON.stringify({ error: e.message });
  }
}

async function executeGenerateFinancialReport(args: Record<string, any>): Promise<string> {
  try {
    const { reportGeneratorService } = await import("./reportGeneratorService");
    const restaurant = args.restaurant || "both";
    const period = args.period || "month";

    if (args.sendEmail && args.email) {
      const result = await reportGeneratorService.generateAndEmailReport(restaurant, period, args.email, args.customStart, args.customEnd);
      return JSON.stringify({ success: result.success, message: result.success ? "Rapport envoyé par email" : result.error });
    }

    const report = await reportGeneratorService.generateReport(restaurant, period, args.customStart, args.customEnd);
    const d = report.data;
    const fmt = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
    let text = `📊 Rapport ${d.period.label}\n\n`;
    text += `💰 Encaissements: ${fmt(d.bank.credits)}\n`;
    text += `💸 Décaissements: ${fmt(d.bank.debits)}\n`;
    text += `📈 Résultat: ${fmt(d.bank.credits - d.bank.debits)}\n`;
    text += `🏦 Solde: ${fmt(d.bank.balance)}\n\n`;
    text += `🛒 Achats: ${fmt(d.purchases.total)} (${d.purchases.count} factures)\n`;
    if (d.purchases.topSuppliers.length > 0) {
      text += `Top fournisseurs: ${d.purchases.topSuppliers.slice(0, 5).map(s => `${s.name} (${fmt(s.total)})`).join(", ")}\n`;
    }
    text += `\n💰 Frais: ${fmt(d.expenses.total)} (${d.expenses.count} écritures)\n`;
    text += `👥 Effectif: ${d.employees.count} | Paie: ${fmt(d.employees.payrollTotal)}\n`;
    return text;
  } catch (e: any) {
    return JSON.stringify({ error: e.message });
  }
}

async function executeAnalyzeDocumentImage(args: Record<string, any>): Promise<string> {
  try {
    const { documentVisionService } = await import("./documentVisionService");
    if (args.autoFile && args.restaurant) {
      const result = await documentVisionService.analyzeAndAutoFile(args.imageBase64, args.mimeType || "image/jpeg", args.restaurant);
      return JSON.stringify(result);
    }
    const result = await documentVisionService.analyzeDocumentImage(args.imageBase64, args.mimeType || "image/jpeg");
    if (result.success && result.data) {
      const d = result.data;
      return `📄 Document analysé:\n• Type: ${d.type}\n• Fournisseur: ${d.supplier}\n• Montant: ${d.amount}€\n• TVA: ${d.taxAmount}€\n• Date: ${d.invoiceDate}\n• N°: ${d.invoiceNumber}\n• Catégorie: ${d.category}\n• Confiance: ${(d.confidence * 100).toFixed(0)}%`;
    }
    return JSON.stringify(result);
  } catch (e: any) {
    return JSON.stringify({ error: e.message });
  }
}

async function executeImportBankStatement(args: Record<string, any>): Promise<string> {
  try {
    const { bankStatementImportService } = await import("./bankStatementImportService");
    let preview = await bankStatementImportService.parseCSV(args.csvContent, args.restaurant);
    preview = await bankStatementImportService.enhanceWithAI(preview);

    if (args.autoConfirm) {
      const result = await bankStatementImportService.confirmImport(preview);
      const { emitBankImportEvent } = await import("./interconnectEmitter");
      emitBankImportEvent(result, args.restaurant || "val");
      return JSON.stringify({
        success: result.success,
        imported: result.imported,
        skipped: result.skipped,
        errors: result.errors,
        summary: preview.summary
      });
    }

    return JSON.stringify({
      preview: {
        entryCount: preview.entries.length,
        totalCredits: preview.summary.totalCredits.toFixed(2),
        totalDebits: preview.summary.totalDebits.toFixed(2),
        categorized: preview.summary.categorized,
        uncategorized: preview.summary.uncategorized,
        sampleEntries: preview.entries.slice(0, 5).map(e => ({
          date: e.date, label: e.label, amount: e.amount, category: e.category, supplier: e.matchedSupplier
        }))
      },
      message: "Aperçu généré. Utilise autoConfirm=true pour importer."
    });
  } catch (e: any) {
    return JSON.stringify({ error: e.message });
  }
}

async function executeManageTelegramBot(args: Record<string, any>): Promise<string> {
  try {
    const { telegramBotService } = await import("./telegramBotService");
    switch (args.action) {
      case "init": {
        const result = await telegramBotService.init();
        return JSON.stringify(result);
      }
      case "set_webhook": {
        if (!args.webhookUrl) return JSON.stringify({ error: "webhookUrl requis" });
        const result = await telegramBotService.setWebhook(args.webhookUrl);
        return JSON.stringify(result);
      }
      case "remove_webhook": {
        const result = await telegramBotService.removeWebhook();
        return JSON.stringify(result);
      }
      case "status": {
        return JSON.stringify(telegramBotService.getStatus());
      }
      case "send_message": {
        if (!args.chatId || !args.message) return JSON.stringify({ error: "chatId et message requis" });
        await telegramBotService.sendMessage(args.chatId, args.message);
        return JSON.stringify({ success: true, message: "Message envoyé" });
      }
      default:
        return JSON.stringify({ error: `Action inconnue: ${args.action}` });
    }
  } catch (e: any) {
    return JSON.stringify({ error: e.message });
  }
}

async function resolvePdfPath(filePath: string): Promise<string> {
  const fs = await import("fs");
  const path = await import("path");
  if (fs.existsSync(filePath)) return filePath;

  const uploadsDir = path.join(process.cwd(), "uploads");
  const generatedDir = path.join(process.cwd(), "generated_files");

  const fullUpload = path.join(uploadsDir, path.basename(filePath));
  if (fs.existsSync(fullUpload)) return fullUpload;
  const fullGenerated = path.join(generatedDir, path.basename(filePath));
  if (fs.existsSync(fullGenerated)) return fullGenerated;

  if (/^\d+$/.test(filePath)) {
    try {
      const { db } = await import("../db");
      const { ulysseFiles } = await import("../../shared/schema");
      const { eq } = await import("drizzle-orm");
      const rows = await db.select({ storagePath: ulysseFiles.storagePath }).from(ulysseFiles).where(eq(ulysseFiles.id, parseInt(filePath))).limit(1);
      if (rows.length > 0 && fs.existsSync(rows[0].storagePath)) return rows[0].storagePath;
    } catch {}
  }

  try {
    const { db } = await import("../db");
    const { ulysseFiles } = await import("../../shared/schema");
    const { desc } = await import("drizzle-orm");
    const baseName = path.basename(filePath).replace(/^\d+-/, '');
    const allFiles = await db.select({ storagePath: ulysseFiles.storagePath, filename: ulysseFiles.filename, originalName: ulysseFiles.originalName }).from(ulysseFiles).orderBy(desc(ulysseFiles.id)).limit(100);
    for (const f of allFiles) {
      if ((f.filename.includes(baseName) || f.originalName.includes(baseName) || baseName.includes(f.originalName)) && fs.existsSync(f.storagePath)) {
        return f.storagePath;
      }
    }
    const searchTerm = baseName.replace(/\.[^.]+$/, '').toLowerCase();
    for (const f of allFiles) {
      if ((f.filename.toLowerCase().includes(searchTerm) || f.originalName.toLowerCase().includes(searchTerm)) && fs.existsSync(f.storagePath)) {
        return f.storagePath;
      }
    }
  } catch {}

  try {
    const files = fs.readdirSync(uploadsDir);
    const baseName = path.basename(filePath).replace(/^\d+-/, '').toLowerCase();
    const searchTerm = baseName.replace(/\.[^.]+$/, '');
    for (const f of files) {
      if (f.toLowerCase().includes(searchTerm)) {
        return path.join(uploadsDir, f);
      }
    }
  } catch {}

  return filePath;
}

async function executePdfMaster(args: Record<string, any>): Promise<string> {
  try {
    const { pdfMasterService } = await import("./pdfMasterService");
    const { action, file_paths, question, watermark_text, page_ranges, page_numbers, page_number, angle, output_name, additions } = args;
    const file_path = args.file_path ? await resolvePdfPath(args.file_path) : undefined;

    switch (action) {
      case "extract": {
        if (!file_path) return JSON.stringify({ error: "file_path requis pour extract" });
        const result = await pdfMasterService.extractText(file_path);
        return JSON.stringify({ success: result.success, method: result.method, pages: result.pages, confidence: result.confidence, text: result.text.substring(0, 8000), textLength: result.text.length });
      }
      case "analyze": {
        if (!file_path) return JSON.stringify({ error: "file_path requis pour analyze" });
        const result = await pdfMasterService.analyze(file_path, question);
        return JSON.stringify(result);
      }
      case "merge": {
        const paths = file_paths || [file_path];
        if (!paths || paths.length < 2) return JSON.stringify({ error: "Au moins 2 fichiers requis pour merge (file_paths)" });
        const result = await pdfMasterService.mergePDFs(paths, output_name);
        return JSON.stringify(result);
      }
      case "split": {
        if (!file_path) return JSON.stringify({ error: "file_path requis pour split" });
        if (!page_ranges) return JSON.stringify({ error: "page_ranges requis pour split (ex: [[1,3],[4,6]])" });
        const results = await pdfMasterService.splitPDF(file_path, page_ranges);
        return JSON.stringify(results);
      }
      case "watermark": {
        if (!file_path) return JSON.stringify({ error: "file_path requis pour watermark" });
        if (!watermark_text) return JSON.stringify({ error: "watermark_text requis" });
        const result = await pdfMasterService.addWatermark(file_path, watermark_text);
        return JSON.stringify(result);
      }
      case "compress": {
        if (!file_path) return JSON.stringify({ error: "file_path requis pour compress" });
        const result = await pdfMasterService.compress(file_path);
        return JSON.stringify(result);
      }
      case "info": {
        if (!file_path) return JSON.stringify({ error: "file_path requis pour info" });
        const result = await pdfMasterService.getInfo(file_path);
        return JSON.stringify(result);
      }
      case "rotate": {
        if (!file_path) return JSON.stringify({ error: "file_path requis pour rotate" });
        const result = await pdfMasterService.rotatePage(file_path, page_number || 1, (angle || 90) as any);
        return JSON.stringify(result);
      }
      case "add_text": {
        if (!file_path) return JSON.stringify({ error: "file_path requis pour add_text" });
        if (!additions) return JSON.stringify({ error: "additions requis (tableau de {page, text, x, y})" });
        const result = await pdfMasterService.addText(file_path, additions);
        return JSON.stringify(result);
      }
      case "extract_pages": {
        if (!file_path) return JSON.stringify({ error: "file_path requis pour extract_pages" });
        if (!page_numbers) return JSON.stringify({ error: "page_numbers requis (ex: [1, 3, 5])" });
        const result = await pdfMasterService.extractPages(file_path, page_numbers);
        return JSON.stringify(result);
      }
      default:
        return JSON.stringify({ error: `Action PDF inconnue: ${action}. Actions: extract, analyze, merge, split, watermark, compress, info, rotate, add_text, extract_pages` });
    }
  } catch (e: any) {
    console.error("[PDFMaster] Tool execution error:", e);
    return JSON.stringify({ error: e.message });
  }
}

async function executeBridge(method: string, args: Record<string, any>): Promise<string> {
  try {
    const { unexploitedToolsBridge } = await import("./unexploitedToolsBridge");
    const fn = (unexploitedToolsBridge as any)[method];
    if (!fn) return JSON.stringify({ error: `Bridge method '${method}' not found` });
    return await fn(args);
  } catch (e: any) {
    console.error(`[Bridge:${method}] Error:`, e.message);
    return JSON.stringify({ error: e.message });
  }
}

async function executeFileConvert(args: Record<string, any>): Promise<string> {
  try {
    const { fileToolsAdvanced } = await import("./fileToolsAdvanced");
    return await fileToolsAdvanced.convert(args as any);
  } catch (e: any) { return JSON.stringify({ error: e.message }); }
}

async function executeFileCompress(args: Record<string, any>): Promise<string> {
  try {
    const { fileToolsAdvanced } = await import("./fileToolsAdvanced");
    return await fileToolsAdvanced.compress(args as any);
  } catch (e: any) { return JSON.stringify({ error: e.message }); }
}

async function executeSpreadsheetAnalyze(args: Record<string, any>): Promise<string> {
  try {
    const { fileToolsAdvanced } = await import("./fileToolsAdvanced");
    return await fileToolsAdvanced.spreadsheetAnalyze(args as any);
  } catch (e: any) { return JSON.stringify({ error: e.message }); }
}

async function executeDocumentCompare(args: Record<string, any>): Promise<string> {
  try {
    const { fileToolsAdvanced } = await import("./fileToolsAdvanced");
    return await fileToolsAdvanced.compare(args as any);
  } catch (e: any) { return JSON.stringify({ error: e.message }); }
}

async function executeQrCodeGenerate(args: Record<string, any>): Promise<string> {
  try {
    const { fileToolsAdvanced } = await import("./fileToolsAdvanced");
    return await fileToolsAdvanced.qrCode(args as any);
  } catch (e: any) { return JSON.stringify({ error: e.message }); }
}

async function executeOcrExtract(args: Record<string, any>): Promise<string> {
  try {
    const { fileToolsAdvanced } = await import("./fileToolsAdvanced");
    return await fileToolsAdvanced.ocrExtract(args as any);
  } catch (e: any) { return JSON.stringify({ error: e.message }); }
}

async function executeToolsCheckup(args: Record<string, any>): Promise<string> {
  try {
    const { runToolsAudit } = await import("../tests/toolsAudit");
    const summary = await runToolsAudit();
    const verbose = args.verbose === true;

    const report: any = {
      success: true,
      score: `${summary.pct}%`,
      total: summary.total,
      ok: summary.ok,
      warn: summary.warn,
      fail: summary.fail,
      error: summary.error,
      status: summary.fail + summary.error === 0 ? "ALL_PASS" : "HAS_FAILURES",
    };

    if (verbose && summary.results) {
      report.details = Object.values(summary.results).map((r: any) => ({
        tool: r.tool,
        label: r.label,
        status: r.status,
        timeMs: r.timeMs,
        message: r.message,
      }));
    }

    if (summary.fail + summary.error > 0 && summary.results) {
      report.failures = Object.values(summary.results)
        .filter((r: any) => r.status === "FAIL" || r.status === "ERROR")
        .map((r: any) => ({ tool: r.tool, status: r.status, message: r.message }));
    }

    return JSON.stringify(report);
  } catch (e: any) {
    console.error("[ToolsCheckup] Error:", e);
    return JSON.stringify({ error: e.message });
  }
}

async function executeVisionLiveAnalyze(args: Record<string, any>): Promise<string> {
  try {
    const { visionLiveService } = await import("./visionLiveService");
    const result = await visionLiveService.analyzeImage(
      args.imageBase64,
      args.mimeType || "image/jpeg",
      args.restaurant || "suguval"
    );
    return JSON.stringify(result);
  } catch (e: any) {
    console.error("[VisionLive] Tool error:", e);
    return JSON.stringify({ error: e.message });
  }
}

async function executeDigitalTwinSnapshot(args: Record<string, any>): Promise<string> {
  try {
    const { digitalTwinService } = await import("./digitalTwinService");
    const snapshot = await digitalTwinService.getSnapshot(args.restaurant || "suguval");
    return JSON.stringify({ success: true, snapshot });
  } catch (e: any) {
    console.error("[DigitalTwin] Snapshot error:", e);
    return JSON.stringify({ error: e.message });
  }
}

async function executeDigitalTwinSimulate(args: Record<string, any>): Promise<string> {
  try {
    const { digitalTwinService } = await import("./digitalTwinService");
    const result = await digitalTwinService.simulate(
      { type: args.type, params: args.params || {} },
      args.restaurant || "suguval"
    );
    return JSON.stringify(result);
  } catch (e: any) {
    console.error("[DigitalTwin] Simulate error:", e);
    return JSON.stringify({ error: e.message });
  }
}

async function executeAutonomousAgent(args: Record<string, any>, userId?: number): Promise<string> {
  try {
    const { autonomousAgentService } = await import("./autonomousAgentService");
    const task = await autonomousAgentService.planAndExecute(args.goal, userId || 1, args.maxSteps || 8);
    return JSON.stringify({
      success: task.status === "completed",
      taskId: task.id,
      status: task.status,
      stepsCompleted: task.steps.filter(s => s.status === "completed").length,
      stepsTotal: task.steps.length,
      summary: task.finalSummary,
    });
  } catch (e: any) {
    console.error("[AutonomousAgent] Tool error:", e);
    return JSON.stringify({ error: e.message });
  }
}

async function executeVoiceSynthesize(args: Record<string, any>): Promise<string> {
  try {
    const { voiceModeService } = await import("./voiceModeService");
    const result = await voiceModeService.synthesize(args.text, args.voice || "onyx", args.speed || 1.0);
    return JSON.stringify(result);
  } catch (e: any) {
    console.error("[VoiceSynthesize] Tool error:", e);
    return JSON.stringify({ error: e.message });
  }
}

async function executeVoiceStatus(): Promise<string> {
  try {
    const { voiceModeService } = await import("./voiceModeService");
    return JSON.stringify(voiceModeService.getStatus());
  } catch (e: any) {
    return JSON.stringify({ error: e.message });
  }
}

export const toolOrchestrator = new ToolOrchestrator();
