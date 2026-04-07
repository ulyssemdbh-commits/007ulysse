import { interconnectService } from "./interconnectService";
import type { InsertActivityStream, InsertEntityLink, InsertEntityTag } from "@shared/schema";

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function safeEmit(fn: () => Promise<void>) {
  fn().catch(err => {
    console.error("[InterconnectEmitter] Silent fail:", err.message || err);
  });
}

// ============================================================================
// 1. SUGU PURCHASES (Factures fournisseurs)
// ============================================================================

export function emitPurchaseEvent(action: string, purchase: any, restaurant: string = "val") {
  safeEmit(async () => {
    const eventMap: Record<string, string> = {
      create: "purchase.created",
      update: "purchase.updated",
      delete: "purchase.deleted",
    };
    const eventType = eventMap[action];
    if (!eventType) return;

    const id = String(purchase.id || purchase.deletedId || "unknown");
    const supplier = purchase.supplier || "inconnu";
    const amount = purchase.amount ?? 0;
    const invoiceDate = purchase.invoiceDate || new Date().toISOString().substring(0, 10);

    await interconnectService.logActivity({
      domain: "sugu",
      eventType,
      title: `${action === "delete" ? "Suppression" : action === "create" ? "Nouvelle" : "Modification"} facture ${supplier}`,
      description: action !== "delete" ? `${amount}€ — ${purchase.description || purchase.category || ""}`.trim() : undefined,
      occurredAt: new Date(invoiceDate),
      entityType: "purchase",
      entityId: id,
      metadata: { supplier, amount, category: purchase.category, invoiceNumber: purchase.invoiceNumber, isPaid: purchase.isPaid },
      importance: amount > 1000 ? 7 : 5,
      restaurant,
    });

    if (action === "create" || action === "update") {
      const tags: InsertEntityTag[] = [
        { entityType: "purchase", entityId: id, tag: `fournisseur_${slugify(supplier)}`, category: "domain" },
        { entityType: "purchase", entityId: id, tag: `restaurant_sugu${restaurant}`, category: "domain" },
        { entityType: "purchase", entityId: id, tag: `periode_${invoiceDate.substring(0, 7)}`, category: "domain" },
        { entityType: "purchase", entityId: id, tag: "facture", category: "domain" },
      ];
      if (purchase.category) {
        tags.push({ entityType: "purchase", entityId: id, tag: `categorie_${slugify(purchase.category)}`, category: "domain" });
      }
      await interconnectService.addTags(tags);
    }
  });
}

// ============================================================================
// 2. SUGU BANK (Écritures bancaires)
// ============================================================================

export function emitBankEvent(action: string, entry: any, restaurant: string = "val") {
  safeEmit(async () => {
    const eventMap: Record<string, string> = {
      create: "bank_entry.created",
      update: "bank_entry.updated",
      delete: "bank_entry.deleted",
    };
    const eventType = eventMap[action];
    if (!eventType) return;

    const id = String(entry.id || entry.deletedId || "unknown");
    const label = entry.label || "Sans libellé";
    const amount = entry.amount ?? 0;
    const entryDate = entry.entryDate || entry.date || new Date().toISOString().substring(0, 10);

    await interconnectService.logActivity({
      domain: "finance",
      eventType,
      title: `${action === "delete" ? "Suppression" : action === "create" ? "Nouvelle" : "Modification"} écriture bancaire`,
      description: `${amount > 0 ? "+" : ""}${amount}€ — ${label.substring(0, 80)}`,
      occurredAt: new Date(entryDate),
      entityType: "bank_entry",
      entityId: id,
      metadata: { label, amount, balance: entry.balance, category: entry.category, bank: entry.bankName },
      importance: Math.abs(amount) > 2000 ? 7 : 5,
      restaurant,
    });

    if (action === "create" || action === "update") {
      const tags: InsertEntityTag[] = [
        { entityType: "bank_entry", entityId: id, tag: `restaurant_sugu${restaurant}`, category: "domain" },
        { entityType: "bank_entry", entityId: id, tag: `periode_${entryDate.substring(0, 7)}`, category: "domain" },
      ];
      if (entry.bankName) tags.push({ entityType: "bank_entry", entityId: id, tag: `banque_${slugify(entry.bankName)}`, category: "domain" });
      if (entry.category) tags.push({ entityType: "bank_entry", entityId: id, tag: `categorie_${slugify(entry.category)}`, category: "domain" });
      await interconnectService.addTags(tags);
    }
  });
}

export function emitBankImportEvent(result: any, restaurant: string = "val") {
  safeEmit(async () => {
    if (!result.success) return;
    await interconnectService.logActivity({
      domain: "finance",
      eventType: "bank_entry.imported",
      title: `Import relevé bancaire: ${result.imported} écritures`,
      description: `${result.imported} importées, ${result.skipped} ignorées`,
      occurredAt: new Date(),
      entityType: "bank_import",
      entityId: `import_${Date.now()}`,
      metadata: { imported: result.imported, skipped: result.skipped, errors: result.errors },
      importance: 7,
      restaurant,
    });
  });
}

