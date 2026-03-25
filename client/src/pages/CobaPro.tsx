import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Send,
  Loader2,
  Bot,
  Store,
  BarChart3,
  Users,
  Receipt,
  ShoppingCart,
  Landmark,
  ClipboardCheck,
  Wallet,
  CalendarOff,
  TrendingUp,
  Shield,
  ChevronDown,
  ChevronUp,
  Paperclip,
  Lock,
  Eye,
  EyeOff,
  X,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const DEVMAX_TOKEN_KEY = "devmax_session_token";
const AUTH_API = "/api/devmax";

const cobaQueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30000, retry: 1 } },
});

function getDevmaxToken(): string | null {
  try { return localStorage.getItem(DEVMAX_TOKEN_KEY); } catch { return null; }
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  toolActivity?: { tool: string; label?: string; status: string; durationMs?: number }[];
  attachments?: { name: string; type: string; preview?: string }[];
}

const TENANT_NAMES: Record<string, string> = {
  sugumaillane: "SUGU Maillane",
  suguvalentine: "SUGU Valentine",
  suguboulevard: "SUGU Boulevard",
  sugulafayette: "SUGU Lafayette",
  sugucentre: "SUGU Centre",
};

const COBA_QUICK_COMMANDS: { icon: any; label: string; cmd: string; color: string }[] = [
  { icon: BarChart3, label: "Bilan financier", cmd: "Fais-moi une synthèse financière complète du restaurant: chiffre d'affaires, charges totales, marge nette, health score, et tendance par rapport au mois précédent.", color: "emerald" },
  { icon: ShoppingCart, label: "Achats récents", cmd: "Liste les 20 derniers achats fournisseurs avec le détail: fournisseur, montant, date, statut de paiement. Identifie les achats non payés.", color: "blue" },
  { icon: Receipt, label: "Frais généraux", cmd: "Donne-moi un récapitulatif des frais généraux par catégorie: loyer, assurances, entretien, fournitures, etc. Avec les montants mensuels.", color: "purple" },
  { icon: Users, label: "État employés", cmd: "Liste tous les employés actifs avec: poste, salaire, date d'embauche, absences récentes. Identifie les employés avec beaucoup d'absences.", color: "amber" },
  { icon: Landmark, label: "Banque & trésorerie", cmd: "Montre les dernières écritures bancaires et l'état de la trésorerie. Identifie les flux entrants/sortants majeurs et les anomalies.", color: "cyan" },
  { icon: ClipboardCheck, label: "Audit complet", cmd: "Lance un audit annuel complet: finances, RH, fournisseurs, emprunts, caisse. Score de santé global et recommandations prioritaires.", color: "red" },
  { icon: Wallet, label: "Paie du mois", cmd: "Montre les fiches de paie du mois en cours: employé, montant brut, net, charges sociales. Total masse salariale.", color: "violet" },
  { icon: TrendingUp, label: "Vue multi-tenant", cmd: "Donne une vue globale de tous les restaurants: CA, charges, marge, health score pour chaque tenant. Compare les performances.", color: "orange" },
];

const COBA_TAB_SUGGESTIONS: { label: string; cmd: string }[] = [
  { label: "Top fournisseurs", cmd: "Classe les fournisseurs par montant total d'achats sur l'année. Identifie les dépendances critiques." },
  { label: "Emprunts en cours", cmd: "Liste tous les emprunts en cours: montant restant, mensualité, taux, date de fin. Charge totale mensuelle." },
  { label: "Absences ce mois", cmd: "Détaille les absences du mois en cours par employé: type (maladie, congé, absence), durée, impact sur l'effectif." },
  { label: "Caisse journalière", cmd: "Montre les entrées de caisse des 7 derniers jours: recette, fond de caisse, écart. Alerte si écart > 5€." },
  { label: "Achats non payés", cmd: "Liste tous les achats fournisseurs en attente de paiement avec l'ancienneté de la dette. Priorise par urgence." },
  { label: "Ratio charges/CA", cmd: "Calcule le ratio charges/CA par catégorie (matières premières, personnel, frais fixes). Compare aux benchmarks restauration." },
];

