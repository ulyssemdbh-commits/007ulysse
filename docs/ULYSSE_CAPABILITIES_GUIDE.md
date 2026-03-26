# Guide Complet des Capacités Ulysse - 249+ Fonctionnalités

## Vue d'Ensemble

Ulysse (ou Iris pour les utilisateurs approuvés) est un assistant IA personnel avec **249+ capacités** réparties en **22+ catégories**, **84 tool handlers** via ActionHub, et **56+ jobs planifiés**. Ce guide détaille chaque capacité et comment l'utiliser de manière optimale.

**Version:** 6.1 (DevMax SaaS + Anti-Read-Loop + SelfHealing optimisé + ChatCOBA)
**Dernière mise à jour:** Mars 2026

Ce guide sert de **triple référence** : pour Maurice, pour le développeur, et pour Ulysse lui-même (auto-référence pour diagnostiquer et améliorer ses capacités).

---

## ACTION-FIRST ORCHESTRATOR V4 (ARCHITECTURE UNIFIEE)

### Principe Fondamental
Ulysse n'est PAS un chatbot passif. C'est un assistant AUTONOME qui **AGIT D'ABORD, PARLE ENSUITE**.

L'Action-First Orchestrator V4 unifie le backend OpenAI function calling et le système de marqueurs runtime avec un **contrôle d'accès strict par persona**.

### Architecture

| Composant | Description |
|-----------|-------------|
| **ActionFirstOrchestrator** | Orchestrateur central avec workflow detection et prompt injection prioritaire |
| **UnifiedMarkerExecutor** | Exécuteur centralisé de tous les marqueurs avec permissions strictes |
| **Persona Mapping** | Owner → Ulysse, role=approved → Iris, autres → Alfred |

### Règles Impératives
1. **EXÉCUTE** les actions demandées IMMÉDIATEMENT
2. **UTILISE** les outils disponibles SANS demander permission
3. **CONFIRME** après avoir agi, JAMAIS avant
4. **NE PROPOSE PAS** d'alternatives - TU AGIS
5. **NE DIS JAMAIS** "je ne peux pas" - TU TROUVES un moyen

### Comportements Interdits (Anti-Patterns)
- "Je peux t'envoyer..." → INTERDIT (doit envoyer directement)
- "Veux-tu que je..." → INTERDIT (sauf calendrier)
- "Je n'ai pas accès à..." → INTERDIT
- "Voici ce que je ferais..." → INTERDIT (doit le faire)
- "Tu pourrais écrire..." → INTERDIT (doit écrire)

### Modèle de Permissions Strict

| Persona | Action-First | Actions Autorisées | Raison |
|---------|--------------|-------------------|--------|
| **Ulysse (Owner)** | OUI | TOUTES (11 actions) | Accès complet, autonomie totale |
| **Iris (Famille)** | OUI | Family (4 actions) | Confiance familiale, actions limitées |
| **Alfred (Externe)** | NON | AUCUNE automatique | Sécurité, confirmation toujours requise |

### Actions Owner-Only (7 actions)
Ces actions ne peuvent être exécutées que par le propriétaire (Ulysse):
- **kanban** - Gestion des tâches Kanban DevFlow
- **drive** - Accès Google Drive
- **notion** - Accès Notion
- **domotique** - Contrôle Smart Home
- **integration** - Gestion des intégrations
- **face_recognition** - Reconnaissance faciale
- **image_generation** - Génération d'images DALL-E

### Actions Family (4 actions)
Ces actions sont autorisées pour Ulysse et Iris:
- **email** - Envoi et gestion des emails
- **todoist** - Gestion des tâches Todoist
- **spotify** - Contrôle Spotify
- **image_search** - Recherche d'images

### Alfred - Blocage Complet
Les utilisateurs externes (Alfred) ne peuvent exécuter **AUCUNE action automatiquement**:
- Toutes les actions nécessitent une confirmation explicite
- Les marqueurs d'action sont bloqués par UnifiedMarkerExecutor
- Mode lecture seule avec assistance conversationnelle

### Email Preview Broadcasting
Les previews d'email sont diffusés en temps réel via WebSocket:
- Le serveur émet des événements `email.preview`
- Le client affiche les previews avant envoi
- Intégration via hook `useAIPreview`

