import { useState, useRef, useEffect, useCallback } from "react";
import { Send, RotateCcw, Zap, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface ChatMessage {
  id: string;
  sender: string;
  senderName: string;
  emoji: string;
  color: string;
  content: string;
  timestamp: number;
  isUser?: boolean;
}

interface StreamingState {
  [key: string]: string;
}

const PERSONA_META: Record<string, { emoji: string; color: string; bg: string; name: string }> = {
  ulysse: { emoji: "🧠", color: "#3b82f6", bg: "from-blue-500/20 to-blue-600/10", name: "Ulysse" },
  iris: { emoji: "🌸", color: "#ec4899", bg: "from-pink-500/20 to-pink-600/10", name: "Iris" },
  alfred: { emoji: "🎩", color: "#f59e0b", bg: "from-amber-500/20 to-amber-600/10", name: "Alfred" },
  maxai: { emoji: "⚡", color: "#8b5cf6", bg: "from-violet-500/20 to-violet-600/10", name: "MaxAI" },
  user: { emoji: "👤", color: "#10b981", bg: "from-emerald-500/20 to-emerald-600/10", name: "Moe" }
};

export default function SuperChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingState, setStreamingState] = useState<StreamingState>({});
  const [activePersonas, setActivePersonas] = useState<string[]>(["ulysse", "iris", "alfred", "maxai"]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingState, scrollToBottom]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: "user",
      senderName: "Moe",
      emoji: "👤",
      color: "#10b981",
      content: text,
      timestamp: Date.now(),
      isUser: true
    };

    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsStreaming(true);
    setStreamingState({});

    try {
      const response = await fetch("/api/superchat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: text, respondents: activePersonas })
      });

      if (!response.ok) throw new Error("Erreur serveur");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No stream");

      const decoder = new TextDecoder();
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
            const data = JSON.parse(line.slice(6));

            if (data.type === "chunk") {
              setStreamingState(prev => ({
                ...prev,
                [data.sender]: (prev[data.sender] || "") + data.content
              }));
            } else if (data.type === "done") {
              setStreamingState(prev => {
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
                timestamp: Date.now()
              }]);
            } else if (data.type === "all_done") {
              setStreamingState({});
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

  const resetConversation = async () => {
    try {
      await apiRequest("POST", "/api/superchat/reset");
      setMessages([]);
      setStreamingState({});
      toast({ title: "SuperChat réinitialisé" });
    } catch {}
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

  return (
    <div className="flex flex-col h-screen bg-background" data-testid="superchat-page">
      <header className="flex items-center justify-between px-4 md:px-6 py-3 border-b border-white/10 glass-panel sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold font-display text-foreground" data-testid="text-superchat-title">SuperChat</h1>
            <p className="text-xs text-muted-foreground">{activePersonas.length} IA connectées</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-1.5 mr-2">
            {Object.entries(PERSONA_META).filter(([k]) => k !== "user").map(([key, meta]) => (
              <button
                key={key}
                onClick={() => togglePersona(key)}
                data-testid={`toggle-persona-${key}`}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                  activePersonas.includes(key)
                    ? "border-white/20 bg-white/10 text-foreground"
                    : "border-white/5 bg-white/3 text-muted-foreground opacity-50"
                }`}
                style={activePersonas.includes(key) ? { borderColor: meta.color + "40" } : {}}
              >
                <span>{meta.emoji}</span>
                <span>{meta.name}</span>
              </button>
            ))}
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={resetConversation}
            className="h-9 w-9 rounded-xl"
            data-testid="button-reset-chat"
          >
            <RotateCcw className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 md:px-6 py-4 ios-scroll" data-testid="superchat-messages">
        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500/20 via-purple-500/20 to-pink-500/20 flex items-center justify-center mb-6 border border-white/10">
              <Zap className="w-10 h-10 text-purple-400" />
            </div>
            <h2 className="text-2xl font-bold font-display text-foreground mb-2">SuperChat</h2>
            <p className="text-muted-foreground max-w-md mb-6">
              Parle à toutes tes IA en même temps. Ulysse, Iris, Alfred et MaxAI répondent chacun avec leur personnalité.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {Object.entries(PERSONA_META).filter(([k]) => k !== "user").map(([key, meta]) => (
                <div key={key} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10">
                  <span className="text-lg">{meta.emoji}</span>
                  <span className="text-sm font-medium" style={{ color: meta.color }}>{meta.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => {
          const meta = PERSONA_META[msg.sender] || PERSONA_META.user;
          return (
            <div
              key={msg.id}
              className={`flex gap-3 mb-4 ${msg.isUser ? "flex-row-reverse" : ""}`}
              data-testid={`message-${msg.sender}-${msg.id}`}
            >
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-lg border border-white/10"
                style={{ background: `linear-gradient(135deg, ${meta.color}30, ${meta.color}10)` }}
              >
                {meta.emoji}
              </div>
              <div className={`flex flex-col max-w-[80%] md:max-w-[70%] ${msg.isUser ? "items-end" : ""}`}>
                <span className="text-xs font-medium mb-1 px-1" style={{ color: meta.color }}>
                  {meta.name}
                </span>
                <div
                  className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                    msg.isUser
                      ? "user-bubble"
                      : "bg-white/5 border border-white/10 text-foreground"
                  }`}
                  style={!msg.isUser ? { borderLeftColor: meta.color, borderLeftWidth: "3px" } : {}}
                >
                  {msg.content}
                </div>
              </div>
            </div>
          );
        })}

        {Object.entries(streamingState).map(([sender, content]) => {
          const meta = PERSONA_META[sender] || PERSONA_META.user;
          return (
            <div key={`streaming-${sender}`} className="flex gap-3 mb-4" data-testid={`streaming-${sender}`}>
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-lg border border-white/10 animate-pulse"
                style={{ background: `linear-gradient(135deg, ${meta.color}30, ${meta.color}10)` }}
              >
                {meta.emoji}
              </div>
              <div className="flex flex-col max-w-[80%] md:max-w-[70%]">
                <span className="text-xs font-medium mb-1 px-1" style={{ color: meta.color }}>
                  {meta.name}
                </span>
                <div
                  className="px-4 py-3 rounded-2xl text-sm leading-relaxed bg-white/5 border border-white/10 text-foreground"
                  style={{ borderLeftColor: meta.color, borderLeftWidth: "3px" }}
                >
                  {content}
                  <span className="inline-block w-1.5 h-4 bg-current opacity-50 animate-pulse ml-0.5" />
                </div>
              </div>
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-white/10 glass-panel p-3 md:p-4 safe-area-bottom">
        <div className="flex md:hidden items-center gap-1.5 mb-3 overflow-x-auto scrollbar-hide">
          {Object.entries(PERSONA_META).filter(([k]) => k !== "user").map(([key, meta]) => (
            <button
              key={key}
              onClick={() => togglePersona(key)}
              data-testid={`toggle-persona-mobile-${key}`}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all border shrink-0 ${
                activePersonas.includes(key)
                  ? "border-white/20 bg-white/10 text-foreground"
                  : "border-white/5 bg-white/3 text-muted-foreground opacity-50"
              }`}
            >
              <span>{meta.emoji}</span>
              <span>{meta.name}</span>
            </button>
          ))}
        </div>

        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Parle à toutes tes IA..."
            className="flex-1 min-h-[48px] max-h-[120px] glass-input border-white/10 rounded-2xl text-base px-4 py-3 resize-none overflow-y-auto bg-white/5 focus:outline-none focus:ring-1 focus:ring-primary/50"
            disabled={isStreaming}
            data-testid="input-superchat-message"
          />
          <Button
            onClick={sendMessage}
            disabled={!input.trim() || isStreaming}
            className="h-12 w-12 rounded-2xl bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 hover:opacity-90 transition-opacity shrink-0"
            data-testid="button-send-superchat"
          >
            <Send className="w-5 h-5 text-white" />
          </Button>
        </div>
      </div>
    </div>
  );
}
