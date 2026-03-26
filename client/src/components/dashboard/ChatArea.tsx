import { memo, useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { Square, RotateCcw, Copy, Check } from "lucide-react";

interface Message {
  role: string;
  content: string;
}

interface ChatAreaProps {
  messages: Message[];
  streamingContent: string;
  isStreaming: boolean;
  personaName: string;
  onStop?: () => void;
  onRegenerate?: () => void;
}

const TypingCursor = memo(function TypingCursor() {
  return (
    <motion.span
      className="inline-block w-0.5 h-4 bg-primary ml-0.5 align-middle"
      animate={{ opacity: [1, 0, 1] }}
      transition={{ duration: 0.8, repeat: Infinity, ease: "steps(2)" }}
      data-testid="indicator-typing-cursor"
    />
  );
});

const ThinkingIndicator = memo(function ThinkingIndicator({ personaName }: { personaName: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -5 }}
      className="text-sm p-2 md:p-3 rounded-lg bg-secondary/50 text-foreground mr-4 md:mr-8"
      data-testid="indicator-thinking"
    >
      <p className="text-xs text-muted-foreground mb-1" data-testid="text-thinking-persona">{personaName}</p>
      <div className="flex items-center gap-1.5 py-1">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-2 h-2 bg-primary/60 rounded-full"
            animate={{ 
              y: [0, -6, 0],
              opacity: [0.6, 1, 0.6]
            }}
            transition={{ 
              duration: 0.6, 
              repeat: Infinity, 
              delay: i * 0.15,
              ease: "easeInOut"
            }}
          />
        ))}
        <span className="text-xs text-muted-foreground ml-2" data-testid="text-thinking-status">réfléchit...</span>
      </div>
    </motion.div>
  );
});

export const ChatArea = memo(function ChatArea({ 
  messages, 
  streamingContent, 
  isStreaming, 
  personaName,
  onStop,
  onRegenerate
}: ChatAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      const scrollContainer = scrollRef.current.querySelector("[data-radix-scroll-area-viewport]");
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages, streamingContent]);

  const handleCopy = async (content: string, idx: number) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(idx);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const lastAssistantIdx = messages.findLastIndex(m => m.role === "assistant");
  const canRegenerate = !isStreaming && lastAssistantIdx >= 0;

  return (
    <Card className="w-full max-w-4xl bg-card/50 backdrop-blur-xl border-border/50 mb-4 md:mb-6 z-10">
      <ScrollArea className="h-[400px] md:h-[500px]" ref={scrollRef}>
        <div className="p-3 md:p-4 space-y-2 md:space-y-3">
          {messages.length === 0 && !streamingContent && !isStreaming && (
            <p className="text-center text-muted-foreground text-sm" data-testid="text-empty-state">
              Dites "Bonjour" pour commencer la conversation
            </p>
          )}
          <AnimatePresence mode="popLayout">
            {messages.map((msg, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className={cn(
                  "text-sm p-2 md:p-3 rounded-lg group relative",
                  msg.role === "user" 
                    ? "bg-primary/20 text-foreground ml-4 md:ml-8"
                    : "bg-secondary/50 text-foreground mr-4 md:mr-8"
                )}
              >
                <p className="text-xs text-muted-foreground mb-1" data-testid={`text-message-sender-${idx}`}>
                  {msg.role === "user" ? "Vous" : personaName}
                </p>
                <div className="prose prose-sm dark:prose-invert max-w-none [&_*]:text-foreground [&_a]:text-blue-500 dark:[&_a]:text-blue-400 [&_a]:underline" data-testid={`text-message-content-${idx}`}>
                  <ReactMarkdown>{msg.content.slice(0, 500) + (msg.content.length > 500 ? "..." : "")}</ReactMarkdown>
                </div>
                {msg.role === "assistant" && (
                  <div className="flex justify-end mt-1">
                    <button
                      className="p-1 rounded text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
                      onClick={() => handleCopy(msg.content, idx)}
                      title="Copier"
                      data-testid={`button-copy-message-${idx}`}
                    >
                      {copiedId === idx ? (
                        <Check className="h-3.5 w-3.5 text-green-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
          
          <AnimatePresence>
            {isStreaming && !streamingContent && (
              <ThinkingIndicator personaName={personaName} />
            )}
          </AnimatePresence>
          
          {streamingContent && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-sm p-2 md:p-3 rounded-lg bg-secondary/50 text-foreground mr-4 md:mr-8"
              data-testid="container-streaming-message"
            >
              <p className="text-xs text-muted-foreground mb-1" data-testid="text-streaming-persona">{personaName}</p>
              <div className="prose prose-sm dark:prose-invert max-w-none [&_*]:text-foreground [&_a]:text-blue-500 dark:[&_a]:text-blue-400 [&_a]:underline" data-testid="text-streaming-content">
                <ReactMarkdown>{streamingContent}</ReactMarkdown>
                <TypingCursor />
              </div>
            </motion.div>
          )}
        </div>
      </ScrollArea>
      
      {(isStreaming || canRegenerate) && (
        <div className="flex flex-wrap justify-center gap-2 p-2 border-t border-border/30">
          {isStreaming && onStop && (
            <Button 
              size="sm" 
              variant="outline"
              onClick={onStop}
              className="text-xs gap-1"
              data-testid="button-stop-generation"
            >
              <Square className="h-3 w-3" />
              Stop
            </Button>
          )}
          {canRegenerate && onRegenerate && (
            <Button 
              size="sm" 
              variant="ghost"
              onClick={onRegenerate}
              className="text-xs gap-1"
              data-testid="button-regenerate"
            >
              <RotateCcw className="h-3 w-3" />
              Régénérer
            </Button>
          )}
        </div>
      )}
    </Card>
  );
});