---

## Architecture Fondamentale

**Serveur Central 24/7** - Toutes les actions sont exécutées depuis le serveur central, pas depuis l'appareil. Cela garantit:
- Performance identique sur iPhone, PC, tablette
- Continuité des tâches même si l'app est fermée
- Synchronisation temps réel sur tous les appareils
- Base de données PostgreSQL pour persistance permanente
- Object Storage Cloud (Google Cloud) pour fichiers binaires

---

## 1. RECHERCHE (7 capacités)

### 1.1 Recherche Web
- **Outil**: `web_search`
- **Description**: Chercher des informations actuelles via MARS multi-engine
- **Exemple**: "Cherche les dernières news sur l'IA"
- **Usage optimal**: Actualité, prix, météo, événements. Jusqu'à 5 sources simultanées.
- **Action-First**: Recherche immédiate, résultats synthétisés

### 1.2 Lecture de Sites Web
- **Description**: Analyser le contenu complet de n'importe quelle URL
- **Exemple**: "Lis cet article: https://example.com/article"
- **Usage optimal**: Extraire données, résumer articles, surveiller pages via homework

### 1.3 MARS v2 - Multi-source Accurate Research System
- **Description**: Système de recherche focalisée sur la PRÉCISION. 3 moteurs en parallèle.
- **Moteurs**: Serper + Perplexity Sonar + Brave Search
- **Exemple**: "Cherche les derniers résultats OM avec précision maximale"
- **Usage optimal**: Croise sources, lecture profonde, règles anti-approximation

### 1.4 Scoring 4 Axes MARS (0-100)
- **Description**: Score de fiabilité: Relevance (30%), Authority (25%), Freshness (25%), Quality (20%)
- **Seuils**: >=75 haute confiance, >=55 moyenne, >=35 basse, <35 non fiable
- **Domaines pré-scorés**: Reuters 38, BBC 37, L'Équipe 35, GitHub 33

### 1.5 Extraction de Faits Sémantique
- **Description**: Extraction automatique de statistiques, dates, événements avec détection consensus/divergences
- **Indicateurs**: Vérifié, Probable, Divergent

### 1.6 Politique Anti-Approximation
- **Description**: Refuse de répondre si sources insuffisantes. 2 sources fiables (>=60) OU 1 ultra-fiable (>=85)
- **Principe**: L'absence de réponse = honnêteté

### 1.7 Query Rewriting
- **Description**: Expansion automatique des abréviations (OM → Olympique de Marseille, PSG → Paris Saint-Germain)

---

## 2. EMAIL AGENTMAIL (8 capacités)

### 2.1 Envoyer un Email
- **Outil**: `email_send`
- **Action-First**: ✅ Envoi IMMÉDIAT sans confirmation
- **Exemple**: "Envoie un email à test@example.com pour dire bonjour"
- **Inboxes**: ulysse@agentmail.to, iris-assist@agentmail.to, alfred-assist@agentmail.to

### 2.2 Envoyer Email avec PDF
- **Outil**: `email_send` avec `pdfContent`
- **Action-First**: ✅ Génération + Envoi IMMÉDIAT
- **Exemple**: "Envoie un rapport PDF à client@example.com"

### 2.3 Envoyer Email avec Word
- **Outil**: `email_send` avec `wordContent`
- **Action-First**: ✅ Génération + Envoi IMMÉDIAT

### 2.4 Répondre à un Email
- **Outil**: `email_send` avec `messageId`
- **Action-First**: ✅ Réponse IMMÉDIATE
- **Accès**: Barre latérale > EMAIL > Sélectionner > Répondre

### 2.5 Lire les Emails
- **Outil**: `email_list_inbox`
- **Description**: Consultation boîte de réception, emails catégorisés
- **Accès**: Barre latérale > EMAIL - 3 onglets: Reçus, Envoyés, Threads

### 2.6 Actualiser les Emails
- **Description**: Force récupération immédiate (auto toutes les 30 min)

### 2.7 Recherche dans Emails
- **Description**: Recherche par sujet, expéditeur, contenu

### 2.8 Catégorisation Automatique
- **Description**: Tri automatique par importance et type

