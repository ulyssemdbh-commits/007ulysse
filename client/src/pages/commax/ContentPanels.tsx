import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { PLATFORMS, STATUS_CONFIG, SENTIMENT_CONFIG, getPlatformConfig, PlatformBadge } from "./config";
import {
  CheckCircle,
  Clock,
  Send,
  Trash2,
  Zap,
  Edit3,
  BookOpen,
  TrendingUp,
  FileText,
  Users,
  RefreshCcw,
  Twitter,
  Instagram,
  AlertCircle,
  Sparkles,
  Inbox,
  MessageCircle,
} from "lucide-react";

export function StatsOverview() {
  const { data: stats, isLoading } = useQuery<any>({
    queryKey: ["/api/commax/stats"],
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    );
  }

  const cards = [
    {
      label: "Comptes connectés",
      value: `${stats?.accounts?.connected ?? 0}/${stats?.accounts?.total ?? 0}`,
      sub: "plateformes actives",
      icon: Users,
      color: "text-purple-400",
      bg: "bg-purple-400/10",
    },
    {
      label: "Posts publiés",
      value: stats?.posts?.published ?? 0,
      sub: `${stats?.posts?.scheduled ?? 0} planifiés`,
      icon: FileText,
      color: "text-blue-400",
      bg: "bg-blue-400/10",
    },
    {
      label: "Mentions non lues",
      value: stats?.mentions?.unread ?? 0,
      sub: `${stats?.mentions?.total ?? 0} au total`,
      icon: Inbox,
      color: "text-orange-400",
      bg: "bg-orange-400/10",
    },
    {
      label: "Abonnés totaux",
      value: (stats?.totalFollowers ?? 0).toLocaleString("fr-FR"),
      sub: "sur tous les comptes",
      icon: TrendingUp,
      color: "text-green-400",
      bg: "bg-green-400/10",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.label} className="bg-card/60 backdrop-blur border-border/50">
            <CardContent className="p-5">
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center mb-3", card.bg)}>
                <Icon className={cn("w-5 h-5", card.color)} />
              </div>
              <div className="text-2xl font-bold text-foreground">{card.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{card.sub}</div>
              <div className="text-sm text-foreground/70 mt-1">{card.label}</div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ─── AI Composer ──────────────────────────────────────────────
export function Composer() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [content, setContent] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [tone, setTone] = useState("professionnel et engageant");
  const [scheduledAt, setScheduledAt] = useState("");
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [aiResult, setAiResult] = useState<any>(null);
  const [variations, setVariations] = useState<Record<string, string>>({});
  const [activeVariation, setActiveVariation] = useState<string | null>(null);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/commax/generate", {
        prompt,
        platforms: selectedPlatforms,
        tone,
        language: "français",
      });
      return res.json();
    },
    onSuccess: (data) => {
      setAiResult(data);
      setContent(data.content || "");
      setHashtags(data.hashtags || []);
      setVariations(data.variations || {});
      if (selectedPlatforms.length > 0) setActiveVariation(selectedPlatforms[0]);
      toast({ title: "Contenu généré !", description: "Revois et ajuste avant de publier." });
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: async (status: string) => {
      const body = {
        content: activeVariation && variations[activeVariation] ? variations[activeVariation] : content,
        platforms: selectedPlatforms,
        status,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        aiGenerated: !!aiResult,
        prompt,
        tags: hashtags,
      };
      const res = await apiRequest("POST", "/api/commax/posts", body);
      return res.json();
    },
    onSuccess: (_, status) => {
      qc.invalidateQueries({ queryKey: ["/api/commax/posts"] });
      qc.invalidateQueries({ queryKey: ["/api/commax/stats"] });
      toast({ title: status === "scheduled" ? "Post planifié !" : "Brouillon sauvegardé", description: "Retrouve-le dans la liste des posts." });
      setContent("");
      setPrompt("");
      setAiResult(null);
      setSelectedPlatforms([]);
      setHashtags([]);
      setVariations({});
      setActiveVariation(null);
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const togglePlatform = (id: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const currentContent = activeVariation && variations[activeVariation] ? variations[activeVariation] : content;

  return (
    <div className="space-y-6">
      {/* Platform selection */}
      <Card className="bg-card/60 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Plateformes cibles</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => {
              const Icon = p.icon;
              const active = selectedPlatforms.includes(p.id);
              return (
                <button
                  key={p.id}
                  data-testid={`platform-toggle-${p.id}`}
                  onClick={() => togglePlatform(p.id)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all",
                    active ? cn(p.bg, p.color, p.border, "shadow-sm scale-105") : "border-border/50 text-muted-foreground hover:border-border"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {p.label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* AI generation */}
      <Card className="bg-card/60 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-400" />
            Génération IA par Ulysse
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            data-testid="input-prompt"
            placeholder="Décris ton contenu... ex: 'Post de lancement de notre nouvelle carte de printemps au restaurant SUGU Maillane'"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            className="bg-background/50 resize-none"
          />
          <div className="flex items-center gap-3">
            <Select value={tone} onValueChange={setTone}>
              <SelectTrigger className="w-48 bg-background/50" data-testid="select-tone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="professionnel et engageant">Professionnel</SelectItem>
                <SelectItem value="décontracté et fun">Décontracté</SelectItem>
                <SelectItem value="inspirant et motivant">Inspirant</SelectItem>
                <SelectItem value="informatif et éducatif">Informatif</SelectItem>
                <SelectItem value="commercial et persuasif">Commercial</SelectItem>
                <SelectItem value="storytelling émotionnel">Storytelling</SelectItem>
              </SelectContent>
            </Select>
            <Button
              data-testid="button-generate"
              onClick={() => generateMutation.mutate()}
              disabled={!prompt || generateMutation.isPending}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {generateMutation.isPending ? (
                <><RefreshCcw className="w-4 h-4 mr-2 animate-spin" />Génération...</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" />Générer</>
              )}
            </Button>
          </div>

          {aiResult && (
            <div className="mt-2 p-3 rounded-xl bg-purple-500/5 border border-purple-500/20 space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Zap className="w-3 h-3 text-purple-400" />
                <span>Engagement estimé : <span className={cn("font-medium", aiResult.estimatedEngagement === "élevé" ? "text-green-400" : aiResult.estimatedEngagement === "moyen" ? "text-yellow-400" : "text-red-400")}>{aiResult.estimatedEngagement}</span></span>
                {aiResult.suggestedTime && <span>· Meilleur moment : <span className="text-foreground">{aiResult.suggestedTime}</span></span>}
              </div>
              {selectedPlatforms.length > 1 && (
                <div className="flex flex-wrap gap-1">
                  {selectedPlatforms.filter((p) => variations[p]).map((p) => (
                    <button
                      key={p}
                      data-testid={`variation-tab-${p}`}
                      onClick={() => setActiveVariation(p)}
                      className={cn("px-2 py-1 rounded-lg text-xs font-medium transition-all border", activeVariation === p ? "bg-purple-500/20 border-purple-500/40 text-purple-300" : "border-border/40 text-muted-foreground hover:border-border")}
                    >
                      {getPlatformConfig(p).label}
                    </button>
                  ))}
                  <button
                    onClick={() => setActiveVariation(null)}
                    className={cn("px-2 py-1 rounded-lg text-xs font-medium transition-all border", !activeVariation ? "bg-purple-500/20 border-purple-500/40 text-purple-300" : "border-border/40 text-muted-foreground hover:border-border")}
                  >
                    Version générale
                  </button>
                </div>
              )}
              {hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {hashtags.map((h) => (
                    <span key={h} className="text-xs text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-full">#{h}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Content editor */}
      <Card className="bg-card/60 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Edit3 className="w-4 h-4 text-blue-400" />
            Contenu du post
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            data-testid="input-content"
            placeholder="Écris ou modifie ton contenu ici..."
            value={currentContent}
            onChange={(e) => {
              if (activeVariation) {
                setVariations((prev) => ({ ...prev, [activeVariation]: e.target.value }));
              } else {
                setContent(e.target.value);
              }
            }}
            rows={6}
            className="bg-background/50 resize-none font-mono text-sm"
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{currentContent.length} caractères</span>
            {selectedPlatforms.includes("twitter") && (
              <span className={currentContent.length > 280 ? "text-red-400" : "text-green-400"}>
                Twitter : {280 - currentContent.length} restants
              </span>
            )}
          </div>

          {/* Schedule + Actions */}
          <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-border/30">
            <div className="flex-1 min-w-48">
              <Label className="text-xs text-muted-foreground mb-1 block">Planifier pour</Label>
              <Input
                data-testid="input-schedule"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="bg-background/50 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <Button
                data-testid="button-save-draft"
                variant="outline"
                onClick={() => saveMutation.mutate("draft")}
                disabled={!currentContent || saveMutation.isPending}
              >
                <BookOpen className="w-4 h-4 mr-2" />
                Brouillon
              </Button>
              {scheduledAt && (
                <Button
                  data-testid="button-schedule"
                  variant="outline"
                  className="border-blue-500/50 text-blue-400 hover:bg-blue-500/10"
                  onClick={() => saveMutation.mutate("scheduled")}
                  disabled={!currentContent || saveMutation.isPending}
                >
                  <Clock className="w-4 h-4 mr-2" />
                  Planifier
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Posts List ───────────────────────────────────────────────
export function PostsList() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("all");

  const { data: posts = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/commax/posts", filter],
    queryFn: async () => {
      const res = await fetch(`/api/commax/posts?status=${filter}`, { credentials: "include" });
      return res.json();
    },
  });

  const publishMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/commax/posts/${id}/publish`, {});
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/commax/posts"] });
      qc.invalidateQueries({ queryKey: ["/api/commax/stats"] });
      toast({ title: "Publié !", description: "Le post a été marqué comme publié." });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/commax/posts/${id}`, {});
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/commax/posts"] });
      qc.invalidateQueries({ queryKey: ["/api/commax/stats"] });
    },
  });

  const filterTabs = [
    { value: "all", label: "Tous" },
    { value: "draft", label: "Brouillons" },
    { value: "scheduled", label: "Planifiés" },
    { value: "published", label: "Publiés" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {filterTabs.map((t) => (
          <button
            key={t.value}
            data-testid={`filter-${t.value}`}
            onClick={() => setFilter(t.value)}
            className={cn("px-3 py-1.5 rounded-lg text-sm font-medium transition-all border", filter === t.value ? "bg-primary/10 text-primary border-primary/30" : "border-border/50 text-muted-foreground hover:border-border")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      ) : posts.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>Aucun post {filter !== "all" ? `(${filter})` : ""}</p>
          <p className="text-sm">Crée ton premier post dans l'onglet Composer</p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post: any) => {
            const statusCfg = STATUS_CONFIG[post.status] || STATUS_CONFIG.draft;
            return (
              <Card key={post.id} data-testid={`post-card-${post.id}`} className="bg-card/60 border-border/50 hover:border-border transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", statusCfg.bg, statusCfg.color)}>
                          {statusCfg.label}
                        </span>
                        {post.aiGenerated && (
                          <span className="text-xs text-purple-400 flex items-center gap-1">
                            <Sparkles className="w-3 h-3" />IA
                          </span>
                        )}
                        {(post.platforms || []).map((p: string) => <PlatformBadge key={p} platform={p} />)}
                      </div>
                      <p className="text-sm text-foreground line-clamp-3 mb-2">{post.content}</p>
                      <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
                        {post.scheduledAt && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{format(new Date(post.scheduledAt), "dd MMM yyyy HH:mm", { locale: fr })}</span>}
                        {post.publishedAt && <span className="flex items-center gap-1"><CheckCircle className="w-3 h-3 text-green-400" />{format(new Date(post.publishedAt), "dd MMM yyyy HH:mm", { locale: fr })}</span>}
                        <span>{formatDistanceToNow(new Date(post.createdAt), { addSuffix: true, locale: fr })}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {(post.status === "draft" || post.status === "scheduled") && (
                        <Button
                          data-testid={`button-publish-${post.id}`}
                          size="sm"
                          variant="ghost"
                          className="text-green-400 hover:text-green-300 hover:bg-green-400/10"
                          onClick={() => publishMutation.mutate(post.id)}
                          disabled={publishMutation.isPending}
                        >
                          <Send className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        data-testid={`button-delete-${post.id}`}
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-red-400 hover:bg-red-400/10"
                        onClick={() => deleteMutation.mutate(post.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Inbox / Mentions ─────────────────────────────────────────
export function MentionsInbox() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: mentions = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/commax/mentions"],
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/commax/mentions/${id}`, { isRead: true });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/commax/mentions"] }),
  });

  const [replyingTo, setReplyingTo] = useState<any>(null);
  const [replyText, setReplyText] = useState("");

  const generateReplyMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/commax/mentions/${id}/reply`, {});
      return res.json();
    },
    onSuccess: (data) => setReplyText(data.reply || ""),
  });

  const saveReplyMutation = useMutation({
    mutationFn: async ({ id, reply }: { id: number; reply: string }) => {
      const res = await apiRequest("PATCH", `/api/commax/mentions/${id}`, { isReplied: true, reply, isRead: true });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/commax/mentions"] });
      qc.invalidateQueries({ queryKey: ["/api/commax/stats"] });
      setReplyingTo(null);
      setReplyText("");
      toast({ title: "Réponse sauvegardée" });
    },
  });

  const unread = mentions.filter((m: any) => !m.isRead);

  return (
    <div className="space-y-4">
      {unread.length > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-orange-400/5 border border-orange-400/20">
          <AlertCircle className="w-4 h-4 text-orange-400" />
          <span className="text-sm text-orange-300">{unread.length} message{unread.length > 1 ? "s" : ""} non lu{unread.length > 1 ? "s" : ""}</span>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : mentions.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Inbox className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>Aucun message dans l'inbox</p>
          <p className="text-sm">Les mentions et commentaires apparaîtront ici</p>
        </div>
      ) : (
        <div className="space-y-3">
          {mentions.map((mention: any) => {
            const sentimentCfg = mention.sentiment ? SENTIMENT_CONFIG[mention.sentiment] : null;
            const SentimentIcon = sentimentCfg?.icon;
            return (
              <Card
                key={mention.id}
                data-testid={`mention-card-${mention.id}`}
                className={cn("bg-card/60 border-border/50 transition-all", !mention.isRead && "border-orange-400/30 bg-orange-400/5")}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Avatar className="w-9 h-9 shrink-0">
                      <AvatarImage src={mention.authorAvatarUrl} />
                      <AvatarFallback className="text-xs">{(mention.authorName || "?")[0]}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-medium">{mention.authorName || mention.authorHandle}</span>
                        {mention.authorHandle && <span className="text-xs text-muted-foreground">@{mention.authorHandle}</span>}
                        <PlatformBadge platform={mention.platform} />
                        <Badge variant="outline" className="text-xs capitalize">{mention.type}</Badge>
                        {sentimentCfg && SentimentIcon && (
                          <span className={cn("text-xs flex items-center gap-1", sentimentCfg.color)}>
                            <SentimentIcon className="w-3 h-3" />{sentimentCfg.label}
                          </span>
                        )}
                        {mention.isReplied && <span className="text-xs text-green-400 flex items-center gap-1"><CheckCircle className="w-3 h-3" />Répondu</span>}
                      </div>
                      <p className="text-sm text-foreground/80 mb-2">{mention.content}</p>
                      {mention.reply && (
                        <div className="text-xs text-muted-foreground italic bg-secondary/30 px-3 py-2 rounded-lg mb-2">
                          Réponse : {mention.reply}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(mention.receivedAt || mention.createdAt), { addSuffix: true, locale: fr })}
                        </span>
                        {!mention.isRead && (
                          <button
                            data-testid={`button-mark-read-${mention.id}`}
                            onClick={() => markReadMutation.mutate(mention.id)}
                            className="text-xs text-muted-foreground hover:text-foreground underline"
                          >
                            Marquer lu
                          </button>
                        )}
                        <button
                          data-testid={`button-reply-${mention.id}`}
                          onClick={() => { setReplyingTo(mention); setReplyText(""); }}
                          className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                        >
                          <MessageCircle className="w-3 h-3" />Répondre
                        </button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Reply Dialog */}
      <Dialog open={!!replyingTo} onOpenChange={() => { setReplyingTo(null); setReplyText(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Répondre à @{replyingTo?.authorHandle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-secondary/30 text-sm text-muted-foreground italic">
              "{replyingTo?.content}"
            </div>
            <div>
              <Button
                data-testid="button-ai-reply"
                variant="outline"
                size="sm"
                onClick={() => generateReplyMutation.mutate(replyingTo?.id)}
                disabled={generateReplyMutation.isPending}
                className="mb-2"
              >
                <Sparkles className="w-4 h-4 mr-2 text-purple-400" />
                {generateReplyMutation.isPending ? "Génération..." : "Générer avec Ulysse"}
              </Button>
              <Textarea
                data-testid="input-reply"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Tape ta réponse..."
                rows={4}
                className="bg-background/50"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setReplyingTo(null); setReplyText(""); }}>Annuler</Button>
              <Button
                data-testid="button-save-reply"
                onClick={() => saveReplyMutation.mutate({ id: replyingTo?.id, reply: replyText })}
                disabled={!replyText || saveReplyMutation.isPending}
              >
                <Send className="w-4 h-4 mr-2" />
                Sauvegarder
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Instagram Connect Dialog ─────────────────────────────────
