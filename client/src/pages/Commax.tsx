import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { PageContainer } from "@/components/layout/PageContainer";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  Users, FileText, BarChart2, Inbox, Layers, Plus, Sparkles,
  Send, Clock, Edit3, Trash2, CheckCircle, XCircle, Eye,
  RefreshCcw, MessageCircle, Heart, Share2, TrendingUp,
  Twitter, Instagram, Linkedin, Facebook, Youtube, Globe,
  ChevronRight, AlertCircle, Calendar, Zap, Copy, BookOpen,
  MoreHorizontal, ThumbsUp, ThumbsDown, Minus, X, Loader2, Bot,
  NotebookPen, Tag
} from "lucide-react";
import { SiTiktok, SiThreads, SiPinterest } from "react-icons/si";
import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

// ─── Platform config ──────────────────────────────────────────
const PLATFORMS = [
  { id: "twitter", label: "Twitter / X", icon: Twitter, color: "text-sky-400", bg: "bg-sky-400/10", border: "border-sky-400/30" },
  { id: "instagram", label: "Instagram", icon: Instagram, color: "text-pink-400", bg: "bg-pink-400/10", border: "border-pink-400/30" },
  { id: "linkedin", label: "LinkedIn", icon: Linkedin, color: "text-blue-400", bg: "bg-blue-400/10", border: "border-blue-400/30" },
  { id: "facebook", label: "Facebook", icon: Facebook, color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/30" },
  { id: "tiktok", label: "TikTok", icon: SiTiktok, color: "text-white", bg: "bg-white/10", border: "border-white/20" },
  { id: "youtube", label: "YouTube", icon: Youtube, color: "text-red-400", bg: "bg-red-400/10", border: "border-red-400/30" },
  { id: "threads", label: "Threads", icon: SiThreads, color: "text-gray-300", bg: "bg-gray-300/10", border: "border-gray-300/20" },
  { id: "pinterest", label: "Pinterest", icon: SiPinterest, color: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/30" },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: "Brouillon", color: "text-yellow-400", bg: "bg-yellow-400/10" },
  scheduled: { label: "Planifié", color: "text-blue-400", bg: "bg-blue-400/10" },
  published: { label: "Publié", color: "text-green-400", bg: "bg-green-400/10" },
  failed: { label: "Échec", color: "text-red-400", bg: "bg-red-400/10" },
};

const SENTIMENT_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  positive: { icon: ThumbsUp, color: "text-green-400", label: "Positif" },
  neutral: { icon: Minus, color: "text-gray-400", label: "Neutre" },
  negative: { icon: ThumbsDown, color: "text-red-400", label: "Négatif" },
};

function getPlatformConfig(id: string) {
  return PLATFORMS.find((p) => p.id === id) || PLATFORMS[0];
}

function PlatformBadge({ platform }: { platform: string }) {
  const cfg = getPlatformConfig(platform);
  const Icon = cfg.icon as any;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border", cfg.bg, cfg.color, cfg.border)}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

// ─── Stats Overview ───────────────────────────────────────────
function StatsOverview() {
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
function Composer() {
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
              const Icon = p.icon as any;
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
function PostsList() {
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
function MentionsInbox() {
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
function InstagramConnectDialog({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (v: boolean) => void; onSuccess: () => void }) {
  const { toast } = useToast();
  const [step, setStep] = useState<"guide" | "token">("guide");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleConnect() {
    if (!token.trim()) return;
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/commax/oauth/instagram/token", { token: token.trim() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur");
      toast({
        title: "Instagram connecté !",
        description: `@${data.instagramUsername} · ${data.longLived ? "Token 60 jours" : "Token court"}`,
      });
      setToken("");
      setStep("guide");
      onOpenChange(false);
      onSuccess();
    } catch (e: any) {
      toast({ title: "Erreur", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setStep("guide"); setToken(""); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Instagram className="w-5 h-5 text-pink-400" />
            Connecter Instagram
          </DialogTitle>
        </DialogHeader>

        {step === "guide" ? (
          <div className="space-y-4">
            <div className="bg-pink-500/5 border border-pink-500/20 rounded-lg p-4">
              <p className="text-sm font-medium text-pink-300 mb-2">Prérequis</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• Compte Instagram <strong>Business</strong> ou <strong>Creator</strong></li>
                <li>• Lié à une Page Facebook</li>
              </ul>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium">Comment obtenir ton token (5 min) :</p>
              {[
                { n: 1, title: "Va sur le Graph API Explorer", url: "https://developers.facebook.com/tools/explorer", desc: "Connecte-toi avec ton compte Facebook" },
                { n: 2, title: "Sélectionne ton App", desc: "Si tu n'as pas d'app, crée-en une sur developers.facebook.com" },
                { n: 3, title: "Ajoute les permissions", desc: "instagram_basic · instagram_content_publish · pages_show_list · pages_read_engagement" },
                { n: 4, title: "Génère le token", desc: "Clique sur \"Generate Access Token\" → autorise → copie le token" },
              ].map((s) => (
                <div key={s.n} className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-pink-500/20 text-pink-400 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{s.n}</div>
                  <div>
                    <p className="text-sm font-medium">{s.title}</p>
                    <p className="text-xs text-muted-foreground">{s.desc}</p>
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-xs text-pink-400 hover:text-pink-300 flex items-center gap-1 mt-0.5">
                        Ouvrir le Graph Explorer →
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
              <Button data-testid="button-instagram-next" onClick={() => setStep("token")} className="bg-pink-500/20 text-pink-300 border border-pink-500/30 hover:bg-pink-500/30">
                J'ai mon token →
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label className="text-sm">Access Token Instagram</Label>
              <Textarea
                data-testid="input-instagram-token"
                className="mt-1 font-mono text-xs min-h-[100px]"
                placeholder="EAABs... (colle ton token ici)"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Le token sera validé puis échangé contre un token 60 jours si ton App Meta est configurée.
              </p>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setStep("guide")}>← Retour</Button>
              <Button
                data-testid="button-instagram-connect"
                onClick={handleConnect}
                disabled={!token.trim() || loading}
                className="bg-gradient-to-r from-pink-500/80 to-purple-500/80 text-white hover:from-pink-500 hover:to-purple-500"
              >
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Instagram className="w-4 h-4 mr-2" />}
                Connecter
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Accounts Manager ─────────────────────────────────────────
function AccountsManager() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showInstagramDialog, setShowInstagramDialog] = useState(false);
  const [newAccount, setNewAccount] = useState({
    platform: "twitter",
    accountName: "",
    accountHandle: "",
    followersCount: 0,
  });

  // Handle OAuth callback from URL (after redirect from Meta OAuth)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthSuccess = params.get("oauth_success");
    const oauthError = params.get("oauth_error");
    const token = params.get("token");
    if (oauthSuccess && token) {
      const accountName = params.get("name") || "Instagram";
      apiRequest("POST", "/api/commax/oauth/instagram/token", { token, accountName })
        .then((r) => r.json())
        .then((data) => {
          if (data.success) {
            qc.invalidateQueries({ queryKey: ["/api/commax/accounts"] });
            toast({ title: "Instagram connecté via OAuth !", description: `@${data.instagramUsername}` });
          }
        })
        .catch(() => {});
      const newUrl = window.location.pathname;
      window.history.replaceState({}, "", newUrl);
    } else if (oauthError) {
      toast({ title: "Erreur OAuth", description: decodeURIComponent(oauthError), variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const { data: accounts = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/commax/accounts"],
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/commax/accounts", {
        ...newAccount,
        status: "connected",
        followersCount: Number(newAccount.followersCount),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/commax/accounts"] });
      qc.invalidateQueries({ queryKey: ["/api/commax/stats"] });
      setShowAddDialog(false);
      setNewAccount({ platform: "twitter", accountName: "", accountHandle: "", followersCount: 0 });
      toast({ title: "Compte ajouté !" });
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/commax/accounts/${id}`, {});
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/commax/accounts"] });
      qc.invalidateQueries({ queryKey: ["/api/commax/stats"] });
    },
  });

  const toggleStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await apiRequest("PATCH", `/api/commax/accounts/${id}`, { status });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/commax/accounts"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="font-medium">Comptes connectés</h3>
          <p className="text-sm text-muted-foreground">Gère tes comptes sociaux et leurs statuts</p>
        </div>
        <div className="flex gap-2">
          <Button
            data-testid="button-connect-instagram"
            variant="outline"
            className="border-pink-500/30 text-pink-400 hover:bg-pink-500/10 hover:text-pink-300"
            onClick={() => setShowInstagramDialog(true)}
          >
            <Instagram className="w-4 h-4 mr-2" />Instagram
          </Button>
          <Button data-testid="button-add-account" onClick={() => setShowAddDialog(true)}>
            <Plus className="w-4 h-4 mr-2" />Ajouter
          </Button>
        </div>
      </div>

      <InstagramConnectDialog
        open={showInstagramDialog}
        onOpenChange={setShowInstagramDialog}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ["/api/commax/accounts"] });
          qc.invalidateQueries({ queryKey: ["/api/commax/stats"] });
        }}
      />

      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : accounts.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>Aucun compte configuré</p>
          <p className="text-sm">Clique sur "Ajouter un compte" pour commencer</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {accounts.map((account: any) => {
            const cfg = getPlatformConfig(account.platform);
            const Icon = cfg.icon as any;
            const isConnected = account.status === "connected";
            return (
              <Card key={account.id} data-testid={`account-card-${account.id}`} className="bg-card/60 border-border/50">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center border", cfg.bg, cfg.border)}>
                      <Icon className={cn("w-5 h-5", cfg.color)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{account.accountName}</div>
                      {account.accountHandle && <div className="text-xs text-muted-foreground">@{account.accountHandle}</div>}
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span>{(account.followersCount || 0).toLocaleString("fr-FR")} abonnés</span>
                        <span className={cn("flex items-center gap-1", isConnected ? "text-green-400" : "text-gray-400")}>
                          <div className={cn("w-1.5 h-1.5 rounded-full", isConnected ? "bg-green-400" : "bg-gray-400")} />
                          {isConnected ? "Connecté" : "Déconnecté"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Switch
                        data-testid={`switch-account-${account.id}`}
                        checked={isConnected}
                        onCheckedChange={(v) => toggleStatus.mutate({ id: account.id, status: v ? "connected" : "disconnected" })}
                      />
                      <Button
                        data-testid={`button-delete-account-${account.id}`}
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-red-400 hover:bg-red-400/10"
                        onClick={() => deleteMutation.mutate(account.id)}
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

      {/* OAuth Info */}
      <Card className="bg-blue-500/5 border-blue-500/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-blue-300 mb-1">Publication réelle via OAuth</p>
              <p className="text-muted-foreground text-xs">
                Pour activer la publication directe, configure les clés OAuth de chaque plateforme dans les variables d'environnement (TWITTER_API_KEY, INSTAGRAM_ACCESS_TOKEN, etc.). Ulysse prendra en charge la publication automatique une fois les tokens configurés.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Add account dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajouter un compte social</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Plateforme</Label>
              <Select value={newAccount.platform} onValueChange={(v) => setNewAccount((p) => ({ ...p, platform: v }))}>
                <SelectTrigger data-testid="select-platform" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Nom du compte</Label>
              <Input
                data-testid="input-account-name"
                placeholder="ex: SUGU Valentine"
                value={newAccount.accountName}
                onChange={(e) => setNewAccount((p) => ({ ...p, accountName: e.target.value }))}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Handle / Pseudo</Label>
              <Input
                data-testid="input-account-handle"
                placeholder="ex: @suguvallentine"
                value={newAccount.accountHandle}
                onChange={(e) => setNewAccount((p) => ({ ...p, accountHandle: e.target.value }))}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Nombre d'abonnés</Label>
              <Input
                data-testid="input-followers"
                type="number"
                value={newAccount.followersCount}
                onChange={(e) => setNewAccount((p) => ({ ...p, followersCount: parseInt(e.target.value) || 0 }))}
                className="mt-1"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>Annuler</Button>
              <Button
                data-testid="button-confirm-add-account"
                onClick={() => addMutation.mutate()}
                disabled={!newAccount.accountName || addMutation.isPending}
              >
                Ajouter
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Analytics ────────────────────────────────────────────────
function Analytics() {
  const { data: posts = [] } = useQuery<any[]>({ queryKey: ["/api/commax/posts"] });
  const { data: accounts = [] } = useQuery<any[]>({ queryKey: ["/api/commax/accounts"] });

  const published = posts.filter((p: any) => p.status === "published");
  const platformCounts: Record<string, number> = {};
  for (const post of published) {
    for (const platform of (post.platforms || [])) {
      platformCounts[platform] = (platformCounts[platform] || 0) + 1;
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-card/60 border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-xl bg-green-400/10 flex items-center justify-center">
                <Send className="w-4 h-4 text-green-400" />
              </div>
              <div>
                <div className="text-2xl font-bold">{published.length}</div>
                <div className="text-xs text-muted-foreground">Posts publiés</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/60 border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-xl bg-blue-400/10 flex items-center justify-center">
                <Users className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {accounts.reduce((s: number, a: any) => s + (a.followersCount || 0), 0).toLocaleString("fr-FR")}
                </div>
                <div className="text-xs text-muted-foreground">Abonnés totaux</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/60 border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-xl bg-purple-400/10 flex items-center justify-center">
                <BarChart2 className="w-4 h-4 text-purple-400" />
              </div>
              <div>
                <div className="text-2xl font-bold">{accounts.filter((a: any) => a.status === "connected").length}</div>
                <div className="text-xs text-muted-foreground">Plateformes actives</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Posts per platform */}
      <Card className="bg-card/60 border-border/50">
        <CardHeader>
          <CardTitle className="text-sm">Posts publiés par plateforme</CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(platformCounts).length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Aucun post publié pour l'instant
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(platformCounts).sort(([, a], [, b]) => b - a).map(([platform, count]) => {
                const cfg = getPlatformConfig(platform);
                const Icon = cfg.icon as any;
                const max = Math.max(...Object.values(platformCounts));
                return (
                  <div key={platform} className="flex items-center gap-3">
                    <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center border shrink-0", cfg.bg, cfg.border)}>
                      <Icon className={cn("w-4 h-4", cfg.color)} />
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm">{cfg.label}</span>
                        <span className="text-sm font-medium">{count}</span>
                      </div>
                      <div className="h-2 bg-secondary rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all", cfg.bg.replace("bg-", "bg-"))}
                          style={{ width: `${(count / max) * 100}%`, backgroundColor: undefined }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Accounts detail */}
      <Card className="bg-card/60 border-border/50">
        <CardHeader>
          <CardTitle className="text-sm">Détail des comptes</CardTitle>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Aucun compte configuré</div>
          ) : (
            <div className="space-y-2">
              {accounts.map((account: any) => {
                const cfg = getPlatformConfig(account.platform);
                const Icon = cfg.icon as any;
                return (
                  <div key={account.id} className="flex items-center justify-between p-3 rounded-xl bg-secondary/20">
                    <div className="flex items-center gap-3">
                      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", cfg.bg)}>
                        <Icon className={cn("w-4 h-4", cfg.color)} />
                      </div>
                      <div>
                        <div className="text-sm font-medium">{account.accountName}</div>
                        {account.accountHandle && <div className="text-xs text-muted-foreground">@{account.accountHandle}</div>}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium">{(account.followersCount || 0).toLocaleString("fr-FR")}</div>
                      <div className="text-xs text-muted-foreground">abonnés</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Templates ────────────────────────────────────────────────
function Templates() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ name: "", content: "", platforms: [] as string[], tags: [] as string[] });
  const [tagInput, setTagInput] = useState("");

  const { data: templates = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/commax/templates"],
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/commax/templates", newTemplate);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/commax/templates"] });
      setShowAdd(false);
      setNewTemplate({ name: "", content: "", platforms: [], tags: [] });
      toast({ title: "Template créé !" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/commax/templates/${id}`, {});
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/commax/templates"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="font-medium">Templates de contenu</h3>
          <p className="text-sm text-muted-foreground">Réutilise tes formats de posts préférés</p>
        </div>
        <Button data-testid="button-add-template" onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4 mr-2" />Nouveau template
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      ) : templates.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Layers className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>Aucun template</p>
          <p className="text-sm">Crée des modèles pour accélérer ta création de contenu</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {templates.map((t: any) => (
            <Card key={t.id} data-testid={`template-card-${t.id}`} className="bg-card/60 border-border/50 hover:border-border transition-colors">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="font-medium text-sm">{t.name}</div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => { navigator.clipboard.writeText(t.content); toast({ title: "Copié !" }); }}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      data-testid={`button-delete-template-${t.id}`}
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-red-400 hover:bg-red-400/10"
                      onClick={() => deleteMutation.mutate(t.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-3 mb-3">{t.content}</p>
                <div className="flex flex-wrap gap-1">
                  {(t.platforms || []).map((p: string) => <PlatformBadge key={p} platform={p} />)}
                  {(t.tags || []).map((tag: string) => (
                    <span key={tag} className="text-xs text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-full">#{tag}</span>
                  ))}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">Utilisé {t.usageCount || 0} fois</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouveau template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nom du template</Label>
              <Input
                data-testid="input-template-name"
                value={newTemplate.name}
                onChange={(e) => setNewTemplate((p) => ({ ...p, name: e.target.value }))}
                placeholder="ex: Post d'annonce événement"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Contenu</Label>
              <Textarea
                data-testid="input-template-content"
                value={newTemplate.content}
                onChange={(e) => setNewTemplate((p) => ({ ...p, content: e.target.value }))}
                placeholder="Écris ton template ici... Tu peux utiliser des variables comme {nom}, {date}, etc."
                rows={5}
                className="mt-1 bg-background/50"
              />
            </div>
            <div>
              <Label>Plateformes cibles</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {PLATFORMS.slice(0, 6).map((p) => {
                  const active = newTemplate.platforms.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => setNewTemplate((prev) => ({
                        ...prev,
                        platforms: active ? prev.platforms.filter((x) => x !== p.id) : [...prev.platforms, p.id],
                      }))}
                      className={cn("px-2 py-1 rounded-lg border text-xs font-medium transition-all", active ? "bg-primary/10 text-primary border-primary/30" : "border-border/50 text-muted-foreground")}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowAdd(false)}>Annuler</Button>
              <Button
                data-testid="button-confirm-template"
                onClick={() => addMutation.mutate()}
                disabled={!newTemplate.name || !newTemplate.content || addMutation.isPending}
              >
                Créer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Mini Iris Chat ────────────────────────────────────────────
interface MiniMsg { role: "user" | "iris"; content: string; streaming?: boolean }

function MiniIrisChat({ open, onClose, initialMsg }: { open: boolean; onClose: () => void; initialMsg?: string }) {
  const [messages, setMessages] = useState<MiniMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastSentMsg = useRef<string | null>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    const greeting = initialMsg || "Bonjour Iris ! Je suis sur Commax et je suis prête à travailler avec toi. Qu'est-ce qu'on fait aujourd'hui ?";
    if (greeting !== lastSentMsg.current) {
      lastSentMsg.current = greeting;
      sendMessage(greeting, true);
    }
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [open, initialMsg]);

  async function sendMessage(text: string, isAuto = false) {
    if (!text.trim() || loading) return;
    if (!isAuto) setInput("");
    setMessages(prev => [...prev, { role: "user", content: text }]);
    setLoading(true);

    const placeholder: MiniMsg = { role: "iris", content: "", streaming: true };
    setMessages(prev => [...prev, placeholder]);

    try {
      const resp = await fetch("/api/superchat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: text,
          respondents: ["iris"],
          sessionId: sessionId || undefined,
        }),
      });

      if (!resp.body) throw new Error("No stream");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "session" && evt.sessionId) setSessionId(evt.sessionId);
            if (evt.type === "chunk" && evt.sender === "iris") {
              accumulated += evt.content || "";
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === "iris") updated[updated.length - 1] = { ...last, content: accumulated, streaming: true };
                return updated;
              });
            }
          } catch {}
        }
      }

      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "iris") updated[updated.length - 1] = { ...last, streaming: false };
        return updated;
      });

      if (accumulated.length > 20) {
        const titleText = text.length > 80 ? text.substring(0, 80) + "…" : text;
        fetch("/api/commax/journal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            type: "session",
            title: `💬 ${titleText}`,
            content: accumulated.substring(0, 600),
            platforms: [],
          }),
        }).catch(() => {});
      }
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "iris") updated[updated.length - 1] = { role: "iris", content: "❌ Erreur de connexion. Réessaie." };
        return updated;
      });
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed bottom-24 right-6 z-50 w-[380px] flex flex-col rounded-2xl border border-pink-500/25 bg-card shadow-2xl shadow-pink-500/15 overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-pink-500/15 to-rose-500/10 border-b border-pink-500/20 flex-shrink-0">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-pink-500 to-rose-500 flex items-center justify-center shadow-sm text-lg">🌸</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white leading-none">Iris</p>
          <p className="text-[11px] text-pink-300/80 mt-0.5">Senior Community Manager · Commax</p>
        </div>
        <span className="w-2 h-2 rounded-full bg-green-400 shadow-sm shadow-green-400/50 flex-shrink-0" />
        <button
          data-testid="button-mini-iris-close"
          onClick={onClose}
          className="ml-1 w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[240px] max-h-[340px]">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted-foreground text-xs">
              <div className="text-2xl mb-2">🌸</div>
              <p>Iris arrive…</p>
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={cn("flex gap-2", msg.role === "user" ? "justify-end" : "justify-start")}>
            {msg.role === "iris" && (
              <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-pink-500 to-rose-500 flex-shrink-0 flex items-center justify-center text-xs mt-0.5">🌸</div>
            )}
            <div className={cn(
              "max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
              msg.role === "user"
                ? "bg-primary text-primary-foreground rounded-tr-sm"
                : "bg-muted text-foreground rounded-tl-sm"
            )}>
              {msg.content || (msg.streaming ? (
                <span className="inline-flex gap-0.5 items-center">
                  <span className="w-1 h-1 bg-pink-400 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1 h-1 bg-pink-400 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1 h-1 bg-pink-400 rounded-full animate-bounce [animation-delay:300ms]" />
                </span>
              ) : "")}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 p-3 border-t border-border/50 bg-card/50 flex-shrink-0">
        <input
          ref={inputRef}
          data-testid="input-mini-iris-chat"
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
          placeholder="Écris à Iris…"
          disabled={loading}
          className="flex-1 text-sm bg-muted/50 border border-border/50 rounded-xl px-3 py-2 focus:outline-none focus:border-pink-500/50 disabled:opacity-60 placeholder:text-muted-foreground/60"
        />
        <button
          data-testid="button-mini-iris-send"
          onClick={() => sendMessage(input)}
          disabled={loading || !input.trim()}
          className="w-9 h-9 rounded-xl bg-gradient-to-tr from-pink-500 to-rose-500 flex items-center justify-center text-white hover:opacity-90 transition-opacity disabled:opacity-40 flex-shrink-0"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

// ─── Iris Gateway Widget ──────────────────────────────────────
function IrisGateway({ onOpen }: { onOpen: (msg?: string) => void }) {
  const [pulse, setPulse] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setPulse(false), 4000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {pulse && (
        <div className="bg-card border border-pink-500/30 rounded-2xl p-3 shadow-xl shadow-pink-500/10 max-w-[220px] animate-in slide-in-from-bottom-2 duration-500">
          <p className="text-xs text-pink-300 font-medium">🌸 Iris est disponible</p>
          <p className="text-xs text-muted-foreground mt-0.5">Clique pour lui parler ici</p>
        </div>
      )}
      <button
        data-testid="button-iris-gateway"
        onClick={() => onOpen()}
        className="group relative w-14 h-14 rounded-2xl bg-gradient-to-tr from-pink-600 to-rose-500 flex items-center justify-center shadow-lg shadow-pink-500/30 hover:scale-110 transition-all duration-200 hover:shadow-pink-500/50"
        title="Parler à Iris — Community Manager"
      >
        <span className="text-2xl select-none">🌸</span>
        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-green-400 rounded-full border-2 border-background shadow-sm" />
      </button>
    </div>
  );
}

