# Configuration Reserved VM pour Ulysse

## Pourquoi Reserved VM ?

Actuellement, l'application utilise le déploiement **Autoscale** qui:
- S'arrête après inactivité (cold start de 2-3s)
- Limite les WebSockets
- Ne peut pas exécuter de tâches de fond

**Reserved VM** offre:
- Serveur toujours actif (pas de cold start)
- WebSockets stables et persistants
- Tâches de fond (homework, cron jobs)
- Ressources dédiées

## Prérequis

1. **Plan Replit** : Core ou supérieur
2. **Application stable** : Toutes les fonctionnalités testées
3. **Base de données** : PostgreSQL configurée

## Configuration

### 1. Activer Reserved VM

1. Aller dans l'onglet **Deployments**
2. Sélectionner **Reserved VM** au lieu de Autoscale
3. Choisir la taille de la VM:
   - **Starter** (0.5 vCPU, 512MB RAM) : Suffisant pour usage personnel
   - **Basic** (1 vCPU, 1GB RAM) : Recommandé pour plusieurs utilisateurs

### 2. Variables d'environnement (Production)

S'assurer que ces variables sont configurées dans les Secrets de production:

```
DATABASE_URL=<URL PostgreSQL production>
AI_INTEGRATIONS_OPENAI_API_KEY=<clé OpenAI>
AI_INTEGRATIONS_OPENAI_BASE_URL=<base URL>
SESSION_SECRET=<secret de session long et aléatoire>
```

### 3. Health Check

L'endpoint `/api/v2/health` est utilisé pour vérifier que l'app fonctionne:

```bash
curl https://votre-app.replit.app/api/v2/health
```

Réponse attendue:
```json
{
  "status": "ok",
  "timestamp": "2026-01-10T00:00:00.000Z",
  "version": "2.0.0"
}
```

## Fonctionnalités activées avec Reserved VM

### 1. Job Scheduler
Les tâches programmées s'exécutent automatiquement:
- **Homework quotidien/horaire** : Vérifie et exécute les devoirs à heures fixes
- **SUGU** : Consultation AI (23h55), email quotidien (23h59), recovery (06h00)
- **Sports Watch** : Double-scrape 5 ligues (7h et 19h)
- **Self-Diagnostic** : Diagnostic système + auto-heal (toutes les 30 min)
- **AI System** : Diagnostic AI (6h), analyse comportementale (12h), cleanup (24h)
- **Footdatas** : Sync joueurs/staff/transferts depuis API Football (hebdomadaire)
- **Stocks** : Persistance watchlist/alertes/quotes vers DB (4h)
- **Monitoring** : Vérification active des sites surveillés (5 min)
- **AppToOrder** : Monitoring plateforme (5 min) + cleanup (24h)

### 2. WebSockets Stables
- Synchronisation temps réel entre appareils
- Pas de fallback polling nécessaire
- Voice WebSocket pour l'audio en temps réel

### 3. Notifications Push
Le service worker peut envoyer des notifications même quand l'app est fermée.

## Coûts Estimés

| Taille VM | Prix/mois | Recommandé pour |
|-----------|-----------|-----------------|
| Starter   | ~$7       | Usage personnel |
| Basic     | ~$14      | Famille (4 users) |
| Standard  | ~$28      | Usage intensif |

## Migration depuis Autoscale

1. Publier avec Reserved VM
2. Vérifier les logs au démarrage
3. Tester les WebSockets
4. Vérifier l'exécution des homework

## Rollback

Si problèmes, revenir à Autoscale:
1. Aller dans Deployments
2. Changer vers Autoscale
3. Republier

L'application fonctionnera toujours, mais sans:
- Tâches de fond automatiques
- WebSockets stables
- Temps de réponse garanti