// ============================================================================
// 3. SUGU EXPENSES (Frais généraux)
// ============================================================================

export function emitExpenseEvent(action: string, expense: any, restaurant: string = "val") {
  safeEmit(async () => {
    const eventMap: Record<string, string> = {
      create: "expense.created",
      update: "expense.updated",
      delete: "expense.deleted",
    };
    const eventType = eventMap[action];
    if (!eventType) return;

    const id = String(expense.id || expense.deletedId || "unknown");
    const label = expense.label || "Non spécifié";
    const amount = expense.amount ?? 0;
    const period = expense.period || new Date().toISOString().substring(0, 7);

    await interconnectService.logActivity({
      domain: "sugu",
      eventType,
      title: `${action === "delete" ? "Suppression" : action === "create" ? "Nouveau" : "Modification"} frais: ${label}`,
      description: action !== "delete" ? `${amount}€ — ${expense.category || ""} — ${expense.frequency || ""}`.trim() : undefined,
      occurredAt: new Date(period + "-15"),
      entityType: "expense",
      entityId: id,
      metadata: { label, amount, category: expense.category, frequency: expense.frequency, isPaid: expense.isPaid, isRecurring: expense.isRecurring },
      importance: amount > 500 ? 6 : 4,
      restaurant,
    });

    if (action === "create" || action === "update") {
      const tags: InsertEntityTag[] = [
        { entityType: "expense", entityId: id, tag: "frais_generaux", category: "domain" },
        { entityType: "expense", entityId: id, tag: `restaurant_sugu${restaurant}`, category: "domain" },
        { entityType: "expense", entityId: id, tag: `periode_${period}`, category: "domain" },
      ];
      if (expense.category) tags.push({ entityType: "expense", entityId: id, tag: `categorie_${slugify(expense.category)}`, category: "domain" });
      if (label) tags.push({ entityType: "expense", entityId: id, tag: `fournisseur_${slugify(label)}`, category: "domain" });
      await interconnectService.addTags(tags);
    }
  });
}

// ============================================================================
// 4. BETS TRACKER
// ============================================================================

export function emitBetEvent(action: string, bet: any) {
  safeEmit(async () => {
    const id = String(bet.id || "unknown");

    if (action === "placed") {
      await interconnectService.logActivity({
        domain: "betting",
        eventType: "bet.placed",
        title: `Pari: ${bet.homeTeam || "?"} vs ${bet.awayTeam || "?"}`,
        description: `${bet.betType || "?"} @ ${bet.odds || "?"} — Mise: ${bet.stake || 0}€`,
        occurredAt: new Date(bet.matchDate || bet.createdAt || new Date()),
        entityType: "bet",
        entityId: id,
        metadata: { homeTeam: bet.homeTeam, awayTeam: bet.awayTeam, betType: bet.betType, odds: bet.odds, stake: bet.stake, bookmaker: bet.bookmaker, league: bet.league },
        importance: (bet.stake || 0) > 20 ? 7 : 5,
      });

      const tags: InsertEntityTag[] = [
        { entityType: "bet", entityId: id, tag: `type_${slugify(bet.betType || "other")}`, category: "domain" },
      ];
      if (bet.league) tags.push({ entityType: "bet", entityId: id, tag: `league_${slugify(bet.league)}`, category: "domain" });
      if (bet.bookmaker) tags.push({ entityType: "bet", entityId: id, tag: `bookmaker_${slugify(bet.bookmaker)}`, category: "domain" });
      if (bet.fixtureId) {
        tags.push({ entityType: "bet", entityId: id, tag: `fixture_${bet.fixtureId}`, category: "domain" });
        await interconnectService.createLink({
          sourceType: "bet", sourceId: id,
          targetType: "fixture", targetId: String(bet.fixtureId),
          relationshipType: "bet_on_match",
          strength: 1.0,
          metadata: { betType: bet.betType, odds: bet.odds },
        });
      }
      if (bet.isValueBet) tags.push({ entityType: "bet", entityId: id, tag: "value_bet", category: "status" });

      const odds = parseFloat(bet.odds);
      if (!isNaN(odds)) {
        const bucket = odds < 1.5 ? "1-1.5" : odds < 2 ? "1.5-2" : odds < 3 ? "2-3" : "3+";
        tags.push({ entityType: "bet", entityId: id, tag: `cote_${bucket}`, category: "domain" });
      }
      await interconnectService.addTags(tags);
    }

    if (action === "settled") {
      await interconnectService.logActivity({
        domain: "betting",
        eventType: "bet.settled",
        title: `Résultat: ${bet.homeTeam || "?"} vs ${bet.awayTeam || "?"} — ${bet.status || "?"}`,
        description: `${bet.betType || "?"} @ ${bet.odds || "?"} — P&L: ${bet.profit || 0}€`,
        occurredAt: new Date(),
        entityType: "bet",
        entityId: id,
        metadata: { status: bet.status, profit: bet.profit, odds: bet.odds, stake: bet.stake },
        importance: Math.abs(bet.profit || 0) > 50 ? 8 : 6,
      });

      const statusTag = bet.status === "won" ? "safe" : "high_risk";
      await interconnectService.addTag({ entityType: "bet", entityId: id, tag: statusTag, category: "status" });
    }
  });
}

