import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useToast } from "@/hooks/use-toast";
import {
  Terminal,
  Rocket,
  GitBranch,
  Shield,
  Globe,
  Zap,
  BarChart3,
  Bell,
  Lock,
  ArrowRight,
  CheckCircle2,
  Star,
  Code,
  Server,
  Cpu,
  Activity,
  Users,
  ChevronDown,
  Play,
  ExternalLink,
  Menu,
  X,
  Check,
  Minus,
  Loader2,
  Send,
  Building2,
  TestTube2,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DevMaxLandingProps {
  onGoToLogin: () => void;
}

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: "easeOut" },
  }),
};

const FEATURES = [
  {
    icon: GitBranch,
    title: "CI/CD GitHub",
    desc: "Push sur GitHub → build automatique → déploiement staging en 60s. Promotion en production en 1 clic.",
    color: "from-violet-500 to-purple-600",
  },
  {
    icon: Server,
    title: "VPS Hetzner",
    desc: "Déployé sur vos propres VPS Hetzner. PM2, Nginx, SSL Let's Encrypt — tout est automatisé.",
    color: "from-cyan-500 to-blue-600",
  },
  {
    icon: Globe,
    title: "Domaines Custom",
    desc: "Ajoutez vos domaines personnalisés. DNS Cloudflare et certificats SSL provisionnés automatiquement.",
    color: "from-emerald-500 to-green-600",
  },
  {
    icon: Shield,
    title: "Sécurité",
    desc: "Variables d'environnement chiffrées, auth multi-session, rate limiting, verrouillage de compte.",
    color: "from-orange-500 to-amber-600",
  },
  {
    icon: BarChart3,
    title: "Métriques Live",
    desc: "CPU, RAM, uptime, restarts — surveillez vos apps en temps réel avec des graphiques historiques.",
    color: "from-pink-500 to-rose-600",
  },
  {
    icon: Bell,
    title: "Notifications",
    desc: "Alertes deploy, downtime, SSL expiry. Par email, webhook Discord, ou dans le dashboard.",
    color: "from-yellow-500 to-orange-500",
  },
  {
    icon: Terminal,
    title: "Logs Centralisés",
    desc: "Consultez les logs PM2 de tous vos projets depuis le dashboard. Filtres, recherche, coloration.",
    color: "from-indigo-500 to-blue-600",
  },
  {
    icon: Rocket,
    title: "Templates",
    desc: "Express API, React + Vite, Fullstack, Next.js, Static HTML — démarrez en 30 secondes.",
    color: "from-red-500 to-pink-600",
  },
];

const PLANS = [
  {
    name: "Free",
    price: { monthly: "0€", yearly: "0€" },
    period: { monthly: "/mois", yearly: "/an" },
    desc: "Pour tester et prototyper",
    badge: null,
    features: [
      "3 projets",
      "10 déploiements/mois",
      "2 utilisateurs",
      "1 Go stockage",
      "Sous-domaine .ulyssepro.org",
      "Support communautaire",
    ],
    notIncluded: ["Domaine custom", "Tests automatisés", "API access", "IA DevOps (DGM)"],
    cta: "Commencer gratuitement",
    highlight: false,
  },
  {
    name: "Starter",
    price: { monthly: "19€", yearly: "190€" },
    period: { monthly: "/mois", yearly: "/an" },
    desc: "Pour les développeurs indépendants",
    badge: "Populaire",
    features: [
      "10 projets",
      "50 déploiements/mois",
      "5 utilisateurs",
      "5 Go stockage",
      "Domaine custom",
      "Tests automatisés (Vitest/Jest)",
      "Notifications avancées",
      "Support email",
    ],
    notIncluded: ["API access complet", "IA DevOps (DGM)"],
    cta: "Essai gratuit 14 jours",
    highlight: true,
  },
  {
    name: "Pro",
    price: { monthly: "49€", yearly: "490€" },
    period: { monthly: "/mois", yearly: "/an" },
    desc: "Pour les équipes et agences",
    badge: null,
    features: [
      "50 projets",
      "500 déploiements/mois",
      "20 utilisateurs",
      "50 Go stockage",
      "Domaines custom illimités",
      "Tests automatisés + CI/CD",
      "API access complet",
      "IA DevOps (DGM) illimitée",
      "Métriques avancées",
      "Support prioritaire",
    ],
    notIncluded: [],
    cta: "Essai gratuit 14 jours",
    highlight: false,
  },
  {
    name: "Enterprise",
    price: { monthly: "Sur mesure", yearly: "Sur mesure" },
    period: { monthly: "", yearly: "" },
    desc: "Pour les grandes organisations",
    badge: null,
    features: [
      "Projets illimités",
      "Déploiements illimités",
      "Utilisateurs illimités",
      "500 Go stockage",
      "Multi-VPS dédié",
      "SLA 99.9% garanti",
      "Account manager dédié",
      "On-boarding personnalisé",
      "Tests + CI/CD + DGM IA",
      "Audit sécurité inclus",
    ],
    notIncluded: [],
    cta: "Nous contacter",
    highlight: false,
  },
];

