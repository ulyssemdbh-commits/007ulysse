import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home,
  Send,
  Mic,
  MicOff,
  Phone,
  Sparkles,
  BookOpen,
  FolderOpen,
  Code2,
  MessageCircle,
  Settings,
  LogOut,
  Rocket,
  Volume2,
  VolumeX,
  Loader2,
  Menu,
  X,
  ChevronDown,
  Image,
  Palette,
} from "lucide-react";

const DAUGHTER_CONFIG: Record<string, { gradient: string; accent: string; emoji: string; emoji2: string; name: string; greeting: string; bgGlow1: string; bgGlow2: string }> = {
  Kelly: {
    gradient: "from-pink-500 via-rose-400 to-fuchsia-500",
    accent: "text-pink-400",
    emoji: "🦋",
    emoji2: "✨",
    name: "Kelly",
    greeting: "Salut Kelly ! Qu'est-ce qu'on fait aujourd'hui ?",
    bgGlow1: "bg-pink-500/10",
    bgGlow2: "bg-rose-500/10",
  },
  Lenny: {
    gradient: "from-blue-500 via-cyan-400 to-sky-500",
    accent: "text-blue-400",
    emoji: "🌊",
    emoji2: "⚡",
    name: "Lenny",
    greeting: "Hey Lenny ! Prête pour une nouvelle aventure ?",
    bgGlow1: "bg-blue-500/10",
    bgGlow2: "bg-cyan-500/10",
  },
  Micky: {
    gradient: "from-purple-500 via-violet-400 to-indigo-500",
    accent: "text-purple-400",
    emoji: "🦄",
    emoji2: "🌟",
    name: "Micky",
    greeting: "Coucou Micky ! Je suis là pour toi !",
    bgGlow1: "bg-purple-500/10",
    bgGlow2: "bg-violet-500/10",
  },
};

