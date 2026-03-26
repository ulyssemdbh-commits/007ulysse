import { useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ThumbsUp, ThumbsDown, Heart, Lightbulb, Copy, Check, Volume2, Square, Clock, RefreshCw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { ChatMessage, ReactionType } from "@/hooks/useChatManager";

interface ExtendedChatMessage extends ChatMessage {
  pending?: boolean;
}

interface MobileChatAreaProps {
  messages: ExtendedChatMessage[];
  personaName: string;
  personaInitial: string;
  streamingMessageId: string | null;
  speakingMessageId: string | null;
  copiedId: string | null;
  voiceEnabled: boolean;
  isOnline?: boolean;
  pendingCount?: number;
  onReaction: (messageId: string, reaction: ReactionType) => void;
  onCopy: (messageId: string, content: string) => void;
  onSpeak: (text: string, messageId: string) => void;
  onStopSpeaking: () => void;
  onRetryPending?: () => void;
}

const reactions = [
  { type: "like" as ReactionType, icon: ThumbsUp, label: "Utile" },
  { type: "dislike" as ReactionType, icon: ThumbsDown, label: "Pas utile" },
  { type: "love" as ReactionType, icon: Heart, label: "J'adore" },
  { type: "helpful" as ReactionType, icon: Lightbulb, label: "Pertinent" },
];

export function MobileChatArea({
  messages,
  personaName,
  personaInitial,
  streamingMessageId,
  speakingMessageId,
  copiedId,
  voiceEnabled,
  isOnline = true,
  pendingCount = 0,
  onReaction,
  onCopy,
  onSpeak,
  onStopSpeaking,
  onRetryPending,
}: MobileChatAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <ScrollArea className="flex-1 p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center py-8 sm:py-12 space-y-4"
        >
          <motion.div
            className="w-20 h-20 sm:w-24 sm:h-24 mx-auto rounded-full ai-gradient flex items-center justify-center shadow-xl shadow-blue-500/30"
            animate={{ 
              boxShadow: [
                "0 10px 30px rgba(59, 130, 246, 0.3)",
                "0 10px 50px rgba(59, 130, 246, 0.5)",
                "0 10px 30px rgba(59, 130, 246, 0.3)"
              ]
            }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          >
            <span className="text-3xl sm:text-4xl font-bold text-white">{personaInitial}</span>
          </motion.div>
          <h2 className="text-xl sm:text-2xl font-bold text-foreground">
            Bonjour, je suis {personaName}
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground max-w-xs mx-auto">
            Votre assistant personnel intelligent. Posez-moi une question ou donnez-moi une tâche.
          </p>
        </motion.div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="flex-1 p-4" ref={scrollRef}>
      <div className="space-y-4 pb-4">
        {pendingCount > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex items-center justify-between rounded-lg px-3 py-2 ${
              isOnline 
                ? "bg-green-500/20 border border-green-500/30" 
                : "bg-amber-500/20 border border-amber-500/30"
            }`}
          >
            <div className={`flex items-center gap-2 ${
              isOnline ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"
            }`}>
              <Clock className="w-4 h-4" />
              <span className="text-sm">
                {isOnline 
                  ? `${pendingCount} message${pendingCount > 1 ? "s" : ""} à synchroniser`
                  : `${pendingCount} message${pendingCount > 1 ? "s" : ""} en attente`
                }
              </span>
            </div>
            {onRetryPending && (
              <button
                onClick={onRetryPending}
                className={`flex items-center gap-1 text-xs ${
                  isOnline 
                    ? "text-green-600 dark:text-green-400" 
                    : "text-amber-600 dark:text-amber-400"
                }`}
                data-testid="button-retry-pending"
              >
                <RefreshCw className="w-3 h-3" />
                {isOnline ? "Synchroniser" : "En attente..."}
              </button>
            )}
          </motion.div>
        )}
        {messages.map((message, index) => (
          <motion.div
            key={message.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.05 }}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div className={`max-w-[85%] ${message.role === "user" ? "order-2" : "order-1"}`}>
              {message.role === "assistant" && (
                <div className="flex items-center gap-2 mb-1 ml-1">
                  <div className="w-6 h-6 rounded-full ai-gradient flex items-center justify-center">
                    <span className="text-xs font-bold text-white">{personaInitial}</span>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">{personaName}</span>
                </div>
              )}
              
              <div className={`rounded-2xl px-4 py-3 ${
                message.role === "user"
                  ? `user-bubble text-white rounded-br-md ${message.pending ? "opacity-70" : ""}`
                  : "ai-bubble rounded-bl-md"
              }`}>
                {message.role === "assistant" ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none [&_*]:text-foreground [&_a]:text-blue-500 dark:[&_a]:text-blue-400 [&_a]:underline">
                    <ReactMarkdown>{message.content || "..."}</ReactMarkdown>
                    {streamingMessageId === message.id && (
                      <motion.span
                        className="inline-block w-2 h-4 bg-current ml-1"
                        animate={{ opacity: [1, 0, 1] }}
                        transition={{ duration: 0.8, repeat: Infinity }}
                      />
                    )}
                  </div>
                ) : (
                  <div>
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    {message.pending && (
                      <div className="flex items-center gap-1 mt-1 text-xs opacity-80">
                        <Clock className="w-3 h-3" />
                        <span>En attente...</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              {message.role === "assistant" && message.content && streamingMessageId !== message.id && (
                <div className="flex items-center gap-1 mt-2 ml-1 flex-wrap">
                  {reactions.map(({ type, icon: Icon }) => (
                    <button
                      key={type}
                      onClick={() => onReaction(message.id, type)}
                      className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                        message.reaction === type 
                          ? "bg-primary/20 text-primary" 
                          : "hover:bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                      data-testid={`button-reaction-${type}`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </button>
                  ))}
                  
                  <button
                    onClick={() => onCopy(message.id, message.content)}
                    className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
                    data-testid="button-copy"
                  >
                    {copiedId === message.id ? (
                      <Check className="w-3.5 h-3.5 text-green-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                  
                  {voiceEnabled && (
                    <button
                      onClick={() => 
                        speakingMessageId === message.id 
                          ? onStopSpeaking() 
                          : onSpeak(message.content, message.id)
                      }
                      className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                        speakingMessageId === message.id
                          ? "bg-primary/20 text-primary"
                          : "hover:bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                      data-testid="button-speak"
                    >
                      {speakingMessageId === message.id ? (
                        <Square className="w-3 h-3" />
                      ) : (
                        <Volume2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </ScrollArea>
  );
}