const FEATURE_COMPARISON = [
  { category: "Projets & Déploiement", features: [
    { name: "Projets", free: "3", starter: "10", pro: "50", enterprise: "Illimité" },
    { name: "Déploiements/mois", free: "10", starter: "50", pro: "500", enterprise: "Illimité" },
    { name: "Utilisateurs", free: "2", starter: "5", pro: "20", enterprise: "Illimité" },
    { name: "Templates prêts à l'emploi", free: true, starter: true, pro: true, enterprise: true },
    { name: "Push → Deploy auto", free: true, starter: true, pro: true, enterprise: true },
    { name: "Staging + Production", free: true, starter: true, pro: true, enterprise: true },
  ]},
  { category: "Domaines & SSL", features: [
    { name: "Sous-domaine .ulyssepro.org", free: true, starter: true, pro: true, enterprise: true },
    { name: "Domaine custom", free: false, starter: true, pro: true, enterprise: true },
    { name: "SSL automatique (Let's Encrypt)", free: true, starter: true, pro: true, enterprise: true },
    { name: "Vérification DNS intégrée", free: false, starter: true, pro: true, enterprise: true },
  ]},
  { category: "Tests & CI/CD", features: [
    { name: "Tests avant déploiement (bloquant)", free: false, starter: true, pro: true, enterprise: true },
    { name: "Vitest/Jest pré-configuré", free: false, starter: true, pro: true, enterprise: true },
    { name: "GitHub Actions CI/CD", free: false, starter: false, pro: true, enterprise: true },
    { name: "Rollback automatique si échec", free: false, starter: false, pro: true, enterprise: true },
  ]},
  { category: "Monitoring & Logs", features: [
    { name: "Health check automatique", free: true, starter: true, pro: true, enterprise: true },
    { name: "Logs PM2 centralisés", free: true, starter: true, pro: true, enterprise: true },
    { name: "Métriques CPU/RAM/Uptime", free: false, starter: true, pro: true, enterprise: true },
    { name: "Alertes downtime/SSL", free: false, starter: true, pro: true, enterprise: true },
  ]},
  { category: "IA & Avancé", features: [
    { name: "IA DevOps (DGM) chat", free: false, starter: false, pro: true, enterprise: true },
    { name: "API access", free: false, starter: false, pro: true, enterprise: true },
    { name: "Multi-VPS", free: false, starter: false, pro: false, enterprise: true },
    { name: "SLA garanti", free: false, starter: false, pro: false, enterprise: true },
    { name: "Account manager", free: false, starter: false, pro: false, enterprise: true },
  ]},
];

const STEPS = [
  {
    step: "1",
    title: "Créez votre compte",
    desc: "Inscription en 30 secondes. Aucune carte bancaire requise.",
    icon: Users,
  },
  {
    step: "2",
    title: "Connectez GitHub",
    desc: "Liez votre token GitHub ou connectez-vous via OAuth.",
    icon: GitBranch,
  },
  {
    step: "3",
    title: "Déployez",
    desc: "Choisissez un template ou importez votre repo. 1 clic = en ligne.",
    icon: Rocket,
  },
];

