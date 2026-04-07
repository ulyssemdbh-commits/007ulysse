import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { PlatformBadge } from "./config";
import {
  Loader2,
  Send,
  ChevronRight,
  Trash2,
  X,
  Calendar,
  Twitter,
  Instagram,
  Tag,
  MessageCircle,
} from "lucide-react";

export function MiniIrisChat({ open, onClose, initialMsg }: { open: boolean; onClose: () => void; initialMsg?: string }) {
  const [messages, setMessages] = useState<MiniMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastSentMsg = useRef<string | null>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    const greeting = initialMsg || "Bonjour Iris ! Je suis sur Commax et je suis prête à travailler avec toi. Qu'est-ce qu'on fait aujourd'hui ?";
    if (greeting !== lastSentMsg.current) {
      lastSentMsg.current = greeting;
      sendMessage(greeting, true);
    }
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [open, initialMsg]);

  async function sendMessage(text: string, isAuto = false) {
    if (!text.trim() || loading) return;
    if (!isAuto) setInput("");
    setMessages(prev => [...prev, { role: "user", content: text }]);
    setLoading(true);

    const placeholder: MiniMsg = { role: "iris", content: "", streaming: true };
    setMessages(prev => [...prev, placeholder]);

    try {
      const resp = await fetch("/api/superchat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: text,
          respondents: ["iris"],
          sessionId: sessionId || undefined,
        }),
      });

      if (!resp.body) throw new Error("No stream");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "session" && evt.sessionId) setSessionId(evt.sessionId);
            if (evt.type === "chunk" && evt.sender === "iris") {
              accumulated += evt.content || "";
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === "iris") updated[updated.length - 1] = { ...last, content: accumulated, streaming: true };
                return updated;
              });
            }
          } catch {}
        }
      }

      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "iris") updated[updated.length - 1] = { ...last, streaming: false };
        return updated;
      });

      if (accumulated.length > 20) {
        const titleText = text.length > 80 ? text.substring(0, 80) + "…" : text;
        fetch("/api/commax/journal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            type: "session",
            title: `💬 ${titleText}`,
            content: accumulated.substring(0, 600),
            platforms: [],
          }),
        }).catch(() => {});
      }
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "iris") updated[updated.length - 1] = { role: "iris", content: "❌ Erreur de connexion. Réessaie." };
        return updated;
      });
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed bottom-24 right-6 z-50 w-[380px] flex flex-col rounded-2xl border border-pink-500/25 bg-card shadow-2xl shadow-pink-500/15 overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-pink-500/15 to-rose-500/10 border-b border-pink-500/20 flex-shrink-0">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-pink-500 to-rose-500 flex items-center justify-center shadow-sm text-lg">🌸</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white leading-none">Iris</p>
          <p className="text-[11px] text-pink-300/80 mt-0.5">Senior Community Manager · Commax</p>
        </div>
        <span className="w-2 h-2 rounded-full bg-green-400 shadow-sm shadow-green-400/50 flex-shrink-0" />
        <button
          data-testid="button-mini-iris-close"
          onClick={onClose}
          className="ml-1 w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[240px] max-h-[340px]">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted-foreground text-xs">
              <div className="text-2xl mb-2">🌸</div>
              <p>Iris arrive…</p>
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={cn("flex gap-2", msg.role === "user" ? "justify-end" : "justify-start")}>
            {msg.role === "iris" && (
              <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-pink-500 to-rose-500 flex-shrink-0 flex items-center justify-center text-xs mt-0.5">🌸</div>
            )}
            <div className={cn(
              "max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
              msg.role === "user"
                ? "bg-primary text-primary-foreground rounded-tr-sm"
                : "bg-muted text-foreground rounded-tl-sm"
            )}>
              {msg.content || (msg.streaming ? (
                <span className="inline-flex gap-0.5 items-center">
                  <span className="w-1 h-1 bg-pink-400 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1 h-1 bg-pink-400 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1 h-1 bg-pink-400 rounded-full animate-bounce [animation-delay:300ms]" />
                </span>
              ) : "")}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 p-3 border-t border-border/50 bg-card/50 flex-shrink-0">
        <input
          ref={inputRef}
          data-testid="input-mini-iris-chat"
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
          placeholder="Écris à Iris…"
          disabled={loading}
          className="flex-1 text-sm bg-muted/50 border border-border/50 rounded-xl px-3 py-2 focus:outline-none focus:border-pink-500/50 disabled:opacity-60 placeholder:text-muted-foreground/60"
        />
        <button
          data-testid="button-mini-iris-send"
          onClick={() => sendMessage(input)}
          disabled={loading || !input.trim()}
          className="w-9 h-9 rounded-xl bg-gradient-to-tr from-pink-500 to-rose-500 flex items-center justify-center text-white hover:opacity-90 transition-opacity disabled:opacity-40 flex-shrink-0"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