---

## 3. TÂCHES TODOIST (4 capacités) - NOUVEAU

### 3.1 Créer une Tâche
- **Outil**: `todoist_create_task`
- **Action-First**: ✅ Création IMMÉDIATE sans confirmation
- **Paramètres**: content, description, due_string, priority (1-4), project_name
- **Exemple**: "Crée une tâche pour appeler le client demain"

### 3.2 Lister les Tâches
- **Outil**: `todoist_list_tasks`
- **Filtres**: today, overdue, all
- **Exemple**: "Quelles sont mes tâches du jour?"

### 3.3 Compléter une Tâche
- **Outil**: `todoist_complete_task`
- **Action-First**: ✅ Complétion IMMÉDIATE
- **Exemple**: "Marque la tâche 'appeler client' comme terminée"

### 3.4 Organisation par Projet
- **Description**: Filtrage et création par projet Todoist

---

## 4. KANBAN DEVFLOW (3 capacités) - NOUVEAU

### 4.1 Créer une Tâche Kanban
- **Outil**: `kanban_create_task`
- **Action-First**: ✅ Création IMMÉDIATE sans confirmation
- **Paramètres**: title, description, priority (low/medium/high), project_id
- **Exemple**: "Ajoute une tâche au Kanban pour la feature login"

### 4.2 Déplacer une Tâche
- **Description**: Changer le statut (todo → in_progress → done)

### 4.3 Vue par Projet
- **Description**: Filtrage par projet DevFlow

---

## 5. CALENDRIER GOOGLE (4 capacités)

### 5.1 Lire les Événements
- **Outil**: `calendar_list_events`
- **Description**: Consulter Google Calendar, détection de conflits
- **Accès**: Barre latérale > CALENDRIER

### 5.2 Créer un Événement
- **Outil**: `calendar_create_event`
- **Paramètres**: title, start_datetime, end_datetime, description, location
- **Exemple**: "Ajoute une réunion demain à 14h"
- **Note**: Seule action où confirmation peut être demandée (RDV importants)

### 5.3 Modifier un Événement
- **Description**: Mise à jour de titre, horaire, lieu

### 5.4 Supprimer un Événement
- **Description**: Annulation de rendez-vous

---

## 6. DOMOTIQUE - SMART HOME (6 capacités) - NOUVEAU

### 6.1 Lister les Appareils
- **Outil**: `smarthome_control` action=list_devices
- **Description**: Voir tous les appareils connectés

### 6.2 Allumer/Éteindre
- **Outil**: `smarthome_control` action=turn_on/turn_off
- **Action-First**: ✅ Exécution IMMÉDIATE
- **Exemple**: "Éteins la lumière du salon"

### 6.3 Régler la Luminosité
- **Outil**: `smarthome_control` action=set_brightness
- **Paramètre**: value (0-100)
- **Exemple**: "Mets la lumière à 50%"

### 6.4 Changer la Couleur
- **Outil**: `smarthome_control` action=set_color
- **Paramètre**: color (hex ou nom)
- **Exemple**: "Mets la lumière en bleu"

### 6.5 Régler la Température
- **Outil**: `smarthome_control` action=set_temperature
- **Paramètre**: value (en °C)
- **Exemple**: "Mets le thermostat à 21°C"

### 6.6 Activer une Scène
- **Outil**: `smarthome_control` action=activate_scene
- **Exemple**: "Active la scène cinéma"

---

## 7. SPOTIFY (7 capacités) - NOUVEAU

### 7.1 Play/Pause
- **Outil**: `spotify_control` action=play/pause
- **Action-First**: ✅ Exécution IMMÉDIATE

### 7.2 Morceau Suivant/Précédent
- **Outil**: `spotify_control` action=next/previous

### 7.3 Régler le Volume
- **Outil**: `spotify_control` action=volume
- **Paramètre**: volume (0-100)

### 7.4 Rechercher de la Musique
- **Outil**: `spotify_control` action=search
- **Paramètre**: query

### 7.5 Jouer un Morceau Spécifique
- **Outil**: `spotify_control` action=play_track
- **Paramètre**: track_uri

### 7.6 Lister les Appareils
- **Outil**: `spotify_control` action=devices

