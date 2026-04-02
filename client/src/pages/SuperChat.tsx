import { useState, useRef, useEffect, useCallback } from "react";
import { Send, RotateCcw, Zap, Users, Plus, MessageSquare, Trash2, X, Reply, ChevronRight, PanelLeftClose, PanelLeft, Crown, ArrowLeft, Monitor, MonitorOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ToolExecution {
  name: string;
  args?: any;
  success?: boolean;
  error?: string;
  duration?: number;
}

interface ChatMessage {
  id: string | number;
  sender: string;
  senderName: string;
  emoji: string;
  color: string;
  content: string;
  timestamp: number;
  isUser?: boolean;
  isSynthesis?: boolean;
  toolCalls?: ToolExecution[];
}

interface StreamingState {
  [key: string]: string;
}

interface Session {
  id: number;
  title: string;
  messageCount: number;
  lastMessageAt: string;
  createdAt: string;
}

interface ReplyTarget {
  sender: string;
  senderName: string;
  emoji: string;
  content: string;
}

const PERSONA_META: Record<string, { emoji: string; color: string; bg: string; name: string; role: string }> = {
  ulysse: { emoji: "🧠", color: "#3b82f6", bg: "from-blue-500/20 to-blue-600/10", name: "Ulysse", role: "Chef de groupe" },
  iris: { emoji: "🌸", color: "#ec4899", bg: "from-pink-500/20 to-pink-600/10", name: "Iris", role: "Famille & Bien-être" },
  alfred: { emoji: "🎩", color: "#f59e0b", bg: "from-amber-500/20 to-amber-600/10", name: "Alfred", role: "Business SUGU" },
  maxai: { emoji: "⚡", color: "#8b5cf6", bg: "from-violet-500/20 to-violet-600/10", name: "MaxAI", role: "DevOps & Tech" },
  user: { emoji: "👤", color: "#10b981", bg: "from-emerald-500/20 to-emerald-600/10", name: "Moe", role: "Patron" }
};

const QUICK_ACTIONS = [
  { label: "Résume la discussion", prompt: "Fais un résumé clair et structuré de toute notre discussion jusqu'ici." },
  { label: "Plan d'action", prompt: "Propose un plan d'action concret avec les prochaines étapes, responsable et deadline pour chaque point." },
  { label: "Qui fait quoi ?", prompt: "Récapitule qui est responsable de quoi dans ce qu'on a discuté. Sois précis." },
  { label: "Points de blocage", prompt: "Identifie les points de blocage, risques ou zones d'ombre dans notre discussion." },
  { label: "Idées créatives", prompt: "Propose 3 idées créatives ou angles inattendus sur le sujet qu'on discute." },
];

function MarkdownContent({ content, color }: { content: string; color?: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        ul: ({ children }) => <ul className="list-disc list-inside mb-1.5 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-inside mb-1.5 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li className="text-sm">{children}</li>,
        code: ({ children, className }) => {
          const isInline = !className;
          return isInline
            ? <code className="bg-white/10 px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>
            : <code className="block bg-black/30 p-3 rounded-lg text-xs font-mono overflow-x-auto mb-1.5 whitespace-pre-wrap">{children}</code>;
        },
        pre: ({ children }) => <pre className="mb-1.5">{children}</pre>,
        blockquote: ({ children }) => <blockquote className="border-l-2 border-white/20 pl-3 italic text-white/60 mb-1.5">{children}</blockquote>,
        h1: ({ children }) => <h1 className="text-base font-bold mb-1">{children}</h1>,
        h2: ({ children }) => <h2 className="text-sm font-bold mb-1">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold mb-1">{children}</h3>,
        a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline hover:text-blue-300">{children}</a>,
        table: ({ children }) => <div className="overflow-x-auto mb-1.5"><table className="min-w-full text-xs border-collapse">{children}</table></div>,
        th: ({ children }) => <th className="border border-white/10 px-2 py-1 text-left font-semibold bg-white/5">{children}</th>,
        td: ({ children }) => <td className="border border-white/10 px-2 py-1">{children}</td>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export default function SuperChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Read URL params for deep-linking (e.g. from Commax Iris widget)
  const urlParams = new URLSearchParams(window.location.search);
  const initPersona = urlParams.get("persona");
  const initMsg = urlParams.get("msg") || "";

  const [input, setInput] = useState(initMsg);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingState, setStreamingState] = useState<StreamingState>({});
  const [toolActivity, setToolActivity] = useState<Record<string, ToolExecution[]>>({});
  const toolActivityRef = useRef<Record<string, ToolExecution[]>>({});
  const [activePersonas, setActivePersonas] = useState<string[]>(
    initPersona && Object.keys(PERSONA_META).includes(initPersona) ? [initPersona] : ["ulysse", "iris", "alfred", "maxai"]
  );
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [monitoringActive, setMonitoringActive] = useState(() => {
    try { return localStorage.getItem("superchat_monitoring") === "true"; } catch { return false; }
  });
  const [screenStatus, setScreenStatus] = useState<{
    connected: boolean; capable: boolean; controlEnabled: boolean;
    activeApp: string | null; activeWindow: string | null;
    frameAge: number | null; context: string | null; timestamp: number;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!monitoringActive) { setScreenStatus(null); return; }
    let evtSource: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout>;
    const connect = () => {
      evtSource = new EventSource("/api/superchat/screen-stream");
      evtSource.onmessage = (e) => {
        try { setScreenStatus(JSON.parse(e.data)); } catch {}
      };
      evtSource.onerror = () => {
        evtSource?.close();
        retryTimer = setTimeout(connect, 5000);
      };
    };
    connect();
    return () => { evtSource?.close(); clearTimeout(retryTimer); };
  }, [monitoringActive]);

  useEffect(() => { toolActivityRef.current = toolActivity; }, [toolActivity]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<Session[]>({
    queryKey: ["/api/superchat/sessions"],
  });

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingState, scrollToBottom]);

  const loadSession = async (sessionId: number) => {
    try {
      const res = await fetch(`/api/superchat/sessions/${sessionId}/messages`, { credentials: "include" });
      if (!res.ok) throw new Error("Erreur chargement session");
      const msgs = await res.json();

      const loaded: ChatMessage[] = msgs.map((m: any) => {
        const meta = PERSONA_META[m.sender] || PERSONA_META.user;
        return {
          id: m.id,
          sender: m.sender,
          senderName: m.senderName,
          emoji: meta.emoji,
          color: meta.color,
          content: m.content,
          timestamp: new Date(m.createdAt).getTime(),
          isUser: m.sender === "user",
          isSynthesis: false,
        };
      });

      setMessages(loaded);
      setCurrentSessionId(sessionId);
      setSidebarOpen(false);
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    }
  };

  const deleteSession = async (sessionId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiRequest("DELETE", `/api/superchat/sessions/${sessionId}`);
      queryClient.invalidateQueries({ queryKey: ["/api/superchat/sessions"] });
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
        setMessages([]);
      }
      toast({ title: "Session supprimée" });
    } catch {}
  };

  const lastAutoLoadRef = useRef<boolean>(false);
  useEffect(() => {
    if (sessions.length > 0 && currentSessionId === null && !lastAutoLoadRef.current && messages.length === 0) {
      lastAutoLoadRef.current = true;
      const latest = sessions[0];
      loadSession(latest.id);
    }
  }, [sessions, currentSessionId, messages.length]);

  const newSession = () => {
    setCurrentSessionId(null);
    setMessages([]);
    setStreamingState({});
    setReplyTarget(null);
    setSidebarOpen(false);
    lastAutoLoadRef.current = true;
  };

  const sendMessage = async (text?: string) => {
    const msgText = (text || input).trim();
    if (!msgText || isStreaming) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: "user",
      senderName: "Moe",
      emoji: "👤",
      color: "#10b981",
      content: msgText,
      timestamp: Date.now(),
      isUser: true
    };

    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsStreaming(true);
    setStreamingState({});

    const replyPayload = replyTarget ? {
      sender: replyTarget.sender,
      senderName: replyTarget.senderName,
      emoji: replyTarget.emoji,
      content: replyTarget.content,
    } : undefined;
    setReplyTarget(null);

    try {
      const response = await fetch("/api/superchat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: msgText,
          respondents: activePersonas,
          sessionId: currentSessionId,
          replyTo: replyPayload,
          monitoringActive,
        })
      });

      if (!response.ok) throw new Error("Erreur serveur");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let lastSender = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === "session" && data.sessionId) {
              setCurrentSessionId(data.sessionId);
            } else if (data.type === "tool_call") {
              setToolActivity(prev => ({
                ...prev,
                [data.sender]: [...(prev[data.sender] || []), { name: data.toolName, args: data.toolArgs }]
              }));
            } else if (data.type === "tool_result") {
              setToolActivity(prev => {
                const calls = prev[data.sender] || [];
                const updated = calls.map(tc =>
                  tc.name === data.toolName && tc.success === undefined
                    ? { ...tc, success: data.success, error: data.error, duration: data.duration }
                    : tc
                );
                return { ...prev, [data.sender]: updated };
              });
            } else if (data.type === "chunk") {
              setStreamingState(prev => ({
                ...prev,
                [data.sender]: (prev[data.sender] || "") + data.content
              }));
              lastSender = data.sender;
            } else if (data.type === "done") {
              setStreamingState(prev => {
                const next = { ...prev };
                delete next[data.sender];
                return next;
              });
              const senderTools = toolActivityRef.current[data.sender] || [];
              setToolActivity(prev => {
                const next = { ...prev };
                delete next[data.sender];
                return next;
              });
              setMessages(prev => [...prev, {
                id: `${data.sender}-${Date.now()}`,
                sender: data.sender,
                senderName: data.senderName,
                emoji: data.emoji,
                color: data.color,
                content: data.content,
                timestamp: Date.now(),
                isSynthesis: data.sender === "ulysse" && lastSender === data.sender,
                toolCalls: senderTools.length > 0 ? senderTools : undefined,
              }]);
            } else if (data.type === "all_done") {
              setStreamingState({});
              setToolActivity({});
              queryClient.invalidateQueries({ queryKey: ["/api/superchat/sessions"] });
            }
          } catch {}
        }
      }
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally {
      setIsStreaming(false);
      setStreamingState({});
    }
  };

  const handleReply = (msg: ChatMessage) => {
    if (msg.isUser) return;
    setReplyTarget({
      sender: msg.sender,
      senderName: msg.senderName,
      emoji: msg.emoji,
      content: msg.content,
    });
    inputRef.current?.focus();
  };

  const togglePersona = (id: string) => {
    setActivePersonas(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const currentSession = sessions.find(s => s.id === currentSessionId);

  return (
    <div className="flex h-screen bg-background" data-testid="superchat-page">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
          data-testid="sidebar-overlay"
        />
      )}

      <div
        className={`fixed md:relative z-50 md:z-auto h-full flex flex-col bg-[#0a0a12] border-r border-white/10 transition-all duration-200 ${
          sidebarOpen ? "w-72 translate-x-0" : "w-0 -translate-x-full md:w-0 md:-translate-x-0"
        } overflow-hidden`}
        data-testid="superchat-sidebar"
      >
        <div className="flex items-center justify-between p-3 border-b border-white/10 min-w-[288px]">
          <span className="text-sm font-semibold text-foreground">Sessions</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={newSession} data-testid="button-new-session">
              <Plus className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={() => setSidebarOpen(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1 min-w-[288px]">
          {sessionsLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">Aucune session</p>
          ) : (
            sessions.map(s => (
              <div
                key={s.id}
                onClick={() => loadSession(s.id)}
                role="button"
                tabIndex={0}
                data-testid={`session-item-${s.id}`}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all group cursor-pointer ${
                  currentSessionId === s.id
                    ? "bg-white/10 border border-white/15"
                    : "hover:bg-white/5 border border-transparent"
                }`}
              >
                <MessageSquare className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{s.title}</p>
                  <p className="text-[10px] text-muted-foreground">{s.messageCount} msgs</p>
                </div>
                <button
                  onClick={(e) => deleteSession(s.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-all"
                  data-testid={`button-delete-session-${s.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between px-3 md:px-5 py-2.5 border-b border-white/10 glass-panel sticky top-0 z-30">
          <div className="flex items-center gap-2.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-xl"
              onClick={() => window.location.href = "/"}
              data-testid="button-back-dashboard"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-xl"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              data-testid="button-toggle-sidebar"
            >
              {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
            </Button>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg">
              <Users className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold font-display text-foreground" data-testid="text-superchat-title">
                {currentSession ? currentSession.title : "SuperChat"}
              </h1>
              <p className="text-[11px] text-muted-foreground">{activePersonas.length} IA connectées</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="hidden md:flex items-center gap-1 mr-1">
              {Object.entries(PERSONA_META).filter(([k]) => k !== "user").map(([key, meta]) => (
                <button
                  key={key}
                  onClick={() => togglePersona(key)}
                  data-testid={`toggle-persona-${key}`}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all border ${
                    activePersonas.includes(key)
                      ? "border-white/15 bg-white/8 text-foreground"
                      : "border-white/5 bg-white/[0.02] text-muted-foreground opacity-40"
                  }`}
                  style={activePersonas.includes(key) ? { borderColor: meta.color + "30" } : {}}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${activePersonas.includes(key) ? "bg-green-400" : "bg-white/20"}`} />
                  <span>{meta.emoji}</span>
                  <span>{meta.name}</span>
                </button>
              ))}
            </div>

            <button
              onClick={() => {
                const next = !monitoringActive;
                setMonitoringActive(next);
                try { localStorage.setItem("superchat_monitoring", String(next)); } catch {}
              }}
              data-testid="button-toggle-monitoring"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all border ${
                monitoringActive
                  ? "border-green-500/30 bg-green-500/10 text-green-400"
                  : "border-white/5 bg-white/[0.02] text-muted-foreground opacity-50 hover:opacity-80"
              }`}
              title={monitoringActive ? "Monitoring actif — cliquer pour désactiver" : "Activer le monitoring écran"}
            >
              {monitoringActive ? <Monitor className="w-3.5 h-3.5" /> : <MonitorOff className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{monitoringActive ? "Monitoring" : "Monitor"}</span>
              {monitoringActive && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
            </button>

            <Button variant="ghost" size="icon" onClick={newSession} className="h-8 w-8 rounded-lg" data-testid="button-new-chat">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </header>

        {monitoringActive && screenStatus && (
          <div
            className={`flex items-center gap-2 px-3 md:px-5 py-2 border-b text-[11px] transition-all ${
              screenStatus.connected
                ? "border-green-500/20 bg-green-500/5"
                : "border-red-500/20 bg-red-500/5"
            }`}
            data-testid="monitoring-live-bar"
          >
            <div className={`w-2 h-2 rounded-full shrink-0 ${screenStatus.connected ? "bg-green-400 animate-pulse" : "bg-red-400"}`} />
            <Monitor className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            {screenStatus.connected ? (
              <>
                <span className="text-green-400 font-medium shrink-0">LIVE</span>
                <span className="text-muted-foreground">|</span>
                <span className="text-foreground truncate">
                  {screenStatus.activeApp || "Bureau"}
                  {screenStatus.activeWindow ? ` — ${screenStatus.activeWindow}` : ""}
                </span>
                {screenStatus.frameAge !== null && (
                  <>
                    <span className="text-muted-foreground">|</span>
                    <span className="text-muted-foreground shrink-0">
                      {screenStatus.frameAge < 5 ? "⚡ temps réel" : `il y a ${screenStatus.frameAge}s`}
                    </span>
                  </>
                )}
                {screenStatus.controlEnabled && (
                  <span className="ml-auto px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-400 border border-violet-500/30 shrink-0">
                    Prise en main
                  </span>
                )}
              </>
            ) : (
              <span className="text-red-400">Agent déconnecté — lancer ulysse_screen_agent.py</span>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 md:px-5 py-4 ios-scroll" data-testid="superchat-messages">
          {messages.length === 0 && !isStreaming && (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 via-purple-500/20 to-pink-500/20 flex items-center justify-center mb-5 border border-white/10">
                <Zap className="w-8 h-8 text-purple-400" />
              </div>
              <h2 className="text-xl font-bold font-display text-foreground mb-1.5">SuperChat</h2>
              <p className="text-sm text-muted-foreground max-w-sm mb-5">
                Parle simultanément à tes 4 IA. Ulysse conclut toujours avec une synthèse.
              </p>
              <div className="flex flex-wrap justify-center gap-2 mb-6">
                {Object.entries(PERSONA_META).filter(([k]) => k !== "user").map(([key, meta]) => (
                  <div key={key} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10">
                    <span className="text-base">{meta.emoji}</span>
                    <div className="text-left">
                      <span className="text-xs font-semibold block" style={{ color: meta.color }}>{meta.name}</span>
                      <span className="text-[10px] text-muted-foreground">{meta.role}</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mb-3">Actions rapides :</p>
              <div className="flex flex-wrap justify-center gap-2">
                {QUICK_ACTIONS.slice(0, 3).map((qa, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(qa.prompt)}
                    data-testid={`quick-action-empty-${i}`}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-muted-foreground hover:bg-white/10 hover:text-foreground transition-all"
                  >
                    <ChevronRight className="w-3 h-3" />
                    {qa.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => {
            const meta = PERSONA_META[msg.sender] || PERSONA_META.user;
            const isLastUlysse = msg.sender === "ulysse" && !msg.isUser;
            const ulysseMessages = messages.filter(m => m.sender === "ulysse" && !m.isUser);
            const isLatestUlysse = isLastUlysse && ulysseMessages[ulysseMessages.length - 1]?.id === msg.id;
            const showSynthesisBadge = isLatestUlysse && messages.filter(m => !m.isUser).length > 1;

            return (
              <div
                key={msg.id}
                className={`group flex gap-2.5 mb-3 ${msg.isUser ? "flex-row-reverse" : ""}`}
                data-testid={`message-${msg.sender}-${msg.id}`}
              >
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-base border border-white/10"
                  style={{ background: `linear-gradient(135deg, ${meta.color}25, ${meta.color}08)` }}
                >
                  {meta.emoji}
                </div>
                <div className={`flex flex-col max-w-[82%] md:max-w-[72%] ${msg.isUser ? "items-end" : ""}`}>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[11px] font-semibold" style={{ color: meta.color }}>{meta.name}</span>
                    {showSynthesisBadge && (
                      <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
                        <Crown className="w-2.5 h-2.5" /> SYNTHÈSE
                      </span>
                    )}
                  </div>
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="mb-1.5 space-y-1" data-testid={`tools-${msg.id}`}>
                      {msg.toolCalls.map((tc, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-lg bg-white/5 border border-white/8">
                          <span>{tc.success ? "✅" : tc.success === false ? "❌" : "⏳"}</span>
                          <span className="font-mono opacity-70">{tc.name}</span>
                          {tc.duration !== undefined && (
                            <span className="opacity-40">{tc.duration}ms</span>
                          )}
                          {tc.error && <span className="text-red-400 truncate max-w-[200px]">{tc.error}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  <div
                    className={`px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed ${
                      msg.isUser
                        ? "user-bubble"
                        : showSynthesisBadge
                          ? "bg-blue-500/8 border-2 border-blue-500/20 text-foreground"
                          : "bg-white/5 border border-white/10 text-foreground"
                    }`}
                    style={!msg.isUser && !showSynthesisBadge ? { borderLeftColor: meta.color, borderLeftWidth: "3px" } : {}}
                  >
                    {msg.isUser ? msg.content : <MarkdownContent content={msg.content} color={meta.color} />}
                  </div>
                  {!msg.isUser && (
                    <button
                      onClick={() => handleReply(msg)}
                      className="flex items-center gap-1 mt-1 px-2 py-0.5 rounded-lg text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-white/5 hover:text-foreground transition-all"
                      data-testid={`button-reply-${msg.id}`}
                    >
                      <Reply className="w-3 h-3" />
                      Répondre à {meta.name}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {Object.entries(toolActivity).map(([sender, tools]) => {
            if (streamingState[sender]) return null;
            const meta = PERSONA_META[sender] || PERSONA_META.user;
            return (
              <div key={`tool-activity-${sender}`} className="flex gap-2.5 mb-3" data-testid={`tool-activity-${sender}`}>
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-base border border-white/10 animate-pulse"
                  style={{ background: `linear-gradient(135deg, ${meta.color}25, ${meta.color}08)` }}
                >
                  {meta.emoji}
                </div>
                <div className="flex flex-col max-w-[82%] md:max-w-[72%]">
                  <span className="text-[11px] font-semibold mb-0.5" style={{ color: meta.color }}>{meta.name}</span>
                  <div className="space-y-1">
                    {tools.map((tc, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-lg bg-white/5 border border-white/8 animate-pulse">
                        <span>{tc.success === true ? "✅" : tc.success === false ? "❌" : "🔧"}</span>
                        <span className="font-mono opacity-70">{tc.name}</span>
                        {tc.success === undefined && <span className="opacity-40">exécution...</span>}
                        {tc.duration !== undefined && <span className="opacity-40">{tc.duration}ms</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}

          {Object.entries(streamingState).map(([sender, content]) => {
            const meta = PERSONA_META[sender] || PERSONA_META.user;
            const senderTools = toolActivity[sender] || [];
            return (
              <div key={`streaming-${sender}`} className="flex gap-2.5 mb-3" data-testid={`streaming-${sender}`}>
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-base border border-white/10 animate-pulse"
                  style={{ background: `linear-gradient(135deg, ${meta.color}25, ${meta.color}08)` }}
                >
                  {meta.emoji}
                </div>
                <div className="flex flex-col max-w-[82%] md:max-w-[72%]">
                  <span className="text-[11px] font-semibold mb-0.5" style={{ color: meta.color }}>{meta.name}</span>
                  {senderTools.length > 0 && (
                    <div className="space-y-1 mb-1.5">
                      {senderTools.map((tc, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-lg bg-white/5 border border-white/8">
                          <span>{tc.success ? "✅" : tc.success === false ? "❌" : "⏳"}</span>
                          <span className="font-mono opacity-70">{tc.name}</span>
                          {tc.duration !== undefined && <span className="opacity-40">{tc.duration}ms</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  <div
                    className="px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed bg-white/5 border border-white/10 text-foreground"
                    style={{ borderLeftColor: meta.color, borderLeftWidth: "3px" }}
                  >
                    <MarkdownContent content={content} color={meta.color} />
                    <span className="inline-block w-1.5 h-4 bg-current opacity-50 animate-pulse ml-0.5" />
                  </div>
                </div>
              </div>
            );
          })}

          <div ref={messagesEndRef} />
        </div>

        <div className="border-t border-white/10 glass-panel p-3 md:p-4 safe-area-bottom">
          <div className="flex md:hidden items-center gap-1.5 mb-2.5 overflow-x-auto scrollbar-hide">
            {Object.entries(PERSONA_META).filter(([k]) => k !== "user").map(([key, meta]) => (
              <button
                key={key}
                onClick={() => togglePersona(key)}
                data-testid={`toggle-persona-mobile-${key}`}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all border shrink-0 ${
                  activePersonas.includes(key)
                    ? "border-white/15 bg-white/8 text-foreground"
                    : "border-white/5 bg-white/[0.02] text-muted-foreground opacity-40"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${activePersonas.includes(key) ? "bg-green-400" : "bg-white/20"}`} />
                <span>{meta.emoji}</span>
                <span>{meta.name}</span>
              </button>
            ))}
          </div>

          {messages.length > 0 && !isStreaming && (
            <div className="flex gap-1.5 mb-2.5 overflow-x-auto scrollbar-hide pb-0.5">
              {QUICK_ACTIONS.map((qa, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(qa.prompt)}
                  data-testid={`quick-action-${i}`}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[11px] text-muted-foreground hover:bg-white/10 hover:text-foreground transition-all whitespace-nowrap shrink-0"
                >
                  <ChevronRight className="w-3 h-3" />
                  {qa.label}
                </button>
              ))}
            </div>
          )}

          {replyTarget && (
            <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10" data-testid="reply-target-bar">
              <Reply className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-[11px] font-semibold" style={{ color: PERSONA_META[replyTarget.sender]?.color }}>
                  {replyTarget.emoji} {replyTarget.senderName}
                </span>
                <p className="text-[11px] text-muted-foreground truncate">{replyTarget.content}</p>
              </div>
              <button
                onClick={() => setReplyTarget(null)}
                className="p-1 rounded hover:bg-white/10 text-muted-foreground"
                data-testid="button-cancel-reply"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={replyTarget ? `Répondre à ${replyTarget.senderName}...` : "Parle à toutes tes IA... (@iris, @alfred pour cibler)"}
              className="flex-1 min-h-[44px] max-h-[120px] glass-input border-white/10 rounded-2xl text-sm px-4 py-3 resize-none overflow-y-auto bg-white/5 focus:outline-none focus:ring-1 focus:ring-primary/50"
              disabled={isStreaming}
              data-testid="input-superchat-message"
            />
            <Button
              onClick={() => sendMessage()}
              disabled={!input.trim() || isStreaming}
              className="h-11 w-11 rounded-2xl bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 hover:opacity-90 transition-opacity shrink-0"
              data-testid="button-send-superchat"
            >
              <Send className="w-4.5 h-4.5 text-white" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground/50 mt-1.5 text-center">
            Entrée pour envoyer · Shift+Entrée pour nouvelle ligne · @nom pour cibler une IA
          </p>
        </div>
      </div>
    </div>
  );
}
