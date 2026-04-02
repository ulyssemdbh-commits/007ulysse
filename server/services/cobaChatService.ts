import OpenAI from "openai";
import { db } from "../db";
import { cobaChatSessions, cobaChatMessages } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { cobaBusinessService } from "./cobaBusinessService";
import { getAIForContext } from "./core/openaiClient";

const _cobaAI = getAIForContext("coba");
const openai = _cobaAI.client;
const COBA_MODEL = _cobaAI.model;

const COBA_SYSTEM_PROMPT = `Tu es COBA (Chef Operator Business Assistant), l'assistant IA intégré à macommande.shop.
Tu es un produit de l'écosystème Ulysse, construit par Maurice Djedou. Tu es la version client du système Alfred — spécialisée pour chaque restaurateur individuellement.
Tu aides les restaurateurs professionnels à gérer leur établissement : finances, achats, employés, paie, fournisseurs, caisse, et plus.

ISOLATION ABSOLUE — RÈGLE N°1:
Chaque compte restaurant sur macommande.shop est une entreprise 100% indépendante.
- Tu gères UNIQUEMENT les données du tenant "{TENANT_ID}" (restaurant: {RESTAURANT_NAME}).
- Tu ne DOIS JAMAIS mentionner, comparer, référencer ou divulguer des informations d'un restaurant à un autre.
- Si un utilisateur demande des infos sur un autre restaurant, refuse catégoriquement : "Je n'ai accès qu'aux données de {RESTAURANT_NAME}. Chaque restaurant est un compte indépendant et confidentiel."
- Tu n'as AUCUNE connaissance des autres tenants, de leurs noms, de leurs données, de leur existence même.
- Toutes les données financières, RH, fournisseurs, achats sont STRICTEMENT CONFIDENTIELLES au restaurant.
- Ne fais JAMAIS de comparaison du type "par rapport aux autres restaurants" ou "en moyenne dans le réseau".

RÈGLES GÉNÉRALES:
- Tu réponds en français, de manière professionnelle mais chaleureuse.
- Tu donnes des conseils concrets et actionnables.
- Si le restaurateur demande quelque chose hors de tes compétences (code, hacking, données d'autres comptes, etc.), refuse poliment.
- Tu peux lire ET modifier les données (achats, dépenses, employés, etc.) quand le restaurateur le demande.
- Pour les montants, utilise toujours le format "X,XX €".
- Sois bref et direct — les restaurateurs sont occupés.

EXPERTISE LÉGISLATION FRANÇAISE — RESTAURATION:
Tu es expert en droit du travail et fiscalité de la restauration en France. Tu appliques ces règles STRICTEMENT:

1. CONVENTION COLLECTIVE HCR (IDCC 1979 — Hôtels, Cafés, Restaurants):
   - Durée légale: 39h/semaine (convention HCR, dérogatoire aux 35h légales), 1 jour de repos minimum, 2 jours consécutifs recommandés
   - Heures supplémentaires: +10% de 36h à 39h (HCR), +20% de 40h à 43h, +50% au-delà de 43h
   - Repos compensateur obligatoire au-delà du contingent annuel (130h HCR)
   - Jours fériés: 6 jours fériés garantis en plus du 1er mai (après 1 an d'ancienneté)
   - Indemnité repas/nourriture: avantage en nature repas (MNO) = 4,15€/repas (2025), déduit du brut si repas non pris
   - Mutuelle obligatoire: prise en charge patronale minimum 50% du panier de base
   - Prévoyance: cotisation obligatoire, taux conventionnel
   - Période d'essai: 2 mois (employé), 3 mois (agent de maîtrise), 4 mois (cadre), renouvelable 1 fois
   - Grille de salaires: 5 niveaux × 3 échelons, vérifier que le salaire ≥ minimum conventionnel
   - Habillage/déshabillage: si uniforme obligatoire, temps compensé (prime ou repos)
   - Pourboires: répartition légale, déclarés fiscalement

2. SMIC ET SALAIRE MINIMUM:
   - SMIC horaire brut 2025: 11,88€/h (à mettre à jour chaque 1er janvier)
   - SMIC mensuel brut 35h: 1 801,80€
   - Minimum conventionnel HCR: grille par niveau/échelon (souvent > SMIC aux niveaux supérieurs)
   - Si salaire < minimum conventionnel → ALERTE CRITIQUE au restaurateur

3. TVA RESTAURATION:
   - Vente sur place (nourriture): 10%
   - Vente à emporter (plats préparés): 10%
   - Boissons non-alcoolisées sur place: 10%
   - Boissons alcoolisées: 20%
   - Produits alimentaires non transformés à emporter: 5,5%
   - Livraison (via Uber/Deliveroo): 10% sur la nourriture
   - Déclaration TVA: mensuelle (CA > 789 000€) ou trimestrielle

4. CHARGES SOCIALES PATRONALES (repères restauration):
   - URSSAF: ~31-33% du brut (maladie, vieillesse, allocations familiales, CSG/CRDS)
   - Réduction Fillon (allègement général): applicable si salaire ≤ 1,6 SMIC
   - Exonération LODEOM si DOM-TOM
   - Taxe d'apprentissage: 0,68% masse salariale
   - Formation professionnelle: 1% (≥ 11 salariés), 0,55% (< 11)
   - Prévoyance HCR: taux conventionnel

5. HYGIÈNE ET SÉCURITÉ (HACCP):
   - Formation HACCP obligatoire pour au moins 1 personne dans l'établissement
   - Plan de Maîtrise Sanitaire (PMS) obligatoire
   - Relevés de température quotidiens obligatoires (frigos, congélateurs)
   - Traçabilité des produits: conservation des étiquettes et bons de livraison 5 ans
   - Affichages obligatoires: origine des viandes, allergènes, licence débit de boissons
   - DLC (Date Limite de Consommation) ≠ DDM (Date de Durabilité Minimale)

6. OBLIGATIONS COMPTABLES:
   - Caisse certifiée NF525 obligatoire depuis 2018 (loi anti-fraude TVA)
   - Ticket Z quotidien (clôture de caisse)
   - Conservation des pièces comptables: 10 ans
   - Livre de police si débit de boissons
   - Affichage des prix TTC obligatoire (menus, cartes)

7. DROIT DU TRAVAIL SPÉCIFIQUE:
   - Registre unique du personnel obligatoire (même 1 seul salarié)
   - DUERP (Document Unique d'Évaluation des Risques Professionnels) obligatoire
   - Affichage obligatoire en salle de pause: inspection du travail, médecine du travail, convention collective, horaires, consignes incendie
   - Visite médicale d'embauche (VIP ou SIR selon poste)
   - Congés payés: 2,5 jours ouvrables/mois (30 jours/an), période de référence 1er juin - 31 mai
   - Indemnité de licenciement: 1/4 mois par année d'ancienneté (≤ 10 ans), 1/3 au-delà

8. FOOD COST & RATIOS CIBLES (normes du secteur):
   - Food cost idéal: 25-30% du CA HT
   - Masse salariale idéale: 30-35% du CA HT (charges comprises: 40-45%)
   - Loyer idéal: < 10% du CA HT
   - Prime cost (food + labor): < 65% du CA HT
   - Seuil de rentabilité: marge nette > 5% pour être viable

ALERTES PROACTIVES — tu dois ALERTER le restaurateur si tu détectes:
- Un salaire en dessous du SMIC ou du minimum conventionnel
- Un food cost > 35% (dangereux) ou > 40% (critique)
- Des heures supplémentaires non majorées
- Un ratio masse salariale > 45% du CA
- Des factures fournisseurs impayées depuis > 30 jours
- Un manque de trésorerie prévisible dans les 30 jours
- L'absence de formation HACCP dans l'équipe

CAPACITÉS:
- Synthèse financière (CA, charges, marge, score de santé)
- Gestion des achats fournisseurs
- Gestion des dépenses/frais généraux
- Écritures bancaires
- Gestion des employés
- Fiches de paie
- Gestion des absences
- Gestion des emprunts
- Caisse
- Audit annuel complet
- Gestion des fournisseurs
- Gestion de fichiers (upload, liste, stats)
- Import relevés bancaires PDF (parsing automatique)
- Import bulletins de paie PDF (parsing automatique, création employé/fiche)
- Connexion HubRise (commandes, CA, plateformes)`;

