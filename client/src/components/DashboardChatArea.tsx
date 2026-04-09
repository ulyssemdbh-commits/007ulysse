import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Send, Volume2, VolumeX, Mic, MicOff, Activity, X, Pencil, Paperclip,
  ChevronsUp, ChevronsDown, ShieldCheck, ShieldAlert, ShieldQuestion,
  Check, Copy, MessageSquare, Terminal,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { FileUpload } from "@/components/FileUpload";

interface Message {
  id?: number;
  role: "user" | "assistant" | "system";
  content: string;
  confidenceLevel?: "certain" | "probable" | "incertain";
}

interface DashboardChatAreaProps {
  lastMessages: Message[];
  streamingContent: string;
  isStreaming: boolean;
  personaName: string;
  activeConversationId: number | null;
  copiedMsgIdx: number | null;
  setCopiedMsgIdx: (v: number | null) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  input: string;
  setInput: (v: string) => void;
  handleSend: () => void;
  handleTypingUpdate: (text: string) => void;
  isListening: boolean;
  isProcessing: boolean;
  sttSupported: boolean;
  ttsSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
  setConversationMode: (v: boolean) => void;
  micPermission: string;
  requestMicrophonePermission: () => Promise<void>;
  isIOS: boolean;
  unlockTTS: () => Promise<void>;
  manualStopRef: React.MutableRefObject<boolean>;
  preThinkResult: { intent: string | null; isReading: boolean } | null;
  pendingFileAnalysis: { content: string; fileName: string; imageDataUrl?: string; pdfPageImages?: string[]; pdfBase64Full?: string } | null;
  setPendingFileAnalysis: (v: { content: string; fileName: string; imageDataUrl?: string; pdfPageImages?: string[]; pdfBase64Full?: string } | null) => void;
  setShowImageEditor: (v: boolean) => void;
  queryClient: { invalidateQueries: (opts: { queryKey: (string | number | null)[] }) => void };
}

