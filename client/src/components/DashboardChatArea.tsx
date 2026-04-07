import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Send, Volume2, VolumeX, Mic, MicOff, Activity, X, Pencil,
  ChevronsUp, ChevronsDown, ShieldCheck, ShieldAlert, ShieldQuestion,
  Check, Copy,
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
    <>
      <Card className="w-full lg:flex-1 min-w-0 max-w-full glass-card border-white/10 mb-4 md:mb-6 z-10 overflow-hidden">
        <div className="h-[400px] md:h-[500px] overflow-y-auto scroll-smooth" ref={scrollRef}>
          <div className="p-4 md:p-5 space-y-3 w-full" style={{ maxWidth: '100%', boxSizing: 'border-box' }}>
            {lastMessages.length === 0 && !streamingContent && (
              <p className="text-center text-muted-foreground text-sm py-8">
                Dites "Bonjour" pour commencer la conversation
              </p>
            )}
            {lastMessages.map((msg, idx) => (
              <div key={idx} className="pr-2">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "text-sm p-3 md:p-4 rounded-xl relative group",
                    msg.role === "user" ? "user-bubble" : "ai-bubble"
                  )}
                  style={{ maxWidth: '90%' }}
                >
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
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500/80 hover:bg-red-500 rounded-full flex items-center justify-center md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                      data-testid="button-delete-message"
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  )}
                  <p className="text-xs text-muted-foreground mb-1">
                    {msg.role === "user" ? "Vous" : personaName}
                  </p>
                  <div className="prose prose-sm dark:prose-invert max-w-full overflow-hidden [&_*]:text-foreground [&_a]:text-blue-500 dark:[&_a]:text-blue-400 [&_a]:underline" style={{ wordBreak: 'break-all', overflowWrap: 'anywhere', hyphens: 'auto' }}>
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                  {msg.role === "assistant" && (
                    <div className="flex items-center justify-between mt-1.5">
                      <div className="flex items-center gap-1">
                        {"confidenceLevel" in msg && msg.confidenceLevel === "certain" && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500 dark:text-emerald-400">
                            <ShieldCheck className="w-3 h-3" /><span>Certain</span>
                          </span>
                        )}
                        {"confidenceLevel" in msg && msg.confidenceLevel === "probable" && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-amber-500 dark:text-amber-400">
                            <ShieldAlert className="w-3 h-3" /><span>Probable</span>
                          </span>
                        )}
                        {"confidenceLevel" in msg && msg.confidenceLevel === "incertain" && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-red-400 dark:text-red-400">
                            <ShieldQuestion className="w-3 h-3" /><span>Incertain</span>
                          </span>
                        )}
                      </div>
                      <button
                        className="p-1 rounded text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
                        onClick={() => {
                          navigator.clipboard.writeText(msg.content);
                          setCopiedMsgIdx(idx);
                          setTimeout(() => setCopiedMsgIdx(null), 2000);
                        }}
                        title="Copier"
                        data-testid={`button-copy-message-${idx}`}
                      >
                        {copiedMsgIdx === idx ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  )}
                </motion.div>
              </div>
            ))}
            {isStreaming && !streamingContent && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-sm p-2 md:p-3 rounded-lg ai-bubble mr-4 md:mr-8">
                <p className="text-xs text-muted-foreground mb-1">{personaName}</p>
                <div className="flex items-center gap-2 py-2">
                  <motion.div className="w-8 h-1 bg-primary/40 rounded-full" animate={{ width: ["32px", "48px", "32px"] }} transition={{ duration: 1.2, repeat: Infinity }} />
                  <motion.div className="w-12 h-1 bg-primary/30 rounded-full" animate={{ width: ["48px", "64px", "48px"] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }} />
                  <motion.div className="w-6 h-1 bg-primary/20 rounded-full" animate={{ width: ["24px", "40px", "24px"] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }} />
                </div>
              </motion.div>
            )}
            {streamingContent && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-sm p-2 md:p-3 rounded-lg ai-bubble mr-4 md:mr-8 overflow-hidden">
                <p className="text-xs text-muted-foreground mb-1">{personaName}</p>
                <div className="prose prose-sm dark:prose-invert max-w-full overflow-hidden [&_*]:text-foreground [&_a]:text-blue-500 dark:[&_a]:text-blue-400 [&_a]:underline" style={{ wordBreak: 'break-all', overflowWrap: 'anywhere', hyphens: 'auto' }}>
                  <ReactMarkdown>{streamingContent}</ReactMarkdown>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </Card>

      <div className="flex items-center gap-2 w-full justify-center -mt-2 mb-1">
        <button onClick={() => scrollRef.current && (scrollRef.current.scrollTop = 0)} data-testid="button-scroll-top"
          className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs text-muted-foreground hover:text-foreground hover:bg-white/10 transition-all border border-white/10" title="Remonter en haut">
          <ChevronsUp className="w-3.5 h-3.5" /> Haut
        </button>
        <div className="w-px h-4 bg-white/10" />
        <button onClick={() => scrollRef.current && (scrollRef.current.scrollTop = scrollRef.current.scrollHeight)} data-testid="button-scroll-bottom"
          className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs text-muted-foreground hover:text-foreground hover:bg-white/10 transition-all border border-white/10" title="Descendre en bas">
          <ChevronsDown className="w-3.5 h-3.5" /> Bas
        </button>
      </div>

      <div className="w-full max-w-4xl z-10 pb-4">
        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex items-end gap-3">
          <Textarea
            ref={(el) => {
              if (el) { el.style.height = "0px"; el.style.height = Math.min(el.scrollHeight, 160) + "px"; }
            }}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              handleTypingUpdate(e.target.value);
              if (isListening) stopListening();
              const el = e.target;
              el.style.height = "0px";
              el.style.height = Math.min(el.scrollHeight, 160) + "px";
            }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={isListening ? "Parlez..." : preThinkResult?.isReading ? `${personaName} lit...` : "Ecrivez votre message..."}
            className="flex-1 min-h-[48px] max-h-[160px] glass-input border-white/10 rounded-2xl text-base px-5 py-3 resize-none overflow-y-auto"
            disabled={isStreaming}
            onFocus={() => { if (isListening) stopListening(); }}
            rows={1}
            data-testid="input-message"
          />
          {sttSupported && (
            <div
              role="button" tabIndex={0}
              onClick={async (e) => {
                e.preventDefault(); e.stopPropagation();
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
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (isStreaming) return;
                  if (isListening) { manualStopRef.current = true; stopListening(); }
                  else {
                    manualStopRef.current = false;
                    if (micPermission === "denied") { requestMicrophonePermission(); }
                    else { startListening(); setConversationMode(true); }
                  }
                }
              }}
              className={cn(
                "flex items-center justify-center min-h-11 min-w-11 px-4 py-2 rounded-xl border cursor-pointer select-none transition-all duration-200 shrink-0",
                micPermission === "denied" && "bg-destructive border-destructive text-destructive-foreground",
                isProcessing && "bg-blue-600 border-blue-500 text-white animate-pulse scale-105",
                isListening && !isProcessing && "bg-green-600 border-green-500 text-white",
                !isListening && !isProcessing && micPermission !== "denied" && "bg-muted border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                isStreaming && "opacity-50 cursor-not-allowed"
              )}
              style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent", WebkitUserSelect: "none" }}
              aria-label={isProcessing ? "Traitement..." : isListening ? "Cliquez pour désactiver le micro" : "Cliquez pour activer le micro"}
              aria-pressed={isListening}
              data-testid="button-input-mic"
            >
              {isProcessing ? <Activity className="w-5 h-5 animate-spin pointer-events-none" /> : isListening ? <MicOff className="w-5 h-5 pointer-events-none" /> : <Mic className="w-5 h-5 pointer-events-none" />}
            </div>
          )}
          <FileUpload
            compact
            onFileAnalyzed={(analysis, fileName) => {
              const imageDataUrl = analysis.metadata?.imageDataUrl as string | undefined;
              const pdfPageImages = analysis.metadata?.pdfPageImages as string[] | undefined;
              const pdfBase64Full = analysis.metadata?.pdfBase64Full as string | undefined;
              if (imageDataUrl) { console.log(`[VISION] Image ready: ${fileName} (${(imageDataUrl.length / 1024).toFixed(1)}KB base64)`); }
              if (pdfPageImages && pdfPageImages.length > 0) { console.log(`[VISION] PDF page images ready: ${pdfPageImages.length} pages for ${fileName}`); }
              if (pdfBase64Full) { console.log(`[PDF-FALLBACK] PDF base64 data ready for server-side save: ${(pdfBase64Full.length / 1024).toFixed(1)}KB`); }
              setPendingFileAnalysis({ content: analysis.content, fileName, imageDataUrl, pdfPageImages, pdfBase64Full });
            }}
          />
          <Button type="submit" size="default" disabled={(!input.trim() && !pendingFileAnalysis) || isStreaming} className="shrink-0" aria-label="Envoyer le message" data-testid="button-send-message">
            <Send className="w-5 h-5" />
          </Button>
        </form>
        {pendingFileAnalysis && (
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="px-2 py-1 bg-primary/10 rounded text-primary">Fichier prêt: {pendingFileAnalysis.fileName}</span>
            {pendingFileAnalysis.imageDataUrl && (
              <Button type="button" variant="outline" size="sm" className="h-6 text-xs" onClick={() => setShowImageEditor(true)} aria-label="Éditer l'image" data-testid="button-edit-image">
                <Pencil className="w-3 h-3 mr-1" /> Éditer
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setPendingFileAnalysis(null)} aria-label="Supprimer le fichier joint" data-testid="button-remove-file">
              <X className="w-3 h-3" />
            </Button>
          </div>
        )}
        {!sttSupported && ttsSupported && (
          <p className="text-center text-xs text-muted-foreground mt-2">Tapez votre message - {personaName} vous répondra vocalement</p>
        )}
        {!sttSupported && !ttsSupported && (
          <p className="text-center text-xs text-muted-foreground mt-2">Entrez votre texte - {personaName} lit les réponses à haute voix</p>
        )}
        {isIOS && !sttSupported && (
          <p className="text-center text-xs text-amber-500/70 mt-1">La reconnaissance vocale n'est pas disponible sur Safari iOS</p>
        )}
      </div>
    </>
  );
}
