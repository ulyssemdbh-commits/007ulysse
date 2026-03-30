import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
import { Bot, RefreshCw, Loader2, Send, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { REPO_URL, type ChatMessage } from "./types";

export default function DevOpsChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const handleSend = useCallback(async () => {
    const msg = input.trim();
    if (!msg || isLoading) return;
    setInput("");
    setIsLoading(true);

    const userMsg: ChatMessage = { role: "user", content: msg };
    setMessages(prev => [...prev, userMsg]);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);

      const response = await fetch("/api/v2/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({
          message: `[DEVOPS-MAX CONTEXT] Repo: ulyssemdbh-commits/devmax (${REPO_URL})\n\n${msg}`,
          threadId,
          sessionContext: "alfred",
        }),
      });

      clearTimeout(timeout);

      if (!response.ok) throw new Error(`Erreur serveur: ${response.status}`);

      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("text/event-stream")) {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let fullContent = "";
        const assistantMsg: ChatMessage = { role: "assistant", content: "" };
        setMessages(prev => [...prev, assistantMsg]);

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split("\n")) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "start") setThreadId(data.threadId);
                else if (data.type === "chunk") {
                  fullContent += data.content;
                  setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, content: fullContent } : m));
                }
              } catch {}
            }
          }
        }
      } else {
        const data = await response.json();
        if (data.threadId) setThreadId(data.threadId);
        const reply = data.response || data.message || data.text || "Pas de réponse.";
        setMessages(prev => [...prev, { role: "assistant", content: reply }]);
      }
    } catch (e: any) {
      const errorMsg = e.name === "AbortError" ? "La requête a pris trop de temps. Réessayez avec une question plus simple." : `Erreur de communication: ${e.message || "vérifiez votre connexion."}`;
      setMessages(prev => [...prev, { role: "assistant", content: errorMsg }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, threadId, isLoading]);

  return (
    <div className="flex flex-col h-[500px]">
      <div className="flex items-center gap-2 mb-3">
        <Bot className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">Max DevOps Assistant</span>
        <Badge variant="secondary" className="text-xs">devmax</Badge>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => { setMessages([]); setThreadId(null); }} data-testid="button-clear-devops-chat">
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>
      <ScrollArea className="flex-1 rounded-md border p-3" ref={scrollRef}>
        <div className="space-y-3">
          {messages.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm space-y-2">
              <Terminal className="w-8 h-8 mx-auto opacity-50" />
              <p>Demandez-moi n'importe quoi sur le repo devmax</p>
              <div className="flex flex-wrap justify-center gap-2 mt-3">
                {["Status du repo", "Derniers commits", "Créer une branche feature", "Analyser le code"].map(s => (
                  <Button key={s} variant="outline" size="sm" className="text-xs" onClick={() => setInput(s)} data-testid={`button-suggestion-${s.replace(/\s/g, '-')}`}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={cn("text-sm p-3 rounded-lg", msg.role === "user" ? "bg-primary/10 ml-8" : "bg-muted mr-8")}>
              <p className="text-xs text-muted-foreground mb-1">{msg.role === "user" ? "Vous" : "Max"}</p>
              <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            </div>
          ))}
          {isLoading && messages[messages.length - 1]?.role === "user" && (
            <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Max réfléchit...
            </div>
          )}
        </div>
      </ScrollArea>
      <form onSubmit={e => { e.preventDefault(); handleSend(); }} className="flex items-center gap-2 mt-3">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Commande DevOps..."
          disabled={isLoading}
          className="flex-1"
          data-testid="input-devops-chat"
        />
        <Button type="submit" size="icon" disabled={!input.trim() || isLoading} data-testid="button-send-devops">
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
}
