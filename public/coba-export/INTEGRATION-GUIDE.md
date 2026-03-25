# MyBusiness Integration Guide for AppToOrder

## Architecture

AppToOrder `/pro/:slug` dashboard gets a new "MyBusiness" tab (or sidebar section).
All data is managed by MaxAI COBA API (hosted on Ulysse).
Each restaurant has its own isolated PostgreSQL schema — zero cross-data.

## API Configuration

```
COBA_BUSINESS_API = https://22a3247e-2198-48d3-989c-518df6c234a2-00-3i0oe0nezra07.janeway.replit.dev/api/coba/business
AUTH HEADER: x-coba-key: coba-apptoorder-2025
TENANT_ID = restaurant slug (e.g., "sugumaillane", "suguvalentine", "pizzaroma")
```

All requests must include the header: `x-coba-key: coba-apptoorder-2025`

## API Endpoints

### Financial Synthesis (Dashboard)
```
GET /synthesis/:tenantId?year=2026
→ Returns: { kpis: { healthScore, healthLabel, totalRevenue, totalPurchases, totalExpenses, totalSalaries, totalCharges, margin, foodCostPercent, overheadPercent, activeEmployees, totalLoanPayments }, breakdowns: { purchasesByCategory, expensesByCategory, revenueByMonth }, counts: { purchases, expenses, cashEntries, employees, payrollEntries, loans } }
```

### Purchases (Achats)
```
GET    /purchases/:tenantId?year=2026&isPaid=true&category=alimentaire
POST   /purchases/:tenantId  → body: { supplier, category, description, amount, taxAmount, invoiceNumber, invoiceDate, dueDate, isPaid, paidDate, paymentMethod, notes }
PUT    /purchases/:tenantId/:id
DELETE /purchases/:tenantId/:id
Categories: alimentaire, assurances, boissons, comptabilite, eau, emballages, energie, entretien, materiels, plateformes, telecom, travaux, vehicules, autre
```

### Expenses (Frais Généraux)
```
GET    /expenses/:tenantId?year=2026&category=energie
POST   /expenses/:tenantId  → body: { label, category, description, amount, taxAmount, period, frequency, dueDate, isPaid, paidDate, paymentMethod, isRecurring, invoiceNumber, notes }
PUT    /expenses/:tenantId/:id
DELETE /expenses/:tenantId/:id
Categories: alimentaire, assurances, boissons, comptabilite, eau, emballages, energie, entretien, materiels, plateformes, telecom, travaux, vehicules, autre
Frequencies: mensuel, trimestriel, annuel, ponctuel
```

### Bank (Banque)
```
GET    /bank/:tenantId?year=2026
POST   /bank/:tenantId  → body: { bankName, entryDate, label, amount, balance, category, isReconciled, notes }
PUT    /bank/:tenantId/:id
DELETE /bank/:tenantId/:id
```

### Loans (Emprunts) — sub-section of Banque
```
GET    /loans/:tenantId
POST   /loans/:tenantId  → body: { bankName, loanLabel, loanType, totalAmount, remainingAmount, monthlyPayment, interestRate, startDate, endDate, notes }
PUT    /loans/:tenantId/:id
DELETE /loans/:tenantId/:id
```

### Cash Register (Journal de Caisse)
```
GET    /cash/:tenantId?year=2026&month=2026-03
POST   /cash/:tenantId  → body: { entryDate, totalRevenue, cashAmount, cbAmount, ubereatsAmount, deliverooAmount, onlineAmount, otherAmount, coversCount, averageTicket, notes }
PUT    /cash/:tenantId/:id
DELETE /cash/:tenantId/:id
```

### Employees (Gestion RH)
```
GET    /employees/:tenantId?all=true        (all=true includes inactive)
POST   /employees/:tenantId  → body: { firstName, lastName, role, contractType, monthlySalary, hourlyRate, weeklyHours, startDate, endDate, isActive, phone, email, notes }
PUT    /employees/:tenantId/:id
DELETE /employees/:tenantId/:id  (soft delete — sets isActive=false)
Contract types: CDI, CDD, Extra, Stage
```

### Payroll (Fiches de paie) — sub-section of Gestion RH
```
GET    /payroll/:tenantId?period=2026-03&employeeId=1
POST   /payroll/:tenantId  → body: { employeeId, period, grossSalary, netSalary, socialCharges, employerCharges, totalEmployerCost, bonus, overtime, isPaid, paidDate, notes }
PUT    /payroll/:tenantId/:id
```

### Absences — sub-section of Gestion RH
```
GET    /absences/:tenantId?employeeId=1&year=2026
POST   /absences/:tenantId  → body: { employeeId, type, startDate, endDate, duration, reason, isApproved }
PUT    /absences/:tenantId/:id
DELETE /absences/:tenantId/:id
Absence types: conge, maladie, retard, absence, formation
```

### Suppliers (Fournisseurs)
```
GET    /suppliers/:tenantId?all=true        (all=true includes inactive)
POST   /suppliers/:tenantId  → body: { name, shortName, siret, tvaNumber, accountNumber, address, city, postalCode, phone, email, website, contactName, category, paymentTerms, defaultPaymentMethod, bankIban, bankBic, notes }
PUT    /suppliers/:tenantId/:id
DELETE /suppliers/:tenantId/:id  (soft delete — sets isActive=false)
→ GET response includes computed fields: invoiceCount, totalPurchases, lastInvoiceDate (auto-calculated from purchases table)
```