export function DashboardChatArea(props: DashboardChatAreaProps) {
  const {
    lastMessages, streamingContent, isStreaming, personaName,
    activeConversationId, copiedMsgIdx, setCopiedMsgIdx, scrollRef,
    input, setInput, handleSend, handleTypingUpdate,
    isListening, isProcessing, sttSupported, ttsSupported,
    startListening, stopListening, setConversationMode,
    micPermission, requestMicrophonePermission, isIOS, unlockTTS,
    manualStopRef, preThinkResult,
    pendingFileAnalysis, setPendingFileAnalysis, setShowImageEditor,
    queryClient,
  } = props;

  return (
    <main className="flex-1 flex flex-col relative border border-blue-200 dark:border-cyan-500/30 bg-white/60 dark:bg-black/40 backdrop-blur-md rounded-xl overflow-hidden shadow-sm dark:shadow-[0_0_30px_rgba(0,212,255,0.05)]">
      <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-blue-300 dark:border-cyan-400 rounded-tl-xl hidden sm:block" />
      <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-blue-300 dark:border-cyan-400 rounded-tr-xl hidden sm:block" />
      <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-blue-300 dark:border-cyan-400 rounded-bl-xl hidden sm:block" />
      <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-blue-300 dark:border-cyan-400 rounded-br-xl hidden sm:block" />

      <div className="px-3 sm:px-4 py-1.5 sm:py-2 border-b border-blue-100 dark:border-cyan-500/20 bg-blue-50/50 dark:bg-black/30 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-3.5 h-3.5 text-blue-500 dark:text-cyan-500" />
          <span className="text-[10px] sm:text-xs font-mono text-blue-600 dark:text-cyan-400 tracking-wider">CONVERSATION PRINCIPALE</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={cn(
            "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono",
            isListening ? "bg-red-500/20 text-red-500 dark:text-red-300 border border-red-500/30" : isStreaming ? "bg-blue-500/10 dark:bg-cyan-500/20 text-blue-500 dark:text-cyan-300 border border-blue-300 dark:border-cyan-500/30" : "bg-blue-500/5 dark:bg-cyan-500/10 text-blue-400 dark:text-cyan-500/60 border border-blue-200 dark:border-cyan-900/30"
          )}>
            <div className={cn("w-1.5 h-1.5 rounded-full", isListening ? "bg-red-400 animate-pulse" : isStreaming ? "bg-blue-500 dark:bg-cyan-400 animate-pulse" : "bg-blue-300 dark:bg-cyan-700")} />
            {isListening ? "ECOUTE" : isStreaming ? "TRAITEMENT" : "STANDBY"}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-5 flex flex-col gap-3 sm:gap-4" ref={scrollRef} role="log" aria-label="Messages de conversation" aria-live="polite">
        {lastMessages.length === 0 && !streamingContent && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-center text-cyan-700 text-sm font-mono">
              Parle a Ulysse pour commencer...
            </p>
          </div>
        )}
        {lastMessages.map((msg, idx) => (
          <div
            key={idx}
            className={cn(
              "flex flex-col max-w-[90%] sm:max-w-[80%]",
              msg.role === "user" ? "self-end items-end" : "self-start items-start"
            )}
          >
            <div className="text-[10px] font-mono text-blue-400 dark:text-cyan-600 mb-1 flex items-center gap-2">
              {msg.role !== "user" && <Terminal className="w-3 h-3" />}
              {msg.role !== "user" ? `${personaName.toUpperCase()} // ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : `MOI // ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`}
            </div>
            <div
              className={cn(
                "p-3 sm:p-3.5 rounded-xl relative overflow-hidden backdrop-blur-sm border group",
                msg.role === "user"
                  ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-500/30 text-foreground dark:text-blue-50 rounded-tr-none"
                  : "bg-white dark:bg-cyan-900/10 border-blue-100 dark:border-cyan-500/30 text-foreground dark:text-cyan-50 rounded-tl-none"
              )}
            >
              {msg.role !== "user" && (
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500 dark:bg-cyan-500 dark:shadow-[0_0_10px_#00d4ff]" />
              )}
              {msg.role === "user" && (
                <div className="absolute right-0 top-0 bottom-0 w-1 bg-blue-500 dark:shadow-[0_0_10px_#3b82f6]" />
              )}
              {msg.role === "user" && msg.id && (
                <button
                  onClick={async () => {
                    try {
                      await fetch(`/api/conversations/messages/${msg.id}`, { method: "DELETE", credentials: "include" });
                      queryClient.invalidateQueries({ queryKey: ["/api/conversations", activeConversationId] });
                    } catch (e) {
                      console.error("Failed to delete message:", e);
                    }
                  }}
                  className="absolute -top-2 -right-2 w-6 h-6 bg-red-500/80 hover:bg-red-500 rounded-full flex items-center justify-center md:opacity-0 md:group-hover:opacity-100 transition-opacity z-10"
                  aria-label="Supprimer le message"
                  data-testid="button-delete-message"
                >
                  <X className="w-3 h-3 text-white" />
                </button>
              )}
              <div className="prose prose-sm max-w-full overflow-hidden dark:[&_*]:text-cyan-100 [&_a]:text-blue-500 [&_a]:underline leading-relaxed text-sm" style={{ wordBreak: 'break-all', overflowWrap: 'anywhere' }}>
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
              {msg.role === "assistant" && (
                <div className="flex items-center justify-between mt-1.5">
                  <div className="flex items-center gap-1">
                    {"confidenceLevel" in msg && msg.confidenceLevel === "certain" && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                        <ShieldCheck className="w-3 h-3" /><span>Certain</span>
                      </span>
                    )}
                    {"confidenceLevel" in msg && msg.confidenceLevel === "probable" && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-amber-400">
                        <ShieldAlert className="w-3 h-3" /><span>Probable</span>
                      </span>
                    )}
                    {"confidenceLevel" in msg && msg.confidenceLevel === "incertain" && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-red-400">
                        <ShieldQuestion className="w-3 h-3" /><span>Incertain</span>
                      </span>
                    )}
                  </div>
                  <button
                    className="p-1 rounded text-cyan-700 hover:text-cyan-400 transition-colors"
                    onClick={() => {
                      navigator.clipboard.writeText(msg.content);
                      setCopiedMsgIdx(idx);
                      setTimeout(() => setCopiedMsgIdx(null), 2000);
                    }}
                    title="Copier"
                    data-testid={`button-copy-message-${idx}`}
                  >
                    {copiedMsgIdx === idx ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {isStreaming && !streamingContent && (
          <div className="self-start max-w-[80%]">
            <div className="text-[10px] font-mono text-cyan-600 mb-1 flex items-center gap-2">
              <Terminal className="w-3 h-3" /> {personaName.toUpperCase()} // TRAITEMENT
            </div>
            <div className="p-3.5 rounded-xl rounded-tl-none bg-cyan-900/10 border border-cyan-500/30 relative">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-cyan-500 shadow-[0_0_10px_#00d4ff] animate-pulse" />
              <div className="flex items-center gap-2 py-1">
                <motion.div className="w-8 h-1 bg-cyan-400/40 rounded-full" animate={{ width: ["32px", "48px", "32px"] }} transition={{ duration: 1.2, repeat: Infinity }} />
                <motion.div className="w-12 h-1 bg-cyan-400/30 rounded-full" animate={{ width: ["48px", "64px", "48px"] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }} />
                <motion.div className="w-6 h-1 bg-cyan-400/20 rounded-full" animate={{ width: ["24px", "40px", "24px"] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }} />
              </div>
            </div>
          </div>
        )}
        {streamingContent && (
          <div className="self-start max-w-[80%]">
            <div className="text-[10px] font-mono text-cyan-600 mb-1 flex items-center gap-2">
              <Terminal className="w-3 h-3" /> {personaName.toUpperCase()} // EN COURS
            </div>
            <div className="p-3.5 rounded-xl rounded-tl-none bg-cyan-900/10 border border-cyan-500/30 relative overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-cyan-500 shadow-[0_0_10px_#00d4ff]" />
              <div className="prose prose-sm max-w-full overflow-hidden dark:[&_*]:text-cyan-100 [&_a]:text-blue-500 [&_a]:underline leading-relaxed text-sm" style={{ wordBreak: 'break-all', overflowWrap: 'anywhere' }}>
                <ReactMarkdown>{streamingContent}</ReactMarkdown>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="p-2 sm:p-3 border-t border-blue-100 dark:border-cyan-500/20 bg-blue-50/30 dark:bg-black/60 relative z-10 shrink-0 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="relative flex items-center gap-1.5 sm:gap-2">
          <FileUpload
            compact
            onFileAnalyzed={(analysis, fileName) => {
              const imageDataUrl = analysis.metadata?.imageDataUrl as string | undefined;
              const pdfPageImages = analysis.metadata?.pdfPageImages as string[] | undefined;
              const pdfBase64Full = analysis.metadata?.pdfBase64Full as string | undefined;
              setPendingFileAnalysis({ content: analysis.content, fileName, imageDataUrl, pdfPageImages, pdfBase64Full });
            }}
          />
          <div className="flex-1 relative">
            <input
              type="text"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                handleTypingUpdate(e.target.value);
                if (isListening) stopListening();
              }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={isListening ? "Parlez..." : preThinkResult?.isReading ? `${personaName} lit...` : "Parle a Ulysse..."}
              data-testid="input-message"
              className="w-full bg-white dark:bg-black/50 border border-blue-200 dark:border-cyan-500/30 text-foreground dark:text-cyan-100 placeholder:text-blue-300 dark:placeholder:text-cyan-800 p-2.5 sm:p-3 rounded-lg outline-none focus:border-blue-400 dark:focus:border-cyan-400 font-mono tracking-wide text-sm"
              disabled={isStreaming}
            />
          </div>
          {sttSupported && (
            <button
              type="button"
              onClick={async () => {
                if (isStreaming) return;
                if (isListening) {
                  manualStopRef.current = true;
                  stopListening();
                } else {
                  manualStopRef.current = false;
                  if (isIOS) await unlockTTS();
                  if (micPermission === "denied") { await requestMicrophonePermission(); }
                  else { startListening(); setConversationMode(true); }
                }
              }}
              data-testid="button-input-mic"
              className={cn(
                "p-2 sm:p-2.5 rounded-lg border transition-all duration-300 relative overflow-hidden",
                isListening
                  ? "border-red-500/50 text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/30 shadow-[0_0_15px_rgba(239,68,68,0.2)]"
                  : "border-blue-200 dark:border-cyan-900/50 text-blue-500 dark:text-cyan-600 bg-blue-50 dark:bg-cyan-950/30 hover:border-blue-400 dark:hover:border-cyan-500/50 hover:text-blue-700 dark:hover:text-cyan-300"
              )}
            >
              {isListening && <div className="absolute inset-0 bg-red-500/20 animate-pulse" />}
              <Mic className="w-4 h-4 relative z-10" />
            </button>
          )}
          <button
            type="submit"
            disabled={(!input.trim() && !pendingFileAnalysis) || isStreaming}
            data-testid="button-send-message"
            className="p-2 sm:p-2.5 text-white bg-blue-600 dark:bg-cyan-500 hover:bg-blue-700 dark:hover:bg-cyan-400 dark:text-black rounded-lg shadow-sm dark:shadow-[0_0_15px_rgba(0,212,255,0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:bg-blue-200 dark:disabled:bg-cyan-900 disabled:text-blue-400 dark:disabled:text-cyan-700"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
        {pendingFileAnalysis && (
          <div className="mt-2 flex items-center gap-2 text-xs font-mono text-cyan-500">
            <span className="px-2 py-1 bg-cyan-950/30 border border-cyan-900/30 rounded text-cyan-400">Fichier: {pendingFileAnalysis.fileName}</span>
            {pendingFileAnalysis.imageDataUrl && (
              <button type="button" className="px-2 py-1 border border-cyan-900/30 rounded text-cyan-600 hover:text-cyan-400 transition-colors" onClick={() => setShowImageEditor(true)} data-testid="button-edit-image">
                <Pencil className="w-3 h-3" />
              </button>
            )}
            <button type="button" className="px-2 py-1 border border-cyan-900/30 rounded text-cyan-600 hover:text-red-400 transition-colors" onClick={() => setPendingFileAnalysis(null)} data-testid="button-remove-file">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