// ─── Iris Gateway Widget ──────────────────────────────────────
export function IrisGateway({ onOpen }: { onOpen: (msg?: string) => void }) {
  const [pulse, setPulse] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setPulse(false), 4000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {pulse && (
        <div className="bg-card border border-pink-500/30 rounded-2xl p-3 shadow-xl shadow-pink-500/10 max-w-[220px] animate-in slide-in-from-bottom-2 duration-500">
          <p className="text-xs text-pink-300 font-medium">🌸 Iris est disponible</p>
          <p className="text-xs text-muted-foreground mt-0.5">Clique pour lui parler ici</p>
        </div>
      )}
      <button
        data-testid="button-iris-gateway"
        onClick={() => onOpen()}
        className="group relative w-14 h-14 rounded-2xl bg-gradient-to-tr from-pink-600 to-rose-500 flex items-center justify-center shadow-lg shadow-pink-500/30 hover:scale-110 transition-all duration-200 hover:shadow-pink-500/50"
        title="Parler à Iris — Community Manager"
      >
        <span className="text-2xl select-none">🌸</span>
        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-green-400 rounded-full border-2 border-background shadow-sm" />
      </button>
    </div>
  );
}

// ─── Iris Delegation Screen (Composer tab) ────────────────────
export function IrisComposerDelegate({ onOpen }: { onOpen: (msg: string) => void }) {
  const actions = [
    { icon: "✍️", label: "Créer un post", msg: "Crée un nouveau post pour mes réseaux sociaux. Demande-moi le sujet, le ton et les plateformes cibles." },
    { icon: "📅", label: "Planifier une campagne", msg: "Je veux planifier une campagne sur les réseaux sociaux. Aide-moi à définir le calendrier éditorial, les plateformes et les messages clés." },
    { icon: "🎯", label: "Idées de contenu", msg: "Propose-moi des idées de contenu créatives et stratégiques pour mes réseaux sociaux cette semaine. Inspire-toi des tendances actuelles." },
    { icon: "📊", label: "Audit stratégique", msg: "Fais un audit de ma stratégie social media actuelle dans Commax et propose des axes d'amélioration." },
    { icon: "💬", label: "Gérer l'inbox", msg: "Vérifie les mentions et commentaires non lus dans Commax et aide-moi à y répondre de façon engageante." },
    { icon: "🔥", label: "Post viral", msg: "Génère un post à fort potentiel viral adapté à chaque plateforme (Twitter, Instagram, LinkedIn, TikTok). Sujet au choix." },
  ];

  return (
    <div className="space-y-6">
      {/* Iris CM Card */}
      <div className="relative overflow-hidden rounded-2xl border border-pink-500/20 bg-gradient-to-br from-pink-500/10 via-rose-500/5 to-transparent p-6">
        <div className="absolute inset-0 bg-gradient-to-br from-pink-600/5 to-transparent pointer-events-none" />
        <div className="relative flex items-start gap-4">
          <div className="w-14 h-14 flex-shrink-0 rounded-2xl bg-gradient-to-tr from-pink-500 to-rose-500 flex items-center justify-center shadow-lg shadow-pink-500/30 text-2xl">
            🌸
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-lg font-bold text-white">Iris</h2>
              <span className="px-2 py-0.5 rounded-full bg-pink-500/20 border border-pink-500/30 text-pink-300 text-xs font-medium">Senior Community Manager</span>
            </div>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Iris gère exclusivement le Commax. Stratégie éditoriale, création de contenu, campagnes, analytics et community management — tout passe par elle. Dis-lui ce que tu veux et elle s'en occupe.
            </p>
            <button
              data-testid="button-open-iris-superchat"
              onClick={() => onOpen("Bonjour Iris ! Je suis sur Commax et j'ai besoin de ton aide pour gérer mes réseaux sociaux.")}
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-pink-500/20 hover:bg-pink-500/30 border border-pink-500/30 text-pink-300 text-sm font-medium transition-all duration-200 hover:scale-105"
            >
              <MessageCircle className="w-4 h-4" />
              Ouvrir le chat Iris
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Actions rapides — déléguer à Iris</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {actions.map((action) => (
            <button
              key={action.label}
              data-testid={`button-iris-action-${action.label.toLowerCase().replace(/\s+/g, "-")}`}
              onClick={() => onOpen(action.msg)}
              className="group flex items-center gap-3 p-4 rounded-xl border border-border/50 bg-card/40 hover:bg-card/70 hover:border-pink-500/30 transition-all duration-200 text-left"
            >
              <span className="text-xl flex-shrink-0">{action.icon}</span>
              <div>
                <p className="text-sm font-medium text-white group-hover:text-pink-200 transition-colors">{action.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{action.msg.substring(0, 50)}…</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-pink-400 ml-auto flex-shrink-0 transition-colors" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Journal Type Config ─────────────────────────────────────
const JOURNAL_TYPES: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  session:         { label: "Session", color: "text-pink-400",   bg: "bg-pink-400/10",   icon: "💬" },
  post_created:    { label: "Post créé", color: "text-blue-400",  bg: "bg-blue-400/10",   icon: "✍️" },
  campaign:        { label: "Campagne", color: "text-purple-400", bg: "bg-purple-400/10", icon: "🚀" },
  mention_replied: { label: "Mention",  color: "text-yellow-400", bg: "bg-yellow-400/10", icon: "💌" },
  content_idea:    { label: "Idée",     color: "text-green-400",  bg: "bg-green-400/10",  icon: "💡" },
  analytics:       { label: "Analytics",color: "text-cyan-400",   bg: "bg-cyan-400/10",   icon: "📊" },
  action:          { label: "Action",   color: "text-orange-400", bg: "bg-orange-400/10", icon: "⚡" },
  note:            { label: "Note",     color: "text-gray-400",   bg: "bg-gray-400/10",   icon: "📝" },
};

export function IrisCmJournal() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: entries = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/commax/journal"],
    refetchInterval: 15000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/commax/journal/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/commax/journal"] });
      toast({ title: "Entrée supprimée" });
    },
  });

  const grouped: Record<string, any[]> = {};
  for (const entry of entries) {
    const day = entry.date || entry.createdAt?.split("T")[0] || "—";
    if (!grouped[day]) grouped[day] = [];
    grouped[day].push(entry);
  }
  const days = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  if (isLoading) {
    return (
      <div className="space-y-3 py-6">
        {[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-pink-500/10 flex items-center justify-center text-3xl">📓</div>
        <div>
          <p className="font-semibold text-white mb-1">Le journal d'Iris est vide</p>
          <p className="text-sm text-muted-foreground max-w-xs">Les activités d'Iris apparaîtront ici automatiquement après chaque session ou action.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {days.map(day => (
        <div key={day}>
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {(() => {
                try { return format(new Date(day), "EEEE d MMMM yyyy", { locale: fr }); } catch { return day; }
              })()}
            </span>
            <div className="flex-1 h-px bg-border/40" />
            <span className="text-xs text-muted-foreground">{grouped[day].length} entrée{grouped[day].length > 1 ? "s" : ""}</span>
          </div>
          <div className="space-y-3">
            {grouped[day].map((entry: any) => {
              const cfg = JOURNAL_TYPES[entry.type] || JOURNAL_TYPES.note;
              return (
                <div
                  key={entry.id}
                  data-testid={`journal-entry-${entry.id}`}
                  className="group relative flex gap-3 p-4 rounded-xl border border-border/50 bg-card/40 hover:bg-card/70 transition-all duration-200"
                >
                  <div className={cn("w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center text-lg", cfg.bg)}>
                    {cfg.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="font-medium text-sm text-white leading-snug line-clamp-2">{entry.title}</p>
                      <button
                        data-testid={`button-delete-journal-${entry.id}`}
                        onClick={() => deleteMut.mutate(entry.id)}
                        className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-all flex-shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{entry.content}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium", cfg.bg, cfg.color)}>
                        <Tag className="w-2.5 h-2.5" />
                        {cfg.label}
                      </span>
                      {(entry.platforms || []).map((p: string) => (
                        <PlatformBadge key={p} platform={p} />
                      ))}
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        {entry.createdAt ? formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true, locale: fr }) : ""}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