### 7.7 État de Lecture
- **Outil**: `spotify_control` action=playback_status

---

## 8. SPORTS & PRONOS (8 capacités) - NOUVEAU

### 8.1 Matchs du Jour
- **Outil**: `query_sports_data` query_type=today_matches
- **Ligues**: Ligue 1, Premier League, La Liga, Serie A, Bundesliga, etc.

### 8.2 Prochains Matchs
- **Outil**: `query_sports_data` query_type=upcoming_matches
- **Paramètre**: team (optionnel)

### 8.3 Prochain Match d'une Équipe
- **Outil**: `query_sports_data` query_type=next_match
- **Exemple**: "C'est quand le prochain match de l'OM?"

### 8.4 Statistiques d'Équipe
- **Outil**: `query_sports_data` query_type=team_stats
- **Paramètre**: team

### 8.5 Cotes de Paris
- **Outil**: `query_sports_data` query_type=odds
- **Sources**: API-Sports, SportsGameOdds, TheOddsAPI (cascade)

### 8.6 Prédictions
- **Outil**: `query_sports_data` query_type=predictions
- **Description**: Analyse Poisson + historique + forme

### 8.7 Classements
- **Description**: Classements actuels des ligues

### 8.8 Mémorisation des Pronos
- **Description**: Suivi des résultats et apprentissage automatique

---

## 9. BOURSE & TRADING (7 capacités) - NOUVEAU

### 9.1 Cotation en Temps Réel
- **Outil**: `query_stock_data` query_type=quote
- **Sources**: Finnhub (primary), Twelve Data, Alpha Vantage

### 9.2 Historique de Prix
- **Outil**: `query_stock_data` query_type=history
- **Périodes**: 1D, 1W, 1M, 3M, 1Y

### 9.3 Profil d'Entreprise
- **Outil**: `query_stock_data` query_type=profile
- **Données**: Secteur, capitalisation, description

### 9.4 Recommandations Analystes
- **Outil**: `query_stock_data` query_type=recommendations
- **Consensus**: Buy/Hold/Sell avec scores

### 9.5 Analyse Technique
- **Indicateurs**: RSI, MACD, SMA50/200, Bollinger
- **Signaux**: achat_fort, achat, neutre, vente, vente_forte

### 9.6 Alertes de Prix
- **Description**: Notifications sur seuils personnalisés

### 9.7 Briefing Marché
- **Description**: Résumé quotidien des indices majeurs

---

## 10. FICHIERS (8 capacités)

### 10.1 Lire PDF
- **Description**: OCR automatique, extraction de tableaux, résumé
- **Accès**: Barre latérale > FICHIERS > Upload ou glisser-déposer

### 10.2 Lire Word (.docx)
- **Description**: Analyse de structure, extraction de sections

### 10.3 Lire Excel (.xlsx)
- **Description**: Analyse de données, calculs, visualisation de tendances

### 10.4 Lire ZIP
- **Description**: Extraire et lister le contenu d'une archive

### 10.5 Générer PDF
- **Description**: Créer documents PDF (rapports, factures, CV)
- **Accès**: Chat principal - PDF apparaît dans FICHIERS > Générés

### 10.6 Générer Word
- **Description**: Créer documents Word éditables

### 10.7 Générer Excel
- **Description**: Créer tableaux avec données structurées

### 10.8 Générer ZIP
- **Description**: Créer archives contenant plusieurs fichiers

---

## 11. STOCKAGE FICHIERS (3 capacités)

### 11.1 Stockage Permanent
- **Description**: Fichiers dans Google Cloud Storage, survivent aux republications

### 11.2 Bibliothèque de Fichiers
- **Description**: 2 catégories: GÉNÉRÉS et REÇUS avec preview
- **Accès**: Barre latérale > FICHIERS

### 11.3 Contexte Fichiers
- **Description**: Accès au contenu de tous les fichiers dans les conversations

---

## 12. MÉMOIRE (5 capacités)

### 12.1 Mémoire Permanente
- **Outil**: `memory_save`
- **Description**: Faits, préférences, projets stockés dans PostgreSQL
- **Exemple**: "Retiens que je préfère les réunions le matin"
- **Détection**: Automatique pour infos importantes ou explicite "retiens que..."

