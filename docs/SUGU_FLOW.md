# SUGU - Daily Checklist System

## Overview

SUGU is an automated daily checklist and email summary system consisting of two independent instances:
- **Suguval**: For Valentine restaurant (13011)
- **Sugumaillane**: For Maillane restaurant (13008)

**Derniere mise a jour:** Mars 2026

## Architecture

```
+---------------------------------------------------------------------------+
|                          SUGU DAILY FLOW                                  |
+---------------------------------------------------------------------------+
|                                                                           |
|  +--------------+    +--------------+    +--------------+                 |
|  |   Frontend   |--->|   Backend    |--->|   Database   |                 |
|  |  Checklist   |    |    API       |    |   Storage    |                 |
|  +--------------+    +--------------+    +--------------+                 |
|         |                   |                   |                         |
|         v                   v                   v                         |
|  User checks items    Validates &       Stores checks with               |
|  throughout day       processes         date + timestamp                  |
|                                                                           |
+---------------------------------------------------------------------------+
|                      SCHEDULED JOBS (Paris TZ)                            |
+---------------------------------------------------------------------------+
|                                                                           |
|  23h55 ----------------------------------------------------------------> |
|         |                                                                 |
|         v                                                                 |
|  +--------------------------------------------------------------------+  |
|  | ULYSSE CONSULTATION                                                 |  |
|  | - Collects day's checked items                                      |  |
|  | - Generates AI-powered summary/insights                             |  |
|  | - Prepares email content                                            |  |
|  +--------------------------------------------------------------------+  |
|                                                                           |
|  23h59 ----------------------------------------------------------------> |
|         |                                                                 |
|         v                                                                 |
|  +--------------------------------------------------------------------+  |
|  | DAILY EMAIL                                                         |  |
|  | - Sends summary email via AgentMail                                 |  |
|  | - Includes zone-grouped items + daily comments                      |  |
|  | - Logs email status (success/failure)                               |  |
|  | - Weekly stats recap included                                       |  |
|  +--------------------------------------------------------------------+  |
|                                                                           |
|  06h00 ----------------------------------------------------------------> |
|         |                                                                 |
|         v                                                                 |
|  +--------------------------------------------------------------------+  |
|  | EMAIL RECOVERY (SUGU Catch-up)                                      |  |
|  | - Retries failed emails from previous day                           |  |
|  | - Max 3 retries per failed email                                    |  |
|  | - Runs at startup or 06h00                                          |  |
|  +--------------------------------------------------------------------+  |
|                                                                           |
+---------------------------------------------------------------------------+
```

## Data Model

### Categories & Items
```
suguval/sugumaillane_categories
+-- id (serial PK)
+-- name (text)
+-- nameVi (text, optional - Vietnamese)
+-- nameTh (text, optional - Thai)
+-- sortOrder (integer)
+-- isActive (boolean)

suguval/sugumaillane_items
+-- id (serial PK)
+-- categoryId (FK -> categories)
+-- name (text)
+-- nameVi (text, optional)
+-- nameTh (text, optional)
+-- sortOrder (integer)
+-- isActive (boolean)
```

### Daily Checks
```
suguval/sugumaillane_checks
+-- id (serial PK)
+-- itemId (FK -> items)
+-- checkDate (date, YYYY-MM-DD Paris TZ)
+-- isChecked (boolean)
+-- checkedAt (timestamp)
```

### Email Logs
```
suguval/sugumaillane_email_logs
+-- id (serial PK)
+-- date (date)
+-- emailContent (text)
+-- status ('sent' | 'failed' | 'pending')
+-- retryCount (integer, default 0)
+-- error (text, optional)
+-- createdAt (timestamp)
```

### Comments (Suguval only)
```
suguval_comments
+-- id (serial PK)
+-- author (text)
+-- message (text)
+-- createdAt (timestamp)
```

### Future Items
```
suguval/sugumaillane_future_items
+-- id (serial PK)
+-- itemId (FK -> items)
+-- scheduledDate (date)
+-- isApplied (boolean)
```

## Business Rules

### Rule 1: Daily Reset
- Checks are scoped to `checkDate` (Paris timezone)
- Each day starts fresh with unchecked items
- Historical checks are preserved for reporting