### Audit
```
GET    /audit/:tenantId?year=2026
→ Returns: { year, totalRevenue, totalCosts, operatingProfit, profitMargin, totalCovers, operatingDays, avgDailyRevenue, avgTicket, activeEmployees, costBreakdown: { achats, fraisGeneraux, salaires, chargesSociales, emprunts }, monthlyRevenue, monthlyCosts, unpaidPurchases, unpaidExpenses, totalRemainingLoans, totalBankDebits, totalBankCredits, bankEntriesCount, purchasesCount, expensesCount, topSuppliers }
```

### Admin Endpoints (MaxAI only)
```
GET    /tenants           → List all registered tenants
GET    /overview?year=2026  → Cross-tenant financial overview
```

## Frontend Source Files (17 files, ~7500 lines)

All source files in the archive: `suguval-frontend-source.tar.gz`

### Main Container
- **SuguValManagement.tsx** (341 lines) — Main page with sidebar, tabs, error boundary, login

### Tab Components
1. **DashboardTab.tsx** (398 lines) — KPI cards (Score Santé, CA, Marge, Food Cost, Overhead, Employés actifs), quick actions (Ajout Achat/Frais, Saisir caisse, Importer relevé, Rapport complet), Synthèse Financière
2. **AchatsTab.tsx** (408 lines) — Purchase list with filters, add/edit modal, paid/unpaid toggle, category filter
3. **FraisTab.tsx** (502 lines) — Expense list, recurring expenses, category filters, frequency management
4. **BanqueTab.tsx** (950 lines) — Bank entries table, loan management, reconciliation status, import CSV
5. **CaisseTab.tsx** (366 lines) — Daily cash register, revenue breakdown by payment method (CB, espèces, UberEats, Deliveroo, etc.)
6. **GestionRHTab.tsx** (1372 lines) — Employee list + details, payroll management, absences tracking, contract management, **FournisseursTab** (exported from same file)
7. **ComptabiliteTab.tsx** (377 lines) — Accounting overview, P&L statement, cost breakdown charts
8. **AuditTab.tsx** (203 lines) — Financial audit with health score, anomalies detection
9. **ArchivesTab.tsx** (427 lines) — File archives, backup management, trash/restore
10. **HubriseTab.tsx** (625 lines) — HubRise integration management, order sync
11. **ExpertReport.tsx** (254 lines) — Expert financial report generation

### Shared/Support Files
12. **shared.tsx** (303 lines) — Shared UI components (modals, stat cards, formatters, badges)
13. **types.ts** (181 lines) — All TypeScript interfaces (Purchase, Expense, BankEntry, Loan, CashEntry, Employee, Payroll, Absence, Supplier, AuditOverview, SuguFile), constants (TABS, CATEGORIES), utility functions (fmt, fmtEur, fmtDate, catLabel, normalizeCatKey)
14. **context.ts** (5 lines) — Theme context for dark mode
15. **fileModals.tsx** (398 lines) — File viewing/editing modals
16. **FileUploadModal.tsx** (316 lines) — File upload with drag & drop, category selection

## Adaptation Instructions

### API Calls
Replace all Suguval internal API calls:
```typescript
// BEFORE (Suguval)
apiRequest("GET", "/api/suguval/purchases?year=2026")

// AFTER (COBA)
const COBA_API = "https://22a3247e-2198-48d3-989c-518df6c234a2-00-3i0oe0nezra07.janeway.replit.dev/api/coba/business";
const headers = { "x-coba-key": "coba-apptoorder-2025", "Content-Type": "application/json" };

fetch(`${COBA_API}/purchases/${tenantId}?year=2026`, { headers })
```

### Tenant ID
- `tenantId` = the restaurant slug from the URL (`/pro/:slug`)
- Each restaurant gets its own isolated database schema automatically on first API call

### Response Format
All COBA API responses follow: `{ ok: true, data: [...], count: N }` or `{ ok: true, data: {...} }`

### What to Keep
- All UI components, styling, colors, layout
- All business logic (calculations, filters, sorting)
- Dark theme (the entire UI is dark-themed)
- French language labels
- Euro currency formatting

### What to Remove/Adapt
- Remove Ulysse-specific features (AI chat, voice integration)
- Remove auth (Suguval login) — AppToOrder has its own auth
- Replace file upload (Suguval uses its own storage) — adapt to AppToOrder's file system or skip initially
- HubRise tab — may not apply to all restaurants, make conditional

## Data Model Mapping (Suguval → COBA)

| Suguval Table | COBA API Endpoint | Notes |
|--------------|-------------------|-------|
| sugu_purchases | /purchases/:tenantId | Same fields |
| sugu_general_expenses | /expenses/:tenantId | Same fields |
| sugu_bank_entries | /bank/:tenantId | Same fields |
| sugu_loans | /loans/:tenantId | Same fields |
| sugu_cash_entries | /cash/:tenantId | Simplified payment methods |
| sugu_employees | /employees/:tenantId | Same minus socialSecurityNumber |
| sugu_payroll | /payroll/:tenantId | Same minus pdfPath |
| sugu_absences | /absences/:tenantId | Same fields |
| sugu_suppliers | /suppliers/:tenantId | Same fields + computed totals |
| N/A (computed) | /audit/:tenantId | Full audit overview |
| N/A (computed) | /synthesis/:tenantId | KPIs + breakdowns |