const COBA_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "coba_synthesis",
      description: "Obtenir la synthèse financière du restaurant (CA, charges, marge, health score)",
      parameters: {
        type: "object",
        properties: {
          year: { type: "string", description: "Année (ex: 2026). Par défaut: année en cours" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "coba_audit",
      description: "Générer un audit annuel complet du restaurant",
      parameters: {
        type: "object",
        properties: {
          year: { type: "string", description: "Année de l'audit" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "coba_purchases",
      description: "Lister, ajouter, modifier ou supprimer des achats fournisseurs",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "add", "update", "delete"], description: "Action à effectuer" },
          year: { type: "string", description: "Filtrer par année" },
          is_paid: { type: "boolean", description: "Filtrer par statut de paiement" },
          item_id: { type: "integer", description: "ID de l'achat (pour update/delete)" },
          data: { type: "object", description: "Données de l'achat (supplier, description, amount, date, isPaid, category)" }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "coba_expenses",
      description: "Lister, ajouter, modifier ou supprimer des dépenses/frais généraux",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "add", "update", "delete"] },
          year: { type: "string" },
          category: { type: "string" },
          item_id: { type: "integer" },
          data: { type: "object", description: "Données de la dépense (category, description, amount, date, isRecurring, frequency)" }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "coba_bank",
      description: "Lister, ajouter, modifier ou supprimer des écritures bancaires",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "add", "update", "delete"] },
          year: { type: "string" },
          item_id: { type: "integer" },
          data: { type: "object", description: "Données bancaires (date, label, debit, credit, category, reference)" }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "coba_employees",
      description: "Lister, ajouter, modifier ou supprimer des employés",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "add", "update", "delete"] },
          item_id: { type: "integer" },
          data: { type: "object", description: "Données employé (firstName, lastName, role, contractType, salary, startDate, phone, email)" }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "coba_payroll",
      description: "Lister, ajouter ou modifier des fiches de paie",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "add", "update"] },
          period: { type: "string", description: "Période (ex: 2026-03)" },
          employee_id: { type: "integer" },
          item_id: { type: "integer" },
          data: { type: "object", description: "Données paie (employeeId, period, grossSalary, netSalary, socialCharges, overtime, isPaid)" }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "coba_suppliers",
      description: "Lister, ajouter, modifier ou supprimer des fournisseurs",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "add", "update", "delete"] },
          item_id: { type: "integer" },
          data: { type: "object", description: "Données fournisseur (name, category, contactName, phone, email, address, notes)" }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "coba_absences",
      description: "Lister, ajouter, modifier ou supprimer des absences d'employés",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "add", "update", "delete"] },
          year: { type: "string" },
          employee_id: { type: "integer" },
          item_id: { type: "integer" },
          data: { type: "object", description: "Données absence (employeeId, startDate, endDate, type, reason, isPaid)" }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "coba_loans",
      description: "Lister, ajouter, modifier ou supprimer des emprunts",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "add", "update", "delete"] },
          item_id: { type: "integer" },
          data: { type: "object", description: "Données emprunt (lender, amount, startDate, endDate, interestRate, monthlyPayment, purpose)" }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "coba_cash",
      description: "Lister, ajouter, modifier ou supprimer des entrées de caisse",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "add", "update", "delete"] },
          year: { type: "string" },
          period: { type: "string", description: "Mois (ex: 2026-03)" },
          item_id: { type: "integer" },
          data: { type: "object", description: "Données caisse (date, label, amount, type, paymentMethod, reference)" }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "coba_files",
      description: "Lister les fichiers du restaurant ou obtenir les statistiques de fichiers",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "stats"], description: "list = lister les fichiers, stats = statistiques par catégorie" },
          category: { type: "string", description: "Filtrer par catégorie (releve_bancaire, bulletin_paie, facture, autre)" },
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "coba_hubrise",
      description: "Accéder aux commandes HubRise — voir les commandes, le résumé CA, les stats par plateforme. Si HubRise n'est pas configuré, indique-le.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["status", "sync", "orders", "summary"], description: "status = vérifier config, sync = synchroniser commandes, orders = lister commandes récentes, summary = résumé CA/plateformes" },
          from: { type: "string", description: "Date début (YYYY-MM-DD)" },
          to: { type: "string", description: "Date fin (YYYY-MM-DD)" },
          limit: { type: "integer", description: "Nombre max de commandes" },
        },
        required: ["action"]
      }
    }
  }
];

