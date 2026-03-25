const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const COLORS = {
  primary: "#1a1a2e",
  accent: "#e94560",
  accentBlue: "#0f3460",
  text: "#333333",
  textLight: "#666666",
  bg: "#f8f9fa",
  white: "#ffffff",
  green: "#27ae60",
  orange: "#f39c12",
  red: "#e74c3c",
  blue: "#2980b9",
  purple: "#8e44ad",
};

function createDoc(filename) {
  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
  const stream = fs.createWriteStream(path.join(__dirname, filename));
  doc.pipe(stream);
  return { doc, stream };
}

function ensureSpace(doc, needed = 80) {
  if (doc.y + needed > doc.page.height - 60) {
    doc.addPage();
    return true;
  }
  return false;
}

function header(doc, title, subtitle, color = COLORS.accent) {
  doc.rect(0, 0, doc.page.width, 140).fill(COLORS.primary);
  doc.rect(0, 140, doc.page.width, 4).fill(color);
  doc.fontSize(28).fill(COLORS.white).text(title, 50, 35, { width: doc.page.width - 100 });
  doc.fontSize(13).fill("#aaaacc").text(subtitle, 50, 75, { width: doc.page.width - 100 });
  doc.fontSize(10).fill("#888899").text("Mars 2026 — Analyse complète", 50, 105);
  doc.fontSize(9).text("Maurice Djedou — Ulysse AI Platform", 50, 120);
  doc.y = 165;
}

function sectionTitle(doc, text, color = COLORS.accentBlue) {
  ensureSpace(doc, 60);
  doc.moveDown(0.5);
  doc.rect(50, doc.y, doc.page.width - 100, 28).fill(color);
  doc.fontSize(13).fill(COLORS.white).text(text.toUpperCase(), 60, doc.y + 7, { width: doc.page.width - 120 });
  doc.fill(COLORS.text);
  doc.y += 38;
}

function subSection(doc, text) {
  ensureSpace(doc, 40);
  doc.moveDown(0.3);
  doc.fontSize(11).fill(COLORS.accent).text("▸ " + text, 55);
  doc.fill(COLORS.text);
  doc.moveDown(0.2);
}

function para(doc, text, indent = 55) {
  ensureSpace(doc, 30);
  doc.fontSize(9.5).fill(COLORS.text).text(text, indent, doc.y, { width: doc.page.width - indent - 50, lineGap: 2 });
  doc.moveDown(0.3);
}

function bullet(doc, text, indent = 65) {
  ensureSpace(doc, 25);
  doc.fontSize(9.5).fill(COLORS.textLight).text("• " + text, indent, doc.y, { width: doc.page.width - indent - 50, lineGap: 2 });
  doc.moveDown(0.15);
}

function kpiRow(doc, label, value, color = COLORS.blue) {
  ensureSpace(doc, 22);
  const y = doc.y;
  doc.fontSize(9).fill(COLORS.textLight).text(label, 65, y, { width: 280 });
  doc.fontSize(10).fill(color).text(value, doc.page.width - 200, y, { width: 150, align: "right" });
  doc.y = y + 16;
}

function tableHeader(doc, cols) {
  ensureSpace(doc, 40);
  const y = doc.y;
  doc.rect(50, y, doc.page.width - 100, 20).fill(COLORS.primary);
  let x = 55;
  cols.forEach(c => {
    doc.fontSize(8).fill(COLORS.white).text(c.label, x, y + 5, { width: c.width });
    x += c.width;
  });
  doc.y = y + 22;
}

function tableRow(doc, cols, values, bg = null) {
  ensureSpace(doc, 20);
  const y = doc.y;
  if (bg) doc.rect(50, y, doc.page.width - 100, 18).fill(bg);
  let x = 55;
  values.forEach((v, i) => {
    doc.fontSize(8).fill(COLORS.text).text(v, x, y + 4, { width: cols[i].width });
    x += cols[i].width;
  });
  doc.y = y + 18;
}

function footer(doc) {
  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(7).fill("#999999").text(
      `Page ${i + 1}/${pages.count} — Confidentiel — Ulysse AI Platform © 2026`,
      50, doc.page.height - 30, { width: doc.page.width - 100, align: "center" }
    );
  }
}