// ─── Iris Delegation Screen (Composer tab) ────────────────────
function IrisComposerDelegate({ onOpen }: { onOpen: (msg: string) => void }) {
  const actions = [
    { icon: "✍️", label: "Créer un post", msg: "Crée un nouveau post pour mes réseaux sociaux. Demande-moi le sujet, le ton et les plateformes cibles." },
    { icon: "📅", label: "Planifier une campagne", msg: "Je veux planifier une campagne sur les réseaux sociaux. Aide-moi à définir le calendrier éditorial, les plateformes et les messages clés." },
    { icon: "🎯", label: "Idées de contenu", msg: "Propose-moi des idées de contenu créatives et stratégiques pour mes réseaux sociaux cette semaine. Inspire-toi des tendances actuelles." },
    { icon: "📊", label: "Audit stratégique", msg: "Fais un audit de ma stratégie social media actuelle dans Commax et propose des axes d'amélioration." },
    { icon: "💬", label: "Gérer l'inbox", msg: "Vérifie les mentions et commentaires non lus dans Commax et aide-moi à y répondre de façon engageante." },
    { icon: "🔥", label: "Post viral", msg: "Génère un post à fort potentiel viral adapté à chaque plateforme (Twitter, Instagram, LinkedIn, TikTok). Sujet au choix." },
  ];

  return (
    <div className="space-y-6">
      {/* Iris CM Card */}
      <div className="relative overflow-hidden rounded-2xl border border-pink-500/20 bg-gradient-to-br from-pink-500/10 via-rose-500/5 to-transparent p-6">
        <div className="absolute inset-0 bg-gradient-to-br from-pink-600/5 to-transparent pointer-events-none" />
        <div className="relative flex items-start gap-4">
          <div className="w-14 h-14 flex-shrink-0 rounded-2xl bg-gradient-to-tr from-pink-500 to-rose-500 flex items-center justify-center shadow-lg shadow-pink-500/30 text-2xl">
            🌸
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-lg font-bold text-white">Iris</h2>
              <span className="px-2 py-0.5 rounded-full bg-pink-500/20 border border-pink-500/30 text-pink-300 text-xs font-medium">Senior Community Manager</span>
            </div>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Iris gère exclusivement le Commax. Stratégie éditoriale, création de contenu, campagnes, analytics et community management — tout passe par elle. Dis-lui ce que tu veux et elle s'en occupe.
            </p>
            <button
              data-testid="button-open-iris-superchat"
              onClick={() => onOpen("Bonjour Iris ! Je suis sur Commax et j'ai besoin de ton aide pour gérer mes réseaux sociaux.")}
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-pink-500/20 hover:bg-pink-500/30 border border-pink-500/30 text-pink-300 text-sm font-medium transition-all duration-200 hover:scale-105"
            >
              <MessageCircle className="w-4 h-4" />
              Ouvrir le chat Iris
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Actions rapides — déléguer à Iris</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {actions.map((action) => (
            <button
              key={action.label}
              data-testid={`button-iris-action-${action.label.toLowerCase().replace(/\s+/g, "-")}`}
              onClick={() => onOpen(action.msg)}
              className="group flex items-center gap-3 p-4 rounded-xl border border-border/50 bg-card/40 hover:bg-card/70 hover:border-pink-500/30 transition-all duration-200 text-left"
            >
              <span className="text-xl flex-shrink-0">{action.icon}</span>
              <div>
                <p className="text-sm font-medium text-white group-hover:text-pink-200 transition-colors">{action.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{action.msg.substring(0, 50)}…</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-pink-400 ml-auto flex-shrink-0 transition-colors" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Journal Type Config ─────────────────────────────────────
const JOURNAL_TYPES: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  session:         { label: "Session", color: "text-pink-400",   bg: "bg-pink-400/10",   icon: "💬" },
  post_created:    { label: "Post créé", color: "text-blue-400",  bg: "bg-blue-400/10",   icon: "✍️" },
  campaign:        { label: "Campagne", color: "text-purple-400", bg: "bg-purple-400/10", icon: "🚀" },
  mention_replied: { label: "Mention",  color: "text-yellow-400", bg: "bg-yellow-400/10", icon: "💌" },
  content_idea:    { label: "Idée",     color: "text-green-400",  bg: "bg-green-400/10",  icon: "💡" },
  analytics:       { label: "Analytics",color: "text-cyan-400",   bg: "bg-cyan-400/10",   icon: "📊" },
  action:          { label: "Action",   color: "text-orange-400", bg: "bg-orange-400/10", icon: "⚡" },
  note:            { label: "Note",     color: "text-gray-400",   bg: "bg-gray-400/10",   icon: "📝" },
};

function IrisCmJournal() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: entries = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/commax/journal"],
    refetchInterval: 15000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/commax/journal/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/commax/journal"] });
      toast({ title: "Entrée supprimée" });
    },
  });

  const grouped: Record<string, any[]> = {};
  for (const entry of entries) {
    const day = entry.date || entry.createdAt?.split("T")[0] || "—";
    if (!grouped[day]) grouped[day] = [];
    grouped[day].push(entry);
  }
  const days = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  if (isLoading) {
    return (
      <div className="space-y-3 py-6">
        {[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-pink-500/10 flex items-center justify-center text-3xl">📓</div>
        <div>
          <p className="font-semibold text-white mb-1">Le journal d'Iris est vide</p>
          <p className="text-sm text-muted-foreground max-w-xs">Les activités d'Iris apparaîtront ici automatiquement après chaque session ou action.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {days.map(day => (
        <div key={day}>
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {(() => {
                try { return format(new Date(day), "EEEE d MMMM yyyy", { locale: fr }); } catch { return day; }
              })()}
            </span>
            <div className="flex-1 h-px bg-border/40" />
            <span className="text-xs text-muted-foreground">{grouped[day].length} entrée{grouped[day].length > 1 ? "s" : ""}</span>
          </div>
          <div className="space-y-3">
            {grouped[day].map((entry: any) => {
              const cfg = JOURNAL_TYPES[entry.type] || JOURNAL_TYPES.note;
              return (
                <div
                  key={entry.id}
                  data-testid={`journal-entry-${entry.id}`}
                  className="group relative flex gap-3 p-4 rounded-xl border border-border/50 bg-card/40 hover:bg-card/70 transition-all duration-200"
                >
                  <div className={cn("w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center text-lg", cfg.bg)}>
                    {cfg.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="font-medium text-sm text-white leading-snug line-clamp-2">{entry.title}</p>
                      <button
                        data-testid={`button-delete-journal-${entry.id}`}
                        onClick={() => deleteMut.mutate(entry.id)}
                        className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-all flex-shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{entry.content}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium", cfg.bg, cfg.color)}>
                        <Tag className="w-2.5 h-2.5" />
                        {cfg.label}
                      </span>
                      {(entry.platforms || []).map((p: string) => (
                        <PlatformBadge key={p} platform={p} />
                      ))}
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        {entry.createdAt ? formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true, locale: fr }) : ""}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CommaxPage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [miniChatOpen, setMiniChatOpen] = useState(false);
  const [miniChatMsg, setMiniChatMsg] = useState<string | undefined>(undefined);

  const openMiniChat = (msg?: string) => {
    setMiniChatMsg(msg);
    setMiniChatOpen(true);
  };

  return (
    <PageContainer title="Commax — Community Management">
      <div className="space-y-6">
        {/* Header with Iris CM badge */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
                <Globe className="w-5 h-5 text-white" />
              </div>
              Commax
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Community Management propulsé par Ulysse · ulyssepro.org/commax</p>
          </div>
          {/* Iris CM pill */}
          <button
            data-testid="button-iris-cm-header"
            onClick={() => openMiniChat("Bonjour Iris, je suis dans Commax !")}
            className="flex items-center gap-2.5 px-4 py-2 rounded-2xl bg-gradient-to-r from-pink-500/15 to-rose-500/10 border border-pink-500/25 hover:border-pink-500/50 hover:bg-pink-500/20 transition-all duration-200 group"
          >
            <span className="text-lg">🌸</span>
            <div className="text-left">
              <p className="text-xs font-semibold text-pink-300 leading-none">Iris</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Senior CM</p>
            </div>
            <span className="w-2 h-2 rounded-full bg-green-400 shadow-sm shadow-green-400/50 ml-1" />
          </button>
        </div>

        <StatsOverview />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-6 w-full max-w-3xl" data-testid="commax-tabs">
            <TabsTrigger value="overview" data-testid="tab-overview"><BarChart2 className="w-4 h-4 mr-1.5" />Analytics</TabsTrigger>
            <TabsTrigger value="composer" data-testid="tab-composer">
              <span className="mr-1.5">🌸</span>Iris CM
            </TabsTrigger>
            <TabsTrigger value="posts" data-testid="tab-posts"><FileText className="w-4 h-4 mr-1.5" />Posts</TabsTrigger>
            <TabsTrigger value="inbox" data-testid="tab-inbox"><Inbox className="w-4 h-4 mr-1.5" />Inbox</TabsTrigger>
            <TabsTrigger value="accounts" data-testid="tab-accounts"><Users className="w-4 h-4 mr-1.5" />Comptes</TabsTrigger>
            <TabsTrigger value="journal" data-testid="tab-journal"><NotebookPen className="w-4 h-4 mr-1.5" />Journal CM</TabsTrigger>
          </TabsList>

          <div className="mt-6">
            <TabsContent value="overview" className="mt-0"><Analytics /></TabsContent>
            <TabsContent value="composer" className="mt-0"><IrisComposerDelegate onOpen={openMiniChat} /></TabsContent>
            <TabsContent value="posts" className="mt-0"><PostsList /></TabsContent>
            <TabsContent value="inbox" className="mt-0"><MentionsInbox /></TabsContent>
            <TabsContent value="accounts" className="mt-0">
              <div className="space-y-6">
                <AccountsManager />
                <Card className="bg-card/60 border-border/50">
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Layers className="w-4 h-4 text-blue-400" />Templates
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <Templates />
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
            <TabsContent value="journal" className="mt-0">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-white flex items-center gap-2">
                      <NotebookPen className="w-4 h-4 text-pink-400" />
                      Journal CM d'Iris
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Iris documente automatiquement ses activités, décisions et sessions de travail.</p>
                  </div>
                </div>
                <IrisCmJournal />
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>

      {/* Floating Iris Gateway */}
      <IrisGateway onOpen={openMiniChat} />

      {/* Mini Iris Chat Panel */}
      <MiniIrisChat
        open={miniChatOpen}
        onClose={() => setMiniChatOpen(false)}
        initialMsg={miniChatMsg}
      />
    </PageContainer>
  );
}