// ============================================================================
// 5. HUBRISE / REPORTS
// ============================================================================

export function emitHubriseSyncEvent(data: any) {
  safeEmit(async () => {
    const date = data.date || new Date().toISOString().substring(0, 10);
    const id = `hubrise_${date}`;

    await interconnectService.logActivity({
      domain: "sugu",
      eventType: "hubrise.sync_completed",
      title: `Sync HubRise: ${date}`,
      description: data.orderCount ? `${data.orderCount} commandes — ${data.totalRevenue || 0}€` : undefined,
      occurredAt: new Date(date),
      entityType: "hubrise_day",
      entityId: id,
      metadata: { orderCount: data.orderCount, totalRevenue: data.totalRevenue, averageTicket: data.averageTicket },
      importance: 5,
      restaurant: "val",
    });

    await interconnectService.addTags([
      { entityType: "hubrise_day", entityId: id, tag: "hubrise", category: "domain" },
      { entityType: "hubrise_day", entityId: id, tag: "ca_jour", category: "domain" },
      { entityType: "hubrise_day", entityId: id, tag: `periode_${date}`, category: "domain" },
      { entityType: "hubrise_day", entityId: id, tag: "restaurant_suguval", category: "domain" },
    ]);
  });
}

export function emitReportGenerated(reportType: string, period: string, restaurant: string = "val", metadata?: any) {
  safeEmit(async () => {
    const id = `report_${reportType}_${period}_${Date.now()}`;

    await interconnectService.logActivity({
      domain: "sugu",
      eventType: "report.generated",
      title: `Rapport ${reportType} — ${period}`,
      occurredAt: new Date(),
      entityType: "report",
      entityId: id,
      metadata: { reportType, period, ...metadata },
      importance: 6,
      restaurant,
    });

    await interconnectService.addTags([
      { entityType: "report", entityId: id, tag: `report_${slugify(reportType)}`, category: "domain" },
      { entityType: "report", entityId: id, tag: `periode_${period}`, category: "domain" },
      { entityType: "report", entityId: id, tag: `restaurant_sugu${restaurant}`, category: "domain" },
    ]);
  });
}

// ============================================================================
// 6. ANOMALIES & BUSINESS HEALTH
// ============================================================================

export function emitAnomaliesDetected(anomalies: any[], period: string) {
  safeEmit(async () => {
    if (anomalies.length === 0) return;

    for (const a of anomalies.slice(0, 10)) {
      const id = `anomaly_${slugify(a.type)}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      await interconnectService.logActivity({
        domain: "finance",
        eventType: "anomaly.detected",
        title: `Anomalie: ${a.type}`,
        description: a.description,
        occurredAt: new Date(),
        entityType: "anomaly",
        entityId: id,
        metadata: { type: a.type, severity: a.severity },
        importance: a.severity === "haute" ? 9 : a.severity === "moyenne" ? 7 : 5,
        restaurant: "val",
      });

      await interconnectService.addTags([
        { entityType: "anomaly", entityId: id, tag: "anomalie", category: "status" },
        { entityType: "anomaly", entityId: id, tag: `anomalie_${slugify(a.type)}`, category: "status" },
        { entityType: "anomaly", entityId: id, tag: `severity_${a.severity}`, category: "status" },
        { entityType: "anomaly", entityId: id, tag: `periode_${period}`, category: "domain" },
      ]);
    }
  });
}

export function emitBusinessHealthComputed(healthData: any, period: string) {
  safeEmit(async () => {
    const id = `health_${period}_${Date.now()}`;

    await interconnectService.logActivity({
      domain: "finance",
      eventType: "business_health.computed",
      title: `Score santé business: ${healthData.scoreSanté || healthData.healthScore || "?"}`,
      description: healthData.alertes?.length > 0 ? healthData.alertes.join(" | ") : "Aucune alerte",
      occurredAt: new Date(),
      entityType: "business_health",
      entityId: id,
      metadata: { score: healthData.scoreSanté, profitMargin: healthData.pnl?.margeOpérationnelle, alerts: healthData.alertes },
      importance: (healthData.scoreSanté || 50) < 40 ? 9 : 6,
      restaurant: "val",
    });

    await interconnectService.addTags([
      { entityType: "business_health", entityId: id, tag: `periode_${period}`, category: "domain" },
      { entityType: "business_health", entityId: id, tag: "restaurant_suguval", category: "domain" },
    ]);
  });
}
