import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  BookOpen,
  Plus,
  Check,
  Clock,
  Loader2,
  Sparkles,
  Send,
  Trash2,
  GraduationCap,
  Calculator,
  Languages,
  Microscope,
  Palette,
  Music,
  Globe,
  PenTool,
} from "lucide-react";

const SUBJECTS = [
  { name: "Maths", icon: Calculator, color: "text-blue-400" },
  { name: "Français", icon: PenTool, color: "text-rose-400" },
  { name: "Anglais", icon: Languages, color: "text-emerald-400" },
  { name: "Sciences", icon: Microscope, color: "text-cyan-400" },
  { name: "Histoire-Géo", icon: Globe, color: "text-amber-400" },
  { name: "Arts", icon: Palette, color: "text-violet-400" },
  { name: "Musique", icon: Music, color: "text-pink-400" },
  { name: "Autre", icon: BookOpen, color: "text-slate-400" },
];

function getOwnerName(username: string): string {
  if (username?.startsWith("Kelly")) return "Kelly";
  if (username?.startsWith("Lenny")) return "Lenny";
  if (username?.startsWith("Micky")) return "Micky";
  return "Kelly";
}

const THEME: Record<string, { gradient: string; accent: string; emoji: string }> = {
  Kelly: { gradient: "from-pink-500 via-rose-400 to-fuchsia-500", accent: "text-pink-400", emoji: "🦋" },
  Lenny: { gradient: "from-blue-500 via-cyan-400 to-sky-500", accent: "text-blue-400", emoji: "🌊" },
  Micky: { gradient: "from-purple-500 via-violet-400 to-indigo-500", accent: "text-purple-400", emoji: "🦄" },
};

interface HomeworkItem {
  id: number;
  subject: string;
  title: string;
  description: string;
  status: "pending" | "in_progress" | "done";
  irisHelp?: string;
  createdAt: string;
}