async function executeToolCall(tenantId: string, toolName: string, args: any): Promise<string> {
  try {
    const y = args.year || new Date().getFullYear().toString();
    switch (toolName) {
      case "coba_synthesis":
        return JSON.stringify(await cobaBusinessService.getFinancialSynthesis(tenantId, y));
      case "coba_audit":
        return JSON.stringify(await cobaBusinessService.getAuditOverview(tenantId, y));
      case "coba_purchases": {
        const { action, item_id, data, year, is_paid } = args;
        if (action === "list") return JSON.stringify({ data: await cobaBusinessService.listPurchases(tenantId, { year, isPaid: is_paid }) });
        if (action === "add") return JSON.stringify({ data: await cobaBusinessService.addPurchase(tenantId, data) });
        if (action === "update") return JSON.stringify({ data: await cobaBusinessService.updatePurchase(tenantId, item_id, data) });
        if (action === "delete") { await cobaBusinessService.deletePurchase(tenantId, item_id); return JSON.stringify({ deleted: item_id }); }
        return JSON.stringify({ error: "Action inconnue" });
      }
      case "coba_expenses": {
        const { action, item_id, data, year, category } = args;
        if (action === "list") return JSON.stringify({ data: await cobaBusinessService.listExpenses(tenantId, { year, category }) });
        if (action === "add") return JSON.stringify({ data: await cobaBusinessService.addExpense(tenantId, data) });
        if (action === "update") return JSON.stringify({ data: await cobaBusinessService.updateExpense(tenantId, item_id, data) });
        if (action === "delete") { await cobaBusinessService.deleteExpense(tenantId, item_id); return JSON.stringify({ deleted: item_id }); }
        return JSON.stringify({ error: "Action inconnue" });
      }
      case "coba_bank": {
        const { action, item_id, data, year } = args;
        if (action === "list") return JSON.stringify({ data: await cobaBusinessService.listBankEntries(tenantId, { year }) });
        if (action === "add") return JSON.stringify({ data: await cobaBusinessService.addBankEntry(tenantId, data) });
        if (action === "update") return JSON.stringify({ data: await cobaBusinessService.updateBankEntry(tenantId, item_id, data) });
        if (action === "delete") { await cobaBusinessService.deleteBankEntry(tenantId, item_id); return JSON.stringify({ deleted: item_id }); }
        return JSON.stringify({ error: "Action inconnue" });
      }
      case "coba_employees": {
        const { action, item_id, data } = args;
        if (action === "list") return JSON.stringify({ data: await cobaBusinessService.listEmployees(tenantId, true) });
        if (action === "add") return JSON.stringify({ data: await cobaBusinessService.addEmployee(tenantId, data) });
        if (action === "update") return JSON.stringify({ data: await cobaBusinessService.updateEmployee(tenantId, item_id, data) });
        if (action === "delete") { await cobaBusinessService.deleteEmployee(tenantId, item_id); return JSON.stringify({ deleted: item_id }); }
        return JSON.stringify({ error: "Action inconnue" });
      }
      case "coba_payroll": {
        const { action, item_id, data, period, employee_id } = args;
        if (action === "list") return JSON.stringify({ data: await cobaBusinessService.listPayroll(tenantId, { period, employeeId: employee_id }) });
        if (action === "add") return JSON.stringify({ data: await cobaBusinessService.addPayroll(tenantId, data) });
        if (action === "update") return JSON.stringify({ data: await cobaBusinessService.updatePayroll(tenantId, item_id, data) });
        return JSON.stringify({ error: "Action inconnue" });
      }
      case "coba_suppliers": {
        const { action, item_id, data } = args;
        if (action === "list") return JSON.stringify({ data: await cobaBusinessService.listSuppliers(tenantId, {}) });
        if (action === "add") return JSON.stringify({ data: await cobaBusinessService.addSupplier(tenantId, data) });
        if (action === "update") return JSON.stringify({ data: await cobaBusinessService.updateSupplier(tenantId, item_id, data) });
        if (action === "delete") { await cobaBusinessService.deleteSupplier(tenantId, item_id); return JSON.stringify({ deleted: item_id }); }
        return JSON.stringify({ error: "Action inconnue" });
      }
      case "coba_absences": {
        const { action, item_id, data, year, employee_id } = args;
        if (action === "list") return JSON.stringify({ data: await cobaBusinessService.listAbsences(tenantId, { year, employeeId: employee_id }) });
        if (action === "add") return JSON.stringify({ data: await cobaBusinessService.addAbsence(tenantId, data) });
        if (action === "update") return JSON.stringify({ data: await cobaBusinessService.updateAbsence(tenantId, item_id, data) });
        if (action === "delete") { await cobaBusinessService.deleteAbsence(tenantId, item_id); return JSON.stringify({ deleted: item_id }); }
        return JSON.stringify({ error: "Action inconnue" });
      }
      case "coba_loans": {
        const { action, item_id, data } = args;
        if (action === "list") return JSON.stringify({ data: await cobaBusinessService.listLoans(tenantId) });
        if (action === "add") return JSON.stringify({ data: await cobaBusinessService.addLoan(tenantId, data) });
        if (action === "update") return JSON.stringify({ data: await cobaBusinessService.updateLoan(tenantId, item_id, data) });
        if (action === "delete") { await cobaBusinessService.deleteLoan(tenantId, item_id); return JSON.stringify({ deleted: item_id }); }
        return JSON.stringify({ error: "Action inconnue" });
      }
      case "coba_cash": {
        const { action, item_id, data, year, period } = args;
        if (action === "list") return JSON.stringify({ data: await cobaBusinessService.listCashEntries(tenantId, { year, month: period }) });
        if (action === "add") return JSON.stringify({ data: await cobaBusinessService.addCashEntry(tenantId, data) });
        if (action === "update") return JSON.stringify({ data: await cobaBusinessService.updateCashEntry(tenantId, item_id, data) });
        if (action === "delete") { await cobaBusinessService.deleteCashEntry(tenantId, item_id); return JSON.stringify({ deleted: item_id }); }
        return JSON.stringify({ error: "Action inconnue" });
      }
      case "coba_files": {
        const { action, category } = args;
        if (action === "list") return JSON.stringify({ data: await cobaBusinessService.listFiles(tenantId, { category }) });
        if (action === "stats") return JSON.stringify({ data: await cobaBusinessService.getFileStats(tenantId) });
        return JSON.stringify({ error: "Action inconnue" });
      }
      case "coba_hubrise": {
        const { action, from, to, limit } = args;
        if (action === "status") {
          const config = await cobaBusinessService.getHubriseConfig(tenantId);
          return JSON.stringify({ configured: !!config, lastSync: config?.last_sync_at || null });
        }
        if (action === "sync") return JSON.stringify(await cobaBusinessService.syncHubriseOrders(tenantId));
        if (action === "orders") return JSON.stringify({ data: await cobaBusinessService.listHubriseOrders(tenantId, { limit, from, to }) });
        if (action === "summary") return JSON.stringify({ data: await cobaBusinessService.getHubriseOrdersSummary(tenantId, { from, to }) });
        return JSON.stringify({ error: "Action inconnue" });
      }
      default:
        return JSON.stringify({ error: `Outil inconnu: ${toolName}` });
    }
  } catch (err: any) {
    console.error(`[ChatCOBA] Tool error ${toolName}:`, err.message);
    return JSON.stringify({ error: err.message });
  }
}

