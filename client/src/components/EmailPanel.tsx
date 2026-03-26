import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { X, Mail, Send, RefreshCw, ChevronLeft, Inbox, Plus, Loader2, Paperclip, Download, FileText, ImageIcon, Eye, FileIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

interface EmailThread {
  id: string;
  subject: string;
  participants: string[];
  lastMessageAt: string;
  snippet: string;
  unread?: boolean;
}

interface EmailAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

interface EmailMessage {
  id: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
  sentAt: string;
  attachments?: EmailAttachment[];
}

interface EmailPanelProps {
  onClose?: () => void;
  embedded?: boolean;
}

export function EmailPanel({ onClose, embedded = false }: EmailPanelProps) {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [composeData, setComposeData] = useState({ to: "", subject: "", body: "" });
  const [previewingAttachment, setPreviewingAttachment] = useState<{ url: string; name: string; mimeType: string } | null>(null);

  const { data: status } = useQuery<{ connected: boolean; email?: string }>({
    queryKey: ["/api/agentmail/status"],
  });

  const { data: threadsData, isLoading: threadsLoading, refetch: refetchThreads } = useQuery<{ threads: EmailThread[] }>({
    queryKey: ["/api/agentmail/threads"],
    enabled: status?.connected === true,
  });

  const { data: threadData, isLoading: threadLoading } = useQuery<{ thread: EmailThread; messages: EmailMessage[] }>({
    queryKey: ["/api/agentmail/threads", selectedThreadId],
    enabled: !!selectedThreadId,
  });

  const sendMutation = useMutation({
    mutationFn: async (data: { to: string; subject: string; body: string }) => {
      return apiRequest("POST", "/api/agentmail/send", data);
    },
    onSuccess: () => {
      setComposing(false);
      setComposeData({ to: "", subject: "", body: "" });
      queryClient.invalidateQueries({ queryKey: ["/api/agentmail/threads"] });
    },
  });

  const threads = threadsData?.threads || [];
  const messages = threadData?.messages || [];

  const handlePreviewAttachment = async (messageId: string, attachment: EmailAttachment) => {
    const url = `/api/agentmail/attachments/${messageId}/${attachment.id}`;
    setPreviewingAttachment({ url, name: attachment.filename, mimeType: attachment.mimeType });
  };

  const closeAttachmentPreview = () => {
    setPreviewingAttachment(null);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const containerClass = embedded 
    ? "h-full flex flex-col bg-background" 
    : "fixed inset-0 z-50 bg-background flex flex-col";

  return (
    <div className={containerClass}>
      <header className={`flex items-center justify-between px-4 py-2 border-b ${embedded ? "bg-muted/30" : "bg-card/80 backdrop-blur-sm"}`}>
        <div className="flex items-center gap-2">
          {composing ? (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => setComposing(false)}
              data-testid="button-back-inbox"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
          ) : (
            <Mail className="w-4 h-4 text-primary" />
          )}
          <h2 className={`font-semibold ${embedded ? "text-sm" : ""}`}>
            {composing ? "Nouveau message" : "Emails"}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          {!composing && (
            <>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => setComposing(true)}
                data-testid="button-compose"
              >
                <Plus className="w-4 h-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => refetchThreads()}
                data-testid="button-refresh-emails"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
          {onClose && (
            <Button
              size="icon"
              variant="ghost"
              className={embedded ? "h-8 w-8" : ""}
              onClick={onClose}
              data-testid="button-close-email"
            >
              <X className={embedded ? "w-4 h-4" : "w-5 h-5"} />
            </Button>
          )}
        </div>
      </header>

      {!status?.connected ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center space-y-4">
            <Mail className="w-12 h-12 mx-auto text-muted-foreground" />
            <p className="text-muted-foreground">Service email non connecté</p>
            <p className="text-xs text-muted-foreground/70">
              Demandez à Ulysse de configurer AgentMail
            </p>
          </div>
        </div>
      ) : composing ? (
        <div className="flex-1 flex flex-col p-4 gap-4">
          <Input
            placeholder="Destinataire"
            value={composeData.to}
            onChange={(e) => setComposeData({ ...composeData, to: e.target.value })}
            data-testid="input-email-to"
          />
          <Input
            placeholder="Sujet"
            value={composeData.subject}
            onChange={(e) => setComposeData({ ...composeData, subject: e.target.value })}
            data-testid="input-email-subject"
          />
          <Textarea
            placeholder="Votre message..."
            value={composeData.body}
            onChange={(e) => setComposeData({ ...composeData, body: e.target.value })}
            className="flex-1 min-h-[200px] resize-none"
            data-testid="input-email-body"
          />
          <Button
            onClick={() => sendMutation.mutate(composeData)}
            disabled={!composeData.to || !composeData.subject || !composeData.body || sendMutation.isPending}
            className="w-full"
            data-testid="button-send-email"
          >
            {sendMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Send className="w-4 h-4 mr-2" />
            )}
            Envoyer
          </Button>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          {threadsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : threads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
              <Inbox className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Aucun email</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Adresse: {status?.email || "..."}
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {threads.map((thread) => (
                <button
                  key={thread.id}
                  className="w-full px-4 py-3 text-left hover-elevate transition-colors"
                  onClick={() => setSelectedThreadId(thread.id)}
                  data-testid={`thread-${thread.id}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="font-medium text-sm truncate flex-1">
                      {thread.participants?.join(", ") || "Expéditeur inconnu"}
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                      {thread.lastMessageAt ? formatDistanceToNow(new Date(thread.lastMessageAt), { addSuffix: true, locale: fr }) : ""}
                    </div>
                  </div>
                  <div className="text-sm font-medium truncate">{thread.subject}</div>
                  <div className="text-sm text-muted-foreground truncate">{thread.snippet}</div>
                  {thread.unread && (
                    <Badge variant="default" className="mt-1">Non lu</Badge>
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      )}

      {/* Email Preview Dialog */}
      <Dialog open={!!selectedThreadId} onOpenChange={(open) => !open && setSelectedThreadId(null)}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="p-4 pb-2 border-b shrink-0">
            <DialogTitle className="text-sm truncate pr-8 flex items-center gap-2">
              <Mail className="w-4 h-4 text-primary" />
              {threadData?.thread?.subject || "Email"}
            </DialogTitle>
            <DialogDescription className="sr-only">Apercu de l'email</DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-4 space-y-4">
              {threadLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                messages.map((message) => (
                  <Card key={message.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium text-sm truncate">{message.from}</div>
                      <div className="text-xs text-muted-foreground whitespace-nowrap">
                        {message.sentAt ? formatDistanceToNow(new Date(message.sentAt), { addSuffix: true, locale: fr }) : ""}
                      </div>
                    </div>
                    <div className="text-sm font-medium">{message.subject}</div>
                    <div className="text-sm text-muted-foreground whitespace-pre-wrap">{message.body}</div>
                    
                    {message.attachments && message.attachments.length > 0 && (
                      <div className="pt-3 border-t space-y-2">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Paperclip className="w-3 h-3" />
                          <span>{message.attachments.length} piece{message.attachments.length > 1 ? 's' : ''} jointe{message.attachments.length > 1 ? 's' : ''}</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {message.attachments.map((att) => {
                            const isImage = att.mimeType.startsWith('image/');
                            const isPdf = att.mimeType === 'application/pdf';
                            const canPreview = isImage || isPdf;
                            
                            return (
                              <div
                                key={att.id}
                                className="flex items-center gap-2 p-2 rounded-md bg-muted/50 border"
                              >
                                {isImage ? (
                                  <ImageIcon className="w-5 h-5 text-blue-500 shrink-0" />
                                ) : isPdf ? (
                                  <FileText className="w-5 h-5 text-red-500 shrink-0" />
                                ) : (
                                  <FileIcon className="w-5 h-5 text-muted-foreground shrink-0" />
                                )}
                                <div className="flex flex-col flex-1 min-w-0">
                                  <span className="font-medium text-sm truncate">{att.filename}</span>
                                  <span className="text-xs text-muted-foreground">{formatSize(att.size)}</span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {canPreview && (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-8 w-8"
                                      onClick={() => handlePreviewAttachment(message.id, att)}
                                      data-testid={`preview-attachment-${att.id}`}
                                      title="Apercu"
                                    >
                                      <Eye className="w-4 h-4" />
                                    </Button>
                                  )}
                                  <a
                                    href={`/api/agentmail/attachments/${message.id}/${att.id}`}
                                    download={att.filename}
                                    className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
                                    data-testid={`download-attachment-${att.id}`}
                                    title="Telecharger"
                                  >
                                    <Download className="w-4 h-4" />
                                  </a>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
          
          <div className="p-4 pt-2 border-t shrink-0 flex justify-end">
            <Button variant="outline" onClick={() => setSelectedThreadId(null)}>
              Fermer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Attachment Preview Dialog */}
      <Dialog open={!!previewingAttachment} onOpenChange={(open) => !open && closeAttachmentPreview()}>
        <DialogContent className="max-w-4xl w-[95vw] h-[90vh] flex flex-col p-0">
          <DialogHeader className="p-4 pb-2 border-b shrink-0">
            <DialogTitle className="text-sm truncate pr-8">{previewingAttachment?.name}</DialogTitle>
            <DialogDescription className="sr-only">Apercu de la piece jointe</DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-hidden">
            {previewingAttachment && (
              previewingAttachment.mimeType.startsWith("image/") ? (
                <div className="w-full h-full flex items-center justify-center bg-black/5 dark:bg-white/5 p-4">
                  <img 
                    src={previewingAttachment.url} 
                    alt={previewingAttachment.name}
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
              ) : previewingAttachment.mimeType === "application/pdf" ? (
                <iframe 
                  src={previewingAttachment.url} 
                  className="w-full h-full border-0"
                  title={previewingAttachment.name}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
                  <FileIcon className="w-16 h-16 text-muted-foreground" />
                  <p className="text-muted-foreground">
                    Ce type de fichier ne peut pas etre previsualise
                  </p>
                </div>
              )
            )}
          </div>
          <div className="p-4 pt-2 border-t shrink-0 flex justify-between gap-2">
            <a
              href={previewingAttachment?.url || "#"}
              download={previewingAttachment?.name}
              className="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              <Download className="w-4 h-4" />
              Telecharger
            </a>
            <Button onClick={closeAttachmentPreview}>
              Fermer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