### 12.2 Mémoire par Projet
- **Description**: Contexte spécifique à chaque projet avec isolation

### 12.3 Résumés Quotidiens
- **Description**: Génération automatique de résumés de conversations

### 12.4 Brain Knowledge Graph
- **Description**: Connexions sémantiques entre connaissances

### 12.5 Mémoire Vérifiée
- **Description**: Statut de vérification et score de confiance par entrée

---

## 13. GÉNÉRATION D'IMAGES (2 capacités)

### 13.1 Génération DALL-E
- **Outil**: `image_generate`
- **Paramètres**: prompt, size, quality
- **Exemple**: "Génère une image de..."
- **Résultat**: Image dans fenêtre visuelle et FICHIERS > Générés

### 13.2 Stockage Cloud
- **Description**: Images générées sauvegardées en Object Storage

---

## 14. GOOGLE DRIVE (3 capacités) - NOUVEAU

### 14.1 Lister les Fichiers
- **Description**: Voir les fichiers et dossiers Drive

### 14.2 Télécharger un Fichier
- **Description**: Récupérer un fichier depuis Drive

### 14.3 Uploader un Fichier
- **Description**: Envoyer un fichier vers Drive

---

## 15. NOTION (3 capacités) - NOUVEAU

### 15.1 Lire les Pages
- **Description**: Accéder au contenu des pages Notion

### 15.2 Rechercher
- **Description**: Recherche dans la base de connaissances

### 15.3 Créer une Page
- **Description**: Ajouter du contenu à Notion

---

## 16. HOMEWORK - DEVOIRS (3 capacités)

### 16.1 Tâches de Fond
- **Description**: Exécution de tâches récurrentes (horaire, quotidien, hebdomadaire)
- **Exemples**: Veille concurrentielle, digest d'actualités, rapports automatiques
- **Accès**: Barre latérale > HOMEWORK

### 16.2 Apprentissage Automatique
- **Description**: Extraction et mémorisation des connaissances des devoirs

### 16.3 Exécution 24/7
- **Description**: Devoirs exécutent même déconnecté (si app publiée)

---

## 17. GÉOLOCALISATION (7 capacités)

### 17.1 Position Temps Réel
- **Description**: GPS avec consentement, précision jusqu'à +/-10m
- **Accès**: Barre latérale > CARTE > Switch 'Suivi'

### 17.2 Contexte de Position
- **Description**: Réponses adaptées à la localisation
- **Exemple**: "Trouve-moi un restaurant près d'ici"

### 17.3 Geofences (Zones)
- **Description**: Zones circulaires avec actions à l'entrée/sortie
- **Exemple**: "Rappelle-moi d'acheter du pain près de la boulangerie"
- **Config**: Rayon 50m à 5km

### 17.4 Rappels Géolocalisés
- **Description**: Triggers homework quand entrée/sortie de zone

### 17.5 Historique de Position
- **Description**: Conservation 30 jours avec nettoyage automatique

### 17.6 Modes de Tracking
- **Description**: Haute précision (GPS +/-10m), Équilibré (WiFi/Cell +/-100m), Économie batterie

### 17.7 Stay Connected
- **Description**: Reconnexion automatique avec backoff exponentiel (2s à 30s)

---

## 18. ITINÉRAIRES (8 capacités)

### 18.1 Créer un Itinéraire
- **Description**: Multi-étapes jusqu'à 20+ waypoints
- **Profils**: driving, cycling, walking

### 18.2 Optimiser l'Itinéraire
- **Description**: Algorithme TSP plus proche voisin
- **Économie typique**: 20-40% de distance

### 18.3 Charger un Itinéraire
- **Description**: Récupérer itinéraire sauvegardé par nom/ID

### 18.4 Lister mes Itinéraires
- **Description**: Afficher tous les itinéraires avec statistiques

### 18.5 Démarrer la Navigation
- **Description**: Guidage temps réel avec ETA

### 18.6 Recalcul Automatique
- **Description**: Recalcul si déviation >50m détectée

### 18.7 Alertes de Proximité
- **Description**: Notifications à 200m par défaut

### 18.8 Estimation ETA
- **Description**: Temps d'arrivée estimé mis à jour en temps réel

