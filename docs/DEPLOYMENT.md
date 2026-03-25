# DevFlow - Production Deployment Guide

**Derniere mise a jour:** Mars 2026

## Prerequisites

Before deploying DevFlow to production, ensure you have:

1. **PostgreSQL Database** - A production-ready PostgreSQL instance
2. **Environment Secrets** - All required secrets configured
3. **Domain** - A custom domain or use Replit's default `.replit.app` domain

## Required Environment Variables

### Database
- `DATABASE_URL` - PostgreSQL connection string

### AI Services
- `AI_INTEGRATIONS_OPENAI_API_KEY` - OpenAI API key for AI assistant
- `AI_INTEGRATIONS_OPENAI_BASE_URL` - OpenAI API base URL (optional)

### Gmail Integration
- `GMAIL_CLIENT_ID` - Google OAuth client ID
- `GMAIL_CLIENT_SECRET` - Google OAuth client secret
- `ENCRYPTION_KEY` - 64-character hex key for encrypting OAuth tokens

### Security
- `SESSION_SECRET` - Session encryption secret (auto-generated if not set)
- `JWT_SECRET` - JWT signing secret for API v2 (auto-generated if not set)

### DevMax (optional)
- `MAURICE_GITHUB_PAT` - GitHub PAT fallback for DevMax tenant operations

### ChatCOBA (optional)
- `COBA_API_KEY` - API key for ChatCOBA widget authentication (default: `coba-apptoorder-2025`)
- `APPTOORDER_API_KEY` - API key for AppToOrder health monitoring

## Deployment Steps

### 1. Configure Environment

Set all required environment variables in your deployment platform:

```bash
# Required
DATABASE_URL=postgresql://user:password@host:5432/database
ENCRYPTION_KEY=your-64-char-hex-key
GMAIL_CLIENT_ID=your-client-id
GMAIL_CLIENT_SECRET=your-client-secret

# Optional (auto-generated if missing)
SESSION_SECRET=your-session-secret
JWT_SECRET=your-jwt-secret
```

### 2. Create Required Directories

```bash
mkdir -p media_library generated_files uploads
chmod 755 media_library generated_files uploads
```

### 3. Build the Application

```bash
npm run build
```

This creates:
- `dist/index.cjs` - Server bundle
- `dist/public/` - Frontend assets

### 4. Database Migration

Push the schema to your production database:

```bash
npm run db:push
```

This creates all required tables (~150 tables) including:
- User and authentication tables
- Conversation and message tables
- Gmail token storage (with encrypted tokens)
- Media library table
- AI memory tables
- DevMax tables (devmax_*)
- SUGU tables (sugu_*, sugum_*)
- Sports tables (footdatas_*, cached_*, betting_*)
- COBA tables (coba_*, coba_chat_sessions, coba_chat_messages)

**CRITICAL: Never change primary key ID column types (serial <-> varchar). Use `npm run db:push --force` for schema sync if needed.**

### 5. Start the Server

```bash
npm run start
```

The server runs on port 5000 by default.

## Health Checks

The application provides health check endpoints:

- `GET /api/v2/health` - API health status
- Returns: `{ "status": "ok", "version": "2.0.0", "features": [...] }`

## Security Considerations

### Token Encryption

Gmail OAuth tokens are encrypted with AES-256-GCM before storage. The `ENCRYPTION_KEY` must be:
- 64 hexadecimal characters (256-bit key)
- Kept secure and never exposed
- Same key must be used across deployments to decrypt existing tokens

Generate a new key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Session Security

- Sessions use httpOnly cookies
- SameSite policy: 'strict'
- Session store: PostgreSQL-backed (connect-pg-simple)
- 2FA required in production for all authenticated routes

### Rate Limiting

Built-in rate limiters:
- Auth endpoints: 10 requests/15 min
- Chat endpoints: 20 requests/min
- Upload endpoints: 10 requests/min
- API v2: 60 requests/min
- Plan-aware tenant rate limiting for DevMax

## Monitoring

### Logs

The application logs to stdout. Monitor these patterns:

- `[express]` - HTTP request logs
- `[JobScheduler]` - Background job execution (56+ jobs)
- `[V2-Tools]` - AI tool execution and chaining rounds
- `[MemoryPressure]` - Heap usage warnings (WARNING >75%, CRITICAL >90%)
- `[MemTrack]` - Memory tracking (RSS, heap used/total)
- `[SelfHealing]` - Auto-diagnostic and healing
- `[DynamicPrioritizer]` - Job priority calculations
- `[DevMax]` - DevMax platform events
- `[SUGU]` / `[Suguval]` / `[Sugumaillane]` - Restaurant management

### Background Jobs (56+ jobs)

The job scheduler runs automatically with dynamic prioritization (scores 0-100):
- Hourly homework check
- Daily homework execution
- Weekly homework check
- Cache cleanup (every 30 min)
- Knowledge sync
- SUGU daily consultation (23h55), email (23h59), recovery (06h00), future items (05h30)
- Sports watch double-scrape (7h and 19h), odds refresh (hourly), prediction tracking
- Self-Diagnostic (every 30 min) + Auto-Heal
- AI diagnostic (every 6h), behavior analysis (every 12h), usage cleanup (daily)
- Footdatas squad sync (weekly)
- Stock watchlist/alerts/quotes DB sync (every 4h)
- Monitoring active site checks (every 5 min)
- AppToOrder monitoring (every 5 min)
- DevMax: URL health check, per-project metrics collection, SSL certificate check
- Autonomous Learning V3, L5 Cross-Domain Insights
- Morning briefing (8h), Daily value bets (12h)
- DevOps Intelligence audit (12h)

### Memory Management

- `NODE_OPTIONS='--max-old-space-size=3072'` set in workflow
- MemoryPressureMonitor checks heap every 30s
- Automatic GC trigger on critical pressure
- DB pool: max 20 (prod) / 40 (dev), min 2/5

## Backup Considerations

Critical data to backup:
1. PostgreSQL database (all user data, conversations, memories)
2. `media_library/` folder (user photos and videos)
3. `generated_files/` folder (AI-generated documents)
4. `uploads/` folder (user file uploads)

## Scaling

For high availability:
- Use a managed PostgreSQL service (Neon recommended)
- Configure proper connection pooling
- Use a CDN for static assets
- Consider horizontal scaling with load balancer

## Troubleshooting

### Token Decryption Fails
- Verify ENCRYPTION_KEY is correct
- Existing tokens may need re-authorization

### Database Connection Issues
- Check DATABASE_URL format
- Verify network connectivity
- Check SSL requirements

### Gmail OAuth Issues
- Verify OAuth consent screen configuration
- Check authorized redirect URIs
- Confirm scopes are approved

### High Memory Pressure
- Check `[MemTrack]` logs for heap trends
- Review long-running conversations with many tool rounds
- Ensure DynamicPrioritizer cache is active (5s TTL)
- Verify SelfHealing doesn't trigger redundant refreshCache() calls

### MaxAI Read-Only Loop
- Check `[V2-Tools] read-only` logs for streak count
- Anti-loop system auto-injects write nudge after 2 consecutive read rounds
- `tool_choice: "required"` forced for first 4 continuation rounds

## Two Independent Deployments

Ulysse has two completely independent deployments (NOT synced):

- **Replit** → Development environment. Uses Replit connectors.
- **Hetzner AX42** → `https://ulyssepro.org` — Production server, fully autonomous. Code at `/var/www/ulysse`, PM2 process `ulysse`, Nginx+Cloudflare SSL, PostgreSQL `ulysse_db`. Deploy script: `./deploy.sh`.