function PricingSection({ onGoToLogin }: { onGoToLogin: () => void }) {
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");

  return (
    <section id="pricing" className="py-20 sm:py-28">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={0} className="text-center mb-12">
          <Badge className="mb-4 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">Tarifs</Badge>
          <h2 className="text-3xl sm:text-4xl font-bold">Un plan pour chaque besoin</h2>
          <p className="mt-4 text-gray-500 dark:text-zinc-400 max-w-xl mx-auto">Commencez gratuitement, évoluez quand vous grandissez.</p>
        </motion.div>

        <div className="flex items-center justify-center gap-3 mb-10">
          <span className={cn("text-sm font-medium", billing === "monthly" ? "text-gray-900 dark:text-white" : "text-gray-400 dark:text-zinc-500")} data-testid="billing-monthly-label">Mensuel</span>
          <button
            onClick={() => setBilling(b => b === "monthly" ? "yearly" : "monthly")}
            className={cn("relative w-12 h-6 rounded-full transition-colors", billing === "yearly" ? "bg-emerald-500" : "bg-gray-300 dark:bg-zinc-700")}
            data-testid="billing-toggle"
          >
            <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform", billing === "yearly" ? "translate-x-6" : "translate-x-0.5")} />
          </button>
          <span className={cn("text-sm font-medium", billing === "yearly" ? "text-gray-900 dark:text-white" : "text-gray-400 dark:text-zinc-500")} data-testid="billing-yearly-label">
            Annuel
          </span>
          {billing === "yearly" && (
            <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-xs" data-testid="billing-discount-badge">-17% d'économie</Badge>
          )}
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {PLANS.map((plan, i) => (
            <motion.div key={i} initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={i}>
              <Card
                className={cn(
                  "h-full relative",
                  plan.highlight
                    ? "bg-gradient-to-b from-emerald-500/5 to-transparent border-emerald-500/40 dark:border-emerald-500/30 shadow-lg shadow-emerald-500/10"
                    : "bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-800"
                )}
                data-testid={`plan-card-${plan.name.toLowerCase()}`}
              >
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-emerald-500 text-white border-0 text-xs px-3"><Star className="w-3 h-3 mr-1" />{plan.badge}</Badge>
                  </div>
                )}
                <CardContent className="p-5 flex flex-col h-full">
                  <div className="mb-4">
                    <h3 className="font-bold text-lg">{plan.name}</h3>
                    <p className="text-xs text-gray-500 dark:text-zinc-500 mt-1">{plan.desc}</p>
                  </div>
                  <div className="mb-5">
                    <span className="text-3xl font-extrabold">{plan.price[billing]}</span>
                    <span className="text-sm text-gray-500 dark:text-zinc-500">{plan.period[billing]}</span>
                  </div>
                  <div className="space-y-2.5 flex-1 mb-5">
                    {plan.features.map((f, j) => (
                      <div key={j} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                        <span className="text-gray-700 dark:text-zinc-300">{f}</span>
                      </div>
                    ))}
                    {plan.notIncluded.map((f, j) => (
                      <div key={`no-${j}`} className="flex items-start gap-2 text-sm">
                        <X className="w-4 h-4 text-gray-300 dark:text-zinc-600 mt-0.5 shrink-0" />
                        <span className="text-gray-400 dark:text-zinc-600">{f}</span>
                      </div>
                    ))}
                  </div>
                  <Button
                    onClick={plan.name === "Enterprise" ? () => document.getElementById("enterprise-contact")?.scrollIntoView({ behavior: "smooth" }) : onGoToLogin}
                    className={cn(
                      "w-full",
                      plan.highlight ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-900 dark:text-white"
                    )}
                    data-testid={`plan-cta-${plan.name.toLowerCase()}`}
                  >
                    {plan.cta}
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureComparisonSection() {
  const [open, setOpen] = useState(false);

  const renderCell = (val: boolean | string) => {
    if (typeof val === "string") return <span className="text-sm font-medium text-gray-900 dark:text-white">{val}</span>;
    if (val) return <Check className="w-4 h-4 text-emerald-500 mx-auto" />;
    return <Minus className="w-4 h-4 text-gray-300 dark:text-zinc-600 mx-auto" />;
  };

  return (
    <section className="py-16 bg-gray-50 dark:bg-zinc-900/40">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-8">
          <button
            onClick={() => setOpen(!open)}
            className="inline-flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
            data-testid="feature-comparison-toggle"
          >
            Comparatif détaillé des fonctionnalités
            <ChevronDown className={cn("w-5 h-5 transition-transform", open && "rotate-180")} />
          </button>
        </div>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]" data-testid="feature-comparison-table">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-zinc-800">
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-500 dark:text-zinc-400 w-[240px]">Fonctionnalité</th>
                      <th className="text-center py-3 px-3 text-sm font-semibold text-gray-700 dark:text-zinc-300 w-[100px]">Free</th>
                      <th className="text-center py-3 px-3 text-sm font-semibold text-emerald-600 dark:text-emerald-400 w-[100px]">Starter</th>
                      <th className="text-center py-3 px-3 text-sm font-semibold text-gray-700 dark:text-zinc-300 w-[100px]">Pro</th>
                      <th className="text-center py-3 px-3 text-sm font-semibold text-gray-700 dark:text-zinc-300 w-[100px]">Enterprise</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FEATURE_COMPARISON.map((cat, ci) => (
                      <>{/* Fragment for category */}
                        <tr key={`cat-${ci}`}>
                          <td colSpan={5} className="pt-5 pb-2 px-4">
                            <span className="text-xs font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">{cat.category}</span>
                          </td>
                        </tr>
                        {cat.features.map((feat, fi) => (
                          <tr key={`feat-${ci}-${fi}`} className="border-b border-gray-100 dark:border-zinc-800/50 hover:bg-gray-50 dark:hover:bg-zinc-800/30">
                            <td className="py-2.5 px-4 text-sm text-gray-700 dark:text-zinc-300">{feat.name}</td>
                            <td className="py-2.5 px-3 text-center">{renderCell(feat.free)}</td>
                            <td className="py-2.5 px-3 text-center bg-emerald-50/30 dark:bg-emerald-950/10">{renderCell(feat.starter)}</td>
                            <td className="py-2.5 px-3 text-center">{renderCell(feat.pro)}</td>
                            <td className="py-2.5 px-3 text-center">{renderCell(feat.enterprise)}</td>
                          </tr>
                        ))}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function EnterpriseContactSection() {
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ company: "", name: "", email: "", phone: "", projectCount: "", message: "" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.company || !form.name || !form.email) return;
    setSending(true);
    try {
      const res = await fetch("/api/devmax/auth/contact/enterprise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        setSent(true);
        toast({ title: "Demande envoyée", description: "Nous vous contacterons sous 24h." });
      } else {
        toast({ title: "Erreur", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Impossible d'envoyer la demande.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <section id="enterprise-contact" className="py-20 sm:py-28">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp} custom={0}>
          <div className="grid md:grid-cols-2 gap-10">
            <div>
              <Badge className="mb-4 bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20">Enterprise</Badge>
              <h2 className="text-3xl font-bold mb-4">Besoin d'une solution sur mesure ?</h2>
              <p className="text-gray-500 dark:text-zinc-400 mb-6">
                Notre plan Enterprise s'adapte aux grandes organisations avec des besoins spécifiques en infrastructure, sécurité et support.
              </p>
              <div className="space-y-4">
                {[
                  { icon: Server, text: "Infrastructure multi-VPS dédiée" },
                  { icon: Shield, text: "SLA 99.9% avec monitoring 24/7" },
                  { icon: Users, text: "Account manager et on-boarding dédié" },
                  { icon: Bot, text: "IA DevOps (DGM) personnalisée" },
                  { icon: TestTube2, text: "Pipeline CI/CD complet + audit sécurité" },
                  { icon: Globe, text: "Domaines custom illimités + CDN" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                      <item.icon className="w-4 h-4 text-violet-500" />
                    </div>
                    <span className="text-sm text-gray-700 dark:text-zinc-300">{item.text}</span>
                  </div>
                ))}
              </div>
            </div>

            <Card className="bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-800">
              <CardContent className="p-6">
                {sent ? (
                  <div className="text-center py-10">
                    <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
                    <h3 className="text-lg font-bold mb-2">Demande envoyée !</h3>
                    <p className="text-sm text-gray-500 dark:text-zinc-400">Nous vous contacterons sous 24h ouvrées.</p>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-4" data-testid="enterprise-contact-form">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1 block">Entreprise *</label>
                        <Input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} placeholder="Acme Corp" required data-testid="enterprise-company" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1 block">Nom complet *</label>
                        <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Jean Dupont" required data-testid="enterprise-name" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1 block">Email *</label>
                        <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jean@acme.com" required data-testid="enterprise-email" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1 block">Téléphone</label>
                        <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+33 6 12 34 56 78" data-testid="enterprise-phone" />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1 block">Nombre de projets estimé</label>
                      <Input value={form.projectCount} onChange={e => setForm(f => ({ ...f, projectCount: e.target.value }))} placeholder="Ex: 50-100" data-testid="enterprise-projects" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1 block">Message</label>
                      <Textarea value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))} placeholder="Décrivez vos besoins..." rows={3} data-testid="enterprise-message" />
                    </div>
                    <Button type="submit" disabled={sending} className="w-full bg-violet-600 hover:bg-violet-700 text-white" data-testid="enterprise-submit">
                      {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                      {sending ? "Envoi en cours..." : "Envoyer la demande"}
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function DevMaxLanding({ onGoToLogin }: DevMaxLandingProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-gray-900 dark:text-white overflow-x-hidden" data-testid="devmax-landing">
      <nav
        className={cn(
          "fixed top-0 left-0 right-0 z-50 transition-all duration-300 pt-safe",
          scrolled
            ? "bg-white/80 dark:bg-zinc-950/80 backdrop-blur-xl border-b border-gray-200 dark:border-zinc-800"
            : "bg-transparent"
        )}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center">
                <Terminal className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-lg">DevMax</span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                Beta
              </Badge>
            </div>
            <div className="hidden md:flex items-center gap-6">
              <button onClick={() => scrollTo("features")} className="text-sm text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white transition-colors" data-testid="nav-features">
                Fonctionnalités
              </button>
              <button onClick={() => scrollTo("pricing")} className="text-sm text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white transition-colors" data-testid="nav-pricing">
                Tarifs
              </button>
              <button onClick={() => scrollTo("how-it-works")} className="text-sm text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white transition-colors" data-testid="nav-how">
                Comment ça marche
              </button>
              <ThemeToggle />
              <Button onClick={onGoToLogin} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="nav-login-btn">
                Se connecter
              </Button>
            </div>
            <div className="md:hidden flex items-center gap-2">
              <ThemeToggle />
              <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="p-2" data-testid="mobile-menu-btn">
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="md:hidden bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800 overflow-hidden"
            >
              <div className="px-4 py-4 space-y-3">
                <button onClick={() => scrollTo("features")} className="block text-sm text-gray-600 dark:text-zinc-400">Fonctionnalités</button>
                <button onClick={() => scrollTo("pricing")} className="block text-sm text-gray-600 dark:text-zinc-400">Tarifs</button>
                <button onClick={() => scrollTo("how-it-works")} className="block text-sm text-gray-600 dark:text-zinc-400">Comment ça marche</button>
                <Button onClick={onGoToLogin} size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">Se connecter</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
          <div className="absolute top-40 right-1/4 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full h-px bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent" />
        </div>

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 text-center">
          <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={0}>
            <Badge className="mb-6 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 px-3 py-1">
              <Zap className="w-3 h-3 mr-1" />
              DevOps autonome pour développeurs
            </Badge>
          </motion.div>

          <motion.h1
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={1}
            className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight"
          >
            Déployez vos apps{" "}
            <span className="bg-gradient-to-r from-emerald-500 to-cyan-500 bg-clip-text text-transparent">
              sans toucher au terminal
            </span>
          </motion.h1>

          <motion.p
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={2}
            className="mt-6 text-lg sm:text-xl text-gray-600 dark:text-zinc-400 max-w-2xl mx-auto leading-relaxed"
          >
            DevMax automatise votre CI/CD GitHub → Hetzner VPS. Push, build, deploy, SSL, monitoring — tout en un dashboard.
          </motion.p>

          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={3}
            className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Button
              onClick={onGoToLogin}
              size="lg"
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 h-12 text-base shadow-lg shadow-emerald-500/20"
              data-testid="hero-cta-login"
            >
              <Rocket className="w-5 h-5 mr-2" />
              Commencer gratuitement
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => scrollTo("features")}
              className="h-12 text-base border-gray-300 dark:border-zinc-700 text-gray-700 dark:text-zinc-300"
              data-testid="hero-cta-features"
            >
              <Play className="w-4 h-4 mr-2" />
              Voir les fonctionnalités
            </Button>
          </motion.div>

          <motion.div
            initial="hidden"
            animate="visible"
            variants={fadeUp}
            custom={4}
            className="mt-16 relative"
          >
            <div className="relative mx-auto max-w-3xl rounded-xl border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900/50 p-1 shadow-2xl shadow-black/5 dark:shadow-black/30">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-zinc-800">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-400/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-400/80" />
                  <div className="w-3 h-3 rounded-full bg-green-400/80" />
                </div>
                <span className="text-xs text-gray-400 dark:text-zinc-500 ml-2 font-mono">devmax.ulyssepro.org</span>
              </div>
              <div className="p-6 font-mono text-sm space-y-2">
                <div className="text-gray-400 dark:text-zinc-500">$ git push origin main</div>
                <div className="text-emerald-600 dark:text-emerald-400">✓ Build réussi (12s)</div>
                <div className="text-emerald-600 dark:text-emerald-400">✓ Tests passés (8s)</div>
                <div className="text-emerald-600 dark:text-emerald-400">✓ Déployé sur staging</div>
                <div className="text-cyan-600 dark:text-cyan-400">→ https://mon-app-dev.ulyssepro.org</div>
                <div className="mt-3 text-gray-400 dark:text-zinc-500">$ devmax promote --to production</div>
                <div className="text-emerald-600 dark:text-emerald-400">✓ Production mise à jour</div>
                <div className="text-cyan-600 dark:text-cyan-400">→ https://mon-app.ulyssepro.org</div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="py-12 border-y border-gray-100 dark:border-zinc-900 bg-gray-50/50 dark:bg-zinc-900/30">
        <div className="max-w-5xl mx-auto px-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
            {[
              { value: "60s", label: "Temps de deploy moyen" },
              { value: "99.9%", label: "Uptime garanti" },
              { value: "SSL", label: "Auto-provisionné" },
              { value: "0", label: "Config manuelle" },
            ].map((stat, i) => (
              <motion.div
                key={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeUp}
                custom={i}
              >
                <div className="text-2xl sm:text-3xl font-bold text-emerald-600 dark:text-emerald-400">{stat.value}</div>
                <div className="text-xs sm:text-sm text-gray-500 dark:text-zinc-500 mt-1">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="py-20 sm:py-28">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
            custom={0}
            className="text-center mb-16"
          >
            <Badge className="mb-4 bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20">
              Fonctionnalités
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold">Tout ce qu'il faut pour déployer</h2>
            <p className="mt-4 text-gray-500 dark:text-zinc-400 max-w-xl mx-auto">
              Du push Git au monitoring en production — DevMax gère tout le pipeline.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {FEATURES.map((f, i) => (
              <motion.div
                key={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeUp}
                custom={i}
              >
                <Card className="h-full bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-800 hover:border-emerald-500/30 transition-colors group" data-testid={`feature-card-${i}`}>
                  <CardContent className="p-5">
                    <div className={cn("w-10 h-10 rounded-lg bg-gradient-to-br flex items-center justify-center mb-4", f.color)}>
                      <f.icon className="w-5 h-5 text-white" />
                    </div>
                    <h3 className="font-semibold text-sm mb-2">{f.title}</h3>
                    <p className="text-xs text-gray-500 dark:text-zinc-500 leading-relaxed">{f.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="py-20 bg-gray-50 dark:bg-zinc-900/40">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
            custom={0}
            className="text-center mb-16"
          >
            <Badge className="mb-4 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20">
              3 étapes
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold">Comment ça marche</h2>
          </motion.div>

          <div className="grid sm:grid-cols-3 gap-8">
            {STEPS.map((s, i) => (
              <motion.div
                key={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeUp}
                custom={i}
                className="text-center"
              >
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/20">
                  <s.icon className="w-7 h-7 text-white" />
                </div>
                <div className="text-xs text-emerald-500 font-bold mb-2">ÉTAPE {s.step}</div>
                <h3 className="font-semibold mb-2">{s.title}</h3>
                <p className="text-sm text-gray-500 dark:text-zinc-500">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <PricingSection onGoToLogin={onGoToLogin} />

      <FeatureComparisonSection />

      <EnterpriseContactSection />

      <section className="py-20 bg-gray-50 dark:bg-zinc-900/40">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeUp}
            custom={0}
          >
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Prêt à simplifier vos déploiements ?</h2>
            <p className="text-gray-500 dark:text-zinc-400 mb-8 max-w-lg mx-auto">
              Créez votre compte gratuitement et déployez votre première app en moins de 5 minutes.
            </p>
            <Button
              onClick={onGoToLogin}
              size="lg"
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-10 h-12 text-base shadow-lg shadow-emerald-500/20"
              data-testid="footer-cta-login"
            >
              <Rocket className="w-5 h-5 mr-2" />
              Commencer maintenant
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </motion.div>
        </div>
      </section>

      <footer className="py-8 border-t border-gray-100 dark:border-zinc-900">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center">
                <Terminal className="w-4 h-4 text-white" />
              </div>
              <span className="font-semibold text-sm">DevMax</span>
              <span className="text-xs text-gray-400 dark:text-zinc-600">by UlyssePro</span>
            </div>
            <div className="text-xs text-gray-400 dark:text-zinc-600">
              © {new Date().getFullYear()} DevMax — Plateforme DevOps autonome
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default DevMaxLanding;