export default function IrisHomework() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const ownerName = getOwnerName(user?.username || "");
  const cfg = THEME[ownerName] || THEME.Kelly;

  const [addOpen, setAddOpen] = useState(false);
  const [askingHelp, setAskingHelp] = useState<number | null>(null);
  const [helpQuestion, setHelpQuestion] = useState("");
  const [helpResponse, setHelpResponse] = useState<Record<number, string>>({});
  const [helpLoading, setHelpLoading] = useState(false);
  const [newHomework, setNewHomework] = useState({ subject: "", title: "", description: "" });

  const [homeworkList, setHomeworkList] = useState<HomeworkItem[]>([
    { id: 1, subject: "Maths", title: "Exercices chapitre 5", description: "Pages 42-43, exercices 1 à 8", status: "pending", createdAt: new Date().toISOString() },
    { id: 2, subject: "Français", title: "Rédaction", description: "Écrire un texte de 200 mots sur le thème de l'aventure", status: "in_progress", createdAt: new Date().toISOString() },
  ]);

  function addHomework() {
    if (!newHomework.subject || !newHomework.title) {
      toast({ title: "Remplis au moins la matière et le titre", variant: "destructive" });
      return;
    }
    const item: HomeworkItem = {
      id: Date.now(),
      subject: newHomework.subject,
      title: newHomework.title,
      description: newHomework.description,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    setHomeworkList((prev) => [item, ...prev]);
    setNewHomework({ subject: "", title: "", description: "" });
    setAddOpen(false);
    toast({ title: "Devoir ajouté !" });
  }

  function toggleStatus(id: number) {
    setHomeworkList((prev) =>
      prev.map((h) => {
        if (h.id !== id) return h;
        const next = h.status === "pending" ? "in_progress" : h.status === "in_progress" ? "done" : "pending";
        return { ...h, status: next };
      })
    );
  }

  function deleteHomework(id: number) {
    setHomeworkList((prev) => prev.filter((h) => h.id !== id));
  }

  async function askIrisHelp(homeworkId: number) {
    const hw = homeworkList.find((h) => h.id === homeworkId);
    if (!hw || !helpQuestion.trim()) return;
    setHelpLoading(true);
    try {
      const res = await apiRequest("POST", "/api/v2/conversations", {
        message: `[Aide aux devoirs - ${hw.subject}: ${hw.title}] ${hw.description}\n\nQuestion de ${ownerName}: ${helpQuestion}`,
        persona: "iris",
        sessionContext: "iris-homework",
      });
      const data = await res.json();
      const reply = data.response || data.message || data.text || "Je n'ai pas pu répondre, réessaie !";
      setHelpResponse((prev) => ({ ...prev, [homeworkId]: reply }));
      setHelpQuestion("");
    } catch {
      toast({ title: "Erreur", description: "Iris n'a pas pu répondre", variant: "destructive" });
    } finally {
      setHelpLoading(false);
    }
  }

  const pendingCount = homeworkList.filter((h) => h.status === "pending").length;
  const doneCount = homeworkList.filter((h) => h.status === "done").length;

  return (
    <div className="min-h-screen bg-background" data-testid="iris-homework-page">
      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        <motion.header initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => navigate("/iris")} data-testid="button-back-iris">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-2">
              <GraduationCap className={`h-6 w-6 ${cfg.accent}`} />
              <div>
                <h1 className={`text-lg font-black bg-gradient-to-r ${cfg.gradient} bg-clip-text text-transparent`}>Mes Devoirs</h1>
                <p className="text-[10px] text-muted-foreground">Iris t'aide {cfg.emoji}</p>
              </div>
            </div>
          </div>
          <Button size="sm" className={`rounded-xl bg-gradient-to-r ${cfg.gradient} border-0 text-white`} onClick={() => setAddOpen(!addOpen)} data-testid="button-add-homework">
            <Plus className="h-4 w-4 mr-1" /> Ajouter
          </Button>
        </motion.header>

        <div className="grid grid-cols-3 gap-2">
          <Card className="bg-amber-500/10 border-amber-500/20">
            <CardContent className="p-3 text-center">
              <p className="text-xl font-black text-amber-400">{pendingCount}</p>
              <p className="text-[10px] text-muted-foreground">À faire</p>
            </CardContent>
          </Card>
          <Card className="bg-blue-500/10 border-blue-500/20">
            <CardContent className="p-3 text-center">
              <p className="text-xl font-black text-blue-400">{homeworkList.filter((h) => h.status === "in_progress").length}</p>
              <p className="text-[10px] text-muted-foreground">En cours</p>
            </CardContent>
          </Card>
          <Card className="bg-green-500/10 border-green-500/20">
            <CardContent className="p-3 text-center">
              <p className="text-xl font-black text-green-400">{doneCount}</p>
              <p className="text-[10px] text-muted-foreground">Terminés</p>
            </CardContent>
          </Card>
        </div>

        <AnimatePresence>
          {addOpen && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
              <Card className="border-white/10">
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {SUBJECTS.map((s) => {
                      const Icon = s.icon;
                      const selected = newHomework.subject === s.name;
                      return (
                        <Button
                          key={s.name}
                          variant={selected ? "default" : "outline"}
                          size="sm"
                          className={`rounded-xl text-xs ${selected ? `bg-gradient-to-r ${cfg.gradient} border-0 text-white` : ""}`}
                          onClick={() => setNewHomework((p) => ({ ...p, subject: s.name }))}
                          data-testid={`subject-${s.name.toLowerCase()}`}
                        >
                          <Icon className={`h-3 w-3 mr-1 ${selected ? "text-white" : s.color}`} />
                          {s.name}
                        </Button>
                      );
                    })}
                  </div>
                  <Input
                    className="rounded-xl"
                    placeholder="Titre du devoir"
                    value={newHomework.title}
                    onChange={(e) => setNewHomework((p) => ({ ...p, title: e.target.value }))}
                    data-testid="input-homework-title"
                  />
                  <Textarea
                    className="rounded-xl resize-none"
                    placeholder="Description (optionnel)"
                    value={newHomework.description}
                    onChange={(e) => setNewHomework((p) => ({ ...p, description: e.target.value }))}
                    rows={2}
                    data-testid="input-homework-desc"
                  />
                  <Button className={`w-full rounded-xl bg-gradient-to-r ${cfg.gradient} border-0 text-white`} onClick={addHomework} data-testid="button-submit-homework">
                    Ajouter le devoir
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-3">
          {homeworkList.map((hw, idx) => {
            const subjectCfg = SUBJECTS.find((s) => s.name === hw.subject) || SUBJECTS[SUBJECTS.length - 1];
            const Icon = subjectCfg.icon;
            return (
              <motion.div key={hw.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
                <Card className={`overflow-hidden group ${hw.status === "done" ? "opacity-60" : ""}`} data-testid={`homework-${hw.id}`}>
                  <div className={`h-1 bg-gradient-to-r ${cfg.gradient}`} />
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${subjectCfg.color}`} />
                        <div>
                          <p className={`font-bold text-sm ${hw.status === "done" ? "line-through" : ""}`}>{hw.title}</p>
                          <Badge variant="outline" className="text-[9px] mt-0.5">{hw.subject}</Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg" onClick={() => toggleStatus(hw.id)} data-testid={`toggle-${hw.id}`}>
                          {hw.status === "done" ? <Check className="h-3.5 w-3.5 text-green-400" /> : hw.status === "in_progress" ? <Clock className="h-3.5 w-3.5 text-blue-400" /> : <Clock className="h-3.5 w-3.5 text-muted-foreground" />}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg opacity-0 group-hover:opacity-100" onClick={() => deleteHomework(hw.id)} data-testid={`delete-${hw.id}`}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    {hw.description && <p className="text-xs text-muted-foreground">{hw.description}</p>}

                    {helpResponse[hw.id] && (
                      <div className="bg-white/5 border border-white/10 rounded-xl p-3 mt-2">
                        <div className="flex items-center gap-1 mb-1">
                          <Sparkles className={`h-3 w-3 ${cfg.accent}`} />
                          <span className={`text-[10px] font-bold ${cfg.accent}`}>Iris</span>
                        </div>
                        <p className="text-xs text-foreground whitespace-pre-wrap">{helpResponse[hw.id]}</p>
                      </div>
                    )}

                    {askingHelp === hw.id ? (
                      <div className="flex gap-2 mt-2">
                        <Input
                          className="rounded-xl text-xs h-8"
                          placeholder="Pose ta question à Iris..."
                          value={helpQuestion}
                          onChange={(e) => setHelpQuestion(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") askIrisHelp(hw.id); }}
                          data-testid={`help-input-${hw.id}`}
                        />
                        <Button size="sm" className={`rounded-xl h-8 bg-gradient-to-r ${cfg.gradient} border-0 text-white`} onClick={() => askIrisHelp(hw.id)} disabled={helpLoading || !helpQuestion.trim()} data-testid={`help-send-${hw.id}`}>
                          {helpLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                        </Button>
                      </div>
                    ) : (
                      <Button variant="ghost" size="sm" className={`text-xs ${cfg.accent} rounded-xl h-7`} onClick={() => { setAskingHelp(hw.id); setHelpQuestion(""); }} data-testid={`ask-help-${hw.id}`}>
                        <Sparkles className="h-3 w-3 mr-1" /> Demander à Iris
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {homeworkList.length === 0 && (
          <Card className="border-dashed border-2">
            <CardContent className="p-12 text-center">
              <GraduationCap className={`h-12 w-12 mx-auto mb-3 ${cfg.accent}`} />
              <h3 className="font-bold mb-1">Pas de devoirs !</h3>
              <p className="text-sm text-muted-foreground">Ajoute un devoir et Iris t'aidera</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
