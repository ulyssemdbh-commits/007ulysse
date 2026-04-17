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
import { useTabListener } from "@/hooks/useAppNavigation";
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

import { PLATFORMS, STATUS_CONFIG, getPlatformConfig, PlatformBadge } from "./commax/config";
import { StatsOverview, Composer, PostsList, MentionsInbox } from "./commax/ContentPanels";
import { InstagramConnectDialog, AccountsManager } from "./commax/AccountsPanels";
import { Analytics, Templates } from "./commax/AnalyticsPanels";
import { MiniIrisChat, IrisGateway, IrisComposerDelegate, IrisCmJournal } from "./commax/IrisChat";

export default function CommaxPage() {
  const [activeTab, setActiveTab] = useState("overview");
  useTabListener(setActiveTab, ["overview", "composer", "posts", "inbox", "accounts", "journal"], {
    "analytics": "overview", "apercu": "overview",
    "compose": "composer", "composition": "composer",
    "post": "posts", "publications": "posts",
    "boite": "inbox", "boîte": "inbox", "messages": "inbox",
    "comptes": "accounts", "compte": "accounts",
    "cm": "journal",
  });
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