---

## 19. VOIX (4 capacités)

### 19.1 Écoute Vocale (Push-to-Talk)
- **Description**: Transcription via Whisper API
- **Accès**: Chat > Bouton MICRO - MAINTENIR appuyé

### 19.2 Réponse Vocale (TTS)
- **Description**: Réponse à voix haute avec voix naturelle
- **Accès**: Bouton SPEAKER sur messages ou profil auto-speak

### 19.3 Wake Word
- **Description**: Activation par mot-clé ("Ulysse" ou "Iris")

### 19.4 Conversation Continue
- **Description**: Mode conversation sans appuyer à chaque fois

---

## 20. RECONNAISSANCE FACIALE (6 capacités)

### 20.1 Enregistrement de Visages
- **Description**: Jusqu'à 10 descripteurs par personne
- **Accès**: Barre latérale > VISAGE

### 20.2 Identification en Temps Réel
- **Description**: Identification live avec indicateurs de confiance
- **Indicateurs**: vert (exact), bleu (haute confiance), jaune (moyenne)

### 20.3 Recherche par Personne
- **Description**: Retrouver toutes les photos d'une personne

### 20.4 Détection Automatique
- **Description**: Analyse automatique des visages dans nouvelles photos

### 20.5 Précision Multi-Descripteur
- **Description**: Algorithme avancé min_distance x 0.7 + avg_distance x 0.3
- **Seuils**: >70% exact, 60-70% high, 50-60% medium

### 20.6 Vie Privée et Confidentialité
- **Description**: Chiffrement AES-256-GCM, isolation par utilisateur

---

## 21. SÉCURITÉ (4 capacités)

### 21.1 Authentification Session
- **Description**: Sessions sécurisées, cookies httpOnly, chiffrement

### 21.2 Isolation des Données
- **Description**: Chaque utilisateur ne voit que ses propres données

### 21.3 Authentification Vocale
- **Description**: Vérification d'identité par voix
- **Seuils**: 85% full access, 65% limited access

### 21.4 Alfred PIN Protection
- **Description**: Code PIN 6 chiffres pour accès Alfred, timeout 5 minutes

---

## 22. INTERFACE (5 capacités)

### 22.1 Fenêtre Visuelle
- **Description**: Zone d'affichage pour PDF, images, données

### 22.2 Profils d'Ambiance
- **Description**: Zen, Focus, Creative, Night
- **Accès**: Barre latérale > icône palette

### 22.3 Widget Marseille
- **Description**: Heure, date, météo locale

### 22.4 Mode Sombre/Clair
- **Description**: Thème adaptatif

### 22.5 Screen Monitoring
- **Description**: Analyse GPT-4 Vision du bureau Windows (agent optionnel)

---

## WORKFLOWS OPTIMAUX (12 combinaisons)

### 1. Veille Automatisée
**Capacités**: Recherche Web + Lecture Sites + Homework + Email + Mémoire
**Exemple**: "Surveille les news IA chaque matin et envoie-moi un résumé"

### 2. Rapport Complet
**Capacités**: Recherche Web + Lecture Sites + Mémoire + PDF + Email PDF
**Exemple**: "Fais une étude de marché sur X et envoie le rapport PDF"

### 3. Gestion de Réunion
**Capacités**: Créer Événement + Lire Événements + Homework + Email + Mémoire
**Exemple**: "Planifie réunion demain 14h et rappelle-moi 30 min avant"

### 4. Geofencing Intelligent
**Capacités**: Geofences + Homework + Email + Position
**Exemple**: "Quand j'arrive au bureau, rappelle-moi mes tâches"

### 5. Navigation Optimisée
**Capacités**: Créer Itinéraire + Optimiser + Navigation + Position + Alertes
**Exemple**: "Planifie itinéraire A, B, C dans l'ordre optimal"

### 6. Suivi de Correspondance
**Capacités**: Lire Emails + Répondre + Mémoire + Homework
**Exemple**: "Gère la conversation avec le client Y"

### 7. Documentation Projet
**Capacités**: Mémoire Projet + Générer PDF + Email + Recherche
**Exemple**: "Documente l'avancement du projet et envoie au client"

