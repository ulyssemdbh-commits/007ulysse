import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Mail, Send, RefreshCw, Inbox, User, Clock, LogOut, Reply, Forward, Loader2, Home } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

interface GmailMessage {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
}

interface GmailMessageDetail {
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
}

export default function Emails() {
  const [, navigate] = useLocation();
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [messageDialogOpen, setMessageDialogOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [newEmail, setNewEmail] = useState({ to: "", subject: "", body: "" });
  const { toast } = useToast();
  const { logout } = useAuth();

  const { data: status, isLoading: statusLoading } = useQuery<{ connected: boolean; email?: string }>({
    queryKey: ["/api/gmail/status"],
  });

  const { data: messages, isLoading: messagesLoading, refetch: refetchMessages } = useQuery<GmailMessage[]>({
    queryKey: ["/api/gmail/messages"],
    enabled: status?.connected,
  });

  const { data: messageDetail, isLoading: detailLoading } = useQuery<GmailMessageDetail>({
    queryKey: ["/api/gmail/messages", selectedMessageId],
    queryFn: async () => {
      const res = await fetch(`/api/gmail/messages/${selectedMessageId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    enabled: !!selectedMessageId && messageDialogOpen,
  });

  const sendMutation = useMutation({
    mutationFn: async (emailData: { to: string; subject: string; body: string }) => {
      return apiRequest("POST", "/api/gmail/send", emailData);
    },
    onSuccess: () => {
      toast({ title: "Email envoyé" });
      setComposeOpen(false);
      setNewEmail({ to: "", subject: "", body: "" });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
    },
    onError: (error: Error) => {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
    },
  });

  const replyMutation = useMutation({
    mutationFn: async (data: { messageId: string; body: string }) => {
      return apiRequest("POST", `/api/gmail/reply/${data.messageId}`, { body: data.body });
    },
    onSuccess: () => {
      toast({ title: "Réponse envoyée" });
      setReplyOpen(false);
      setReplyBody("");
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
    },
    onError: (error: Error) => {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
    },
  });

  const openMessage = (id: string) => {
    setSelectedMessageId(id);
    setMessageDialogOpen(true);
    setReplyOpen(false);
    setReplyBody("");
  };

  const closeMessage = () => {
    setMessageDialogOpen(false);
    setSelectedMessageId(null);
  };

  const emailList = messages || [];

  if (statusLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!status?.connected) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Gmail non connecté
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Le service Gmail n'est pas configuré. Vérifiez l'intégration Google Mail.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-4 gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/")} data-testid="button-back-dashboard">
            <Home className="w-4 h-4" />
          </Button>
          <Mail className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold" data-testid="text-email-title">Boîte de réception</h1>
            <p className="text-sm text-muted-foreground" data-testid="text-email-address">
              {status.email} (Gmail)
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchMessages()}
            data-testid="button-refresh-emails"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Actualiser
          </Button>
          <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-compose-email">
                <Send className="h-4 w-4 mr-2" />
                Nouveau
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg" aria-describedby={undefined}>
              <DialogHeader>
                <DialogTitle>Nouveau message</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <Input
                  placeholder="Destinataire (email)"
                  value={newEmail.to}
                  onChange={(e) => setNewEmail({ ...newEmail, to: e.target.value })}
                  data-testid="input-email-to"
                />
                <Input
                  placeholder="Sujet"
                  value={newEmail.subject}
                  onChange={(e) => setNewEmail({ ...newEmail, subject: e.target.value })}
                  data-testid="input-email-subject"
                />
                <Textarea
                  placeholder="Votre message..."
                  value={newEmail.body}
                  onChange={(e) => setNewEmail({ ...newEmail, body: e.target.value })}
                  rows={8}
                  data-testid="input-email-body"
                />
                <Button
                  className="w-full"
                  onClick={() => sendMutation.mutate(newEmail)}
                  disabled={sendMutation.isPending || !newEmail.to || !newEmail.subject}
                  data-testid="button-send-email"
                >
                  {sendMutation.isPending ? "Envoi..." : "Envoyer"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button
            variant="outline"
            size="sm"
            onClick={() => logout()}
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Déconnexion
          </Button>
        </div>
      </div>

      <Card className="flex-1">
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Inbox className="h-4 w-4" />
            Messages ({emailList.length})
          </CardTitle>
        </CardHeader>
        <ScrollArea className="h-[calc(100%-60px)]">
          <CardContent className="p-2 space-y-1">
            {messagesLoading ? (
              <div className="text-center py-8 text-muted-foreground">Chargement...</div>
            ) : emailList.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">Aucun email</div>
            ) : (
              emailList.map((msg) => (
                <div
                  key={msg.id}
                  className={`p-3 rounded-md cursor-pointer hover-elevate ${msg.unread ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
                  onClick={() => openMessage(msg.id)}
                  data-testid={`email-item-${msg.id}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-sm truncate max-w-[400px] ${msg.unread ? "font-bold" : "font-medium"}`}>
                      {msg.from}
                    </span>
                    <div className="flex items-center gap-2">
                      {msg.unread && (
                        <Badge variant="default" className="text-[10px] px-1.5 py-0">
                          Nouveau
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDate(msg.date)}
                      </span>
                    </div>
                  </div>
                  <div className={`text-sm truncate ${msg.unread ? "font-semibold" : ""}`}>{msg.subject}</div>
                  <div className="text-xs text-muted-foreground truncate mt-1">
                    {msg.snippet}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </ScrollArea>
      </Card>

      <Dialog open={messageDialogOpen} onOpenChange={(open) => !open && closeMessage()}>
        <DialogContent className="max-w-2xl max-h-[80vh]" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              {messageDetail?.subject || "Chargement..."}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-4 pr-4">
              {detailLoading ? (
                <div className="text-center py-8 text-muted-foreground">Chargement...</div>
              ) : messageDetail ? (
                <div className="border rounded-lg p-4" data-testid="message-detail">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{messageDetail.from}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(messageDetail.date)}
                    </span>
                  </div>
                  {messageDetail.to && (
                    <p className="text-xs text-muted-foreground mb-3">
                      À : {messageDetail.to}
                    </p>
                  )}
                  <div className="text-sm whitespace-pre-wrap leading-relaxed">{messageDetail.body}</div>

                  <div className="flex gap-2 mt-4 pt-4 border-t">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setReplyOpen(!replyOpen)}
                      data-testid="button-reply"
                    >
                      <Reply className="h-4 w-4 mr-1" />
                      Répondre
                    </Button>
                  </div>

                  {replyOpen && (
                    <div className="mt-4 space-y-3">
                      <Textarea
                        placeholder="Votre réponse..."
                        value={replyBody}
                        onChange={(e) => setReplyBody(e.target.value)}
                        rows={5}
                        data-testid="input-reply-body"
                      />
                      <Button
                        size="sm"
                        onClick={() => selectedMessageId && replyMutation.mutate({ messageId: selectedMessageId, body: replyBody })}
                        disabled={replyMutation.isPending || !replyBody.trim()}
                        data-testid="button-send-reply"
                      >
                        {replyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                        Envoyer la réponse
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  } catch {
    return dateStr;
  }
}
