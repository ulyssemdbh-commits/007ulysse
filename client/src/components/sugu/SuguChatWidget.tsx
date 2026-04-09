import { useState, useRef, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MessageCircle, X, Send, Loader2, GripVertical, Minimize2, Maximize2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { emitChatSync, getSharedConversationId, setSharedConversationId } from "@/contexts/UlysseChatContext";

interface SuguChatWidgetProps {
  restaurant: "valentine" | "maillane";
  persona: "ulysse" | "alfred";
  accentFrom: string;
  accentTo: string;
  isDark: boolean;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt?: Date;
}

export function SuguChatWidget({ restaurant, persona, accentFrom, accentTo, isDark }: SuguChatWidgetProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [loadedConvId, setLoadedConvId] = useState<number | null>(null);

  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [bubblePos, setBubblePos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [bubbleDragging, setBubbleDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const widgetRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const didDrag = useRef(false);

  const personaLabel = persona === "ulysse" ? "Ulysse" : "Alfred";
  const restaurantLabel = restaurant === "valentine" ? "SUGU Valentine" : "SUGU Maillane";
  const personaEmoji = persona === "ulysse" ? "U" : "A";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamContent]);

  useEffect(() => {
    if (open && !minimized) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, minimized]);

  useEffect(() => {
    if (!open) return;
    const convId = getSharedConversationId();
    if (convId && convId !== loadedConvId) {
      setLoadedConvId(convId);
      fetch(`/api/conversations/${convId}`, { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.messages) {
            setMessages(data.messages.map((m: any) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
              createdAt: m.createdAt ? new Date(m.createdAt) : undefined,
            })));
          }
        })
        .catch(() => {});
    }
  }, [open, loadedConvId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.conversationId && detail.source !== "sugu") {
        const convId = detail.conversationId;
        fetch(`/api/conversations/${convId}`, { credentials: "include" })
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data?.messages) {
              setLoadedConvId(convId);
              setMessages(data.messages.map((m: any) => ({
                role: m.role as "user" | "assistant",
                content: m.content,
                createdAt: m.createdAt ? new Date(m.createdAt) : undefined,
              })));
            }
          })
          .catch(() => {});
      }
    };
    window.addEventListener("ulysse:chat-sync", handler);
    return () => window.removeEventListener("ulysse:chat-sync", handler);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!widgetRef.current) return;
    setDragging(true);
    const rect = widgetRef.current.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.preventDefault();
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = widgetRef.current?.offsetWidth || 380;
      const h = widgetRef.current?.offsetHeight || 500;
      let newX = e.clientX - dragOffset.current.x;
      let newY = e.clientY - dragOffset.current.y;
      newX = Math.max(0, Math.min(vw - w, newX));
      newY = Math.max(0, Math.min(vh - h, newY));
      setPos({ x: newX, y: newY });
    };
    const handleUp = () => setDragging(false);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragging]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!widgetRef.current) return;
    setDragging(true);
    const touch = e.touches[0];
    const rect = widgetRef.current.getBoundingClientRect();
    dragOffset.current = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = widgetRef.current?.offsetWidth || 380;
      const h = widgetRef.current?.offsetHeight || 500;
      let newX = touch.clientX - dragOffset.current.x;
      let newY = touch.clientY - dragOffset.current.y;
      newX = Math.max(0, Math.min(vw - w, newX));
      newY = Math.max(0, Math.min(vh - h, newY));
      setPos({ x: newX, y: newY });
    };
    const handleTouchEnd = () => setDragging(false);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);
    return () => {
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [dragging]);

  const handleBubbleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!bubbleRef.current) return;
    didDrag.current = false;
    setBubbleDragging(true);
    const rect = bubbleRef.current.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.preventDefault();
  }, []);

  const handleBubbleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!bubbleRef.current) return;
    didDrag.current = false;
    setBubbleDragging(true);
    const touch = e.touches[0];
    const rect = bubbleRef.current.getBoundingClientRect();
    dragOffset.current = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  }, []);

  useEffect(() => {
    if (!bubbleDragging) return;
    const size = 56;
    const handleMove = (e: MouseEvent) => {
      didDrag.current = true;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let newX = e.clientX - dragOffset.current.x;
      let newY = e.clientY - dragOffset.current.y;
      newX = Math.max(0, Math.min(vw - size, newX));
      newY = Math.max(0, Math.min(vh - size, newY));
      setBubblePos({ x: newX, y: newY });
    };
    const handleTouchMove = (e: TouchEvent) => {
      didDrag.current = true;
      const touch = e.touches[0];
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let newX = touch.clientX - dragOffset.current.x;
      let newY = touch.clientY - dragOffset.current.y;
      newX = Math.max(0, Math.min(vw - size, newX));
      newY = Math.max(0, Math.min(vh - size, newY));
      setBubblePos({ x: newX, y: newY });
    };
    const handleUp = () => {
      setBubbleDragging(false);
      if (!didDrag.current) {
        setOpen(true);
      }
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleUp);
    };
  }, [bubbleDragging]);

  const sendMessage = async () => {
    const msg = input.trim();
    if (!msg || streaming) return;
    setInput("");

    const suguContext = `[CONTEXTE: ${restaurantLabel} — Gestion restaurant ${restaurant === "valentine" ? "Valentine (Marseille)" : "Maillane"}, persona ${personaLabel}]\n`;
    const fullContent = suguContext + msg;

    setMessages(prev => [...prev, { role: "user", content: msg }]);
    setStreaming(true);
    setStreamContent("");

    let convId = getSharedConversationId();

    if (!convId) {
      try {
        const createRes = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ title: "Ulysse Hub" }),
        });
        if (createRes.ok) {
          const newConv = await createRes.json();
          convId = newConv.id;
          setSharedConversationId(convId!);
          setLoadedConvId(convId);
        } else {
          throw new Error("Failed to create conversation");
        }
      } catch {
        setMessages(prev => [...prev, { role: "assistant", content: "Erreur de connexion. Réessaie." }]);
        setStreaming(false);
        return;
      }
    }

    try {
      const res = await fetch(`/api/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          content: fullContent,
          contextHints: {
            pageContext: {
              pageId: restaurant === "valentine" ? "suguval" : "sugumaillane",
              pageName: restaurant === "valentine" ? "SUGU Valentine" : "SUGU Maillane",
              pageDescription: `Gestion restaurant SUGU ${restaurant === "valentine" ? "Valentine" : "Maillane"} — achats, comptabilité, RH, formations, stocks`,
            },
            suguContext: { restaurant, persona },
          },
        }),
      });

      if (!res.ok) throw new Error("Erreur serveur");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullResponse = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          const lines = text.split("\n\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.content) {
                  fullResponse += data.content;
                  setStreamContent(fullResponse);
                }
              } catch {}
            }
          }
        }
      }

      if (fullResponse) {
        setMessages(prev => [...prev, { role: "assistant", content: fullResponse }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Erreur de connexion. Réessaie." }]);
    } finally {
      setStreaming(false);
      setStreamContent("");
      if (convId) {
        emitChatSync(convId, "sugu");
        queryClient.invalidateQueries({ queryKey: ["/api/conversations", convId] });
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!open) {
    const useBubbleAbsolute = bubblePos.x !== 0 || bubblePos.y !== 0;
    const bubbleStyle: React.CSSProperties = useBubbleAbsolute
      ? { position: "fixed", left: bubblePos.x, top: bubblePos.y, zIndex: 300 }
      : { position: "fixed", bottom: 24, right: 24, zIndex: 300 };
    return (
      <button
        ref={bubbleRef}
        data-testid="button-open-sugu-chat"
        onMouseDown={handleBubbleMouseDown}
        onTouchStart={handleBubbleTouchStart}
        style={bubbleStyle}
        className={`w-14 h-14 rounded-full bg-gradient-to-br ${accentFrom} ${accentTo} text-white shadow-lg hover:scale-110 transition-transform flex items-center justify-center cursor-grab active:cursor-grabbing ${bubbleDragging ? "select-none scale-110" : ""}`}
        title={`Chat ${personaLabel} — maintenir pour déplacer`}
      >
        <MessageCircle className="w-6 h-6" />
      </button>
    );
  }

  const useAbsolute = pos.x !== 0 || pos.y !== 0;
  const widgetStyle: React.CSSProperties = useAbsolute
    ? { position: "fixed", left: pos.x, top: pos.y, zIndex: 400 }
    : { position: "fixed", bottom: 24, right: 24, zIndex: 400 };

  return (
    <div
      ref={widgetRef}
      style={widgetStyle}
      className={`w-[380px] max-w-[calc(100vw-32px)] ${minimized ? "" : "h-[520px]"} flex flex-col rounded-2xl shadow-2xl border overflow-hidden ${isDark ? "bg-slate-900 border-white/10" : "bg-white border-slate-200"} ${dragging ? "select-none" : ""}`}
    >
      <div
        className={`flex items-center gap-2 px-4 py-3 cursor-grab active:cursor-grabbing bg-gradient-to-r ${accentFrom} ${accentTo} text-white shrink-0`}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        <GripVertical className="w-4 h-4 opacity-60" />
        <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center font-bold text-sm">{personaEmoji}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">Chat {personaLabel}</p>
          <p className="text-xs opacity-75 truncate">{restaurantLabel}</p>
        </div>
        <button
          data-testid="button-minimize-sugu-chat"
          onClick={() => setMinimized(!minimized)}
          className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition"
        >
          {minimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
        </button>
        <button
          data-testid="button-close-sugu-chat"
          onClick={() => setOpen(false)}
          className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {!minimized && (
        <>
          <div className={`flex-1 overflow-y-auto p-3 space-y-3 ${isDark ? "bg-slate-900/80" : "bg-gray-50"}`}>
            {messages.length === 0 && !streaming && (
              <div className={`text-center py-8 ${isDark ? "text-white/30" : "text-slate-400"}`}>
                <div className={`w-12 h-12 mx-auto mb-3 rounded-xl bg-gradient-to-br ${accentFrom} ${accentTo} flex items-center justify-center text-white font-bold text-lg`}>{personaEmoji}</div>
                <p className="text-sm font-medium">Bonjour ! Je suis {personaLabel}.</p>
                <p className="text-xs mt-1">Pose-moi une question sur {restaurantLabel}.</p>
                <p className="text-xs mt-0.5 opacity-70">TVA, salaires, HACCP, comptabilité...</p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  data-testid={`chat-message-${m.role}-${i}`}
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    m.role === "user"
                      ? `bg-gradient-to-br ${accentFrom} ${accentTo} text-white`
                      : isDark ? "bg-white/5 border border-white/10 text-white/90" : "bg-white border border-slate-200 text-slate-800"
                  }`}
                >
                  {m.role === "assistant" ? (
                    <ReactMarkdown
                      components={{
                        p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
                        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                        ul: ({ children }) => <ul className="list-disc list-inside mb-1.5 space-y-0.5">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal list-inside mb-1.5 space-y-0.5">{children}</ol>,
                        li: ({ children }) => <li className="text-sm">{children}</li>,
                      }}
                    >
                      {m.content}
                    </ReactMarkdown>
                  ) : m.content}
                </div>
              </div>
            ))}
            {streaming && streamContent && (
              <div className="flex justify-start">
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${isDark ? "bg-white/5 border border-white/10 text-white/90" : "bg-white border border-slate-200 text-slate-800"}`}>
                  <ReactMarkdown
                    components={{
                      p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
                    }}
                  >
                    {streamContent}
                  </ReactMarkdown>
                  <span className="inline-block w-2 h-4 bg-current opacity-50 animate-pulse ml-0.5" />
                </div>
              </div>
            )}
            {streaming && !streamContent && (
              <div className="flex justify-start">
                <div className={`rounded-2xl px-3.5 py-2.5 ${isDark ? "bg-white/5 border border-white/10" : "bg-white border border-slate-200"}`}>
                  <Loader2 className={`w-4 h-4 animate-spin ${isDark ? "text-white/50" : "text-slate-400"}`} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className={`shrink-0 p-3 border-t ${isDark ? "border-white/10 bg-slate-900" : "border-slate-200 bg-white"}`}>
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                data-testid="input-sugu-chat"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Message ${personaLabel}...`}
                rows={1}
                className={`flex-1 resize-none rounded-xl px-3 py-2 text-sm outline-none transition ${isDark ? "bg-white/5 border border-white/10 text-white placeholder-white/30 focus:border-white/20" : "bg-gray-50 border border-slate-200 text-slate-800 placeholder-slate-400 focus:border-slate-300"}`}
                style={{ maxHeight: 80 }}
                disabled={streaming}
              />
              <button
                data-testid="button-send-sugu-chat"
                onClick={sendMessage}
                disabled={!input.trim() || streaming}
                className={`p-2.5 rounded-xl transition bg-gradient-to-br ${accentFrom} ${accentTo} text-white disabled:opacity-40 hover:opacity-90`}
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
