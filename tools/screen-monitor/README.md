# Ulysse Screen Monitor Agent

Agent Windows pour permettre à Ulysse de voir ton écran en temps réel et apprendre de ton travail.

## Installation

### Prérequis
- Windows 10/11
- Python 3.8+
- DirectX 11+

### Installation des dépendances

```bash
pip install dxcam opencv-python pillow websocket-client pywin32 psutil
```

## Utilisation

### Lancement basique

```bash
python ulysse_screen_agent.py --server wss://votre-app.replit.app/ws/screen --user-id 1
```

### Avec authentification token

```bash
python ulysse_screen_agent.py --server wss://votre-app.replit.app/ws/screen --token VOTRE_TOKEN_JWT
```

### Options avancées

```bash
python ulysse_screen_agent.py \
    --server wss://votre-app.replit.app/ws/screen \
    --user-id 1 \
    --fps 2 \
    --quality medium \
    --device-name "PC Bureau" \
    --privacy
```

## Paramètres

| Option | Description | Valeurs |
|--------|-------------|---------|
| `--server, -s` | URL du serveur WebSocket | Requis |
| `--token, -t` | Token JWT d'authentification | Optionnel |
| `--user-id, -u` | ID utilisateur | Requis si pas de token |
| `--device-id, -d` | Identifiant unique de l'appareil | Default: windows-agent |
| `--device-name, -n` | Nom lisible de l'appareil | Default: nom du PC |
| `--fps, -f` | Images par seconde | 1, 2, 3, 5 |
| `--quality, -q` | Qualité d'image | low, medium, high |
| `--privacy, -p` | Mode privé (masque tous les titres) | Flag |

## Qualité d'image

| Mode | Résolution | Qualité JPEG | Usage |
|------|------------|--------------|-------|
| low | 640x480 | 50% | Économie bande passante |
| medium | 1024x768 | 70% | Usage normal |
| high | 1920x1080 | 85% | Analyse détaillée |

## Sécurité et vie privée

### Filtrage automatique
L'agent masque automatiquement les fenêtres contenant :
- Mots de passe / login
- Sites bancaires
- PayPal, Stripe, etc.
- Contenus marqués "confidentiel" ou "secret"

### Mode privé
Avec `--privacy`, tous les titres de fenêtres sont masqués.

### Contrôles
- **Pause** : Peut être déclenché depuis l'app Ulysse
- **Stop** : Ctrl+C ou depuis l'app Ulysse

## Fonctionnement

1. L'agent capture l'écran à intervalles réguliers (1-5 FPS)
2. L'image est compressée en JPEG et encodée en base64
3. Les métadonnées (app active, titre fenêtre) sont extraites
4. Les contenus sensibles sont filtrés localement
5. Les données sont envoyées via WebSocket sécurisé (WSS)
6. Ulysse analyse l'image avec GPT-4 Vision
7. Le contexte et les patterns sont stockés pour apprentissage

## Dépannage

### "Missing dependency"
```bash
pip install --upgrade dxcam opencv-python pillow websocket-client pywin32 psutil
```

### Erreur DirectX
- Mettez à jour vos pilotes graphiques
- Vérifiez que DirectX 11+ est installé

### Connexion échouée
- Vérifiez que le serveur est accessible
- Vérifiez votre token/user-id
- Assurez-vous que WSS est utilisé (pas WS)

## Architecture

```
┌─────────────────┐     WebSocket      ┌─────────────────┐
│  Windows Agent  │ ◄────────────────► │  Ulysse Server  │
│                 │                    │                 │
│  - DXCam        │     Frames +       │  - Analysis     │
│  - Privacy      │     Metadata       │  - Memory       │
│  - Compression  │                    │  - Patterns     │
└─────────────────┘                    └─────────────────┘
```
