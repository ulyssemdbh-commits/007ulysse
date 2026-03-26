import { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { User, Bot, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TimelineMessage } from "./types";

interface ConversationTimelineProps {
  messages: TimelineMessage[];
  currentTranscript?: string;
  isListening?: boolean;
  isProcessing?: boolean;
  isSpeaking?: boolean;
  streamingResponse?: string;
  maxHeight?: string;
  className?: string;
}

export function ConversationTimeline({
  messages,
  currentTranscript = "",
  isListening = false,
  isProcessing = false,
  isSpeaking = false,
  streamingResponse = "",
  maxHeight = "300px",
  className,
}: ConversationTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentTranscript, streamingResponse]);
  
  const formatTime = (date: Date) => {
    return new Intl.DateTimeFormat("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };
  
  return (
    <div
      ref={scrollRef}
      className={cn(
        "overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent",
        className
      )}
      style={{ maxHeight }}
    >
      <div className="space-y-3 p-4">
        <AnimatePresence mode="popLayout">
          {messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={cn(
                "flex gap-3",
                message.role === "user" ? "flex-row-reverse" : "flex-row"
              )}
            >
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                message.role === "user" ? "bg-blue-600" : "bg-purple-600"
              )}>
                {message.role === "user" ? (
                  <User className="w-4 h-4 text-white" />
                ) : (
                  <Bot className="w-4 h-4 text-white" />
                )}
              </div>
              
              <div className={cn(
                "max-w-[80%] rounded-2xl px-4 py-2",
                message.role === "user" 
                  ? "bg-blue-600 text-white rounded-br-md" 
                  : "bg-gray-800 text-gray-100 rounded-bl-md"
              )}>
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                <div className={cn(
                  "flex items-center gap-2 mt-1",
                  message.role === "user" ? "justify-end" : "justify-start"
                )}>
                  <span className="text-xs opacity-60">
                    {formatTime(message.timestamp)}
                  </span>
                  {message.origin && (
                    <span className="text-xs opacity-40">
                      {message.origin === "voice" ? "vocal" : message.origin}
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
          
          {currentTranscript && isListening && (
            <motion.div
              key="live-transcript"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-3 flex-row-reverse"
            >
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                <User className="w-4 h-4 text-white" />
              </div>
              
              <div className="max-w-[80%] rounded-2xl rounded-br-md px-4 py-2 bg-blue-600/50 border border-blue-500/50">
                <p className="text-sm text-white">{currentTranscript}</p>
                <div className="flex items-center gap-2 mt-1 justify-end">
                  <motion.span
                    className="inline-block w-2 h-2 bg-green-400 rounded-full"
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ repeat: Infinity, duration: 0.8 }}
                  />
                  <span className="text-xs text-green-400">Ecoute en cours...</span>
                </div>
              </div>
            </motion.div>
          )}
          
          {isProcessing && !streamingResponse && (
            <motion.div
              key="processing"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-3"
            >
              <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-white" />
              </div>
              
              <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-gray-800/50 border border-gray-700">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
                  <span className="text-sm text-gray-400">Ulysse reflechit...</span>
                </div>
              </div>
            </motion.div>
          )}
          
          {streamingResponse && (
            <motion.div
              key="streaming-response"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-3"
            >
              <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-white" />
              </div>
              
              <div className={cn(
                "max-w-[80%] rounded-2xl rounded-bl-md px-4 py-2",
                isSpeaking ? "bg-purple-900/50 border border-purple-500/50" : "bg-gray-800"
              )}>
                <p className="text-sm text-gray-100 whitespace-pre-wrap">
                  {streamingResponse}
                  <motion.span
                    className="inline-block w-1 h-4 bg-purple-400 ml-0.5"
                    animate={{ opacity: [1, 0] }}
                    transition={{ repeat: Infinity, duration: 0.5 }}
                  />
                </p>
                {isSpeaking && (
                  <div className="flex items-center gap-2 mt-1">
                    <motion.div
                      className="flex gap-0.5"
                      animate={{ opacity: [0.5, 1, 0.5] }}
                      transition={{ repeat: Infinity, duration: 1 }}
                    >
                      {[1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className="w-1 bg-purple-400 rounded-full"
                          style={{
                            height: `${4 + Math.random() * 8}px`,
                          }}
                        />
                      ))}
                    </motion.div>
                    <span className="text-xs text-purple-400">Parle...</span>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