// =====================================================
// SUGU ANALYSIS
// =====================================================
function generateSuguAnalysis() {
  const { doc, stream } = createDoc("Analyse_SUGU_Mars2026.pdf");
  header(doc, "SUGU — Analyse Stratégique Complète", "Système de Gestion Intelligente pour Restaurants", COLORS.accent);

  // 1. SYNTHÈSE ÉVALUATIVE
  sectionTitle(doc, "1. Synthèse Évaluative Globale");
  para(doc, "SUGU (Smart Unified Gestion Ultime) est un écosystème complet de gestion de restaurants intégrant la gestion opérationnelle quotidienne, la comptabilité, les ressources humaines, l'approvisionnement automatisé, l'agrégation de commandes tierces et le monitoring proactif. Le système est conçu pour des restaurants de taille moyenne opérant en livraison et sur place.");

  subSection(doc, "Architecture Technique");
  bullet(doc, "Multi-tenant isolé par schéma PostgreSQL (coba_biz_{tenantId})");
  bullet(doc, "10 tables métier par tenant: achats, frais, banque, emprunts, caisse, employés, paie, fournisseurs, absences, corbeille");
  bullet(doc, "Intégration HubRise pour agrégation UberEats/Deliveroo/JustEat");
  bullet(doc, "Monitoring AppToOrder (macommande.shop) avec alertes Discord automatiques");
  bullet(doc, "WebSocket temps réel pour synchronisation des checklists entre tablettes");
  bullet(doc, "IA MaxAI (COBA) avec 38 actions de gestion métier intégrées");
  bullet(doc, "Système de checklists multilingue (FR/VN/TH) avec traduction IA");

  subSection(doc, "Couverture Fonctionnelle");
  const funcCols = [{ label: "Module", width: 120 }, { label: "Fonctions", width: 200 }, { label: "Maturité", width: 80 }];
  tableHeader(doc, funcCols);
  const funcData = [
    ["Checklists", "Inventaire catégorisé, sync temps réel, multilingue", "✅ Production"],
    ["Approvisionnement", "Email auto 23h59, Discord, calendrier livraisons", "✅ Production"],
    ["Comptabilité", "Achats, frais, banque, emprunts, caisse, synthèse", "✅ Production"],
    ["RH & Paie", "Employés, contrats, fiches de paie, absences", "✅ Production"],
    ["Fournisseurs", "Répertoire, conditions, suivi activité", "✅ Production"],
    ["HubRise", "Commandes agrégées, analytics par plateforme", "✅ Production"],
    ["Monitoring", "Uptime, latence, SSL, DNS, alertes Discord", "✅ Production"],
    ["COBA IA", "38 actions, chat pro /pro/:slug, audit auto", "✅ Production"],
    ["KPIs", "Health Score, food cost %, marge, ratio charges/CA", "✅ Production"],
    ["Rapports PDF", "Synthèse hebdo automatique, audit annuel", "✅ Production"],
  ];
  funcData.forEach((r, i) => tableRow(doc, funcCols, r, i % 2 === 0 ? "#f5f5f5" : null));

  subSection(doc, "Score d'Évaluation Global");
  kpiRow(doc, "Couverture fonctionnelle restauration", "92/100", COLORS.green);
  kpiRow(doc, "Maturité technique", "88/100", COLORS.green);
  kpiRow(doc, "Automatisation des processus", "85/100", COLORS.green);
  kpiRow(doc, "Scalabilité multi-tenant", "90/100", COLORS.green);
  kpiRow(doc, "Expérience utilisateur", "78/100", COLORS.orange);
  kpiRow(doc, "Score global SUGU", "87/100", COLORS.green);

  // 2. ANALYSE ÉVOLUTIVE
  sectionTitle(doc, "2. Analyse Évolutive — Roadmap & Potentiel");
  
  subSection(doc, "Phase actuelle (Mars 2026)");
  para(doc, "SUGU est en production avec 2 restaurants actifs (Valentine 13011, Maillane 13008). L'ensemble des modules core sont opérationnels. Le système COBA Pro (/pro/:slug) vient d'être lancé, offrant un accès dédié par restaurant avec chat IA spécialisé.");

  subSection(doc, "Évolutions court terme (Q2 2026)");
  bullet(doc, "Application mobile dédiée restaurateur (React Native) avec push notifications temps réel");
  bullet(doc, "Module facturation et devis fournisseurs avec OCR automatique (scan factures)");
  bullet(doc, "Dashboard analytics avancé: prévisions CA, saisonnalité, optimisation menu");
  bullet(doc, "Intégration caisse enregistreuse (compatibilité NF525/certifiée)");
  bullet(doc, "Module de gestion des stocks avec alertes de rupture et commande automatique");

  subSection(doc, "Évolutions moyen terme (S2 2026)");
  bullet(doc, "Marketplace fournisseurs: mise en relation directe avec comparaison de prix");
  bullet(doc, "Module fidélité client intégré aux plateformes de livraison");
  bullet(doc, "IA prédictive: anticipation des pics d'activité, ajustement effectifs");
  bullet(doc, "Multi-devises et internationalisation (adaptation marché européen)");
  bullet(doc, "API publique pour intégrateurs tiers et partenaires");

  subSection(doc, "Vision long terme (2027+)");
  bullet(doc, "Plateforme SaaS autonome commercialisable en marque blanche");
  bullet(doc, "Réseau de restaurants connectés avec benchmarking sectoriel anonymisé");
  bullet(doc, "IA de pricing dynamique (ajustement prix menu selon demande/coûts)");
  bullet(doc, "Conformité HACCP digitalisée avec traçabilité complète");

  // 3. ANALYSE FINANCIÈRE
  sectionTitle(doc, "3. Analyse Financière — Offres & Rentabilité");
  
  subSection(doc, "Modèle de pricing proposé");
  const priceCols = [{ label: "Plan", width: 80 }, { label: "Prix/mois", width: 70 }, { label: "Inclus", width: 200 }, { label: "Cible", width: 80 }];
  tableHeader(doc, priceCols);
  tableRow(doc, priceCols, ["Starter", "49€ HT", "Checklists, approvisionnement auto, 1 restaurant", "TPE"], "#f5f5f5");
  tableRow(doc, priceCols, ["Business", "99€ HT", "+ Comptabilité, RH, fournisseurs, KPIs", "PME"]);
  tableRow(doc, priceCols, ["Pro", "179€ HT", "+ COBA IA, HubRise, monitoring, rapports PDF", "Chaînes"], "#f5f5f5");
  tableRow(doc, priceCols, ["Enterprise", "349€ HT", "+ Multi-site, API, support dédié, marque blanche", "Groupes"]);

  subSection(doc, "Analyse de rentabilité — Scénario 3 ans");
  const rentCols = [{ label: "Indicateur", width: 200 }, { label: "An 1", width: 80 }, { label: "An 2", width: 80 }, { label: "An 3", width: 80 }];
  tableHeader(doc, rentCols);
  tableRow(doc, rentCols, ["Nombre de clients", "15", "60", "180"], "#f5f5f5");
  tableRow(doc, rentCols, ["ARPU mensuel", "110€", "130€", "145€"]);
  tableRow(doc, rentCols, ["MRR (Monthly Recurring Revenue)", "1 650€", "7 800€", "26 100€"], "#f5f5f5");
  tableRow(doc, rentCols, ["ARR (Annual Recurring Revenue)", "19 800€", "93 600€", "313 200€"]);
  tableRow(doc, rentCols, ["Coûts infrastructure (serveur, API IA)", "6 000€", "14 400€", "36 000€"], "#f5f5f5");
  tableRow(doc, rentCols, ["Coûts développement/maintenance", "24 000€", "36 000€", "48 000€"]);
  tableRow(doc, rentCols, ["Coûts commerciaux/marketing", "8 000€", "18 000€", "30 000€"], "#f5f5f5");
  tableRow(doc, rentCols, ["Résultat net estimé", "-18 200€", "+25 200€", "+199 200€"]);
  tableRow(doc, rentCols, ["Marge nette", "—", "27%", "64%"], "#f5f5f5");

  subSection(doc, "Seuil de rentabilité");
  para(doc, "Avec un ARPU de 110€/mois et des coûts fixes mensuels estimés à ~3 200€ (infra + maintenance), le seuil de rentabilité se situe à environ 30 clients actifs, atteignable au cours du 14e mois d'exploitation commerciale.");

  subSection(doc, "Sources de revenus complémentaires");
  bullet(doc, "Frais d'intégration/onboarding: 500-1 500€ par restaurant (one-shot)");
  bullet(doc, "Formation personnel: 200€/session (visio ou sur site)");
  bullet(doc, "Développement sur mesure: 800€/jour (personnalisation, intégrations spécifiques)");
  bullet(doc, "Commission marketplace fournisseurs: 1-3% sur transactions (futur)");

  // 4. ANALYSE DE COMMERCIALISATION
  sectionTitle(doc, "4. Analyse de Commercialisation");
  
  subSection(doc, "Étude concurrentielle");
  const compCols = [{ label: "Concurrent", width: 90 }, { label: "Prix", width: 65 }, { label: "Forces", width: 150 }, { label: "vs SUGU", width: 100 }];
  tableHeader(doc, compCols);
  tableRow(doc, compCols, ["Lightspeed", "69-199€", "POS intégré, international", "Pas d'IA, cher"], "#f5f5f5");
  tableRow(doc, compCols, ["Zelty", "49-149€", "Caisse certifiée, multi-site", "Pas de monitoring"]);
  tableRow(doc, compCols, ["Tiller", "59-129€", "iPad, rapports", "Pas d'approvisionnement auto"], "#f5f5f5");
  tableRow(doc, compCols, ["Innovorder", "79-199€", "Bornes + livraison", "Pas de compta intégrée"]);
  tableRow(doc, compCols, ["Koust", "79-149€", "Gestion stocks, food cost", "Pas de RH ni monitoring"], "#f5f5f5");
  tableRow(doc, compCols, ["Addition", "89-189€", "Solution complète, français", "Pas d'IA conversationnelle"]);

  subSection(doc, "Avantages concurrentiels SUGU");
  bullet(doc, "UNIQUE: Assistant IA conversationnel (COBA) intégré à la gestion quotidienne — aucun concurrent n'offre cela");
  bullet(doc, "UNIQUE: Monitoring proactif avec auto-diagnostic et alertes Discord/Email temps réel");
  bullet(doc, "UNIQUE: Approvisionnement automatisé avec envoi shopping list multi-canal (email + Discord + calendrier)");
  bullet(doc, "Checklists multilingues synchronisées en temps réel (WebSocket)");
  bullet(doc, "Coût inférieur à la moyenne du marché avec fonctionnalités IA incluses");
  bullet(doc, "Architecture multi-tenant native permettant une scalabilité rapide");

  subSection(doc, "Législation française applicable");
  para(doc, "La commercialisation de SUGU en France impose le respect de plusieurs cadres réglementaires:");
  
  bullet(doc, "LOI NF525 (Anti-fraude TVA): Depuis le 1er janvier 2018, tout logiciel de caisse doit être certifié NF525 ou attesté par l'éditeur. SUGU, en tant que logiciel de gestion (non caisse), n'est PAS directement soumis à cette obligation mais devra l'être si un module caisse est ajouté.");
  bullet(doc, "RGPD (Règlement Général sur la Protection des Données): Traitement de données personnelles (employés, clients). Obligation de DPO si traitement à grande échelle. Registre des traitements, consentements, droit à l'effacement. Stockage UE obligatoire.");
  bullet(doc, "Code du Travail (gestion RH/Paie): Le module de paie doit respecter le Code du Travail (bulletins de paie dématérialisés conformes, DSN). Obligation de conservation 5 ans minimum des données de paie.");
  bullet(doc, "Réglementation comptable (PCG): Les écritures bancaires et comptables doivent suivre le Plan Comptable Général. Conservation 10 ans des pièces comptables.");
  bullet(doc, "HACCP & Hygiène: Si SUGU intègre un module traçabilité alimentaire, conformité au Paquet Hygiène (CE 852/2004). Obligation de traçabilité ascendante et descendante.");
  bullet(doc, "Loi Egalim (relations fournisseurs): Délais de paiement max 30 jours fin de mois pour denrées périssables. Sanction AMF si non-respect.");

  subSection(doc, "Stratégie de mise sur le marché");
  bullet(doc, "Phase 1 (Q2 2026): Lancement soft avec 10-15 restaurants en région PACA, pricing agressif Starter à 49€");
  bullet(doc, "Phase 2 (S2 2026): Expansion Paris/Lyon/Bordeaux via partenariats avec groupements de restaurateurs");
  bullet(doc, "Phase 3 (2027): Certification NF525 (si module caisse), lancement marketplace fournisseurs");
  bullet(doc, "Canal d'acquisition principal: Démonstrations terrain + bouche-à-oreille (réseau SUGU existant)");
  bullet(doc, "Canal secondaire: SEO/SEA ciblé (\"logiciel gestion restaurant IA\"), présence salons CHR");
  bullet(doc, "Partenariats stratégiques: Chambres de Commerce, syndicats restaurateurs (UMIH, GNI)");

  subSection(doc, "Risques identifiés & mitigation");
  bullet(doc, "R1: Certification NF525 coûteuse (8-15k€) → Mitigation: Reporter jusqu'à intégration caisse");
  bullet(doc, "R2: Concurrence des acteurs établis (Lightspeed, Zelty) → Mitigation: Différenciation IA unique");
  bullet(doc, "R3: Complexité RGPD multi-tenant → Mitigation: DPO externalisé, Privacy by Design");
  bullet(doc, "R4: Dépendance HubRise → Mitigation: API directes UberEats/Deliveroo en fallback");
  bullet(doc, "R5: Adoption technologique lente en restauration → Mitigation: Onboarding assisté, formation incluse");

  footer(doc);
  doc.end();
  return new Promise(resolve => stream.on("finish", resolve));
}