function CobaLoginGate({ onAuth }: { onAuth: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPin, setShowPin] = useState(false);

  const handleLogin = async () => {
    if (!pin.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${AUTH_API}/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pin.trim() }),
      });
      const data = await res.json();
      if (data.success && data.token) {
        localStorage.setItem(DEVMAX_TOKEN_KEY, data.token);
        onAuth();
      } else {
        setError(data.error || "PIN incorrect");
      }
    } catch {
      setError("Erreur de connexion");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center p-4" data-testid="coba-login-screen">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <Card className="bg-gray-900/80 border-gray-800 backdrop-blur-xl shadow-2xl">
          <CardContent className="p-8 space-y-6">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-lg shadow-orange-500/20">
                <Store className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-white">COBA Pro</h1>
              <p className="text-gray-400 text-sm">Chef Operator Business Assistant</p>
            </div>
            <div className="space-y-3">
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <Input
                  type={showPin ? "text" : "password"}
                  value={pin}
                  onChange={e => setPin(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleLogin()}
                  placeholder="PIN d'accès"
                  className="pl-10 pr-10 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500"
                  data-testid="input-coba-pin"
                />
                <button onClick={() => setShowPin(!showPin)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                  {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {error && <p className="text-red-400 text-sm text-center" data-testid="text-coba-error">{error}</p>}
              <Button onClick={handleLogin} disabled={loading || !pin.trim()} className="w-full bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white" data-testid="button-coba-login">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Accéder
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

function ToolActivityIndicator({ activity }: { activity: ChatMessage["toolActivity"] }) {
  const [expanded, setExpanded] = useState(false);
  if (!activity || activity.length === 0) return null;

  const executing = activity.filter(a => a.status === "executing");
  const done = activity.filter(a => a.status === "done");
  const errors = activity.filter(a => a.status === "error");

  return (
    <div className="mb-2">
      <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-300 transition-colors">
        {executing.length > 0 && <Loader2 className="w-3 h-3 animate-spin text-orange-400" />}
        {executing.length > 0 ? `${executing.length} outil(s) en cours...` : `${done.length + errors.length} outil(s) exécuté(s)`}
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mt-1 space-y-1">
            {activity.map((a, i) => (
              <div key={i} className="flex items-center gap-2 text-xs px-2 py-1 rounded bg-gray-800/50">
                {a.status === "executing" ? <Loader2 className="w-3 h-3 animate-spin text-orange-400" /> :
                  a.status === "done" ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> :
                    <AlertTriangle className="w-3 h-3 text-red-400" />}
                <span className="text-gray-300 font-mono">{a.tool}</span>
                {a.label && <span className="text-gray-500">— {a.label}</span>}
                {a.durationMs && <span className="text-gray-600 ml-auto">{a.durationMs}ms</span>}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CobaChatPanel({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState<number | null>(null);
  const [attachments, setAttachments] = useState<{ name: string; type: string; dataUrl: string }[]>([]);
  const [showQuickCmds, setShowQuickCmds] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      if (file.size > 10 * 1024 * 1024) return;
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments(prev => [...prev, { name: file.name, type: file.type, dataUrl: reader.result as string }]);
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const cobaSystemHint = useMemo(() => {
    const now = new Date();
    const dateStr = now.toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Europe/Paris" });
    const timeStr = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
    return `[COBA — CHEF OPERATOR BUSINESS ASSISTANT] Tu es COBA, l'assistant de gestion intelligent pour le restaurant "${tenantName}" (tenant: ${tenantId}). Tu es un expert en gestion de restaurant: comptabilité, RH, fournisseurs, trésorerie, paie, audit.
[DATE & HEURE] Nous sommes le ${dateStr}, il est ${timeStr} (Europe/Paris).

[CONTEXTE RESTAURANT] Tenant actif: ${tenantId} | Nom: ${tenantName}
Tu as accès COMPLET à toutes les données business de ce restaurant via l'outil coba_business. Pour CHAQUE requête, tu DOIS utiliser coba_business avec tenant_id="${tenantId}".

[OUTILS DISPONIBLES]
- coba_business: Gestion complète — synthesis (bilan financier), purchases/add_purchase/update_purchase/delete_purchase (achats fournisseurs), expenses/add_expense/update_expense/delete_expense (frais généraux), bank/add_bank/update_bank/delete_bank (banque), employees/add_employee/update_employee/delete_employee (employés), payroll/add_payroll/update_payroll (paie), suppliers/add_supplier/update_supplier/delete_supplier (fournisseurs), absences/add_absence/update_absence/delete_absence (absences), loans/add_loan/update_loan/delete_loan (emprunts), cash/add_cash/update_cash/delete_cash (caisse), audit (audit complet), tenants (tous les restaurants), overview (vue globale multi-tenant)
- query_coba: Monitoring AppToOrder (stats, events, reports)

[RÈGLES]
1. Toujours passer tenant_id="${tenantId}" dans coba_business sauf pour actions tenants/overview
2. Répondre en français, ton professionnel mais accessible
3. Utiliser des tableaux markdown pour les données tabulaires
4. Calculer et afficher les KPIs: marge nette, ratio charges/CA, masse salariale/CA
5. Alerter proactivement sur les anomalies: achats impayés > 30j, absences excessives, trésorerie basse
6. Pour les modifications (ajout/update/delete), TOUJOURS confirmer avant d'exécuter
7. Quand on te demande un "bilan" ou "synthèse", utilise l'action "synthesis" puis enrichis avec les données détaillées`;
  }, [tenantId, tenantName]);

  const handleSend = useCallback(async (retryMsg?: string) => {
    const msg = retryMsg || input.trim();
    if ((!msg && attachments.length === 0) || isLoading) return;
    if (!retryMsg) setInput("");

    const currentAttachments = retryMsg ? [] : [...attachments];
    setAttachments([]);
    setShowQuickCmds(false);

    const attachmentDesc = currentAttachments.length > 0 ? `\n[Fichiers: ${currentAttachments.map(a => a.name).join(", ")}]` : "";

    if (!retryMsg) {
      setMessages(prev => [...prev, {
        role: "user",
        content: msg + attachmentDesc,
        attachments: currentAttachments.map(a => ({ name: a.name, type: a.type, preview: a.type.startsWith("image/") ? a.dataUrl : undefined })),
      }]);
    }
    setIsLoading(true);

    let messageContent = msg;
    if (currentAttachments.length > 0) {
      const fileDescs = currentAttachments.map(a => a.type.startsWith("image/") ? `[Image: ${a.name}]` : `[Fichier: ${a.name}]`).join("\n");
      messageContent = `${msg}\n\n${fileDescs}`;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const bodyPayload: any = {
        message: messageContent,
        threadId,
        originDevice: "web",
        sessionContext: "coba_pro",
        contextHints: {
          systemHint: cobaSystemHint,
          forceTools: ["coba_business", "query_coba", "compute_business_health", "sugu_full_overview"],
          cobaContext: `Restaurant: ${tenantName} (${tenantId})`,
        },
      };
      if (currentAttachments.length > 0) {
        bodyPayload.attachments = currentAttachments.map(a => ({ name: a.name, type: a.type, data: a.dataUrl }));
      }

      const token = getDevmaxToken();
      const res = await fetch("/api/v2/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "x-devmax-token": token || "",
        },
        credentials: "include",
        body: JSON.stringify(bodyPayload),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error("Erreur");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      setMessages(prev => [...prev, { role: "assistant", content: "" }]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split("\n")) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "start" && data.threadId) setThreadId(data.threadId);
                else if (data.type === "tool_status") {
                  if (data.status === "executing") {
                    setMessages(prev => {
                      const updated = [...prev];
                      const last = updated[updated.length - 1];
                      const activity = [...(last.toolActivity || [])];
                      activity.push({ tool: data.tool, label: data.label, status: "executing" });
                      updated[updated.length - 1] = { ...last, toolActivity: activity };
                      return updated;
                    });
                  } else if (data.status === "done" || data.status === "error") {
                    setMessages(prev => {
                      const updated = [...prev];
                      const last = updated[updated.length - 1];
                      const activity = [...(last.toolActivity || [])];
                      const idx = activity.findLastIndex(a => a.tool === data.tool && a.status === "executing");
                      if (idx >= 0) activity[idx] = { ...activity[idx], status: data.status, durationMs: data.durationMs };
                      updated[updated.length - 1] = { ...last, toolActivity: activity };
                      return updated;
                    });
                  }
                } else if (data.type === "chunk" && data.content) {
                  fullContent += data.content;
                  const captured = fullContent;
                  setMessages(prev => {
                    const updated = [...prev];
                    updated[updated.length - 1] = { ...updated[updated.length - 1], content: captured };
                    return updated;
                  });
                }
              } catch {}
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setMessages(prev => [...prev, { role: "assistant", content: "Erreur de communication avec COBA." }]);
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [input, threadId, isLoading, attachments, cobaSystemHint, tenantName, tenantId]);

  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setIsLoading(false);
    }
  }, []);

  return (
    <div className="flex flex-col h-full" data-testid="coba-chat-panel">
      <ScrollArea className="flex-1 p-4" ref={scrollRef as any}>
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 && showQuickCmds && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 pt-8">
              <div className="text-center space-y-2">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-orange-500/20 to-red-600/20 flex items-center justify-center border border-orange-500/30">
                  <Bot className="w-7 h-7 text-orange-400" />
                </div>
                <h2 className="text-xl font-semibold text-white">COBA</h2>
                <p className="text-gray-400 text-sm">Assistant de gestion pour <span className="text-orange-400 font-medium">{tenantName}</span></p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {COBA_QUICK_COMMANDS.map((qc, i) => {
                  const Icon = qc.icon;
                  return (
                    <motion.button
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      onClick={() => handleSend(qc.cmd)}
                      className={cn(
                        "p-3 rounded-xl border text-left transition-all hover:scale-[1.02] active:scale-[0.98]",
                        "bg-gray-800/50 border-gray-700/50 hover:border-gray-600 hover:bg-gray-800"
                      )}
                      data-testid={`button-quick-${qc.label.replace(/\s+/g, '-').toLowerCase()}`}
                    >
                      <Icon className={cn("w-5 h-5 mb-2", `text-${qc.color}-400`)} />
                      <span className="text-sm text-gray-200 font-medium">{qc.label}</span>
                    </motion.button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2 justify-center">
                {COBA_TAB_SUGGESTIONS.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => handleSend(s.cmd)}
                    className="px-3 py-1.5 rounded-full text-xs bg-gray-800/60 border border-gray-700/40 text-gray-300 hover:text-white hover:border-gray-600 transition-all"
                    data-testid={`button-suggestion-${i}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn("flex gap-3", msg.role === "user" ? "justify-end" : "justify-start")}
            >
              {msg.role === "assistant" && (
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center flex-shrink-0 mt-1">
                  <Bot className="w-4 h-4 text-white" />
                </div>
              )}
              <div className={cn(
                "max-w-[80%] rounded-2xl px-4 py-3",
                msg.role === "user"
                  ? "bg-orange-600/20 border border-orange-500/30 text-white"
                  : "bg-gray-800/60 border border-gray-700/40 text-gray-200"
              )}>
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {msg.attachments.map((a, j) => (
                      <div key={j} className="flex items-center gap-1 text-xs bg-gray-700/50 rounded px-2 py-1">
                        <Paperclip className="w-3 h-3" />
                        {a.name}
                      </div>
                    ))}
                  </div>
                )}
                <ToolActivityIndicator activity={msg.toolActivity} />
                {msg.role === "assistant" ? (
                  <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-table:my-2 prose-pre:bg-gray-900 prose-pre:border prose-pre:border-gray-700">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content || "..."}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            </motion.div>
          ))}
          {isLoading && messages.length > 0 && messages[messages.length - 1].role !== "assistant" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center flex-shrink-0">
                <Loader2 className="w-4 h-4 text-white animate-spin" />
              </div>
              <div className="bg-gray-800/60 border border-gray-700/40 rounded-2xl px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <span>COBA analyse...</span>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-gray-800 p-4">
        <div className="max-w-3xl mx-auto">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {attachments.map((a, i) => (
                <div key={i} className="flex items-center gap-1 text-xs bg-gray-800 rounded-lg px-2 py-1 border border-gray-700">
                  <Paperclip className="w-3 h-3 text-gray-400" />
                  <span className="text-gray-300 max-w-[100px] truncate">{a.name}</span>
                  <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} className="text-gray-500 hover:text-red-400">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 items-end">
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} accept="image/*,.pdf,.csv,.xlsx" />
            <Button variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} className="text-gray-400 hover:text-orange-400 flex-shrink-0" data-testid="button-attach-file">
              <Paperclip className="w-5 h-5" />
            </Button>
            <Input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={`Demandez à COBA pour ${tenantName}...`}
              className="flex-1 bg-gray-800/60 border-gray-700 text-white placeholder:text-gray-500 focus-visible:ring-orange-500/50"
              disabled={isLoading}
              data-testid="input-coba-message"
            />
            {isLoading ? (
              <Button onClick={handleStop} variant="ghost" size="icon" className="text-red-400 hover:text-red-300 flex-shrink-0" data-testid="button-stop">
                <X className="w-5 h-5" />
              </Button>
            ) : (
              <Button onClick={() => handleSend()} disabled={!input.trim() && attachments.length === 0} className="bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white flex-shrink-0" data-testid="button-send">
                <Send className="w-5 h-5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CobaProLayout({ slug }: { slug: string }) {
  const [authenticated, setAuthenticated] = useState(!!getDevmaxToken());
  const tenantId = slug.toLowerCase().replace(/[^a-z0-9]/g, "");
  const tenantName = TENANT_NAMES[tenantId] || tenantId.charAt(0).toUpperCase() + tenantId.slice(1);

  useEffect(() => {
    const token = getDevmaxToken();
    if (token) {
      fetch(`${AUTH_API}/me`, { headers: { "x-devmax-token": token } })
        .then(r => { if (!r.ok) { localStorage.removeItem(DEVMAX_TOKEN_KEY); setAuthenticated(false); } })
        .catch(() => { localStorage.removeItem(DEVMAX_TOKEN_KEY); setAuthenticated(false); });
    }
  }, []);

  if (!authenticated) {
    return <CobaLoginGate onAuth={() => setAuthenticated(true)} />;
  }

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950" data-testid="coba-pro-layout">
      <header className="border-b border-gray-800 px-4 py-3 flex items-center gap-3 bg-gray-900/50 backdrop-blur-sm">
        <a href="/" className="text-gray-400 hover:text-white transition-colors" data-testid="link-home">
          <ArrowLeft className="w-5 h-5" />
        </a>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-lg shadow-orange-500/10">
          <Store className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-white leading-tight">COBA Pro</h1>
          <p className="text-xs text-gray-400 truncate">{tenantName} — Gestion intelligente</p>
        </div>
        <Badge variant="outline" className="border-orange-500/30 text-orange-400 text-xs" data-testid="badge-tenant">
          {tenantId}
        </Badge>
        <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-xs animate-pulse" data-testid="badge-status">
          <Shield className="w-3 h-3 mr-1" />
          Connecté
        </Badge>
      </header>
      <CobaChatPanel tenantId={tenantId} tenantName={tenantName} />
    </div>
  );
}

export default function CobaProPage() {
  const path = window.location.pathname;
  const match = path.match(/^\/pro\/([^/]+)/);
  const slug = match ? match[1] : "";

  if (!slug) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center" data-testid="coba-no-slug">
        <div className="text-center space-y-4">
          <Store className="w-12 h-12 text-gray-600 mx-auto" />
          <h1 className="text-xl text-white font-bold">COBA Pro</h1>
          <p className="text-gray-400">Accédez via /pro/nom-du-restaurant</p>
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={cobaQueryClient}>
      <CobaProLayout slug={slug} />
    </QueryClientProvider>
  );
}