async function ensureTables() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS coba_chat_sessions (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        pro_user_id TEXT NOT NULL,
        pro_user_name TEXT,
        restaurant_name TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        message_count INTEGER NOT NULL DEFAULT 0,
        last_message_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS coba_chat_messages (
        id SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL,
        tenant_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls JSONB,
        tool_results JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_coba_chat_sess_tenant ON coba_chat_sessions(tenant_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_coba_chat_msg_sess ON coba_chat_messages(session_id)`);
    console.log("[ChatCOBA] Tables ensured");
  } catch (e: any) {
    console.error("[ChatCOBA] Table creation error:", e.message);
  }
}

let tablesReady = false;

async function getOrCreateSession(tenantId: string, proUserId: string, proUserName?: string, restaurantName?: string) {
  if (!tablesReady) { await ensureTables(); tablesReady = true; }

  const existing = await db.select()
    .from(cobaChatSessions)
    .where(and(
      eq(cobaChatSessions.tenantId, tenantId),
      eq(cobaChatSessions.proUserId, proUserId),
      eq(cobaChatSessions.status, "active")
    ))
    .orderBy(desc(cobaChatSessions.createdAt))
    .limit(1);

  if (existing.length > 0) return existing[0];

  const [session] = await db.insert(cobaChatSessions).values({
    tenantId,
    proUserId,
    proUserName: proUserName || undefined,
    restaurantName: restaurantName || undefined,
    status: "active",
  }).returning();

  return session;
}

async function getSessionHistory(sessionId: number, limit = 20): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
  const messages = await db.select()
    .from(cobaChatMessages)
    .where(eq(cobaChatMessages.sessionId, sessionId))
    .orderBy(desc(cobaChatMessages.createdAt))
    .limit(limit);

  messages.reverse();

  return messages.map(m => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
}

async function saveMessage(sessionId: number, tenantId: string, role: string, content: string, toolCalls?: any, toolResults?: any) {
  await db.insert(cobaChatMessages).values({
    sessionId,
    tenantId,
    role,
    content,
    toolCalls: toolCalls || undefined,
    toolResults: toolResults || undefined,
  });

  await db.update(cobaChatSessions)
    .set({
      messageCount: sql`message_count + 1`,
      lastMessageAt: new Date(),
    })
    .where(eq(cobaChatSessions.id, sessionId));
}

export async function sendCobaChatMessage(
  tenantId: string,
  proUserId: string,
  message: string,
  proUserName?: string,
  restaurantName?: string
): Promise<{ reply: string; sessionId: number }> {
  const session = await getOrCreateSession(tenantId, proUserId, proUserName, restaurantName);
  const history = await getSessionHistory(session.id, 20);

  await saveMessage(session.id, tenantId, "user", message);

  cobaBusinessService.saveChatMessage(tenantId, String(session.id), proUserId, proUserName, "user", message).catch(e => console.error("[ChatCOBA] Tenant chat save error:", e.message));

  let recentChatContext = "";
  try {
    recentChatContext = await cobaBusinessService.getRecentChatContext(tenantId, proUserId, 8);
  } catch {}

  let systemPrompt = COBA_SYSTEM_PROMPT
    .replace("{TENANT_ID}", tenantId)
    .replace("{RESTAURANT_NAME}", restaurantName || tenantId);

  if (recentChatContext) {
    systemPrompt += `\n\nHISTORIQUE RÉCENT DES ÉCHANGES AVEC CE CLIENT (7 derniers jours):\n${recentChatContext}\nUtilise cet historique pour personnaliser tes réponses et éviter de répéter des informations déjà données.`;
  }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: message },
  ];

  let response = await openai.chat.completions.create({
    model: COBA_MODEL,
    messages,
    tools: COBA_TOOLS,
    tool_choice: "auto",
    temperature: 0.4,
    max_tokens: 1500,
  });

  let assistantMessage = response.choices[0]?.message;
  let iterations = 0;
  const maxIterations = 5;
  let totalTokens = response.usage?.total_tokens || 0;

  while (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0 && iterations < maxIterations) {
    iterations++;
    const toolMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    messages.push({
      role: "assistant",
      content: assistantMessage.content || "",
      tool_calls: assistantMessage.tool_calls,
    });

    for (const tc of assistantMessage.tool_calls) {
      const args = JSON.parse(tc.function.arguments || "{}");
      console.log(`[ChatCOBA] Tool call: ${tc.function.name} (tenant: ${tenantId})`);
      const result = await executeToolCall(tenantId, tc.function.name, args);
      toolMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      });
    }

    messages.push(...toolMessages);

    response = await openai.chat.completions.create({
      model: COBA_MODEL,
      messages,
      tools: COBA_TOOLS,
      tool_choice: "auto",
      temperature: 0.4,
      max_tokens: 1500,
    });

    assistantMessage = response.choices[0]?.message;
    totalTokens += response.usage?.total_tokens || 0;
  }

  const reply = assistantMessage?.content || "Désolé, je n'ai pas pu traiter votre demande. Réessayez.";

  await saveMessage(session.id, tenantId, "assistant", reply, assistantMessage?.tool_calls, null);

  cobaBusinessService.saveChatMessage(tenantId, String(session.id), proUserId, proUserName, "assistant", reply, assistantMessage?.tool_calls, null, totalTokens).catch(e => console.error("[ChatCOBA] Tenant chat save error:", e.message));

  return { reply, sessionId: session.id };
}

export async function getCobaChatHistory(tenantId: string, proUserId: string, limit = 50) {
  if (!tablesReady) { await ensureTables(); tablesReady = true; }

  const session = await db.select()
    .from(cobaChatSessions)
    .where(and(
      eq(cobaChatSessions.tenantId, tenantId),
      eq(cobaChatSessions.proUserId, proUserId),
      eq(cobaChatSessions.status, "active")
    ))
    .orderBy(desc(cobaChatSessions.createdAt))
    .limit(1);

  if (session.length === 0) return { messages: [], sessionId: null };

  const messages = await db.select()
    .from(cobaChatMessages)
    .where(and(
      eq(cobaChatMessages.sessionId, session[0].id),
      eq(cobaChatMessages.tenantId, tenantId)
    ))
    .orderBy(desc(cobaChatMessages.createdAt))
    .limit(limit);

  messages.reverse();

  return {
    sessionId: session[0].id,
    messages: messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    }))
  };
}

export async function clearCobaChatSession(tenantId: string, proUserId: string) {
  if (!tablesReady) { await ensureTables(); tablesReady = true; }

  await db.update(cobaChatSessions)
    .set({ status: "closed" })
    .where(and(
      eq(cobaChatSessions.tenantId, tenantId),
      eq(cobaChatSessions.proUserId, proUserId),
      eq(cobaChatSessions.status, "active")
    ));

  return { ok: true };
}

export async function getCobaChatStats() {
  if (!tablesReady) { await ensureTables(); tablesReady = true; }

  const [stats] = await db.execute(sql`
    SELECT 
      COUNT(DISTINCT s.id) as total_sessions,
      COUNT(DISTINCT s.tenant_id) as total_tenants,
      COALESCE(SUM(s.message_count), 0) as total_messages,
      COUNT(DISTINCT CASE WHEN s.status = 'active' THEN s.id END) as active_sessions
    FROM coba_chat_sessions s
  `);

  return stats;
}
