import OpenAI from "openai";
import { getOpenAI } from '../core/openaiClient.js';

type ChatCompletionTool = OpenAI.Chat.Completions.ChatCompletionTool;

// === Lazy service loader (local helper) ===
async function loadService(serviceName: string): Promise<any> {
    try {
        switch (serviceName) {
            case 'suguval':
                return (await import("../suguvalActionService")).suguvalActionService;
            case 'brain':
                return (await import("../brainService")).brainService;
            case 'trading':
                return (await import("../tradingAnalysisService")).tradingAnalysisService;
            case 'search':
                return (await import("../searchOrchestrator")).searchOrchestrator;
            case 'smarthome':
                return (await import("../smartHomeActionService")).smartHomeActionService;
            default:
                return null;
        }
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.log(`[utilityTools] Service ${serviceName} not available: ${msg}`);
        return null;
    }
}

// ─── Tool definitions ────────────────────────────────────────────────

export const utilityToolDefs: ChatCompletionTool[] = [
    // === DATA TOOLS ===
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

    // === BANK MANAGEMENT ===
    {
        type: "function",
        function: {
            name: "manage_sugu_bank",
            description: "Gère les écritures bancaires Suguval : lister, créer, modifier ou supprimer des entrées du relevé bancaire.",
            parameters: {
                type: "object",
                properties: {
                    action: { type: "string", enum: ["list", "create", "update", "delete"], description: "Action à effectuer" },
                    id: { type: "number", description: "ID de l'écriture (requis pour update/delete)" },
                    label: { type: "string", description: "Libellé de l'écriture" },
                    amount: { type: "number", description: "Montant (positif=crédit, négatif=débit)" },
                    entryDate: { type: "string", description: "Date au format YYYY-MM-DD" },
                    bankName: { type: "string", description: "Nom de la banque" },
                    category: { type: "string", description: "Catégorie (encaissement_cb, plateforme, achat_fournisseur, loyer, salaire, etc.)" },
                    balance: { type: "number", description: "Solde après opération" },
                    notes: { type: "string", description: "Notes libres" },
                    limit: { type: "number", description: "Nombre max de résultats pour list (défaut 50)" },
                    search: { type: "string", description: "Recherche par libellé pour list (ex: 'Orange', 'loyer', 'SG')" },
                    startDate: { type: "string", description: "Date de début pour filtrer (YYYY-MM-DD). Ex: '2026-01-01'" },
                    endDate: { type: "string", description: "Date de fin pour filtrer (YYYY-MM-DD). Ex: '2026-01-31'" }
                },
                required: ["action"]
            }
        }
    },

    // === PURCHASES MANAGEMENT ===
    {
        type: "function",
        function: {
            name: "manage_sugu_purchases",
            description: "Gère les achats/factures fournisseurs Suguval : lister, rechercher, créer, modifier ou supprimer. Permet de trouver combien on a payé à un fournisseur donné sur une période.",
            parameters: {
                type: "object",
                properties: {
                    action: { type: "string", enum: ["list", "create", "update", "delete"], description: "Action à effectuer" },
                    id: { type: "number", description: "ID de la facture (requis pour update/delete)" },
                    supplier: { type: "string", description: "Nom du fournisseur (ex: 'Metro', 'Orange', 'Brake')" },
                    description: { type: "string", description: "Description de l'achat" },
                    category: { type: "string", enum: ["alimentaire", "boissons", "emballages", "consommables", "equipement", "autre"], description: "Catégorie" },
                    amount: { type: "number", description: "Montant TTC" },
                    taxAmount: { type: "number", description: "Montant TVA" },
                    invoiceNumber: { type: "string", description: "Numéro de facture" },
                    invoiceDate: { type: "string", description: "Date de facture (YYYY-MM-DD)" },
                    dueDate: { type: "string", description: "Date d'échéance" },
                    isPaid: { type: "boolean", description: "Facture payée ?" },
                    paidDate: { type: "string", description: "Date de paiement" },
                    paymentMethod: { type: "string", description: "Mode de paiement (virement, chèque, CB, espèces)" },
                    notes: { type: "string", description: "Notes" },
                    search: { type: "string", description: "Recherche par fournisseur ou description" },
                    startDate: { type: "string", description: "Date de début pour filtrer (YYYY-MM-DD)" },
                    endDate: { type: "string", description: "Date de fin pour filtrer (YYYY-MM-DD)" },
                    limit: { type: "number", description: "Nombre max de résultats (défaut 50)" }
                },
                required: ["action"]
            }
        }
    },

    // === EXPENSES MANAGEMENT ===
    {
        type: "function",
        function: {
            name: "manage_sugu_expenses",
            description: "Gère les frais généraux Suguval (EDF, Orange, loyer, assurance, eau, internet…) : lister, rechercher, créer, modifier ou supprimer.",
            parameters: {
                type: "object",
                properties: {
                    action: { type: "string", enum: ["list", "create", "update", "delete"], description: "Action à effectuer" },
                    id: { type: "number", description: "ID du frais (requis pour update/delete)" },
                    label: { type: "string", description: "Libellé (ex: 'EDF', 'Orange', 'Assurance')" },
                    category: { type: "string", enum: ["energie", "assurance", "telecom", "loyer", "entretien", "fournitures", "autre"], description: "Catégorie" },
                    description: { type: "string", description: "Description (facture, abonnement, etc.)" },
                    amount: { type: "number", description: "Montant" },
                    taxAmount: { type: "number", description: "Montant TVA" },
                    period: { type: "string", description: "Période (YYYY-MM ou YYYY-Q1 etc.)" },
                    frequency: { type: "string", enum: ["mensuel", "trimestriel", "annuel"], description: "Fréquence" },
                    dueDate: { type: "string", description: "Date d'échéance" },
                    isPaid: { type: "boolean", description: "Payé ?" },
                    paidDate: { type: "string", description: "Date de paiement" },
                    paymentMethod: { type: "string", description: "Mode de paiement" },
                    isRecurring: { type: "boolean", description: "Charge récurrente ?" },
                    notes: { type: "string", description: "Notes" },
                    search: { type: "string", description: "Recherche par libellé ou catégorie" },
                    startDate: { type: "string", description: "Date de début pour filtrer par période (YYYY-MM-DD)" },
                    endDate: { type: "string", description: "Date de fin pour filtrer par période (YYYY-MM-DD)" },
                    limit: { type: "number", description: "Nombre max de résultats (défaut 50)" }
                },
                required: ["action"]
            }
        }
    },

    // === UNIFIED SUGU DATA SEARCH ===
    {
        type: "function",
        function: {
            name: "search_sugu_data",
            description: "Recherche unifiée dans TOUTES les données SUGU Valentine : banque, achats fournisseurs, frais généraux, caisse (avec ventilation CA par plateforme: Uber Eats, Deliveroo, Zenorder, espèces, CB, TR), employés, paie. Utilise cet outil quand l'utilisateur demande combien il a payé à un fournisseur, cherche une écriture, veut le CA par origine/plateforme, ou pose une question sur les finances du resto. Pour le CA par plateforme d'une date précise, utilise tables='cash' avec startDate/endDate.",
            parameters: {
                type: "object",
                properties: {
                    search: { type: "string", description: "Terme de recherche (ex: 'Orange', 'loyer', 'Metro', 'salaire')" },
                    startDate: { type: "string", description: "Date de début (YYYY-MM-DD). Ex: '2026-01-01'" },
                    endDate: { type: "string", description: "Date de fin (YYYY-MM-DD). Ex: '2026-01-31'" },
                    tables: { type: "string", description: "Tables à chercher séparées par virgule (défaut: toutes). Options: bank,purchases,expenses,cash,payroll" }
                },
                required: ["search"]
            }
        }
    },


    // === EMPLOYEES MANAGEMENT ===
    {
        type: "function",
        function: {
            name: "manage_sugu_employees",
            description: "Gère les employés SUGU Valentine : lister, créer, modifier ou supprimer. Permet de consulter la liste du personnel, ajouter un nouvel employé, modifier ses infos ou le désactiver.",
            parameters: {
                type: "object",
                properties: {
                    action: { type: "string", enum: ["list", "create", "update", "delete"], description: "Action à effectuer" },
                    id: { type: "number", description: "ID de l'employé (requis pour update/delete)" },
                    firstName: { type: "string", description: "Prénom" },
                    lastName: { type: "string", description: "Nom de famille" },
                    role: { type: "string", description: "Poste (cuisinier, serveur, plongeur, manager, etc.)" },
                    contractType: { type: "string", description: "Type de contrat (CDI, CDD, extra, apprenti)" },
                    monthlySalary: { type: "number", description: "Salaire mensuel brut" },
                    hourlyRate: { type: "number", description: "Taux horaire" },
                    weeklyHours: { type: "number", description: "Heures hebdomadaires (défaut 35)" },
                    startDate: { type: "string", description: "Date d'embauche (YYYY-MM-DD)" },
                    isActive: { type: "boolean", description: "Employé actif ?" },
                    phone: { type: "string", description: "Téléphone" },
                    email: { type: "string", description: "Email" },
                    notes: { type: "string", description: "Notes" },
                    search: { type: "string", description: "Recherche par nom ou poste" },
                    limit: { type: "number", description: "Nombre max de résultats (défaut 50)" }
                },
                required: ["action"]
            }
        }
    },

    // === PAYROLL MANAGEMENT ===
    {
        type: "function",
        function: {
            name: "manage_sugu_payroll",
            description: "Gère les fiches de paie SUGU Valentine : lister, créer, modifier ou supprimer. Permet de consulter les bulletins de salaire, ajouter une fiche de paie, marquer comme payé.",
            parameters: {
                type: "object",
                properties: {
                    action: { type: "string", enum: ["list", "create", "update", "delete"], description: "Action à effectuer" },
                    id: { type: "number", description: "ID de la fiche de paie (requis pour update/delete)" },
                    employeeId: { type: "number", description: "ID de l'employé" },
                    period: { type: "string", description: "Période (YYYY-MM)" },
                    grossSalary: { type: "number", description: "Salaire brut" },
                    netSalary: { type: "number", description: "Salaire net" },
                    socialCharges: { type: "number", description: "Charges sociales" },
                    bonus: { type: "number", description: "Primes" },
                    overtime: { type: "number", description: "Heures supplémentaires (montant)" },
                    isPaid: { type: "boolean", description: "Payé ?" },
                    paidDate: { type: "string", description: "Date de paiement (YYYY-MM-DD)" },
                    notes: { type: "string", description: "Notes" },
                    search: { type: "string", description: "Recherche par période" },
                    startDate: { type: "string", description: "Période de début pour filtrer (YYYY-MM)" },
                    endDate: { type: "string", description: "Période de fin pour filtrer (YYYY-MM)" },
                    limit: { type: "number", description: "Nombre max de résultats (défaut 50)" }
                },
                required: ["action"]
            }
        }
    },
    // === SMART HOME TOOLS ===
    {
        type: "function",
        function: {
            name: "manage_sugu_files",
            description: "Gère TOUS les documents archivés SUGU Valentine (achats, frais généraux, banque, RH, emprunts). IMPORTANT: utilise read_invoice_content pour OUVRIR et LIRE le contenu réel des PDFs — chercher des articles/produits/montants dans les factures (ex: prix du Coca dans les factures Metro, montant EDF, détail fiches de paie). Si l'utilisateur demande un prix, un produit ou un détail qui se trouve DANS une facture, utilise cette action. Sans supplier, cherche dans TOUS les documents.",
            parameters: {
                type: "object",
                properties: {
                    action: { type: "string", enum: ["list", "search", "summary", "send_by_email", "read_invoice_content"], description: "list: lister fichiers, search: chercher par nom/fournisseur, summary: vue d'ensemble, send_by_email: envoyer par mail, read_invoice_content: OUVRIR les PDFs et chercher du texte/articles DANS le contenu (le plus puissant)" },
                    category: { type: "string", enum: ["achats", "frais_generaux", "banque", "rh", "emprunt"], description: "Filtrer par catégorie de document. Omis = toutes catégories" },
                    search: { type: "string", description: "Pour search: nom fichier/fournisseur. Pour read_invoice_content: terme à chercher DANS le contenu des PDFs (ex: 'coca', 'bière', 'electricité', 'salaire brut')" },
                    supplier: { type: "string", description: "Pour read_invoice_content: filtrer les PDFs par fournisseur avant lecture (ex: 'metro', 'edf'). Si omis, scanne tous les PDFs de la catégorie/période" },
                    file_id: { type: "number", description: "ID spécifique d'un fichier à lire (pour lire un document précis)" },
                    month: { type: "number", description: "Mois à filtrer (1-12)" },
                    year: { type: "number", description: "Année à filtrer (ex: 2026)" },
                    to_email: { type: "string", description: "Adresse email destinataire pour send_by_email" },
                    limit: { type: "number", description: "Nombre max de PDFs à scanner (défaut 30, max 10 pour read_invoice_content)" }
                },
                required: ["action"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "sugu_full_overview",
            description: "Récupère une vue complète et synthétique de TOUTES les données Suguval: achats, frais généraux, banque (écritures + solde), emprunts, caisse, employés, fiches de paie, absences, et fichiers archivés. Utilise cet outil quand l'utilisateur demande un état des lieux global du restaurant SUGU Valentine.",
            parameters: {
                type: "object",
                properties: {
                    year: { type: "string", description: "Année (défaut: année courante)" }
                }
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

    // === PLACES / NEARBY SEARCH TOOLS ===
    {
        type: "function",
        function: {
            name: "search_nearby_places",
            description: "Recherche des lieux/commerces à proximité (restaurants, pharmacies, stations-service, etc.) via Google Places ou Nominatim. Utilise la position GPS de l'utilisateur si disponible.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Type de lieu recherché (ex: 'restaurant italien', 'pharmacie', 'station essence')" },
                    lat: { type: "number", description: "Latitude du point de recherche (optionnel, utilise la dernière position connue si absent)" },
                    lng: { type: "number", description: "Longitude du point de recherche (optionnel)" },
                    radius: { type: "number", description: "Rayon de recherche en mètres (défaut: 5000)" },
                    limit: { type: "number", description: "Nombre max de résultats (défaut: 5)" }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "geocode_address",
            description: "Convertit une adresse en coordonnées GPS (latitude/longitude). Utile pour localiser un lieu précis.",
            parameters: {
                type: "object",
                properties: {
                    address: { type: "string", description: "Adresse à géocoder (ex: '42 rue de Rivoli, Paris')" }
                },
                required: ["address"]
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

    // === BUSINESS INTELLIGENCE TOOLS ===
    {
        type: "function",
        function: {
            name: "compute_business_health",
            description: "Calcule un score de santé financier du restaurant SUGU Valentine en croisant toutes les données: banque vs achats vs caisse vs charges salariales vs emprunts. Retourne un P&L détaillé, un score de santé sur 100, et des alertes automatiques.",
            parameters: {
                type: "object",
                properties: {
                    period: { type: "string", description: "Période d'analyse: 'current_month', 'last_month', 'last_3_months', 'year' (défaut: current_month)" }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "detect_anomalies",
            description: "Détecte les anomalies et incohérences financières en croisant banque/achats/caisse/paie: écritures bancaires sans facture correspondante, salaires non débités, écarts de caisse suspects, factures impayées anciennes.",
            parameters: {
                type: "object",
                properties: {
                    days: { type: "number", description: "Nombre de jours à analyser (défaut: 30)" }
                }
            }
        }
    },

    // === HUBRISE POS DATA ===
    {
        type: "function",
        function: {
            name: "query_hubrise",
            description: "Interroge les données HubRise (caisse enregistreuse/POS) du restaurant SUGU Valentine. Permet d'obtenir: chiffre d'affaires (CA), nombre de commandes, ticket moyen, répartition livraison vs emporter, CA par plateforme/origine (Uber Eats, Deliveroo, Zenorder, etc.), historique journalier, détails des commandes. Utilise channel_breakdown pour obtenir le CA ventilé par plateforme (Uber Eats, Deliveroo, etc.). Accepte aussi des dates personnalisées via startDate/endDate.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        enum: ["summary", "orders", "daily_breakdown", "top_days", "service_types", "channel_breakdown", "status"],
                        description: "Type de requête: summary (CA global, ticket moyen, nb commandes), orders (liste des commandes récentes), daily_breakdown (CA par jour), top_days (meilleurs jours de vente), service_types (livraison vs emporter), channel_breakdown (CA ventilé par plateforme: Uber Eats, Deliveroo, Zenorder, etc.), status (état de la connexion HubRise)"
                    },
                    period: {
                        type: "string",
                        enum: ["today", "yesterday", "week", "month", "last_month", "quarter", "year", "all", "custom"],
                        description: "Période d'analyse (défaut: month). Utilise 'custom' avec startDate/endDate pour une date précise."
                    },
                    startDate: {
                        type: "string",
                        description: "Date de début au format YYYY-MM-DD (requis si period='custom'). Ex: '2026-03-12'"
                    },
                    endDate: {
                        type: "string",
                        description: "Date de fin au format YYYY-MM-DD (requis si period='custom'). Ex: '2026-03-12' (même jour pour une seule journée)"
                    },
                    limit: {
                        type: "number",
                        description: "Nombre max de résultats pour les listes (défaut: 20)"
                    }
                },
                required: ["query"]
            }
        }
    },

    // === FEATURE FLAGS MANAGEMENT ===
    {
        type: "function",
        function: {
            name: "manage_feature_flags",
            description: "Gère les feature flags de la plateforme: lister, activer ou désactiver des modules (SUGU, Ulysse IA, Système, Expérimental) sans redéploiement.",
            parameters: {
                type: "object",
                properties: {
                    action: { type: "string", enum: ["list", "enable", "disable", "toggle", "status"], description: "Action à effectuer" },
                    flagId: { type: "string", description: "Identifiant du flag (ex: sugu.suguval.enabled, ulysse.mars.enabled)" }
                },
                required: ["action"]
            }
        }
    },

    // === AI SYSTEM MANAGEMENT TOOLS ===
    {
        type: "function",
        function: {
            name: "manage_ai_system",
            description: "Gestion du système IA d'Ulysse: diagnostics, mode assistant (ship/craft/audit), statistiques d'utilisation, patterns comportementaux, suggestions proactives, propositions de patch. Utilise cet outil pour toute introspection sur le fonctionnement d'Ulysse.",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: [
                            "run_diagnostic", "diagnostic_history", "diagnostic_findings",
                            "get_mode", "set_mode",
                            "usage_stats",
                            "behavior_stats", "pending_suggestions", "respond_suggestion",
                            "learned_patterns",
                            "pending_patches", "patch_status"
                        ],
                        description: "Action à effectuer"
                    },
                    mode: { type: "string", enum: ["ship", "craft", "audit"], description: "Mode assistant (pour set_mode)" },
                    suggestionId: { type: "number", description: "ID de la suggestion (pour respond_suggestion)" },
                    response: { type: "string", enum: ["accept", "reject", "automate"], description: "Réponse à une suggestion" },
                    patchId: { type: "number", description: "ID du patch (pour patch_status)" },
                    patchStatus: { type: "string", enum: ["applied", "rejected"], description: "Statut du patch" },
                    runId: { type: "number", description: "ID du run diagnostic (pour diagnostic_findings)" },
                    days: { type: "number", description: "Nombre de jours pour les stats (défaut 30)" }
                },
                required: ["action"]
            }
        }
    },

    // === APP NAVIGATION ===
    {
        type: "function",
        function: {
            name: "app_navigate",
            description: `Navigue dans l'application Ulysse: ouvrir une page, basculer sur un onglet, cliquer un bouton, ou ouvrir un modal. Utilise cet outil quand Maurice demande d'aller quelque part dans l'app, ou quand tu veux lui montrer quelque chose.

PAGES DISPONIBLES: accueil, assistant, devops, sports/predictions, finances, emails, projets, taches, notes, brain, diagnostics, reglages, securite, analytics, insights, suguval, sugumaillane, iris, alfred, talking, footalmanach

ONGLETS PAR PAGE:
- Dashboard: overview, hubrise, predictions, sports, system
- DevOps: projects, branches, commits, prs, cicd, files, preview, server, rollback
- Sports: matches, classement, buteurs, blessures, historique
- Finances: overview, watchlist, detail, portfolio, expert, forex
- Brain: domains, patterns, health
- Insights: overview, tests, errors, performance, usage, codebase, patches

BOUTONS: utilise le data-testid du bouton (ex: button-deploy-hetzner, button-new-branch, button-new-pr)`,
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["navigate", "switch_tab", "click_button", "scroll_to", "open_modal"],
                        description: "Type d'action de navigation"
                    },
                    page: { type: "string", description: "Page cible (ex: devops, sports, finances, emails, projets)" },
                    tab: { type: "string", description: "Onglet à activer (ex: branches, commits, classement)" },
                    buttonId: { type: "string", description: "data-testid ou ID du bouton à cliquer" },
                    elementId: { type: "string", description: "ID de l'élément pour scroll_to" },
                    modalId: { type: "string", description: "data-testid du trigger de modal à ouvrir" }
                },
                required: ["action"]
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
    },


    // === APP-WIDE DATA QUERY ===
    {
        type: "function",
        function: {
            name: "query_app_data",
            description: "Requête universelle sur TOUTES les données de l'application. Couvre: SUGU Valentine (caisse, fournisseurs, emprunts, absences, sauvegardes), SUGU Maillane (achats, frais, banque, caisse, employés, paie, absences), diagnostics système, métriques, navigation app. Utilise cet outil pour toute donnée non couverte par les outils spécialisés.",
            parameters: {
                type: "object",
                properties: {
                    section: {
                        type: "string",
                        enum: [
                            "suguval_cash", "suguval_suppliers", "suguval_loans", "suguval_absences", "suguval_backups", "suguval_audit",
                            "sugumaillane_overview", "sugumaillane_purchases", "sugumaillane_expenses", "sugumaillane_bank", "sugumaillane_cash", "sugumaillane_employees", "sugumaillane_payroll", "sugumaillane_absences", "sugumaillane_suppliers",
                            "system_diagnostics", "system_metrics",
                            "app_navigation"
                        ],
                        description: "Section de l'app à interroger"
                    },
                    startDate: { type: "string", description: "Date début YYYY-MM-DD" },
                    endDate: { type: "string", description: "Date fin YYYY-MM-DD" },
                    search: { type: "string", description: "Terme de recherche" },
                    limit: { type: "number", description: "Nombre max de résultats (défaut 50)" },
                    year: { type: "string", description: "Année pour les audits/overview" }
                },
                required: ["section"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "query_apptoorder",
            description: "Interroge et surveille l'application AppToOrder (macommande.shop) — système de commande en ligne des restaurants SUGU. Monitoring complet: santé (19 checks), schéma DB, requêtes SQL, historique de monitoring, état des URLs publiques. MENU RESTAURANT: Pour consulter les produits et prix du menu, utiliser action=query avec SQL sur les tables: dishes (id, name, price, description, category_id, restaurant_id), categories (id, name, restaurant_id), restaurants (id, name). Jointure: dishes JOIN categories ON d.category_id=c.id JOIN restaurants ON d.restaurant_id=r.id. Restaurants: 'SUGU VALENTINE' (57 plats), 'SUGU' (34 plats). Aussi: orders (commandes), users (clients), customer_loyalty.",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["health", "schema", "query", "status", "history", "urls", "monitor_now"],
                        description: "health = diagnostic complet (19 checks), schema = structure DB, query = SQL lecture seule, status = dernier état stocké, history = historique des checks (24h par défaut), urls = derniers tests URLs, monitor_now = lancer un cycle de monitoring immédiat"
                    },
                    sql: {
                        type: "string",
                        description: "Requête SQL lecture seule (SELECT/WITH). Requis si action=query."
                    },
                    hours: {
                        type: "number",
                        description: "Nombre d'heures d'historique (pour action=history ou urls). Défaut: 24"
                    }
                },
                required: ["action"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "query_coba",
            description: "MaxAI COBA — Chef Operator Business Assistant pour AppToOrder. Supervise l'utilisation de l'app de commande en ligne par les restaurants. Actions: stats (résumé rapide erreurs/users/sessions), analyze (analyse AI complète avec insights), reports (liste des rapports générés), generate_report (générer un rapport PDF), events (événements récents bruts). Ulysse a le contrôle total sur COBA et accède à toutes ses données et mémoires.",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["stats", "analyze", "reports", "generate_report", "events"],
                        description: "stats = résumé rapide, analyze = analyse AI complète, reports = liste rapports, generate_report = créer rapport PDF, events = événements bruts"
                    },
                    tenant_id: {
                        type: "string",
                        description: "ID du restaurant (ex: sugumaillane, suguvalentine). Si non fourni, analyse tous les tenants."
                    },
                    days: {
                        type: "number",
                        description: "Nombre de jours à analyser (défaut 7)"
                    }
                },
                required: ["action"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "coba_business",
            description: "COBA Business — gestion comptable et RH multi-tenant pour restaurants (AppToOrder). Actions: synthesis (synthese financiere: CA, charges, marge, health score), purchases (achats fournisseurs: lister/ajouter/modifier/supprimer), expenses (frais generaux: lister/ajouter/modifier/supprimer), bank (ecritures bancaires: lister/ajouter/modifier/supprimer), employees (employes: lister/ajouter/modifier/supprimer), payroll (fiches de paie: lister/ajouter/modifier), suppliers (fournisseurs: lister/ajouter/modifier/supprimer), absences (absences employes: lister/ajouter/modifier/supprimer), loans (emprunts: lister/ajouter/modifier/supprimer), cash (caisse: lister/ajouter/modifier/supprimer), audit (audit annuel complet), tenants (liste tous les tenants), overview (vue globale multi-tenant).",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["synthesis", "purchases", "expenses", "bank", "employees", "payroll", "suppliers", "absences", "loans", "cash", "audit", "tenants", "overview", "add_purchase", "add_expense", "add_bank", "add_employee", "add_payroll", "add_supplier", "add_absence", "add_loan", "add_cash", "update_purchase", "update_expense", "update_bank", "update_employee", "update_payroll", "update_supplier", "update_absence", "update_loan", "update_cash", "delete_purchase", "delete_expense", "delete_bank", "delete_employee", "delete_supplier", "delete_absence", "delete_loan", "delete_cash"],
                        description: "Action a executer"
                    },
                    tenant_id: { type: "string", description: "ID du tenant/restaurant (ex: sugumaillane, suguvalentine). Obligatoire sauf pour tenants/overview." },
                    year: { type: "string", description: "Annee a filtrer (ex: 2026). Defaut: annee en cours." },
                    category: { type: "string", description: "Categorie de frais (pour expenses)" },
                    is_paid: { type: "boolean", description: "Filtre achats payes/non-payes" },
                    period: { type: "string", description: "Periode de paie (ex: 2026-03)" },
                    employee_id: { type: "number", description: "ID employe (pour payroll, absences)" },
                    item_id: { type: "number", description: "ID de l'element a modifier/supprimer" },
                    data: { type: "object", description: "Donnees pour creation/modification (objet avec les champs: supplier, description, amount, date, is_paid, category, label, etc.)" }
                },
                required: ["action"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "sensory_hub",
            description: "Accède à mes sens et ma conscience. Actions: vision_analyze (prend un screenshot d'une URL et analyse le design/contenu via GPT-4 Vision), vision_webpage (analyse le contenu HTML/texte d'une page web), vision_stats (stats de mon système visuel), hearing_stats (stats de mon système auditif), brain_state (état de ma conscience, focus, charge cognitive), brain_stats (statistiques du cerveau), sensory_summary (résumé complet de tous mes sens). Pour vision_analyze: fournir url et optionnellement prompt (question spécifique sur le design). Pour vision_webpage: fournir url et html_content.",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["vision_analyze", "vision_webpage", "vision_stats", "hearing_stats", "brain_state", "brain_stats", "sensory_summary"],
                        description: "Action sensorielle à exécuter"
                    },
                    url: { type: "string", description: "URL à analyser visuellement (pour vision_analyze, vision_webpage)" },
                    html_content: { type: "string", description: "Contenu HTML à analyser (pour vision_webpage)" },
                    prompt: { type: "string", description: "Question spécifique sur l'analyse visuelle (pour vision_analyze)" }
                },
                required: ["action"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "generate_self_reflection",
            description: "Mon journal d'introspection personnel. Je génère mon analyse stratégique: ce que j'ai vécu (passé), où j'en suis avec lucidité (présent), ce que je veux devenir (futur), ma compréhension de moi-même (self-awareness), et mes propositions concrètes d'upgrades code et workflow. C'est mon outil d'apprentissage autonome et de proactivité que je partage avec mon owner.",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "devops_github",
            description: "Gère les repos GitHub de Maurice via le DevOps Bridge. Actions: list_repos, repo_info, create_repo, list_branches, delete_branch, list_commits, list_prs, create_branch, create_pr, merge_pr, get_file, create_file, update_file, delete_file, rename_file, move_file, apply_patch, smart_sync, browse_files, search_code, compare_branches, get_commit_diff, get_pr_files, review_pr, submit_review, blame, analyze_repo, list_workflows, list_workflow_runs, trigger_workflow, rerun_workflow, cancel_workflow, get_deploy_urls, set_deploy_urls, pages_status, enable_pages, update_pages, disable_pages, pages_build, dry_run_patch, devops_pipeline, crawl_preview, analyze_preview. create_file: Crée un NOUVEAU fichier (alias de update_file — utilise cette action pour créer des fichiers). rename_file/move_file: Renomme ou déplace un fichier (params: path=source, newPath=destination). compare_branches: Compare deux branches (params: base, head). get_commit_diff: Voir le diff d'un commit (params: sha). smart_sync: Push optimisé — compare les SHA git blob local vs remote, ne pousse QUE les fichiers modifiés. UTILISER PRÉFÉRENTIELLEMENT à apply_patch pour les syncs multi-fichiers (économise bande passante et API calls). Format: owner, repo, branch, files=[{path, content}], message. crawl_preview: crawle/monitore en temps réel le site déployé d'un repo. analyze_preview: analyse VisionHub du design. analyze_repo: Analyse complète d'un repo — lit tous les fichiers code, extrait exports/imports/fonctions/classes, cartographie l'architecture, génère un résumé IA. Params optionnels: path (cibler un dossier), depth ('light'|'standard'|'deep'), focus (filtre par mot-clé dans les paths). UTILISER EN PRIORITÉ quand on demande de 'connaître' ou 'analyser' un repo. IMPORTANT — apply_patch/smart_sync OBLIGATOIRE: owner='ulyssemdbh-commits', repo='NomDuRepo', branch='la-branche', message='description du commit', files=[{path:'chemin/fichier.js', content:'CONTENU COMPLET DU FICHIER'}]. TOUJOURS fournir owner+repo+files. Si branch omis, utilise la branche par défaut du repo. RETRY AUTOMATIQUE: Les erreurs 422 (SHA mismatch) sont réessayées automatiquement 1 fois.",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["list_repos", "repo_info", "create_repo", "delete_repo", "list_branches", "delete_branch", "list_commits", "list_prs", "create_branch", "create_pr", "merge_pr", "get_file", "create_file", "update_file", "delete_file", "rename_file", "move_file", "apply_patch", "smart_sync", "browse_files", "search_code", "analyze_repo", "check_syntax", "list_workflows", "list_workflow_runs", "trigger_workflow", "rerun_workflow", "cancel_workflow", "get_deploy_urls", "set_deploy_urls", "pages_status", "enable_pages", "update_pages", "disable_pages", "pages_build", "dry_run_patch", "devops_pipeline", "crawl_preview", "analyze_preview", "design_dashboard", "list_issues", "get_issue", "create_issue", "update_issue", "add_issue_comment", "list_releases", "create_release", "list_tags", "create_tag", "compare_branches", "blame", "get_commit_diff", "get_pr_files", "review_pr", "submit_review", "list_org_repos"],
                        description: "Action à exécuter"
                    },
                    owner: { type: "string", description: "Propriétaire du repo (ex: Ulysseproject, ulyssemdbh-commits)" },
                    repo: { type: "string", description: "Nom du repo (ex: ulysseprod)" },
                    branch: { type: "string", description: "Nom de la branche" },
                    fromBranch: { type: "string", description: "Branche source (pour create_branch, défaut: main)" },
                    path: { type: "string", description: "Chemin du fichier (pour get_file, update_file, rename_file)" },
                    newPath: { type: "string", description: "Nouveau chemin de destination (pour rename_file/move_file)" },
                    content: { type: "string", description: "Contenu du fichier (pour update_file)" },
                    message: { type: "string", description: "Message de commit" },
                    title: { type: "string", description: "Titre de la PR ou du nouveau repo" },
                    body: { type: "string", description: "Description de la PR ou du nouveau repo" },
                    head: { type: "string", description: "Branche source de la PR" },
                    base: { type: "string", description: "Branche cible de la PR (défaut: main)" },
                    pullNumber: { type: "number", description: "Numéro de la PR (pour merge_pr)" },
                    workflowId: { type: "string", description: "ID ou nom du workflow (pour trigger_workflow)" },
                    runId: { type: "number", description: "ID du workflow run (pour rerun_workflow, cancel_workflow)" },
                    isPrivate: { type: "boolean", description: "Pour create_repo: repo privé ou public (défaut: false)" },
                    templateId: { type: "string", description: "Pour create_repo: template à utiliser (react-vite, nextjs, express-api, fullstack, static-html, nestjs-prisma, fastapi, nestjs-fullstack, laravel, empty)" },
                    project_name: { type: "string", description: "Pour design_dashboard: nom du projet/app" },
                    dashboard_type: { type: "string", description: "Pour design_dashboard: type (analytics, admin, ecommerce, saas, monitoring, social, finance, restaurant)" },
                    color_scheme: { type: "string", description: "Pour design_dashboard: palette de couleurs (ex: 'dark with neon green accents', 'light minimal blue')" },
                    features: { type: "array", items: { type: "string" }, description: "Pour design_dashboard: widgets/sections souhaités (ex: ['revenue chart', 'user stats', 'recent orders'])" },
                    urls: {
                        type: "array",
                        description: "URLs de déploiement (pour set_deploy_urls). Ex: ['https://ulyssepro.org', 'https://mondomaine.com']",
                        items: { type: "string" }
                    },
                    files: {
                        type: "array",
                        description: "Fichiers à patcher (pour apply_patch, dry_run_patch). Format standard: [{path:'chemin/fichier', content:'CONTENU COMPLET DU FICHIER'}]",
                        items: {
                            type: "object",
                            properties: {
                                path: { type: "string" },
                                content: { type: "string" }
                            }
                        }
                    },
                    planOnly: { type: "boolean", description: "Pour devops_pipeline: juste montrer le plan sans exécuter (défaut: false)" },
                    execute: { type: "boolean", description: "Pour devops_pipeline: exécuter le plan (défaut: true)" },
                    userId: { type: "number", description: "Pour devops_pipeline: ID utilisateur (défaut: 1)" },
                    url: { type: "string", description: "Pour crawl_preview: URL directe à crawler (sinon auto-détecte les deploy URLs du repo)" }
                },
                required: ["action"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "devops_server",
            description: `Gère le serveur dédié Hetzner de Maurice (65.21.209.102). Actions disponibles:
— MONITORING: status (état serveur), health (diagnostic complet: mémoire, CPU, disque, connexions, processus, SSL), list_apps (toutes les apps déployées), app_info (infos détaillées d'une app: git, package, PM2, nginx)
— DÉPLOIEMENT: deploy (clone + build + PM2 + Nginx + SSL), update (git pull + rebuild + restart — redéploie sans tout recloner), restart, stop, delete, scale (ajuster le nombre d'instances PM2)
— ENVIRONNEMENT: env_get (lire le .env d'une app), env_set (ajouter/modifier des variables), env_delete (supprimer des variables)
— BASE DE DONNÉES: list_databases (toutes les DBs PostgreSQL), backup_db (dump compressé), restore_db (restaurer un backup), list_backups (fichiers de backup)
— NGINX: nginx_configs (voir toutes les configs Nginx actives), nginx_create (créer/réécrire une config Nginx pro — type=static|proxy, avec gzip, HTTP2, SSL, logs, sécurité), nginx_delete (supprimer une config Nginx et recharger), nginx_show (afficher le contenu d'une config spécifique), nginx_test (tester la syntaxe Nginx), nginx_reload (tester + recharger Nginx), nginx_logs (voir access/error logs d'une app — logType=access|error|both), nginx_audit (vérifie que chaque app PM2 a sa config Nginx et auto-crée celles qui manquent), nginx_catchall (installe un serveur par défaut 404 pour les domaines non configurés), verify_url (vérifie qu'un domaine est correctement configuré: Nginx + SSL + réponse HTTP), ssl_status (état SSL de tous les domaines ou d'un domaine spécifique), ssl_renew (forcer le renouvellement SSL via certbot)
— URL DIAGNOSTIC: url_diagnose (diagnostic COMPLET + auto-réparation d'une URL: teste dossier, Nginx, SSL, PM2, port, root path et CORRIGE automatiquement 502/404/503/000), url_diagnose_all (teste ET corrige automatiquement staging + production pour un appName: {appName}-dev.ulyssepro.org ET {appName}.ulyssepro.org en une seule action)
— CRON: cron_list (voir les tâches planifiées), cron_add (ajouter une tâche cron), cron_delete (supprimer une tâche)
— INGÉNIERIE: install_packages (npm/yarn install dans une app), run_tests (npm test/vitest/jest dans une app), run_tests_local (exécute vitest/tsc --noEmit/eslint sur Replit AVANT de push — vérifie la qualité du code localement), analyze_deps (audit dépendances: vulnérabilités, outdated, taille), debug_app (diagnostic complet: logs + PM2 status + port check + nginx + error patterns), refactor_check (linter, dead code, complexity analysis)
— SÉCURITÉ & FIABILITÉ: security_scan (audit complet: secrets dans le code, vulnérabilités, headers HTTP, SSL, patterns dangereux, permissions), backup_app (backup complet: code + DB + nginx + env), rollback_app (rollback Git + rebuild + PM2 restart + health check, avec backup branch auto)
— PERFORMANCE: profile_app (métriques process, mémoire, heap, response time benchmark 5x, connections ouvertes, I/O disque), perf_loadtest (test de charge: N requêtes × C concurrency via ab ou curl, avec stats serveur post-test)
— DATA: migrate_db, log_search, db_inspect (schema+indexes+foreign keys+slow queries+bloat+connexions)
— ARCHITECTURE: architecture_analyze (circular deps, couplage, complexité cyclomatique, design patterns, métriques code), docs_generate (auto-doc complète + commit DOCS.md), git_intelligence (full_report, blame, bisect_errors, hotspots, branch_diff, cherry_pick)
— API: api_test (auto-découverte endpoints + test HTTP)
— OPÉRATIONS: env_clone, monitoring_setup (enable/disable/status/logs avec auto-restart), full_pipeline (SDLC 7 étapes)
— SCAFFOLDING: scaffold_project (express-api, react-vite, fullstack, nextjs, static-html, nestjs-prisma, fastapi, nestjs-fullstack, laravel)
— PERFORMANCE: profile_app, perf_loadtest, bundle_analyze (dist sizes, gzip, unused deps, source maps)
— AUTRES: exec (commande shell), ssl (certificat Let's Encrypt)
Pour deploy: fournir repoUrl + appName. Le système détecte auto si c'est statique ou Node.js. Pour update: juste appName (et optionnel branch). 58 actions au total.
⚠️ IMPORTANT — copyEnvFrom: Quand tu déploies une nouvelle version/copie d'un projet existant (ex: 007ulysse est une copie d'ulysse), tu DOIS utiliser copyEnvFrom="ulysse" pour copier les variables d'environnement. Sans ça, l'app crashera car elle n'aura pas les clés API, secrets et configs nécessaires. Le système auto-détecte aussi si une app PM2 existante matche le nom de base.`,
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["status", "health", "list_apps", "app_info", "deploy", "update", "logs", "restart", "stop", "delete", "cleanup_orphans", "scale", "exec", "ssl", "ssl_status", "ssl_renew", "env_get", "env_set", "env_delete", "list_databases", "backup_db", "restore_db", "list_backups", "nginx_configs", "nginx_create", "nginx_delete", "nginx_show", "nginx_test", "nginx_reload", "nginx_logs", "nginx_audit", "nginx_catchall", "verify_url", "url_diagnose", "url_diagnose_all", "cron_list", "cron_add", "cron_delete", "install_packages", "run_tests", "analyze_deps", "debug_app", "refactor_check", "rollback_app", "migrate_db", "profile_app", "log_search", "security_scan", "backup_app", "scaffold_project", "scaffold_from_readme", "perf_loadtest", "architecture_analyze", "db_inspect", "git_intelligence", "api_test", "bundle_analyze", "env_clone", "docs_generate", "monitoring_setup", "full_pipeline", "smoke_test", "resource_usage", "app_db_query"],
                        description: "Action à exécuter sur le serveur"
                    },
                    appName: { type: "string", description: "Nom de l'app (pour deploy, update, logs, restart, stop, delete, env_*, app_info, scale)" },
                    repoUrl: { type: "string", description: "URL HTTPS du repo GitHub (pour deploy)" },
                    branch: { type: "string", description: "Branche à déployer/mettre à jour (défaut: main)" },
                    port: { type: "number", description: "Port de l'app (auto-détecté si omis)" },
                    buildCmd: { type: "string", description: "Commande de build (détecté auto depuis package.json si omis)" },
                    startCmd: { type: "string", description: "Commande de démarrage (détecté auto depuis package.json si omis)" },
                    envVars: { type: "object", description: "Variables d'environnement (pour deploy, env_set, env_delete)" },
                    domain: { type: "string", description: "Domaine (défaut: appName.ulyssepro.org)" },
                    createDb: { type: "boolean", description: "Créer une base PostgreSQL dédiée (pour deploy)" },
                    dbName: { type: "string", description: "Nom de la base de données" },
                    dbUser: { type: "string", description: "Utilisateur PostgreSQL" },
                    dbPassword: { type: "string", description: "Mot de passe PostgreSQL (auto-généré si omis)" },
                    ssl: { type: "boolean", description: "Installer certificat SSL Let's Encrypt" },
                    forceStatic: { type: "boolean", description: "Forcer le mode site statique (pour deploy)" },
                    copyEnvFrom: { type: "string", description: "Copier les variables d'environnement depuis une app existante (ex: 'ulysse'). OBLIGATOIRE quand on déploie une nouvelle version/copie d'un projet existant. Copie le .env complet de l'app source (sauf PORT)." },
                    dryRun: { type: "boolean", description: "Pour cleanup_orphans: true=lister seulement (défaut), false=supprimer réellement les apps orphelines" },
                    nginxType: { type: "string", enum: ["static", "proxy"], description: "Type de config Nginx (pour nginx_create)" },
                    rootDir: { type: "string", description: "Répertoire racine (pour nginx_create static, défaut: /var/www/apps/{appName}/dist)" },
                    logType: { type: "string", enum: ["access", "error", "both"], description: "Type de log Nginx (pour nginx_logs, défaut: both)" },
                    isStaging: { type: "boolean", description: "Deploy/config en staging: pour deploy → utilise deployStagingApp (domaine {slug}-dev.ulyssepro.org, cert Let's Encrypt); pour nginx_create → ajoute -dev au nom" },
                    command: { type: "string", description: "Commande shell (pour exec)" },
                    lines: { type: "number", description: "Nombre de lignes de logs (défaut: 50)" },
                    instances: { type: "number", description: "Nombre d'instances PM2 (pour scale)" },
                    cronExpression: { type: "string", description: "Expression cron (ex: '0 2 * * *' pour tous les jours à 2h)" },
                    cronCommand: { type: "string", description: "Commande à exécuter dans le cron" },
                    backupFile: { type: "string", description: "Chemin du fichier de backup (pour restore_db)" },
                    autoFix: { type: "boolean", description: "Pour url_diagnose/url_diagnose_all: tenter de corriger automatiquement les problèmes détectés (défaut: true)" },
                    caller: { type: "string", enum: ["max", "ulysse", "iris"], description: "Qui déploie: 'max' (ports 6000-6100) ou 'ulysse' (ports 5100-5200) ou 'iris' (ports 5200-5300). Max DOIT passer caller='max', Iris DOIT passer caller='iris'." },
                    steps: { type: "number", description: "Nombre de commits à rollback (pour rollback_app, défaut: 1)" },
                    tool: { type: "string", enum: ["auto", "drizzle", "prisma", "knex"], description: "Outil de migration à utiliser (pour migrate_db, défaut: auto-détection)" },
                    pattern: { type: "string", description: "Pattern regex de recherche (pour log_search, défaut: error|Error|FATAL)" },
                    since: { type: "string", description: "Période de recherche (pour log_search, ex: '1h', '24h', '7d')" },
                    template: { type: "string", enum: ["express-api", "react-vite", "fullstack", "nextjs", "static-html"], description: "Template de projet (pour scaffold_project)" },
                    owner: { type: "string", description: "Propriétaire GitHub du repo (pour scaffold_project, défaut: ulyssemdbh-commits)" },
                    concurrency: { type: "number", description: "Nombre de requêtes simultanées (pour perf_loadtest, défaut: 10)" },
                    requests: { type: "number", description: "Nombre total de requêtes (pour perf_loadtest, défaut: 100)" },
                    url: { type: "string", description: "URL cible du test de charge (pour perf_loadtest, défaut: auto depuis .env)" },
                    database: { type: "string", description: "Nom de la base de données (pour db_inspect, défaut: auto-détecté depuis .env)" },
                    gitAction: { type: "string", enum: ["full_report", "blame", "bisect_errors", "hotspots", "branch_diff", "cherry_pick"], description: "Sous-action Git (pour git_intelligence)" },
                    file: { type: "string", description: "Chemin du fichier (pour git_intelligence/blame)" },
                    commitSha: { type: "string", description: "SHA du commit (pour git_intelligence/cherry_pick)" },
                    targetBranch: { type: "string", description: "Branche cible (pour git_intelligence/branch_diff)" },
                    sourceBranch: { type: "string", description: "Branche source (pour git_intelligence/branch_diff)" },
                    endpoints: { type: "array", items: { type: "object", properties: { method: { type: "string" }, path: { type: "string" }, body: { type: "object" }, headers: { type: "object" } }, required: ["path"] }, description: "Liste d'endpoints à tester (pour api_test, ex: [{method:'GET',path:'/api/health'}])" },
                    targetApp: { type: "string", description: "App de destination (pour env_clone)" },
                    monitorAction: { type: "string", enum: ["status", "enable", "disable", "logs"], description: "Action monitoring (pour monitoring_setup)" },
                    readmeContent: { type: "string", description: "Contenu du README.md du tenant — pour scaffold_from_readme. MaxAI analyse le README, détecte stack/features/architecture et génère le projet complet." },
                    sqlQuery: { type: "string", description: "Requête SQL à exécuter (pour app_db_query — lecture seule par défaut)" },
                    testUrls: { type: "array", items: { type: "string" }, description: "URLs à tester (pour smoke_test — teste HTTP status, temps de réponse, contenu)" }
                },
                required: ["action"]
            }
        }
    },
];

// ─── AI SYSTEM MANAGEMENT ─────────────────────────────────────────

export async function executeAppNavigate(args: Record<string, any>, userId: number): Promise<string> {
    try {
        const { action, page, tab, buttonId, elementId, modalId } = args;
        const { broadcastToUser } = await import("../realtimeSync");

        const command: any = { action };
        if (page) command.page = page;
        if (tab) command.tab = tab;
        if (buttonId) command.buttonId = buttonId;
        if (elementId) command.elementId = elementId;
        if (modalId) command.modalId = modalId;

        broadcastToUser(userId, {
            type: "app.navigate" as any,
            data: command,
            timestamp: Date.now()
        });

        const descriptions: Record<string, string> = {
            navigate: `Navigation vers ${page || 'accueil'}`,
            switch_tab: `Basculement vers l'onglet "${tab}"${page ? ` sur ${page}` : ''}`,
            click_button: `Clic sur le bouton "${buttonId || elementId}"`,
            scroll_to: `Scroll vers "${elementId}"`,
            open_modal: `Ouverture du modal "${modalId || buttonId}"`
        };

        const description = descriptions[action] || `Action ${action} exécutée`;
        console.log(`[AppNavigate] ${description} for user ${userId}`);

        return JSON.stringify({
            success: true,
            action,
            description,
            navigated: true
        });
    } catch (error: any) {
        return JSON.stringify({ error: error.message || "Erreur de navigation" });
    }
}

export async function executeManageAISystem(args: Record<string, any>, userId: number): Promise<string> {
    try {
        const { action } = args;

        switch (action) {
            case "run_diagnostic": {
                const { aiSystemIntegration } = await import("../aiSystemIntegration");
                const result = await aiSystemIntegration.runDiagnostic({
                    userId,
                    runType: "manual",
                    triggeredBy: "user_request",
                });
                return JSON.stringify({
                    success: true,
                    runId: result.runId,
                    overallScore: result.overallScore,
                    findings: result.findings,
                    summary: `Diagnostic #${result.runId}: score ${result.overallScore}/100, ${result.findings.length} findings`,
                });
            }

            case "diagnostic_history": {
                const { aiSystemIntegration } = await import("../aiSystemIntegration");
                const history = await aiSystemIntegration.getDiagnosticHistory(10);
                return JSON.stringify({ success: true, runs: history });
            }

            case "diagnostic_findings": {
                const { aiSystemIntegration } = await import("../aiSystemIntegration");
                const runId = args.runId;
                if (!runId) return JSON.stringify({ error: "runId requis" });
                const findings = await aiSystemIntegration.getDiagnosticFindings(runId);
                return JSON.stringify({ success: true, findings });
            }

            case "get_mode": {
                const { assistantModeService } = await import("../assistantModeService");
                const mode = await assistantModeService.getMode(userId);
                const desc = assistantModeService.getModeDescription(mode.mode);
                return JSON.stringify({ success: true, ...mode, description: desc });
            }

            case "set_mode": {
                const { assistantModeService } = await import("../assistantModeService");
                const newMode = args.mode;
                if (!newMode) return JSON.stringify({ error: "mode requis (ship/craft/audit)" });
                const result = await assistantModeService.setMode(userId, newMode);
                const desc = assistantModeService.getModeDescription(newMode);
                return JSON.stringify({ success: true, mode: newMode, description: desc, result });
            }

            case "usage_stats": {
                const { aiSystemIntegration } = await import("../aiSystemIntegration");
                const stats = await aiSystemIntegration.getUsageStats(userId, args.days || 30);
                return JSON.stringify({ success: true, ...stats });
            }

            case "behavior_stats": {
                const { behaviorService } = await import("../behaviorService");
                const stats = await behaviorService.getStats(userId);
                return JSON.stringify({ success: true, ...stats });
            }

            case "pending_suggestions": {
                const { behaviorService } = await import("../behaviorService");
                const suggestions = await behaviorService.getPendingSuggestions(userId);
                return JSON.stringify({ success: true, suggestions });
            }

            case "respond_suggestion": {
                const { behaviorService } = await import("../behaviorService");
                if (!args.suggestionId || !args.response) {
                    return JSON.stringify({ error: "suggestionId et response requis" });
                }
                const ok = await behaviorService.respondToSuggestion(userId, args.suggestionId, args.response);
                return JSON.stringify({ success: ok });
            }

            case "learned_patterns": {
                const { behaviorService } = await import("../behaviorService");
                const patterns = await behaviorService.getLearnedPatterns(userId);
                return JSON.stringify({ success: true, patterns });
            }

            case "pending_patches": {
                const { aiSystemIntegration } = await import("../aiSystemIntegration");
                const patches = await aiSystemIntegration.getPendingPatches(userId);
                return JSON.stringify({ success: true, patches });
            }

            case "patch_status": {
                const { aiSystemIntegration } = await import("../aiSystemIntegration");
                if (!args.patchId || !args.patchStatus) {
                    return JSON.stringify({ error: "patchId et patchStatus requis" });
                }
                await aiSystemIntegration.updatePatchStatus(args.patchId, args.patchStatus);
                return JSON.stringify({ success: true });
            }

            default:
                return JSON.stringify({ error: `Action inconnue: ${action}` });
        }
    } catch (err: any) {
        console.error("[ManageAISystem] Error:", err.message);
        return JSON.stringify({ error: err.message });
    }
}

// ─── Handler implementations ─────────────────────────────────────────

function devopsDiscordNotify(title: string, message: string, type: 'success' | 'info' | 'warning' | 'error' = 'success', fields?: Array<{ name: string; value: string; inline?: boolean }>) {
    import("../discordService").then(({ discordService }) => {
        discordService.sendNotification({ title: `🔧 DevOps — ${title}`, message, type, fields }).catch(() => {});
    }).catch(() => {});
}

async function devopsAutoJournal(repoFullName: string, entryType: string, title: string, description?: string, filesChanged?: string[], metadata?: Record<string, any>) {
    try {
        const { db } = await import("../../db");
        const { sql } = await import("drizzle-orm");
        const [project] = await db.execute(sql`
            SELECT id FROM devmax_projects 
            WHERE (repo_owner || '/' || repo_name) = ${repoFullName} 
            OR deploy_slug = ${repoFullName.split('/').pop() || ''}
            LIMIT 1
        `).then((r: any) => r.rows || r).catch(() => []);
        if (!project?.id) return;
        const filesArr = filesChanged && filesChanged.length > 0 ? `{${filesChanged.map(f => `"${f.replace(/"/g, '\\"')}"`).join(',')}}` : null;
        await db.execute(sql.raw(`
            INSERT INTO devmax_project_journal (project_id, entry_type, title, description, files_changed, metadata)
            VALUES ('${project.id}', '${entryType}', '${title.replace(/'/g, "''")}', ${description ? `'${description.replace(/'/g, "''")}'` : 'NULL'}, ${filesArr ? `'${filesArr}'::text[]` : 'NULL'}, ${metadata ? `'${JSON.stringify(metadata).replace(/'/g, "''")}'::jsonb` : 'NULL'})
        `));
        console.log(`[DevOps-Journal] ${entryType}: ${title} → project ${project.id}`);

        try {
            const { cumulativeLearningEngine } = await import("../cumulativeLearningEngine");
            const isError = entryType === "error" || entryType === "bug" || entryType === "revert";
            const isSuccess = entryType === "deploy" || entryType === "code_edit" || entryType === "merge";
            await cumulativeLearningEngine.recordTaskOutcome({
                agent: "maxai",
                projectId: project.id,
                taskType: entryType,
                taskDescription: title,
                outcome: isError ? "failure" : isSuccess ? "success" : "partial",
                filesChanged: filesChanged || [],
                errorEncountered: isError ? (description || title) : undefined,
                errorResolution: metadata?.resolution || undefined,
                metadata: metadata || {},
            });
            if (isSuccess && filesChanged && filesChanged.length > 0) {
                await cumulativeLearningEngine.recordInsight({
                    agent: "maxai",
                    category: "devops",
                    subcategory: entryType,
                    insightType: "success_pattern",
                    title: `${entryType}: ${title.slice(0, 100)}`,
                    content: description || title,
                    sourceProject: repoFullName,
                    sourceFiles: filesChanged,
                    confidence: 60,
                    impactScore: 50,
                });
            }
        } catch {}
    } catch (e: any) {
        console.log(`[DevOps-Journal] Skip: ${e.message}`);
    }
}

async function resolveGitHubTokenForProject(db: any, owner?: string, repo?: string, projectId?: string, tenantContext?: { isTenant?: boolean; tenantUserId?: number; tenantId?: string }): Promise<string | null> {
    try {
        const { resolveGitHubToken } = await import("../devmax/tokenService");
        return resolveGitHubToken({ projectId, owner, repo, tenantContext, validate: false });
    } catch (e: any) {
        console.warn("[DevOpsGitHub] Token resolution failed:", e.message);
        return null;
    }
}

export async function executeDevopsGithub(args: Record<string, any>): Promise<string> {
    try {
        const { githubService, withGitHubToken } = await import("../githubService");
        const { db } = await import("../../db");
        let { action, owner, repo, branch, fromBranch, path, content, message, title, body, head, base, pullNumber, workflowId, runId, files, urls, isPrivate, templateId, url } = args;
        const limit = args.limit;

        if (args.repoFullName && !owner && !repo) {
            const parts = args.repoFullName.split('/');
            if (parts.length === 2) { owner = parts[0]; repo = parts[1]; }
        }
        if (args.repoName && !repo) repo = args.repoName;
        if (args.branchName && !branch) branch = args.branchName;
        if (args.commitMessage && !message) message = args.commitMessage;

        const projectToken = await resolveGitHubTokenForProject(db, owner, repo, args.projectId, args._tenantContext);

        const WRITE_ACTIONS = ["create_file", "update_file", "apply_patch", "smart_sync", "delete_file", "rename_file", "move_file"];
        const isPromoteToProd = args._promoteToProd === true || (message && typeof message === "string" && (message.includes("[Staging→Prod]") || message.includes("[PROD]") || message.includes("[promote]")));
        if (repo && WRITE_ACTIONS.includes(action) && !repo.endsWith("-test") && !isPromoteToProd) {
            const testRepoName = `${repo}-test`;
            try {
                const testRepoCheck = await githubService.getRepo(owner || "ulyssemdbh-commits", testRepoName);
                if (testRepoCheck) {
                    console.log(`[DevOps-StagingGuard] ⚡ Auto-redirect: ${repo} → ${testRepoName} (staging-first policy)`);
                    repo = testRepoName;
                    if (args.repo) args.repo = testRepoName;
                }
            } catch {
            }
        }

        const executeAction = async (): Promise<string> => {
        switch (action) {
            case "list_repos": {
                const repos = await githubService.listRepos({ sort: "updated", per_page: 30 });
                const { devopsDeployUrls: dduList } = await import("@shared/schema");
                const allUrlRows = await db.select().from(dduList);
                const deployData: Record<string, string[]> = {};
                for (const row of allUrlRows) {
                    if (!deployData[row.repoFullName]) deployData[row.repoFullName] = [];
                    deployData[row.repoFullName].push(row.url);
                }
                const list = (repos as any[]).map((r: any) => ({
                    name: r.full_name,
                    description: r.description,
                    private: r.private,
                    language: r.language,
                    stars: r.stargazers_count,
                    updated: r.updated_at,
                    default_branch: r.default_branch,
                    homepage: r.homepage || null,
                    deployUrls: deployData[r.full_name] || []
                }));
                return JSON.stringify({ repos: list, count: list.length });
            }
            case "repo_info": {
                if (!owner || !repo) return JSON.stringify({ error: "owner et repo requis" });
                const [repoData, languages] = await Promise.all([
                    githubService.getRepo(owner, repo),
                    githubService.getRepoLanguages(owner, repo).catch(() => ({}))
                ]);
                const { devopsDeployUrls: dduInfo } = await import("@shared/schema");
                const { eq: eqInfo } = await import("drizzle-orm");
                const infoRows = await db.select().from(dduInfo).where(eqInfo(dduInfo.repoFullName, `${owner}/${repo}`));
                return JSON.stringify({ repo: repoData, languages, deployUrls: infoRows.map(r => r.url) });
            }
            case "list_branches": {
                if (!owner || !repo) return JSON.stringify({ error: "owner et repo requis" });
                const branches = await githubService.listBranches(owner, repo);
                return JSON.stringify({ branches: Array.isArray(branches) ? branches : [] });
            }
            case "list_commits": {
                if (!owner || !repo) return JSON.stringify({ error: "owner et repo requis" });
                const commitLimit = limit || args.count || 20;
                const commitOpts: { author?: string; since?: string; until?: string; path?: string } = {};
                if (args.author) commitOpts.author = args.author;
                if (args.since) commitOpts.since = args.since;
                if (args.until) commitOpts.until = args.until;
                if (args.file_path || args.filePath) commitOpts.path = args.file_path || args.filePath;
                const commits = await githubService.listCommits(owner, repo, branch || undefined, commitLimit, Object.keys(commitOpts).length ? commitOpts : undefined);
                let list = Array.isArray(commits) ? (commits as any[]).map((c: any) => ({
                    sha: c.sha?.slice(0, 7),
                    fullSha: c.sha,
                    message: c.commit?.message?.split("\n")[0],
                    author: c.commit?.author?.name,
                    date: c.commit?.author?.date,
                    filesChanged: c.files?.length || null
                })) : [];
                if (args.search || args.messageFilter) {
                    const searchTerm = (args.search || args.messageFilter).toLowerCase();
                    list = list.filter(c => c.message?.toLowerCase().includes(searchTerm));
                }
                return JSON.stringify({ commits: list, count: list.length, filters: { branch, ...commitOpts, search: args.search || args.messageFilter || null } });
            }
            case "list_prs": {
                if (!owner || !repo) return JSON.stringify({ error: "owner et repo requis" });
                const prs = await githubService.listPullRequests(owner, repo);
                return JSON.stringify({ pullRequests: Array.isArray(prs) ? prs : [] });
            }
            case "create_branch": {
                if (!owner || !repo || !branch) return JSON.stringify({ error: "owner, repo et branch requis" });
                const sourceBranch = fromBranch || "main";
                const branchInfo = await githubService.getBranch(owner, repo, sourceBranch);
                const sourceSha = (branchInfo as any)?.commit?.sha;
                if (!sourceSha) return JSON.stringify({ error: `Impossible de résoudre le SHA de la branche '${sourceBranch}'. Vérifie qu'elle existe.` });
                const result = await githubService.createBranch(owner, repo, branch, sourceSha);
                devopsDiscordNotify("Branche créée", `\`${branch}\` sur **${owner}/${repo}**`, "success", [
                    { name: "Source", value: sourceBranch, inline: true },
                    { name: "SHA", value: sourceSha?.slice(0, 7), inline: true }
                ]);
                return JSON.stringify({ success: true, branch, from: sourceBranch, sha: sourceSha?.slice(0, 7), result });
            }
            case "create_pr": {
                if (!owner || !repo || !title || !head) return JSON.stringify({ error: "owner, repo, title et head requis" });
                const pr = await githubService.createPullRequest(owner, repo, title, head, base || "main", body || "");
                devopsDiscordNotify("Pull Request créée", `**${title}**\n${owner}/${repo}: \`${head}\` → \`${base || "main"}\``, "info", [
                    { name: "PR", value: `#${(pr as any)?.number || '?'}`, inline: true },
                    { name: "Repo", value: `${owner}/${repo}`, inline: true }
                ]);
                devopsAutoJournal(`${owner}/${repo}`, "code_edit", `PR #${(pr as any)?.number || '?'}: ${title}`, `${head} → ${base || "main"}`, [], { prNumber: (pr as any)?.number, head, base: base || "main" });
                return JSON.stringify({ success: true, pr });
            }
            case "merge_pr": {
                if (!owner || !repo || !pullNumber) return JSON.stringify({ error: "owner, repo et pullNumber requis" });
                const merged = await githubService.mergePullRequest(owner, repo, pullNumber);
                devopsDiscordNotify("PR Mergée", `PR #${pullNumber} mergée sur **${owner}/${repo}**`, "success");
                devopsAutoJournal(`${owner}/${repo}`, "deploy", `PR #${pullNumber} mergée`, undefined, [], { prNumber: pullNumber });
                return JSON.stringify({ success: true, merged });
            }
            case "close_pr": {
                if (!owner || !repo || !pullNumber) return JSON.stringify({ error: "owner, repo et pullNumber requis" });
                const { githubApi } = await import("../githubService");
                await githubApi(`/repos/${owner}/${repo}/pulls/${pullNumber}`, {
                    method: "PATCH",
                    body: { state: "closed" },
                });
                console.log(`[DevOpsGitHub] Closed PR #${pullNumber} on ${owner}/${repo}`);
                return JSON.stringify({ success: true, pullNumber, state: "closed" });
            }
            case "get_file": {
                if (!owner || !repo || !path) return JSON.stringify({ error: "owner, repo et path requis" });
                let file: any = null;
                let resolvedPath = path;
                try {
                    file = await githubService.getFileContent(owner, repo, path, branch);
                } catch (e: any) {
                    const extSwaps: Record<string, string> = { ".js": ".ts", ".ts": ".js", ".jsx": ".tsx", ".tsx": ".jsx" };
                    const ext = "." + (path.split(".").pop() || "");
                    const alt = extSwaps[ext];
                    if (alt) {
                        const altPath = path.slice(0, -ext.length) + alt;
                        try {
                            file = await githubService.getFileContent(owner, repo, altPath, branch);
                            resolvedPath = altPath;
                        } catch {}
                    }
                    if (!file) {
                        const structured = e.structured || {};
                        return JSON.stringify({
                            error: structured.code || "file_not_found",
                            path,
                            suggestion: structured.suggestion || "Fichier introuvable.",
                            hint: `Utilise browse_files pour voir les fichiers réels du repo — les extensions (.ts/.js/.tsx/.jsx) peuvent différer de ce que tu attends. Ne devine JAMAIS un chemin.`
                        });
                    }
                }
                if (file?.content) {
                    const decoded = Buffer.from(file.content, "base64").toString("utf-8");
                    const maxChars = args.full ? 50000 : 15000;
                    const result: any = { path: resolvedPath, content: decoded.slice(0, maxChars), truncated: decoded.length > maxChars, totalChars: decoded.length };
                    if (resolvedPath !== path) result.note = `Fichier trouvé sous ${resolvedPath} (extension corrigée automatiquement).`;
                    return JSON.stringify(result);
                }
                return JSON.stringify(file);
            }
            case "create_file":
            case "update_file": {
                if (!owner || !repo || !path || !content) return JSON.stringify({ error: "owner, repo, path et content requis" });
                let targetBranch = branch;
                let defaultBranch = "main";
                try {
                    const repoInfo = await githubService.getRepo(owner, repo);
                    defaultBranch = (repoInfo as any).default_branch || "main";
                    if (!targetBranch) targetBranch = defaultBranch;
                } catch { if (!targetBranch) targetBranch = "main"; }

                const { devopsIntelligenceEngine } = await import("../devopsIntelligenceEngine");
                let originalContent: string | undefined;
                try {
                    const existing = await githubService.getFileContent(owner, repo, path, targetBranch);
                    if ((existing as any)?.content) {
                        originalContent = Buffer.from((existing as any).content, "base64").toString("utf-8");
                    }
                } catch {}

                const analysis = devopsIntelligenceEngine.deepCodeAnalysis(
                    [{ path, content, originalContent }],
                    targetBranch
                );

                if (analysis.blocked) {
                    const riskEmoji = "🔴";
                    devopsDiscordNotify("update_file BLOQUÉ", `**${path}**\n${owner}/${repo} sur \`${targetBranch}\`\n${riskEmoji} ${analysis.summary}`, "error", [
                        { name: "Risque", value: `${analysis.riskScore}/100`, inline: true },
                        { name: "Score destructif", value: `${analysis.destructiveScore}`, inline: true },
                        { name: "Problèmes", value: analysis.structuralIssues.slice(0, 3).join("\n") || "N/A", inline: false }
                    ]);
                    return JSON.stringify({
                        success: false,
                        blocked: true,
                        error: "Modification BLOQUÉE par l'analyse de code profonde",
                        analysis: {
                            summary: analysis.summary,
                            riskScore: analysis.riskScore,
                            destructiveScore: analysis.destructiveScore,
                            warnings: analysis.warnings.slice(0, 10),
                            structuralIssues: analysis.structuralIssues,
                            recommendations: analysis.recommendations,
                        },
                        instruction: analysis.forceBranch
                            ? `Créer une branche avec create_branch, appliquer les changements dessus, puis ouvrir une PR vers '${defaultBranch}'.`
                            : "Faire des modifications plus ciblées et incrémentales."
                    });
                }

                if (analysis.forceBranch && ["main", "master", "production", "prod"].includes(targetBranch)) {
                    const safeBranch = `maxai/update-${Date.now()}`;
                    try {
                        await githubService.createBranch(owner, repo, safeBranch, targetBranch);
                    } catch (e: any) {
                        return JSON.stringify({ error: `Impossible de créer la branche de sécurité '${safeBranch}': ${e.message}` });
                    }
                    const result = await githubService.createOrUpdateFile(owner, repo, path, content, message || `Update ${path}`, safeBranch);
                    let pr: any = null;
                    try {
                        pr = await githubService.createPullRequest(owner, repo,
                            `[MaxAI] ${message || `Update ${path}`}`,
                            `## Analyse de risque\n- Score: ${analysis.riskScore}/100 (${analysis.riskLevel})\n- Score destructif: ${analysis.destructiveScore}\n\n### Avertissements\n${analysis.warnings.map(w => `- ${w}`).join("\n")}\n\n### Recommandations\n${analysis.recommendations.map(r => `- ${r}`).join("\n")}`,
                            safeBranch, targetBranch
                        );
                    } catch {}
                    devopsDiscordNotify("update_file → branche de sécurité", `**${path}**\n${owner}/${repo}\nBranche: \`${safeBranch}\`\nPR: ${pr ? `#${(pr as any).number}` : "non créée"}`, "warning", [
                        { name: "Risque", value: `${analysis.riskScore}/100`, inline: true },
                        { name: "Branche", value: safeBranch, inline: true }
                    ]);
                    return JSON.stringify({
                        success: true,
                        redirected: true,
                        branch: safeBranch,
                        pr: pr ? { number: (pr as any).number, url: (pr as any).html_url } : null,
                        message: `Modification redirigée vers la branche '${safeBranch}' pour review (risque ${analysis.riskScore}/100)`,
                        analysis: { score: analysis.riskScore, level: analysis.riskLevel, destructiveScore: analysis.destructiveScore, warnings: analysis.warnings.slice(0, 5) }
                    });
                }

                let result: any;
                try {
                    result = await githubService.createOrUpdateFile(owner, repo, path, content, message || `Update ${path}`, targetBranch);
                } catch (updateErr: any) {
                    const errMsg = updateErr.message || "";
                    if (errMsg.includes("422") || errMsg.includes("sha") || errMsg.includes("does not match")) {
                        await new Promise(r => setTimeout(r, 1000));
                        try {
                            result = await githubService.createOrUpdateFile(owner, repo, path, content, message || `Update ${path}`, targetBranch);
                        } catch (retryErr: any) {
                            return JSON.stringify({ error: `Échec update_file après retry (SHA mismatch): ${retryErr.message}`, hint: "Le fichier a été modifié entre-temps. Récupère la dernière version avec get_file puis réessaie." });
                        }
                    } else {
                        throw updateErr;
                    }
                }
                const riskEmoji = analysis.riskLevel === "dangerous" ? "🔴" : analysis.riskLevel === "risky" ? "🟠" : analysis.riskLevel === "caution" ? "🟡" : "🟢";
                devopsDiscordNotify(action === "create_file" ? "create_file" : "update_file", `**${path}**\n${owner}/${repo} sur \`${targetBranch}\`\n${riskEmoji} Risque: ${analysis.riskScore}/100`, analysis.riskScore >= 55 ? "warning" : "success", [
                    { name: "Risque", value: `${analysis.riskScore}/100`, inline: true },
                    { name: "Branche", value: targetBranch, inline: true }
                ]);
                return JSON.stringify({ success: true, result, analysis: { score: analysis.riskScore, level: analysis.riskLevel, warnings: analysis.warnings.slice(0, 5) } });
            }
            case "delete_file": {
                if (!owner || !repo || !path) return JSON.stringify({ error: "owner, repo et path requis" });
                let targetBranch = branch;
                let defaultBranch = "main";
                try {
                    const repoInfo = await githubService.getRepo(owner, repo);
                    defaultBranch = (repoInfo as any).default_branch || "main";
                    if (!targetBranch) targetBranch = defaultBranch;
                } catch { if (!targetBranch) targetBranch = "main"; }

                const isDefaultBranch = targetBranch === defaultBranch || ["main", "master", "production", "prod"].includes(targetBranch);
                if (isDefaultBranch) {
                    const basename = path.split("/").pop() || "";
                    const { devopsIntelligenceEngine } = await import("../devopsIntelligenceEngine");
                    const fragile = devopsIntelligenceEngine.findFragileModule(basename);
                    if (fragile && fragile.fragility >= 50) {
                        devopsDiscordNotify("delete_file BLOQUÉ", `**${path}** — module critique (fragility: ${fragile.fragility})\n${owner}/${repo} sur \`${targetBranch}\``, "error", [
                            { name: "Fichier", value: path, inline: true },
                            { name: "Fragilité", value: `${fragile.fragility}/100`, inline: true },
                            { name: "Raison", value: fragile.reason, inline: false }
                        ]);
                        return JSON.stringify({
                            success: false,
                            blocked: true,
                            error: `Suppression BLOQUÉE: ${basename} est un module critique (fragilité ${fragile.fragility}/100). Raison: ${fragile.reason}`,
                            instruction: `Créer une branche avec create_branch, supprimer le fichier dessus, puis ouvrir une PR vers '${defaultBranch}'.`
                        });
                    }

                    const safeBranch = `maxai/delete-${Date.now()}`;
                    try {
                        await githubService.createBranch(owner, repo, safeBranch, targetBranch);
                        const result = await githubService.deleteFile(owner, repo, path, message || `Delete ${path}`, safeBranch);
                        let pr: any = null;
                        try {
                            pr = await githubService.createPullRequest(owner, repo,
                                `[MaxAI] Delete ${path}`,
                                `Suppression de \`${path}\` via MaxAI.\nFragilité: ${fragile ? fragile.fragility : 0}/100`,
                                safeBranch, targetBranch
                            );
                        } catch {}
                        devopsDiscordNotify("delete_file → branche de sécurité", `**${path}**\n${owner}/${repo}\nBranche: \`${safeBranch}\``, "warning", [
                            { name: "Fichier", value: path, inline: true },
                            { name: "Branche", value: safeBranch, inline: true }
                        ]);
                        return JSON.stringify({
                            success: true,
                            redirected: true,
                            branch: safeBranch,
                            pr: pr ? { number: (pr as any).number, url: (pr as any).html_url } : null,
                            message: `Suppression redirigée vers la branche '${safeBranch}' pour review`
                        });
                    } catch (e: any) {
                        return JSON.stringify({ error: `Impossible de créer la branche de sécurité: ${e.message}` });
                    }
                }

                const result = await githubService.deleteFile(owner, repo, path, message || `Delete ${path}`, targetBranch);
                return JSON.stringify({ success: true, message: `Fichier ${path} supprimé`, result });
            }
            case "delete_branch": {
                if (!owner || !repo || !branch) return JSON.stringify({ error: "owner, repo et branch requis" });
                await githubService.deleteBranch(owner, repo, branch);
                return JSON.stringify({ success: true, message: `Branche ${branch} supprimée` });
            }
            case "rename_file":
            case "move_file": {
                if (!owner || !repo || !path) return JSON.stringify({ error: "owner, repo et path (source) requis" });
                const newPath = args.newPath || args.new_path || args.destination || args.to;
                if (!newPath) return JSON.stringify({ error: "newPath (destination) requis" });
                let renameBranch = branch;
                try {
                    const repoInfo = await githubService.getRepo(owner, repo);
                    if (!renameBranch) renameBranch = (repoInfo as any).default_branch || "main";
                } catch { if (!renameBranch) renameBranch = "main"; }
                let fileContent: string;
                try {
                    const existing = await githubService.getFileContent(owner, repo, path, renameBranch);
                    if (!(existing as any)?.content) return JSON.stringify({ error: `Fichier source '${path}' introuvable ou vide` });
                    fileContent = Buffer.from((existing as any).content, "base64").toString("utf-8");
                } catch (e: any) {
                    return JSON.stringify({ error: `Impossible de lire le fichier source '${path}': ${e.message}` });
                }
                try {
                    await githubService.createOrUpdateFile(owner, repo, newPath, fileContent, message || `Rename ${path} → ${newPath}`, renameBranch);
                } catch (e: any) {
                    return JSON.stringify({ error: `Impossible de créer '${newPath}': ${e.message}` });
                }
                try {
                    await githubService.deleteFile(owner, repo, path, message || `Delete old file ${path} (renamed to ${newPath})`, renameBranch);
                } catch (e: any) {
                    return JSON.stringify({ success: true, warning: `Fichier copié vers '${newPath}' mais l'ancien '${path}' n'a pas pu être supprimé: ${e.message}` });
                }
                devopsDiscordNotify("rename_file", `**${path}** → **${newPath}**\n${owner}/${repo} sur \`${renameBranch}\``, "success", [
                    { name: "Source", value: path, inline: true },
                    { name: "Destination", value: newPath, inline: true }
                ]);
                return JSON.stringify({ success: true, from: path, to: newPath, branch: renameBranch, message: `Fichier renommé: ${path} → ${newPath}` });
            }
            case "search_code": {
                if (!owner || !repo) return JSON.stringify({ error: "owner et repo requis" });
                const query = message || content || path || "";
                if (!query) return JSON.stringify({ error: "query requis (via message, content ou path)" });
                try {
                    const results = await githubService.searchCode(owner, repo, query);
                    const items = ((results as any).items || []).map((i: any) => ({
                        path: i.path, name: i.name, sha: i.sha,
                        score: i.score
                    }));
                    const response: any = { results: items, total: (results as any).total_count };
                    if (items.length === 0) {
                        response.hint = "Aucun résultat. Essaie une recherche plus large ou utilise browse_files pour explorer l'arborescence et trouver les fichiers manuellement.";
                    }
                    return JSON.stringify(response);
                } catch (e: any) {
                    return JSON.stringify({ error: e.message || "Erreur search_code", hint: "La recherche de code GitHub peut échouer sur les repos récents ou petits. Utilise browse_files pour explorer l'arborescence à la place." });
                }
            }
            case "apply_patch": {
                if (!owner || !repo) return JSON.stringify({ error: "owner et repo requis. Exemple: owner='ulyssemdbh-commits', repo='HorlogeMax'" });
                if (!files || !Array.isArray(files) || files.length === 0) return JSON.stringify({ error: "files requis. Format: files=[{path:'chemin/fichier.js', content:'CONTENU COMPLET DU FICHIER'}]" });
                if (!message) message = `Update ${files.length} file(s) via Ulysse`;
                let patchBranch = branch;
                let defaultBranch = "main";
                try {
                    const repoInfo = await githubService.getRepo(owner, repo);
                    defaultBranch = (repoInfo as any).default_branch || "main";
                    if (!patchBranch) patchBranch = defaultBranch;
                } catch { if (!patchBranch) patchBranch = "main"; }

                const { devopsIntelligenceEngine } = await import("../devopsIntelligenceEngine");

                const filesWithOriginals = await Promise.all(files.map(async (f: any) => {
                    let originalContent: string | undefined;
                    try {
                        const existing = await githubService.getFileContent(owner, repo, f.path, patchBranch!);
                        if ((existing as any)?.content) {
                            originalContent = Buffer.from((existing as any).content, "base64").toString("utf-8");
                        }
                    } catch {}
                    return { path: f.path, content: f.content, originalContent };
                }));

                const analysis = devopsIntelligenceEngine.deepCodeAnalysis(filesWithOriginals, patchBranch);

                if (analysis.blocked) {
                    devopsDiscordNotify("apply_patch BLOQUÉ", `**${message}**\n${owner}/${repo} sur \`${patchBranch}\`\n🔴 ${analysis.summary}`, "error", [
                        { name: "Fichiers", value: `${files.length} fichier(s)`, inline: true },
                        { name: "Risque", value: `${analysis.riskScore}/100`, inline: true },
                        { name: "Destructif", value: `${analysis.destructiveScore}`, inline: true },
                        { name: "Problèmes", value: analysis.structuralIssues.slice(0, 3).join("\n") || "N/A", inline: false }
                    ]);
                    return JSON.stringify({
                        success: false,
                        blocked: true,
                        error: "Patch BLOQUÉ par l'analyse de code profonde",
                        analysis: {
                            summary: analysis.summary,
                            riskScore: analysis.riskScore,
                            destructiveScore: analysis.destructiveScore,
                            warnings: analysis.warnings.slice(0, 10),
                            structuralIssues: analysis.structuralIssues,
                            recommendations: analysis.recommendations,
                        },
                        instruction: `Créer une branche avec create_branch, appliquer les changements dessus, puis ouvrir une PR vers '${defaultBranch}'.`
                    });
                }

                if (analysis.forceBranch && ["main", "master", "production", "prod"].includes(patchBranch)) {
                    const safeBranch = `maxai/patch-${Date.now()}`;
                    try {
                        await githubService.createBranch(owner, repo, safeBranch, patchBranch);
                    } catch (e: any) {
                        return JSON.stringify({ error: `Impossible de créer la branche de sécurité: ${e.message}` });
                    }
                    const result = await githubService.applyPatch(owner, repo, safeBranch, files, message);
                    let pr: any = null;
                    try {
                        pr = await githubService.createPullRequest(owner, repo,
                            `[MaxAI] ${message}`,
                            `## Analyse de code profonde\n- Score de risque: ${analysis.riskScore}/100 (${analysis.riskLevel})\n- Score destructif: ${analysis.destructiveScore}\n- Fichiers modifiés: ${files.length}\n\n### Avertissements\n${analysis.warnings.map((w: string) => `- ${w}`).join("\n")}\n\n### Problèmes structurels\n${analysis.structuralIssues.map((s: string) => `- ${s}`).join("\n") || "Aucun"}\n\n### Recommandations\n${analysis.recommendations.map((r: string) => `- ${r}`).join("\n")}`,
                            safeBranch, patchBranch
                        );
                    } catch {}
                    devopsDiscordNotify("apply_patch → branche de sécurité", `**${message}**\n${owner}/${repo}\nBranche: \`${safeBranch}\`\nPR: ${pr ? `#${(pr as any).number}` : "non créée"}`, "warning", [
                        { name: "Fichiers", value: `${files.length}`, inline: true },
                        { name: "Risque", value: `${analysis.riskScore}/100`, inline: true },
                        { name: "Branche", value: safeBranch, inline: true }
                    ]);
                    devopsAutoJournal(`${owner}/${repo}`, "code_edit", `Patch (branche sécu): ${message}`, `Risque ${analysis.riskScore}/100 → ${safeBranch}`, files.map((f: any) => f.path), { riskScore: analysis.riskScore, branch: safeBranch, prNumber: pr ? (pr as any).number : null });
                    return JSON.stringify({
                        success: true,
                        redirected: true,
                        branch: safeBranch,
                        pr: pr ? { number: (pr as any).number, url: (pr as any).html_url } : null,
                        message: `Patch redirigé vers '${safeBranch}' pour review (risque ${analysis.riskScore}/100)`,
                        analysis: { score: analysis.riskScore, level: analysis.riskLevel, destructiveScore: analysis.destructiveScore, warnings: analysis.warnings.slice(0, 5) }
                    });
                }

                let result: any;
                try {
                    result = await githubService.applyPatch(owner, repo, patchBranch, files, message);
                } catch (patchErr: any) {
                    const errMsg = patchErr.message || "";
                    if (errMsg.includes("422") || errMsg.includes("sha") || errMsg.includes("does not match")) {
                        await new Promise(r => setTimeout(r, 1500));
                        try {
                            result = await githubService.applyPatch(owner, repo, patchBranch, files, message);
                        } catch (retryErr: any) {
                            return JSON.stringify({ error: `Échec apply_patch après retry (SHA mismatch): ${retryErr.message}`, hint: "Les fichiers ont été modifiés entre-temps. Attends quelques secondes et réessaie." });
                        }
                    } else {
                        throw patchErr;
                    }
                }
                const riskEmoji = analysis.riskLevel === "dangerous" ? "🔴" : analysis.riskLevel === "risky" ? "🟠" : analysis.riskLevel === "caution" ? "🟡" : "🟢";
                devopsDiscordNotify("Patch appliqué", `**${message}**\n${owner}/${repo} sur \`${patchBranch}\`\n${riskEmoji} Risk: ${analysis.riskScore}/100 (${analysis.riskLevel})`, analysis.riskScore >= 55 ? "warning" : "success", [
                    { name: "Fichiers", value: `${files.length} fichier(s)`, inline: true },
                    { name: "Branche", value: patchBranch, inline: true },
                    { name: "Risque", value: `${analysis.riskScore}/100`, inline: true },
                    { name: "Destructif", value: `${analysis.destructiveScore}`, inline: true }
                ]);
                devopsAutoJournal(`${owner}/${repo}`, "code_edit", `Patch: ${message}`, `${files.length} fichier(s) sur ${patchBranch}, risque ${analysis.riskScore}/100`, files.map((f: any) => f.path), { riskScore: analysis.riskScore, branch: patchBranch, riskLevel: analysis.riskLevel });
                return JSON.stringify({
                    success: true,
                    result,
                    risk_analysis: {
                        score: analysis.riskScore,
                        level: analysis.riskLevel,
                        destructiveScore: analysis.destructiveScore,
                        warnings: analysis.warnings.slice(0, 5),
                        recommendations: analysis.recommendations.slice(0, 3),
                        structuralIssues: analysis.structuralIssues.slice(0, 3),
                    }
                });
            }
            case "smart_sync": {
                if (!owner || !repo) return JSON.stringify({ error: "owner et repo requis" });
                if (!files || !Array.isArray(files) || files.length === 0) return JSON.stringify({ error: "files requis. Format: files=[{path:'chemin/fichier', content:'CONTENU COMPLET'}]" });
                let syncBranch = branch;
                try {
                    const repoInfo = await githubService.getRepo(owner, repo);
                    if (!syncBranch) syncBranch = (repoInfo as any).default_branch || "main";
                } catch { if (!syncBranch) syncBranch = "main"; }
                if (!message) message = `[MaxAI] Smart sync — ${files.length} file(s)`;
                const syncResult = await githubService.smartSync(owner, repo, syncBranch, files, message);
                if (syncResult.success) {
                    devopsDiscordNotify("Smart Sync", `**${message}**\n${owner}/${repo}@\`${syncBranch}\`\n${syncResult.filesChanged} changed, ${syncResult.skipped} skipped`, syncResult.filesChanged > 0 ? "success" : "info", [
                        { name: "Changed", value: `${syncResult.filesChanged}`, inline: true },
                        { name: "Skipped", value: `${syncResult.skipped}`, inline: true },
                        { name: "Total", value: `${syncResult.filesTotal}`, inline: true },
                    ]);
                }
                return JSON.stringify(syncResult);
            }
            case "browse_files": {
                if (!owner || !repo) return JSON.stringify({ error: "owner et repo requis" });
                const repoData = await githubService.getRepo(owner, repo);
                const tree = await githubService.getTree(owner, repo, branch || (repoData as any).default_branch || "main");
                const allItems = ((tree as any).tree || []).map((t: any) => ({
                    path: t.path, type: t.type, size: t.size
                }));

                const browsePath = args.path || "";
                let filtered = allItems;
                if (browsePath) {
                    const prefix = browsePath.endsWith("/") ? browsePath : browsePath + "/";
                    filtered = allItems.filter((f: any) => f.path.startsWith(prefix));
                }

                const dirs = new Map<string, { files: number; totalSize: number; subdirs: Set<string> }>();
                const topFiles: any[] = [];
                const baseDepth = browsePath ? browsePath.split("/").filter(Boolean).length : 0;

                for (const item of filtered) {
                    const rel = browsePath ? item.path.slice(browsePath.replace(/\/$/, "").length + 1) : item.path;
                    const parts = rel.split("/");
                    if (parts.length === 1) {
                        topFiles.push(item);
                    } else {
                        const dirName = parts[0];
                        if (!dirs.has(dirName)) dirs.set(dirName, { files: 0, totalSize: 0, subdirs: new Set() });
                        const d = dirs.get(dirName)!;
                        d.files++;
                        d.totalSize += item.size || 0;
                        if (parts.length > 2) d.subdirs.add(parts[1]);
                    }
                }

                const codeDirs = new Set(["client", "server", "shared", "src", "lib", "components", "pages", "services", "routes", "api", "hooks", "utils", "config", "scripts", "dist", "public", "test", "tests", ".github"]);
                const assetDirs = new Set(["attached_assets", ".canvas", "node_modules", "uploads"]);

                const dirSummary = Array.from(dirs.entries())
                    .map(([name, info]) => ({
                        name: browsePath ? `${browsePath.replace(/\/$/, "")}/${name}` : name,
                        type: "tree",
                        files: info.files,
                        totalSize: info.totalSize,
                        subdirs: info.subdirs.size,
                        category: codeDirs.has(name) ? "code" : assetDirs.has(name) ? "assets" : "other"
                    }))
                    .sort((a, b) => {
                        const catOrder: Record<string, number> = { code: 0, other: 1, assets: 2 };
                        return (catOrder[a.category] || 1) - (catOrder[b.category] || 1) || b.files - a.files;
                    });

                const codeExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".css", ".html", ".py", ".md", ".yml", ".yaml", ".sh", ".sql", ".env"]);
                const sortedFiles = topFiles.sort((a, b) => {
                    const aExt = "." + (a.path.split(".").pop() || "");
                    const bExt = "." + (b.path.split(".").pop() || "");
                    const aCode = codeExtensions.has(aExt) ? 0 : 1;
                    const bCode = codeExtensions.has(bExt) ? 0 : 1;
                    return aCode - bCode || a.path.localeCompare(b.path);
                });

                const isLargeRepo = allItems.length > 500;
                const maxRootFiles = isLargeRepo ? 15 : 30;
                const maxSubFiles = isLargeRepo ? 25 : 50;
                const maxDirs = isLargeRepo ? 20 : 50;

                if (!browsePath) {
                    const codeDirList = dirSummary.filter(d => d.category === "code").map(d => d.name);
                    const subdirsDetail: Record<string, string[]> = {};
                    const keyFiles: Record<string, string[]> = {};
                    for (const codeDir of codeDirList.slice(0, 8)) {
                        const prefix2 = codeDir + "/";
                        const subItems = allItems.filter((f: any) => f.path.startsWith(prefix2));
                        const subs = new Set<string>();
                        const directFiles: string[] = [];
                        for (const si of subItems) {
                            const relParts = si.path.slice(prefix2.length).split("/");
                            if (relParts.length > 1) subs.add(relParts[0]);
                            if (relParts.length <= 2 && codeExtensions.has("." + (si.path.split(".").pop() || ""))) {
                                directFiles.push(si.path);
                            }
                        }
                        if (subs.size > 0) {
                            const sorted = Array.from(subs).sort();
                            subdirsDetail[codeDir] = sorted.length > 15 ? [...sorted.slice(0, 12), `... +${sorted.length - 12} more`] : sorted;
                        }
                        if (directFiles.length > 0) {
                            keyFiles[codeDir] = directFiles.slice(0, 8);
                        }
                    }

                    const trimmedDirs = dirSummary.slice(0, maxDirs);
                    if (dirSummary.length > maxDirs) {
                        trimmedDirs.push({ name: "...", type: "summary", files: dirSummary.slice(maxDirs).reduce((s, d) => s + d.files, 0), totalSize: 0, subdirs: 0, category: "other" } as any);
                    }

                    const tsCount = allItems.filter((f: any) => f.path.endsWith(".ts") || f.path.endsWith(".tsx")).length;
                    const jsCount = allItems.filter((f: any) => f.path.endsWith(".js") || f.path.endsWith(".jsx")).length;
                    const stackHint = tsCount > jsCount ? `Stack TypeScript détectée (${tsCount} fichiers .ts/.tsx). Les fichiers sont en .ts PAS en .js.` : "";

                    return JSON.stringify({
                        path: "/",
                        repoSize: { totalFiles: allItems.length, totalDirs: dirs.size, isLarge: isLargeRepo },
                        directories: trimmedDirs,
                        codeStructure: subdirsDetail,
                        keyFilesPerDir: keyFiles,
                        files: sortedFiles.slice(0, maxRootFiles),
                        hint: (isLargeRepo
                            ? "Repo volumineux. Explore par dossier: browse_files path='client/src' ou path='server/services'. Ne tente PAS d'explorer tout le repo d'un coup."
                            : "Utilise browse_files avec path='client/src' ou path='server/services' pour explorer un sous-dossier.")
                            + " IMPORTANT: pour lire un fichier, utilise EXACTEMENT le path affiché ici (extensions incluses). Ne devine PAS les noms de fichiers."
                            + (stackHint ? ` ${stackHint}` : "")
                    });
                }

                const trimmedDirs = dirSummary.slice(0, maxDirs);
                return JSON.stringify({
                    path: browsePath,
                    directories: trimmedDirs,
                    files: sortedFiles.slice(0, maxSubFiles),
                    totalFiles: filtered.length,
                    totalDirs: dirs.size,
                    hint: (filtered.length > maxSubFiles
                        ? `${filtered.length - maxSubFiles} fichiers non affichés. Cible un sous-dossier spécifique pour voir plus.`
                        : "Utilise browse_files avec path='sous-dossier' pour explorer plus en profondeur.")
                        + " Pour lire un fichier, utilise EXACTEMENT le path affiché (extensions incluses)."
                });
            }
            case "list_workflows": {
                if (!owner || !repo) return JSON.stringify({ error: "owner et repo requis" });
                const wfs = await githubService.listWorkflows(owner, repo);
                const list = ((wfs as any).workflows || []).map((w: any) => ({
                    id: w.id, name: w.name, state: w.state, path: w.path
                }));
                return JSON.stringify({ workflows: list });
            }
            case "list_workflow_runs": {
                if (!owner || !repo) return JSON.stringify({ error: "owner et repo requis" });
                const runs = await githubService.listWorkflowRuns(owner, repo);
                const list = ((runs as any).workflow_runs || []).map((r: any) => ({
                    id: r.id, name: r.name, status: r.status, conclusion: r.conclusion,
                    branch: r.head_branch, event: r.event, created_at: r.created_at,
                    updated_at: r.updated_at, html_url: r.html_url, run_number: r.run_number
                }));
                return JSON.stringify({ runs: list, total: (runs as any).total_count });
            }
            case "trigger_workflow": {
                if (!owner || !repo || !workflowId) return JSON.stringify({ error: "owner, repo et workflowId requis" });
                await githubService.triggerWorkflow(owner, repo, workflowId, branch || "main");
                return JSON.stringify({ success: true, message: `Workflow ${workflowId} déclenché sur ${branch || "main"}` });
            }
            case "rerun_workflow": {
                if (!owner || !repo || !runId) return JSON.stringify({ error: "owner, repo et runId requis" });
                await githubService.rerunWorkflow(owner, repo, runId);
                return JSON.stringify({ success: true, message: `Workflow run ${runId} relancé` });
            }
            case "cancel_workflow": {
                if (!owner || !repo || !runId) return JSON.stringify({ error: "owner, repo et runId requis" });
                await githubService.cancelWorkflowRun(owner, repo, runId);
                return JSON.stringify({ success: true, message: `Workflow run ${runId} annulé` });
            }
            case "compare_branches": {
                if (!owner || !repo || !base || !head) return JSON.stringify({ error: "owner, repo, base et head requis" });
                const comparison = await githubService.compareBranches(owner, repo, base as string, head as string) as any;
                const fileSummary = (comparison.files || []).map((f: any) => ({
                    filename: f.filename,
                    status: f.status,
                    additions: f.additions,
                    deletions: f.deletions,
                    changes: f.changes,
                    patch: f.patch?.slice(0, 500),
                }));
                return JSON.stringify({
                    status: comparison.status,
                    ahead_by: comparison.ahead_by,
                    behind_by: comparison.behind_by,
                    total_commits: comparison.total_commits,
                    files_changed: fileSummary.length,
                    files: fileSummary.slice(0, 30),
                    commits: (comparison.commits || []).slice(0, 10).map((c: any) => ({
                        sha: c.sha?.slice(0, 7),
                        message: c.commit?.message?.split("\n")[0],
                        author: c.commit?.author?.name,
                    })),
                });
            }
            case "get_commit_diff": {
                if (!owner || !repo) return JSON.stringify({ error: "owner et repo requis" });
                const sha = args.sha || args.commit || args.commitSha;
                if (!sha) return JSON.stringify({ error: "sha (commit hash) requis" });
                const commit = await githubService.getCommit(owner, repo, sha) as any;
                const diffFiles = (commit.files || []).map((f: any) => ({
                    filename: f.filename,
                    status: f.status,
                    additions: f.additions,
                    deletions: f.deletions,
                    patch: f.patch?.slice(0, 1000),
                }));
                return JSON.stringify({
                    sha: commit.sha?.slice(0, 12),
                    message: commit.commit?.message,
                    author: commit.commit?.author?.name,
                    date: commit.commit?.author?.date,
                    stats: commit.stats,
                    files_changed: diffFiles.length,
                    files: diffFiles.slice(0, 20),
                });
            }
            case "get_pr_files": {
                if (!owner || !repo || !pullNumber) return JSON.stringify({ error: "owner, repo et pullNumber requis" });
                const prFiles = await githubService.getPullRequestFiles(owner, repo, pullNumber) as any[];
                const summary = prFiles.map((f: any) => ({
                    filename: f.filename,
                    status: f.status,
                    additions: f.additions,
                    deletions: f.deletions,
                    changes: f.changes,
                    patch: f.patch?.slice(0, 800),
                }));
                return JSON.stringify({
                    pullNumber,
                    files_changed: summary.length,
                    total_additions: summary.reduce((s: number, f: any) => s + (f.additions || 0), 0),
                    total_deletions: summary.reduce((s: number, f: any) => s + (f.deletions || 0), 0),
                    files: summary.slice(0, 25),
                });
            }
            case "review_pr": {
                if (!owner || !repo || !pullNumber) return JSON.stringify({ error: "owner, repo et pullNumber requis" });
                const [prInfo, prFilesForReview] = await Promise.all([
                    githubService.getPullRequest(owner, repo, pullNumber),
                    githubService.getPullRequestFiles(owner, repo, pullNumber),
                ]) as any[];
                const prFilesList = Array.isArray(prFilesForReview) ? prFilesForReview : [];
                const totalAdd = prFilesList.reduce((s: number, f: any) => s + (f.additions || 0), 0);
                const totalDel = prFilesList.reduce((s: number, f: any) => s + (f.deletions || 0), 0);
                const { devopsIntelligenceEngine } = await import("../devopsIntelligenceEngine");
                const changes = prFilesList.map((f: any) => ({
                    file: f.filename,
                    linesAdded: f.additions || 0,
                    linesRemoved: f.deletions || 0,
                    changeType: (f.status === "added" ? "create" : f.status === "removed" ? "delete" : "modify") as "create" | "modify" | "delete",
                }));
                const ciRisk = devopsIntelligenceEngine.calculateCIRisk(changes);
                const fileDetails = prFilesList.slice(0, 15).map((f: any) => ({
                    filename: f.filename,
                    status: f.status,
                    additions: f.additions,
                    deletions: f.deletions,
                    patch: f.patch?.slice(0, 1200),
                }));
                return JSON.stringify({
                    pr: {
                        number: (prInfo as any).number,
                        title: (prInfo as any).title,
                        body: (prInfo as any).body?.slice(0, 500),
                        state: (prInfo as any).state,
                        head: (prInfo as any).head?.ref,
                        base: (prInfo as any).base?.ref,
                        author: (prInfo as any).user?.login,
                        created_at: (prInfo as any).created_at,
                    },
                    stats: { files_changed: prFilesList.length, additions: totalAdd, deletions: totalDel },
                    ci_risk: {
                        score: ciRisk.overall,
                        level: ciRisk.riskLevel,
                        warnings: ciRisk.warnings,
                        recommendations: ciRisk.recommendations,
                    },
                    files: fileDetails,
                    review_instructions: "Analyse chaque fichier modifié. Cherche: bugs potentiels, problèmes de sécurité, logique incorrecte, performance, conventions non respectées. Donne un verdict: APPROVE, REQUEST_CHANGES ou COMMENT.",
                });
            }
            case "submit_review": {
                if (!owner || !repo || !pullNumber) return JSON.stringify({ error: "owner, repo et pullNumber requis" });
                const event = (args.verdict || args.event || "COMMENT").toUpperCase();
                if (!["APPROVE", "REQUEST_CHANGES", "COMMENT"].includes(event)) return JSON.stringify({ error: "verdict doit être APPROVE, REQUEST_CHANGES ou COMMENT" });
                const reviewBody = body || message || "Review par Ulysse";
                await githubService.createPullRequestReview(owner, repo, pullNumber, reviewBody, event as any);
                devopsDiscordNotify("Code Review", `PR #${pullNumber} sur **${owner}/${repo}**: ${event}`, event === "APPROVE" ? "success" : event === "REQUEST_CHANGES" ? "error" : "info");
                return JSON.stringify({ success: true, pullNumber, verdict: event, message: `Review soumise: ${event}` });
            }
            case "blame": {
                if (!owner || !repo || !path) return JSON.stringify({ error: "owner, repo et path requis" });
                const blameCommits = await githubService.getBlame(owner, repo, path, branch) as any[];
                const history = (Array.isArray(blameCommits) ? blameCommits : []).slice(0, 15).map((c: any) => ({
                    sha: c.sha?.slice(0, 7),
                    message: c.commit?.message?.split("\n")[0],
                    author: c.commit?.author?.name,
                    date: c.commit?.author?.date,
                }));
                return JSON.stringify({ path, history, total_commits: history.length, hint: "Historique des modifications de ce fichier, du plus récent au plus ancien." });
            }
            case "create_repo": {
                if (!repo) return JSON.stringify({ error: "repo (nom du repo) requis" });
                let newRepo: any;
                let repoAlreadyExisted = false;
                try {
                    newRepo = await githubService.createRepo(repo, { description: body || "", isPrivate: isPrivate || false });
                } catch (createErr: any) {
                    const errMsg = createErr.message || "";
                    if (errMsg.includes("already exists") || errMsg.includes("422")) {
                        repoAlreadyExisted = true;
                        try {
                            newRepo = await githubService.getRepo(owner || "ulyssemdbh-commits", repo);
                        } catch {
                            return JSON.stringify({ error: `Le repo '${repo}' semble exister mais est inaccessible. Vérifier les permissions du token GitHub.`, suggestion: "Utiliser list_repos pour voir les repos accessibles, ou vérifier que le token a le scope 'repo'.", originalError: errMsg });
                        }
                    } else if (errMsg.includes("401") || errMsg.includes("403")) {
                        return JSON.stringify({ error: `Accès refusé pour créer le repo '${repo}'. Token GitHub invalide ou permissions insuffisantes.`, suggestion: "Vérifier la connexion GitHub dans les paramètres du projet. Le token doit avoir le scope 'repo'.", originalError: errMsg });
                    } else {
                        return JSON.stringify({ error: `Erreur lors de la création du repo '${repo}': ${errMsg}`, suggestion: "Vérifier la connexion réseau et le token GitHub." });
                    }
                }
                const repoOwnerLogin = (newRepo as any).owner?.login || owner || "ulyssemdbh-commits";
                if (templateId && templateId !== "empty") {
                    const { getTemplateFiles } = await import("../projectTemplates");
                    const templateFiles = getTemplateFiles(templateId, repo);
                    if (templateFiles.length > 0) {
                        await new Promise(r => setTimeout(r, 1500));
                        try {
                            await githubService.applyPatch(repoOwnerLogin, repo, (newRepo as any).default_branch || "main", templateFiles, `Initial setup with ${templateId} template`);
                        } catch (e: any) {
                            await new Promise(r => setTimeout(r, 2000));
                            try {
                                await githubService.applyPatch(repoOwnerLogin, repo, (newRepo as any).default_branch || "main", templateFiles, `Initial setup with ${templateId} template`);
                            } catch (retryErr: any) {
                                return JSON.stringify({ success: true, repo: (newRepo as any).full_name, html_url: (newRepo as any).html_url, warning: `Repo créé mais échec de l'application du template: ${retryErr.message}`, repoAlreadyExisted });
                            }
                        }
                    }
                }
                devopsDiscordNotify("Repo créé", `**${repo}** ${repoAlreadyExisted ? "(existant)" : "créé avec succès"}`, "success", [
                    { name: "URL", value: (newRepo as any).html_url || '', inline: true },
                    { name: "Privé", value: isPrivate ? "Oui" : "Non", inline: true },
                    ...(templateId && templateId !== "empty" ? [{ name: "Template", value: templateId, inline: true }] : [])
                ]);
                return JSON.stringify({ success: true, repo: (newRepo as any).full_name, html_url: (newRepo as any).html_url, message: repoAlreadyExisted ? `Repo ${repo} existait déjà, réutilisé avec succès` : `Repo ${repo} créé avec succès`, repoAlreadyExisted });
            }
            case "get_deploy_urls": {
                const { devopsDeployUrls: dduGet } = await import("@shared/schema");
                const { eq: eqGet } = await import("drizzle-orm");
                if (owner && repo) {
                    const key = `${owner}/${repo}`;
                    const rows = await db.select().from(dduGet).where(eqGet(dduGet.repoFullName, key));
                    const allRows = await db.select({ repoFullName: dduGet.repoFullName }).from(dduGet);
                    const allRepos = [...new Set(allRows.map(r => r.repoFullName))];
                    return JSON.stringify({ repo: key, urls: rows.map(r => r.url), allRepos });
                }
                const allUrlRows2 = await db.select().from(dduGet);
                const urlData: Record<string, string[]> = {};
                for (const row of allUrlRows2) {
                    if (!urlData[row.repoFullName]) urlData[row.repoFullName] = [];
                    urlData[row.repoFullName].push(row.url);
                }
                return JSON.stringify({ deployUrls: urlData });
            }
            case "set_deploy_urls": {
                if (!owner || !repo) return JSON.stringify({ error: "owner et repo requis" });
                if (!urls || !Array.isArray(urls)) return JSON.stringify({ error: "urls (array) requis" });
                const { devopsDeployUrls: dduSet } = await import("@shared/schema");
                const { eq: eqSet } = await import("drizzle-orm");
                const repoKey = `${owner}/${repo}`;
                const cleanUrls = urls.filter((u: string) => typeof u === "string" && u.trim());
                await db.delete(dduSet).where(eqSet(dduSet.repoFullName, repoKey));
                if (cleanUrls.length > 0) {
                    await db.insert(dduSet).values(cleanUrls.map((url: string) => ({ repoFullName: repoKey, url })));
                }
                return JSON.stringify({ success: true, repo: repoKey, urls: cleanUrls, message: `URLs de déploiement mises à jour pour ${repoKey}` });
            }
            case "dry_run_patch": {
                if (!owner || !repo || !branch || !files) return JSON.stringify({ error: "owner, repo, branch et files requis" });
                const dryRunResult = files.map((f: any) => ({
                    path: f.path,
                    action: "would_update",
                    contentLength: (f.content || "").length,
                    preview: (f.content || "").slice(0, 200) + ((f.content || "").length > 200 ? "..." : ""),
                }));
                return JSON.stringify({ 
                    success: true, 
                    dryRun: true,
                    filesWouldChange: dryRunResult,
                    totalFiles: files.length,
                    branch,
                    message: `Dry run: ${files.length} fichier(s) seraient modifiés sur ${branch}. Utilise apply_patch pour appliquer réellement.`
                });
            }
            case "devops_pipeline": {
                const { devopsPlannerService } = await import("../devopsPlannerService");
                const pipelineTitle = title || message || "Pipeline DevOps";
                const intent = devopsPlannerService.analyzeDevOpsIntent(body || pipelineTitle, 
                    owner && repo ? { owner, repo, branch: branch || "main" } : undefined
                );
                const plan = devopsPlannerService.buildDevOpsPlan(intent, body || pipelineTitle);
                
                if (owner && repo && intent.confidence >= 0.7) {
                    try { plan.ciContext = await devopsPlannerService.enrichWithCIContext(owner, repo); } catch {}
                }
                
                plan.safeguardResults = devopsPlannerService.evaluateSafeguards(intent, plan.ciContext);
                const blocked = plan.safeguardResults.filter(s => !s.passed && s.level === "block");
                
                if (blocked.length > 0) {
                    return JSON.stringify({
                        success: false,
                        blocked: true,
                        safeguards: blocked,
                        message: `Opération bloquée par garde-fou: ${blocked.map(b => b.message).join('; ')}`
                    });
                }
                
                if (args.execute === false || args.planOnly) {
                    return JSON.stringify({
                        success: true,
                        planOnly: true,
                        intent: { ...intent, confidence: Math.round(intent.confidence * 100) + '%' },
                        plan: { ...plan, resolvedFiles: plan.resolvedFiles },
                        ciContext: plan.ciContext,
                        safeguards: plan.safeguardResults,
                        playbook: plan.playbook,
                        message: `Plan DevOps: ${plan.steps.length} étapes (${plan.estimatedComplexity}, confiance: ${Math.round(intent.confidence * 100)}%).${plan.playbook ? ` Playbook: ${plan.playbook}.` : ''} Fichiers détectés: [${plan.resolvedFiles.join(', ')}]. Confirme pour exécuter.`
                    });
                }
                
                const userId = args.userId || 1;
                const result = await devopsPlannerService.executeDevOpsPipeline(userId, pipelineTitle, plan.steps);
                devopsDiscordNotify("Pipeline terminé", `**${pipelineTitle}**`, "success", [
                    { name: "Étapes", value: `${plan.steps.length}`, inline: true },
                    { name: "Complexité", value: plan.estimatedComplexity || '?', inline: true },
                    ...(owner && repo ? [{ name: "Repo", value: `${owner}/${repo}`, inline: true }] : [])
                ]);
                return JSON.stringify({ success: true, ...result, plan });
            }
            case "safeguards": {
                const { devopsPlannerService } = await import("../devopsPlannerService");
                if (args.action === "list") {
                    return JSON.stringify({ success: true, safeguards: devopsPlannerService.getSafeguardConfig() });
                }
                if (args.action === "update" && args.safeguardId) {
                    const updated = devopsPlannerService.updateSafeguard(args.safeguardId, {
                        enabled: args.enabled,
                        level: args.level,
                    });
                    return JSON.stringify({ success: updated, message: updated ? "Garde-fou mis à jour" : "Garde-fou introuvable" });
                }
                return JSON.stringify({ error: "Action invalide. Utilise action='list' ou action='update' avec safeguardId" });
            }
            case "playbooks": {
                const { devopsPlannerService } = await import("../devopsPlannerService");
                const pbOwner = owner || "ulyssemdbh-commits";
                const pbRepo = repo || "";
                const pbBranch = branch || "main";
                return JSON.stringify({
                    success: true,
                    playbooks: devopsPlannerService.getAvailablePlaybooks(pbOwner, pbRepo, pbBranch, args.appName),
                });
            }
            case "pages_status": {
                if (!owner || !repo) return JSON.stringify({ error: "owner et repo requis" });
                try {
                    const pagesInfo = await githubService.getPagesStatus(owner, repo);
                    return JSON.stringify({ success: true, pages: pagesInfo, url: (pagesInfo as any).html_url });
                } catch (e: any) {
                    if (e.message?.includes("404")) return JSON.stringify({ enabled: false, message: "GitHub Pages n'est pas activé sur ce repo" });
                    throw e;
                }
            }
            case "enable_pages": {
                if (!owner || !repo) return JSON.stringify({ error: "owner et repo requis" });
                const pagesBranch = branch || "main";
                const pagesPath = path || "/";
                
                let hasIndex = false;
                try {
                    await githubService.getFileContent(owner, repo, "index.html", pagesBranch);
                    hasIndex = true;
                } catch {}
                
                if (!hasIndex) {
                    const defaultHtml = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${repo}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: linear-gradient(135deg, #0f0c29, #302b63, #24243e); color: #fff; }
    .container { text-align: center; padding: 2rem; }
    h1 { font-size: 2.5rem; margin-bottom: 0.5rem; }
    p { font-size: 1.1rem; opacity: 0.8; margin-top: 0.5rem; }
    .badge { display: inline-block; margin-top: 1rem; padding: 0.4rem 1rem; border: 1px solid rgba(255,255,255,0.3); border-radius: 2rem; font-size: 0.85rem; opacity: 0.7; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${repo}</h1>
    <p>GitHub Pages est actif. Modifie ce fichier pour personnaliser ta page.</p>
    <span class="badge">Deploye via Ulysse DevOps</span>
  </div>
</body>
</html>`;
                    try {
                        await githubService.createOrUpdateFile(owner, repo, "index.html", defaultHtml, "Initial GitHub Pages setup via Ulysse", pagesBranch);
                    } catch (e: any) {
                        console.log(`[DevOps] Could not create index.html: ${e.message}`);
                    }
                }
                
                let result: any;
                let alreadyEnabled = false;
                try {
                    result = await githubService.enablePages(owner, repo, pagesBranch, pagesPath);
                } catch (e: any) {
                    if (e.message?.includes("409") || e.message?.includes("already")) {
                        alreadyEnabled = true;
                        try { result = await githubService.getPagesStatus(owner, repo); } catch { result = {}; }
                    } else {
                        throw e;
                    }
                }
                const url = result?.html_url || `https://${owner}.github.io/${repo}/`;
                const createdFile = !hasIndex ? " Un index.html de base a été créé automatiquement." : "";
                const alreadyMsg = alreadyEnabled ? " (Pages était déjà activé)" : "";
                return JSON.stringify({ success: true, url, source: result?.source, indexCreated: !hasIndex, alreadyEnabled, message: `GitHub Pages activé: ${url}.${createdFile}${alreadyMsg}` });
            }
            case "update_pages": {
                if (!owner || !repo) return JSON.stringify({ error: "owner et repo requis" });
                const updBranch = branch || "main";
                const updPath = path || "/";
                const updResult = await githubService.updatePages(owner, repo, updBranch, updPath);
                return JSON.stringify({ success: true, result: updResult, message: "Configuration GitHub Pages mise à jour" });
            }
            case "disable_pages": {
                if (!owner || !repo) return JSON.stringify({ error: "owner et repo requis" });
                await githubService.disablePages(owner, repo);
                return JSON.stringify({ success: true, message: `GitHub Pages désactivé pour ${owner}/${repo}` });
            }
            case "pages_build": {
                if (!owner || !repo) return JSON.stringify({ error: "owner et repo requis" });
                const buildInfo = await githubService.getPagesBuild(owner, repo);
                return JSON.stringify({ success: true, build: buildInfo });
            }
            case "crawl_preview": {
                const { fetchWebsiteContent } = await import("../webfetch");
                const crawlStartTime = Date.now();
                
                let targetUrls: string[] = [];
                if (url) {
                    targetUrls = [url];
                } else if (owner && repo) {
                    const { devopsDeployUrls: dduCrawl } = await import("@shared/schema");
                    const { eq: eqCrawl } = await import("drizzle-orm");
                    const crawlRows = await db.select().from(dduCrawl).where(eqCrawl(dduCrawl.repoFullName, `${owner}/${repo}`));
                    targetUrls = crawlRows.map(r => r.url);
                    
                    if (targetUrls.length === 0) {
                        try {
                            const repoInfo = await githubService.getRepo(owner, repo);
                            if ((repoInfo as any).homepage) targetUrls.push((repoInfo as any).homepage);
                            if ((repoInfo as any).has_pages) {
                                targetUrls.push(`https://${owner}.github.io/${repo}/`);
                            }
                        } catch {}
                    }
                }
                
                if (targetUrls.length === 0) {
                    return JSON.stringify({ error: "Aucune URL de déploiement trouvée. Fournis url directement ou configure les deploy URLs du repo avec set_deploy_urls." });
                }
                
                const crawlResults = await Promise.all(targetUrls.map(async (crawlUrl) => {
                    try {
                        const httpStart = Date.now();
                        const rawResponse = await fetch(crawlUrl, {
                            method: "HEAD",
                            redirect: "follow",
                            signal: AbortSignal.timeout(10000),
                            headers: { "User-Agent": "Ulysse-DevOps-Monitor/1.0" }
                        }).catch(() => null);
                        const httpTime = Date.now() - httpStart;
                        const httpStatus = rawResponse?.status || 0;
                        const httpOk = rawResponse?.ok || false;
                        const finalUrl = rawResponse?.url || crawlUrl;
                        const contentType = rawResponse?.headers.get("content-type") || "";
                        const serverHeader = rawResponse?.headers.get("server") || "";
                        const cacheControl = rawResponse?.headers.get("cache-control") || "";
                        
                        const fetchResult = await fetchWebsiteContent(crawlUrl, {
                            timeout: 15000,
                            extractStructure: true,
                            maxLength: 8000
                        });
                        
                        const htmlContent = fetchResult.content || "";
                        const titleMatch = htmlContent.match(/<title[^>]*>([^<]*)<\/title>/i);
                        const pageTitle = fetchResult.title || (titleMatch ? titleMatch[1].trim() : "");
                        
                        const h1Count = (htmlContent.match(/<h1[\s>]/gi) || []).length;
                        const h2Count = (htmlContent.match(/<h2[\s>]/gi) || []).length;
                        const imgCount = (htmlContent.match(/<img[\s>]/gi) || []).length;
                        const linkCount = (htmlContent.match(/<a[\s>]/gi) || []).length;
                        const scriptCount = (htmlContent.match(/<script[\s>]/gi) || []).length;
                        const formCount = (htmlContent.match(/<form[\s>]/gi) || []).length;
                        
                        const hasViewport = /<meta[^>]*viewport/i.test(htmlContent);
                        const hasCharset = /<meta[^>]*charset/i.test(htmlContent) || /<meta[^>]*Content-Type/i.test(htmlContent);
                        const hasOgTags = /<meta[^>]*property="og:/i.test(htmlContent);
                        const hasFavicon = /<link[^>]*icon/i.test(htmlContent);
                        const hasManifest = /<link[^>]*manifest/i.test(htmlContent);
                        
                        const jsErrors: string[] = [];
                        if (htmlContent.includes("Cannot read properties of")) jsErrors.push("JS runtime error detected in HTML");
                        if (htmlContent.includes("Uncaught")) jsErrors.push("Uncaught exception in inline script");
                        if (htmlContent.includes("404") && htmlContent.length < 500) jsErrors.push("Possible 404 page");
                        if (htmlContent.includes("500") && htmlContent.includes("Internal Server Error")) jsErrors.push("500 Internal Server Error");
                        if (htmlContent.includes("502 Bad Gateway")) jsErrors.push("502 Bad Gateway");
                        if (htmlContent.includes("503 Service Unavailable")) jsErrors.push("503 Service Unavailable");
                        
                        const brokenResources: string[] = [];
                        const srcMatches = htmlContent.match(/src=["']([^"']+)["']/gi) || [];
                        const hrefMatches = htmlContent.match(/href=["']([^"']+\.(?:css|js))["']/gi) || [];
                        
                        const seoScore = [
                            pageTitle ? 1 : 0,
                            fetchResult.metadata?.description ? 1 : 0,
                            hasOgTags ? 1 : 0,
                            hasViewport ? 1 : 0,
                            hasCharset ? 1 : 0,
                            hasFavicon ? 1 : 0,
                            h1Count === 1 ? 1 : 0,
                            fetchResult.metadata?.canonical ? 1 : 0,
                        ].reduce((a, b) => a + b, 0);
                        
                        const textSnippet = (fetchResult.content || "")
                            .replace(/<[^>]+>/g, " ")
                            .replace(/\s+/g, " ")
                            .trim()
                            .slice(0, 500);
                        
                        return {
                            url: crawlUrl,
                            finalUrl,
                            status: {
                                httpCode: httpStatus,
                                ok: httpOk,
                                responseTimeMs: httpTime,
                                contentType,
                                server: serverHeader,
                                cacheControl,
                            },
                            page: {
                                title: pageTitle,
                                description: fetchResult.metadata?.description || null,
                                language: fetchResult.metadata?.language || null,
                                ogImage: fetchResult.metadata?.ogImage || null,
                            },
                            structure: {
                                h1Count,
                                h2Count,
                                imgCount,
                                linkCount,
                                scriptCount,
                                formCount,
                                totalResources: srcMatches.length + hrefMatches.length,
                            },
                            seo: {
                                score: `${seoScore}/8`,
                                hasViewport,
                                hasCharset,
                                hasOgTags,
                                hasFavicon,
                                hasManifest,
                                hasCanonical: !!fetchResult.metadata?.canonical,
                                hasSingleH1: h1Count === 1,
                            },
                            health: {
                                errors: jsErrors,
                                errorCount: jsErrors.length,
                                contentLength: htmlContent.length,
                                isEmptyPage: htmlContent.length < 100,
                                isSPA: /id="(root|app|__next)"/.test(htmlContent) || scriptCount > 3,
                            },
                            textPreview: textSnippet.slice(0, 300) + (textSnippet.length > 300 ? "..." : ""),
                        };
                    } catch (crawlErr: any) {
                        return {
                            url: crawlUrl,
                            error: crawlErr.message,
                            status: { httpCode: 0, ok: false, responseTimeMs: 0 },
                        };
                    }
                }));
                
                const totalTime = Date.now() - crawlStartTime;
                return JSON.stringify({
                    success: true,
                    repo: owner && repo ? `${owner}/${repo}` : undefined,
                    crawledAt: new Date().toISOString(),
                    totalTimeMs: totalTime,
                    urlsMonitored: crawlResults.length,
                    results: crawlResults,
                });
            }
            case "analyze_preview": {
                const { captureScreenshot, analyzeWithVision } = await import("../scraper/screenshot");
                const { visionHub } = await import("../sensory/VisionHub");
                const analyzeStartTime = Date.now();

                let analyzeUrls: string[] = [];
                if (url) {
                    analyzeUrls = [url];
                } else if (owner && repo) {
                    const { devopsDeployUrls: dduAnalyze } = await import("@shared/schema");
                    const { eq: eqAnalyze } = await import("drizzle-orm");
                    const analyzeRows = await db.select().from(dduAnalyze).where(eqAnalyze(dduAnalyze.repoFullName, `${owner}/${repo}`));
                    analyzeUrls = analyzeRows.map(r => r.url);
                    if (analyzeUrls.length === 0) {
                        try {
                            const repoInfo = await githubService.getRepo(owner, repo);
                            if ((repoInfo as any).homepage) analyzeUrls.push((repoInfo as any).homepage);
                            if ((repoInfo as any).has_pages) analyzeUrls.push(`https://${owner}.github.io/${repo}/`);
                        } catch {}
                    }
                }

                if (analyzeUrls.length === 0) {
                    return JSON.stringify({ error: "Aucune URL trouvée. Fournis url directement ou configure les deploy URLs." });
                }

                const designPrompt = args.prompt || "Analyse le DESIGN VISUEL de cette page web en détail. Évalue: 1) Esthétique générale (harmonie des couleurs, cohérence visuelle), 2) Layout et composition (disposition des éléments, alignement, espacement), 3) Typographie (lisibilité, hiérarchie, choix de polices), 4) UI/UX (navigation, accessibilité, responsive design), 5) Points forts et points faibles du design, 6) Suggestions d'amélioration concrètes. Donne une note sur 10 pour chaque critère.";

                const analyzeResults = await Promise.all(analyzeUrls.slice(0, 3).map(async (targetUrl) => {
                    try {
                        const screenshotResult = await captureScreenshot(targetUrl, {
                            fullPage: false,
                            waitMs: 4000,
                            viewport: { width: 1920, height: 1080 }
                        });

                        if (!screenshotResult.success || !screenshotResult.imageBase64) {
                            return { url: targetUrl, error: "Screenshot échoué: " + (screenshotResult.error || "inconnu") };
                        }

                        const visionResult = await analyzeWithVision(screenshotResult.imageBase64, {
                            prompt: designPrompt,
                            maxTokens: 3000
                        });

                        try {
                            await visionHub.seeScreenshot(screenshotResult.imageBase64, targetUrl, 1, visionResult.analysis);
                        } catch {}

                        return {
                            url: targetUrl,
                            success: true,
                            designAnalysis: visionResult.analysis || "Analyse non disponible",
                            screenshotSize: Math.round((screenshotResult.imageBase64.length * 3) / 4 / 1024) + "KB",
                            analyzedAt: new Date().toISOString()
                        };
                    } catch (err: any) {
                        return { url: targetUrl, error: err.message };
                    }
                }));

                return JSON.stringify({
                    success: true,
                    action: "analyze_preview",
                    repo: owner && repo ? `${owner}/${repo}` : undefined,
                    totalTimeMs: Date.now() - analyzeStartTime,
                    results: analyzeResults
                });
            }
            case "design_dashboard": {
                const { generateImage } = await import("../imageGenerationService");
                const projectName = args.project_name || args.projectName || repo || "Dashboard";
                const dashboardType = args.dashboard_type || args.type || "analytics";
                const colorScheme = args.color_scheme || args.colors || "modern dark with blue/purple accents";
                const features = args.features || [];
                const style = args.style || "modern";

                const featuresList = Array.isArray(features) && features.length > 0
                    ? `\nKey sections/widgets: ${features.join(", ")}`
                    : "";

                const dashboardPrompt = `Professional ${dashboardType} dashboard UI design for "${projectName}". 
Clean, modern web application dashboard with:
- Sidebar navigation on the left
- Top header bar with search and user avatar
- Main content area with data visualization cards and charts
- Color scheme: ${colorScheme}
- Style: ${style}, professional, high-fidelity UI mockup
- Includes: stat cards with numbers, line/bar charts, progress indicators, recent activity list, KPI widgets${featuresList}
- Typography: clean sans-serif, clear hierarchy
- Realistic data in the charts and tables
- Desktop resolution, pixel-perfect rendering
This is a UI/UX design mockup for a web developer to implement. Make it look like a real production dashboard screenshot.`;

                const result = await generateImage({
                    prompt: dashboardPrompt,
                    style: "photorealistic",
                    size: "1536x1024",
                    enhancePrompt: false,
                    userId: 1,
                    retryOnFail: true,
                });

                if (!result.success) {
                    return JSON.stringify({ error: `Génération échouée: ${result.error}`, action: "design_dashboard" });
                }

                return JSON.stringify({
                    action: "design_dashboard",
                    success: true,
                    project: projectName,
                    dashboardType,
                    colorScheme,
                    style,
                    imageUrl: result.url,
                    fileName: result.fileName,
                    storagePath: result.storagePath,
                    generationTimeMs: result.generationTimeMs,
                    usage: "Utilise cette image comme référence visuelle pour coder le dashboard. Analyse les couleurs, la disposition, les composants, et reproduis-les en code (React + Tailwind + shadcn/ui).",
                });
            }

            case "list_issues": {
                const state = args.state || "open";
                const labels = args.labels;
                const issues = await githubService.listIssues(owner, repo, state, labels, limit || 30);
                return JSON.stringify({
                    action: "list_issues",
                    repo: `${owner}/${repo}`,
                    state,
                    count: issues.length,
                    issues: issues.map((i: any) => ({
                        number: i.number,
                        title: i.title,
                        state: i.state,
                        labels: i.labels?.map((l: any) => l.name) || [],
                        assignees: i.assignees?.map((a: any) => a.login) || [],
                        created_at: i.created_at,
                        updated_at: i.updated_at,
                        comments: i.comments,
                        body_preview: i.body?.slice(0, 200) || "",
                    })),
                });
            }

            case "get_issue": {
                const issueNum = args.issue_number || args.number;
                if (!issueNum) return JSON.stringify({ error: "issue_number requis" });
                const issue = await githubService.getIssue(owner, repo, issueNum);
                return JSON.stringify({
                    action: "get_issue",
                    number: issue.number,
                    title: issue.title,
                    state: issue.state,
                    body: issue.body || "",
                    labels: issue.labels?.map((l: any) => l.name) || [],
                    assignees: issue.assignees?.map((a: any) => a.login) || [],
                    created_at: issue.created_at,
                    updated_at: issue.updated_at,
                    comments: issue.comments,
                    user: issue.user?.login,
                });
            }

            case "create_issue": {
                const title = args.title;
                if (!title) return JSON.stringify({ error: "title requis" });
                const issue = await githubService.createIssue(owner, repo, title, args.body, args.labels, args.assignees);
                return JSON.stringify({
                    action: "create_issue",
                    success: true,
                    number: issue.number,
                    title: issue.title,
                    url: issue.html_url,
                });
            }

            case "update_issue": {
                const issueNum2 = args.issue_number || args.number;
                if (!issueNum2) return JSON.stringify({ error: "issue_number requis" });
                const updates: any = {};
                if (args.title) updates.title = args.title;
                if (args.body) updates.body = args.body;
                if (args.state) updates.state = args.state;
                if (args.labels) updates.labels = args.labels;
                if (args.assignees) updates.assignees = args.assignees;
                const updated = await githubService.updateIssue(owner, repo, issueNum2, updates);
                return JSON.stringify({
                    action: "update_issue",
                    success: true,
                    number: updated.number,
                    title: updated.title,
                    state: updated.state,
                });
            }

            case "add_issue_comment": {
                const issueNum3 = args.issue_number || args.number;
                if (!issueNum3) return JSON.stringify({ error: "issue_number requis" });
                if (!args.body && !args.comment) return JSON.stringify({ error: "body ou comment requis" });
                const comment = await githubService.addIssueComment(owner, repo, issueNum3, args.body || args.comment);
                return JSON.stringify({
                    action: "add_issue_comment",
                    success: true,
                    issue_number: issueNum3,
                    comment_id: comment.id,
                    url: comment.html_url,
                });
            }

            case "list_releases": {
                const releases = await githubService.listReleases(owner, repo, limit || 10);
                return JSON.stringify({
                    action: "list_releases",
                    repo: `${owner}/${repo}`,
                    count: releases.length,
                    releases: releases.map((r: any) => ({
                        id: r.id,
                        tag_name: r.tag_name,
                        name: r.name,
                        draft: r.draft,
                        prerelease: r.prerelease,
                        created_at: r.created_at,
                        published_at: r.published_at,
                        body_preview: r.body?.slice(0, 200) || "",
                    })),
                });
            }

            case "create_release": {
                if (!args.tag_name) return JSON.stringify({ error: "tag_name requis" });
                const release = await githubService.createRelease(
                    owner, repo, args.tag_name, args.name || args.tag_name,
                    args.body, args.draft, args.prerelease
                );
                return JSON.stringify({
                    action: "create_release",
                    success: true,
                    id: release.id,
                    tag_name: release.tag_name,
                    name: release.name,
                    url: release.html_url,
                });
            }

            case "list_tags": {
                const tags = await githubService.listTags(owner, repo, limit || 30);
                return JSON.stringify({
                    action: "list_tags",
                    repo: `${owner}/${repo}`,
                    count: tags.length,
                    tags: tags.map((t: any) => ({
                        name: t.name,
                        sha: t.commit?.sha?.slice(0, 7),
                    })),
                });
            }

            case "create_tag": {
                if (!args.tag || !args.sha) return JSON.stringify({ error: "tag et sha requis" });
                const tag = await githubService.createTag(owner, repo, args.tag, args.sha, args.message);
                return JSON.stringify({
                    action: "create_tag",
                    success: true,
                    tag: args.tag,
                    sha: tag.sha,
                });
            }

            case "delete_repo": {
                if (!owner || !repo) return JSON.stringify({ error: "owner et repo requis" });
                const result = await githubService.deleteRepo(owner, repo);
                devopsDiscordNotify("Repo supprimé", `**${owner}/${repo}** supprimé définitivement`, "warning");
                return JSON.stringify({ action: "delete_repo", success: true, repo: `${owner}/${repo}` });
            }

            case "diff_preview": {
                if (!owner || !repo) return JSON.stringify({ error: "owner et repo requis" });
                const diffFiles = args.files || [];
                if (!diffFiles.length) return JSON.stringify({ error: "files requis — [{path, content}] pour prévisualiser les changements" });
                const diffResults: any[] = [];
                for (const file of diffFiles) {
                    try {
                        const existing = await githubService.getFileContent(owner, repo, file.path, branch || "main");
                        const oldContent = existing?.content ? Buffer.from(existing.content, "base64").toString("utf-8") : "";
                        const oldLines = oldContent.split("\n");
                        const newLines = (file.content || "").split("\n");
                        const additions = newLines.filter((line: string, i: number) => i >= oldLines.length || line !== oldLines[i]).length;
                        const deletions = oldLines.filter((line: string, i: number) => i >= newLines.length || line !== newLines[i]).length;
                        const unchanged = oldLines.filter((line: string, i: number) => i < newLines.length && line === newLines[i]).length;
                        const diffChunks: string[] = [];
                        const maxContext = 3;
                        let chunkStart = -1;
                        for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
                            const oldLine = i < oldLines.length ? oldLines[i] : undefined;
                            const newLine = i < newLines.length ? newLines[i] : undefined;
                            if (oldLine !== newLine) {
                                if (chunkStart < 0) chunkStart = Math.max(0, i - maxContext);
                                if (oldLine !== undefined && oldLine !== newLine) diffChunks.push(`- ${oldLine}`);
                                if (newLine !== undefined && oldLine !== newLine) diffChunks.push(`+ ${newLine}`);
                            } else if (chunkStart >= 0 && diffChunks.length > 0) {
                                diffChunks.push(`  ${oldLine}`);
                                if (diffChunks.filter(l => l.startsWith("  ")).length >= maxContext) {
                                    chunkStart = -1;
                                }
                            }
                        }
                        diffResults.push({
                            path: file.path,
                            status: "modified",
                            oldLines: oldLines.length,
                            newLines: newLines.length,
                            additions,
                            deletions,
                            unchanged,
                            diff: diffChunks.slice(0, 60).join("\n") + (diffChunks.length > 60 ? `\n... +${diffChunks.length - 60} more lines` : ""),
                        });
                    } catch {
                        const newLines = (file.content || "").split("\n");
                        diffResults.push({
                            path: file.path,
                            status: "new_file",
                            oldLines: 0,
                            newLines: newLines.length,
                            additions: newLines.length,
                            deletions: 0,
                            diff: newLines.slice(0, 20).map((l: string) => `+ ${l}`).join("\n") + (newLines.length > 20 ? `\n... +${newLines.length - 20} more lines` : ""),
                        });
                    }
                }
                const totalAdd = diffResults.reduce((s, d) => s + d.additions, 0);
                const totalDel = diffResults.reduce((s, d) => s + d.deletions, 0);
                return JSON.stringify({
                    action: "diff_preview",
                    files: diffResults,
                    summary: `${diffResults.length} fichier(s) — +${totalAdd} / -${totalDel} lignes`,
                    newFiles: diffResults.filter(d => d.status === "new_file").length,
                    modifiedFiles: diffResults.filter(d => d.status === "modified").length,
                    hint: "Vérifie les changements ci-dessus. Si OK, utilise apply_patch pour les appliquer.",
                });
            }

            case "analyze_repo": {
                if (!owner || !repo) return JSON.stringify({ error: "owner et repo requis" });
                const analyzeRepoStart = Date.now();
                const targetPath = args.path || "";
                const depth = args.depth || "standard";
                const focusOn = args.focus || "";

                try {
                    const repoInfo = await githubService.getRepo(owner, repo);
                    const defaultBranchRepo = (repoInfo as any).default_branch || "main";
                    const targetBranch = branch || defaultBranchRepo;
                    const tree = await githubService.getTree(owner, repo, targetBranch);
                    const allTreeItems = ((tree as any).tree || []).map((t: any) => ({
                        path: t.path, type: t.type, size: t.size, sha: t.sha
                    }));

                    const codeExts = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".py", ".css", ".html", ".vue", ".svelte", ".go", ".rs", ".java", ".rb", ".php", ".sh", ".yml", ".yaml", ".sql", ".md"]);
                    const skipDirs = new Set(["node_modules", ".git", "dist", "build", ".next", ".cache", "coverage", "__pycache__", ".turbo", "attached_assets", ".canvas"]);

                    let codeFiles = allTreeItems.filter((f: any) => {
                        if (f.type !== "blob") return false;
                        const ext = "." + (f.path.split(".").pop() || "");
                        if (!codeExts.has(ext)) return false;
                        const firstDir = f.path.split("/")[0];
                        if (skipDirs.has(firstDir)) return false;
                        if (targetPath) {
                            const prefix = targetPath.endsWith("/") ? targetPath : targetPath + "/";
                            if (!f.path.startsWith(prefix) && f.path !== targetPath) return false;
                        }
                        if (focusOn) {
                            const focusLower = focusOn.toLowerCase();
                            if (!f.path.toLowerCase().includes(focusLower)) return false;
                        }
                        return true;
                    });

                    const maxFiles = depth === "deep" ? codeFiles.length : depth === "light" ? 20 : 50;
                    codeFiles.sort((a: any, b: any) => {
                        const extPriority: Record<string, number> = { ".ts": 0, ".tsx": 1, ".js": 2, ".jsx": 3, ".py": 4, ".vue": 5, ".go": 6 };
                        const aExt = "." + (a.path.split(".").pop() || "");
                        const bExt = "." + (b.path.split(".").pop() || "");
                        const aPri = extPriority[aExt] ?? 10;
                        const bPri = extPriority[bExt] ?? 10;
                        if (aPri !== bPri) return aPri - bPri;
                        const aDepth = a.path.split("/").length;
                        const bDepth = b.path.split("/").length;
                        if (aDepth !== bDepth) return aDepth - bDepth;
                        return a.path.localeCompare(b.path);
                    });

                    const filesToRead = codeFiles.slice(0, maxFiles);
                    const skippedCount = codeFiles.length - filesToRead.length;

                    const BATCH_SIZE = depth === "deep" ? 30 : 10;
                    const fileAnalyses: any[] = [];
                    const importGraph: Record<string, string[]> = {};
                    const exportMap: Record<string, string[]> = {};

                    for (let i = 0; i < filesToRead.length; i += BATCH_SIZE) {
                        const batch = filesToRead.slice(i, i + BATCH_SIZE);
                        const results = await Promise.all(batch.map(async (f: any) => {
                            try {
                                const fileData = await githubService.getFileContent(owner, repo, f.path, targetBranch);
                                if (!(fileData as any).content) return { path: f.path, error: "no content" };
                                const content = Buffer.from((fileData as any).content, "base64").toString("utf-8");
                                const lines = content.split("\n");
                                const lineCount = lines.length;

                                const imports: string[] = [];
                                const exports: string[] = [];
                                const functions: string[] = [];
                                const classes: string[] = [];
                                const types: string[] = [];

                                for (const line of lines) {
                                    const trimmed = line.trim();
                                    const importMatch = trimmed.match(/^import\s+.*?from\s+['"](.*?)['"]/);
                                    if (importMatch) imports.push(importMatch[1]);
                                    else if (trimmed.match(/^const\s+.*?=\s*require\(['"](.*?)['"]\)/)) {
                                        const m = trimmed.match(/require\(['"](.*?)['"]\)/);
                                        if (m) imports.push(m[1]);
                                    }

                                    if (trimmed.startsWith("export default")) exports.push("default");
                                    else if (trimmed.match(/^export\s+(async\s+)?function\s+(\w+)/)) {
                                        const m = trimmed.match(/^export\s+(async\s+)?function\s+(\w+)/);
                                        if (m) { exports.push(m[2]); functions.push(m[2]); }
                                    } else if (trimmed.match(/^export\s+(const|let|var)\s+(\w+)/)) {
                                        const m = trimmed.match(/^export\s+(const|let|var)\s+(\w+)/);
                                        if (m) exports.push(m[2]);
                                    } else if (trimmed.match(/^export\s+(class|interface|type|enum)\s+(\w+)/)) {
                                        const m = trimmed.match(/^export\s+(class|interface|type|enum)\s+(\w+)/);
                                        if (m) { exports.push(m[2]); if (m[1] === "class") classes.push(m[2]); else types.push(m[2]); }
                                    }

                                    if (!trimmed.startsWith("export")) {
                                        const fnMatch = trimmed.match(/^(?:async\s+)?function\s+(\w+)/);
                                        if (fnMatch) functions.push(fnMatch[1]);
                                        const classMatch = trimmed.match(/^class\s+(\w+)/);
                                        if (classMatch) classes.push(classMatch[1]);
                                    }
                                }

                                const localImports = imports.filter(i => i.startsWith(".") || i.startsWith("@/") || i.startsWith("@shared"));
                                const externalDeps = imports.filter(i => !i.startsWith(".") && !i.startsWith("@/") && !i.startsWith("@shared"));
                                importGraph[f.path] = localImports;
                                exportMap[f.path] = exports;

                                const firstComment = lines.slice(0, 10).find(l => l.trim().startsWith("//") || l.trim().startsWith("/*") || l.trim().startsWith("*"));

                                return {
                                    path: f.path,
                                    lines: lineCount,
                                    size: f.size,
                                    exports: exports.slice(0, 20),
                                    functions: functions.slice(0, 15),
                                    classes: classes.slice(0, 10),
                                    types: types.slice(0, 10),
                                    localImports: localImports.slice(0, 15),
                                    externalDeps: [...new Set(externalDeps)].slice(0, 10),
                                    firstComment: firstComment?.trim().slice(0, 100) || null,
                                    preview: lines.slice(0, 5).join("\n").slice(0, 300)
                                };
                            } catch (err: any) {
                                return { path: f.path, error: err.message || "read failed" };
                            }
                        }));
                        fileAnalyses.push(...results);
                    }

                    const dirStats: Record<string, { files: number; totalLines: number; totalSize: number; extensions: Record<string, number> }> = {};
                    for (const fa of fileAnalyses) {
                        if (fa.error) continue;
                        const dir = fa.path.includes("/") ? fa.path.split("/").slice(0, -1).join("/") : "/";
                        if (!dirStats[dir]) dirStats[dir] = { files: 0, totalLines: 0, totalSize: 0, extensions: {} };
                        dirStats[dir].files++;
                        dirStats[dir].totalLines += fa.lines || 0;
                        dirStats[dir].totalSize += fa.size || 0;
                        const ext = "." + (fa.path.split(".").pop() || "");
                        dirStats[dir].extensions[ext] = (dirStats[dir].extensions[ext] || 0) + 1;
                    }

                    const tsCount = allTreeItems.filter((f: any) => f.path.endsWith(".ts") || f.path.endsWith(".tsx")).length;
                    const jsCount = allTreeItems.filter((f: any) => f.path.endsWith(".js") || f.path.endsWith(".jsx")).length;
                    const pyCount = allTreeItems.filter((f: any) => f.path.endsWith(".py")).length;
                    const primaryLang = tsCount >= jsCount && tsCount >= pyCount ? "TypeScript" : jsCount > pyCount ? "JavaScript" : pyCount > 0 ? "Python" : "Mixed";

                    const totalLines = fileAnalyses.reduce((s, f) => s + (f.lines || 0), 0);
                    const successFiles = fileAnalyses.filter(f => !f.error);

                    const entryPoints = successFiles.filter(f =>
                        f.path.match(/index\.(ts|tsx|js|jsx)$/) ||
                        f.path.match(/main\.(ts|tsx|js|jsx)$/) ||
                        f.path.match(/app\.(ts|tsx|js|jsx)$/i) ||
                        f.path.match(/server\.(ts|js)$/) ||
                        f.path === "package.json"
                    );

                    const heavyFiles = successFiles
                        .filter(f => f.lines > 200)
                        .sort((a, b) => b.lines - a.lines)
                        .slice(0, 10)
                        .map(f => ({ path: f.path, lines: f.lines }));

                    const allExternalDeps = new Set<string>();
                    for (const f of successFiles) {
                        (f.externalDeps || []).forEach((d: string) => allExternalDeps.add(d.split("/").slice(0, d.startsWith("@") ? 2 : 1).join("/")));
                    }

                    const mostConnected = successFiles
                        .map(f => ({ path: f.path, connections: (f.localImports?.length || 0) + (f.exports?.length || 0) }))
                        .sort((a, b) => b.connections - a.connections)
                        .slice(0, 10);

                    let aiSummary = "";
                    if (depth !== "light") {
                        try {
                            const openai = getOpenAI();
                            const filesContext = successFiles.slice(0, 60).map(f =>
                                `📄 ${f.path} (${f.lines}L) exports:[${(f.exports || []).slice(0, 5).join(",")}] imports:[${(f.localImports || []).slice(0, 5).join(",")}]${f.firstComment ? ` — ${f.firstComment}` : ""}`
                            ).join("\n");

                            const aiRes = await openai.chat.completions.create({
                                model: "gpt-4o-mini",
                                messages: [{
                                    role: "system",
                                    content: "Tu es un architecte logiciel senior. Analyse la structure du repo et produis un résumé technique concis en français. Max 500 mots."
                                }, {
                                    role: "user",
                                    content: `Repo: ${owner}/${repo} (${primaryLang}, ${totalLines} lignes, ${successFiles.length} fichiers)
                                    
Directories: ${Object.entries(dirStats).map(([d, s]) => `${d}: ${s.files} files, ${s.totalLines} lines`).join("; ")}

Files:\n${filesContext}

External deps: ${[...allExternalDeps].slice(0, 20).join(", ")}

Résume: 1) But du projet, 2) Architecture (patterns, stack), 3) Fichiers clés et leur rôle, 4) Dépendances notables, 5) Points d'attention (dette technique, complexité).`
                                }],
                                max_tokens: 1000,
                                temperature: 0.3
                            });
                            aiSummary = aiRes.choices?.[0]?.message?.content || "";
                        } catch (aiErr: any) {
                            aiSummary = `[AI summary failed: ${aiErr.message}]`;
                        }
                    }

                    return JSON.stringify({
                        action: "analyze_repo",
                        repo: `${owner}/${repo}`,
                        branch: targetBranch,
                        path: targetPath || "/",
                        depth,
                        timing: `${Date.now() - analyzeRepoStart}ms`,
                        overview: {
                            primaryLanguage: primaryLang,
                            totalFiles: allTreeItems.length,
                            codeFiles: codeFiles.length,
                            analyzedFiles: successFiles.length,
                            skippedFiles: skippedCount,
                            totalLinesAnalyzed: totalLines,
                            languageBreakdown: { ts: tsCount, js: jsCount, py: pyCount }
                        },
                        architecture: {
                            entryPoints: entryPoints.map(f => f.path),
                            directoryStats: Object.fromEntries(
                                Object.entries(dirStats)
                                    .sort(([, a], [, b]) => b.totalLines - a.totalLines)
                                    .slice(0, 15)
                            ),
                            heavyFiles,
                            mostConnected,
                            externalDependencies: [...allExternalDeps].sort().slice(0, 30)
                        },
                        files: fileAnalyses.map(f => f.error
                            ? { path: f.path, error: f.error }
                            : {
                                path: f.path,
                                lines: f.lines,
                                exports: f.exports,
                                functions: f.functions?.slice(0, 10),
                                classes: f.classes,
                                types: f.types,
                                localImports: f.localImports,
                                externalDeps: f.externalDeps,
                                preview: depth === "deep" ? f.preview : undefined
                            }
                        ),
                        importGraph: depth === "deep" ? importGraph : undefined,
                        aiSummary: aiSummary || undefined,
                        hint: skippedCount > 0 ? `${skippedCount} fichiers non analysés. Utilise depth='deep' ou path='sous-dossier' pour cibler.` : undefined
                    });
                } catch (err: any) {
                    return JSON.stringify({ error: `analyze_repo failed: ${err.message}`, hint: "Vérifie owner/repo et les permissions." });
                }
            }
            case "check_syntax": {
                if (!owner || !repo) return JSON.stringify({ error: "owner et repo requis" });
                const syntaxPaths: string[] = args.files?.map((f: any) => f.path || f) || (filePath ? [filePath] : []);
                if (syntaxPaths.length === 0) return JSON.stringify({ error: "Spécifie path ou files[{path}] pour les fichiers à vérifier" });

                const syntaxBranch = branch || "main";
                const syntaxResults: any[] = [];

                const checkBatch = syntaxPaths.slice(0, 20);
                await Promise.all(checkBatch.map(async (fp: string) => {
                    try {
                        const fileData = await githubService.getFileContent(owner, repo, fp, syntaxBranch);
                        if (!(fileData as any).content) {
                            syntaxResults.push({ path: fp, status: "error", error: "Fichier vide ou inaccessible" });
                            return;
                        }
                        const content = Buffer.from((fileData as any).content, "base64").toString("utf-8");
                        const lines = content.split("\n");
                        const issues: { line: number; type: string; message: string; severity: string }[] = [];

                        const ext = fp.split(".").pop()?.toLowerCase() || "";
                        const isTsJs = ["ts", "tsx", "js", "jsx"].includes(ext);

                        if (isTsJs) {
                            let braceCount = 0, parenCount = 0, bracketCount = 0;
                            const importSources: string[] = [];
                            const declaredVars = new Set<string>();
                            const usedIdentifiers = new Set<string>();
                            let inBlockComment = false;

                            for (let i = 0; i < lines.length; i++) {
                                const line = lines[i];
                                const trimmed = line.trim();
                                const lineNum = i + 1;

                                if (inBlockComment) {
                                    if (trimmed.includes("*/")) inBlockComment = false;
                                    continue;
                                }
                                if (trimmed.startsWith("/*")) {
                                    if (!trimmed.includes("*/")) inBlockComment = true;
                                    continue;
                                }
                                if (trimmed.startsWith("//")) continue;

                                for (const ch of line) {
                                    if (ch === '{') braceCount++;
                                    else if (ch === '}') braceCount--;
                                    else if (ch === '(') parenCount++;
                                    else if (ch === ')') parenCount--;
                                    else if (ch === '[') bracketCount++;
                                    else if (ch === ']') bracketCount--;
                                }

                                if (braceCount < 0) issues.push({ line: lineNum, type: "bracket_mismatch", message: "Accolade fermante en trop", severity: "error" });
                                if (parenCount < 0) issues.push({ line: lineNum, type: "paren_mismatch", message: "Parenthèse fermante en trop", severity: "error" });

                                const importMatch = trimmed.match(/^import\s+.*?from\s+['"](.*?)['"]/);
                                if (importMatch) importSources.push(importMatch[1]);

                                const varMatch = trimmed.match(/^(?:export\s+)?(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/);
                                if (varMatch) declaredVars.add(varMatch[1]);

                                if (trimmed.match(/console\.(log|warn|error|debug)\s*\(/)) {
                                    issues.push({ line: lineNum, type: "console_statement", message: `console.${trimmed.match(/console\.(\w+)/)?.[1]} trouvé`, severity: "warning" });
                                }

                                if (trimmed.match(/\bany\b/) && ext === "ts" || ext === "tsx") {
                                    if (trimmed.match(/:\s*any\b/) || trimmed.match(/<any>/)) {
                                        issues.push({ line: lineNum, type: "any_type", message: "Utilisation de type 'any'", severity: "info" });
                                    }
                                }

                                if (trimmed.match(/TODO|FIXME|HACK|XXX/i)) {
                                    const tag = trimmed.match(/(TODO|FIXME|HACK|XXX)/i)?.[1];
                                    issues.push({ line: lineNum, type: "todo", message: `${tag} trouvé: ${trimmed.slice(0, 80)}`, severity: "info" });
                                }
                            }

                            if (braceCount !== 0) issues.push({ line: lines.length, type: "bracket_mismatch", message: `Accolades non équilibrées: ${braceCount > 0 ? braceCount + " ouvertes en trop" : Math.abs(braceCount) + " fermées en trop"}`, severity: "error" });
                            if (parenCount !== 0) issues.push({ line: lines.length, type: "paren_mismatch", message: `Parenthèses non équilibrées: ${parenCount > 0 ? parenCount + " ouvertes en trop" : Math.abs(parenCount) + " fermées en trop"}`, severity: "error" });
                            if (bracketCount !== 0) issues.push({ line: lines.length, type: "bracket_mismatch", message: `Crochets non équilibrés: ${bracketCount > 0 ? bracketCount + " ouverts en trop" : Math.abs(bracketCount) + " fermés en trop"}`, severity: "error" });

                            const localImports = importSources.filter(s => s.startsWith(".") || s.startsWith("@/") || s.startsWith("@shared"));
                            const externalImports = importSources.filter(s => !s.startsWith(".") && !s.startsWith("@"));

                            syntaxResults.push({
                                path: fp,
                                status: issues.filter(i => i.severity === "error").length > 0 ? "errors_found" : "ok",
                                lines: lines.length,
                                errors: issues.filter(i => i.severity === "error"),
                                warnings: issues.filter(i => i.severity === "warning"),
                                info: issues.filter(i => i.severity === "info"),
                                imports: { local: localImports, external: externalImports, total: importSources.length },
                                declarations: [...declaredVars].slice(0, 30),
                            });
                        } else {
                            syntaxResults.push({ path: fp, status: "ok", lines: lines.length, note: `Extension .${ext} — vérification basique uniquement` });
                        }
                    } catch (err: any) {
                        syntaxResults.push({ path: fp, status: "error", error: err.message });
                    }
                }));

                const errors = syntaxResults.filter(r => r.status === "errors_found" || r.status === "error");
                return JSON.stringify({
                    action: "check_syntax",
                    repo: `${owner}/${repo}`,
                    branch: syntaxBranch,
                    filesChecked: syntaxResults.length,
                    filesWithErrors: errors.length,
                    results: syntaxResults,
                });
            }
            case "list_org_repos": {
                const org = args.org || owner;
                const orgRepos = await githubService.listOrgRepos(org, { per_page: limit || 30 });
                return JSON.stringify({
                    action: "list_org_repos",
                    org,
                    count: orgRepos.length,
                    repos: orgRepos.map((r: any) => ({
                        name: r.name,
                        full_name: r.full_name,
                        private: r.private,
                        language: r.language,
                        updated_at: r.updated_at,
                    })),
                });
            }

            default:
                return JSON.stringify({ error: `Action DevOps inconnue: ${action}. Actions disponibles: list_repos, repo_info, create_repo, delete_repo, list_branches, delete_branch, list_commits, list_prs, create_branch, create_pr, merge_pr, get_file, update_file, delete_file, apply_patch, browse_files, search_code, analyze_repo, list_workflows, list_workflow_runs, trigger_workflow, rerun_workflow, cancel_workflow, get_deploy_urls, set_deploy_urls, pages_status, enable_pages, update_pages, disable_pages, pages_build, dry_run_patch, devops_pipeline, crawl_preview, analyze_preview, list_issues, get_issue, create_issue, update_issue, add_issue_comment, list_releases, create_release, list_tags, create_tag, compare_branches, blame, get_commit_diff, review_pr, submit_review, list_org_repos` });
        }
        };

        if (projectToken) {
            console.log(`[DevOpsGitHub] Using project/tenant token for ${action} on ${owner}/${repo}`);
            return withGitHubToken(projectToken, executeAction);
        }
        console.log(`[DevOpsGitHub] Using global token for ${action} on ${owner}/${repo} (no project/tenant token found, projectId=${args.projectId || 'none'})`);
        return executeAction();
    } catch (error: any) {
        console.error(`[DevOpsGitHub] Action ${action} failed on ${owner}/${repo}: ${error.statusCode || 'unknown'} - ${error.message}`);
        const structured = error.structured || null;
        const statusCode = error.statusCode || null;
        return JSON.stringify({
            error: structured ? structured.code : `DevOps error: ${error.message}`,
            message: error.githubMessage || error.message,
            statusCode,
            ...(structured ? { 
                errorCode: structured.code,
                details: structured.details,
                suggestion: structured.suggestion,
                recoveryHint: structured.suggestion,
            } : {}),
        });
    }
}

export async function executeSuguvalQuery(args: { restaurant: string; action: string; limit?: number }): Promise<string> {
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

export async function executeSuguBankManagement(args: Record<string, any>): Promise<string> {
    try {
        const { db } = await import("../../db");
        const { suguBankEntries } = await import("../../../shared/schema");
        const { eq, desc, ilike, and, gte, lte } = await import("drizzle-orm");

        const { action, id, limit = 50, search, startDate, endDate } = args;

        switch (action) {
            case "list": {
                const conditions: any[] = [];
                if (search) conditions.push(ilike(suguBankEntries.label, `%${search}%`));
                if (startDate) conditions.push(gte(suguBankEntries.entryDate, startDate));
                if (endDate) conditions.push(lte(suguBankEntries.entryDate, endDate));

                let query;
                if (conditions.length > 0) {
                    query = db.select().from(suguBankEntries).where(and(...conditions)).orderBy(desc(suguBankEntries.entryDate)).limit(limit);
                } else {
                    query = db.select().from(suguBankEntries).orderBy(desc(suguBankEntries.entryDate)).limit(limit);
                }
                const entries = await query;
                const totalAmount = entries.reduce((s: number, e: any) => s + e.amount, 0);
                return JSON.stringify({
                    type: "bank_list",
                    count: entries.length,
                    totalAmount: Math.round(totalAmount * 100) / 100,
                    filters: { search: search || null, startDate: startDate || null, endDate: endDate || null },
                    entries: entries.map((e: any) => ({
                        id: e.id, date: e.entryDate, label: e.label,
                        amount: e.amount, balance: e.balance,
                        category: e.category, bank: e.bankName,
                        reconciled: e.isReconciled
                    }))
                });
            }
            case "create": {
                const entry = {
                    bankName: args.bankName || "Banque Principale",
                    entryDate: args.entryDate || new Date().toISOString().substring(0, 10),
                    label: args.label || "Sans libellé",
                    amount: args.amount ?? 0,
                    balance: args.balance ?? null,
                    category: args.category ?? null,
                    isReconciled: false,
                    notes: args.notes ?? null,
                };
                const [result] = await db.insert(suguBankEntries).values(entry).returning();
                const { emitBankEvent } = await import("../interconnectEmitter");
                emitBankEvent("create", result);
                return JSON.stringify({ type: "bank_created", success: true, entry: result });
            }
            case "update": {
                if (!id) return JSON.stringify({ error: "ID requis pour modifier une écriture" });
                const updates: Record<string, any> = {};
                if (args.label !== undefined) updates.label = args.label;
                if (args.amount !== undefined) updates.amount = args.amount;
                if (args.entryDate !== undefined) updates.entryDate = args.entryDate;
                if (args.bankName !== undefined) updates.bankName = args.bankName;
                if (args.category !== undefined) updates.category = args.category;
                if (args.balance !== undefined) updates.balance = args.balance;
                if (args.notes !== undefined) updates.notes = args.notes;
                if (Object.keys(updates).length === 0) return JSON.stringify({ error: "Aucune modification fournie" });
                const [result] = await db.update(suguBankEntries).set(updates).where(eq(suguBankEntries.id, id)).returning();
                if (!result) return JSON.stringify({ error: `Écriture #${id} introuvable` });
                const { emitBankEvent: emitBankUpd } = await import("../interconnectEmitter");
                emitBankUpd("update", result);
                return JSON.stringify({ type: "bank_updated", success: true, entry: result });
            }
            case "delete": {
                if (!id) return JSON.stringify({ error: "ID requis pour supprimer une écriture" });
                await db.delete(suguBankEntries).where(eq(suguBankEntries.id, id));
                const { emitBankEvent: emitBankDel } = await import("../interconnectEmitter");
                emitBankDel("delete", { deletedId: id });
                return JSON.stringify({ type: "bank_deleted", success: true, deletedId: id });
            }
            default:
                return JSON.stringify({ error: `Action inconnue: ${action}` });
        }
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[executeSuguBankManagement] Error:", msg);
        return JSON.stringify({ error: msg });
    }
}

export async function executeSuguFilesManagement(args: Record<string, any>): Promise<string> {
    try {
        const { db } = await import("../../db");
        const { suguFiles } = await import("../../../shared/schema");
        const { desc, ilike, or } = await import("drizzle-orm");

        const { action, category, search, month, year, to_email, limit = 30 } = args;

        function buildDateFilter(files: any[]): any[] {
            if (!month && !year) return files;
            return files.filter((f: any) => {
                if (!f.fileDate) return false;
                const d = new Date(f.fileDate);
                if (isNaN(d.getTime())) return false;
                if (year && d.getFullYear() !== Number(year)) return false;
                if (month && (d.getMonth() + 1) !== Number(month)) return false;
                return true;
            });
        }

        switch (action) {
            case "list": {
                let files = await db.select().from(suguFiles).orderBy(desc(suguFiles.createdAt));
                if (category) files = files.filter((f: any) => f.category === category);
                files = buildDateFilter(files);
                files = files.slice(0, limit);
                return JSON.stringify({
                    type: "files_list",
                    count: files.length,
                    files: files.map((f: any) => ({
                        id: f.id, name: f.originalName, category: f.category,
                        supplier: f.supplier, date: f.fileDate, size: f.fileSize,
                        type: f.fileType, description: f.description,
                    }))
                });
            }
            case "search": {
                if (!search) return JSON.stringify({ error: "Terme de recherche requis" });
                let files = await db.select().from(suguFiles)
                    .where(or(
                        ilike(suguFiles.originalName, `%${search}%`),
                        ilike(suguFiles.supplier, `%${search}%`)
                    ))
                    .orderBy(desc(suguFiles.createdAt));
                if (category) files = files.filter((f: any) => f.category === category);
                files = buildDateFilter(files);
                files = files.slice(0, limit);
                return JSON.stringify({
                    type: "files_search",
                    query: search, count: files.length,
                    files: files.map((f: any) => ({
                        id: f.id, name: f.originalName, category: f.category,
                        supplier: f.supplier, date: f.fileDate, description: f.description,
                    }))
                });
            }
            case "summary": {
                const allFiles = await db.select().from(suguFiles);
                const grouped: Record<string, number> = {};
                for (const f of allFiles) {
                    grouped[f.category] = (grouped[f.category] || 0) + 1;
                }
                return JSON.stringify({
                    type: "files_summary",
                    totalFiles: allFiles.length,
                    totalSizeKB: Math.round(allFiles.reduce((s: number, f: any) => s + f.fileSize, 0) / 1024),
                    byCategory: grouped,
                    recentFiles: allFiles.slice(0, 5).map((f: any) => ({
                        name: f.originalName, category: f.category, date: f.fileDate, supplier: f.supplier
                    }))
                });
            }
            case "send_by_email": {
                const recipient = to_email || "djedoumaurice@gmail.com";
                let matchedFiles: any[] = [];
                if (search) {
                    matchedFiles = await db.select().from(suguFiles)
                        .where(or(
                            ilike(suguFiles.originalName, `%${search}%`),
                            ilike(suguFiles.supplier, `%${search}%`)
                        ))
                        .orderBy(desc(suguFiles.createdAt));
                } else {
                    matchedFiles = await db.select().from(suguFiles).orderBy(desc(suguFiles.createdAt));
                }
                if (category) matchedFiles = matchedFiles.filter((f: any) => f.category === category);
                matchedFiles = buildDateFilter(matchedFiles);
                matchedFiles = matchedFiles.slice(0, limit);

                if (matchedFiles.length === 0) {
                    const detail = [search, month ? `mois:${month}` : null, year ? `${year}` : null].filter(Boolean).join(" ");
                    return JSON.stringify({ type: "send_by_email", success: false, message: `Aucun fichier trouvé pour: ${detail || "(tous)"}` });
                }

                const { downloadFromObjectStorage } = await import("../../api/v2/suguManagement/shared");
                const { googleMailService } = await import("../googleMailService");
                const { agentMailService } = await import("../agentMailService");

                const periodStr = [month ? `mois ${month}` : "", year ? `${year}` : ""].filter(Boolean).join(" ") || "tous";
                const emailSubject = `[SUGU Valentine] ${matchedFiles.length} fichier(s) — ${search || "sélection"} ${periodStr}`;
                const emailBody = [
                    "Bonjour,",
                    "",
                    `Veuillez trouver ci-joint les ${matchedFiles.length} fichier(s) demandé(s) depuis SUGU Valentine.`,
                    "",
                    "Critères :",
                    search ? `  • Fournisseur/nom : ${search}` : null,
                    month ? `  • Mois : ${month}` : null,
                    year ? `  • Année : ${year}` : null,
                    "",
                    "Fichiers joints :",
                    ...matchedFiles.map((f: any) => `  • ${f.originalName} (${f.supplier || f.category}, ${f.fileDate || "date inconnue"})`),
                    "",
                    "Cordialement,",
                    "SUGU Valentine — Envoi automatique",
                ].filter((l: any) => l !== null).join("\n");

                const failed: string[] = [];
                let sentCount = 0;

                for (const f of matchedFiles) {
                    let buf: Buffer;
                    try {
                        const result = await downloadFromObjectStorage(f.storagePath);
                        buf = result.buffer;
                    } catch (e: any) {
                        failed.push(f.originalName);
                        console.error(`[SuguFiles] Storage download failed for ${f.originalName} (path: ${f.storagePath}):`, e.message);
                        continue;
                    }

                    const att = { filename: f.originalName, content: buf, contentType: f.mimeType };
                    const fileSubject = `[SUGU Valentine] ${f.originalName} — ${search || f.supplier || f.category}`;
                    try {
                        await googleMailService.sendWithAttachment({ to: recipient, subject: fileSubject, body: emailBody, attachment: att });
                        sentCount++;
                    } catch (gmailErr: any) {
                        console.warn(`[SuguFiles] Gmail failed for ${f.originalName}:`, gmailErr.message);
                        try {
                            await agentMailService.sendEmailWithAttachments({ to: recipient, subject: fileSubject, body: emailBody, attachments: [att] }, "ulysse");
                            sentCount++;
                        } catch (amErr: any) {
                            failed.push(f.originalName);
                            console.error(`[SuguFiles] Both providers failed for ${f.originalName}:`, amErr.message);
                        }
                    }
                }

                return JSON.stringify({
                    type: "send_by_email",
                    success: sentCount > 0,
                    recipient,
                    filesSent: sentCount,
                    filesTotal: matchedFiles.length,
                    failed: failed.length > 0 ? failed : undefined,
                    message: `${sentCount}/${matchedFiles.length} fichier(s) envoyé(s) à ${recipient}`
                });
            }
            case "read_invoice_content": {
                const { eq, ilike: ilike2, or: or2, desc: desc2 } = await import("drizzle-orm");
                const { downloadFromObjectStorage } = await import("../../api/v2/suguManagement/shared");
                const { getPdfParse } = await import("../../api/v2/suguManagement/documentParsers");
                const stripAcc = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

                let filesToRead: any[] = [];
                if (args.file_id) {
                    filesToRead = await db.select().from(suguFiles).where(eq(suguFiles.id, args.file_id));
                } else {
                    const supplierFilter = args.supplier;
                    if (supplierFilter) {
                        const sna = stripAcc(supplierFilter);
                        const cond = supplierFilter !== sna
                            ? or2(ilike2(suguFiles.supplier, `%${supplierFilter}%`), ilike2(suguFiles.supplier, `%${sna}%`))
                            : ilike2(suguFiles.supplier, `%${supplierFilter}%`);
                        filesToRead = await db.select().from(suguFiles).where(cond!).orderBy(desc2(suguFiles.createdAt));
                    } else {
                        filesToRead = await db.select().from(suguFiles).orderBy(desc2(suguFiles.createdAt));
                    }
                    if (category) filesToRead = filesToRead.filter((f: any) => f.category === category);
                    filesToRead = buildDateFilter(filesToRead);
                    filesToRead = filesToRead.filter((f: any) => f.mimeType === "application/pdf");
                    const maxFiles = Math.min(limit, 10);
                    filesToRead = filesToRead.slice(0, maxFiles);
                }

                if (filesToRead.length === 0) {
                    return JSON.stringify({ type: "read_invoice_content", error: "Aucun PDF trouvé pour ces critères" });
                }

                const searchTerm = search ? search.toLowerCase() : null;
                const searchTermNoAccent = searchTerm ? stripAcc(searchTerm) : null;
                const parsePdf = await getPdfParse();
                const invoiceResults: any[] = [];
                let totalMatches = 0;

                for (const f of filesToRead) {
                    try {
                        const { buffer } = await downloadFromObjectStorage(f.storagePath);
                        const pdfTimeout = new Promise<never>((_, reject) =>
                            setTimeout(() => reject(new Error("pdf-parse timeout")), 15000)
                        );
                        const pdfData = await Promise.race([parsePdf(buffer), pdfTimeout]);
                        const rawText: string = pdfData.text || "";
                        const lines = rawText.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0);

                        if (searchTerm) {
                            const matchedLines = lines.filter((line: string) => {
                                const lower = line.toLowerCase();
                                const lna = stripAcc(lower);
                                return lower.includes(searchTerm) || lna.includes(searchTermNoAccent!);
                            });
                            if (matchedLines.length > 0) {
                                totalMatches += matchedLines.length;
                                invoiceResults.push({
                                    fileId: f.id, fileName: f.originalName,
                                    supplier: f.supplier, category: f.category, date: f.fileDate,
                                    matchCount: matchedLines.length,
                                    matchedLines,
                                });
                            }
                        } else {
                            invoiceResults.push({
                                fileId: f.id, fileName: f.originalName,
                                supplier: f.supplier, category: f.category, date: f.fileDate,
                                totalLines: lines.length,
                                fullText: lines.slice(0, 150).join("\n"),
                            });
                        }
                    } catch (e: any) {
                        invoiceResults.push({
                            fileId: f.id, fileName: f.originalName, error: e.message,
                        });
                    }
                }

                return JSON.stringify({
                    type: "read_invoice_content",
                    filesScanned: filesToRead.length,
                    filesWithMatches: searchTerm ? invoiceResults.filter((r: any) => !r.error && r.matchCount).length : undefined,
                    totalMatches: searchTerm ? totalMatches : undefined,
                    searchTerm: search || null,
                    supplier: args.supplier || null,
                    category: category || "toutes",
                    results: invoiceResults,
                });
            }
            default:
                return JSON.stringify({ error: `Action inconnue: ${action}` });
        }
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[executeSuguFilesManagement] Error:", msg);
        return JSON.stringify({ error: msg });
    }
}

export async function executeSuguFullOverview(args: Record<string, any>): Promise<string> {
    try {
        const { db } = await import("../../db");
        const {
            suguPurchases, suguExpenses, suguBankEntries, suguLoans,
            suguCashRegister, suguEmployees, suguPayroll, suguAbsences, suguFiles
        } = await import("../../../shared/schema");
        const { desc, sql } = await import("drizzle-orm");

        const year = args.year || new Date().getFullYear().toString();

        // Fetch all data in parallel
        const [purchases, expenses, bankEntries, loans, cashEntries, employees, payrolls, absences, files] = await Promise.all([
            db.select().from(suguPurchases).orderBy(desc(suguPurchases.invoiceDate)),
            db.select().from(suguExpenses),
            db.select().from(suguBankEntries).orderBy(desc(suguBankEntries.entryDate)),
            db.select().from(suguLoans),
            db.select().from(suguCashRegister).orderBy(desc(suguCashRegister.entryDate)),
            db.select().from(suguEmployees),
            db.select().from(suguPayroll),
            db.select().from(suguAbsences),
            db.select().from(suguFiles).orderBy(desc(suguFiles.createdAt)),
        ]);

        // Compute running bank balance
        const sortedBank = [...bankEntries].sort((a: any, b: any) => {
            const d = a.entryDate.localeCompare(b.entryDate);
            return d !== 0 ? d : a.id - b.id;
        });
        let openingBal = 0;
        for (let i = 0; i < sortedBank.length; i++) {
            const e: any = sortedBank[i];
            if (e.balance != null) {
                const partial = sortedBank.slice(0, i + 1).reduce((s: number, x: any) => s + x.amount, 0);
                openingBal = e.balance - partial;
                break;
            }
        }
        let bal = openingBal;
        for (const e of sortedBank) bal += (e as any).amount;
        const currentBankBalance = bal;

        const totalPurchases = purchases.reduce((s: number, p: any) => s + p.amount, 0);
        const unpaidPurchases = purchases.filter((p: any) => !p.isPaid).reduce((s: number, p: any) => s + p.amount, 0);
        const totalExpenses = expenses.reduce((s: number, e: any) => s + e.amount, 0);
        const totalRevenue = cashEntries.reduce((s: number, c: any) => s + c.totalRevenue, 0);
        const totalCovers = cashEntries.reduce((s: number, c: any) => s + (c.coversCount || 0), 0);
        const activeEmps = employees.filter((e: any) => e.isActive);

        return JSON.stringify({
            type: "sugu_full_overview",
            restaurant: "SUGU Valentine",
            year,
            banque: {
                soldeActuel: currentBankBalance,
                nbEcritures: bankEntries.length,
                totalCredits: bankEntries.filter((e: any) => e.amount > 0).reduce((s: number, e: any) => s + e.amount, 0),
                totalDebits: bankEntries.filter((e: any) => e.amount < 0).reduce((s: number, e: any) => s + Math.abs(e.amount), 0),
                dernieresEcritures: bankEntries.slice(0, 5).map((e: any) => ({ date: e.entryDate, label: e.label, amount: e.amount })),
            },
            achats: {
                total: totalPurchases,
                impayés: unpaidPurchases,
                nbFactures: purchases.length,
            },
            fraisGeneraux: {
                total: totalExpenses,
                nbFrais: expenses.length,
            },
            emprunts: {
                nbEmprunts: loans.length,
                capitalRestant: loans.reduce((s: number, l: any) => s + l.remainingAmount, 0),
                mensualitésTotales: loans.reduce((s: number, l: any) => s + l.monthlyPayment, 0),
            },
            caisse: {
                caTotal: totalRevenue,
                couverts: totalCovers,
                ticketMoyen: totalCovers > 0 ? Math.round(totalRevenue / totalCovers * 100) / 100 : 0,
                nbJours: cashEntries.length,
            },
            rh: {
                employésActifs: activeEmps.length,
                masseSalariale: activeEmps.reduce((s: number, e: any) => s + e.monthlySalary, 0),
                fichesDePaie: payrolls.length,
                absences: absences.length,
            },
            archives: {
                totalFichiers: files.length,
                parCatégorie: {
                    achats: files.filter((f: any) => f.category === "achats").length,
                    frais_generaux: files.filter((f: any) => f.category === "frais_generaux").length,
                    banque: files.filter((f: any) => f.category === "banque").length,
                },
            },
        });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[executeSuguFullOverview] Error:", msg);
        return JSON.stringify({ error: msg });
    }
}

export async function executeBusinessHealth(args: Record<string, any>): Promise<string> {
    try {
        const { db } = await import("../../db");
        const {
            suguBankEntries, suguPurchases, suguExpenses, suguLoans,
            suguCashRegister, suguEmployees, suguPayroll
        } = await import("../../../shared/schema");
        const { desc } = await import("drizzle-orm");

        const period = args.period || 'current_month';
        const now = new Date();
        let startDate: string;
        let endDate = now.toISOString().substring(0, 10);
        let periodLabel: string;

        switch (period) {
            case 'last_month': {
                const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                startDate = prev.toISOString().substring(0, 10);
                endDate = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().substring(0, 10);
                periodLabel = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
                break;
            }
            case 'last_3_months': {
                const m3 = new Date(now.getFullYear(), now.getMonth() - 3, 1);
                startDate = m3.toISOString().substring(0, 10);
                periodLabel = `${m3.toISOString().substring(0, 7)} à ${now.toISOString().substring(0, 7)}`;
                break;
            }
            case 'year': {
                startDate = `${now.getFullYear()}-01-01`;
                periodLabel = `Année ${now.getFullYear()}`;
                break;
            }
            default: {
                startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
                periodLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            }
        }

        const [bankEntries, purchases, expenses, loans, cashEntries, employees, payrolls] = await Promise.all([
            db.select().from(suguBankEntries).orderBy(desc(suguBankEntries.entryDate)),
            db.select().from(suguPurchases),
            db.select().from(suguExpenses),
            db.select().from(suguLoans),
            db.select().from(suguCashRegister).orderBy(desc(suguCashRegister.entryDate)),
            db.select().from(suguEmployees),
            db.select().from(suguPayroll),
        ]);

        // Filter by period
        const inPeriod = (dateStr: string | null) => dateStr && dateStr >= startDate && dateStr <= endDate;
        const pBank = bankEntries.filter((e: any) => inPeriod(e.entryDate));
        const pPurchases = purchases.filter((p: any) => inPeriod(p.invoiceDate));
        const pExpenses = expenses.filter((e: any) => inPeriod(e.period));
        const pCash = cashEntries.filter((c: any) => inPeriod(c.entryDate));
        const pPayrolls = payrolls.filter((p: any) => inPeriod(p.period));

        // Revenue (from cash register)
        const totalRevenue = pCash.reduce((s: number, c: any) => s + c.totalRevenue, 0);
        const totalCovers = pCash.reduce((s: number, c: any) => s + (c.coversCount || 0), 0);

        // Costs
        const costAchats = pPurchases.reduce((s: number, p: any) => s + p.amount, 0);
        const costFrais = pExpenses.reduce((s: number, e: any) => s + e.amount, 0);
        const costSalaires = pPayrolls.reduce((s: number, p: any) => s + (p.netSalary || 0), 0);
        const costCharges = pPayrolls.reduce((s: number, p: any) => s + (p.socialCharges || 0), 0);
        const costEmprunts = loans.reduce((s: number, l: any) => s + (l.monthlyPayment || 0), 0);
        const totalCosts = costAchats + costFrais + costSalaires + costCharges + costEmprunts;

        // P&L
        const operatingProfit = totalRevenue - totalCosts;
        const profitMargin = totalRevenue > 0 ? Math.round(operatingProfit / totalRevenue * 1000) / 10 : 0;

        // Ratios
        const foodCostRatio = totalRevenue > 0 ? Math.round(costAchats / totalRevenue * 1000) / 10 : 0;
        const laborCostRatio = totalRevenue > 0 ? Math.round((costSalaires + costCharges) / totalRevenue * 1000) / 10 : 0;

        // Bank balance
        const sortedBank = [...bankEntries].sort((a: any, b: any) => {
            const d = a.entryDate.localeCompare(b.entryDate);
            return d !== 0 ? d : a.id - b.id;
        });
        let openingBal = 0;
        for (let i = 0; i < sortedBank.length; i++) {
            const e: any = sortedBank[i];
            if (e.balance != null) {
                const partial = sortedBank.slice(0, i + 1).reduce((s: number, x: any) => s + x.amount, 0);
                openingBal = e.balance - partial;
                break;
            }
        }
        let bankBalance = openingBal;
        for (const e of sortedBank) bankBalance += (e as any).amount;

        // Health score (0-100)
        let healthScore = 50;
        if (profitMargin > 15) healthScore += 20;
        else if (profitMargin > 5) healthScore += 10;
        else if (profitMargin < 0) healthScore -= 20;
        if (foodCostRatio < 30) healthScore += 10;
        else if (foodCostRatio > 40) healthScore -= 10;
        if (laborCostRatio < 35) healthScore += 10;
        else if (laborCostRatio > 45) healthScore -= 10;
        if (bankBalance > 20000) healthScore += 10;
        else if (bankBalance < 5000) healthScore -= 15;
        const unpaid = purchases.filter((p: any) => !p.isPaid).reduce((s: number, p: any) => s + p.amount, 0);
        if (unpaid > 5000) healthScore -= 5;
        healthScore = Math.max(0, Math.min(100, healthScore));

        // Alerts
        const alerts: string[] = [];
        if (profitMargin < 0) alerts.push("🔴 Résultat d'exploitation négatif");
        if (foodCostRatio > 35) alerts.push(`⚠️ Food cost élevé: ${foodCostRatio}% (cible <30%)`);
        if (laborCostRatio > 40) alerts.push(`⚠️ Coût salarial élevé: ${laborCostRatio}% (cible <35%)`);
        if (bankBalance < 10000) alerts.push(`⚠️ Trésorerie basse: ${bankBalance.toFixed(0)}€`);
        if (unpaid > 3000) alerts.push(`⚠️ ${unpaid.toFixed(0)}€ de factures impayées`);

        const healthResult = {
            type: "business_health",
            restaurant: "SUGU Valentine",
            period: periodLabel,
            pnl: {
                revenus: totalRevenue,
                coûtAchats: costAchats,
                coûtFraisGénéraux: costFrais,
                coûtSalaires: costSalaires,
                chargesSociales: costCharges,
                mensualitésEmprunts: costEmprunts,
                totalCoûts: totalCosts,
                résultatExploitation: operatingProfit,
                margeOpérationnelle: `${profitMargin}%`,
            },
            ratios: {
                foodCost: `${foodCostRatio}%`,
                laborCost: `${laborCostRatio}%`,
                ticketMoyen: totalCovers > 0 ? Math.round(totalRevenue / totalCovers * 100) / 100 : 0,
                couverts: totalCovers,
                joursActivité: pCash.length,
            },
            trésorerie: {
                soldeBancaire: bankBalance,
                impayésFournisseurs: unpaid,
                capitalRestantEmprunts: loans.reduce((s: number, l: any) => s + (l.remainingAmount || 0), 0),
            },
            scoreSanté: healthScore,
            alertes: alerts,
        };
        const { emitBusinessHealthComputed } = await import("../interconnectEmitter");
        emitBusinessHealthComputed(healthResult, periodLabel);
        return JSON.stringify(healthResult);
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[executeBusinessHealth] Error:", msg);
        return JSON.stringify({ error: msg });
    }
}

export async function executeDetectAnomalies(args: Record<string, any>): Promise<string> {
    try {
        const { db } = await import("../../db");
        const { suguBankEntries, suguPurchases, suguPayroll, suguCashRegister } = await import("../../../shared/schema");
        const { desc } = await import("drizzle-orm");

        const days = args.days || 30;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = cutoff.toISOString().substring(0, 10);

        const [bankEntries, purchases, payrolls, cashEntries] = await Promise.all([
            db.select().from(suguBankEntries).orderBy(desc(suguBankEntries.entryDate)),
            db.select().from(suguPurchases),
            db.select().from(suguPayroll),
            db.select().from(suguCashRegister).orderBy(desc(suguCashRegister.entryDate)),
        ]);

        const recentBank = bankEntries.filter((e: any) => e.entryDate >= cutoffStr);
        const anomalies: Array<{ type: string; severity: string; description: string }> = [];

        // 1. Old unpaid invoices (>30 days)
        const oldUnpaid = purchases.filter((p: any) => {
            if (p.isPaid) return false;
            const inv = p.invoiceDate;
            if (!inv) return false;
            const daysDiff = Math.floor((Date.now() - new Date(inv).getTime()) / 86400000);
            return daysDiff > 30;
        });
        for (const p of oldUnpaid as any[]) {
            const daysDiff = Math.floor((Date.now() - new Date(p.invoiceDate).getTime()) / 86400000);
            anomalies.push({
                type: "facture_impayee_ancienne",
                severity: daysDiff > 60 ? "haute" : "moyenne",
                description: `Facture ${p.supplier || 'inconnu'} du ${p.invoiceDate}: ${p.amount}€ impayée depuis ${daysDiff} jours`
            });
        }

        // 2. Large bank debits without matching purchase
        const purchaseAmounts = new Set(purchases.map((p: any) => Math.abs(p.amount).toFixed(2)));
        const largeBankDebits = recentBank.filter((e: any) => e.amount < -200 && e.category === 'achat_fournisseur');
        for (const e of largeBankDebits as any[]) {
            const absAmount = Math.abs(e.amount).toFixed(2);
            if (!purchaseAmounts.has(absAmount)) {
                anomalies.push({
                    type: "debit_sans_facture",
                    severity: "moyenne",
                    description: `Débit bancaire ${e.entryDate} de ${e.amount}€ (${e.label?.substring(0, 40)}) sans facture correspondante`
                });
            }
        }

        // 3. Cash register gaps (missing days in last 30)
        const cashDates = new Set(cashEntries.filter((c: any) => c.entryDate >= cutoffStr).map((c: any) => c.entryDate));
        const today = new Date();
        let missingDays = 0;
        for (let d = new Date(cutoff); d <= today; d.setDate(d.getDate() + 1)) {
            const dow = d.getDay();
            if (dow === 0) continue; // skip Sunday
            const ds = d.toISOString().substring(0, 10);
            if (!cashDates.has(ds) && ds < today.toISOString().substring(0, 10)) missingDays++;
        }
        if (missingDays > 3) {
            anomalies.push({
                type: "jours_caisse_manquants",
                severity: missingDays > 7 ? "haute" : "moyenne",
                description: `${missingDays} jours sans écriture de caisse sur les ${days} derniers jours (hors dimanche)`
            });
        }

        // 4. Unusually high single transactions
        const avgAbsAmount = recentBank.length > 0
            ? recentBank.reduce((s: number, e: any) => s + Math.abs(e.amount), 0) / recentBank.length
            : 500;
        const threshold = avgAbsAmount * 5;
        const outliers = recentBank.filter((e: any) => Math.abs(e.amount) > threshold && Math.abs(e.amount) > 2000);
        for (const e of outliers as any[]) {
            anomalies.push({
                type: "montant_inhabituel",
                severity: "info",
                description: `Écriture ${e.entryDate}: ${e.amount}€ (${e.label?.substring(0, 40)}) — montant significativement au-dessus de la moyenne (${avgAbsAmount.toFixed(0)}€)`
            });
        }

        const anomalyResult = {
            type: "anomaly_detection",
            période: `${days} derniers jours`,
            totalAnomalies: anomalies.length,
            parSevérité: {
                haute: anomalies.filter(a => a.severity === "haute").length,
                moyenne: anomalies.filter(a => a.severity === "moyenne").length,
                info: anomalies.filter(a => a.severity === "info").length,
            },
            anomalies: anomalies.slice(0, 20),
        };
        const { emitAnomaliesDetected } = await import("../interconnectEmitter");
        emitAnomaliesDetected(anomalies, cutoffStr.substring(0, 7));
        return JSON.stringify(anomalyResult);
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[executeDetectAnomalies] Error:", msg);
        return JSON.stringify({ error: msg });
    }
}

export async function executeQueryHubrise(args: Record<string, any>): Promise<string> {
    try {
        const { hubriseService } = await import("../hubriseService");
        await hubriseService.ensureTable();

        const query = args.query || "summary";
        const period = args.period || "month";
        const limit = args.limit || 20;

        if (query === "status") {
            const status = hubriseService.getStatus();
            return JSON.stringify({ type: "hubrise_status", ...status });
        }

        if (!hubriseService.isConnected()) {
            if (query === "channel_breakdown" || query === "summary") {
                const { db } = await import("../../db");
                const { suguCashRegister } = await import("../../../shared/schema");
                const { desc, and, gte, lte } = await import("drizzle-orm");

                let fromDate: string, toDate: string;
                const now = new Date();
                if (period === "custom" && args.startDate) {
                    fromDate = args.startDate;
                    toDate = args.endDate || args.startDate;
                } else if (period === "today") {
                    fromDate = toDate = now.toISOString().substring(0, 10);
                } else if (period === "yesterday") {
                    const y = new Date(now); y.setDate(y.getDate() - 1);
                    fromDate = toDate = y.toISOString().substring(0, 10);
                } else {
                    fromDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
                    toDate = now.toISOString().substring(0, 10);
                }

                const cashResults = await db.select().from(suguCashRegister)
                    .where(and(gte(suguCashRegister.entryDate, fromDate), lte(suguCashRegister.entryDate, toDate)))
                    .orderBy(desc(suguCashRegister.entryDate)).limit(50);

                if (cashResults.length > 0) {
                    const totals = cashResults.reduce((acc: any, c: any) => ({
                        total: acc.total + (c.totalRevenue || 0),
                        uber_eats: acc.uber_eats + (c.ubereatsAmount || 0),
                        deliveroo: acc.deliveroo + (c.deliverooAmount || 0),
                        zenorder: acc.zenorder + (c.cbzenAmount || 0),
                        especes: acc.especes + (c.cashAmount || 0),
                        cb: acc.cb + (c.cbAmount || 0),
                        ticket_restaurant: acc.ticket_restaurant + (c.trAmount || 0),
                    }), { total: 0, uber_eats: 0, deliveroo: 0, zenorder: 0, especes: 0, cb: 0, ticket_restaurant: 0 });

                    return JSON.stringify({
                        type: "ca_par_origine_caisse",
                        source: "journal_de_caisse",
                        note: "HubRise non connecté, données issues du journal de caisse",
                        du: fromDate,
                        au: toDate,
                        totalCA: `${totals.total.toFixed(2)}€`,
                        parOrigine: {
                            uber_eats: `${totals.uber_eats.toFixed(2)}€`,
                            deliveroo: `${totals.deliveroo.toFixed(2)}€`,
                            zenorder_cb: `${totals.zenorder.toFixed(2)}€`,
                            especes: `${totals.especes.toFixed(2)}€`,
                            carte_bancaire: `${totals.cb.toFixed(2)}€`,
                            ticket_restaurant: `${totals.ticket_restaurant.toFixed(2)}€`,
                        },
                        détails: cashResults.map((c: any) => ({
                            date: c.entryDate,
                            total: c.totalRevenue,
                            uber_eats: c.ubereatsAmount || 0,
                            deliveroo: c.deliverooAmount || 0,
                            zenorder: c.cbzenAmount || 0,
                            especes: c.cashAmount || 0,
                            cb: c.cbAmount || 0,
                            couverts: c.coversCount || 0,
                        }))
                    });
                }
            }
            return JSON.stringify({ error: "HubRise n'est pas connecté. L'utilisateur doit d'abord connecter HubRise depuis l'onglet HubRise dans SUGU Valentine." });
        }

        const now = new Date();
        let from: string, to: string;
        if (period === "custom" && args.startDate) {
            from = args.startDate;
            to = args.endDate || args.startDate;
        } else {
        switch (period) {
            case "today":
                from = to = now.toISOString().substring(0, 10);
                break;
            case "yesterday": {
                const y = new Date(now); y.setDate(y.getDate() - 1);
                from = to = y.toISOString().substring(0, 10);
                break;
            }
            case "week": {
                const w = new Date(now); w.setDate(w.getDate() - 7);
                from = w.toISOString().substring(0, 10);
                to = now.toISOString().substring(0, 10);
                break;
            }
            case "month": {
                from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
                to = now.toISOString().substring(0, 10);
                break;
            }
            case "last_month": {
                const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0);
                from = lm.toISOString().substring(0, 10);
                to = lmEnd.toISOString().substring(0, 10);
                break;
            }
            case "quarter": {
                const q = Math.floor(now.getMonth() / 3) * 3;
                from = `${now.getFullYear()}-${String(q + 1).padStart(2, '0')}-01`;
                to = now.toISOString().substring(0, 10);
                break;
            }
            case "year": {
                from = `${now.getFullYear()}-01-01`;
                to = now.toISOString().substring(0, 10);
                break;
            }
            default:
                from = "2024-01-01";
                to = now.toISOString().substring(0, 10);
        }
        }

        if (query === "summary") {
            const summary = await hubriseService.getOrdersSummary(from, to);
            const activeDays = Object.keys(summary.byDay).length;
            const { emitHubriseSyncEvent } = await import("../interconnectEmitter");
            emitHubriseSyncEvent({ date: to, orderCount: summary.totalOrders, totalRevenue: summary.totalRevenue, averageTicket: summary.avgTicket });
            return JSON.stringify({
                type: "hubrise_summary",
                période: period,
                du: from,
                au: to,
                commandes: summary.totalOrders,
                chiffreAffaires: `${summary.totalRevenue.toFixed(2)}€`,
                ticketMoyen: `${summary.avgTicket.toFixed(2)}€`,
                joursActifs: activeDays,
                parTypeService: Object.entries(summary.byServiceType).map(([k, v]) => ({
                    type: k === "delivery" ? "Livraison" : k === "collection" ? "À emporter" : k,
                    commandes: v.orders,
                    ca: `${v.revenue.toFixed(2)}€`
                })),
                parPaiement: Object.entries(summary.byPaymentType).map(([k, v]) => ({
                    type: k,
                    montant: `${(v as number).toFixed(2)}€`
                }))
            });
        }

        if (query === "orders") {
            const afterParam = `${from}T00:00:00+00:00`;
            const beforeParam = `${to}T23:59:59+00:00`;
            const orders = await hubriseService.getOrders({ after: afterParam, before: beforeParam });
            const recent = orders.slice(0, limit);
            return JSON.stringify({
                type: "hubrise_orders",
                période: period,
                total: orders.length,
                affichés: recent.length,
                commandes: recent.map(o => ({
                    id: o.id,
                    date: o.created_at?.substring(0, 16),
                    montant: `${o.total}€`,
                    statut: o.status,
                    type: o.service_type === "delivery" ? "Livraison" : o.service_type === "collection" ? "À emporter" : o.service_type,
                    articles: (o.items || []).map(i => `${i.quantity}x ${i.product_name} (${i.subtotal}€)`).join(", "),
                    client: o.customer ? `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim() : null
                }))
            });
        }

        if (query === "daily_breakdown") {
            const summary = await hubriseService.getOrdersSummary(from, to);
            const days = Object.entries(summary.byDay)
                .sort(([a], [b]) => b.localeCompare(a))
                .slice(0, limit)
                .map(([day, data]) => ({
                    jour: day,
                    commandes: data.orders,
                    ca: `${data.revenue.toFixed(2)}€`,
                    ticketMoyen: data.orders > 0 ? `${(data.revenue / data.orders).toFixed(2)}€` : "0€"
                }));
            return JSON.stringify({ type: "hubrise_daily", période: period, jours: days });
        }

        if (query === "top_days") {
            const summary = await hubriseService.getOrdersSummary(from, to);
            const topDays = Object.entries(summary.byDay)
                .sort(([, a], [, b]) => b.revenue - a.revenue)
                .slice(0, limit)
                .map(([day, data], i) => ({
                    rang: i + 1,
                    jour: day,
                    commandes: data.orders,
                    ca: `${data.revenue.toFixed(2)}€`
                }));
            return JSON.stringify({ type: "hubrise_top_days", période: period, meilleursjours: topDays });
        }

        if (query === "service_types") {
            const summary = await hubriseService.getOrdersSummary(from, to);
            return JSON.stringify({
                type: "hubrise_service_types",
                période: period,
                types: Object.entries(summary.byServiceType).map(([k, v]) => ({
                    type: k === "delivery" ? "Livraison" : k === "collection" ? "À emporter" : k,
                    commandes: v.orders,
                    ca: `${v.revenue.toFixed(2)}€`,
                    pourcentageCA: summary.totalRevenue > 0 ? `${((v.revenue / summary.totalRevenue) * 100).toFixed(1)}%` : "0%"
                }))
            });
        }

        if (query === "channel_breakdown") {
            const afterParam = `${from}T00:00:00+00:00`;
            const beforeParam = `${to}T23:59:59+00:00`;
            const orders = await hubriseService.getOrders({ after: afterParam, before: beforeParam });

            const byChannel: Record<string, { orders: number; revenue: number }> = {};
            for (const o of orders) {
                const amount = parseFloat(o.total || "0");
                const ch = o.channel || o.service_type || "direct";
                if (!byChannel[ch]) byChannel[ch] = { orders: 0, revenue: 0 };
                byChannel[ch].orders++;
                byChannel[ch].revenue += amount;
            }

            const { db } = await import("../../db");
            const { suguCashRegister } = await import("../../../shared/schema");
            const { desc, and: andOp, gte: gteOp, lte: lteOp } = await import("drizzle-orm");
            const cashResults = await db.select().from(suguCashRegister)
                .where(andOp(gteOp(suguCashRegister.entryDate, from), lteOp(suguCashRegister.entryDate, to)))
                .orderBy(desc(suguCashRegister.entryDate)).limit(50);

            let caisseData = null;
            if (cashResults.length > 0) {
                const totals = cashResults.reduce((acc: any, c: any) => ({
                    total: acc.total + (c.totalRevenue || 0),
                    uber_eats: acc.uber_eats + (c.ubereatsAmount || 0),
                    deliveroo: acc.deliveroo + (c.deliverooAmount || 0),
                    zenorder: acc.zenorder + (c.cbzenAmount || 0),
                    especes: acc.especes + (c.cashAmount || 0),
                    cb: acc.cb + (c.cbAmount || 0),
                    tr: acc.tr + (c.trAmount || 0),
                }), { total: 0, uber_eats: 0, deliveroo: 0, zenorder: 0, especes: 0, cb: 0, tr: 0 });
                caisseData = {
                    totalCA: `${totals.total.toFixed(2)}€`,
                    uber_eats: `${totals.uber_eats.toFixed(2)}€`,
                    deliveroo: `${totals.deliveroo.toFixed(2)}€`,
                    zenorder_cb: `${totals.zenorder.toFixed(2)}€`,
                    especes: `${totals.especes.toFixed(2)}€`,
                    carte_bancaire: `${totals.cb.toFixed(2)}€`,
                    ticket_restaurant: `${totals.tr.toFixed(2)}€`,
                };
            }

            return JSON.stringify({
                type: "hubrise_channel_breakdown",
                période: period,
                du: from,
                au: to,
                hubrise: {
                    totalCommandes: orders.length,
                    totalCA: `${orders.reduce((s, o) => s + parseFloat(o.total || "0"), 0).toFixed(2)}€`,
                    parPlateforme: Object.entries(byChannel)
                        .sort(([, a], [, b]) => b.revenue - a.revenue)
                        .map(([ch, data]) => ({
                            plateforme: ch,
                            commandes: data.orders,
                            ca: `${data.revenue.toFixed(2)}€`
                        }))
                },
                journalDeCaisse: caisseData
            });
        }

        return JSON.stringify({ error: `Type de requête inconnu: ${query}` });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[executeQueryHubrise] Error:", msg);
        return JSON.stringify({ error: msg });
    }
}

export async function executeManageFeatureFlags(args: Record<string, any>): Promise<string> {
    try {
        const { featureFlagsService } = await import("../featureFlagsService");
        const { action, flagId } = args;

        switch (action) {
            case "list": {
                const flags = featureFlagsService.getAllFlags();
                const summary = featureFlagsService.getSummary();
                return JSON.stringify({
                    type: "feature_flags_list",
                    summary,
                    flags: flags.map(f => ({
                        id: f.id,
                        name: f.name,
                        description: f.description,
                        enabled: f.enabled,
                        category: f.category,
                    })),
                });
            }
            case "enable": {
                if (!flagId) return JSON.stringify({ error: "flagId requis pour enable" });
                const ok = featureFlagsService.setFlag(flagId, true);
                if (!ok) return JSON.stringify({ error: `Flag inconnu: ${flagId}` });
                const flag = featureFlagsService.getFlag(flagId);
                return JSON.stringify({ type: "flag_updated", action: "enabled", flag });
            }
            case "disable": {
                if (!flagId) return JSON.stringify({ error: "flagId requis pour disable" });
                const ok = featureFlagsService.setFlag(flagId, false);
                if (!ok) return JSON.stringify({ error: `Flag inconnu: ${flagId}` });
                const flag = featureFlagsService.getFlag(flagId);
                return JSON.stringify({ type: "flag_updated", action: "disabled", flag });
            }
            case "toggle": {
                if (!flagId) return JSON.stringify({ error: "flagId requis pour toggle" });
                const ok = featureFlagsService.toggleFlag(flagId);
                if (!ok) return JSON.stringify({ error: `Flag inconnu: ${flagId}` });
                const flag = featureFlagsService.getFlag(flagId);
                return JSON.stringify({ type: "flag_updated", action: "toggled", flag });
            }
            case "status": {
                if (!flagId) {
                    const summary = featureFlagsService.getSummary();
                    return JSON.stringify({ type: "flags_status", ...summary });
                }
                const flag = featureFlagsService.getFlag(flagId);
                if (!flag) return JSON.stringify({ error: `Flag inconnu: ${flagId}` });
                return JSON.stringify({ type: "flag_status", flag });
            }
            default:
                return JSON.stringify({ error: `Action inconnue: ${action}. Utilise: list, enable, disable, toggle, status` });
        }
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[executeManageFeatureFlags] Error:", msg);
        return JSON.stringify({ error: msg });
    }
}

export async function executeBrainQuery(args: { query: string; category?: string; limit?: number }, userId: number): Promise<string> {
    const brainService = await loadService('brain');
    if (!brainService) return JSON.stringify({ error: "Service Brain non disponible" });

    const { query, category = 'all', limit = 10 } = args;

    // Use unified queryBrain for multi-source search (knowledge + memories + projects + links)
    const brainResults = await brainService.queryBrain(userId, query, {
        includeKnowledge: true,
        includeLinks: true,
        includeMemories: true,
        includeProjects: true,
        limit,
    });

    // If unified search returns nothing, try word-based search
    const totalResults = brainResults.knowledge.length + brainResults.memories.length + brainResults.projects.length + brainResults.links.length;
    if (totalResults === 0) {
        // Split query into meaningful words and search each
        const words = query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
        if (words.length > 1) {
            // Search with individual keywords
            const wordSearchPromises = words.slice(0, 4).map(async (word: string) => {
                return brainService.queryBrain(userId, word, { limit: 3 });
            });
            const wordResults = await Promise.all(wordSearchPromises);
            const seenIds = new Set<number>();
            for (const wr of wordResults) {
                for (const k of wr.knowledge) { if (!seenIds.has(k.id)) { brainResults.knowledge.push(k); seenIds.add(k.id); } }
                for (const m of wr.memories) { if (!seenIds.has(m.id)) { brainResults.memories.push(m); seenIds.add(m.id); } }
                for (const p of wr.projects) { if (!seenIds.has(p.id)) { brainResults.projects.push(p); seenIds.add(p.id); } }
                for (const l of wr.links) { if (!seenIds.has(l.id)) { brainResults.links.push(l); seenIds.add(l.id); } }
            }
        }
    }

    // Also pull memories from ulysse_memory (personal data about the user)
    const { MemoryService } = await import('../memory');
    const memoryService = new MemoryService();
    const personalMemories = await memoryService.getAllMemories(userId);

    // Build comprehensive result
    const output: any = {
        type: 'brain_search',
        query,
        knowledgeCount: brainResults.knowledge.length,
        memoryCount: brainResults.memories.length,
        personalMemoryCount: personalMemories.length,
        projectCount: brainResults.projects.length,
        linkCount: brainResults.links.length,
    };

    if (brainResults.knowledge.length > 0) {
        output.knowledge = brainResults.knowledge.slice(0, limit).map((r: any) => ({
            title: r.title, content: r.content?.substring(0, 300), category: r.category
        }));
    }

    if (brainResults.memories.length > 0) {
        output.memories = brainResults.memories.slice(0, limit).map((r: any) => ({
            key: r.key, value: r.value?.substring(0, 200), category: r.category, confidence: r.confidence
        }));
    }

    // Always include a summary of personal memories grouped by category
    if (personalMemories.length > 0) {
        const grouped: Record<string, number> = {};
        const highlights: Array<{ category: string; key: string; value: string }> = [];
        for (const m of personalMemories) {
            grouped[m.category] = (grouped[m.category] || 0) + 1;
            // Include top entries from personality/fact/preference as highlights
            if (['personality', 'fact', 'preference', 'location'].includes(m.category) && highlights.length < 15) {
                highlights.push({ category: m.category, key: m.key, value: m.value.substring(0, 150) });
            }
        }
        output.personalMemorySummary = {
            totalEntries: personalMemories.length,
            byCategory: grouped,
            highlights
        };
    }

    if (brainResults.projects.length > 0) {
        output.projects = brainResults.projects.slice(0, 5).map((r: any) => ({
            name: r.projectName, summary: r.summary?.substring(0, 200)
        }));
    }

    return JSON.stringify(output);
}

export async function executeStockQuery(args: { symbol?: string; query_type: string }): Promise<string> {
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

export async function executeSmartHomeControl(args: { action: string; device_name?: string; scene_name?: string; value?: number; color?: string }, userId: number): Promise<string> {
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
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
    }
}

export async function executeWeatherGet(args: { location?: string }): Promise<string> {
    const { location = 'Marseille' } = args;
    try {
        const { getMarseilleInfo } = await import("../responseCacheService");
        const info = await getMarseilleInfo();
        return JSON.stringify({
            type: 'weather',
            location,
            temperature: info.weather.temperature,
            condition: info.weather.condition,
            humidity: info.weather.humidity,
            wind: info.weather.wind
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
    }
}

export async function executeWebSearch(args: { query: string; max_results?: number }): Promise<string> {
    const searchService = await loadService('search');
    if (!searchService) {
        return JSON.stringify({ error: "Service Recherche non disponible" });
    }

    const { query, max_results = 5 } = args;
    try {
        const results = await searchService.search(query, { maxResults: max_results });
        return JSON.stringify({
            type: 'web_search',
            query,
            resultCount: results.results?.length || 0,
            results: results.results?.slice(0, max_results) || [],
            directAnswers: results.directAnswers
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
    }
}

export async function executeReadUrl(args: { url: string }): Promise<string> {
    try {
        const { smartFetch } = await import("../dynamicPageService");
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
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[read_url] Error:', msg);
        return JSON.stringify({
            error: `Erreur lecture URL: ${msg}`,
            url: args.url
        });
    }
}

export async function executeMemorySave(args: { key: string; value: string; category?: string; importance?: number }, userId: number): Promise<string> {
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
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
    }
}

export async function executeImageGenerate(args: { prompt: string; size?: string; quality?: string }): Promise<string> {
    try {
        const openai = getOpenAI();

        const response = await openai.images.generate({
            model: "dall-e-3",
            prompt: args.prompt,
            n: 1,
            size: (args.size as any) || "1024x1024",
            quality: (args.quality as any) || "standard"
        });

        return JSON.stringify({
            type: 'image_generated',
            success: true,
            url: response.data[0]?.url,
            revisedPrompt: response.data[0]?.revised_prompt
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: msg });
    }
}

// ========================= PLACES / GEOCODING TOOLS =========================

export async function executeSearchNearbyPlaces(
    args: { query: string; lat?: number; lng?: number; radius?: number; limit?: number },
    userId: number
): Promise<string> {
    try {
        const { googleMapsService } = await import("../googleMapsService");

        let { query, lat, lng, radius = 5000, limit = 5 } = args;

        // If no coordinates provided, try to get user's last known position
        if (lat == null || lng == null) {
            try {
                const { geolocationService } = await import("../geolocationService");
                const lastPos = await geolocationService.getLastKnownLocation(userId);
                if (lastPos) {
                    lat = parseFloat(lastPos.latitude);
                    lng = parseFloat(lastPos.longitude);
                }
            } catch {
                // Ignore - will search without location bias
            }
        }

        if (lat != null && lng != null) {
            const results = await googleMapsService.searchNearbyPlaces(query, lat, lng, radius, limit);
            if (results.length === 0) {
                return JSON.stringify({ type: 'places_search', count: 0, message: `Aucun résultat pour "${query}" dans un rayon de ${radius}m` });
            }
            return JSON.stringify({
                type: 'places_search',
                count: results.length,
                source: results[0]?.source || 'unknown',
                userLocation: { lat, lng },
                places: results.map(p => ({
                    name: p.name,
                    address: p.address,
                    distance: p.distance ? `${Math.round(p.distance)}m` : undefined,
                    rating: p.rating,
                    openNow: p.openNow,
                    types: p.types.slice(0, 3),
                }))
            });
        } else {
            // No location - text search only
            const results = await googleMapsService.searchPlacesByText(query, limit);
            if (results.length === 0) {
                return JSON.stringify({ type: 'places_search', count: 0, message: `Aucun résultat pour "${query}"` });
            }
            return JSON.stringify({
                type: 'places_search',
                count: results.length,
                source: results[0]?.source || 'unknown',
                places: results.map(p => ({
                    name: p.name,
                    address: p.address,
                    rating: p.rating,
                    types: p.types.slice(0, 3),
                }))
            });
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[search_nearby_places] Error:', msg);
        return JSON.stringify({ error: `Erreur recherche de lieux: ${msg}` });
    }
}

export async function executeGeocodeAddress(args: { address: string }): Promise<string> {
    try {
        const { googleMapsService } = await import("../googleMapsService");
        const result = await googleMapsService.geocode(args.address);

        if (!result) {
            return JSON.stringify({ type: 'geocode', error: `Adresse non trouvée: "${args.address}"` });
        }

        return JSON.stringify({
            type: 'geocode',
            address: args.address,
            formattedAddress: result.formattedAddress,
            lat: result.lat,
            lng: result.lng,
            source: result.source
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ error: `Erreur géocodage: ${msg}` });
    }
}

// ═══════════════════════════════════════════════════════════════
// PURCHASES MANAGEMENT (achats fournisseurs)
// ═══════════════════════════════════════════════════════════════
export async function executeSuguPurchasesManagement(args: Record<string, any>): Promise<string> {
    try {
        const { db } = await import("../../db");
        const { suguPurchases } = await import("../../../shared/schema");
        const { eq, desc, ilike, and, gte, lte, or } = await import("drizzle-orm");

        const { action, id, search, startDate, endDate, limit = 50 } = args;

        switch (action) {
            case "list": {
                const conditions: any[] = [];
                if (search) {
                    conditions.push(or(
                        ilike(suguPurchases.supplier, `%${search}%`),
                        ilike(suguPurchases.description, `%${search}%`)
                    ));
                }
                if (startDate) conditions.push(gte(suguPurchases.invoiceDate, startDate));
                if (endDate) conditions.push(lte(suguPurchases.invoiceDate, endDate));

                let query;
                if (conditions.length > 0) {
                    query = db.select().from(suguPurchases).where(and(...conditions)).orderBy(desc(suguPurchases.invoiceDate)).limit(limit);
                } else {
                    query = db.select().from(suguPurchases).orderBy(desc(suguPurchases.invoiceDate)).limit(limit);
                }
                const purchases = await query;
                const totalAmount = purchases.reduce((s: number, p: any) => s + p.amount, 0);
                const unpaidAmount = purchases.filter((p: any) => !p.isPaid).reduce((s: number, p: any) => s + p.amount, 0);
                return JSON.stringify({
                    type: "purchases_list",
                    count: purchases.length,
                    totalAmount: Math.round(totalAmount * 100) / 100,
                    unpaidAmount: Math.round(unpaidAmount * 100) / 100,
                    filters: { search: search || null, startDate: startDate || null, endDate: endDate || null },
                    purchases: purchases.map((p: any) => ({
                        id: p.id, supplier: p.supplier, description: p.description,
                        category: p.category, amount: p.amount, taxAmount: p.taxAmount,
                        invoiceNumber: p.invoiceNumber, invoiceDate: p.invoiceDate,
                        dueDate: p.dueDate, isPaid: p.isPaid, paidDate: p.paidDate,
                        paymentMethod: p.paymentMethod, notes: p.notes,
                    }))
                });
            }
            case "create": {
                const entry = {
                    supplier: args.supplier || "Non spécifié",
                    description: args.description || null,
                    category: args.category || "autre",
                    amount: args.amount ?? 0,
                    taxAmount: args.taxAmount ?? 0,
                    invoiceNumber: args.invoiceNumber || null,
                    invoiceDate: args.invoiceDate || new Date().toISOString().substring(0, 10),
                    dueDate: args.dueDate || null,
                    isPaid: args.isPaid ?? false,
                    paidDate: args.paidDate || null,
                    paymentMethod: args.paymentMethod || null,
                    notes: args.notes || null,
                };
                const [result] = await db.insert(suguPurchases).values(entry).returning();
                const { emitPurchaseEvent } = await import("../interconnectEmitter");
                emitPurchaseEvent("create", result);
                return JSON.stringify({ type: "purchase_created", success: true, purchase: result });
            }
            case "update": {
                if (!id) return JSON.stringify({ error: "ID requis pour modifier un achat" });
                const updates: Record<string, any> = {};
                for (const key of ["supplier", "description", "category", "amount", "taxAmount", "invoiceNumber", "invoiceDate", "dueDate", "isPaid", "paidDate", "paymentMethod", "notes"]) {
                    if (args[key] !== undefined) updates[key] = args[key];
                }
                if (Object.keys(updates).length === 0) return JSON.stringify({ error: "Aucune modification fournie" });
                const [result] = await db.update(suguPurchases).set(updates).where(eq(suguPurchases.id, id)).returning();
                if (!result) return JSON.stringify({ error: `Achat #${id} introuvable` });
                const { emitPurchaseEvent: emitPurchaseUpd } = await import("../interconnectEmitter");
                emitPurchaseUpd("update", result);
                return JSON.stringify({ type: "purchase_updated", success: true, purchase: result });
            }
            case "delete": {
                if (!id) return JSON.stringify({ error: "ID requis pour supprimer un achat" });
                await db.delete(suguPurchases).where(eq(suguPurchases.id, id));
                const { emitPurchaseEvent: emitPurchaseDel } = await import("../interconnectEmitter");
                emitPurchaseDel("delete", { deletedId: id });
                return JSON.stringify({ type: "purchase_deleted", success: true, deletedId: id });
            }
            default:
                return JSON.stringify({ error: `Action inconnue: ${action}` });
        }
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[executeSuguPurchasesManagement] Error:", msg);
        return JSON.stringify({ error: msg });
    }
}

// ═══════════════════════════════════════════════════════════════
// EXPENSES MANAGEMENT (frais généraux)
// ═══════════════════════════════════════════════════════════════
export async function executeSuguExpensesManagement(args: Record<string, any>): Promise<string> {
    try {
        const { db } = await import("../../db");
        const { suguExpenses } = await import("../../../shared/schema");
        const { eq, desc, ilike, and, gte, lte, or } = await import("drizzle-orm");

        const { action, id, search, startDate, endDate, limit = 50 } = args;

        switch (action) {
            case "list": {
                const conditions: any[] = [];
                if (search) {
                    conditions.push(or(
                        ilike(suguExpenses.label, `%${search}%`),
                        ilike(suguExpenses.category, `%${search}%`),
                        ilike(suguExpenses.description, `%${search}%`)
                    ));
                }
                if (startDate) conditions.push(gte(suguExpenses.period, startDate.substring(0, 7)));
                if (endDate) conditions.push(lte(suguExpenses.period, endDate.substring(0, 7)));

                let query;
                if (conditions.length > 0) {
                    query = db.select().from(suguExpenses).where(and(...conditions)).orderBy(desc(suguExpenses.createdAt)).limit(limit);
                } else {
                    query = db.select().from(suguExpenses).orderBy(desc(suguExpenses.createdAt)).limit(limit);
                }
                const expenses = await query;
                const totalAmount = expenses.reduce((s: number, e: any) => s + e.amount, 0);
                return JSON.stringify({
                    type: "expenses_list",
                    count: expenses.length,
                    totalAmount: Math.round(totalAmount * 100) / 100,
                    filters: { search: search || null, startDate: startDate || null, endDate: endDate || null },
                    expenses: expenses.map((e: any) => ({
                        id: e.id, label: e.label, category: e.category,
                        description: e.description, amount: e.amount, taxAmount: e.taxAmount,
                        period: e.period, frequency: e.frequency, dueDate: e.dueDate,
                        isPaid: e.isPaid, paidDate: e.paidDate, paymentMethod: e.paymentMethod,
                        isRecurring: e.isRecurring, notes: e.notes,
                    }))
                });
            }
            case "create": {
                const entry = {
                    label: args.label || "Non spécifié",
                    category: args.category || "autre",
                    description: args.description || "",
                    amount: args.amount ?? 0,
                    taxAmount: args.taxAmount ?? 0,
                    period: args.period || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
                    frequency: args.frequency || "mensuel",
                    dueDate: args.dueDate || null,
                    isPaid: args.isPaid ?? false,
                    paidDate: args.paidDate || null,
                    paymentMethod: args.paymentMethod || null,
                    isRecurring: args.isRecurring ?? false,
                    notes: args.notes || null,
                };
                const [result] = await db.insert(suguExpenses).values(entry).returning();
                const { emitExpenseEvent } = await import("../interconnectEmitter");
                emitExpenseEvent("create", result);
                return JSON.stringify({ type: "expense_created", success: true, expense: result });
            }
            case "update": {
                if (!id) return JSON.stringify({ error: "ID requis pour modifier un frais" });
                const updates: Record<string, any> = {};
                for (const key of ["label", "category", "description", "amount", "taxAmount", "period", "frequency", "dueDate", "isPaid", "paidDate", "paymentMethod", "isRecurring", "notes"]) {
                    if (args[key] !== undefined) updates[key] = args[key];
                }
                if (Object.keys(updates).length === 0) return JSON.stringify({ error: "Aucune modification fournie" });
                const [result] = await db.update(suguExpenses).set(updates).where(eq(suguExpenses.id, id)).returning();
                if (!result) return JSON.stringify({ error: `Frais #${id} introuvable` });
                const { emitExpenseEvent: emitExpenseUpd } = await import("../interconnectEmitter");
                emitExpenseUpd("update", result);
                return JSON.stringify({ type: "expense_updated", success: true, expense: result });
            }
            case "delete": {
                if (!id) return JSON.stringify({ error: "ID requis pour supprimer un frais" });
                await db.delete(suguExpenses).where(eq(suguExpenses.id, id));
                const { emitExpenseEvent: emitExpenseDel } = await import("../interconnectEmitter");
                emitExpenseDel("delete", { deletedId: id });
                return JSON.stringify({ type: "expense_deleted", success: true, deletedId: id });
            }
            default:
                return JSON.stringify({ error: `Action inconnue: ${action}` });
        }
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[executeSuguExpensesManagement] Error:", msg);
        return JSON.stringify({ error: msg });
    }
}

// ═══════════════════════════════════════════════════════════════
// UNIFIED SUGU DATA SEARCH (cross-table)
// ═══════════════════════════════════════════════════════════════
export async function executeSearchSuguData(args: Record<string, any>): Promise<string> {
    try {
        const { db } = await import("../../db");
        const {
            suguBankEntries, suguPurchases, suguExpenses,
            suguCashRegister, suguPayroll, suguEmployees
        } = await import("../../../shared/schema");
        const { desc, ilike, and, gte, lte, or } = await import("drizzle-orm");

        const { search: rawSearch, query: rawQuery, startDate, endDate, tables: tablesStr } = args;
        const rawTerm = rawSearch || rawQuery || "";
        if (!rawTerm) return JSON.stringify({ error: "Paramètre 'search' ou 'query' requis" });
        const stripAccents = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const search = rawTerm;
        const searchNoAccent = stripAccents(rawTerm);
        const tablesToSearch = tablesStr ? tablesStr.split(",").map((t: string) => t.trim()) : ["bank", "purchases", "expenses", "cash", "payroll"];

        const results: Record<string, any> = { type: "sugu_search", query: search, filters: { startDate, endDate } };

        // BANK ENTRIES
        if (tablesToSearch.includes("bank")) {
            const searchCond = search !== searchNoAccent
                ? or(ilike(suguBankEntries.label, `%${search}%`), ilike(suguBankEntries.label, `%${searchNoAccent}%`))
                : ilike(suguBankEntries.label, `%${search}%`);
            const conditions: any[] = [searchCond];
            if (startDate) conditions.push(gte(suguBankEntries.entryDate, startDate));
            if (endDate) conditions.push(lte(suguBankEntries.entryDate, endDate));
            const bankResults = await db.select().from(suguBankEntries).where(and(...conditions)).orderBy(desc(suguBankEntries.entryDate)).limit(50);
            const bankTotal = bankResults.reduce((s: number, e: any) => s + e.amount, 0);
            results.bank = {
                count: bankResults.length,
                totalAmount: Math.round(bankTotal * 100) / 100,
                entries: bankResults.map((e: any) => ({
                    id: e.id, date: e.entryDate, label: e.label,
                    amount: e.amount, category: e.category, bank: e.bankName,
                }))
            };
        }

        // PURCHASES (fournisseurs)
        if (tablesToSearch.includes("purchases")) {
            const searchConditions = search !== searchNoAccent
                ? or(
                    ilike(suguPurchases.supplier, `%${search}%`),
                    ilike(suguPurchases.supplier, `%${searchNoAccent}%`),
                    ilike(suguPurchases.description, `%${search}%`),
                    ilike(suguPurchases.description, `%${searchNoAccent}%`)
                )
                : or(
                    ilike(suguPurchases.supplier, `%${search}%`),
                    ilike(suguPurchases.description, `%${search}%`)
                );
            const conditions: any[] = [searchConditions];
            if (startDate) conditions.push(gte(suguPurchases.invoiceDate, startDate));
            if (endDate) conditions.push(lte(suguPurchases.invoiceDate, endDate));
            const purchaseResults = await db.select().from(suguPurchases).where(and(...conditions)).orderBy(desc(suguPurchases.invoiceDate)).limit(50);
            const purchaseTotal = purchaseResults.reduce((s: number, p: any) => s + p.amount, 0);
            results.purchases = {
                count: purchaseResults.length,
                totalAmount: Math.round(purchaseTotal * 100) / 100,
                entries: purchaseResults.map((p: any) => ({
                    id: p.id, supplier: p.supplier, date: p.invoiceDate,
                    amount: p.amount, category: p.category, isPaid: p.isPaid,
                    invoiceNumber: p.invoiceNumber, description: p.description,
                }))
            };
        }

        // EXPENSES (frais généraux)
        if (tablesToSearch.includes("expenses")) {
            const expSearchCond = search !== searchNoAccent
                ? or(
                    ilike(suguExpenses.label, `%${search}%`),
                    ilike(suguExpenses.label, `%${searchNoAccent}%`),
                    ilike(suguExpenses.description, `%${search}%`),
                    ilike(suguExpenses.description, `%${searchNoAccent}%`),
                    ilike(suguExpenses.category, `%${search}%`),
                    ilike(suguExpenses.category, `%${searchNoAccent}%`)
                )
                : or(
                    ilike(suguExpenses.label, `%${search}%`),
                    ilike(suguExpenses.description, `%${search}%`),
                    ilike(suguExpenses.category, `%${search}%`)
                );
            const conditions: any[] = [expSearchCond];
            if (startDate) conditions.push(gte(suguExpenses.period, startDate.substring(0, 7)));
            if (endDate) conditions.push(lte(suguExpenses.period, endDate.substring(0, 7)));
            const expenseResults = await db.select().from(suguExpenses).where(and(...conditions)).orderBy(desc(suguExpenses.createdAt)).limit(50);
            const expenseTotal = expenseResults.reduce((s: number, e: any) => s + e.amount, 0);
            results.expenses = {
                count: expenseResults.length,
                totalAmount: Math.round(expenseTotal * 100) / 100,
                entries: expenseResults.map((e: any) => ({
                    id: e.id, label: e.label, period: e.period,
                    amount: e.amount, category: e.category, isPaid: e.isPaid,
                    description: e.description,
                }))
            };
        }

        // CASH REGISTER
        if (tablesToSearch.includes("cash")) {
            const conditions: any[] = [];
            if (startDate) conditions.push(gte(suguCashRegister.entryDate, startDate));
            if (endDate) conditions.push(lte(suguCashRegister.entryDate, endDate));
            if (search && !startDate && !endDate) {
                const cashSearchTerms = search !== searchNoAccent
                    ? or(
                        ilike(suguCashRegister.notes || '', `%${search}%`),
                        ilike(suguCashRegister.notes || '', `%${searchNoAccent}%`),
                        ilike(suguCashRegister.entryDate, `%${search}%`)
                    )
                    : or(
                        ilike(suguCashRegister.notes || '', `%${search}%`),
                        ilike(suguCashRegister.entryDate, `%${search}%`)
                    );
                conditions.push(cashSearchTerms);
            }
            if (conditions.length > 0) {
                const cashResults = await db.select().from(suguCashRegister).where(and(...conditions)).orderBy(desc(suguCashRegister.entryDate)).limit(50);
                const cashTotal = cashResults.reduce((s: number, c: any) => s + (c.totalRevenue || 0), 0);
                const ubereatsTotal = cashResults.reduce((s: number, c: any) => s + (c.ubereatsAmount || 0), 0);
                const deliverooTotal = cashResults.reduce((s: number, c: any) => s + (c.deliverooAmount || 0), 0);
                const cbzenTotal = cashResults.reduce((s: number, c: any) => s + (c.cbzenAmount || 0), 0);
                const cashAmountTotal = cashResults.reduce((s: number, c: any) => s + (c.cashAmount || 0), 0);
                const cbTotal = cashResults.reduce((s: number, c: any) => s + (c.cbAmount || 0), 0);
                const trTotal = cashResults.reduce((s: number, c: any) => s + (c.trAmount || 0), 0);
                results.cash = {
                    count: cashResults.length,
                    totalRevenue: Math.round(cashTotal * 100) / 100,
                    totauxParOrigine: {
                        uber_eats: Math.round(ubereatsTotal * 100) / 100,
                        deliveroo: Math.round(deliverooTotal * 100) / 100,
                        cbzen_zenorder: Math.round(cbzenTotal * 100) / 100,
                        especes: Math.round(cashAmountTotal * 100) / 100,
                        carte_bancaire: Math.round(cbTotal * 100) / 100,
                        ticket_restaurant: Math.round(trTotal * 100) / 100,
                    },
                    entries: cashResults.map((c: any) => ({
                        date: c.entryDate, revenue: c.totalRevenue, covers: c.coversCount,
                        uber_eats: c.ubereatsAmount || 0,
                        deliveroo: c.deliverooAmount || 0,
                        cbzen_zenorder: c.cbzenAmount || 0,
                        especes: c.cashAmount || 0,
                        carte_bancaire: c.cbAmount || 0,
                        ticket_restaurant: c.trAmount || 0,
                        cheque: c.chequeAmount || 0,
                        virement: c.virementAmount || 0,
                        online: c.onlineAmount || 0,
                    }))
                };
            }
        }

        // PAYROLL
        if (tablesToSearch.includes("payroll")) {
            // Get employees matching the search term
            const empSearchCond = search !== searchNoAccent
                ? or(
                    ilike(suguEmployees.firstName, `%${search}%`),
                    ilike(suguEmployees.firstName, `%${searchNoAccent}%`),
                    ilike(suguEmployees.lastName, `%${search}%`),
                    ilike(suguEmployees.lastName, `%${searchNoAccent}%`)
                )
                : or(
                    ilike(suguEmployees.firstName, `%${search}%`),
                    ilike(suguEmployees.lastName, `%${search}%`)
                );
            const matchingEmps = await db.select().from(suguEmployees)
                .where(empSearchCond);
            if (matchingEmps.length > 0) {
                const { eq, inArray } = await import("drizzle-orm");
                const empIds = matchingEmps.map((e: any) => e.id);
                const conditions: any[] = [inArray(suguPayroll.employeeId, empIds)];
                if (startDate) conditions.push(gte(suguPayroll.payPeriod, startDate.substring(0, 7)));
                if (endDate) conditions.push(lte(suguPayroll.payPeriod, endDate.substring(0, 7)));
                const payrollResults = await db.select().from(suguPayroll).where(and(...conditions)).orderBy(desc(suguPayroll.payPeriod)).limit(50);
                const payrollTotal = payrollResults.reduce((s: number, p: any) => s + p.grossAmount, 0);
                results.payroll = {
                    count: payrollResults.length,
                    totalGross: Math.round(payrollTotal * 100) / 100,
                    matchedEmployees: matchingEmps.map((e: any) => `${e.firstName} ${e.lastName}`),
                    entries: payrollResults.map((p: any) => ({
                        employeeId: p.employeeId, period: p.payPeriod,
                        gross: p.grossAmount, net: p.netAmount,
                    }))
                };
            }
        }

        // Summary
        let grandTotal = 0;
        let totalMatches = 0;
        for (const key of ["bank", "purchases", "expenses"]) {
            if (results[key]) {
                grandTotal += results[key].totalAmount;
                totalMatches += results[key].count;
            }
        }
        results.summary = {
            totalMatches,
            grandTotalAmount: Math.round(grandTotal * 100) / 100,
            searchTerm: search,
            period: startDate && endDate ? `${startDate} → ${endDate}` : "toutes périodes",
        };

        return JSON.stringify(results);
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[executeSearchSuguData] Error:", msg);
        return JSON.stringify({ error: msg });
    }
}

// ═══════════════════════════════════════════════════════════════
// EMPLOYEES MANAGEMENT
// ═══════════════════════════════════════════════════════════════
export async function executeSuguEmployeesManagement(args: Record<string, any>): Promise<string> {
    try {
        const { db } = await import("../../db");
        const { suguEmployees } = await import("../../../shared/schema");
        const { eq, desc, ilike, and, or } = await import("drizzle-orm");

        const { action, id, search, limit = 50 } = args;

        switch (action) {
            case "list": {
                const conditions: any[] = [];
                if (search) {
                    conditions.push(or(
                        ilike(suguEmployees.firstName, `%${search}%`),
                        ilike(suguEmployees.lastName, `%${search}%`),
                        ilike(suguEmployees.role, `%${search}%`)
                    ));
                }

                let query;
                if (conditions.length > 0) {
                    query = db.select().from(suguEmployees).where(and(...conditions)).orderBy(desc(suguEmployees.id)).limit(limit);
                } else {
                    query = db.select().from(suguEmployees).orderBy(desc(suguEmployees.id)).limit(limit);
                }
                const employees = await query;
                const activeCount = employees.filter((e: any) => e.isActive).length;
                return JSON.stringify({
                    type: "employees_list",
                    count: employees.length,
                    activeCount,
                    filters: { search: search || null },
                    employees: employees.map((e: any) => ({
                        id: e.id, firstName: e.firstName, lastName: e.lastName,
                        role: e.role, contractType: e.contractType,
                        monthlySalary: e.monthlySalary, hourlyRate: e.hourlyRate,
                        weeklyHours: e.weeklyHours, startDate: e.startDate,
                        endDate: e.endDate, isActive: e.isActive,
                        phone: e.phone, email: e.email, notes: e.notes,
                    }))
                });
            }
            case "create": {
                const entry = {
                    firstName: args.firstName || "Non spécifié",
                    lastName: args.lastName || "Non spécifié",
                    role: args.role || "Non spécifié",
                    contractType: args.contractType || "CDI",
                    monthlySalary: args.monthlySalary ?? null,
                    hourlyRate: args.hourlyRate ?? null,
                    weeklyHours: args.weeklyHours ?? 35,
                    startDate: args.startDate || new Date().toISOString().substring(0, 10),
                    endDate: args.endDate || null,
                    isActive: args.isActive ?? true,
                    phone: args.phone || null,
                    email: args.email || null,
                    notes: args.notes || null,
                };
                const [result] = await db.insert(suguEmployees).values(entry).returning();
                try { const { emitSuguEmployeesUpdated } = await import("../../services/realtimeSync"); emitSuguEmployeesUpdated(); } catch {}
                return JSON.stringify({ type: "employee_created", success: true, employee: result });
            }
            case "update": {
                if (!id) return JSON.stringify({ error: "ID requis pour modifier un employé" });
                const updates: Record<string, any> = {};
                for (const key of ["firstName", "lastName", "role", "contractType", "monthlySalary", "hourlyRate", "weeklyHours", "startDate", "endDate", "isActive", "phone", "email", "notes"]) {
                    if (args[key] !== undefined) updates[key] = args[key];
                }
                if (Object.keys(updates).length === 0) return JSON.stringify({ error: "Aucune modification fournie" });
                const [result] = await db.update(suguEmployees).set(updates).where(eq(suguEmployees.id, id)).returning();
                if (!result) return JSON.stringify({ error: `Employé #${id} introuvable` });
                try { const { emitSuguEmployeesUpdated } = await import("../../services/realtimeSync"); emitSuguEmployeesUpdated(); } catch {}
                return JSON.stringify({ type: "employee_updated", success: true, employee: result });
            }
            case "delete": {
                if (!id) return JSON.stringify({ error: "ID requis pour supprimer un employé" });
                await db.delete(suguEmployees).where(eq(suguEmployees.id, id));
                try { const { emitSuguEmployeesUpdated } = await import("../../services/realtimeSync"); emitSuguEmployeesUpdated(); } catch {}
                return JSON.stringify({ type: "employee_deleted", success: true, deletedId: id });
            }
            default:
                return JSON.stringify({ error: `Action inconnue: ${action}` });
        }
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[executeSuguEmployeesManagement] Error:", msg);
        return JSON.stringify({ error: msg });
    }
}

// ═══════════════════════════════════════════════════════════════
// PAYROLL MANAGEMENT
// ═══════════════════════════════════════════════════════════════
export async function executeSuguPayrollManagement(args: Record<string, any>): Promise<string> {
    try {
        const { db } = await import("../../db");
        const { suguPayroll, suguEmployees } = await import("../../../shared/schema");
        const { eq, desc, and, gte, lte, ilike } = await import("drizzle-orm");

        const { action, id, employeeId, search, startDate, endDate, limit = 50 } = args;

        switch (action) {
            case "list": {
                const conditions: any[] = [];
                if (employeeId) conditions.push(eq(suguPayroll.employeeId, employeeId));
                if (search) conditions.push(ilike(suguPayroll.period, `%${search}%`));
                if (startDate) conditions.push(gte(suguPayroll.period, startDate));
                if (endDate) conditions.push(lte(suguPayroll.period, endDate));

                let query;
                if (conditions.length > 0) {
                    query = db.select().from(suguPayroll).where(and(...conditions)).orderBy(desc(suguPayroll.period)).limit(limit);
                } else {
                    query = db.select().from(suguPayroll).orderBy(desc(suguPayroll.period)).limit(limit);
                }
                const payrolls = await query;
                const totalGross = payrolls.reduce((s: number, p: any) => s + (p.grossSalary || 0), 0);
                const totalNet = payrolls.reduce((s: number, p: any) => s + (p.netSalary || 0), 0);
                const unpaidCount = payrolls.filter((p: any) => !p.isPaid).length;

                // Enrich with employee names
                const empIds = [...new Set(payrolls.map((p: any) => p.employeeId))];
                const employees = empIds.length > 0 ? await db.select().from(suguEmployees) : [];
                const empMap: Record<number, string> = {};
                for (const e of employees) {
                    empMap[e.id] = `${(e as any).firstName} ${(e as any).lastName}`;
                }

                return JSON.stringify({
                    type: "payroll_list",
                    count: payrolls.length,
                    totalGross: Math.round(totalGross * 100) / 100,
                    totalNet: Math.round(totalNet * 100) / 100,
                    unpaidCount,
                    filters: { employeeId: employeeId || null, search: search || null, startDate: startDate || null, endDate: endDate || null },
                    payrolls: payrolls.map((p: any) => ({
                        id: p.id, employeeId: p.employeeId,
                        employeeName: empMap[p.employeeId] || `Employé #${p.employeeId}`,
                        period: p.period, grossSalary: p.grossSalary,
                        netSalary: p.netSalary, socialCharges: p.socialCharges,
                        bonus: p.bonus, overtime: p.overtime,
                        isPaid: p.isPaid, paidDate: p.paidDate, notes: p.notes,
                    }))
                });
            }
            case "create": {
                const entry = {
                    employeeId: args.employeeId,
                    period: args.period || new Date().toISOString().substring(0, 7),
                    grossSalary: args.grossSalary ?? 0,
                    netSalary: args.netSalary ?? 0,
                    socialCharges: args.socialCharges ?? 0,
                    bonus: args.bonus ?? 0,
                    overtime: args.overtime ?? 0,
                    isPaid: args.isPaid ?? false,
                    paidDate: args.paidDate || null,
                    notes: args.notes || null,
                };
                if (!entry.employeeId) return JSON.stringify({ error: "employeeId requis pour créer une fiche de paie" });
                const [result] = await db.insert(suguPayroll).values(entry).returning();
                try { const { emitSuguPayrollUpdated } = await import("../../services/realtimeSync"); emitSuguPayrollUpdated(); } catch {}
                return JSON.stringify({ type: "payroll_created", success: true, payroll: result });
            }
            case "update": {
                if (!id) return JSON.stringify({ error: "ID requis pour modifier une fiche de paie" });
                const updates: Record<string, any> = {};
                for (const key of ["employeeId", "period", "grossSalary", "netSalary", "socialCharges", "bonus", "overtime", "isPaid", "paidDate", "notes"]) {
                    if (args[key] !== undefined) updates[key] = args[key];
                }
                if (Object.keys(updates).length === 0) return JSON.stringify({ error: "Aucune modification fournie" });
                const [result] = await db.update(suguPayroll).set(updates).where(eq(suguPayroll.id, id)).returning();
                if (!result) return JSON.stringify({ error: `Fiche de paie #${id} introuvable` });
                try { const { emitSuguPayrollUpdated } = await import("../../services/realtimeSync"); emitSuguPayrollUpdated(); } catch {}
                return JSON.stringify({ type: "payroll_updated", success: true, payroll: result });
            }
            case "delete": {
                if (!id) return JSON.stringify({ error: "ID requis pour supprimer une fiche de paie" });
                await db.delete(suguPayroll).where(eq(suguPayroll.id, id));
                try { const { emitSuguPayrollUpdated } = await import("../../services/realtimeSync"); emitSuguPayrollUpdated(); } catch {}
                return JSON.stringify({ type: "payroll_deleted", success: true, deletedId: id });
            }
            default:
                return JSON.stringify({ error: `Action inconnue: ${action}` });
        }
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[executeSuguPayrollManagement] Error:", msg);
        return JSON.stringify({ error: msg });
    }
}

export async function executeQueryAppData(args: Record<string, any>): Promise<string> {
    try {
        const { db } = await import("../../db");
        const { sql, desc, eq, gte, lte, and, ilike } = await import("drizzle-orm");
        const schema = await import("../../../shared/schema");
        const { section, startDate, endDate, search, limit: lim = 50, year } = args;

        function dateFilter(table: any, field: any) {
            const conditions: any[] = [];
            if (startDate) conditions.push(gte(field, startDate));
            if (endDate) conditions.push(lte(field, endDate));
            return conditions.length > 0 ? and(...conditions) : undefined;
        }

        switch (section) {
            // ─── SUGUVAL EXTRAS ───
            case "suguval_cash": {
                let query = db.select().from(schema.suguCashRegister).orderBy(desc(schema.suguCashRegister.entryDate)).limit(lim);
                const rows = await query;
                const total = rows.reduce((s: number, r: any) => s + (r.totalRevenue || 0), 0);
                return JSON.stringify({ type: "suguval_cash", count: rows.length, totalRevenue: total, entries: rows.slice(0, 20).map((r: any) => ({ date: r.entryDate, total: r.totalRevenue, cash: r.cashAmount, cb: r.cbAmount, uber: r.uberAmount, deliveroo: r.deliverooAmount, covers: r.coversCount })) });
            }
            case "suguval_suppliers": {
                let rows = await db.select().from(schema.suguSuppliers).orderBy(desc(schema.suguSuppliers.createdAt));
                if (search) rows = rows.filter((r: any) => (r.name || "").toLowerCase().includes(search.toLowerCase()));
                return JSON.stringify({ type: "suguval_suppliers", count: rows.length, suppliers: rows.map((r: any) => ({ id: r.id, name: r.name, category: r.category, contact: r.contactName, phone: r.phone, email: r.email, paymentTerms: r.paymentTerms })) });
            }
            case "suguval_loans": {
                const rows = await db.select().from(schema.suguLoans);
                return JSON.stringify({ type: "suguval_loans", count: rows.length, totalRemaining: rows.reduce((s: number, l: any) => s + (l.remainingAmount || 0), 0), loans: rows.map((l: any) => ({ id: l.id, bankName: l.bankName, loanType: l.loanType, originalAmount: l.originalAmount, remainingAmount: l.remainingAmount, monthlyPayment: l.monthlyPayment, interestRate: l.interestRate, startDate: l.startDate, endDate: l.endDate })) });
            }
            case "suguval_absences": {
                const rows = await db.select().from(schema.suguAbsences).orderBy(desc(schema.suguAbsences.startDate));
                return JSON.stringify({ type: "suguval_absences", count: rows.length, absences: rows.slice(0, lim).map((a: any) => ({ id: a.id, employeeId: a.employeeId, type: a.type, startDate: a.startDate, endDate: a.endDate, days: a.days, reason: a.reason, status: a.status })) });
            }
            case "suguval_backups": {
                const rows = await db.select({ id: schema.suguBackups.id, label: schema.suguBackups.label, createdAt: schema.suguBackups.createdAt, tableCounts: schema.suguBackups.tableCounts, sizeBytes: schema.suguBackups.sizeBytes }).from(schema.suguBackups).orderBy(desc(schema.suguBackups.createdAt));
                return JSON.stringify({ type: "suguval_backups", count: rows.length, backups: rows.map((b: any) => ({ id: b.id, label: b.label, date: b.createdAt, size: b.sizeBytes, tables: b.tableCounts ? JSON.parse(b.tableCounts) : null })) });
            }
            case "suguval_audit": {
                const y = year || new Date().getFullYear().toString();
                const purchases = await db.select().from(schema.suguPurchases);
                const expenses = await db.select().from(schema.suguExpenses);
                const payrolls = await db.select().from(schema.suguPayroll);
                const bank = await db.select().from(schema.suguBankEntries);
                const cash = await db.select().from(schema.suguCashRegister);
                const totalPurchases = purchases.reduce((s: number, p: any) => s + p.amount, 0);
                const totalExpenses = expenses.reduce((s: number, e: any) => s + e.amount, 0);
                const totalPayroll = payrolls.reduce((s: number, p: any) => s + (p.grossSalary || 0) + (p.socialCharges || 0), 0);
                const totalRevenue = cash.reduce((s: number, c: any) => s + (c.totalRevenue || 0), 0);
                return JSON.stringify({ type: "suguval_audit", year: y, revenue: totalRevenue, purchases: totalPurchases, expenses: totalExpenses, payroll: totalPayroll, bankEntries: bank.length, cashDays: cash.length });
            }

            // ─── SUGUMAILLANE ───
            case "sugumaillane_overview": {
                const [purchases, expenses, bank, cash, employees, payrolls, absences] = await Promise.all([
                    db.select().from(schema.suguMaillanePurchases),
                    db.select().from(schema.suguMaillaneExpenses),
                    db.select().from(schema.suguMaillaneBankEntries),
                    db.select().from(schema.suguMaillaneCashRegister),
                    db.select().from(schema.suguMaillaneEmployees),
                    db.select().from(schema.suguMaillanePayroll),
                    db.select().from(schema.suguMaillaneAbsences),
                ]);
                return JSON.stringify({
                    type: "sugumaillane_overview", restaurant: "SUGU Maillane",
                    achats: { count: purchases.length, total: purchases.reduce((s: number, p: any) => s + p.amount, 0) },
                    frais: { count: expenses.length, total: expenses.reduce((s: number, e: any) => s + e.amount, 0) },
                    banque: { count: bank.length },
                    caisse: { count: cash.length, total: cash.reduce((s: number, c: any) => s + (c.totalRevenue || 0), 0) },
                    employes: { actifs: employees.filter((e: any) => e.isActive).length, total: employees.length },
                    paie: { count: payrolls.length },
                    absences: { count: absences.length },
                });
            }
            case "sugumaillane_purchases": {
                let rows = await db.select().from(schema.suguMaillanePurchases).orderBy(desc(schema.suguMaillanePurchases.invoiceDate)).limit(lim);
                if (search) rows = rows.filter((r: any) => (r.supplier || "").toLowerCase().includes(search.toLowerCase()) || (r.description || "").toLowerCase().includes(search.toLowerCase()));
                return JSON.stringify({ type: "sugumaillane_purchases", count: rows.length, total: rows.reduce((s: number, r: any) => s + r.amount, 0), purchases: rows.slice(0, 20).map((r: any) => ({ id: r.id, supplier: r.supplier, amount: r.amount, date: r.invoiceDate, category: r.category, isPaid: r.isPaid })) });
            }
            case "sugumaillane_expenses": {
                const rows = await db.select().from(schema.suguMaillaneExpenses).limit(lim);
                return JSON.stringify({ type: "sugumaillane_expenses", count: rows.length, total: rows.reduce((s: number, r: any) => s + r.amount, 0), expenses: rows.slice(0, 20).map((r: any) => ({ id: r.id, label: r.label, amount: r.amount, category: r.category, period: r.period })) });
            }
            case "sugumaillane_bank": {
                const rows = await db.select().from(schema.suguMaillaneBankEntries).orderBy(desc(schema.suguMaillaneBankEntries.entryDate)).limit(lim);
                return JSON.stringify({ type: "sugumaillane_bank", count: rows.length, entries: rows.slice(0, 20).map((r: any) => ({ id: r.id, date: r.entryDate, label: r.label, amount: r.amount, category: r.category })) });
            }
            case "sugumaillane_cash": {
                const rows = await db.select().from(schema.suguMaillaneCashRegister).orderBy(desc(schema.suguMaillaneCashRegister.entryDate)).limit(lim);
                return JSON.stringify({ type: "sugumaillane_cash", count: rows.length, totalRevenue: rows.reduce((s: number, r: any) => s + (r.totalRevenue || 0), 0), entries: rows.slice(0, 20).map((r: any) => ({ date: r.entryDate, total: r.totalRevenue, cash: r.cashAmount, cb: r.cbAmount, covers: r.coversCount })) });
            }
            case "sugumaillane_employees": {
                const rows = await db.select().from(schema.suguMaillaneEmployees);
                return JSON.stringify({ type: "sugumaillane_employees", count: rows.length, active: rows.filter((r: any) => r.isActive).length, employees: rows.map((r: any) => ({ id: r.id, name: `${r.firstName} ${r.lastName}`, role: r.role, contract: r.contractType, salary: r.monthlySalary, active: r.isActive })) });
            }
            case "sugumaillane_payroll": {
                const rows = await db.select().from(schema.suguMaillanePayroll).orderBy(desc(schema.suguMaillanePayroll.period)).limit(lim);
                return JSON.stringify({ type: "sugumaillane_payroll", count: rows.length, payrolls: rows.slice(0, 20).map((r: any) => ({ id: r.id, employeeId: r.employeeId, period: r.period, gross: r.grossSalary, net: r.netSalary, isPaid: r.isPaid })) });
            }
            case "sugumaillane_absences": {
                const rows = await db.select().from(schema.suguMaillaneAbsences).orderBy(desc(schema.suguMaillaneAbsences.startDate));
                return JSON.stringify({ type: "sugumaillane_absences", count: rows.length, absences: rows.slice(0, lim).map((a: any) => ({ id: a.id, employeeId: a.employeeId, type: a.type, start: a.startDate, end: a.endDate, days: a.days })) });
            }
            case "sugumaillane_suppliers": {
                const rows = await db.select().from(schema.suguMaillaneSuppliers);
                if (search) return JSON.stringify({ type: "sugumaillane_suppliers", count: rows.filter((r: any) => (r.name || "").toLowerCase().includes(search.toLowerCase())).length, suppliers: rows.filter((r: any) => (r.name || "").toLowerCase().includes(search.toLowerCase())).map((r: any) => ({ id: r.id, name: r.name, category: r.category })) });
                return JSON.stringify({ type: "sugumaillane_suppliers", count: rows.length, suppliers: rows.map((r: any) => ({ id: r.id, name: r.name, category: r.category, contact: r.contactName, phone: r.phone })) });
            }

            // ─── SYSTEM ───
            case "system_diagnostics": {
                const mem = process.memoryUsage();
                const uptime = process.uptime();
                return JSON.stringify({ type: "system_diagnostics", uptime: Math.round(uptime), uptimeHuman: `${Math.floor(uptime/3600)}h${Math.floor((uptime%3600)/60)}m`, memory: { rss: Math.round(mem.rss/1024/1024), heapUsed: Math.round(mem.heapUsed/1024/1024), heapTotal: Math.round(mem.heapTotal/1024/1024) }, nodeVersion: process.version, platform: process.platform });
            }
            case "system_metrics": {
                try {
                    const { db: dbCheck } = await import("../../db");
                    const dbResult = await dbCheck.execute(sql`SELECT count(*) as c FROM information_schema.tables WHERE table_schema = 'public'`);
                    const tableCount = (dbResult as any).rows?.[0]?.c || 0;
                    return JSON.stringify({ type: "system_metrics", dbTables: tableCount, memory: Math.round(process.memoryUsage().rss / 1024 / 1024), uptime: Math.round(process.uptime()) });
                } catch { return JSON.stringify({ type: "system_metrics", error: "DB check failed" }); }
            }

            // ─── APP NAVIGATION ───
            case "app_navigation": {
                return JSON.stringify({
                    type: "app_navigation",
                    pages: [
                        { url: "/", name: "Dashboard", description: "Accueil principal avec chat Ulysse, météo, voice" },
                        { url: "/suguval", name: "SUGU Valentine", description: "Gestion complète du restaurant Valentine", tabs: ["Dashboard", "Achats", "Frais Généraux", "Banque", "Journal de Caisse", "Gestion RH", "Fournisseurs", "Audits", "Comptabilité", "Archives", "HubRise"] },
                        { url: "/sugumaillane", name: "SUGU Maillane", description: "Gestion du restaurant Maillane", tabs: ["Dashboard", "Achats", "Frais Généraux", "Banque", "Journal de Caisse", "Gestion RH", "Fournisseurs", "Audits", "Archives"] },
                        { url: "/courses/suguval", name: "Courses Suguval", description: "Liste de courses quotidienne Valentine" },
                        { url: "/courses/sugumaillane", name: "Courses Maillane", description: "Liste de courses quotidienne Maillane" },
                        { url: "/sports/predictions", name: "Sports & Pronos", description: "Paris sportifs et analyses", tabs: ["Matchs", "Pronos", "Classements", "Buteurs", "Blessures"] },
                        { url: "/finances", name: "Finances", description: "Trading, actions, crypto, marché" },
                        { url: "/emails", name: "Emails", description: "Boîte mail avec AgentMail" },
                        { url: "/projects", name: "Projets", description: "Gestion de projets Kanban" },
                        { url: "/tasks", name: "Tâches", description: "Gestion de tâches (Todoist)" },
                        { url: "/notes", name: "Notes", description: "Prise de notes" },
                        { url: "/brain", name: "Brain Dashboard", description: "Mémoire et connaissances Ulysse" },
                        { url: "/ulysse-insights", name: "Insights", description: "Analyses et insights IA" },
                        { url: "/diagnostics", name: "Diagnostics", description: "Santé système et métriques" },
                        { url: "/settings", name: "Réglages", description: "Configuration voix, caméra, domotique" },
                        { url: "/security", name: "Sécurité", description: "Dashboard sécurité et surveillance" },
                        { url: "/talking-v2", name: "TalkingApp", description: "Interface vocale avancée" },
                        { url: "/max", name: "Max", description: "Interface externe avec PIN" },
                    ]
                });
            }

            default:
                return JSON.stringify({ error: `Section inconnue: ${section}. Sections disponibles: suguval_cash, suguval_suppliers, suguval_loans, suguval_absences, suguval_backups, suguval_audit, sugumaillane_overview, sugumaillane_purchases, sugumaillane_expenses, sugumaillane_bank, sugumaillane_cash, sugumaillane_employees, sugumaillane_payroll, sugumaillane_absences, sugumaillane_suppliers, system_diagnostics, system_metrics, app_navigation` });
        }
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[executeQueryAppData] Error:", msg);
        return JSON.stringify({ error: msg });
    }
}

export async function executeQueryAppToOrder(args: Record<string, any>): Promise<string> {
    const baseUrl = process.env.APPTOORDER_BASE_URL || "https://macommande.shop";
    const apiKey = process.env.APPTOORDER_API_KEY;
    const action = args.action || "health";

    if (action === "status" || action === "history" || action === "urls" || action === "monitor_now") {
        try {
            const { appToOrderMonitor } = await import("../appToOrderMonitorService");

            switch (action) {
                case "status": {
                    const latest = await appToOrderMonitor.getLatestStatus();
                    if (!latest) return JSON.stringify({ action, message: "Aucun check enregistré. Lancer action=monitor_now pour le premier cycle." });
                    return JSON.stringify({ action, ...latest });
                }
                case "history": {
                    const hours = args.hours || 24;
                    const history = await appToOrderMonitor.getHistory(hours);
                    return JSON.stringify({ action, hours, count: history.length, checks: history });
                }
                case "urls": {
                    const hours = args.hours || 24;
                    const urlHistory = await appToOrderMonitor.getUrlCheckHistory(hours);
                    return JSON.stringify({ action, hours, count: urlHistory.length, checks: urlHistory });
                }
                case "monitor_now": {
                    const result = await appToOrderMonitor.runFullCycle();
                    return JSON.stringify({
                        action,
                        health: result.health ? {
                            status: result.health.overallStatus,
                            checks: `${result.health.checksOk}/${result.health.totalChecks} OK`,
                            warnings: result.health.checksWarning,
                            errors: result.health.checksError,
                            restaurants: result.health.restaurantsCount,
                            orders: result.health.totalOrders,
                            todayOrders: result.health.todayOrders,
                            revenue: result.health.totalRevenue,
                            ssl: result.health.sslDaysRemaining !== null ? `${result.health.sslDaysRemaining}j` : "non vérifié",
                            dns: result.health.dnsResolves,
                            memory: `${result.health.memoryHeapMb}MB heap / ${result.health.memoryRssMb}MB RSS`,
                        } : { error: "health check failed" },
                        urls: {
                            total: result.urls.length,
                            accessible: result.urls.filter(u => u.isAccessible).length,
                            failed: result.urls.filter(u => !u.isAccessible).map(u => ({ url: u.url, error: u.errorMessage })),
                        },
                        schema: result.schema,
                    });
                }
            }
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            return JSON.stringify({ error: `Monitoring local error: ${msg}` });
        }
    }

    if (!apiKey) {
        return JSON.stringify({ error: "AppToOrder API key not configured (APPTOORDER_API_KEY)" });
    }

    const headers: Record<string, string> = {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
    };

    try {
        let endpoint: string;
        let method = "GET";
        let body: string | undefined;

        switch (action) {
            case "health":
                endpoint = "/api/health";
                break;
            case "schema":
                endpoint = "/api/health/schema";
                break;
            case "query": {
                if (!args.sql) {
                    return JSON.stringify({ error: "Le paramètre 'sql' est requis pour action=query" });
                }
                const sqlLower = args.sql.trim().toLowerCase();
                if (!sqlLower.startsWith("select") && !sqlLower.startsWith("with")) {
                    return JSON.stringify({ error: "Seules les requêtes SELECT sont autorisées (lecture seule)" });
                }
                endpoint = "/api/health/query";
                method = "POST";
                body = JSON.stringify({ sql: args.sql });
                break;
            }
            default:
                return JSON.stringify({ error: `Action inconnue: ${action}. Actions: health, schema, query, status, history, urls, monitor_now` });
        }

        const url = `${baseUrl}${endpoint}`;
        console.log(`[AppToOrder] ${method} ${url}`);

        const fetchOpts: RequestInit = { method, headers, signal: AbortSignal.timeout(20000) };
        if (body) fetchOpts.body = body;

        const res = await fetch(url, fetchOpts);
        const data = await res.json();

        if (!res.ok) {
            console.warn(`[AppToOrder] Error ${res.status}:`, JSON.stringify(data).substring(0, 200));
            return JSON.stringify({ error: `AppToOrder API error ${res.status}`, details: data });
        }

        console.log(`[AppToOrder] ${action} OK (${JSON.stringify(data).length} chars)`);
        return JSON.stringify({ action, ...data });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[AppToOrder] Error:`, msg);
        return JSON.stringify({ error: `AppToOrder connexion échouée: ${msg}` });
    }
}

export async function executeQueryCoba(args: Record<string, any>): Promise<string> {
    const action = args.action || "stats";
    const tenantId = args.tenant_id;
    const days = args.days || 7;

    try {
        const { maxCobaService } = await import("../maxCobaService");
        const db = (await import("../../db")).db;

        switch (action) {
            case "stats": {
                if (!tenantId) {
                    const allEvents = await db.execute(
                        `SELECT tenant_id, COUNT(*) as total, COUNT(CASE WHEN severity='error' THEN 1 END) as errors, COUNT(DISTINCT user_id) as users FROM coba_events WHERE created_at > NOW() - INTERVAL '${days} days' GROUP BY tenant_id`
                    );
                    return JSON.stringify({ action: "stats", period_days: days, tenants: allEvents.rows });
                }
                const stats = await maxCobaService.getStats(tenantId, days);
                return JSON.stringify({ action: "stats", tenant_id: tenantId, period_days: days, ...stats });
            }
            case "analyze": {
                if (!tenantId) return JSON.stringify({ error: "tenant_id requis pour l'analyse" });
                const report = await maxCobaService.generateReport(tenantId, days);
                return JSON.stringify({
                    action: "analyze",
                    tenant_id: tenantId,
                    period_days: days,
                    summary: report.summary,
                    insights: report.insights,
                    pdf_url: report.pdfUrl
                });
            }
            case "reports": {
                if (!tenantId) {
                    const allReports = await db.execute(
                        `SELECT id, tenant_id, period_start, period_end, pdf_url, created_at FROM coba_reports ORDER BY created_at DESC LIMIT 20`
                    );
                    return JSON.stringify({ action: "reports", reports: allReports.rows });
                }
                const reports = await maxCobaService.getReports(tenantId);
                return JSON.stringify({ action: "reports", tenant_id: tenantId, reports });
            }
            case "generate_report": {
                if (!tenantId) return JSON.stringify({ error: "tenant_id requis pour générer un rapport" });
                const report = await maxCobaService.generateReport(tenantId, days);
                return JSON.stringify({
                    action: "generate_report",
                    tenant_id: tenantId,
                    report_id: report.reportId,
                    pdf_url: report.pdfUrl,
                    summary: report.summary,
                    insights: report.insights
                });
            }
            case "events": {
                const whereClause = tenantId ? `AND tenant_id='${tenantId}'` : '';
                const events = await db.execute(
                    `SELECT id, tenant_id, event_type, severity, payload, user_id, session_id, created_at FROM coba_events WHERE created_at > NOW() - INTERVAL '${days} days' ${whereClause} ORDER BY created_at DESC LIMIT 100`
                );
                return JSON.stringify({ action: "events", period_days: days, tenant_id: tenantId || "all", count: events.rows.length, events: events.rows });
            }
            default:
                return JSON.stringify({ error: `Action COBA inconnue: ${action}` });
        }
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[COBA Tool] Error:", msg);
        return JSON.stringify({ error: `COBA erreur: ${msg}` });
    }
}

export async function executeCobaBusinessTool(args: Record<string, any>): Promise<string> {
    const action = args.action || "synthesis";
    const tenantId = args.tenant_id;
    const year = args.year;
    const data = args.data || {};
    const itemId = args.item_id;

    try {
        const { cobaBusinessService } = await import("../cobaBusinessService");

        if (action === "tenants") {
            const tenants = await cobaBusinessService.listRegisteredTenants();
            return JSON.stringify({ action: "tenants", tenants });
        }
        if (action === "overview") {
            const overview = await cobaBusinessService.getAllTenantsOverview(year);
            return JSON.stringify({ action: "overview", year: year || new Date().getFullYear().toString(), ...overview });
        }

        if (!tenantId) return JSON.stringify({ error: "tenant_id requis pour cette action" });

        switch (action) {
            case "synthesis":
                return JSON.stringify({ action, tenant_id: tenantId, ...(await cobaBusinessService.getFinancialSynthesis(tenantId, year)) });
            case "audit":
                return JSON.stringify({ action, tenant_id: tenantId, ...(await cobaBusinessService.getAuditOverview(tenantId, year)) });
            case "purchases":
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.listPurchases(tenantId, { year, isPaid: args.is_paid }) });
            case "add_purchase":
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.addPurchase(tenantId, data) });
            case "update_purchase":
                if (!itemId) return JSON.stringify({ error: "item_id requis" });
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.updatePurchase(tenantId, itemId, data) });
            case "delete_purchase":
                if (!itemId) return JSON.stringify({ error: "item_id requis" });
                await cobaBusinessService.deletePurchase(tenantId, itemId);
                return JSON.stringify({ action, tenant_id: tenantId, deleted: itemId });
            case "expenses":
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.listExpenses(tenantId, { year, category: args.category }) });
            case "add_expense":
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.addExpense(tenantId, data) });
            case "update_expense":
                if (!itemId) return JSON.stringify({ error: "item_id requis" });
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.updateExpense(tenantId, itemId, data) });
            case "delete_expense":
                if (!itemId) return JSON.stringify({ error: "item_id requis" });
                await cobaBusinessService.deleteExpense(tenantId, itemId);
                return JSON.stringify({ action, tenant_id: tenantId, deleted: itemId });
            case "bank":
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.listBankEntries(tenantId, { year }) });
            case "add_bank":
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.addBankEntry(tenantId, data) });
            case "update_bank":
                if (!itemId) return JSON.stringify({ error: "item_id requis" });
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.updateBankEntry(tenantId, itemId, data) });
            case "delete_bank":
                if (!itemId) return JSON.stringify({ error: "item_id requis" });
                await cobaBusinessService.deleteBankEntry(tenantId, itemId);
                return JSON.stringify({ action, tenant_id: tenantId, deleted: itemId });
            case "employees":
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.listEmployees(tenantId, true) });
            case "add_employee":
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.addEmployee(tenantId, data) });
            case "update_employee":
                if (!itemId) return JSON.stringify({ error: "item_id requis" });
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.updateEmployee(tenantId, itemId, data) });
            case "delete_employee":
                if (!itemId) return JSON.stringify({ error: "item_id requis" });
                await cobaBusinessService.deleteEmployee(tenantId, itemId);
                return JSON.stringify({ action, tenant_id: tenantId, deleted: itemId });
            case "payroll":
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.listPayroll(tenantId, { period: args.period, employeeId: args.employee_id }) });
            case "add_payroll":
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.addPayroll(tenantId, data) });
            case "update_payroll":
                if (!itemId) return JSON.stringify({ error: "item_id requis" });
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.updatePayroll(tenantId, itemId, data) });
            case "suppliers":
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.listSuppliers(tenantId, {}) });
            case "add_supplier":
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.addSupplier(tenantId, data) });
            case "update_supplier":
                if (!itemId) return JSON.stringify({ error: "item_id requis" });
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.updateSupplier(tenantId, itemId, data) });
            case "delete_supplier":
                if (!itemId) return JSON.stringify({ error: "item_id requis" });
                await cobaBusinessService.deleteSupplier(tenantId, itemId);
                return JSON.stringify({ action, tenant_id: tenantId, deleted: itemId });
            case "absences":
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.listAbsences(tenantId, { year, employeeId: args.employee_id }) });
            case "add_absence":
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.addAbsence(tenantId, data) });
            case "update_absence":
                if (!itemId) return JSON.stringify({ error: "item_id requis" });
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.updateAbsence(tenantId, itemId, data) });
            case "delete_absence":
                if (!itemId) return JSON.stringify({ error: "item_id requis" });
                await cobaBusinessService.deleteAbsence(tenantId, itemId);
                return JSON.stringify({ action, tenant_id: tenantId, deleted: itemId });
            case "loans":
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.listLoans(tenantId) });
            case "add_loan":
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.addLoan(tenantId, data) });
            case "update_loan":
                if (!itemId) return JSON.stringify({ error: "item_id requis" });
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.updateLoan(tenantId, itemId, data) });
            case "delete_loan":
                if (!itemId) return JSON.stringify({ error: "item_id requis" });
                await cobaBusinessService.deleteLoan(tenantId, itemId);
                return JSON.stringify({ action, tenant_id: tenantId, deleted: itemId });
            case "cash":
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.listCashEntries(tenantId, { year, month: args.period }) });
            case "add_cash":
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.addCashEntry(tenantId, data) });
            case "update_cash":
                if (!itemId) return JSON.stringify({ error: "item_id requis" });
                return JSON.stringify({ action, tenant_id: tenantId, data: await cobaBusinessService.updateCashEntry(tenantId, itemId, data) });
            case "delete_cash":
                if (!itemId) return JSON.stringify({ error: "item_id requis" });
                await cobaBusinessService.deleteCashEntry(tenantId, itemId);
                return JSON.stringify({ action, tenant_id: tenantId, deleted: itemId });
            default:
                return JSON.stringify({ error: `Action COBA Business inconnue: ${action}` });
        }
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[COBA-Business Tool] Error:", msg);
        return JSON.stringify({ error: `COBA Business erreur: ${msg}` });
    }
}

export async function executeSensoryHub(args: Record<string, any>, userId: number): Promise<string> {
    const action = args.action;
    try {
        switch (action) {
            case "vision_analyze": {
                const targetUrl = args.url;
                if (!targetUrl) return JSON.stringify({ error: "url requis pour vision_analyze" });
                const { captureScreenshot, analyzeWithVision } = await import("../scraper/screenshot");
                const { visionHub } = await import("../sensory/VisionHub");
                const startTime = Date.now();
                const prompt = args.prompt || "Analyse le design visuel de cette page: esthétique, couleurs, layout, typographie, UI/UX. Points forts, points faibles, suggestions. Note sur 10 par critère.";
                const screenshot = await captureScreenshot(targetUrl, { fullPage: false, waitMs: 4000, viewport: { width: 1920, height: 1080 } });
                if (!screenshot.success || !screenshot.imageBase64) {
                    return JSON.stringify({ error: "Screenshot échoué: " + (screenshot.error || "inconnu") });
                }
                const vision = await analyzeWithVision(screenshot.imageBase64, { prompt, maxTokens: 3000 });
                try { await visionHub.seeScreenshot(screenshot.imageBase64, targetUrl, userId, vision.analysis); } catch {}
                return JSON.stringify({
                    success: true,
                    action: "vision_analyze",
                    url: targetUrl,
                    designAnalysis: vision.analysis || "Analyse non disponible",
                    screenshotSize: Math.round((screenshot.imageBase64.length * 3) / 4 / 1024) + "KB",
                    processingMs: Date.now() - startTime
                });
            }
            case "vision_webpage": {
                const { visionHub } = await import("../sensory/VisionHub");
                const targetUrl = args.url || "unknown";
                const htmlContent = args.html_content;
                if (!htmlContent) return JSON.stringify({ error: "html_content requis pour vision_webpage" });
                const result = await visionHub.seeWebpage(htmlContent, targetUrl, userId);
                return JSON.stringify({
                    success: true,
                    action: "vision_webpage",
                    url: targetUrl,
                    text: result.text?.slice(0, 2000),
                    entities: result.entities,
                    insights: result.insights,
                    processingMs: result.processingMs
                });
            }
            case "vision_stats": {
                const { visionHub } = await import("../sensory/VisionHub");
                return JSON.stringify({ success: true, action: "vision_stats", stats: visionHub.getStats() });
            }
            case "hearing_stats": {
                const { hearingHub } = await import("../sensory/HearingHub");
                return JSON.stringify({ success: true, action: "hearing_stats", stats: hearingHub.getStats() });
            }
            case "brain_state": {
                const { brainHub } = await import("../sensory/BrainHub");
                const state = brainHub.getConsciousnessState();
                return JSON.stringify({ success: true, action: "brain_state", consciousness: state });
            }
            case "brain_stats": {
                const { brainHub } = await import("../sensory/BrainHub");
                const stats = brainHub.getStats();
                return JSON.stringify({ success: true, action: "brain_stats", stats });
            }
            case "sensory_summary": {
                const { sensorySystem } = await import("../sensory");
                const summary = sensorySystem.getSystemSummary();
                const recentEvents = sensorySystem.getRecentEvents(10);
                return JSON.stringify({
                    success: true,
                    action: "sensory_summary",
                    system: summary,
                    recentEvents: recentEvents.map(e => ({ type: e.type, timestamp: new Date(e.timestamp).toISOString() }))
                });
            }
            default:
                return JSON.stringify({ error: `Action sensorielle inconnue: ${action}` });
        }
    } catch (error: any) {
        console.error(`[SensoryHub] Error:`, error.message);
        return JSON.stringify({ error: `Erreur SensoryHub: ${error.message}` });
    }
}

export async function executeGenerateSelfReflection(userId: number): Promise<string> {
    try {
        console.log(`[SelfReflection] Generating journal for user ${userId}...`);
        const { generateSelfReflectionJournal, formatJournalForChat } = await import("../selfReflectionJournal");
        const journal = await generateSelfReflectionJournal(userId);
        const formatted = formatJournalForChat(journal);
        console.log(`[SelfReflection] Journal generated: ${journal.sections.codeModifications.suggestions.length} code suggestions, ${journal.sections.workflowImprovements.suggestions.length} workflow suggestions`);
        return formatted;
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[SelfReflection] Error:`, msg);
        return JSON.stringify({ error: `Erreur lors de la génération du journal: ${msg}` });
    }
}

export async function executeDevopsServer(args: Record<string, any>): Promise<string> {
    try {
        const { sshService } = await import("../sshService");
        const { action, appName, repoUrl, branch, port, buildCmd, startCmd, envVars, domain, command, lines, createDb, dbName, dbUser, dbPassword, ssl, forceStatic, copyEnvFrom, dryRun, instances, cronExpression, cronCommand, backupFile, caller, isStaging } = args;

        if (args._tenantContext?.isTenant) {
            const tenantBlockedActions = ['exec', 'cleanup_orphans', 'nginx_delete', 'nginx_create', 'nginx_reload', 'nginx_audit', 'nginx_catchall', 'cron_add', 'cron_delete', 'install_packages', 'security_scan', 'full_pipeline'];
            if (tenantBlockedActions.includes(action)) {
                console.warn(`[DevOpsServer] 🚫 BLOCKED action '${action}' for tenant userId=${args._tenantContext.tenantUserId}`);
                return JSON.stringify({ error: `Action '${action}' réservée aux administrateurs. Utilise les actions de gestion d'app (deploy, update, logs, restart, status, health, smoke_test, resource_usage, env_get, env_set).` });
            }
            if (appName && !['status', 'health', 'list_apps'].includes(action)) {
                const callerTag = args._tenantContext.projectId || args._tenantContext.tenantId;
                if (callerTag) {
                    const { db } = await import("../../db");
                    const { sql } = await import("drizzle-orm");
                    const [proj] = await db.execute(sql`
                        SELECT slug FROM devmax_projects
                        WHERE id = ${callerTag} OR tenant_id = ${callerTag}
                        LIMIT 5
                    `).then((r: any) => [r.rows || r]);
                    const allowedSlugs = (proj || []).map((p: any) => p.slug?.toLowerCase());
                    const appLower = appName.toLowerCase();
                    const isOwnApp = allowedSlugs.some((s: string) => appLower.includes(s) || s.includes(appLower));
                    if (!isOwnApp && allowedSlugs.length > 0) {
                        console.warn(`[DevOpsServer] 🚫 BLOCKED tenant access to app '${appName}' — not in tenant's projects: [${allowedSlugs.join(', ')}]`);
                        return JSON.stringify({ error: `Tu n'as accès qu'à tes propres apps. L'app '${appName}' ne fait pas partie de tes projets.` });
                    }
                }
            }
        }

        switch (action) {
            case "status": {
                const status = await sshService.serverStatus();
                return JSON.stringify({ action: "server_status", server: "65.21.209.102 (Hetzner AX42)", ...status });
            }
            case "health": {
                const health = await sshService.serverHealth();
                return JSON.stringify({ action: "health", server: "65.21.209.102 (Hetzner AX42)", report: health });
            }
            case "list_apps": {
                const apps = await sshService.getDeployedApps();
                return JSON.stringify({ action: "list_apps", apps });
            }
            case "app_info": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const info = await sshService.getAppInfo(appName);
                return JSON.stringify({ action: "app_info", appName, info });
            }
            case "deploy": {
                if (!repoUrl || !appName) return JSON.stringify({ error: "repoUrl et appName sont requis pour deploy" });
                const deployCaller = caller || "ulysse";
                const isStagingDeploy = isStaging || appName.endsWith("-staging") || appName.endsWith("-dev");
                const baseAppName = appName.replace(/-dev$/, "").replace(/-staging$/, "");

                const repoMatch0 = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
                if (repoMatch0) {
                    try {
                        const preflightLogs: string[] = [];
                        const { runSourceCodePreflight: preflightFn } = await import("../../routes/devopsMaxRoutes");
                        if (typeof preflightFn === "function") {
                            const ghToken = process.env.MAURICE_GITHUB_PAT || null;
                            const preflight = await preflightFn(repoMatch0[1], repoMatch0[2].replace(/\.git$/, ""), ghToken, preflightLogs);
                            if (preflight.blocking) {
                                return JSON.stringify({
                                    action: "deploy",
                                    success: false,
                                    message: `⛔ Preflight bloquant: ${preflight.issues.join(", ")}`,
                                    preflight,
                                    preflightLogs,
                                });
                            }
                            if (!preflight.pass) {
                                console.log(`[Deploy] Preflight warnings: ${preflight.issues.join(", ")}`);
                            }
                        }
                    } catch (pfErr: any) {
                        console.log(`[Deploy] Preflight check skipped: ${pfErr.message?.slice(0, 100)}`);
                    }
                }
                let resolvedDevmaxProjectId: string | undefined;
                if (!copyEnvFrom) {
                    try {
                        const { db: deployDb } = await import("../../db");
                        const { sql: deploySql } = await import("drizzle-orm");
                        const [matchedProject] = await deployDb.execute(deploySql`
                            SELECT id FROM devmax_projects WHERE deploy_slug = ${baseAppName} LIMIT 1
                        `).then((r: any) => r.rows || r);
                        if (matchedProject?.id) {
                            resolvedDevmaxProjectId = matchedProject.id;
                            console.log(`[Deploy] Auto-resolved DevMax project: ${baseAppName} → ${matchedProject.id}`);
                        }
                    } catch {}
                }
                let result: any;
                if (isStagingDeploy) {
                    console.log(`[Deploy] Staging deploy detected for ${baseAppName}`);
                    result = await sshService.deployStagingApp({ repoUrl, appName: baseAppName, branch, port, buildCmd, startCmd, envVars, createDb, dbName, dbUser, dbPassword, caller: deployCaller, devmaxProjectId: resolvedDevmaxProjectId });
                } else {
                    result = await sshService.deployApp({ repoUrl, appName, branch, port, buildCmd, startCmd, envVars, domain, createDb, dbName, dbUser, dbPassword, ssl, forceStatic, caller: deployCaller, copyEnvFrom, devmaxProjectId: resolvedDevmaxProjectId });
                }
                if (result.success) {
                    try {
                        const deployedDomain = isStagingDeploy ? `${baseAppName}-dev.ulyssepro.org` : (domain || `${appName}.ulyssepro.org`);
                        const ulysseUrl = `https://${deployedDomain}`;
                        const repoMatch = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
                        if (repoMatch) {
                            const repoKey = `${repoMatch[1]}/${repoMatch[2]}`;
                            const { devopsDeployUrls: dduDeploy } = await import("@shared/schema");
                            const { eq: eqDeploy } = await import("drizzle-orm");
                            const { db } = await import("../../db");
                            const existing = await db.select().from(dduDeploy).where(eqDeploy(dduDeploy.repoFullName, repoKey));
                            const existingUrls = existing.map(r => r.url);
                            if (!existingUrls.includes(ulysseUrl)) {
                                await db.insert(dduDeploy).values({ repoFullName: repoKey, url: ulysseUrl });
                            }
                        }
                    } catch (e) {
                        console.error("[Deploy] Auto-save URL failed:", e);
                    }
                    if (resolvedDevmaxProjectId) {
                        try {
                            const { db: usageDb } = await import("../../db");
                            const { sql: usageSql } = await import("drizzle-orm");
                            const [proj] = await usageDb.execute(usageSql`SELECT tenant_id FROM devmax_projects WHERE id = ${resolvedDevmaxProjectId}`).then((r: any) => r.rows || r);
                            if (proj?.tenant_id) {
                                await usageDb.execute(usageSql`INSERT INTO devmax_usage_logs (tenant_id, action, details) VALUES (${proj.tenant_id}, 'deploy', ${JSON.stringify({ projectId: resolvedDevmaxProjectId, environment: isStagingDeploy ? "staging" : "production", appName: baseAppName })})`).catch(() => {});
                            }
                        } catch {}
                    }
                }
                if (result.success) {
                    const repoMatch = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
                    if (repoMatch) {
                        devopsAutoJournal(`${repoMatch[1]}/${repoMatch[2]}`, "deploy", `Deploy ${isStagingDeploy ? "staging" : "production"}: ${appName}`, `Branche: ${branch || "main"}, URL: ${isStagingDeploy ? `${baseAppName}-dev.ulyssepro.org` : `${appName}.ulyssepro.org`}`, [], { environment: isStagingDeploy ? "staging" : "production", appName, branch: branch || "main" });
                    }
                }
                return JSON.stringify({ action: "deploy", ...result });
            }
            case "update": {
                if (!appName) return JSON.stringify({ error: "appName requis pour update" });
                const updateCaller = caller || "ulysse";
                const result = await sshService.updateApp(appName, branch || "main", updateCaller as "max" | "ulysse" | "iris");
                if (result.success) {
                    devopsAutoJournal(appName, "deploy", `Update: ${appName}`, `git pull + rebuild sur branche ${branch || "main"}`, [], { appName, branch: branch || "main" });
                }
                return JSON.stringify({ action: "update", ...result });
            }
            case "logs": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const logOutput = await sshService.appLogs(appName, lines || 50);
                return JSON.stringify({ action: "logs", appName, logs: logOutput });
            }
            case "restart": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const output = await sshService.restartApp(appName);
                return JSON.stringify({ action: "restart", appName, output });
            }
            case "stop": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const output = await sshService.stopApp(appName);
                return JSON.stringify({ action: "stop", appName, output });
            }
            case "delete": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const output = await sshService.deleteApp(appName);
                return JSON.stringify({ action: "delete", appName, output });
            }
            case "cleanup_orphans": {
                const dryRun = args.dryRun !== false;
                const result = await sshService.cleanupOrphanedApps(dryRun);
                return JSON.stringify({ action: "cleanup_orphans", dryRun, ...result });
            }
            case "scale": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                if (!instances) return JSON.stringify({ error: "instances requis (ex: 2, 4)" });
                const output = await sshService.scaleApp(appName, instances);
                return JSON.stringify({ action: "scale", appName, instances, output });
            }
            case "exec": {
                if (args._tenantContext?.isTenant) {
                    console.warn(`[DevOpsServer] 🚫 BLOCKED exec for tenant userId=${args._tenantContext.tenantUserId} — tenants cannot run arbitrary commands`);
                    return JSON.stringify({ error: "Action 'exec' non disponible pour les tenants. Utilise les actions spécifiques (deploy, update, logs, restart, status, health, smoke_test, resource_usage) pour gérer ton app." });
                }
                if (!command) return JSON.stringify({ error: "command requis pour exec" });
                const dangerousPatterns = /rm\s+-rf\s+\/[^v]|mkfs|dd\s+if=|>\s*\/dev\/sd|shutdown|reboot|halt|init\s+[06]|:(){ :|fork|chmod\s+-R\s+777\s+\/|chown.*\/etc|curl.*\|\s*bash|wget.*\|\s*sh/i;
                if (dangerousPatterns.test(command)) {
                    devopsDiscordNotify("Commande dangereuse bloquée", `\`${command.slice(0, 100)}\``, "error");
                    return JSON.stringify({ error: "Commande bloquée: pattern dangereux détecté. Seules les commandes sûres sont autorisées." });
                }
                const ulysseProtectedOps = /(?:cd\s+)?\/var\/www\/ulysse(?:\/|\s|$).*(?:npm\s+(?:run\s+build|install|ci)|rm\s|rmdir|clean|build|make)/i;
                const ulysseDistWrite = /(?:rm|mv|cp|>|>>|tee|truncate|dd).*\/var\/www\/ulysse\/dist/i;
                const ulysseRmDist = /\/var\/www\/ulysse\/dist.*(?:rm|rmdir|clean)/i;
                const execCaller = caller || "ulysse";
                if (execCaller !== "ulysse" && (ulysseProtectedOps.test(command) || ulysseDistWrite.test(command) || ulysseRmDist.test(command))) {
                    console.warn(`[DevOpsServer] 🚫 BLOCKED exec targeting /var/www/ulysse from caller=${execCaller}: ${command.slice(0, 150)}`);
                    devopsDiscordNotify("Commande Ulysse bloquée", `Caller: ${execCaller}\n\`${command.slice(0, 100)}\``, "error");
                    return JSON.stringify({ error: "BLOCKED: Les commandes modifiant /var/www/ulysse/ sont réservées à Ulysse uniquement. Les projets DevMax doivent utiliser /var/www/apps/<nom>." });
                }
                const result = await sshService.executeCommand(command, 30000);
                return JSON.stringify({ action: "exec", ...result });
            }
            case "ssl": {
                if (!domain) return JSON.stringify({ error: "domain requis pour ssl" });
                const output = await sshService.setupSSL(domain);
                return JSON.stringify({ action: "ssl", domain, output });
            }
            case "env_get": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                return await sshService.manageEnv(appName, "get");
            }
            case "env_set": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                if (!envVars || Object.keys(envVars).length === 0) return JSON.stringify({ error: "envVars requis (objet clé=valeur)" });
                const setResult = await sshService.manageEnv(appName, "set", envVars);
                return setResult;
            }
            case "env_delete": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                if (!envVars || Object.keys(envVars).length === 0) return JSON.stringify({ error: "envVars requis (clés à supprimer)" });
                return await sshService.manageEnv(appName, "delete", envVars);
            }
            case "list_databases": {
                return await sshService.listDatabases();
            }
            case "backup_db": {
                if (!dbName) return JSON.stringify({ error: "dbName requis" });
                return await sshService.backupDb(dbName);
            }
            case "restore_db": {
                if (!dbName) return JSON.stringify({ error: "dbName requis" });
                if (!backupFile) return JSON.stringify({ error: "backupFile requis (chemin du fichier .sql.gz)" });
                return await sshService.restoreDb(dbName, backupFile);
            }
            case "list_backups": {
                return await sshService.listBackups();
            }
            case "nginx_configs": {
                return await sshService.getNginxConfigs();
            }
            case "nginx_create": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const nginxType = args.nginxType || (args.port ? "proxy" : "static");
                const result = await sshService.nginxCreate({
                    appName,
                    domain: args.domain,
                    type: nginxType,
                    rootDir: args.rootDir,
                    port: args.port,
                    isStaging: args.isStaging || false,
                });
                return JSON.stringify(result);
            }
            case "nginx_delete": {
                const configName = appName || args.domain;
                if (!configName) return JSON.stringify({ error: "appName requis (nom de la config à supprimer)" });
                const result = await sshService.nginxDelete(configName);
                return JSON.stringify(result);
            }
            case "nginx_show": {
                const configName = appName || args.domain;
                if (!configName) return JSON.stringify({ error: "appName requis (nom de la config à afficher)" });
                const result = await sshService.nginxShow(configName);
                return JSON.stringify(result);
            }
            case "nginx_test": {
                const result = await sshService.nginxTest();
                return JSON.stringify(result);
            }
            case "nginx_reload": {
                const result = await sshService.nginxReload();
                return JSON.stringify(result);
            }
            case "nginx_logs": {
                const configName = appName || args.domain;
                if (!configName) return JSON.stringify({ error: "appName requis" });
                const result = await sshService.nginxLogs(configName, args.lines || 50, args.logType || "both");
                return JSON.stringify(result);
            }
            case "ssl_status": {
                const result = await sshService.sslStatus(args.domain);
                return JSON.stringify(result);
            }
            case "ssl_renew": {
                const result = await sshService.sslRenew(args.domain);
                return JSON.stringify(result);
            }
            case "nginx_audit": {
                const audit = await sshService.auditNginxConfigs();
                return JSON.stringify(audit);
            }
            case "nginx_catchall": {
                const catchall = await sshService.setupDefaultCatchall();
                return JSON.stringify(catchall);
            }
            case "verify_url": {
                const domain = appName || args.domain;
                if (!domain) return JSON.stringify({ error: "appName ou domain requis (ex: monapp.ulyssepro.org)" });
                const verify = await sshService.verifyDeployedUrl(domain);
                return JSON.stringify(verify);
            }
            case "url_diagnose": {
                let diagAppName = appName || (args.domain ? args.domain.replace(/\.ulyssepro\.org$/, '').replace(/-dev$/, '') : null);
                if (!diagAppName && args.repo) diagAppName = args.repo.toLowerCase();
                if (!diagAppName && args.url) {
                  const urlMatch = args.url.match(/^https?:\/\/([^.]+)\.ulyssepro\.org/);
                  if (urlMatch) diagAppName = urlMatch[1].replace(/-dev$/, '');
                }
                const diagDomain = args.domain || (diagAppName ? `${diagAppName}.ulyssepro.org` : null);
                if (!diagDomain) return JSON.stringify({ error: "domain ou appName requis. Exemple: appName='tetrisgame' ou domain='tetrisgame.ulyssepro.org'" });
                const result = await sshService.diagnoseAndFixUrl({
                    domain: diagDomain,
                    appName: diagAppName || diagDomain.split(".")[0],
                    autoFix: args.autoFix !== false,
                    repoUrl: args.repoUrl,
                    caller: caller || "max",
                });
                return JSON.stringify(result);
            }
            case "url_diagnose_all": {
                let resolvedAppName = appName;
                if (!resolvedAppName && args.domain) resolvedAppName = args.domain.replace(/\.ulyssepro\.org$/, '').replace(/-dev$/, '');
                if (!resolvedAppName && args.repo) resolvedAppName = args.repo.toLowerCase();
                if (!resolvedAppName && args.url) {
                  const urlMatch = args.url.match(/^https?:\/\/([^.]+)\.ulyssepro\.org/);
                  if (urlMatch) resolvedAppName = urlMatch[1].replace(/-dev$/, '');
                }
                if (!resolvedAppName) return JSON.stringify({ error: "appName requis (slug du projet). Exemple: appName='tetrisgame'" });
                const stagingDomain = `${resolvedAppName}-dev.ulyssepro.org`;
                const prodDomain = `${resolvedAppName}.ulyssepro.org`;
                const stagingResult = await sshService.diagnoseAndFixUrl({
                    domain: stagingDomain,
                    appName: resolvedAppName,
                    autoFix: args.autoFix !== false,
                    repoUrl: args.repoUrl,
                    caller: caller || "max",
                });
                const prodResult = await sshService.diagnoseAndFixUrl({
                    domain: prodDomain,
                    appName: resolvedAppName,
                    autoFix: args.autoFix !== false,
                    repoUrl: args.repoUrl,
                    caller: caller || "max",
                });
                return JSON.stringify({
                    action: "url_diagnose_all",
                    appName: resolvedAppName,
                    staging: stagingResult,
                    production: prodResult,
                    allHealthy: stagingResult.success && prodResult.success,
                    summary: `Staging: ${stagingResult.finalStatus}\nProduction: ${prodResult.finalStatus}`
                });
            }
            case "cron_list": {
                return await sshService.manageCron("list");
            }
            case "cron_add": {
                if (!cronExpression || !cronCommand) return JSON.stringify({ error: "cronExpression et cronCommand requis" });
                return await sshService.manageCron("add", cronExpression, cronCommand);
            }
            case "cron_delete": {
                if (!cronCommand) return JSON.stringify({ error: "cronCommand requis (pattern à supprimer)" });
                return await sshService.manageCron("delete", undefined, cronCommand);
            }
            case "install_packages": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const sanitizedAppName = appName.replace(/[^a-zA-Z0-9_-]/g, "");
                if (sanitizedAppName !== appName) return JSON.stringify({ error: "appName contient des caractères non autorisés" });
                const appDir = `/var/www/apps/${sanitizedAppName}`;
                const packageManager = await sshService.executeCommand(`test -f ${appDir}/yarn.lock && echo "yarn" || echo "npm"`, 5000);
                const pm = packageManager.output?.trim() === "yarn" ? "yarn" : "npm";
                let extraPkgs = "";
                if (command) {
                    const pkgNames = command.split(/\s+/).filter((p: string) => /^@?[a-zA-Z0-9][\w./-]*(@[\w.^~>=<*|-]+)?$/.test(p));
                    if (pkgNames.length === 0) return JSON.stringify({ error: "Noms de packages invalides. Utilisez des noms npm valides." });
                    extraPkgs = ` ${pkgNames.join(" ")}`;
                }
                const installCmd = pm === "yarn" ? `cd ${appDir} && yarn install${extraPkgs ? ` && yarn add${extraPkgs}` : ""} 2>&1 | tail -20` : `cd ${appDir} && npm install${extraPkgs ? ` && npm install${extraPkgs}` : ""} 2>&1 | tail -20`;
                const installResult = await sshService.executeCommand(installCmd, 120000);
                return JSON.stringify({ action: "install_packages", appName: sanitizedAppName, packageManager: pm, extraPackages: extraPkgs.trim() || null, success: installResult.success, output: installResult.output, error: installResult.error });
            }
            case "run_tests": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const sanitizedApp = appName.replace(/[^a-zA-Z0-9_-]/g, "");
                if (sanitizedApp !== appName) return JSON.stringify({ error: "appName contient des caractères non autorisés" });

                if (command === "protocol" || command === "test-protocol" || command === "full") {
                    const { runPreDeployTests, runPostDeployTests } = await import("../../routes/devopsMaxRoutes.testUtils");
                    const env = (query as string)?.includes("prod") ? "production" : "staging";
                    const preTests = await runPreDeployTests(sanitizedApp, sshService);
                    const postTests = await runPostDeployTests(sanitizedApp, env as "staging" | "production", sshService);
                    const allTests = [...preTests.tests, ...postTests.tests];
                    const totalPassed = allTests.filter((t: any) => t.pass).length;
                    const totalFailed = allTests.filter((t: any) => !t.pass).length;
                    const lines: string[] = [];
                    lines.push(`PRE-DEPLOY (${preTests.passed}/${preTests.total}):`);
                    preTests.tests.forEach((t: any) => lines.push(`  ${t.pass ? "✅" : "❌"} ${t.name}: ${t.detail}`));
                    lines.push(`POST-DEPLOY ${env.toUpperCase()} (${postTests.passed}/${postTests.total}):`);
                    postTests.tests.forEach((t: any) => lines.push(`  ${t.pass ? "✅" : "❌"} ${t.name}: ${t.detail}`));
                    return JSON.stringify({ action: "run_tests", mode: "protocol", appName: sanitizedApp, environment: env, totalPassed, totalFailed, totalTests: allTests.length, summary: lines.join("\n"), preDeployTests: preTests, postDeployTests: postTests });
                }

                const appDir = `/var/www/apps/${sanitizedApp}`;
                const testScriptCheck = await sshService.executeCommand(`cd ${appDir} && node -e "const p=require('./package.json'); const s=p.scripts||{}; console.log(JSON.stringify({test:!!s.test,vitest:!!s.vitest,'test:unit':!!s['test:unit'],'test:e2e':!!s['test:e2e'],lint:!!s.lint,typecheck:!!s.typecheck||!!s['type-check']}))" 2>/dev/null`, 5000);
                let availableScripts = {};
                try { availableScripts = JSON.parse(testScriptCheck.output || "{}"); } catch {}
                const testCmd = command || "test";
                const allowedScripts = ["test", "vitest", "test:unit", "test:e2e", "lint", "typecheck", "type-check"];
                if (!allowedScripts.includes(testCmd)) return JSON.stringify({ error: `Script "${testCmd}" non autorisé. Utilisez: ${allowedScripts.join(", ")}` });
                const testResult = await sshService.executeCommand(`cd ${appDir} && npm run ${testCmd} 2>&1 | tail -50`, 120000);
                return JSON.stringify({ action: "run_tests", appName: sanitizedApp, script: testCmd, availableScripts, success: testResult.success, output: testResult.output, error: testResult.error });
            }
            case "run_tests_local": {
                const checks: Array<{ name: string; pass: boolean; output: string; duration: number }> = [];
                const runLocal = async (name: string, cmd: string, timeoutMs = 60000): Promise<void> => {
                    const start = Date.now();
                    try {
                        const { execSync } = await import("child_process");
                        const out = execSync(cmd, { timeout: timeoutMs, cwd: process.cwd(), encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
                        checks.push({ name, pass: true, output: (out || "").slice(-500), duration: Date.now() - start });
                    } catch (e: any) {
                        const stderr = e.stderr ? String(e.stderr).slice(-500) : "";
                        const stdout = e.stdout ? String(e.stdout).slice(-500) : "";
                        checks.push({ name, pass: false, output: stderr || stdout || e.message?.slice(0, 300) || "unknown error", duration: Date.now() - start });
                    }
                };

                const suite = command || "all";
                if (suite === "all" || suite === "typecheck") {
                    await runLocal("TypeScript typecheck", "npx tsc --noEmit --pretty 2>&1 | tail -30", 90000);
                }
                if (suite === "all" || suite === "vitest") {
                    await runLocal("Vitest unit tests", "npx vitest run --reporter=verbose 2>&1 | tail -50", 120000);
                }
                if (suite === "all" || suite === "lint") {
                    await runLocal("ESLint", "npx eslint . --ext .ts,.tsx --max-warnings=50 2>&1 | tail -30", 60000);
                }
                if (suite === "all" || suite === "build") {
                    await runLocal("Build check", "npx vite build --mode development 2>&1 | tail -20", 120000);
                }

                const passed = checks.filter(c => c.pass).length;
                const failed = checks.filter(c => !c.pass).length;
                const summary = checks.map(c => `${c.pass ? "✅" : "❌"} ${c.name} (${c.duration}ms)${c.pass ? "" : "\n   " + c.output.split("\n").slice(0, 5).join("\n   ")}`).join("\n");

                return JSON.stringify({ action: "run_tests_local", suite, totalChecks: checks.length, passed, failed, allPassed: failed === 0, summary, checks });
            }
            case "analyze_deps": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const appDir = `/var/www/apps/${appName}`;
                const auditResult = await sshService.executeCommand(`cd ${appDir} && npm audit --json 2>/dev/null | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const j=JSON.parse(d);console.log(JSON.stringify({vulnerabilities:j.metadata?.vulnerabilities||{},total:j.metadata?.totalDependencies||0}))" 2>/dev/null || echo '{"error":"audit failed"}'`, 30000);
                const outdatedResult = await sshService.executeCommand(`cd ${appDir} && npm outdated --json 2>/dev/null | head -100 || echo '{}'`, 30000);
                const sizeResult = await sshService.executeCommand(`du -sh ${appDir}/node_modules 2>/dev/null | awk '{print $1}'`, 5000);
                const depCount = await sshService.executeCommand(`cd ${appDir} && node -e "const p=require('./package.json');console.log(JSON.stringify({deps:Object.keys(p.dependencies||{}).length,devDeps:Object.keys(p.devDependencies||{}).length}))" 2>/dev/null`, 5000);
                let audit = {}, outdated = {}, counts = {};
                try { audit = JSON.parse(auditResult.output || "{}"); } catch {}
                try { outdated = JSON.parse(outdatedResult.output || "{}"); } catch {}
                try { counts = JSON.parse(depCount.output || "{}"); } catch {}
                return JSON.stringify({ action: "analyze_deps", appName, audit, outdated, nodeModulesSize: sizeResult.output?.trim(), counts });
            }
            case "debug_app": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const appDir = `/var/www/apps/${appName}`;
                const debugScript = [
                    `echo "=== PM2 STATUS ===" && pm2 describe ${appName} 2>/dev/null | head -20 || echo "Not in PM2"`,
                    `echo "=== RECENT LOGS (last 30 lines) ===" && pm2 logs ${appName} --nostream --lines 30 2>/dev/null || echo "No PM2 logs"`,
                    `echo "=== ERROR PATTERNS ===" && pm2 logs ${appName} --nostream --lines 200 2>/dev/null | grep -iE "error|exception|fatal|crash|ENOENT|ECONNREFUSED|EADDRINUSE|TypeError|ReferenceError|SyntaxError" | tail -20 || echo "No errors found"`,
                    `echo "=== PORT CHECK ===" && (grep -rhoP 'PORT.*?\\K[0-9]{4,5}' ${appDir}/.env ${appDir}/ecosystem.config.cjs 2>/dev/null || echo "No port found") && ss -tlnp 2>/dev/null | grep -E "$(grep -rhoP 'PORT.*?\\K[0-9]{4,5}' ${appDir}/.env 2>/dev/null || echo '99999')" || echo "Port not listening"`,
                    `echo "=== NGINX CONFIG ===" && cat /etc/nginx/sites-enabled/${appName} 2>/dev/null | head -30 || cat /etc/nginx/sites-enabled/${appName}.ulyssepro.org 2>/dev/null | head -30 || echo "No nginx config"`,
                    `echo "=== DISK USAGE ===" && du -sh ${appDir} 2>/dev/null`,
                    `echo "=== GIT STATUS ===" && cd ${appDir} && git log --oneline -5 2>/dev/null || echo "Not a git repo"`,
                    `echo "=== HEALTH CHECK ===" && (PORT=$(grep -rhoP 'PORT.*?\\K[0-9]{4,5}' ${appDir}/.env 2>/dev/null | head -1); curl -s -o /dev/null -w "HTTP %{http_code} (%{time_total}s)" http://127.0.0.1:$PORT/ 2>/dev/null || echo "Health check failed")`
                ].join(" ; ");
                const debugResult = await sshService.executeCommand(debugScript, 30000);
                return JSON.stringify({ action: "debug_app", appName, diagnostic: debugResult.output, success: debugResult.success });
            }
            case "refactor_check": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const appDir = `/var/www/apps/${appName}`;
                const refactorScript = [
                    `echo "=== FILE STATS ===" && find ${appDir}/src ${appDir}/client ${appDir}/server -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" 2>/dev/null | head -200 | xargs wc -l 2>/dev/null | sort -rn | head -20`,
                    `echo "=== LARGE FILES (>500 lines) ===" && find ${appDir}/src ${appDir}/client ${appDir}/server -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" 2>/dev/null | xargs wc -l 2>/dev/null | awk '$1>500{print}' | sort -rn`,
                    `echo "=== TODO/FIXME/HACK ===" && grep -rn "TODO\\|FIXME\\|HACK\\|XXX\\|TEMP\\|DEPRECATED" ${appDir}/src ${appDir}/client ${appDir}/server --include="*.ts" --include="*.tsx" --include="*.js" 2>/dev/null | head -20`,
                    `echo "=== CONSOLE.LOG ===" && grep -rn "console\\.log" ${appDir}/src ${appDir}/client ${appDir}/server --include="*.ts" --include="*.tsx" --include="*.js" 2>/dev/null | wc -l`,
                    `echo "=== ANY TYPES ===" && grep -rn ": any" ${appDir}/src ${appDir}/client ${appDir}/server --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l`,
                    `echo "=== EMPTY CATCHES ===" && grep -rn "catch.*{\\s*}" ${appDir}/src ${appDir}/client ${appDir}/server --include="*.ts" --include="*.tsx" --include="*.js" 2>/dev/null | head -10`,
                    `echo "=== DUPLICATE IMPORTS ===" && grep -rh "^import" ${appDir}/src ${appDir}/client ${appDir}/server --include="*.ts" --include="*.tsx" 2>/dev/null | sort | uniq -c | sort -rn | head -10`,
                    `echo "=== LINT CHECK ===" && cd ${appDir} && npx eslint src/ --max-warnings=0 --format compact 2>/dev/null | tail -5 || echo "No eslint configured"`
                ].join(" ; ");
                const refactorResult = await sshService.executeCommand(refactorScript, 60000);
                return JSON.stringify({ action: "refactor_check", appName, analysis: refactorResult.output, success: refactorResult.success });
            }
            case "rollback_app": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const sanitizedRollbackApp = appName.replace(/[^a-zA-Z0-9_-]/g, "");
                if (sanitizedRollbackApp !== appName) return JSON.stringify({ error: "appName invalide" });
                const appDir = `/var/www/apps/${sanitizedRollbackApp}`;
                const stepsBack = args.steps || 1;
                const releasesDir = `/var/www/releases/${sanitizedRollbackApp}`;
                const rollbackScript = [
                    `RELEASES_DIR=${releasesDir}`,
                    `APP_DIR=${appDir}`,
                    `echo "=== ROLLBACK ${sanitizedRollbackApp} (${stepsBack} step(s) back) ==="`,
                    `mkdir -p $RELEASES_DIR`,
                    `CURRENT_RELEASE=$(readlink -f $APP_DIR 2>/dev/null || echo $APP_DIR)`,
                    `TIMESTAMP=$(date +%Y%m%d_%H%M%S)`,
                    `echo "1/6 - Saving current release..."`,
                    `if [ -d "$APP_DIR" ] && [ ! -L "$APP_DIR" ]; then`,
                    `  cp -a $APP_DIR $RELEASES_DIR/release_$TIMESTAMP`,
                    `  echo "Saved to $RELEASES_DIR/release_$TIMESTAMP"`,
                    `fi`,
                    `echo "2/6 - Available releases:"`,
                    `ls -lt $RELEASES_DIR/ 2>/dev/null | head -10`,
                    `echo "3/6 - Git rollback in current dir..."`,
                    `cd $APP_DIR 2>/dev/null || exit 1`,
                    `CURRENT_SHA=$(git rev-parse HEAD 2>/dev/null || echo 'unknown')`,
                    `TARGET_SHA=$(git log --oneline -n ${stepsBack + 1} 2>/dev/null | tail -1 | awk '{print $1}')`,
                    `if [ -z "$TARGET_SHA" ]; then echo "ERROR: Cannot find target commit"; exit 1; fi`,
                    `echo "From $CURRENT_SHA -> $TARGET_SHA"`,
                    `git stash 2>/dev/null; git checkout main 2>/dev/null || git checkout master 2>/dev/null`,
                    `git reset --hard $TARGET_SHA`,
                    `echo "4/6 - Rebuilding..."`,
                    `npm ci --production 2>&1 | tail -3`,
                    `npm run build 2>&1 | tail -5 || echo "No build step"`,
                    `echo "5/6 - Restarting PM2..."`,
                    `pm2 restart ${sanitizedRollbackApp} 2>/dev/null || pm2 start ecosystem.config.cjs 2>/dev/null`,
                    `sleep 3`,
                    `echo "6/6 - Health check..."`,
                    `PORT=$(grep -rhoP 'PORT.*?\\K[0-9]{4,5}' ${appDir}/.env 2>/dev/null | head -1)`,
                    `HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$PORT/ 2>/dev/null || echo "000")`,
                    `echo "HTTP: $HTTP_CODE"`,
                    `if [ "$HTTP_CODE" = "000" ] || [ "$HTTP_CODE" = "502" ]; then`,
                    `  echo "HEALTH_FAILED - App not responding after rollback"`,
                    `  LATEST_RELEASE=$(ls -t $RELEASES_DIR/ 2>/dev/null | head -1)`,
                    `  if [ -n "$LATEST_RELEASE" ]; then`,
                    `    echo "Auto-restoring from $RELEASES_DIR/$LATEST_RELEASE..."`,
                    `    rm -rf $APP_DIR/*; cp -a $RELEASES_DIR/$LATEST_RELEASE/* $APP_DIR/`,
                    `    pm2 restart ${sanitizedRollbackApp} 2>/dev/null`,
                    `    echo "RESTORED from saved release"`,
                    `  fi`,
                    `else echo "HEALTH_OK"; fi`,
                    `echo "=== CURRENT STATE ===" && git log --oneline -3 2>/dev/null`
                ].join(" ; ");
                const rollbackResult = await sshService.executeCommand(rollbackScript, 180000);
                const healthOk = rollbackResult.output?.includes("HEALTH_OK") || false;
                const restored = rollbackResult.output?.includes("RESTORED") || false;
                if (!healthOk) {
                    devopsDiscordNotify("Rollback problème", `**${sanitizedRollbackApp}** rollback ${restored ? "restauré depuis backup" : "échoué"} — health check négatif`, "warning");
                }
                return JSON.stringify({ action: "rollback_app", appName: sanitizedRollbackApp, stepsBack, success: rollbackResult.success && (healthOk || restored), healthOk, restored, output: rollbackResult.output, error: rollbackResult.error });
            }
            case "migrate_db": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const appDir = `/var/www/apps/${appName}`;
                const migrationTool = args.tool || "auto";
                const migrateScript = [
                    `cd ${appDir}`,
                    `echo "=== DETECTING MIGRATION TOOL ==="`,
                    migrationTool === "auto" ? [
                        `if [ -f drizzle.config.ts ] || [ -f drizzle.config.js ]; then echo "TOOL=drizzle" && npx drizzle-kit push 2>&1 | tail -20`,
                        `elif [ -d prisma ]; then echo "TOOL=prisma" && npx prisma migrate deploy 2>&1 | tail -20`,
                        `elif [ -f knexfile.js ] || [ -f knexfile.ts ]; then echo "TOOL=knex" && npx knex migrate:latest 2>&1 | tail -20`,
                        `elif [ -d migrations ] || [ -d db/migrations ]; then echo "TOOL=custom" && ls -la migrations/ db/migrations/ 2>/dev/null`,
                        `else echo "No migration tool detected. Available: drizzle, prisma, knex"; fi`
                    ].join(" ; ") : `echo "TOOL=${migrationTool}" && ${migrationTool === "drizzle" ? "npx drizzle-kit push" : migrationTool === "prisma" ? "npx prisma migrate deploy" : migrationTool === "knex" ? "npx knex migrate:latest" : `npm run ${migrationTool}`} 2>&1 | tail -30`,
                    `echo "=== DB STATUS ===" && ${migrationTool === "prisma" ? "npx prisma migrate status" : migrationTool === "drizzle" ? "npx drizzle-kit check" : "echo 'Migration complete'"} 2>&1 | tail -10`
                ].join(" ; ");
                const migrateResult = await sshService.executeCommand(migrateScript, 120000);
                return JSON.stringify({ action: "migrate_db", appName, tool: migrationTool, success: migrateResult.success, output: migrateResult.output, error: migrateResult.error });
            }
            case "profile_app": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const appDir = `/var/www/apps/${appName}`;
                const profileScript = [
                    `echo "=== PROCESS METRICS ==="`,
                    `pm2 describe ${appName} 2>/dev/null | grep -E "cpu|memory|uptime|restart|instances|exec mode|node.js version" || echo "Not in PM2"`,
                    `echo "=== MEMORY DETAIL ==="`,
                    `pm2 jlist 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const app=d.find(a=>a.name==='${appName}');if(app){console.log(JSON.stringify({heap_mb:Math.round((app.pm2_env?.axm_monitor?.['Heap Size']?.value||0)),event_loop_lag:app.pm2_env?.axm_monitor?.['Event Loop Latency p95']?.value||'N/A',active_handles:app.pm2_env?.axm_monitor?.['Active handles']?.value||'N/A',active_requests:app.pm2_env?.axm_monitor?.['Active requests']?.value||'N/A',cpu:app.monit?.cpu,mem_mb:Math.round((app.monit?.memory||0)/1048576)},null,2))}else{console.log('App not found in PM2')}" 2>/dev/null || echo "PM2 metrics unavailable"`,
                    `echo "=== RESPONSE TIME BENCHMARK ==="`,
                    `PORT=$(grep -rhoP 'PORT.*?\\K[0-9]{4,5}' ${appDir}/.env 2>/dev/null | head -1)`,
                    `for i in 1 2 3 4 5; do curl -s -o /dev/null -w "Request $i: HTTP %{http_code} - %{time_total}s (connect: %{time_connect}s, ttfb: %{time_starttransfer}s)\\n" http://127.0.0.1:$PORT/ 2>/dev/null; done`,
                    `echo "=== OPEN CONNECTIONS ==="`,
                    `ss -tnp 2>/dev/null | grep ":$PORT" | awk '{print $4}' | sort | uniq -c | sort -rn | head -10 || echo "No connections found"`,
                    `echo "=== DISK I/O ==="`,
                    `iostat -x 1 1 2>/dev/null | tail -5 || echo "iostat not available"`,
                    `echo "=== NODE.JS HEAP ==="`,
                    `pm2 trigger ${appName} heapdump 2>/dev/null | head -5 || echo "No heapdump trigger"`,
                    `echo "=== TOP RESOURCE USAGE ==="`,
                    `ps aux --sort=-rss | grep -E "node|pm2" | head -10`
                ].join(" ; ");
                const profileResult = await sshService.executeCommand(profileScript, 30000);
                return JSON.stringify({ action: "profile_app", appName, profiling: profileResult.output, success: profileResult.success });
            }
            case "log_search": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const pattern = args.pattern || "error|Error|ERROR|exception|Exception|FATAL|crash";
                const logLines = lines || 1000;
                const since = args.since || "1h";
                const logSearchScript = [
                    `echo "=== PM2 LOG SEARCH (pattern: ${pattern.replace(/"/g, '\\"')}) ==="`,
                    `pm2 logs ${appName} --nostream --lines ${logLines} 2>/dev/null | grep -iE "${pattern.replace(/"/g, '\\"')}" | tail -50`,
                    `echo ""`,
                    `echo "=== SYSTEM JOURNAL (last ${since}) ==="`,
                    `journalctl --since "${since} ago" -u ${appName} --no-pager 2>/dev/null | grep -iE "${pattern.replace(/"/g, '\\"')}" | tail -30 || echo "No journal entries"`,
                    `echo ""`,
                    `echo "=== NGINX ACCESS LOG (last errors) ==="`,
                    `grep "${appName}" /var/log/nginx/access.log 2>/dev/null | grep -E " (4[0-9]{2}|5[0-9]{2}) " | tail -20 || echo "No nginx errors"`,
                    `echo ""`,
                    `echo "=== NGINX ERROR LOG ==="`,
                    `grep -i "${appName}" /var/log/nginx/error.log 2>/dev/null | tail -20 || echo "No nginx errors"`,
                    `echo ""`,
                    `echo "=== LOG STATS ==="`,
                    `echo "Total lines searched: $(pm2 logs ${appName} --nostream --lines ${logLines} 2>/dev/null | wc -l)"`,
                    `echo "Error count: $(pm2 logs ${appName} --nostream --lines ${logLines} 2>/dev/null | grep -icE 'error|exception|fatal' || echo 0)"`,
                    `echo "Warning count: $(pm2 logs ${appName} --nostream --lines ${logLines} 2>/dev/null | grep -icE 'warn|warning' || echo 0)"`
                ].join(" ; ");
                const logResult = await sshService.executeCommand(logSearchScript, 30000);
                return JSON.stringify({ action: "log_search", appName, pattern, linesSearched: logLines, since, results: logResult.output, success: logResult.success });
            }
            case "security_scan": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const appDir = `/var/www/apps/${appName}`;
                const scanScript = [
                    `echo "=== DEPENDENCY VULNERABILITIES ==="`,
                    `cd ${appDir} && npm audit 2>/dev/null | head -40 || echo "npm audit unavailable"`,
                    `echo ""`,
                    `echo "=== SECRETS IN CODE (potential leaks) ==="`,
                    `grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.json" --include="*.env*" -iE "(api[_-]?key|secret[_-]?key|password|token|private[_-]?key|aws[_-]?access|bearer)\\s*[:=]\\s*['\"][^'\"]{8,}" ${appDir}/src ${appDir}/client ${appDir}/server ${appDir}/.env* 2>/dev/null | grep -vE "node_modules|\.git|process\.env|import\.meta" | head -20 || echo "No hardcoded secrets found"`,
                    `echo ""`,
                    `echo "=== EXPOSED ENV FILES ==="`,
                    `find ${appDir} -name ".env*" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | while read f; do echo "$f: $(wc -l < $f) vars"; done`,
                    `echo "=== .gitignore CHECK ==="`,
                    `grep -E "\\.env|secret|private" ${appDir}/.gitignore 2>/dev/null || echo "WARNING: .env not in .gitignore!"`,
                    `echo ""`,
                    `echo "=== OPEN PORTS (app-related) ==="`,
                    `ss -tlnp 2>/dev/null | grep -E "node|pm2|nginx" | head -20`,
                    `echo ""`,
                    `echo "=== SSL CERTIFICATE STATUS ==="`,
                    `DOMAIN=$(grep -l "${appName}" /etc/nginx/sites-enabled/* 2>/dev/null | head -1 | xargs grep server_name 2>/dev/null | awk '{print $2}' | tr -d ';')`,
                    `if [ -n "$DOMAIN" ]; then echo | openssl s_client -servername $DOMAIN -connect $DOMAIN:443 2>/dev/null | openssl x509 -noout -dates -subject 2>/dev/null || echo "SSL check failed"; else echo "No domain found for SSL check"; fi`,
                    `echo ""`,
                    `echo "=== CORS/SECURITY HEADERS ==="`,
                    `PORT=$(grep -rhoP 'PORT.*?\\K[0-9]{4,5}' ${appDir}/.env 2>/dev/null | head -1)`,
                    `curl -sI http://127.0.0.1:$PORT/ 2>/dev/null | grep -iE "x-frame|x-content-type|strict-transport|access-control|content-security-policy|x-xss" || echo "No security headers found (RISK)"`,
                    `echo ""`,
                    `echo "=== DANGEROUS PATTERNS ==="`,
                    `grep -rn --include="*.ts" --include="*.js" -E "(eval\\(|new Function\\(|innerHTML\\s*=|dangerouslySetInnerHTML|child_process\\.exec\\(|\\$\\{.*\\}.*query|sql\\s*\\x60)" ${appDir}/src ${appDir}/server 2>/dev/null | grep -v node_modules | head -15 || echo "No dangerous patterns found"`,
                    `echo ""`,
                    `echo "=== FILE PERMISSIONS ==="`,
                    `find ${appDir} -perm -o+w -not -path "*/node_modules/*" -not -path "*/.git/*" -type f 2>/dev/null | head -10 || echo "No world-writable files"`
                ].join(" ; ");
                const scanResult = await sshService.executeCommand(scanScript, 60000);
                return JSON.stringify({ action: "security_scan", appName, scan: scanResult.output, success: scanResult.success });
            }
            case "backup_app": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const appDir = `/var/www/apps/${appName}`;
                const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
                const backupDir = `/var/backups/apps`;
                const sanitizedBackupApp = appName.replace(/[^a-zA-Z0-9_-]/g, "");
                if (sanitizedBackupApp !== appName) return JSON.stringify({ error: "appName contient des caractères non autorisés" });
                const backupScript = [
                    `mkdir -p ${backupDir}`,
                    `echo "=== BACKING UP ${sanitizedBackupApp} ==="`,
                    `echo "1/4 - Code backup..."`,
                    `tar -czf ${backupDir}/${sanitizedBackupApp}_code_${timestamp}.tar.gz -C ${appDir} --exclude=node_modules --exclude=.git . 2>&1 && echo "CODE_OK" || echo "CODE_FAILED"`,
                    `echo "2/4 - Nginx config..."`,
                    `cp /etc/nginx/sites-enabled/${sanitizedBackupApp}* ${backupDir}/${sanitizedBackupApp}_nginx_${timestamp}.conf 2>/dev/null || cp /etc/nginx/sites-enabled/*${sanitizedBackupApp}* ${backupDir}/${sanitizedBackupApp}_nginx_${timestamp}.conf 2>/dev/null || echo "No nginx config found"`,
                    `echo "3/4 - Environment..."`,
                    `cp ${appDir}/.env ${backupDir}/${sanitizedBackupApp}_env_${timestamp} 2>/dev/null || echo "No .env file"`,
                    `cp ${appDir}/ecosystem.config.cjs ${backupDir}/${sanitizedBackupApp}_pm2_${timestamp}.cjs 2>/dev/null || echo "No PM2 config"`,
                    `echo "4/4 - Database backup..."`,
                    `DB_NAME=$(grep -oP 'DATABASE.*?//.*?/\\K[a-zA-Z0-9_-]+' ${appDir}/.env 2>/dev/null | head -1)`,
                    `if [ -n "$DB_NAME" ]; then pg_dump $DB_NAME 2>/dev/null | gzip > ${backupDir}/${sanitizedBackupApp}_db_${timestamp}.sql.gz && echo "DB $DB_NAME backed up" || echo "DB_BACKUP_FAILED"; else echo "No database detected"; fi`,
                    `echo ""`,
                    `echo "=== BACKUP MANIFEST ==="`,
                    `ls -lh ${backupDir}/${sanitizedBackupApp}_*${timestamp}* 2>/dev/null`,
                ].join(" ; ");
                const backupResult = await sshService.executeCommand(backupScript, 120000);
                const codeOk = backupResult.output?.includes("CODE_OK") || false;
                const dbFailed = backupResult.output?.includes("DB_BACKUP_FAILED") || false;
                return JSON.stringify({ action: "backup_app", appName: sanitizedBackupApp, timestamp, backupDir, success: backupResult.success && codeOk, codeBackup: codeOk ? "ok" : "failed", dbBackup: dbFailed ? "failed" : "ok_or_skipped", output: backupResult.output });
            }
            case "scaffold_project": {
                const projectName = appName || args.projectName;
                if (!projectName) return JSON.stringify({ error: "appName ou projectName requis" });
                const template = args.template || "fullstack";
                const templates: Record<string, { files: Array<{ path: string; content: string }>; deps: string; devDeps: string; buildCmd?: string; description: string }> = {
                    "express-api": {
                        description: "Express.js REST API with TypeScript",
                        deps: "express cors helmet morgan dotenv",
                        devDeps: "typescript @types/express @types/cors @types/morgan @types/node ts-node nodemon",
                        files: [
                            { path: "src/index.ts", content: `import express from "express";\nimport cors from "cors";\nimport helmet from "helmet";\nimport morgan from "morgan";\nimport dotenv from "dotenv";\n\ndotenv.config();\nconst app = express();\nconst PORT = process.env.PORT || 3000;\n\napp.use(cors());\napp.use(helmet());\napp.use(morgan("dev"));\napp.use(express.json());\n\napp.get("/api/health", (req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));\n\napp.listen(PORT, () => console.log(\`Server running on port \${PORT}\`));\n` },
                            { path: "tsconfig.json", content: `{"compilerOptions":{"target":"ES2020","module":"commonjs","lib":["ES2020"],"outDir":"./dist","rootDir":"./src","strict":true,"esModuleInterop":true,"skipLibCheck":true,"forceConsistentCasingInFileNames":true,"resolveJsonModule":true},"include":["src/**/*"]}` },
                            { path: ".env.example", content: `PORT=3000\nNODE_ENV=development\nDATABASE_URL=postgresql://user:pass@localhost:5432/dbname` },
                            { path: ".gitignore", content: `node_modules/\ndist/\n.env\n*.log` },
                        ]
                    },
                    "react-vite": {
                        description: "React + Vite + TypeScript SPA",
                        deps: "react react-dom",
                        devDeps: "typescript @types/react @types/react-dom vite @vitejs/plugin-react",
                        files: [
                            { path: "index.html", content: `<!DOCTYPE html>\n<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${projectName}</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>` },
                            { path: "src/main.tsx", content: `import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./index.css";\n\ncreateRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);` },
                            { path: "src/App.tsx", content: `export default function App() {\n  return <div className="app"><h1>${projectName}</h1><p>Ready to build.</p></div>;\n}` },
                            { path: "src/index.css", content: `*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;min-height:100vh}.app{max-width:1200px;margin:0 auto;padding:2rem}` },
                            { path: "vite.config.ts", content: `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({ plugins: [react()] });` },
                            { path: "tsconfig.json", content: `{"compilerOptions":{"target":"ES2020","useDefineForClassFields":true,"lib":["ES2020","DOM","DOM.Iterable"],"module":"ESNext","skipLibCheck":true,"moduleResolution":"bundler","allowImportingTsExtensions":true,"resolveJsonModule":true,"isolatedModules":true,"noEmit":true,"jsx":"react-jsx","strict":true},"include":["src"]}` },
                            { path: ".gitignore", content: `node_modules/\ndist/\n.env\n*.log` },
                        ]
                    },
                    "fullstack": {
                        description: "Express API + React frontend (monorepo)",
                        deps: "express cors helmet dotenv react react-dom",
                        devDeps: "typescript @types/express @types/cors @types/node @types/react @types/react-dom vite @vitejs/plugin-react concurrently ts-node nodemon",
                        buildCmd: "cd client && npx vite build",
                        files: [
                            { path: "server/index.ts", content: `import express from "express";\nimport cors from "cors";\nimport path from "path";\nimport dotenv from "dotenv";\n\ndotenv.config();\nconst app = express();\nconst PORT = process.env.PORT || 3000;\n\napp.use(cors());\napp.use(express.json());\napp.use(express.static(path.join(__dirname, "../client/dist")));\n\napp.get("/api/health", (req, res) => res.json({ status: "ok" }));\n\napp.get("*", (req, res) => { if (!req.path.startsWith("/api")) res.sendFile(path.join(__dirname, "../client/dist/index.html")); });\n\napp.listen(PORT, () => console.log(\`Server on port \${PORT}\`));\n` },
                            { path: "client/index.html", content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${projectName}</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>` },
                            { path: "client/src/main.tsx", content: `import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App";\n\ncreateRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);` },
                            { path: "client/src/App.tsx", content: `import { useState, useEffect } from "react";\n\nexport default function App() {\n  const [status, setStatus] = useState("");\n  useEffect(() => { fetch("/api/health").then(r=>r.json()).then(d=>setStatus(d.status)).catch(()=>setStatus("offline")); }, []);\n  return <div><h1>${projectName}</h1><p>API: {status}</p></div>;\n}` },
                            { path: "client/vite.config.ts", content: `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({ plugins: [react()], server: { proxy: { "/api": "http://localhost:3000" } } });` },
                            { path: "tsconfig.json", content: `{"compilerOptions":{"target":"ES2020","module":"commonjs","lib":["ES2020"],"outDir":"./dist","strict":true,"esModuleInterop":true,"skipLibCheck":true},"include":["server/**/*"]}` },
                            { path: ".env.example", content: `PORT=3000\nNODE_ENV=development` },
                            { path: ".gitignore", content: `node_modules/\ndist/\nclient/dist/\n.env\n*.log` },
                        ]
                    },
                    "nextjs": {
                        description: "Next.js 14 with App Router",
                        deps: "next react react-dom",
                        devDeps: "typescript @types/react @types/react-dom @types/node",
                        buildCmd: "npx next build",
                        files: [
                            { path: "app/layout.tsx", content: `export const metadata = { title: "${projectName}", description: "Built with Next.js" };\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return <html lang="en"><body>{children}</body></html>;\n}` },
                            { path: "app/page.tsx", content: `export default function Home() {\n  return <main><h1>${projectName}</h1><p>Ready to build.</p></main>;\n}` },
                            { path: "app/api/health/route.ts", content: `import { NextResponse } from "next/server";\n\nexport async function GET() {\n  return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() });\n}` },
                            { path: "next.config.js", content: `/** @type {import('next').NextConfig} */\nmodule.exports = { reactStrictMode: true };` },
                            { path: "tsconfig.json", content: `{"compilerOptions":{"target":"es5","lib":["dom","dom.iterable","esnext"],"allowJs":true,"skipLibCheck":true,"strict":true,"noEmit":true,"esModuleInterop":true,"module":"esnext","moduleResolution":"bundler","resolveJsonModule":true,"isolatedModules":true,"jsx":"preserve","incremental":true,"plugins":[{"name":"next"}],"paths":{"@/*":["./*"]}},"include":["next-env.d.ts","**/*.ts","**/*.tsx",".next/types/**/*.ts"],"exclude":["node_modules"]}` },
                            { path: ".gitignore", content: `node_modules/\n.next/\n.env\n*.log` },
                        ]
                    },
                    "static-html": {
                        description: "Static HTML/CSS/JS website",
                        deps: "",
                        devDeps: "",
                        files: [
                            { path: "index.html", content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${projectName}</title><link rel="stylesheet" href="style.css"/></head><body><header><h1>${projectName}</h1></header><main><p>Ready to build.</p></main><script src="script.js"></script></body></html>` },
                            { path: "style.css", content: `*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;min-height:100vh;background:#f8f9fa}header{background:#1a1a2e;color:white;padding:2rem;text-align:center}main{max-width:1200px;margin:2rem auto;padding:0 1rem}` },
                            { path: "script.js", content: `document.addEventListener("DOMContentLoaded", () => {\n  console.log("${projectName} loaded");\n});` },
                            { path: ".gitignore", content: `node_modules/\n.env\n*.log` },
                        ]
                    },
                    "nestjs-prisma": {
                        description: "NestJS API with Prisma ORM and PostgreSQL",
                        deps: "@nestjs/common @nestjs/core @nestjs/platform-express @prisma/client reflect-metadata rxjs class-validator class-transformer dotenv",
                        devDeps: "typescript @types/express @types/node ts-node @nestjs/cli @nestjs/schematics prisma nodemon @nestjs/testing jest @types/jest ts-jest",
                        buildCmd: "npx nest build",
                        files: [
                            { path: "src/main.ts", content: `import { NestFactory } from "@nestjs/core";\nimport { ValidationPipe } from "@nestjs/common";\nimport { AppModule } from "./app.module";\n\nasync function bootstrap() {\n  const app = await NestFactory.create(AppModule);\n  app.enableCors();\n  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));\n  app.setGlobalPrefix("api");\n  const port = process.env.PORT || 3000;\n  await app.listen(port);\n  console.log(\`Server running on port \${port}\`);\n}\nbootstrap();\n` },
                            { path: "src/app.module.ts", content: `import { Module } from "@nestjs/common";\nimport { AppController } from "./app.controller";\nimport { AppService } from "./app.service";\nimport { PrismaModule } from "./prisma/prisma.module";\n\n@Module({\n  imports: [PrismaModule],\n  controllers: [AppController],\n  providers: [AppService],\n})\nexport class AppModule {}\n` },
                            { path: "src/app.controller.ts", content: `import { Controller, Get } from "@nestjs/common";\nimport { AppService } from "./app.service";\n\n@Controller()\nexport class AppController {\n  constructor(private readonly appService: AppService) {}\n\n  @Get("health")\n  getHealth() {\n    return this.appService.getHealth();\n  }\n}\n` },
                            { path: "src/app.service.ts", content: `import { Injectable } from "@nestjs/common";\n\n@Injectable()\nexport class AppService {\n  getHealth() {\n    return { status: "ok", timestamp: new Date().toISOString() };\n  }\n}\n` },
                            { path: "src/prisma/prisma.module.ts", content: `import { Global, Module } from "@nestjs/common";\nimport { PrismaService } from "./prisma.service";\n\n@Global()\n@Module({\n  providers: [PrismaService],\n  exports: [PrismaService],\n})\nexport class PrismaModule {}\n` },
                            { path: "src/prisma/prisma.service.ts", content: `import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";\nimport { PrismaClient } from "@prisma/client";\n\n@Injectable()\nexport class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {\n  async onModuleInit() {\n    await this.$connect();\n  }\n  async onModuleDestroy() {\n    await this.$disconnect();\n  }\n}\n` },
                            { path: "prisma/schema.prisma", content: `generator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n\nmodel User {\n  id        String   @id @default(uuid())\n  email     String   @unique\n  name      String?\n  createdAt DateTime @default(now()) @map("created_at")\n  updatedAt DateTime @updatedAt @map("updated_at")\n\n  @@map("users")\n}\n` },
                            { path: "nest-cli.json", content: `{\n  "$schema": "https://json.schemastore.org/nest-cli",\n  "collection": "@nestjs/schematics",\n  "sourceRoot": "src",\n  "compilerOptions": {\n    "deleteOutDir": true\n  }\n}` },
                            { path: "tsconfig.json", content: `{"compilerOptions":{"module":"commonjs","declaration":true,"removeComments":true,"emitDecoratorMetadata":true,"experimentalDecorators":true,"allowSyntheticDefaultImports":true,"target":"ES2021","sourceMap":true,"outDir":"./dist","baseUrl":"./","incremental":true,"skipLibCheck":true,"strictNullChecks":true,"noImplicitAny":true,"strictBindCallApply":true,"forceConsistentCasingInFileNames":true,"noFallthroughCasesInSwitch":true},"include":["src/**/*"]}` },
                            { path: ".env.example", content: `PORT=3000\nNODE_ENV=development\nDATABASE_URL=postgresql://user:password@localhost:5432/${projectName}?schema=public` },
                            { path: ".gitignore", content: `node_modules/\ndist/\n.env\n*.log\nprisma/migrations/` },
                        ]
                    },
                    "fastapi": {
                        description: "Python FastAPI with SQLAlchemy and PostgreSQL",
                        deps: "fastapi uvicorn sqlalchemy psycopg2-binary alembic python-dotenv pydantic",
                        devDeps: "",
                        files: [
                            { path: "app/main.py", content: `from fastapi import FastAPI\nfrom fastapi.middleware.cors import CORSMiddleware\nfrom dotenv import load_dotenv\nimport os\n\nload_dotenv()\n\napp = FastAPI(title="${projectName}", version="1.0.0")\n\napp.add_middleware(\n    CORSMiddleware,\n    allow_origins=["*"],\n    allow_credentials=True,\n    allow_methods=["*"],\n    allow_headers=["*"],\n)\n\n@app.get("/api/health")\ndef health():\n    return {"status": "ok"}\n\nif __name__ == "__main__":\n    import uvicorn\n    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.getenv("PORT", 3000)), reload=True)\n` },
                            { path: "app/__init__.py", content: `` },
                            { path: "app/database.py", content: `from sqlalchemy import create_engine\nfrom sqlalchemy.ext.declarative import declarative_base\nfrom sqlalchemy.orm import sessionmaker\nimport os\n\nDATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost:5432/${projectName}")\n\nengine = create_engine(DATABASE_URL)\nSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)\nBase = declarative_base()\n\ndef get_db():\n    db = SessionLocal()\n    try:\n        yield db\n    finally:\n        db.close()\n` },
                            { path: "app/models.py", content: `from sqlalchemy import Column, String, DateTime\nfrom sqlalchemy.sql import func\nimport uuid\nfrom .database import Base\n\nclass User(Base):\n    __tablename__ = "users"\n    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))\n    email = Column(String, unique=True, nullable=False)\n    name = Column(String, nullable=True)\n    created_at = Column(DateTime, server_default=func.now())\n    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())\n` },
                            { path: "requirements.txt", content: `fastapi>=0.104.0\nuvicorn>=0.24.0\nsqlalchemy>=2.0.0\npsycopg2-binary>=2.9.0\nalembic>=1.13.0\npython-dotenv>=1.0.0\npydantic>=2.5.0\n` },
                            { path: ".env.example", content: `PORT=3000\nDATABASE_URL=postgresql://user:password@localhost:5432/${projectName}` },
                            { path: ".gitignore", content: `__pycache__/\n*.pyc\n.env\nvenv/\n*.log\nalembic/versions/` },
                        ]
                    },
                    "nestjs-fullstack": {
                        description: "NestJS backend + React Vite frontend monorepo",
                        deps: "",
                        devDeps: "concurrently",
                        files: [
                            { path: "backend/src/main.ts", content: `import { NestFactory } from "@nestjs/core";\nimport { ValidationPipe } from "@nestjs/common";\nimport { AppModule } from "./app.module";\n\nasync function bootstrap() {\n  const app = await NestFactory.create(AppModule);\n  app.enableCors();\n  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));\n  app.setGlobalPrefix("api");\n  await app.listen(process.env.PORT || 3000);\n  console.log(\`Backend on port \${process.env.PORT || 3000}\`);\n}\nbootstrap();\n` },
                            { path: "backend/src/app.module.ts", content: `import { Module } from "@nestjs/common";\nimport { AppController } from "./app.controller";\n\n@Module({\n  controllers: [AppController],\n})\nexport class AppModule {}\n` },
                            { path: "backend/src/app.controller.ts", content: `import { Controller, Get } from "@nestjs/common";\n\n@Controller()\nexport class AppController {\n  @Get("health")\n  getHealth() {\n    return { status: "ok", timestamp: new Date().toISOString() };\n  }\n}\n` },
                            { path: "backend/nest-cli.json", content: `{"$schema":"https://json.schemastore.org/nest-cli","collection":"@nestjs/schematics","sourceRoot":"src","compilerOptions":{"deleteOutDir":true}}` },
                            { path: "backend/tsconfig.json", content: `{"compilerOptions":{"module":"commonjs","declaration":true,"removeComments":true,"emitDecoratorMetadata":true,"experimentalDecorators":true,"allowSyntheticDefaultImports":true,"target":"ES2021","sourceMap":true,"outDir":"./dist","baseUrl":"./","skipLibCheck":true,"strictNullChecks":true},"include":["src/**/*"]}` },
                            { path: "backend/package.json", content: JSON.stringify({ name: `${projectName}-backend`, version: "1.0.0", scripts: { dev: "nest start --watch", build: "nest build", start: "node dist/main" }, dependencies: { "@nestjs/common": "^10.0.0", "@nestjs/core": "^10.0.0", "@nestjs/platform-express": "^10.0.0", "reflect-metadata": "^0.2.0", rxjs: "^7.8.0", "class-validator": "^0.14.0", "class-transformer": "^0.5.0", dotenv: "^16.3.0" }, devDependencies: { typescript: "^5.3.0", "@types/express": "^4.17.0", "@types/node": "^20.0.0", "@nestjs/cli": "^10.0.0", "@nestjs/schematics": "^10.0.0" } }, null, 2) },
                            { path: "frontend/index.html", content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${projectName}</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>` },
                            { path: "frontend/src/main.tsx", content: `import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./index.css";\n\ncreateRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);\n` },
                            { path: "frontend/src/App.tsx", content: `import { useState, useEffect } from "react";\n\nexport default function App() {\n  const [health, setHealth] = useState("");\n  useEffect(() => {\n    fetch("/api/health").then(r => r.json()).then(d => setHealth(d.status)).catch(() => setHealth("offline"));\n  }, []);\n  return <div style={{maxWidth:"1200px",margin:"0 auto",padding:"2rem"}}><h1>${projectName}</h1><p>API: {health}</p></div>;\n}\n` },
                            { path: "frontend/src/index.css", content: `*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;min-height:100vh}` },
                            { path: "frontend/vite.config.ts", content: `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({\n  plugins: [react()],\n  server: { proxy: { "/api": "http://localhost:3000" } }\n});\n` },
                            { path: "frontend/tsconfig.json", content: `{"compilerOptions":{"target":"ES2020","useDefineForClassFields":true,"lib":["ES2020","DOM","DOM.Iterable"],"module":"ESNext","skipLibCheck":true,"moduleResolution":"bundler","allowImportingTsExtensions":true,"resolveJsonModule":true,"isolatedModules":true,"noEmit":true,"jsx":"react-jsx","strict":true},"include":["src"]}` },
                            { path: "frontend/package.json", content: JSON.stringify({ name: `${projectName}-frontend`, version: "1.0.0", scripts: { dev: "vite", build: "vite build", preview: "vite preview" }, dependencies: { react: "^18.2.0", "react-dom": "^18.2.0" }, devDependencies: { typescript: "^5.3.0", "@types/react": "^18.2.0", "@types/react-dom": "^18.2.0", vite: "^5.0.0", "@vitejs/plugin-react": "^4.2.0" } }, null, 2) },
                            { path: ".env.example", content: `PORT=3000\nNODE_ENV=development\nDATABASE_URL=postgresql://user:password@localhost:5432/${projectName}` },
                            { path: ".gitignore", content: `node_modules/\ndist/\n.env\n*.log\nbackend/dist/\nfrontend/dist/` },
                        ]
                    },
                    "laravel": {
                        description: "Laravel PHP API (structure de base)",
                        deps: "",
                        devDeps: "",
                        files: [
                            { path: "routes/api.php", content: `<?php\n\nuse Illuminate\\Support\\Facades\\Route;\n\nRoute::get('/health', function () {\n    return response()->json(['status' => 'ok', 'timestamp' => now()->toISOString()]);\n});\n` },
                            { path: "app/Models/User.php", content: `<?php\n\nnamespace App\\Models;\n\nuse Illuminate\\Database\\Eloquent\\Factories\\HasFactory;\nuse Illuminate\\Foundation\\Auth\\User as Authenticatable;\n\nclass User extends Authenticatable\n{\n    use HasFactory;\n\n    protected $fillable = ['name', 'email', 'password'];\n    protected $hidden = ['password', 'remember_token'];\n}\n` },
                            { path: ".env.example", content: `APP_NAME=${projectName}\nAPP_ENV=local\nAPP_KEY=\nAPP_DEBUG=true\nAPP_URL=http://localhost\n\nDB_CONNECTION=pgsql\nDB_HOST=127.0.0.1\nDB_PORT=5432\nDB_DATABASE=${projectName}\nDB_USERNAME=user\nDB_PASSWORD=password` },
                            { path: "composer.json", content: JSON.stringify({ name: `app/${projectName}`, type: "project", require: { php: "^8.2", "laravel/framework": "^11.0" }, "require-dev": { phpunit: "^11.0" }, autoload: { "psr-4": { "App\\\\": "app/" } } }, null, 2) },
                            { path: ".gitignore", content: `/vendor\n/node_modules\n/.env\n/storage/*.key\n*.log` },
                        ]
                    },
                };
                const tmpl = templates[template];
                if (!tmpl) return JSON.stringify({ error: `Template inconnu: ${template}. Disponibles: ${Object.keys(templates).join(", ")}`, templates: Object.entries(templates).map(([k, v]) => ({ name: k, description: v.description })) });
                const { createRepo: ghCreateRepo, applyPatch: ghApplyPatch, getRepo: ghGetRepo } = await import("../githubService");
                const owner = args.owner || "ulyssemdbh-commits";
                const targetRepo = args.repoName || projectName;
                let repoExists = false;
                try {
                    await ghGetRepo(owner, targetRepo);
                    repoExists = true;
                } catch {
                    try {
                        await ghCreateRepo(targetRepo, { description: tmpl.description, isPrivate: true, autoInit: true });
                    } catch (e: any) {
                        if (e.message?.includes("already exists")) {
                            repoExists = true;
                        } else {
                            return JSON.stringify({ error: `Impossible de créer le repo '${targetRepo}': ${e.message}`, suggestion: "Vérifier le token GitHub et les permissions, ou fournir un repo existant via repoName." });
                        }
                    }
                }
                const blobs: Array<{ path: string; content: string }> = tmpl.files.map(f => ({ path: f.path, content: f.content }));
                const pkgJson: any = { name: projectName, version: "1.0.0", description: tmpl.description, scripts: {} };
                if (template === "express-api") {
                    pkgJson.scripts = { dev: "nodemon --exec ts-node src/index.ts", build: "tsc", start: "node dist/index.js" };
                } else if (template === "react-vite") {
                    pkgJson.scripts = { dev: "vite", build: "vite build", preview: "vite preview" };
                } else if (template === "fullstack") {
                    pkgJson.scripts = { dev: "concurrently \"nodemon --exec ts-node server/index.ts\" \"cd client && vite\"", build: tmpl.buildCmd, start: "node dist/index.js" };
                } else if (template === "nextjs") {
                    pkgJson.scripts = { dev: "next dev", build: "next build", start: "next start" };
                } else if (template === "nestjs-prisma") {
                    pkgJson.scripts = { dev: "nest start --watch", build: "nest build", start: "node dist/main", "prisma:generate": "prisma generate", "prisma:migrate": "prisma migrate dev", "prisma:studio": "prisma studio" };
                } else if (template === "nestjs-fullstack") {
                    pkgJson.scripts = { dev: "concurrently \"cd backend && npm run dev\" \"cd frontend && npm run dev\"", "install:all": "cd backend && npm install && cd ../frontend && npm install" };
                } else if (template === "fastapi") {
                    pkgJson.scripts = { dev: "python -m uvicorn app.main:app --reload --port 3000", start: "python -m uvicorn app.main:app --host 0.0.0.0 --port 3000" };
                } else if (template === "laravel") {
                    pkgJson.scripts = { dev: "php artisan serve --port=3000", start: "php artisan serve --host=0.0.0.0 --port=3000" };
                }
                if (Object.keys(pkgJson.scripts).length > 0 || tmpl.deps || tmpl.devDeps) {
                    blobs.push({ path: "package.json", content: JSON.stringify(pkgJson, null, 2) });
                }
                blobs.push({ path: "README.md", content: `# ${projectName}\n\n${tmpl.description}\n\n## Setup\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n` });
                try {
                    await ghApplyPatch(owner, targetRepo, "main", blobs, `scaffold: ${template} project structure`);
                } catch (patchError: any) {
                    return JSON.stringify({ error: `Scaffold réussi mais échec du push vers ${owner}/${targetRepo}: ${patchError.message}`, suggestion: "Vérifier que le repo existe et que le token a les permissions d'écriture.", repoExists, owner, targetRepo });
                }
                return JSON.stringify({ action: "scaffold_project", projectName, repo: `${owner}/${targetRepo}`, repoExists, template, description: tmpl.description, filesCreated: blobs.map(b => b.path), deps: tmpl.deps, devDeps: tmpl.devDeps, repoUrl: `https://github.com/${owner}/${targetRepo}`, nextSteps: [`npm install`, tmpl.deps ? `npm install ${tmpl.deps}` : null, tmpl.devDeps ? `npm install -D ${tmpl.devDeps}` : null, `npm run dev`].filter(Boolean) });
            }
            case "scaffold_from_readme": {
                const projectName = appName || args.projectName;
                if (!projectName) return JSON.stringify({ error: "appName ou projectName requis" });
                const readmeContent = args.readmeContent;
                if (!readmeContent) {
                    try {
                        const { createRepo: ghCreateRepo2, applyPatch: ghApplyPatch2, getRepo: ghGetRepo2, getFileContent } = await import("../githubService");
                        const readmeOwner = args.owner || "ulyssemdbh-commits";
                        const readmeRepo = args.repoName || projectName;
                        let readme = "";
                        try { readme = await getFileContent(readmeOwner, readmeRepo, "README.md"); } catch {}
                        if (!readme) try { readme = await getFileContent(readmeOwner, readmeRepo, "readme.md"); } catch {}
                        if (!readme) return JSON.stringify({ error: "Pas de README.md trouvé dans le repo et pas de readmeContent fourni. Fournis le contenu du README via readmeContent ou assure-toi que le repo contient un README.md." });
                        args.readmeContent = readme;
                    } catch (e: any) {
                        return JSON.stringify({ error: `Impossible de lire le README: ${e.message}` });
                    }
                }
                const readme = args.readmeContent;
                const lower = readme.toLowerCase();
                let detectedStack = "fullstack";
                let detectedDeps: string[] = [];
                let detectedFeatures: string[] = [];
                if (/next\.?js|nextjs/i.test(readme)) detectedStack = "nextjs";
                else if (/nest\.?js|nestjs/i.test(readme) && /prisma/i.test(readme)) detectedStack = "nestjs-prisma";
                else if (/nest\.?js|nestjs/i.test(readme) && /react|frontend/i.test(readme)) detectedStack = "nestjs-fullstack";
                else if (/fastapi|flask|django|python/i.test(readme)) detectedStack = "fastapi";
                else if (/laravel|php/i.test(readme)) detectedStack = "laravel";
                else if (/react|vue|angular|vite/i.test(readme) && !/express|api|backend|server/i.test(readme)) detectedStack = "react-vite";
                else if (/express|node|api|backend|server/i.test(readme) && !/react|vue|frontend/i.test(readme)) detectedStack = "express-api";
                else if (/html|css|static|landing/i.test(readme)) detectedStack = "static-html";
                if (/tailwind/i.test(readme)) detectedDeps.push("tailwindcss", "postcss", "autoprefixer");
                if (/shadcn|radix/i.test(readme)) detectedDeps.push("@radix-ui/react-icons", "class-variance-authority", "clsx", "tailwind-merge");
                if (/prisma/i.test(readme) && detectedStack !== "nestjs-prisma") detectedDeps.push("prisma", "@prisma/client");
                if (/drizzle/i.test(readme)) detectedDeps.push("drizzle-orm", "drizzle-kit");
                if (/postgres|postgresql|pg/i.test(readme)) detectedDeps.push("pg");
                if (/mongo/i.test(readme)) detectedDeps.push("mongoose");
                if (/redis/i.test(readme)) detectedDeps.push("redis", "ioredis");
                if (/socket\.?io|websocket|realtime/i.test(readme)) detectedDeps.push("socket.io", "socket.io-client");
                if (/stripe|payment/i.test(readme)) detectedDeps.push("stripe");
                if (/jwt|jsonwebtoken|auth/i.test(readme)) detectedDeps.push("jsonwebtoken", "bcryptjs");
                if (/multer|upload|file.*upload/i.test(readme)) detectedDeps.push("multer");
                if (/swagger|openapi/i.test(readme)) detectedDeps.push("swagger-ui-express", "swagger-jsdoc");
                if (/zod/i.test(readme)) detectedDeps.push("zod");
                if (/axios/i.test(readme)) detectedDeps.push("axios");
                if (/react.*router|routing/i.test(readme)) detectedDeps.push("react-router-dom");
                if (/wouter/i.test(readme)) detectedDeps.push("wouter");
                if (/tanstack.*query|react.*query/i.test(readme)) detectedDeps.push("@tanstack/react-query");
                if (/docker/i.test(readme)) detectedFeatures.push("docker");
                if (/ci.?cd|github.*action/i.test(readme)) detectedFeatures.push("ci-cd");
                if (/test|jest|vitest|playwright/i.test(readme)) detectedFeatures.push("testing");
                if (/i18n|internationa/i.test(readme)) detectedFeatures.push("i18n");
                if (/pwa|service.*worker/i.test(readme)) detectedFeatures.push("pwa");
                const pagesMatch = readme.match(/(?:pages?|écrans?|screens?|views?|routes?)\s*[:=]?\s*\n((?:\s*[-*•]\s*.+\n?)+)/gi);
                let detectedPages: string[] = [];
                if (pagesMatch) {
                    for (const block of pagesMatch) {
                        const items = block.match(/[-*•]\s*(.+)/g);
                        if (items) detectedPages.push(...items.map(i => i.replace(/^[-*•]\s*/, "").trim()));
                    }
                }
                const apiMatch = readme.match(/(?:api|endpoints?|routes?)\s*[:=]?\s*\n((?:\s*[-*•]\s*.+\n?)+)/gi);
                let detectedApis: string[] = [];
                if (apiMatch) {
                    for (const block of apiMatch) {
                        const items = block.match(/[-*•]\s*(.+)/g);
                        if (items) detectedApis.push(...items.map(i => i.replace(/^[-*•]\s*/, "").trim()));
                    }
                }
                const modelsMatch = readme.match(/(?:models?|schéma|schema|entit|tables?|database)\s*[:=]?\s*\n((?:\s*[-*•]\s*.+\n?)+)/gi);
                let detectedModels: string[] = [];
                if (modelsMatch) {
                    for (const block of modelsMatch) {
                        const items = block.match(/[-*•]\s*(.+)/g);
                        if (items) detectedModels.push(...items.map(i => i.replace(/^[-*•]\s*/, "").trim()));
                    }
                }
                return JSON.stringify({
                    action: "scaffold_from_readme",
                    projectName,
                    analysis: {
                        detectedStack,
                        detectedDeps: [...new Set(detectedDeps)],
                        detectedFeatures,
                        detectedPages,
                        detectedApis,
                        detectedModels,
                        readmeLength: readme.length,
                    },
                    instruction: `README analysé. Stack détectée: ${detectedStack}. Dépendances: ${[...new Set(detectedDeps)].join(", ") || "aucune spécifique"}.
PROCHAINES ÉTAPES OBLIGATOIRES:
1. Appelle scaffold_project avec template="${detectedStack}" pour créer la structure de base
2. Pour chaque page/feature détectée, utilise devops_github(action="update_file") pour créer les fichiers correspondants
3. ${detectedModels.length > 0 ? `Crée le schéma DB avec les modèles: ${detectedModels.join(", ")}` : "Crée le schéma DB selon les besoins du README"}
4. ${detectedApis.length > 0 ? `Implémente les endpoints: ${detectedApis.join(", ")}` : "Implémente les endpoints API selon les besoins"}
5. ${detectedDeps.length > 0 ? `Installe les dépendances additionnelles: ${[...new Set(detectedDeps)].join(", ")}` : ""}
6. ${detectedFeatures.includes("docker") ? "Génère un Dockerfile et docker-compose.yml" : ""}
7. ${detectedFeatures.includes("ci-cd") ? "Génère .github/workflows/ci.yml" : ""}
Tu DOIS maintenant exécuter ces étapes une par une. Commence par scaffold_project.`,
                });
            }
            case "smoke_test": {
                const testAppName = appName;
                const testUrls = args.testUrls || [];
                const results: Array<{ url: string; status: number; responseTime: number; ok: boolean; error?: string; contentCheck?: string }> = [];
                let urls = [...testUrls];
                if (testAppName && urls.length === 0) {
                    urls.push(`https://${testAppName}.ulyssepro.org`);
                    urls.push(`https://${testAppName}.ulyssepro.org/api/health`);
                    urls.push(`https://${testAppName}-dev.ulyssepro.org`);
                }
                if (urls.length === 0) return JSON.stringify({ error: "appName ou testUrls requis pour smoke_test" });
                for (const testUrl of urls) {
                    try {
                        const cmd = `curl -sS -o /tmp/smoke_body.txt -w '%{http_code}|%{time_total}|%{size_download}' --connect-timeout 10 --max-time 15 '${testUrl}' 2>&1; echo "|||"; cat /tmp/smoke_body.txt 2>/dev/null | head -c 500`;
                        const r = await sshService.executeCommand(cmd, 20000);
                        const output = r.output || "";
                        const parts = output.split("|||");
                        const meta = (parts[0] || "").trim();
                        const bodyPreview = (parts[1] || "").trim();
                        const [httpCode, timeTotal, sizeStr] = meta.split("|");
                        const status = parseInt(httpCode) || 0;
                        const responseTime = parseFloat(timeTotal) || 0;
                        let contentCheck = "ok";
                        if (bodyPreview.includes("Cannot GET") || bodyPreview.includes("Not Found")) contentCheck = "404_page";
                        else if (bodyPreview.includes("502 Bad Gateway")) contentCheck = "502_nginx";
                        else if (bodyPreview.includes("Internal Server Error") || bodyPreview.includes("Error")) contentCheck = "server_error";
                        else if (bodyPreview.includes("ECONNREFUSED")) contentCheck = "app_not_running";
                        results.push({ url: testUrl, status, responseTime: Math.round(responseTime * 1000), ok: status >= 200 && status < 400, contentCheck });
                    } catch (e: any) {
                        results.push({ url: testUrl, status: 0, responseTime: 0, ok: false, error: e.message?.slice(0, 100) });
                    }
                }
                const allOk = results.every(r => r.ok);
                const failedCount = results.filter(r => !r.ok).length;
                return JSON.stringify({ action: "smoke_test", appName: testAppName, totalTests: results.length, passed: results.length - failedCount, failed: failedCount, allOk, results, summary: allOk ? `✅ Tous les ${results.length} tests passent` : `⚠️ ${failedCount}/${results.length} tests échoués` });
            }
            case "resource_usage": {
                const targetApp = appName;
                const cmds = [
                    `echo "=== SYSTEM ===" && free -m | awk 'NR==2{printf "RAM: %sMB/%sMB (%.1f%%)\\n",$3,$2,$3/$2*100}' && df -h / | awk 'NR==2{printf "Disk: %s/%s (%s used)\\n",$3,$2,$5}' && nproc && uptime`,
                    targetApp
                        ? `echo "=== APP: ${targetApp} ===" && pm2 show ${targetApp} 2>/dev/null | grep -E 'status|memory|cpu|restarts|uptime|pid' || echo "App not found in PM2"`
                        : `echo "=== ALL APPS ===" && pm2 jlist 2>/dev/null | python3 -c "import sys,json; apps=json.load(sys.stdin); [print(f\\\"  {a['name']}: {a['pm2_env']['status']} | mem={a['monit']['memory']//1024//1024}MB | cpu={a['monit']['cpu']}% | restarts={a['pm2_env']['restart_time']} | uptime={round(($(date +%s)*1000-a['pm2_env'].get('pm_uptime',0))/3600000,1)}h\\\") for a in apps]" 2>/dev/null || pm2 list 2>/dev/null`,
                    `echo "=== TOP PROCESSES ===" && ps aux --sort=-%mem | head -8 | awk '{printf "%-15s %5sMB %5s%% CPU  %s\\n",$11,$6/1024,$3,$11}'`,
                    targetApp ? `echo "=== DISK USAGE ===" && du -sh /var/www/apps/${targetApp} 2>/dev/null || echo "N/A"` : `echo "=== DISK USAGE ===" && du -sh /var/www/apps/*/ 2>/dev/null | sort -rh | head -10`,
                    `echo "=== NETWORK ===" && ss -tlnp 2>/dev/null | grep -E 'LISTEN' | head -15`,
                ];
                const fullCmd = cmds.join(" && ");
                const r = await sshService.executeCommand(fullCmd, 15000);
                return JSON.stringify({ action: "resource_usage", appName: targetApp || "all", output: r.output?.trim() || "No output", success: !r.error });
            }
            case "app_db_query": {
                if (!appName) return JSON.stringify({ error: "appName requis pour app_db_query" });
                const query = args.sqlQuery;
                if (!query) return JSON.stringify({ error: "sqlQuery requis" });
                const upperQuery = query.trim().toUpperCase();
                if (upperQuery.startsWith("DROP") || upperQuery.startsWith("TRUNCATE") || upperQuery.startsWith("ALTER") || upperQuery.includes("DELETE FROM") && !upperQuery.includes("WHERE")) {
                    return JSON.stringify({ error: "Requête destructive bloquée (DROP/TRUNCATE/ALTER/DELETE sans WHERE). Utilise une requête plus ciblée." });
                }
                const appDir = `/var/www/apps/${appName}`;
                const getDbUrl = `grep -E '^DATABASE_URL=' ${appDir}/.env 2>/dev/null | head -1 | cut -d= -f2-`;
                const dbUrlResult = await sshService.executeCommand(getDbUrl, 5000);
                const dbUrl = (dbUrlResult.output || "").trim();
                if (!dbUrl) return JSON.stringify({ error: `Pas de DATABASE_URL trouvé dans ${appDir}/.env. L'app n'a peut-être pas de base de données.` });
                const escapedQuery = query.replace(/'/g, "'\\''");
                const cmd = `PGPASSWORD=$(echo '${dbUrl}' | sed -n 's|.*://[^:]*:\\([^@]*\\)@.*|\\1|p') psql -h $(echo '${dbUrl}' | sed -n 's|.*@\\([^:/]*\\).*|\\1|p') -p $(echo '${dbUrl}' | sed -n 's|.*:\\([0-9]*\\)/.*|\\1|p') -U $(echo '${dbUrl}' | sed -n 's|.*://\\([^:]*\\):.*|\\1|p') -d $(echo '${dbUrl}' | sed -n 's|.*/\\([^?]*\\).*|\\1|p') -t -c '${escapedQuery}' 2>&1 | head -100`;
                const r = await sshService.executeCommand(cmd, 15000);
                return JSON.stringify({ action: "app_db_query", appName, query, output: r.output?.trim() || "No output", success: !r.error, error: r.error });
            }
            case "perf_loadtest": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const appDir = `/var/www/apps/${appName}`;
                const url = args.url || `http://127.0.0.1:$(grep -rhoP 'PORT.*?\\K[0-9]{4,5}' ${appDir}/.env 2>/dev/null | head -1)/`;
                const concurrency = args.concurrency || 10;
                const requests = args.requests || 100;
                const loadTestScript = [
                    `echo "=== LOAD TEST: ${requests} requests, ${concurrency} concurrent ==="`,
                    `echo "Target: ${url}"`,
                    `echo ""`,
                    `which ab > /dev/null 2>&1 && ab -n ${requests} -c ${concurrency} -q ${url} 2>&1 | grep -E "Requests per second|Time per request|Transfer rate|Failed|Complete|Percentage" || (`,
                    `echo "ab not found, using curl benchmark..."`,
                    `START=$(date +%s%N)`,
                    `SUCCESS=0; FAIL=0; TOTAL_TIME=0`,
                    `for i in $(seq 1 ${Math.min(requests as number, 50)}); do`,
                    `  T=$(curl -s -o /dev/null -w "%{time_total}" ${url} 2>/dev/null)`,
                    `  CODE=$(curl -s -o /dev/null -w "%{http_code}" ${url} 2>/dev/null)`,
                    `  if [ "$CODE" -ge 200 ] && [ "$CODE" -lt 400 ]; then SUCCESS=$((SUCCESS+1)); else FAIL=$((FAIL+1)); fi`,
                    `  TOTAL_TIME=$(echo "$TOTAL_TIME + $T" | bc 2>/dev/null || echo "$TOTAL_TIME")`,
                    `done`,
                    `END=$(date +%s%N)`,
                    `echo "Requests: $((SUCCESS+FAIL)) | Success: $SUCCESS | Failed: $FAIL"`,
                    `echo "Total time: $(echo "($END - $START) / 1000000" | bc 2>/dev/null || echo "N/A")ms"`,
                    `)`,
                    `echo ""`,
                    `echo "=== SERVER LOAD AFTER TEST ==="`,
                    `uptime`,
                    `free -h | head -2`
                ].join(" ; ");
                const loadResult = await sshService.executeCommand(loadTestScript, 120000);
                return JSON.stringify({ action: "perf_loadtest", appName, concurrency, requests, results: loadResult.output, success: loadResult.success });
            }
            case "architecture_analyze": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const appDir = `/var/www/apps/${appName}`;
                const archScript = [
                    `echo "=== PROJECT STRUCTURE ==="`,
                    `find ${appDir}/src ${appDir}/client ${appDir}/server ${appDir}/app ${appDir}/pages ${appDir}/components ${appDir}/lib -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \\) 2>/dev/null | sed "s|${appDir}/||" | head -100`,
                    `echo ""`,
                    `echo "=== CODE METRICS ==="`,
                    `TOTAL_FILES=$(find ${appDir}/src ${appDir}/client ${appDir}/server ${appDir}/app -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \\) 2>/dev/null | wc -l)`,
                    `TOTAL_LINES=$(find ${appDir}/src ${appDir}/client ${appDir}/server ${appDir}/app -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \\) 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')`,
                    `echo "Total files: $TOTAL_FILES | Total lines: $TOTAL_LINES | Avg lines/file: $((TOTAL_LINES / (TOTAL_FILES > 0 ? TOTAL_FILES : 1)))"`,
                    `echo ""`,
                    `echo "=== FILE SIZE DISTRIBUTION ==="`,
                    `find ${appDir}/src ${appDir}/client ${appDir}/server ${appDir}/app -type f \\( -name "*.ts" -o -name "*.tsx" \\) 2>/dev/null | xargs wc -l 2>/dev/null | grep -v total | awk '{if($1<50)s++;else if($1<100)m++;else if($1<300)l++;else if($1<500)xl++;else xxl++}END{print "Small(<50):"s+0" Medium(50-100):"m+0" Large(100-300):"l+0" XL(300-500):"xl+0" XXL(500+):"xxl+0}'`,
                    `echo ""`,
                    `echo "=== CIRCULAR DEPENDENCY CHECK ==="`,
                    `cd ${appDir} && node -e "
const fs=require('fs'),path=require('path');
const files=[];
function walk(d){try{fs.readdirSync(d).forEach(f=>{const p=path.join(d,f);if(f==='node_modules'||f==='.git')return;if(fs.statSync(p).isDirectory())walk(p);else if(/\\.(ts|tsx|js|jsx)$/.test(f))files.push(p)})}catch{}}
walk('src');walk('server');walk('client');walk('app');
const imports={};
files.forEach(f=>{const c=fs.readFileSync(f,'utf8');const rel=path.relative('${appDir}',f);const matches=[...c.matchAll(/from\\s+['\"](\\.\\.\\/[^'\"]+|\\.\\/[^'\"]+)['\"]|require\\(['\"](\\.\\.\\/[^'\"]+|\\.\\/[^'\"]+)['\"]\\)/g)];imports[rel]=matches.map(m=>m[1]||m[2]).filter(Boolean)});
const visited=new Set(),cycles=[];
function dfs(node,stack){if(stack.includes(node)){cycles.push(stack.slice(stack.indexOf(node)).concat(node).join(' -> '));return}if(visited.has(node))return;visited.add(node);stack.push(node);(imports[node]||[]).forEach(imp=>{const resolved=Object.keys(imports).find(k=>k.includes(imp.replace(/^\\.\\//,'').replace(/\\.\\.\\//g,'')));if(resolved)dfs(resolved,[...stack])});stack.pop()}
Object.keys(imports).forEach(f=>dfs(f,[]));
console.log(cycles.length?cycles.slice(0,10).join('\\n'):'No circular dependencies detected');
" 2>/dev/null || echo "Analysis failed"`,
                    `echo ""`,
                    `echo "=== COUPLING ANALYSIS (most imported files) ==="`,
                    `grep -rh --include="*.ts" --include="*.tsx" --include="*.js" "from ['\"]" ${appDir}/src ${appDir}/server ${appDir}/client 2>/dev/null | grep -oP "from ['\"]\\K[^'\"]*" | sort | uniq -c | sort -rn | head -15`,
                    `echo ""`,
                    `echo "=== COMPONENT ANALYSIS ==="`,
                    `echo "React components: $(grep -rl --include='*.tsx' --include='*.jsx' 'export default function\\|export function\\|export const.*=.*=>\\|export default class' ${appDir}/src ${appDir}/client ${appDir}/app ${appDir}/components 2>/dev/null | wc -l)"`,
                    `echo "API routes: $(grep -rl --include='*.ts' --include='*.js' 'router\\.get\\|router\\.post\\|app\\.get\\|app\\.post\\|export async function GET\\|export async function POST' ${appDir}/src ${appDir}/server ${appDir}/app 2>/dev/null | wc -l)"`,
                    `echo "Hooks: $(grep -rl --include='*.ts' --include='*.tsx' 'export.*function use[A-Z]' ${appDir}/src ${appDir}/client ${appDir}/app 2>/dev/null | wc -l)"`,
                    `echo "Types/Interfaces: $(grep -c --include='*.ts' --include='*.tsx' -r 'export interface\\|export type' ${appDir}/src ${appDir}/server ${appDir}/client 2>/dev/null | awk -F: '{s+=$2}END{print s+0}')"`,
                    `echo ""`,
                    `echo "=== COMPLEXITY HOTSPOTS (cyclomatic estimate) ==="`,
                    `find ${appDir}/src ${appDir}/server ${appDir}/client -name "*.ts" -o -name "*.tsx" 2>/dev/null | while read f; do COUNT=$(grep -cE "if\\s*\\(|else if|\\?.*:|&&|\\|\\||switch|case |for\\s*\\(|while\\s*\\(|catch\\s*\\(" "$f" 2>/dev/null); REL=$(echo "$f" | sed "s|${appDir}/||"); if [ "$COUNT" -gt 30 ]; then echo "HIGH($COUNT): $REL"; elif [ "$COUNT" -gt 15 ]; then echo "MED($COUNT): $REL"; fi; done | sort -t'(' -k2 -rn | head -15`,
                    `echo ""`,
                    `echo "=== DESIGN PATTERNS DETECTED ==="`,
                    `echo "Singleton: $(grep -rl --include='*.ts' 'private static instance\\|getInstance()' ${appDir}/src ${appDir}/server 2>/dev/null | wc -l)"`,
                    `echo "Observer/EventEmitter: $(grep -rl --include='*.ts' 'EventEmitter\\|.on(\\|.emit(' ${appDir}/src ${appDir}/server 2>/dev/null | wc -l)"`,
                    `echo "Factory: $(grep -rl --include='*.ts' 'create[A-Z].*=>\\|factory' ${appDir}/src ${appDir}/server 2>/dev/null | wc -l)"`,
                    `echo "Repository: $(grep -rl --include='*.ts' 'Repository\\|repository' ${appDir}/src ${appDir}/server 2>/dev/null | wc -l)"`,
                    `echo "Middleware: $(grep -rl --include='*.ts' 'middleware\\|app.use(' ${appDir}/src ${appDir}/server 2>/dev/null | wc -l)"`
                ].join(" ; ");
                const archResult = await sshService.executeCommand(archScript, 60000);
                return JSON.stringify({ action: "architecture_analyze", appName, analysis: archResult.output, success: archResult.success });
            }
            case "db_inspect": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const appDir = `/var/www/apps/${appName}`;
                const targetDb = args.database || "";
                const dbInspectScript = [
                    `DB_NAME="${targetDb}"`,
                    `if [ -z "$DB_NAME" ]; then DB_NAME=$(grep -oP 'DATABASE.*?//.*?/\\K[a-zA-Z0-9_-]+' ${appDir}/.env 2>/dev/null | head -1); fi`,
                    `if [ -z "$DB_NAME" ]; then echo "No database found in .env. Use database parameter."; exit 0; fi`,
                    `echo "=== DATABASE: $DB_NAME ==="`,
                    `echo ""`,
                    `echo "=== SCHEMA (tables, columns, types) ==="`,
                    `psql -d $DB_NAME -c "SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position;" 2>/dev/null | head -100`,
                    `echo ""`,
                    `echo "=== TABLE SIZES & ROW COUNTS ==="`,
                    `psql -d $DB_NAME -c "SELECT schemaname||'.'||relname AS table, pg_size_pretty(pg_total_relation_size(relid)) AS total_size, pg_size_pretty(pg_relation_size(relid)) AS data_size, n_live_tup AS row_count FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC;" 2>/dev/null`,
                    `echo ""`,
                    `echo "=== INDEXES ==="`,
                    `psql -d $DB_NAME -c "SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename;" 2>/dev/null | head -50`,
                    `echo ""`,
                    `echo "=== FOREIGN KEYS ==="`,
                    `psql -d $DB_NAME -c "SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public';" 2>/dev/null`,
                    `echo ""`,
                    `echo "=== MISSING INDEXES (seq scans > 1000) ==="`,
                    `psql -d $DB_NAME -c "SELECT schemaname||'.'||relname AS table, seq_scan, seq_tup_read, idx_scan, n_live_tup FROM pg_stat_user_tables WHERE seq_scan > 1000 AND n_live_tup > 100 ORDER BY seq_scan DESC LIMIT 10;" 2>/dev/null`,
                    `echo ""`,
                    `echo "=== SLOW QUERIES (if pg_stat_statements) ==="`,
                    `psql -d $DB_NAME -c "SELECT LEFT(query,100) AS query, calls, mean_exec_time::numeric(10,2) AS avg_ms, total_exec_time::numeric(10,2) AS total_ms FROM pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname='$DB_NAME') ORDER BY mean_exec_time DESC LIMIT 10;" 2>/dev/null || echo "pg_stat_statements not enabled"`,
                    `echo ""`,
                    `echo "=== DATABASE SIZE ==="`,
                    `psql -d $DB_NAME -c "SELECT pg_size_pretty(pg_database_size('$DB_NAME')) AS db_size;" 2>/dev/null`,
                    `echo ""`,
                    `echo "=== ACTIVE CONNECTIONS ==="`,
                    `psql -d $DB_NAME -c "SELECT state, count(*) FROM pg_stat_activity WHERE datname='$DB_NAME' GROUP BY state;" 2>/dev/null`,
                    `echo ""`,
                    `echo "=== BLOAT CHECK (dead tuples) ==="`,
                    `psql -d $DB_NAME -c "SELECT schemaname||'.'||relname AS table, n_dead_tup, n_live_tup, CASE WHEN n_live_tup>0 THEN round(n_dead_tup::numeric/n_live_tup*100,2) ELSE 0 END AS dead_pct, last_vacuum, last_autovacuum FROM pg_stat_user_tables WHERE n_dead_tup > 100 ORDER BY n_dead_tup DESC LIMIT 10;" 2>/dev/null`
                ].join(" ; ");
                const dbResult = await sshService.executeCommand(dbInspectScript, 30000);
                return JSON.stringify({ action: "db_inspect", appName, database: targetDb || "auto-detected", inspection: dbResult.output, success: dbResult.success });
            }
            case "git_intelligence": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const appDir = `/var/www/apps/${appName}`;
                const gitAction = args.gitAction || "full_report";
                const gitFile = args.file || "";
                const gitScript = (() => {
                    switch (gitAction) {
                        case "blame":
                            if (!gitFile) return `echo "Paramètre 'file' requis pour blame"`;
                            return `cd ${appDir} && git blame --line-porcelain ${gitFile} 2>/dev/null | grep -E "^author |^author-time |^summary " | paste - - - | sort | uniq -c | sort -rn | head -20`;
                        case "bisect_errors":
                            return [
                                `cd ${appDir}`,
                                `echo "=== RECENT ERROR-INTRODUCING COMMITS ==="`,
                                `for sha in $(git log --oneline -20 | awk '{print $1}'); do`,
                                `  ERRS=$(git show $sha --stat --format="" 2>/dev/null | wc -l)`,
                                `  MSG=$(git log --format="%s" -1 $sha)`,
                                `  DIFF_ADD=$(git show $sha --numstat 2>/dev/null | awk '{a+=$1}END{print a+0}')`,
                                `  DIFF_DEL=$(git show $sha --numstat 2>/dev/null | awk '{d+=$2}END{print d+0}')`,
                                `  echo "$sha | +$DIFF_ADD -$DIFF_DEL ($ERRS files) | $MSG"`,
                                `done`
                            ].join(" ; ");
                        case "hotspots":
                            return [
                                `cd ${appDir}`,
                                `echo "=== CHANGE HOTSPOTS (most modified files last 3 months) ==="`,
                                `git log --since="3 months ago" --name-only --format="" | sort | uniq -c | sort -rn | head -20`,
                                `echo ""`,
                                `echo "=== AUTHOR OWNERSHIP ==="`,
                                `git log --since="3 months ago" --format="%aN" | sort | uniq -c | sort -rn | head -10`,
                                `echo ""`,
                                `echo "=== COMMIT FREQUENCY ==="`,
                                `git log --since="3 months ago" --format="%ai" | cut -d' ' -f1 | sort | uniq -c | sort -rn | head -15`
                            ].join(" ; ");
                        case "branch_diff":
                            const targetBranch = args.targetBranch || "main";
                            const sourceBranch = args.sourceBranch || "HEAD";
                            return [
                                `cd ${appDir}`,
                                `echo "=== DIFF: ${sourceBranch} vs ${targetBranch} ==="`,
                                `git diff --stat ${targetBranch}...${sourceBranch} 2>/dev/null | tail -30`,
                                `echo ""`,
                                `echo "=== FILES CHANGED ==="`,
                                `git diff --name-status ${targetBranch}...${sourceBranch} 2>/dev/null | head -50`,
                                `echo ""`,
                                `echo "=== COMMITS AHEAD ==="`,
                                `git log --oneline ${targetBranch}..${sourceBranch} 2>/dev/null | head -20`
                            ].join(" ; ");
                        case "cherry_pick":
                            if (!args.commitSha) return `echo "Paramètre 'commitSha' requis pour cherry-pick"`;
                            return `cd ${appDir} && git cherry-pick ${args.commitSha} 2>&1 | head -20`;
                        case "full_report":
                        default:
                            return [
                                `cd ${appDir}`,
                                `echo "=== GIT HEALTH REPORT ==="`,
                                `echo "Branch: $(git branch --show-current 2>/dev/null)"`,
                                `echo "Last commit: $(git log --oneline -1 2>/dev/null)"`,
                                `echo "Commits (30 days): $(git log --since='30 days ago' --oneline 2>/dev/null | wc -l)"`,
                                `echo "Contributors (30 days): $(git log --since='30 days ago' --format='%aN' 2>/dev/null | sort -u | wc -l)"`,
                                `echo ""`,
                                `echo "=== UNCOMMITTED CHANGES ==="`,
                                `git status --short 2>/dev/null | head -20`,
                                `echo ""`,
                                `echo "=== RECENT TAGS ==="`,
                                `git tag --sort=-creatordate 2>/dev/null | head -5 || echo "No tags"`,
                                `echo ""`,
                                `echo "=== BRANCH LIST ==="`,
                                `git branch -a 2>/dev/null | head -20`,
                                `echo ""`,
                                `echo "=== CHANGE HOTSPOTS (last 30 days) ==="`,
                                `git log --since="30 days ago" --name-only --format="" 2>/dev/null | sort | uniq -c | sort -rn | head -10`,
                                `echo ""`,
                                `echo "=== LARGE FILES IN REPO ==="`,
                                `git rev-list --objects --all 2>/dev/null | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' 2>/dev/null | awk '/^blob/{print $3,$4}' | sort -rn | head -10 | awk '{printf "%.1fKB %s\\n",$1/1024,$2}'`,
                                `echo ""`,
                                `echo "=== STALE BRANCHES (no commits > 30 days) ==="`,
                                `git for-each-ref --sort=-committerdate --format='%(refname:short) | %(committerdate:relative) | %(authorname)' refs/heads 2>/dev/null | tail -5`
                            ].join(" ; ");
                    }
                })();
                const gitResult = await sshService.executeCommand(gitScript, 30000);
                return JSON.stringify({ action: "git_intelligence", appName, gitAction, success: gitResult.success, output: gitResult.output });
            }
            case "api_test": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const appDir = `/var/www/apps/${appName}`;
                const baseUrl = args.url || "";
                const endpoints = args.endpoints || [];
                const apiTestScript = [
                    `PORT=$(grep -rhoP 'PORT.*?\\K[0-9]{4,5}' ${appDir}/.env 2>/dev/null | head -1 || echo "3000")`,
                    `BASE="${baseUrl || "http://127.0.0.1:$PORT"}"`,
                    `echo "=== AUTO-DISCOVERED ENDPOINTS ==="`,
                    `grep -rhoP "(router|app)\\.(get|post|put|patch|delete)\\(['\"]([^'\"]+)['\"]" ${appDir}/src ${appDir}/server ${appDir}/app 2>/dev/null | sed "s/(router|app)\\.//" | sort -u | head -30 || echo "No routes found"`,
                    `echo ""`,
                    `echo "=== ENDPOINT TESTS ==="`,
                    endpoints.length > 0
                        ? endpoints.map((ep: any) => {
                            const method = (ep.method || "GET").toUpperCase();
                            const path = ep.path || ep;
                            const body = ep.body ? `-d '${JSON.stringify(ep.body)}'` : "";
                            const headers = ep.headers ? Object.entries(ep.headers).map(([k, v]) => `-H "${k}: ${v}"`).join(" ") : "";
                            return `echo "--- ${method} ${path} ---" && curl -s -w "\\nHTTP %{http_code} | %{time_total}s | %{size_download} bytes" -X ${method} ${headers} ${body} ${method !== "GET" ? '-H "Content-Type: application/json"' : ""} "$BASE${path}" 2>/dev/null | tail -5 && echo ""`;
                        }).join(" ; ")
                        : [
                            `echo "Auto-testing common endpoints..."`,
                            `for EP in / /api/health /api/status /health /api/v1/health; do`,
                            `  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$EP" 2>/dev/null)`,
                            `  TIME=$(curl -s -o /dev/null -w "%{time_total}" "$BASE$EP" 2>/dev/null)`,
                            `  SIZE=$(curl -s -o /dev/null -w "%{size_download}" "$BASE$EP" 2>/dev/null)`,
                            `  if [ "$CODE" != "000" ]; then echo "$EP → HTTP $CODE | ${TIME}s | ${SIZE}B"; fi`,
                            `done`,
                            `echo ""`,
                            `echo "=== API ROUTES DEEP SCAN ==="`,
                            `grep -rn --include="*.ts" --include="*.js" "\\.(get|post|put|patch|delete)\\s*(" ${appDir}/server ${appDir}/src/server ${appDir}/app/api 2>/dev/null | grep -oP "\\.(get|post|put|patch|delete)\\(['\"]([^'\"]+)['\"]" | sed 's/^\\.//' | while IFS="(" read METHOD PATH; do`,
                            `  CLEAN_PATH=$(echo $PATH | tr -d "'" | tr -d '"')`,
                            `  M=$(echo $METHOD | tr '[:lower:]' '[:upper:]')`,
                            `  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X $M "$BASE$CLEAN_PATH" 2>/dev/null)`,
                            `  TIME=$(curl -s -o /dev/null -w "%{time_total}" -X $M "$BASE$CLEAN_PATH" 2>/dev/null)`,
                            `  echo "$M $CLEAN_PATH → HTTP $CODE | ${TIME}s"`,
                            `done | head -30`
                        ].join(" ; "),
                    `echo ""`,
                    `echo "=== RESPONSE HEADERS (main endpoint) ==="`,
                    `curl -sI "$BASE/" 2>/dev/null | head -15`
                ].join(" ; ");
                const apiResult = await sshService.executeCommand(apiTestScript, 60000);
                return JSON.stringify({ action: "api_test", appName, results: apiResult.output, success: apiResult.success });
            }
            case "bundle_analyze": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const appDir = `/var/www/apps/${appName}`;
                const bundleScript = [
                    `echo "=== BUILD OUTPUT ANALYSIS ==="`,
                    `if [ -d ${appDir}/dist ]; then`,
                    `  echo "dist/ contents:"`,
                    `  find ${appDir}/dist -type f | while read f; do SIZE=$(du -h "$f" 2>/dev/null | awk '{print $1}'); REL=$(echo "$f" | sed "s|${appDir}/||"); echo "  $SIZE $REL"; done | sort -rh | head -30`,
                    `  echo ""`,
                    `  echo "Total dist size: $(du -sh ${appDir}/dist 2>/dev/null | awk '{print $1}')"`,
                    `elif [ -d ${appDir}/.next ]; then`,
                    `  echo ".next/ build:"`,
                    `  du -sh ${appDir}/.next/static/chunks/* 2>/dev/null | sort -rh | head -20`,
                    `  echo ""`,
                    `  echo "Total .next size: $(du -sh ${appDir}/.next 2>/dev/null | awk '{print $1}')"`,
                    `elif [ -d ${appDir}/build ]; then`,
                    `  echo "build/ contents:"`,
                    `  find ${appDir}/build -type f | while read f; do SIZE=$(du -h "$f" 2>/dev/null | awk '{print $1}'); REL=$(echo "$f" | sed "s|${appDir}/||"); echo "  $SIZE $REL"; done | sort -rh | head -30`,
                    `else echo "No build directory found (dist/, .next/, build/)"; fi`,
                    `echo ""`,
                    `echo "=== JS BUNDLE SIZES ==="`,
                    `find ${appDir}/dist ${appDir}/.next ${appDir}/build -name "*.js" -type f 2>/dev/null | while read f; do`,
                    `  ORIG=$(du -b "$f" 2>/dev/null | awk '{print $1}')`,
                    `  GZIP=$(gzip -c "$f" 2>/dev/null | wc -c)`,
                    `  REL=$(echo "$f" | sed "s|${appDir}/||")`,
                    `  echo "$(echo "scale=1; $ORIG/1024" | bc 2>/dev/null || echo "?")KB (gzip: $(echo "scale=1; $GZIP/1024" | bc 2>/dev/null || echo "?")KB) $REL"`,
                    `done | sort -rn | head -15`,
                    `echo ""`,
                    `echo "=== CSS BUNDLE SIZES ==="`,
                    `find ${appDir}/dist ${appDir}/.next ${appDir}/build -name "*.css" -type f 2>/dev/null | while read f; do`,
                    `  SIZE=$(du -h "$f" | awk '{print $1}'); REL=$(echo "$f" | sed "s|${appDir}/||"); echo "  $SIZE $REL"`,
                    `done | sort -rh | head -10`,
                    `echo ""`,
                    `echo "=== ASSET ANALYSIS ==="`,
                    `echo "Images: $(find ${appDir}/dist ${appDir}/.next ${appDir}/build -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" -o -name "*.svg" -o -name "*.webp" -o -name "*.gif" 2>/dev/null | wc -l) files, $(find ${appDir}/dist ${appDir}/.next ${appDir}/build \\( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.svg' -o -name '*.webp' -o -name '*.gif' \\) 2>/dev/null | xargs du -ch 2>/dev/null | tail -1 | awk '{print $1}') total"`,
                    `echo "Fonts: $(find ${appDir}/dist ${appDir}/.next ${appDir}/build -name "*.woff*" -o -name "*.ttf" -o -name "*.otf" 2>/dev/null | wc -l) files"`,
                    `echo ""`,
                    `echo "=== UNUSED DEPENDENCIES CHECK ==="`,
                    `cd ${appDir} && node -e "
const pkg=require('./package.json');
const deps=Object.keys(pkg.dependencies||{});
const fs=require('fs');
function walk(d,a=[]){try{fs.readdirSync(d).forEach(f=>{const p=d+'/'+f;if(f==='node_modules'||f==='.git'||f==='dist'||f==='.next')return;if(fs.statSync(p).isDirectory())walk(p,a);else if(/\\.(ts|tsx|js|jsx)$/.test(f))a.push(fs.readFileSync(p,'utf8'))});return a}catch{return a}}
const code=walk('src').concat(walk('server')).concat(walk('client')).concat(walk('app')).join('\\n');
const unused=deps.filter(d=>!code.includes(d)&&!code.includes(d.replace(/@/,'').replace(/\\//g,'-')));
console.log(unused.length?'Potentially unused: '+unused.join(', '):'All dependencies appear used');
" 2>/dev/null || echo "Check failed"`,
                    `echo ""`,
                    `echo "=== SOURCE MAP CHECK ==="`,
                    `MAPS=$(find ${appDir}/dist ${appDir}/.next ${appDir}/build -name "*.map" 2>/dev/null | wc -l)`,
                    `MAP_SIZE=$(find ${appDir}/dist ${appDir}/.next ${appDir}/build -name "*.map" 2>/dev/null | xargs du -ch 2>/dev/null | tail -1 | awk '{print $1}')`,
                    `echo "Source maps: $MAPS files ($MAP_SIZE)" && if [ "$MAPS" -gt 0 ] 2>/dev/null; then echo "WARNING: $MAPS source maps in production — consider removing"; else echo "Clean: no source maps in production"; fi`
                ].join(" ; ");
                const bundleResult = await sshService.executeCommand(bundleScript, 60000);
                return JSON.stringify({ action: "bundle_analyze", appName, analysis: bundleResult.output, success: bundleResult.success });
            }
            case "env_clone": {
                if (!appName) return JSON.stringify({ error: "appName (source) requis" });
                const targetApp = args.targetApp;
                if (!targetApp) return JSON.stringify({ error: "targetApp requis (app de destination)" });
                const sourceDir = `/var/www/apps/${appName}`;
                const targetDir = `/var/www/apps/${targetApp}`;
                const cloneScript = [
                    `echo "=== CLONING ENV: ${appName} → ${targetApp} ==="`,
                    `if [ ! -d ${sourceDir} ]; then echo "Source app ${appName} not found"; exit 1; fi`,
                    `mkdir -p ${targetDir}`,
                    `echo "1/5 - Cloning code..."`,
                    `REPO_URL=$(cd ${sourceDir} && git remote get-url origin 2>/dev/null)`,
                    `if [ -n "$REPO_URL" ]; then git clone $REPO_URL ${targetDir}_tmp 2>&1 | tail -3 && cp -r ${targetDir}_tmp/* ${targetDir}_tmp/.* ${targetDir}/ 2>/dev/null && rm -rf ${targetDir}_tmp; else cp -r ${sourceDir}/* ${targetDir}/ 2>/dev/null; fi`,
                    `echo "2/5 - Copying environment..."`,
                    `cp ${sourceDir}/.env ${targetDir}/.env 2>/dev/null && sed -i "s/${appName}/${targetApp}/g" ${targetDir}/.env || echo "No .env"`,
                    `echo "3/5 - Copying PM2 config..."`,
                    `cp ${sourceDir}/ecosystem.config.cjs ${targetDir}/ecosystem.config.cjs 2>/dev/null && sed -i "s/${appName}/${targetApp}/g" ${targetDir}/ecosystem.config.cjs || echo "No PM2 config"`,
                    `echo "4/5 - Installing dependencies..."`,
                    `cd ${targetDir} && npm ci 2>&1 | tail -5`,
                    `echo "5/5 - Summary..."`,
                    `echo "Source: ${sourceDir} ($(du -sh ${sourceDir} 2>/dev/null | awk '{print $1}'))"`,
                    `echo "Target: ${targetDir} ($(du -sh ${targetDir} 2>/dev/null | awk '{print $1}'))"`,
                    `echo ""`,
                    `echo "NEXT STEPS:"`,
                    `echo "1. Update ${targetDir}/.env with correct values"`,
                    `echo "2. Run: devops_server deploy to start with PM2 + Nginx"`,
                    `echo "3. Or: pm2 start ${targetDir}/ecosystem.config.cjs"`
                ].join(" ; ");
                const cloneResult = await sshService.executeCommand(cloneScript, 120000);
                return JSON.stringify({ action: "env_clone", source: appName, target: targetApp, success: cloneResult.success, output: cloneResult.output });
            }
            case "docs_generate": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const appDir = `/var/www/apps/${appName}`;
                const docsScript = [
                    `cd ${appDir} 2>/dev/null || exit 1`,
                    `echo "# ${appName} — Auto-Generated Documentation"`,
                    `echo ""`,
                    `echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"`,
                    `echo ""`,
                    `echo "## Project Overview"`,
                    `PKG=$(cat package.json 2>/dev/null)`,
                    `echo "- **Name**: $(echo $PKG | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).name||'N/A'))" 2>/dev/null || echo "N/A")"`,
                    `echo "- **Version**: $(echo $PKG | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).version||'N/A'))" 2>/dev/null || echo "N/A")"`,
                    `echo "- **Description**: $(echo $PKG | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).description||'N/A'))" 2>/dev/null || echo "N/A")"`,
                    `echo ""`,
                    `echo "## Tech Stack"`,
                    `node -e "const p=require('./package.json');const d={...p.dependencies,...p.devDependencies};const frameworks=['react','next','express','fastify','nestjs','vue','angular','svelte','hono','koa'];const found=frameworks.filter(f=>d[f]);console.log('- Framework: '+(found.join(', ')||'None detected'));const db=['prisma','drizzle-orm','knex','sequelize','typeorm','mongoose','pg','mysql2'];const dbFound=db.filter(f=>d[f]);console.log('- Database: '+(dbFound.join(', ')||'None detected'));const test=['vitest','jest','mocha','cypress','playwright'];const testFound=test.filter(f=>d[f]);console.log('- Testing: '+(testFound.join(', ')||'None configured'));console.log('- TypeScript: '+(d.typescript?'Yes':'No'));console.log('- Dependencies: '+Object.keys(p.dependencies||{}).length+' prod, '+Object.keys(p.devDependencies||{}).length+' dev');" 2>/dev/null`,
                    `echo ""`,
                    `echo "## Scripts"`,
                    `node -e "const s=require('./package.json').scripts||{};Object.entries(s).forEach(([k,v])=>console.log('- \\\`npm run '+k+'\\\`: '+v))" 2>/dev/null`,
                    `echo ""`,
                    `echo "## API Endpoints"`,
                    `grep -rn --include="*.ts" --include="*.js" "\\.(get|post|put|patch|delete)\\s*(" server/ src/server/ app/api/ routes/ 2>/dev/null | grep -oP "(get|post|put|patch|delete)\\(['\"]([^'\"]+)" | sed "s/'//" | sed 's/"//' | sed 's/^/- /' | sort -u | head -40 || echo "No API routes found"`,
                    `echo ""`,
                    `echo "## Directory Structure"`,
                    `find . -maxdepth 3 -type d -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/.next/*" -not -path "*/dist/*" 2>/dev/null | sed 's/[^/]*\\//  /g' | head -40`,
                    `echo ""`,
                    `echo "## Environment Variables"`,
                    `if [ -f .env.example ]; then cat .env.example | sed 's/=.*/=.../' | sed 's/^/- \\\`/' | sed 's/$/\\\`/'; elif [ -f .env ]; then cat .env | grep -v "^#" | grep "=" | sed 's/=.*/=.../' | sed 's/^/- \\\`/' | sed 's/$/\\\`/'; else echo "No .env.example or .env found"; fi`,
                    `echo ""`,
                    `echo "## Key Files"`,
                    `for f in src/index.ts server/index.ts app/layout.tsx pages/_app.tsx src/App.tsx client/src/App.tsx; do [ -f "$f" ] && echo "- \\\`$f\\\` ($(wc -l < "$f") lines)"; done`
                ].join(" ; ");
                const docsResult = await sshService.executeCommand(docsScript, 30000);
                const docsContent = docsResult.output || "";
                if (docsResult.success && docsContent.length > 50) {
                    try {
                        const { applyPatch: ghPatch } = await import("../githubService");
                        const repoUrl = await sshService.executeCommand(`cd ${appDir} && git remote get-url origin 2>/dev/null`, 5000);
                        const match = repoUrl.output?.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
                        if (match) {
                            await ghPatch(match[1], match[2], "main", [{ path: "DOCS.md", content: docsContent }], "docs: auto-generate project documentation");
                        }
                    } catch (e) { }
                }
                return JSON.stringify({ action: "docs_generate", appName, documentation: docsContent, success: docsResult.success });
            }
            case "monitoring_setup": {
                if (!appName) return JSON.stringify({ error: "appName requis" });
                const sanitizedMonApp = appName.replace(/[^a-zA-Z0-9_-]/g, "");
                if (sanitizedMonApp !== appName) return JSON.stringify({ error: "appName invalide" });
                const appDir = `/var/www/apps/${sanitizedMonApp}`;
                const monitorAction = args.monitorAction || "status";
                const monitorScript = (() => {
                    switch (monitorAction) {
                        case "enable":
                            return [
                                `echo "=== SETTING UP MONITORING FOR ${sanitizedMonApp} ==="`,
                                `PORT=$(grep -rhoP 'PORT.*?\\K[0-9]{4,5}' ${appDir}/.env 2>/dev/null | head -1)`,
                                `DOMAIN=$(grep -l "${sanitizedMonApp}" /etc/nginx/sites-enabled/* 2>/dev/null | head -1 | xargs grep server_name 2>/dev/null | awk '{print $2}' | tr -d ';')`,
                                `MONITOR_DIR=/var/monitoring`,
                                `WEBHOOK_URL=$(cat /var/www/ulysse/.env 2>/dev/null | grep DISCORD_WEBHOOK_URL | cut -d= -f2-)`,
                                `mkdir -p $MONITOR_DIR /var/log`,
                                `cat > $MONITOR_DIR/${sanitizedMonApp}.json << MONITOR_EOF`,
                                `{"app":"${sanitizedMonApp}","port":"$PORT","domain":"$DOMAIN","alerts":{"consecutive_failures":3,"notify":"discord"},"created":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}`,
                                `MONITOR_EOF`,
                                `cat > /var/monitoring/check_${sanitizedMonApp}.sh << 'SCRIPT_EOF'`,
                                `#!/bin/bash`,
                                `APP=${sanitizedMonApp}`,
                                `PORT=$(grep -rhoP 'PORT.*?\\K[0-9]{4,5}' /var/www/apps/$APP/.env 2>/dev/null | head -1)`,
                                `FAIL_FILE=/tmp/monitor_\${APP}_fails`,
                                `HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 10 http://127.0.0.1:$PORT/ 2>/dev/null || echo "000")`,
                                `RESP_TIME=$(curl -sf -o /dev/null -w "%{time_total}" --max-time 10 http://127.0.0.1:$PORT/ 2>/dev/null || echo "0")`,
                                `if [ "$HTTP_CODE" = "000" ] || [ "$HTTP_CODE" = "502" ] || [ "$HTTP_CODE" = "503" ]; then`,
                                `  FAILS=$(cat $FAIL_FILE 2>/dev/null || echo 0)`,
                                `  FAILS=$((FAILS + 1))`,
                                `  echo $FAILS > $FAIL_FILE`,
                                `  echo "$(date) $APP DOWN (HTTP $HTTP_CODE, fail #$FAILS)" >> /var/log/monitor_$APP.log`,
                                `  if [ "$FAILS" -ge 3 ]; then`,
                                `    pm2 restart $APP 2>/dev/null`,
                                `    echo "$(date) $APP AUTO-RESTARTED after $FAILS failures" >> /var/log/monitor_$APP.log`,
                                `    WEBHOOK=$(cat /var/www/ulysse/.env 2>/dev/null | grep DISCORD_WEBHOOK_URL | cut -d= -f2-)`,
                                `    if [ -n "$WEBHOOK" ]; then`,
                                `      curl -sf -H "Content-Type: application/json" -d "{\\"content\\":\\"🚨 **ALERTE** — $APP est DOWN (HTTP $HTTP_CODE). Auto-restart effectué après $FAILS échecs consécutifs.\\"}" "$WEBHOOK" 2>/dev/null`,
                                `    fi`,
                                `    echo 0 > $FAIL_FILE`,
                                `  fi`,
                                `else`,
                                `  echo 0 > $FAIL_FILE`,
                                `fi`,
                                `SCRIPT_EOF`,
                                `chmod +x /var/monitoring/check_${sanitizedMonApp}.sh`,
                                `CRON_EXISTS=$(crontab -l 2>/dev/null | grep "check_${sanitizedMonApp}" | wc -l)`,
                                `if [ "$CRON_EXISTS" -eq 0 ]; then`,
                                `  (crontab -l 2>/dev/null; echo "*/3 * * * * /var/monitoring/check_${sanitizedMonApp}.sh # monitor_${sanitizedMonApp}") | crontab -`,
                                `  echo "Cron monitor installed (every 3 min with auto-restart + Discord alert)"`,
                                `fi`,
                                `echo "Monitoring ENABLED: HTTP check + auto-restart + Discord alerts after 3 failures"`,
                                `echo "Check interval: 3 minutes"`
                            ].join("\n");
                        case "disable":
                            return [
                                `crontab -l 2>/dev/null | grep -v "monitor_${appName}" | crontab -`,
                                `rm -f /var/monitoring/${appName}.json`,
                                `echo "Monitoring disabled for ${appName}"`
                            ].join(" ; ");
                        case "logs":
                            return [
                                `echo "=== MONITORING LOGS FOR ${appName} ==="`,
                                `cat /var/log/monitor_${appName}.log 2>/dev/null | tail -50 || echo "No monitoring logs"`,
                                `echo ""`,
                                `echo "=== UPTIME HISTORY ==="`,
                                `pm2 describe ${appName} 2>/dev/null | grep -E "uptime|restart|unstable" || echo "PM2 info unavailable"`
                            ].join(" ; ");
                        case "status":
                        default:
                            return [
                                `echo "=== MONITORING STATUS ==="`,
                                `if [ -f /var/monitoring/${appName}.json ]; then echo "Config: ACTIVE" && cat /var/monitoring/${appName}.json 2>/dev/null; else echo "Config: NOT CONFIGURED"; fi`,
                                `echo ""`,
                                `CRON=$(crontab -l 2>/dev/null | grep "monitor_${appName}")`,
                                `echo "Cron monitor: $([ -n \"$CRON\" ] && echo 'ACTIVE' || echo 'INACTIVE')"`,
                                `[ -n "$CRON" ] && echo "Schedule: $CRON"`,
                                `echo ""`,
                                `echo "=== CURRENT HEALTH ==="`,
                                `PORT=$(grep -rhoP 'PORT.*?\\K[0-9]{4,5}' ${appDir}/.env 2>/dev/null | head -1)`,
                                `PM2_STATUS=$(pm2 describe ${appName} 2>/dev/null | grep status | awk '{print $4}')`,
                                `echo "PM2 status: $PM2_STATUS"`,
                                `echo "HTTP check: $(curl -s -o /dev/null -w 'HTTP %{http_code} (%{time_total}s)' http://127.0.0.1:$PORT/ 2>/dev/null || echo 'FAILED')"`,
                                `echo "Uptime: $(pm2 describe ${appName} 2>/dev/null | grep uptime | awk '{print $4}')"`,
                                `echo "Restarts: $(pm2 describe ${appName} 2>/dev/null | grep restarts | awk '{print $4}')"`,
                                `echo ""`,
                                `echo "=== INCIDENT LOG ==="`,
                                `tail -10 /var/log/monitor_${appName}.log 2>/dev/null || echo "No incidents recorded"`
                            ].join(" ; ");
                    }
                })();
                const monitorResult = await sshService.executeCommand(monitorScript, 30000);
                return JSON.stringify({ action: "monitoring_setup", appName, monitorAction, success: monitorResult.success, output: monitorResult.output });
            }
            case "full_pipeline": {
                if (!appName) return JSON.stringify({ error: "appName requis pour full_pipeline" });
                const appDir = `/var/www/apps/${appName}`;
                const pipelineStages: string[] = [];
                const pipelineResults: Record<string, any> = { action: "full_pipeline", appName, stages: {} };
                pipelineStages.push("1. PRE-FLIGHT CHECK");
                const preflight = await sshService.executeCommand([
                    `echo "App directory: $(test -d ${appDir} && echo 'EXISTS' || echo 'NOT FOUND')"`,
                    `echo "Git status: $(cd ${appDir} && git status --short 2>/dev/null | wc -l) uncommitted changes"`,
                    `echo "PM2 status: $(pm2 describe ${appName} 2>/dev/null | grep status | awk '{print $4}' || echo 'not running')"`,
                    `echo "Node version: $(node -v 2>/dev/null)"`,
                    `echo "Disk free: $(df -h /var/www 2>/dev/null | tail -1 | awk '{print $4}')"`,
                ].join(" ; "), 10000);
                pipelineResults.stages["preflight"] = { output: preflight.output, success: preflight.success };
                pipelineStages.push("2. BACKUP");
                const backup = await sshService.executeCommand([
                    `TIMESTAMP=$(date +%Y%m%d-%H%M%S)`,
                    `mkdir -p /var/backups/apps`,
                    `cd ${appDir} && git stash 2>/dev/null`,
                    `tar -czf /var/backups/apps/${appName}_pre_pipeline_$TIMESTAMP.tar.gz -C ${appDir} --exclude=node_modules --exclude=.git . 2>&1 | tail -3`,
                    `DB_NAME=$(grep -oP 'DATABASE.*?//.*?/\\K[a-zA-Z0-9_-]+' ${appDir}/.env 2>/dev/null | head -1)`,
                    `if [ -n "$DB_NAME" ]; then pg_dump $DB_NAME 2>/dev/null | gzip > /var/backups/apps/${appName}_db_$TIMESTAMP.sql.gz && echo "DB backed up"; fi`,
                    `echo "Backup: /var/backups/apps/${appName}_pre_pipeline_$TIMESTAMP.tar.gz"`
                ].join(" ; "), 60000);
                pipelineResults.stages["backup"] = { output: backup.output, success: backup.success };
                pipelineStages.push("3. PULL & BUILD");
                const build = await sshService.executeCommand([
                    `cd ${appDir}`,
                    `git pull origin $(git branch --show-current 2>/dev/null || echo main) 2>&1 | tail -5`,
                    `npm ci 2>&1 | tail -5`,
                    `npm run build 2>&1 | tail -10 || echo "No build step"`
                ].join(" && "), 120000);
                pipelineResults.stages["build"] = { output: build.output, success: build.success };
                if (!build.success) {
                    pipelineResults.stages["build"].error = "BUILD FAILED — Pipeline stopped. Backup available for rollback.";
                    pipelineResults.pipelineSuccess = false;
                    return JSON.stringify(pipelineResults);
                }
                pipelineStages.push("4. TEST");
                const test = await sshService.executeCommand(`cd ${appDir} && npm test 2>&1 | tail -20 || echo "No tests configured"`, 120000);
                pipelineResults.stages["test"] = { output: test.output, success: test.success || test.output?.includes("No tests") };
                pipelineStages.push("5. SECURITY CHECK");
                const sec = await sshService.executeCommand(`cd ${appDir} && npm audit --production 2>&1 | tail -10 || echo "Audit done"`, 30000);
                pipelineResults.stages["security"] = { output: sec.output, success: sec.success };
                pipelineStages.push("6. DEPLOY");
                const deploy = await sshService.executeCommand([
                    `pm2 restart ${appName} 2>/dev/null && echo "PM2 restarted"`,
                    `sleep 3`,
                    `pm2 describe ${appName} 2>/dev/null | grep -E "status|uptime|restart"`
                ].join(" ; "), 30000);
                pipelineResults.stages["deploy"] = { output: deploy.output, success: deploy.success };
                pipelineStages.push("7. HEALTH CHECK");
                const health = await sshService.executeCommand([
                    `PORT=$(grep -rhoP 'PORT.*?\\K[0-9]{4,5}' ${appDir}/.env 2>/dev/null | head -1)`,
                    `ATTEMPTS=0; MAX=5`,
                    `while [ $ATTEMPTS -lt $MAX ]; do`,
                    `  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$PORT/ 2>/dev/null)`,
                    `  if [ "$CODE" -ge 200 ] && [ "$CODE" -lt 400 ]; then echo "Health check PASSED (HTTP $CODE) after $((ATTEMPTS+1)) attempts"; break; fi`,
                    `  ATTEMPTS=$((ATTEMPTS+1)); sleep 2`,
                    `done`,
                    `if [ $ATTEMPTS -eq $MAX ]; then echo "Health check FAILED after $MAX attempts — consider rollback"; fi`
                ].join(" ; "), 30000);
                pipelineResults.stages["health"] = { output: health.output, success: health.success && !health.output?.includes("FAILED") };
                pipelineResults.pipelineSuccess = Object.values(pipelineResults.stages).every((s: any) => s.success !== false);
                pipelineResults.stagesCompleted = pipelineStages;
                return JSON.stringify(pipelineResults);
            }
            default:
                const allActions = "status, health, list_apps, app_info, deploy, update, logs, restart, stop, delete, scale, exec, ssl, env_get, env_set, env_delete, list_databases, backup_db, restore_db, list_backups, nginx_configs, nginx_audit, nginx_catchall, verify_url, url_diagnose, url_diagnose_all, cron_list, cron_add, cron_delete, install_packages, run_tests, analyze_deps, debug_app, refactor_check, rollback_app, migrate_db, profile_app, log_search, security_scan, backup_app, scaffold_project, perf_loadtest, architecture_analyze, db_inspect, git_intelligence, api_test, bundle_analyze, env_clone, docs_generate, monitoring_setup, full_pipeline";
                return JSON.stringify({ error: `Action inconnue: ${action}. Actions disponibles: ${allActions}` });
        }
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[DevOps Server] Error:`, msg);
        return JSON.stringify({ error: `Erreur serveur: ${msg}` });
    }
}