function getOwnerName(username: string): string {
  if (username?.startsWith("Kelly")) return "Kelly";
  if (username?.startsWith("Lenny")) return "Lenny";
  if (username?.startsWith("Micky")) return "Micky";
  return "Kelly";
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

export default function IrisDashboard() {
  const [, navigate] = useLocation();
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);

  const ownerName = getOwnerName(user?.username || "");
  const cfg = DAUGHTER_CONFIG[ownerName] || DAUGHTER_CONFIG.Kelly;

  const [message, setMessage] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: cfg.greeting },
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);

  const { data: projects = [] } = useQuery<any[]>({
    queryKey: ["/api/iris/projects", ownerName],
    queryFn: async () => {
      const res = await fetch(`/api/iris/projects?owner=${ownerName}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const deployedCount = projects.filter((p: any) => p.status === "deployed").length;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages, isTyping]);

  const sendMessage = useCallback(async () => {
    if (!message.trim() || isTyping) return;

    const userMsg = message.trim();
    setMessage("");
    setChatMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setIsTyping(true);

    try {
      const res = await apiRequest("POST", "/api/v2/conversations", {
        message: userMsg,
        persona: "iris",
        sessionContext: "iris",
      });
      const data = await res.json();
      const reply = data.response || data.message || data.text || "...";
      setChatMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err: any) {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Oops, une erreur est survenue. Réessaie !" },
      ]);
    } finally {
      setIsTyping(false);
    }
  }, [message, isTyping]);

  const shortcuts = [
    { label: "DevOps", icon: Rocket, action: () => navigate("/devops-iris"), color: cfg.accent, desc: "Mes projets web" },
    { label: "Devoirs", icon: BookOpen, action: () => navigate("/iris-homework"), color: "text-amber-400", desc: "Aide aux devoirs" },
    { label: "Talking", icon: Phone, action: () => navigate("/iris-talking"), color: "text-green-400", desc: "Appel vocal" },
    { label: "Fichiers", icon: FolderOpen, action: () => navigate("/iris-files"), color: "text-cyan-400", desc: "Mes fichiers" },
    { label: "Images", icon: Image, action: () => { setMessage("Génère-moi une image de "); }, color: "text-rose-400", desc: "Générer des images" },
    { label: "Créations", icon: Palette, action: () => { setMessage("Aide-moi à créer "); }, color: "text-violet-400", desc: "Art & Design" },
  ];

  return (
    <div className="min-h-screen bg-background relative overflow-hidden" data-testid="iris-dashboard">
      <div className={`absolute top-0 left-1/4 w-96 h-96 ${cfg.bgGlow1} rounded-full blur-3xl`} />
      <div className={`absolute bottom-0 right-1/4 w-96 h-96 ${cfg.bgGlow2} rounded-full blur-3xl`} />

      <div className="relative max-w-4xl mx-auto px-4 py-4 space-y-4">
        <motion.header
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className={`absolute -inset-1 bg-gradient-to-r ${cfg.gradient} rounded-full blur-sm opacity-60`} />
              <div className="relative w-14 h-14 rounded-full bg-background border-2 border-white/20 flex items-center justify-center text-3xl">
                {cfg.emoji}
              </div>
            </div>
            <div>
              <h1 className={`text-xl font-black bg-gradient-to-r ${cfg.gradient} bg-clip-text text-transparent`} data-testid="text-iris-title">
                Iris
              </h1>
              <p className="text-xs text-muted-foreground">
                Salut {cfg.name} {cfg.emoji2}
              </p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-xl text-xs"
              onClick={() => setAutoSpeak(!autoSpeak)}
              data-testid="button-auto-speak"
            >
              {autoSpeak ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-xl text-xs"
              onClick={() => navigate("/talking")}
              data-testid="button-call"
            >
              <Phone className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-xl text-xs text-destructive"
              onClick={() => { logout(); navigate("/login"); }}
              data-testid="button-logout"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="md:hidden rounded-xl"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            data-testid="button-mobile-menu"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </motion.header>

        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="md:hidden"
            >
              <Card className="border-white/10">
                <CardContent className="p-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="rounded-xl text-xs" onClick={() => navigate("/talking")}>
                    <Phone className="h-3 w-3 mr-1" /> Appel
                  </Button>
                  <Button variant="outline" size="sm" className="rounded-xl text-xs" onClick={() => setAutoSpeak(!autoSpeak)}>
                    {autoSpeak ? <Volume2 className="h-3 w-3 mr-1" /> : <VolumeX className="h-3 w-3 mr-1" />}
                    Son
                  </Button>
                  <Button variant="outline" size="sm" className="rounded-xl text-xs text-destructive" onClick={() => { logout(); navigate("/login"); }}>
                    <LogOut className="h-3 w-3 mr-1" /> Déconnexion
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
            {shortcuts.map((s, i) => (
              <motion.button
                key={s.label}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.1 + i * 0.05 }}
                onClick={s.action}
                className="flex flex-col items-center gap-1 flex-shrink-0 px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all min-w-[64px]"
                data-testid={`shortcut-${s.label.toLowerCase()}`}
              >
                <s.icon className={`w-5 h-5 ${s.color}`} />
                <span className="text-[10px] text-white/60 font-medium whitespace-nowrap">{s.label}</span>
              </motion.button>
            ))}
          </div>
        </motion.div>

        <div className="grid grid-cols-3 gap-2">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15 }}>
            <Card className={`bg-gradient-to-br ${cfg.bgGlow1} border-white/10`}>
              <CardContent className="p-3 text-center">
                <p className="text-xl font-black">{projects.length}</p>
                <p className="text-[10px] text-muted-foreground">Mes Projets</p>
              </CardContent>
            </Card>
          </motion.div>
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }}>
            <Card className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border-white/10">
              <CardContent className="p-3 text-center">
                <p className="text-xl font-black text-green-400">{deployedCount}</p>
                <p className="text-[10px] text-muted-foreground">En Ligne</p>
              </CardContent>
            </Card>
          </motion.div>
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.25 }}>
            <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-white/10 cursor-pointer hover:border-amber-500/30 transition-colors" onClick={() => navigate("/devops-iris")}>
              <CardContent className="p-3 text-center">
                <Rocket className="h-5 w-5 mx-auto text-amber-400 mb-0.5" />
                <p className="text-[10px] text-muted-foreground">Nouveau</p>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="flex-1"
        >
          <Card className="border-white/10 overflow-hidden">
            <div className={`h-1 bg-gradient-to-r ${cfg.gradient}`} />
            <div
              ref={scrollRef}
              className="h-[350px] md:h-[420px] overflow-y-auto p-4 space-y-3"
              data-testid="chat-messages"
            >
              {chatMessages.map((msg, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                      msg.role === "user"
                        ? `bg-gradient-to-r ${cfg.gradient} text-white`
                        : "bg-white/5 border border-white/10 text-foreground"
                    }`}
                    data-testid={`message-${msg.role}-${idx}`}
                  >
                    {msg.role === "assistant" && (
                      <div className="flex items-center gap-1.5 mb-1">
                        <Sparkles className={`h-3 w-3 ${cfg.accent}`} />
                        <span className={`text-[10px] font-bold ${cfg.accent}`}>Iris</span>
                      </div>
                    )}
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </motion.div>
              ))}

              {isTyping && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex justify-start"
                >
                  <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <Sparkles className={`h-3 w-3 ${cfg.accent} animate-pulse`} />
                      <span className={`text-xs ${cfg.accent}`}>Iris réfléchit...</span>
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    </div>
                  </div>
                </motion.div>
              )}
            </div>

            <div className="p-3 border-t border-white/10 bg-background/50">
              <div className="flex gap-2">
                <Button
                  variant={micActive ? "default" : "outline"}
                  size="icon"
                  className={`rounded-xl flex-shrink-0 ${micActive ? `bg-gradient-to-r ${cfg.gradient} border-0` : ""}`}
                  onClick={() => setMicActive(!micActive)}
                  data-testid="button-mic"
                >
                  {micActive ? <Mic className="h-4 w-4 text-white" /> : <MicOff className="h-4 w-4" />}
                </Button>
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder={`Parle à Iris...`}
                  className="rounded-xl resize-none min-h-[40px] max-h-[100px] text-sm"
                  rows={1}
                  data-testid="input-chat"
                />
                <Button
                  className={`rounded-xl flex-shrink-0 bg-gradient-to-r ${cfg.gradient} border-0 hover:opacity-90`}
                  size="icon"
                  onClick={sendMessage}
                  disabled={!message.trim() || isTyping}
                  data-testid="button-send"
                >
                  <Send className="h-4 w-4 text-white" />
                </Button>
              </div>
            </div>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