### Rule 2: Multilingual Support
- Items support 3 languages: French (default), Vietnamese, Thai
- Email content is generated in French with optional translations

### Rule 3: AI Consultation (23h55)
- Ulysse reviews the day's progress before email
- Can add insights, encouragements, or observations
- Runs 4 minutes before email to allow processing

### Rule 4: Email Delivery (23h59)
- Automatic daily summary sent via AgentMail
- Contains: zone-grouped items, daily comments (filtered by today's date), weekly stats recap
- Sunday emails consolidate Friday+weekend for Monday delivery
- Logged in email_logs table for tracking

### Rule 5: Failure Recovery (06h00)
- Failed emails retry up to 3 times (MAX_RETRIES)
- 5-minute delay between retry attempts
- Recovery runs at startup or 06h00 daily
- Prevents duplicate sends via status tracking

### Rule 6: Admin Management
- Categories and items can be reordered (sortOrder)
- Items can be activated/deactivated (isActive)
- Translations can be edited per item

### Rule 7: Zone Grouping
- Items are grouped by zone in the email (ZONE_ORDER defined in service)
- Each zone has a name (ZONE_NAMES mapping)
- Unknown zones appear after known zones

### Rule 8: Future Items
- Items can be scheduled for future dates
- Applied at 05h30 via scheduled job "SUGU Apply Future Items"
- Automatically checks the item on the scheduled date

## Email Content Structure

```
Bonjour,

Voici la liste des courses a effectuer pour [Jour Date Mois]:

== ZONE 1 ==
  Categorie A:
    - Item 1
    - Item 2
  Categorie B:
    - Item 3

== ZONE 2 ==
  Categorie C:
    - Item 4

== COMMENTAIRES ==
  [Author]: Message du jour

Total: X articles a acheter.

== RECAP HEBDO (7 derniers jours) ==
  Taux moyen: X%
  Articles coches/jour: X
  Jours actifs: X/7
  Periode: YYYY-MM-DD -> YYYY-MM-DD

---
Ce message a ete envoye automatiquement par le systeme de gestion Suguval/Sugumaillane.
```

## API Endpoints

### Suguval (/api/suguval)
- `GET /categories` - Get categories with items
- `GET /checks/today` - Get today's checks
- `POST /checks/:itemId` - Toggle item check
- `PUT /items/:itemId` - Update item (admin)
- `POST /items/:itemId/move` - Move item order
- `GET /history` - Get check history
- `POST /email/preview` - Preview daily email
- `POST /email/send` - Manually send email

### Sugumaillane (/api/sugumaillane)
- Same endpoints as Suguval for Maillane-specific data

## Key Files

- `server/services/suguvalService.ts` — Suguval logic, daily email, weekly stats
- `server/services/sugumaillaneService.ts` — Sugumaillane logic, daily email
- `server/routes/suguval.ts` — Suguval routes
- `server/routes/sugumaillane.ts` — Sugumaillane routes
- `server/services/scheduledJobs.ts` — Job registration and scheduling
- `shared/schema.ts` — Database tables (suguval_*, sugum_*)

## Job Scheduler Integration

Jobs registered in `scheduledJobs.ts`:
```
// Suguval
"Suguval Ulysse Consultation (23h55)"  // cronExpression: "55 23 * * *"
"Suguval Daily Email (23h59)"          // cronExpression: "59 23 * * *"

// Sugumaillane
"Sugumaillane Ulysse Consultation (23h55)"
"Sugumaillane Daily Email (23h59)"

// Shared
"SUGU Apply Future Items (05h30)"      // cronExpression: "30 5 * * *"
"SUGU Email Recovery (6h00)"           // cronExpression: "0 6 * * *"
```

## Error Handling

Errors are handled by the unified ErrorHandler (`server/services/errorHandler.ts`):
- Domain: `sugu` for SUGU-specific errors
- French user messages for all error types
- Automatic logging with structured context

## Recent Bug Fixes (Mars 2026)
- **`suguvalComments is not defined`** — Missing import in suguvalService.ts, crashed daily email
- **Comments query unfiltered** — Was loading ALL historical comments instead of today's only, fixed with `gte(createdAt, todayStart)`