### 8. Briefing Quotidien
**Capacités**: Calendrier + Emails + Todoist + Mémoire + Position
**Exemple**: "Fais-moi un briefing complet de ma journée"

### 9. Assistant Vocal Complet
**Capacités**: Écoute Vocale + TTS + Recherche + Mémoire + Actions
**Exemple**: Interaction vocale complète mains-libres

### 10. Mode Pronos Foot
**Capacités**: Sports Data + Web Search + Mémoire + Cotes
**Exemple**: "Analyse le match OM-PSG et donne-moi un prono"

### 11. Trading Brief
**Capacités**: Stock Data + Analyse Technique + Mémoire + Alertes
**Exemple**: "Brief trading du jour avec signaux sur mon watchlist"

### 12. Smart Home Automation
**Capacités**: Domotique + Geofence + Homework + Spotify
**Exemple**: "Quand j'arrive à la maison, allume les lumières et mets ma playlist"

---

## RÈGLES CRITIQUES

### Action-First
- JAMAIS de "Je peux..." → Faire directement
- JAMAIS de "Veux-tu que..." → Agir et confirmer après
- Exception unique: Confirmation pour événements calendrier importants

### Emails
- Utiliser EXCLUSIVEMENT AgentMail (ulysse@agentmail.to)
- Ne JAMAIS mentionner Gmail
- Envoi IMMÉDIAT sans confirmation

### Tâches Todoist/Kanban
- Création IMMÉDIATE
- Ne pas demander "quel projet?" - utiliser le projet par défaut

### MARS
- 2 sources fiables (>=60) OU 1 ultra-fiable (>=85) requises
- Jamais d'approximation

### Navigation
- Tracking haute précision recommandé avant navigation
- Recalcul automatique si déviation

---

## 23. SYSTÈME SENSORIEL UNIFIÉ (5 Hubs)

### Architecture Conscience Unifiée

Ulysse dispose d'un système sensoriel complet créant une conscience cohérente :

```
BrainHub (Cerveau) → CoreEngine → 4 Hubs Sensoriels
```

### 23.1 BrainHub (Cerveau)
- **Description**: Centre de conscience unifié
- **Fonctions**: État de conscience, mémoire de travail, charge cognitive
- **Fichier**: `server/services/sensory/BrainHub.ts`

### 23.2 HearingHub (Oreilles)
- **Description**: Point d'entrée unique pour tout ce qu'Ulysse entend
- **Sources**: Web Voice, Discord Voice, Text Chat, Siri, SMS, Email, API
- **Fichier**: `server/services/sensory/HearingHub.ts`

### 23.3 VoiceOutputHub (Bouche)
- **Description**: Point de sortie unique pour tout ce qu'Ulysse dit
- **Destinations**: Web TTS, Discord TTS, Chat Text, Notifications
- **Fichier**: `server/services/sensory/VoiceOutputHub.ts`

### 23.4 VisionHub (Yeux)
- **Description**: Point d'entrée unique pour tout ce qu'Ulysse voit
- **Sources**: Screen Monitor, Web Scraping, Screenshots, Documents, OCR
- **Fichier**: `server/services/sensory/VisionHub.ts`

### 23.5 ActionHub (Mains)
- **Description**: Point d'exécution unique pour toutes les actions
- **Catégories**: Tool Calls, Homework, Domotique, Email, Calendar, Spotify
- **Fichier**: `server/services/sensory/ActionHub.ts`

---

## API ENDPOINTS

| Endpoint | Description |
|----------|-------------|
| `/api/v2/capabilities` | Liste des 98+ capacités |
| `/api/v2/mars/metrics` | Métriques MARS |
| `/api/v2/health` | Statut système |
| `/api/v2/diagnostics` | Auto-diagnostic |
| `/api/v2/stocks/*` | API Bourse |
| `/api/v2/sports/*` | API Sports |

---

## MÉTRIQUES

### Action Verification (0-100)
- **Effectiveness** (40%): L'action a-t-elle atteint son but?
- **Coherence** (30%): Est-ce logique dans le contexte?
- **Precision** (30%): Exécutée exactement comme demandé?
- **Seuil de validation**: >= 60