// =====================================================
// DEVMAX ANALYSIS
// =====================================================
function generateDevMaxAnalysis() {
  const { doc, stream } = createDoc("Analyse_DevMax_Mars2026.pdf");
  header(doc, "DevMax — Analyse Stratégique Complète", "Plateforme SaaS DevOps avec Intelligence Artificielle", COLORS.accentBlue);

  // 1. SYNTHÈSE ÉVALUATIVE
  sectionTitle(doc, "1. Synthèse Évaluative Globale");
  para(doc, "DevMax est une plateforme SaaS de DevOps augmentée par l'intelligence artificielle, conçue pour fournir un environnement complet de gestion de projets, déploiement automatisé, et ingénierie logicielle assistée par IA. La plateforme cible les développeurs, startups et PME tech qui souhaitent automatiser leur workflow de développement à déploiement.");

  subSection(doc, "Architecture Technique");
  bullet(doc, "Multi-tenant complet avec isolation par organisation (devmax_tenants)");
  bullet(doc, "Authentification PIN + Login/Password avec sessions sécurisées (SHA-256, PBKDF2)");
  bullet(doc, "Intégration GitHub complète: 47 actions (branches, commits, PRs, workflows, patches, search)");
  bullet(doc, "Déploiement VPS automatisé via SSH (Hetzner): PM2, Nginx, SSL, PostgreSQL");
  bullet(doc, "Pipeline CI/CD intégré: preflight → backup → build → test → security → deploy → health check");
  bullet(doc, "DGM (Dev God Mode): pipeline IA autonome avec 14 actions, exécution parallèle, auto-healing");
  bullet(doc, "4 algorithmes propriétaires: Brain Impact Map, CI Oracle, Auto Patch Advisor, Homework Brain Planner");
  bullet(doc, "MaxAI chat avec contexte DevOps complet, journal de projet, historique persistant");

  subSection(doc, "Couverture Fonctionnelle");
  const funcCols = [{ label: "Module", width: 130 }, { label: "Fonctions", width: 200 }, { label: "Maturité", width: 80 }];
  tableHeader(doc, funcCols);
  const funcData = [
    ["GitHub Bridge", "47 actions: repos, branches, PRs, CI/CD, patches", "✅ Production"],
    ["Déploiement", "Staging/prod, promote, rollback, snapshots", "✅ Production"],
    ["Infrastructure", "50 actions serveur: DB, Nginx, SSL, CRON, PM2", "✅ Production"],
    ["Sécurité", "Scan vulnérabilités, secrets, headers, SSL audit", "✅ Production"],
    ["Performance", "Profiling CPU/mem, load testing, bundle analyze", "✅ Production"],
    ["Architecture", "Analyse structure, complexité, deps circulaires", "✅ Production"],
    ["DGM Pipeline", "IA autonome, décomposition, self-healing", "✅ Production"],
    ["Admin Panel", "Multi-tenant, plans, facturation, API keys", "✅ Production"],
    ["Chat MaxAI", "Contexte DevOps, journal, historique, audit auto", "✅ Production"],
    ["URL Diagnostic", "Auto-fix 502/404/503, Nginx, PM2, SSL repair", "✅ Production"],
    ["Scaffolding", "Génération projets: Express, React, Next.js, static", "✅ Production"],
    ["Monitoring", "Cron 5min, auto-restart PM2, alertes", "✅ Production"],
  ];
  funcData.forEach((r, i) => tableRow(doc, funcCols, r, i % 2 === 0 ? "#f0f0ff" : null));

  subSection(doc, "Score d'Évaluation Global");
  kpiRow(doc, "Couverture fonctionnelle DevOps", "95/100", COLORS.green);
  kpiRow(doc, "Maturité technique", "91/100", COLORS.green);
  kpiRow(doc, "Innovation IA (DGM + MaxAI)", "94/100", COLORS.green);
  kpiRow(doc, "Scalabilité multi-tenant", "88/100", COLORS.green);
  kpiRow(doc, "Expérience développeur", "82/100", COLORS.green);
  kpiRow(doc, "Sécurité & conformité", "85/100", COLORS.green);
  kpiRow(doc, "Score global DevMax", "89/100", COLORS.green);

  // 2. ANALYSE ÉVOLUTIVE
  sectionTitle(doc, "2. Analyse Évolutive — Roadmap & Potentiel");

  subSection(doc, "Phase actuelle (Mars 2026)");
  para(doc, "DevMax est une plateforme mature avec un panel admin multi-tenant complet, une intégration GitHub profonde, un déploiement automatisé sur VPS Hetzner, et une IA DevOps (Max) capable d'opérer de manière autonome. Le système DGM V2 peut décomposer des tâches complexes et les exécuter en parallèle avec auto-healing.");

  subSection(doc, "Évolutions court terme (Q2 2026)");
  bullet(doc, "Support GitLab et Bitbucket en plus de GitHub");
  bullet(doc, "Intégration cloud providers: AWS, GCP, Azure (en plus de Hetzner VPS)");
  bullet(doc, "Marketplace d'extensions/plugins DevOps");
  bullet(doc, "Tableaux de bord personnalisables par projet avec métriques DORA");
  bullet(doc, "Système de facturation Stripe intégré avec gestion des abonnements");

  subSection(doc, "Évolutions moyen terme (S2 2026)");
  bullet(doc, "Environnements éphémères (preview environments par PR)");
  bullet(doc, "Feature flags management natif");
  bullet(doc, "Observabilité intégrée: logs centralisés, APM, distributed tracing");
  bullet(doc, "Collaboration temps réel: code review assistée IA, pair programming");
  bullet(doc, "Intégration Kubernetes pour orchestration container");

  subSection(doc, "Vision long terme (2027+)");
  bullet(doc, "Agent IA autonome capable de résoudre des bugs end-to-end sans intervention");
  bullet(doc, "Conformité SOC2/ISO27001 pour accès marchés enterprise");
  bullet(doc, "Self-hosted option pour clients sensibles (banques, santé, défense)");
  bullet(doc, "Marketplace de modèles IA spécialisés par stack technologique");

  // 3. ANALYSE FINANCIÈRE
  sectionTitle(doc, "3. Analyse Financière — Offres & Rentabilité");

  subSection(doc, "Modèle de pricing proposé");
  const priceCols = [{ label: "Plan", width: 75 }, { label: "Prix/mois", width: 60 }, { label: "Inclus", width: 210 }, { label: "Limites", width: 80 }];
  tableHeader(doc, priceCols);
  tableRow(doc, priceCols, ["Free", "0€", "3 projets, GitHub, déploiement basique", "2 users, 10 deploys/mo"], "#f0f0ff");
  tableRow(doc, priceCols, ["Starter", "29€ HT", "10 projets, CI/CD, monitoring, MaxAI", "5 users, 50 deploys/mo"]);
  tableRow(doc, priceCols, ["Pro", "79€ HT", "50 projets, DGM, security scan, API access", "20 users, 200 deploys/mo"], "#f0f0ff");
  tableRow(doc, priceCols, ["Enterprise", "199€ HT", "Illimité, support dédié, SLA, custom domain", "Illimité"]);

  subSection(doc, "Analyse de rentabilité — Scénario 3 ans");
  const rentCols = [{ label: "Indicateur", width: 200 }, { label: "An 1", width: 80 }, { label: "An 2", width: 80 }, { label: "An 3", width: 80 }];
  tableHeader(doc, rentCols);
  tableRow(doc, rentCols, ["Utilisateurs Free", "500", "2 000", "8 000"], "#f0f0ff");
  tableRow(doc, rentCols, ["Clients payants (conversion ~5%)", "25", "100", "400"]);
  tableRow(doc, rentCols, ["ARPU mensuel", "55€", "68€", "82€"], "#f0f0ff");
  tableRow(doc, rentCols, ["MRR (Monthly Recurring Revenue)", "1 375€", "6 800€", "32 800€"]);
  tableRow(doc, rentCols, ["ARR (Annual Recurring Revenue)", "16 500€", "81 600€", "393 600€"], "#f0f0ff");
  tableRow(doc, rentCols, ["Coûts infrastructure (serveurs, API IA, GPU)", "12 000€", "28 800€", "72 000€"]);
  tableRow(doc, rentCols, ["Coûts développement/maintenance", "30 000€", "48 000€", "72 000€"], "#f0f0ff");
  tableRow(doc, rentCols, ["Coûts commerciaux/marketing/support", "12 000€", "24 000€", "48 000€"]);
  tableRow(doc, rentCols, ["Résultat net estimé", "-37 500€", "-19 200€", "+201 600€"], "#f0f0ff");
  tableRow(doc, rentCols, ["Marge nette", "—", "—", "51%"]);

  subSection(doc, "Seuil de rentabilité");
  para(doc, "Avec un ARPU de 55€/mois en phase de lancement et des coûts fixes mensuels de ~4 500€, le seuil de rentabilité se situe à environ 82 clients payants, atteignable vers le 20e mois. La stratégie freemium permet d'accélérer l'acquisition mais allonge le temps au breakeven. Le passage en positif se fait typiquement en An 3 grâce à l'effet réseau et la montée en gamme des clients.");

  subSection(doc, "Métriques SaaS cibles");
  kpiRow(doc, "CAC (Coût d'Acquisition Client)", "< 200€", COLORS.blue);
  kpiRow(doc, "LTV (Lifetime Value) @ 24 mois", "1 320-1 968€", COLORS.green);
  kpiRow(doc, "LTV/CAC ratio cible", "> 5x", COLORS.green);
  kpiRow(doc, "Churn mensuel cible", "< 3%", COLORS.orange);
  kpiRow(doc, "Net Revenue Retention", "> 110%", COLORS.green);
  kpiRow(doc, "Time to Value", "< 15 minutes (first deploy)", COLORS.blue);

  subSection(doc, "Sources de revenus complémentaires");
  bullet(doc, "Compute minutes pour DGM/pipelines IA au-delà du quota: 0.05€/minute");
  bullet(doc, "Marketplace de templates/plugins: 30% commission sur ventes tiers");
  bullet(doc, "Consulting/formation DevOps IA: 1 200€/jour");
  bullet(doc, "Support premium SLA 99.9%: +50€/mois/projet");
  bullet(doc, "Self-hosted license enterprise: 2 000-5 000€/an");

  // 4. ANALYSE DE COMMERCIALISATION
  sectionTitle(doc, "4. Analyse de Commercialisation");

  subSection(doc, "Étude concurrentielle");
  const compCols = [{ label: "Concurrent", width: 80 }, { label: "Prix", width: 65 }, { label: "Forces", width: 165 }, { label: "vs DevMax", width: 100 }];
  tableHeader(doc, compCols);
  tableRow(doc, compCols, ["Vercel", "20-150$", "DX excellent, serverless, edge", "Pas d'IA DevOps"], "#f0f0ff");
  tableRow(doc, compCols, ["Netlify", "19-99$", "JAMstack, forms, edge functions", "Pas de VPS/SSH"]);
  tableRow(doc, compCols, ["Railway", "5-20$/service", "Simple, DB intégrées", "Pas d'IA, limité"], "#f0f0ff");
  tableRow(doc, compCols, ["Render", "7-25$", "Auto-deploy, managed DB", "Pas de CI/CD avancé"]);
  tableRow(doc, compCols, ["GitHub Copilot", "10-39$", "IA code leader, intégration IDE", "Pas de déploiement"], "#f0f0ff");
  tableRow(doc, compCols, ["Cursor", "20-40$", "IDE IA natif, context large", "Pas d'infra/deploy"]);
  tableRow(doc, compCols, ["Replit", "7-20$", "IDE + deploy + IA, tout-en-un", "Pas de VPS custom"], "#f0f0ff");
  tableRow(doc, compCols, ["Coolify", "5€ self-host", "Open source, VPS deploy", "Pas d'IA"]);

  subSection(doc, "Positionnement unique DevMax");
  para(doc, "DevMax se positionne dans un créneau inexploité: la convergence entre plateforme de déploiement (Vercel/Railway) et assistant IA DevOps (Copilot/Cursor). Aucun concurrent ne combine ces deux aspects avec le niveau de profondeur de DevMax.");
  bullet(doc, "UNIQUE: Agent IA DevOps autonome (Max) capable d'analyser, corriger et déployer sans intervention");
  bullet(doc, "UNIQUE: DGM (Dev God Mode) — pipeline IA avec décomposition automatique de tâches complexes");
  bullet(doc, "UNIQUE: 4 algorithmes propriétaires d'intelligence DevOps (Impact Map, CI Oracle, Patch Advisor, Homework Planner)");
  bullet(doc, "UNIQUE: URL auto-diagnostic et auto-repair (502/404/503 résolus automatiquement)");
  bullet(doc, "Déploiement VPS réel (Hetzner) vs conteneurs limités des concurrents");
  bullet(doc, "Admin multi-tenant natif avec gestion plans, facturation, API keys");

  subSection(doc, "Législation française applicable");
  para(doc, "La commercialisation de DevMax en France et en Europe impose le respect de plusieurs cadres réglementaires:");
  
  bullet(doc, "RGPD: Traitement de données personnelles des développeurs (code, logs, historique). Obligation de consentement explicite, DPO, registre des traitements. Droit à l'effacement du code et des données de déploiement. Hébergement UE obligatoire (Hetzner DE ✓).");
  bullet(doc, "Directive NIS2 (Network & Information Security): En vigueur depuis octobre 2024. DevMax, en tant que fournisseur de services cloud/PaaS, pourrait être soumis à des obligations de cybersécurité renforcées si le CA dépasse 10M€ ou 50 employés.");
  bullet(doc, "Loi de confiance dans l'économie numérique (LCEN): Obligation d'identification de l'éditeur, mentions légales, CGU/CGV. Responsabilité d'hébergeur pour le code déployé par les clients.");
  bullet(doc, "Réglementation IA (AI Act UE): Le AI Act européen (entrée en vigueur progressive 2024-2026) classe les systèmes IA. DevMax/DGM serait probablement classé \"risque limité\" avec obligations de transparence (informer que le code est généré/modifié par IA).");
  bullet(doc, "Code de commerce (facturation): Facturation conforme aux normes françaises (CGV, TVA, délais de paiement). TVA à 20% sur les services numériques. Factures électroniques obligatoires à partir de 2026 (décret 2024).");
  bullet(doc, "Droit de la propriété intellectuelle: Clarifier dans les CGU la propriété du code généré par l'IA (DGM). Le client reste propriétaire de son code. DevMax n'a aucun droit d'utilisation du code client.");
  bullet(doc, "SecNumCloud (optionnel): Pour cibler les administrations françaises et clients sensibles, la qualification SecNumCloud de l'ANSSI est un avantage compétitif majeur (coût ~50-100k€).");

  subSection(doc, "Stratégie de mise sur le marché");
  bullet(doc, "Phase 1 — Product-Led Growth (Q2 2026): Plan Free généreux pour acquisition virale. SEO sur \"DevOps IA\", \"deploy automatique\", \"CI/CD gratuit\". Présence Product Hunt, Hacker News, Dev.to");
  bullet(doc, "Phase 2 — Communauté (S2 2026): Open source d'outils CLI périphériques. Sponsoring meetups dev (Paris, Lyon). Contenu technique: blog, vidéos YouTube, webinaires");
  bullet(doc, "Phase 3 — Enterprise (2027): Équipe commerciale dédiée. Certifications sécurité. Partenariats ESN et intégrateurs. Présence salons: VivaTech, DevOxx, Web Summit");
  bullet(doc, "Canal d'acquisition principal: PLG (Product-Led Growth) via plan Free");
  bullet(doc, "Canal secondaire: Content marketing technique + SEO ciblé développeurs");
  bullet(doc, "Canal tertiaire: Partenariats école (42, Epitech, EPITA) pour adoption early-stage");

  subSection(doc, "Risques identifiés & mitigation");
  bullet(doc, "R1: Compétition intense (Vercel, Replit) avec budgets massifs → Différenciation IA DevOps unique");
  bullet(doc, "R2: Coûts IA/GPU élevés (OpenAI API) → Architecture hybride avec modèles open source (Llama, Mistral)");
  bullet(doc, "R3: Sécurité du code client hébergé → Chiffrement E2E, audits réguliers, bug bounty");
  bullet(doc, "R4: AI Act compliance → Transparence IA, documentation des algorithmes, human-in-the-loop");
  bullet(doc, "R5: Dépendance GitHub API → Support multi-forge (GitLab, Bitbucket) en priorité");
  bullet(doc, "R6: Scalabilité VPS vs cloud → Migration progressive vers K8s sur cloud providers");

  // 5. MATRICE SWOT
  sectionTitle(doc, "5. Matrice SWOT");

  subSection(doc, "Forces (Strengths)");
  bullet(doc, "IA DevOps propriétaire et opérationnelle (Max + DGM + 4 algorithmes)");
  bullet(doc, "Plateforme complète: code → deploy → monitor en un seul outil");
  bullet(doc, "Architecture multi-tenant mature et testée en production");
  bullet(doc, "Coûts d'infrastructure maîtrisés (VPS Hetzner vs cloud premium)");

  subSection(doc, "Faiblesses (Weaknesses)");
  bullet(doc, "Équipe réduite (développeur solo) — risque bus factor");
  bullet(doc, "Pas encore de certifications sécurité (SOC2, SecNumCloud)");
  bullet(doc, "Support limité aux VPS Hetzner (pas encore multi-cloud)");
  bullet(doc, "Documentation utilisateur et onboarding à structurer");

  subSection(doc, "Opportunités (Opportunities)");
  bullet(doc, "Marché DevOps IA en explosion ($10B en 2026, +25%/an)");
  bullet(doc, "Pénurie de DevOps qualifiés → forte demande d'automatisation");
  bullet(doc, "AI Act crée une barrière à l'entrée pour les nouveaux entrants non conformes");
  bullet(doc, "Tendance souveraineté numérique EU → avantage hébergement Hetzner DE");

  subSection(doc, "Menaces (Threats)");
  bullet(doc, "GitHub Copilot Workspace pourrait intégrer du déploiement IA");
  bullet(doc, "AWS/GCP pourraient lancer des offres DevOps IA intégrées");
  bullet(doc, "Régulation IA restrictive pourrait limiter les capacités du DGM");
  bullet(doc, "Récession économique impactant les budgets tech des startups");

  footer(doc);
  doc.end();
  return new Promise(resolve => stream.on("finish", resolve));
}

async function main() {
  console.log("Génération de l'analyse SUGU...");
  await generateSuguAnalysis();
  console.log("✅ Analyse SUGU générée");

  console.log("Génération de l'analyse DevMax...");
  await generateDevMaxAnalysis();
  console.log("✅ Analyse DevMax générée");

  console.log("Les 2 analyses sont prêtes !");
}

main().catch(console.error);
