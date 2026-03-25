import { useState, useRef, useEffect, useCallback } from "react";
import { MessageCircle, X, Send, Loader2, GripVertical, Minimize2, Maximize2, Paperclip, Download, Copy, Check, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useUlysseChat } from "@/contexts/UlysseChatContext";
import { FileUpload } from "@/components/FileUpload";
import { useLocation } from "wouter";

export function UlysseChatWidget() {
  const chat = useUlysseChat();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [bubblePos, setBubblePos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [bubbleDragging, setBubbleDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const widgetRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const didDrag = useRef(false);

  useEffect(() => {
    chat.setCurrentPath(location);
  }, [location]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages, chat.streamingContent]);

  useEffect(() => {
    if (open && !minimized) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, minimized]);

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
      const w = widgetRef.current?.offsetWidth || 400;
      const h = widgetRef.current?.offsetHeight || 560;
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
      const w = widgetRef.current?.offsetWidth || 400;
      const h = widgetRef.current?.offsetHeight || 560;
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
      if (!didDrag.current) setOpen(true);
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chat.sendMessage();
    }
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          chat.setPendingFile({
            content: "",
            fileName: `pasted-image-${Date.now()}.png`,
            imageDataUrl: dataUrl,
          });
        };
        reader.readAsDataURL(file);
        return;
      }
    }
  }, [chat]);

  const copyMessage = useCallback((content: string, idx: number) => {
    navigator.clipboard.writeText(content);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  }, []);

  const downloadMessage = useCallback((content: string, idx: number) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ulysse-response-${idx}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  if (!chat.shouldShowWidget) return null;

  const isUlysse = chat.persona === "Ulysse";
  const accentFrom = isUlysse ? "from-violet-600" : "from-pink-500";
  const accentTo = isUlysse ? "to-indigo-700" : "to-rose-600";
  const personaEmoji = isUlysse ? "U" : "I";
  const contextLabel = chat.currentPageContext?.pageName || "";

  if (!open) {
    const useBubbleAbsolute = bubblePos.x !== 0 || bubblePos.y !== 0;
    const bubbleStyle: React.CSSProperties = useBubbleAbsolute
      ? { position: "fixed", left: bubblePos.x, top: bubblePos.y, zIndex: 9000 }
      : { position: "fixed", bottom: 24, right: 24, zIndex: 9000 };
    return (
      <button
        ref={bubbleRef}
        data-testid="button-open-ulysse-widget"
        onMouseDown={handleBubbleMouseDown}
        onTouchStart={handleBubbleTouchStart}
        style={bubbleStyle}
        className={`w-14 h-14 rounded-full bg-gradient-to-br ${accentFrom} ${accentTo} text-white shadow-lg hover:scale-110 transition-transform flex items-center justify-center cursor-grab active:cursor-grabbing ${bubbleDragging ? "select-none scale-110" : ""}`}
        title={`Chat ${chat.persona} — maintenir pour déplacer`}
      >
        <MessageCircle className="w-6 h-6" />
      </button>
    );
  }

  const useAbsolute = pos.x !== 0 || pos.y !== 0;
  const widgetStyle: React.CSSProperties = useAbsolute
    ? { position: "fixed", left: pos.x, top: pos.y, zIndex: 9100 }
    : { position: "fixed", bottom: 24, right: 24, zIndex: 9100 };

  return (
    <div
      ref={widgetRef}
      style={widgetStyle}
      className={`w-[400px] max-w-[calc(100vw-32px)] ${minimized ? "" : "h-[560px]"} flex flex-col rounded-2xl shadow-2xl border overflow-hidden bg-background border-border ${dragging ? "select-none" : ""}`}
      data-testid="ulysse-chat-widget"
    >
      <div
        className={`flex items-center gap-2 px-4 py-3 cursor-grab active:cursor-grabbing bg-gradient-to-r ${accentFrom} ${accentTo} text-white shrink-0`}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        <GripVertical className="w-4 h-4 opacity-60" />
        <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center font-bold text-sm">{personaEmoji}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" data-testid="text-widget-persona">{chat.persona}</p>
          {contextLabel && (
            <p className="text-xs opacity-75 truncate" data-testid="text-widget-context">{contextLabel}</p>
          )}
        </div>
        <button
          data-testid="button-minimize-widget"
          onClick={() => setMinimized(!minimized)}
          className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition"
        >
          {minimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
        </button>
        <button
          data-testid="button-close-widget"
          onClick={() => setOpen(false)}
          className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {!minimized && (
        <>
          <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-muted/30">
            {chat.messages.length === 0 && !chat.isStreaming && (
              <div className="text-center py-8 text-muted-foreground">
                <div className={`w-12 h-12 mx-auto mb-3 rounded-xl bg-gradient-to-br ${accentFrom} ${accentTo} flex items-center justify-center text-white font-bold text-lg`}>{personaEmoji}</div>
                <p className="text-sm font-medium" data-testid="text-widget-welcome">Bonjour ! Je suis {chat.persona}.</p>
                {contextLabel && (
                  <p className="text-xs mt-1 opacity-70">Page: {contextLabel}</p>
                )}
                <p className="text-xs mt-1">Upload fichiers, images, copy/paste — tout fonctionne ici.</p>
              </div>
            )}
            {chat.messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} group`}>
                <div className="relative max-w-[85%]">
                  <div
                    data-testid={`widget-message-${m.role}-${i}`}
                    className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      m.role === "user"
                        ? `bg-gradient-to-br ${accentFrom} ${accentTo} text-white`
                        : "bg-card border border-border text-foreground"
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
                          code: ({ children }) => <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">{children}</code>,
                          pre: ({ children }) => <pre className="bg-muted p-2 rounded-lg overflow-x-auto text-xs my-1.5">{children}</pre>,
                        }}
                      >
                        {m.content}
                      </ReactMarkdown>
                    ) : m.content.startsWith("[FICHIER JOINT:") ? (
                      <p className="text-sm">📎 {m.content.split("]")[0].replace("[FICHIER JOINT: ", "")}</p>
                    ) : m.content}
                  </div>
                  {m.role === "assistant" && (
                    <div className="absolute -bottom-5 right-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        data-testid={`button-copy-message-${i}`}
                        onClick={() => copyMessage(m.content, i)}
                        className="p-1 rounded bg-muted/80 hover:bg-muted text-muted-foreground"
                        title="Copier"
                      >
                        {copiedIdx === i ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                      </button>
                      <button
                        data-testid={`button-download-message-${i}`}
                        onClick={() => downloadMessage(m.content, i)}
                        className="p-1 rounded bg-muted/80 hover:bg-muted text-muted-foreground"
                        title="Télécharger"
                      >
                        <Download className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {chat.isStreaming && chat.streamingContent && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed bg-card border border-border text-foreground">
                  <ReactMarkdown
                    components={{
                      p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
                    }}
                  >
                    {chat.streamingContent}
                  </ReactMarkdown>
                  <span className="inline-block w-2 h-4 bg-current opacity-50 animate-pulse ml-0.5" />
                </div>
              </div>
            )}
            {chat.isStreaming && !chat.streamingContent && (
              <div className="flex justify-start">
                <div className="rounded-2xl px-3.5 py-2.5 bg-card border border-border">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {chat.pendingFile && (
            <div className="px-3 py-2 border-t border-border bg-muted/50 flex items-center gap-2">
              {chat.pendingFile.imageDataUrl && (
                <img src={chat.pendingFile.imageDataUrl} alt="" className="w-10 h-10 rounded object-cover" />
              )}
              <span className="text-xs text-foreground truncate flex-1" data-testid="text-widget-pending-file">
                📎 {chat.pendingFile.fileName}
              </span>
              <button
                data-testid="button-remove-pending-file"
                onClick={() => chat.setPendingFile(null)}
                className="p-1 rounded hover:bg-muted text-muted-foreground"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="shrink-0 p-3 border-t border-border bg-background">
            <div className="flex items-end gap-2">
              <FileUpload
                onFileAnalyzed={(analysis, fileName) => {
                  let imageDataUrl = analysis.metadata?.imageDataUrl as string | undefined;
                  chat.setPendingFile({ content: analysis.content, fileName, imageDataUrl });
                }}
                compact={true}
              />
              <textarea
                ref={inputRef}
                data-testid="input-widget-chat"
                value={chat.input}
                onChange={e => chat.setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={`Message ${chat.persona}...`}
                rows={1}
                className="flex-1 resize-none rounded-xl px-3 py-2 text-sm outline-none transition bg-muted border border-border text-foreground placeholder-muted-foreground focus:border-ring"
                style={{ maxHeight: 80 }}
                disabled={chat.isStreaming}
              />
              <button
                data-testid="button-send-widget"
                onClick={() => chat.sendMessage()}
                disabled={(!chat.input.trim() && !chat.pendingFile) || chat.isStreaming}
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