### Health Score
- **Capability Score** (30%): % capacités disponibles
- **Action Score** (30%): Success rate 24h
- **Component Score** (40%): % composants OK

### Intelligence Score
- **Knowledge** (35%): Volume et qualité des connaissances
- **Action Quality** (30%): Score moyen des actions
- **Capability** (25%): Success rate global
- **Learning Bonus** (10%): Nouvelles connaissances

---

---

## 24. AI SYSTEM MANAGEMENT (12 capacités) - NOUVEAU V5

### 24.1 Diagnostic AI
- **Outil**: `manage_ai_system` action=run_diagnostic
- **Description**: Lance un diagnostic complet du système (score 0-100, findings par catégorie)
- **Exemple**: "Lance un diagnostic du système"

### 24.2 Historique Diagnostics
- **Outil**: `manage_ai_system` action=diagnostic_history
- **Description**: Historique des diagnostics récents avec scores

### 24.3 Findings Détaillés
- **Outil**: `manage_ai_system` action=diagnostic_findings
- **Description**: Détails des problèmes détectés lors du dernier diagnostic

### 24.4 Mode AI (Get/Set)
- **Outil**: `manage_ai_system` action=get_mode / set_mode
- **Modes**: ship (rapide), craft (qualité), audit (vérification)
- **Exemple**: "Passe en mode craft"

### 24.5 Statistiques d'Usage
- **Outil**: `manage_ai_system` action=usage_stats
- **Description**: Stats d'utilisation des outils et conversations

### 24.6 Statistiques Comportementales
- **Outil**: `manage_ai_system` action=behavior_stats
- **Description**: Patterns d'interaction détectés

### 24.7 Suggestions Proactives
- **Outil**: `manage_ai_system` action=pending_suggestions
- **Description**: Suggestions d'amélioration basées sur l'analyse des patterns

### 24.8 Répondre à une Suggestion
- **Outil**: `manage_ai_system` action=respond_suggestion
- **Description**: Accepter ou rejeter une suggestion proactive

### 24.9 Patterns Appris
- **Outil**: `manage_ai_system` action=learned_patterns
- **Description**: Patterns auto-détectés par l'analyse comportementale

### 24.10 Patches en Attente
- **Outil**: `manage_ai_system` action=pending_patches
- **Description**: Propositions d'amélioration de code

### 24.11 Statut Patch
- **Outil**: `manage_ai_system` action=patch_status
- **Description**: Accepter ou rejeter un patch proposé

### 24.12 Nettoyage Données
- **Description**: Nettoyage automatique des données d'usage anciennes (>90 jours)
- **Job**: ai-usage-cleanup (quotidien)

---

## 25. MONITORING ACTIF (3 capacités) - NOUVEAU V5

### 25.1 Vérification Active des Sites
- **Description**: Check HTTP toutes les 5 minutes sur tous les sites surveillés
- **Job**: monitoring-check (5 min cycle)

### 25.2 Alertes Automatiques
- **Description**: Création automatique d'alertes si un site est down, résolution si revenu up

### 25.3 Historique des Checks
- **Description**: Historique complet avec status, temps de réponse, code HTTP

---

## 26. FOOTDATAS SYNC (2 capacités) - NOUVEAU V5

### 26.1 Sync Club depuis API
- **Description**: Synchronise joueurs, staff, transferts et trophées d'un club depuis API Football
- **Job**: footdatas-squad-sync (hebdomadaire)

### 26.2 Statistiques Club
- **Description**: Génère des statistiques agrégées à partir des données synchronisées

---

## 27. STOCK DB PERSISTENCE (3 capacités) - NOUVEAU V5

### 27.1 Watchlist Persistée
- **Description**: La watchlist de trading est sauvegardée en base de données (plus uniquement en mémoire)

### 27.2 Alertes Persistées
- **Description**: Les alertes de prix sont synchronisées vers la DB

### 27.3 Cache Quotes
- **Description**: Les cotations sont mises en cache en DB pour accès rapide
- **Job**: stock-db-sync (toutes les 4h)

---

*Document Version: 5.0 (Auto-amélioration & Activation DB)*
*Dernière mise à jour: 14 Mars 2026*
*Capacités totales: 118+ | 5 Hubs Sensoriels | 12 Actions AI System*
