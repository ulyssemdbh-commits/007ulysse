import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  ArrowLeft, Zap, Plus, Play, Settings2, Trash2, BarChart3, Clock,
  CheckCircle, XCircle, ChevronRight, ChevronDown, ChevronUp, Wrench, Shield, Rocket, Search,
  Sun, BarChart, GitBranch, X, Eye, Globe, ExternalLink, Copy, Pencil, Save, PlusCircle, GripVertical, ArrowUp, ArrowDown
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function tryParseJSON(str: string): any {
  try { return JSON.parse(str); } catch { /* ignore */ }
  try {
    const fixed = str.replace(/,\s*$/, '') + (str.includes('[') && !str.includes(']') ? ']}' : '}');
    return JSON.parse(fixed);
  } catch { /* ignore */ }
  const typeMatch = str.match(/"type"\s*:\s*"([^"]+)"/);
  const queryMatch = str.match(/"query"\s*:\s*"([^"]+)"/);
  if (typeMatch) {
    const resultsMatch = str.match(/"results"\s*:\s*\[/);
    if (resultsMatch) {
      const resultBlocks = [...str.matchAll(/"title"\s*:\s*"([^"]*)"/g)].map((m, i) => {
        const urlM = str.slice(m.index || 0).match(/"url"\s*:\s*"([^"]*)"/);
        const snippetM = str.slice(m.index || 0).match(/"snippet"\s*:\s*"([^"]{0,300})/);
        return { title: m[1], url: urlM?.[1] || "", snippet: snippetM?.[1] || "" };
      });
      if (resultBlocks.length > 0) {
        return { type: typeMatch[1], query: queryMatch?.[1], resultCount: resultBlocks.length, results: resultBlocks };
      }
    }
  }
  return null;
}

function StepResultDisplay({ output }: { output: any }) {
  const raw = typeof output === "string" ? output : JSON.stringify(output);
  let parsed: any = null;
  if (typeof output === "string") {
    parsed = tryParseJSON(output);
  } else {
    parsed = output;
  }

  if (parsed && parsed.type === "web_search" && Array.isArray(parsed.results)) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-[10px] text-gray-500">
          <Globe className="w-3 h-3" />
          <span>{parsed.resultCount ?? parsed.results.length} résultats via {parsed.engine ?? "web"}</span>
        </div>
        {parsed.results.slice(0, 5).map((r: any, i: number) => (
          <div key={i} className="bg-gray-800/40 border border-gray-700/40 rounded-lg p-2.5">
            <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-medium text-cyan-300 hover:text-cyan-200 flex items-center gap-1 mb-1">
              {r.title || "Sans titre"}
              <ExternalLink className="w-3 h-3 shrink-0 opacity-50" />
            </a>
            {r.url && <p className="text-[9px] text-gray-600 truncate mb-1">{r.url}</p>}
            {r.snippet && <p className="text-[10px] text-gray-400 leading-relaxed line-clamp-3">{r.snippet}</p>}
          </div>
        ))}
      </div>
    );
  }

  if (parsed && parsed.type === "calendar_events" && Array.isArray(parsed.events)) {
    return (
      <div className="space-y-1">
        <div className="text-[10px] text-gray-500">{parsed.count} événement(s)</div>
        {parsed.events.map((e: any, i: number) => (
          <div key={i} className="flex items-center gap-2 bg-gray-800/40 border border-gray-700/40 rounded p-2 text-[11px]">
            <div className="w-1 h-6 rounded-full bg-cyan-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-cyan-200 truncate font-medium">{e.title}</div>
              <div className="text-gray-500 text-[9px]">{e.start} — {e.end}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (parsed && parsed.type === "email_list" && Array.isArray(parsed.emails)) {
    return (
      <div className="space-y-1">
        <div className="text-[10px] text-gray-500">{parsed.count ?? parsed.emails.length} email(s)</div>
        {parsed.emails.slice(0, 5).map((e: any, i: number) => (
          <div key={i} className="bg-gray-800/40 border border-gray-700/40 rounded p-2 text-[11px]">
            <div className="text-cyan-200 truncate font-medium">{e.subject || "Sans objet"}</div>
            <div className="text-gray-500 text-[9px]">{e.from} — {e.date}</div>
            {e.snippet && <div className="text-gray-400 text-[10px] mt-0.5 line-clamp-2">{e.snippet}</div>}
          </div>
        ))}
      </div>
    );
  }

  if (parsed && typeof parsed === "object" && parsed.error) {
    return (
      <div className="bg-red-900/20 border border-red-500/30 rounded p-2 text-[11px] text-red-300">
        {parsed.error}
      </div>
    );
  }

  const displayStr = (parsed !== null && typeof parsed === "object") ? JSON.stringify(parsed, null, 2) : raw;
  const isLong = displayStr.length > 500;
  return (
    <ScrollArea className="max-h-[200px]">
      <pre className="text-[11px] bg-gray-800/60 p-2 rounded border border-gray-700/50 text-gray-300 whitespace-pre-wrap break-words leading-relaxed">
        {isLong ? displayStr.slice(0, 500) + "\n…" : displayStr}
      </pre>
    </ScrollArea>
  );
}

interface SkillStep {
  name: string;
  toolName: string;
  parameters?: any;
  outputKey?: string;
  conditionExpr?: string;
  onErrorAction?: string;
}

interface Skill {
  id: number;
  name: string;
  slug: string;
  description: string;
  category: string;
  icon: string;
  enabled: boolean;
  requiredTools: string[];
  allowedAgents: string[];
  triggerPatterns: string[];
  executionCount: number;
  successCount: number;
  avgLatencyMs: number | null;
  steps: SkillStep[];
  createdAt: string;
}

interface Execution {
  id: number;
  skillId: number;
  status: string;
  stepsCompleted: number;
  totalSteps: number;
  latencyMs: number | null;
  errorMessage: string | null;
  stepResults: any[];
  startedAt: string;
}

const CATEGORY_ICONS: Record<string, any> = {
  business: BarChart,
  daily: Sun,
  devops: GitBranch,
  security: Shield,
  general: Zap,
};

const CATEGORY_COLORS: Record<string, string> = {
  business: "border-amber-500/30 text-amber-300",
  daily: "border-yellow-500/30 text-yellow-300",
  devops: "border-indigo-500/30 text-indigo-300",
  security: "border-red-500/30 text-red-300",
  general: "border-cyan-500/30 text-cyan-300",
};

function formatMs(ms: number | null) {
  if (!ms) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function SkillsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [selectedSkillId, setSelectedSkillId] = useState<number | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [expandedExecId, setExpandedExecId] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<{
    description: string;
    category: string;
    allowedAgents: string;
    triggerPatterns: string;
    steps: Array<{ name: string; toolName: string; outputKey: string; parameters: string }>;
  } | null>(null);

  const { data: skillsList, isLoading } = useQuery<Skill[]>({
    queryKey: ["/api/skills", categoryFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      const res = await fetch(`/api/skills?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const { data: selectedSkill } = useQuery<Skill>({
    queryKey: ["/api/skills", selectedSkillId],
    queryFn: async () => {
      const res = await fetch(`/api/skills/${selectedSkillId}`, { credentials: "include" });
      return res.json();
    },
    enabled: !!selectedSkillId,
  });

  const { data: executions } = useQuery<Execution[]>({
    queryKey: ["/api/skills", selectedSkillId, "executions"],
    queryFn: async () => {
      const res = await fetch(`/api/skills/${selectedSkillId}/executions`, { credentials: "include" });
      return res.json();
    },
    enabled: !!selectedSkillId,
  });

  const { data: allExecutions } = useQuery<Execution[]>({
    queryKey: ["/api/skills/executions/all"],
    queryFn: async () => {
      const res = await fetch("/api/skills/executions/all", { credentials: "include" });
      return res.json();
    },
  });

  const seedMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/skills/seed"),
    onSuccess: () => {
      toast({ title: "Skills par défaut créées" });
      queryClient.invalidateQueries({ queryKey: ["/api/skills"] });
    },
  });

  const executeMutation = useMutation({
    mutationFn: async (skillId: number) => {
      const res = await apiRequest("POST", `/api/skills/${skillId}/execute`, { agent: "system" });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: data.status === "completed" ? "Skill exécutée avec succès" : "Skill échouée", variant: data.status === "completed" ? "default" : "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/skills"] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) => {
      return apiRequest("PATCH", `/api/skills/${id}`, { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/skills"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/skills/${id}`),
    onSuccess: () => {
      toast({ title: "Skill supprimée" });
      setSelectedSkillId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/skills"] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async ({ id, form }: { id: number; form: NonNullable<typeof editForm> }) => {
      const steps = form.steps.map(s => {
        let params: any = {};
        try { params = s.parameters ? JSON.parse(s.parameters) : {}; } catch { params = {}; }
        return { name: s.name, toolName: s.toolName, outputKey: s.outputKey || undefined, parameters: params };
      });
      return apiRequest("PATCH", `/api/skills/${id}`, {
        description: form.description,
        category: form.category,
        allowedAgents: form.allowedAgents.split(",").map(a => a.trim()).filter(Boolean),
        triggerPatterns: form.triggerPatterns.split(",").map(t => t.trim()).filter(Boolean),
        steps,
      });
    },
    onSuccess: () => {
      toast({ title: "Skill sauvegardée" });
      setEditing(false);
      setEditForm(null);
      queryClient.invalidateQueries({ queryKey: ["/api/skills"] });
    },
  });

  function startEditing(skill: Skill) {
    setEditForm({
      description: skill.description,
      category: skill.category,
      allowedAgents: (skill.allowedAgents || []).join(", "),
      triggerPatterns: (skill.triggerPatterns || []).join(", "),
      steps: (skill.steps || []).map(s => ({
        name: s.name,
        toolName: s.toolName,
        outputKey: s.outputKey || "",
        parameters: s.parameters ? JSON.stringify(s.parameters) : "",
      })),
    });
    setEditing(true);
  }

  function updateStep(index: number, field: string, value: string) {
    if (!editForm) return;
    const steps = [...editForm.steps];
    steps[index] = { ...steps[index], [field]: value };
    setEditForm({ ...editForm, steps });
  }

  function addStep() {
    if (!editForm) return;
    setEditForm({ ...editForm, steps: [...editForm.steps, { name: "", toolName: "", outputKey: "", parameters: "" }] });
  }

  function removeStep(index: number) {
    if (!editForm) return;
    setEditForm({ ...editForm, steps: editForm.steps.filter((_, i) => i !== index) });
  }

  function moveStep(index: number, direction: -1 | 1) {
    if (!editForm) return;
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= editForm.steps.length) return;
    const steps = [...editForm.steps];
    [steps[index], steps[newIndex]] = [steps[newIndex], steps[index]];
    setEditForm({ ...editForm, steps });
  }

  const skills = skillsList || [];
  const categories = [...new Set(skills.map(s => s.category))];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-950 to-gray-900 text-white">
      <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")} data-testid="button-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <Zap className="w-6 h-6 text-yellow-400" />
            <h1 className="text-xl font-bold">Skills</h1>
            <Badge variant="outline" className="border-yellow-500/30 text-yellow-300" data-testid="badge-total">
              {skills.length} skills
            </Badge>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="border-gray-700" onClick={() => seedMutation.mutate()} data-testid="button-seed">
              <Rocket className="w-4 h-4 mr-1" /> Seed
            </Button>
            <CreateSkillDialog
              open={showCreateDialog}
              onOpenChange={setShowCreateDialog}
              onCreated={() => queryClient.invalidateQueries({ queryKey: ["/api/skills"] })}
            />
          </div>
        </div>

        <Tabs defaultValue="catalog" className="space-y-4">
          <TabsList className="bg-gray-900/50 border border-gray-800">
            <TabsTrigger value="catalog" data-testid="tab-catalog">Catalogue</TabsTrigger>
            <TabsTrigger value="executions" data-testid="tab-executions">Exécutions</TabsTrigger>
          </TabsList>

          <TabsContent value="catalog" className="space-y-4">
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                variant={categoryFilter === "all" ? "default" : "outline"}
                onClick={() => setCategoryFilter("all")}
                className={categoryFilter === "all" ? "bg-cyan-600" : "border-gray-700"}
                data-testid="button-filter-all"
              >
                Tous
              </Button>
              {["business", "daily", "devops", "security"].map((cat) => {
                const Icon = CATEGORY_ICONS[cat] || Zap;
                return (
                  <Button
                    key={cat}
                    size="sm"
                    variant={categoryFilter === cat ? "default" : "outline"}
                    onClick={() => setCategoryFilter(cat)}
                    className={categoryFilter === cat ? "bg-cyan-600" : "border-gray-700"}
                    data-testid={`button-filter-${cat}`}
                  >
                    <Icon className="w-3 h-3 mr-1" /> {cat}
                  </Button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {isLoading && <div className="text-gray-400 text-center py-8 col-span-2">Chargement...</div>}
                  {skills.map((skill) => {
                    const CatIcon = CATEGORY_ICONS[skill.category] || Zap;
                    const successRate = skill.executionCount > 0
                      ? Math.round((skill.successCount / skill.executionCount) * 100)
                      : null;

                    return (
                      <Card
                        key={skill.id}
                        className={`bg-gray-900/40 border-gray-800 cursor-pointer transition-all hover:border-yellow-700/50 ${selectedSkillId === skill.id ? "border-yellow-500/60 bg-yellow-950/10" : ""} ${!skill.enabled ? "opacity-50" : ""}`}
                        onClick={() => setSelectedSkillId(skill.id)}
                        data-testid={`card-skill-${skill.slug}`}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <CatIcon className="w-5 h-5 text-yellow-400" />
                              <h3 className="font-semibold text-sm">{skill.name}</h3>
                            </div>
                            <Badge className={CATEGORY_COLORS[skill.category] || CATEGORY_COLORS.general} variant="outline">
                              {skill.category}
                            </Badge>
                          </div>
                          <p className="text-xs text-gray-400 mb-3 line-clamp-2">{skill.description}</p>
                          <div className="flex items-center justify-between text-xs text-gray-500">
                            <span>{skill.steps?.length || 0} étapes</span>
                            <div className="flex items-center gap-3">
                              {skill.executionCount > 0 && (
                                <>
                                  <span className="flex items-center gap-1"><Play className="w-3 h-3" />{skill.executionCount}x</span>
                                  <span className={successRate && successRate >= 80 ? "text-green-400" : "text-orange-400"}>
                                    {successRate}% OK
                                  </span>
                                </>
                              )}
                              <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatMs(skill.avgLatencyMs)}</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                  {!isLoading && skills.length === 0 && (
                    <div className="text-center py-12 text-gray-500 col-span-2">
                      <Zap className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p>Aucune skill créée</p>
                      <p className="text-sm mt-1">Clique sur "Seed" pour créer les skills par défaut</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="lg:col-span-1">
                {selectedSkillId && selectedSkill ? (
                  <Card className="bg-gray-900/40 border-gray-800 sticky top-4">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">{selectedSkill.name}</CardTitle>
                        <Button variant="ghost" size="icon" onClick={() => setSelectedSkillId(null)} data-testid="button-close-skill-detail">
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {editing && editForm ? (
                        <>
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Description</label>
                            <Textarea
                              value={editForm.description}
                              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                              className="bg-gray-800 border-gray-700 text-xs mt-1"
                              rows={2}
                              data-testid="input-edit-description"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Catégorie</label>
                            <Select value={editForm.category} onValueChange={(v) => setEditForm({ ...editForm, category: v })}>
                              <SelectTrigger className="bg-gray-800 border-gray-700 text-xs mt-1" data-testid="select-edit-category">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="general">Général</SelectItem>
                                <SelectItem value="business">Business</SelectItem>
                                <SelectItem value="daily">Quotidien</SelectItem>
                                <SelectItem value="devops">DevOps</SelectItem>
                                <SelectItem value="security">Sécurité</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-[10px] text-gray-500 uppercase tracking-wider">Pipeline ({editForm.steps.length} étapes)</label>
                              <Button size="sm" variant="ghost" className="h-6 text-[10px] text-cyan-400" onClick={addStep} data-testid="button-add-step">
                                <PlusCircle className="w-3 h-3 mr-1" /> Étape
                              </Button>
                            </div>
                            <div className="space-y-2">
                              {editForm.steps.map((step, i) => (
                                <div key={i} className="bg-gray-800/60 border border-gray-700/50 rounded-lg p-2 space-y-1.5">
                                  <div className="flex items-center gap-1">
                                    <Badge variant="outline" className="border-cyan-500/30 text-cyan-300 text-[10px] shrink-0">{i + 1}</Badge>
                                    <Input
                                      value={step.name}
                                      onChange={(e) => updateStep(i, "name", e.target.value)}
                                      className="bg-gray-900 border-gray-700 text-[11px] h-7"
                                      placeholder="Nom de l'étape"
                                      data-testid={`input-step-name-${i}`}
                                    />
                                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" onClick={() => moveStep(i, -1)} disabled={i === 0}>
                                      <ArrowUp className="w-3 h-3" />
                                    </Button>
                                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" onClick={() => moveStep(i, 1)} disabled={i === editForm.steps.length - 1}>
                                      <ArrowDown className="w-3 h-3" />
                                    </Button>
                                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 shrink-0" onClick={() => removeStep(i)} data-testid={`button-remove-step-${i}`}>
                                      <X className="w-3 h-3" />
                                    </Button>
                                  </div>
                                  <div className="flex gap-1.5">
                                    <div className="flex-1">
                                      <Input
                                        value={step.toolName}
                                        onChange={(e) => updateStep(i, "toolName", e.target.value)}
                                        className="bg-gray-900 border-gray-700 text-[11px] h-7"
                                        placeholder="Outil (ex: web_search)"
                                        data-testid={`input-step-tool-${i}`}
                                      />
                                    </div>
                                    <div className="w-24">
                                      <Input
                                        value={step.outputKey}
                                        onChange={(e) => updateStep(i, "outputKey", e.target.value)}
                                        className="bg-gray-900 border-gray-700 text-[11px] h-7"
                                        placeholder="→ clé"
                                        data-testid={`input-step-output-${i}`}
                                      />
                                    </div>
                                  </div>
                                  <Input
                                    value={step.parameters}
                                    onChange={(e) => updateStep(i, "parameters", e.target.value)}
                                    className="bg-gray-900 border-gray-700 text-[10px] h-7 font-mono"
                                    placeholder='Paramètres JSON (ex: {"query":"..."})'
                                    data-testid={`input-step-params-${i}`}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Agents autorisés (séparés par virgule)</label>
                            <Input
                              value={editForm.allowedAgents}
                              onChange={(e) => setEditForm({ ...editForm, allowedAgents: e.target.value })}
                              className="bg-gray-800 border-gray-700 text-xs mt-1"
                              placeholder="ulysse, alfred, iris"
                              data-testid="input-edit-agents"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 uppercase tracking-wider">Déclencheurs (séparés par virgule)</label>
                            <Input
                              value={editForm.triggerPatterns}
                              onChange={(e) => setEditForm({ ...editForm, triggerPatterns: e.target.value })}
                              className="bg-gray-800 border-gray-700 text-xs mt-1"
                              placeholder="analyse concurrent, veille concurrentielle"
                              data-testid="input-edit-triggers"
                            />
                          </div>
                          <div className="flex gap-2 pt-2 border-t border-gray-800">
                            <Button
                              size="sm"
                              className="flex-1 bg-green-600 hover:bg-green-700"
                              onClick={() => saveMutation.mutate({ id: selectedSkill.id, form: editForm })}
                              disabled={saveMutation.isPending}
                              data-testid="button-save-skill"
                            >
                              <Save className="w-3 h-3 mr-1" /> {saveMutation.isPending ? "..." : "Sauvegarder"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-gray-700"
                              onClick={() => { setEditing(false); setEditForm(null); }}
                              data-testid="button-cancel-edit"
                            >
                              Annuler
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-xs text-gray-400">{selectedSkill.description}</p>

                          <div className="space-y-2">
                            <p className="text-xs text-gray-400 font-semibold">Pipeline ({selectedSkill.steps?.length || 0} étapes)</p>
                            {selectedSkill.steps?.map((step, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs bg-gray-800/40 p-2 rounded">
                                <Badge variant="outline" className="border-cyan-500/30 text-cyan-300 text-[10px]">{i + 1}</Badge>
                                <div className="flex-1">
                                  <p className="text-gray-200">{step.name}</p>
                                  <p className="text-gray-500 flex items-center gap-1"><Wrench className="w-3 h-3" />{step.toolName}</p>
                                </div>
                                {step.outputKey && (
                                  <Badge variant="outline" className="text-[9px] border-purple-500/30 text-purple-300">→ {step.outputKey}</Badge>
                                )}
                              </div>
                            ))}
                          </div>

                          {selectedSkill.allowedAgents && selectedSkill.allowedAgents.length > 0 && (
                            <div>
                              <p className="text-xs text-gray-400 mb-1">Agents autorisés</p>
                              <div className="flex flex-wrap gap-1">
                                {selectedSkill.allowedAgents.map((a) => (
                                  <Badge key={a} variant="outline" className="text-[10px] border-blue-500/30 text-blue-300">{a}</Badge>
                                ))}
                              </div>
                            </div>
                          )}

                          {selectedSkill.triggerPatterns && selectedSkill.triggerPatterns.length > 0 && (
                            <div>
                              <p className="text-xs text-gray-400 mb-1">Déclencheurs</p>
                              <div className="flex flex-wrap gap-1">
                                {selectedSkill.triggerPatterns.map((t, i) => (
                                  <Badge key={i} variant="outline" className="text-[10px] border-green-500/30 text-green-300">"{t}"</Badge>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="flex gap-2 pt-2 border-t border-gray-800">
                            <Button
                              size="sm"
                              className="flex-1 bg-yellow-600 hover:bg-yellow-700"
                              onClick={() => executeMutation.mutate(selectedSkill.id)}
                              disabled={executeMutation.isPending || !selectedSkill.enabled}
                              data-testid="button-execute-skill"
                            >
                              <Play className="w-3 h-3 mr-1" /> {executeMutation.isPending ? "..." : "Exécuter"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-cyan-500/30 text-cyan-300"
                              onClick={() => startEditing(selectedSkill)}
                              data-testid="button-edit-skill"
                            >
                              <Pencil className="w-3 h-3 mr-1" /> Modifier
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-gray-700"
                              onClick={() => toggleMutation.mutate({ id: selectedSkill.id, enabled: !selectedSkill.enabled })}
                              data-testid="button-toggle-skill"
                            >
                              {selectedSkill.enabled ? "Désactiver" : "Activer"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                              onClick={() => deleteMutation.mutate(selectedSkill.id)}
                              data-testid="button-delete-skill"
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                ) : (
                  <Card className="bg-gray-900/40 border-gray-800">
                    <CardContent className="p-6 text-center text-gray-500">
                      <Zap className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">Sélectionne une skill pour voir les détails</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="executions" className="space-y-4">
            {(() => {
              const displayExecs = selectedSkillId && executions ? executions : allExecutions || [];
              const title = selectedSkillId && selectedSkill ? `Historique — ${selectedSkill.name}` : "Toutes les exécutions récentes";
              const skillsMap = new Map((skillsList || []).map(s => [s.id, s]));

              if (displayExecs.length === 0) {
                return (
                  <div className="text-center py-12 text-gray-500">
                    <Play className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">Aucune exécution enregistrée</p>
                  </div>
                );
              }

              return (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-gray-300">{title}</h3>
                  {displayExecs.map((exec) => {
                    const isExpanded = expandedExecId === exec.id;
                    const parentSkill = skillsMap.get(exec.skillId);
                    return (
                      <Card key={exec.id} className="bg-gray-900/40 border-gray-800" data-testid={`card-execution-${exec.id}`}>
                        <CardContent className="p-3">
                          <div
                            className="flex items-center justify-between cursor-pointer"
                            onClick={() => setExpandedExecId(isExpanded ? null : exec.id)}
                            data-testid={`button-expand-execution-${exec.id}`}
                          >
                            <div className="flex items-center gap-2">
                              {exec.status === "completed" ? (
                                <CheckCircle className="w-4 h-4 text-green-400" />
                              ) : exec.status === "failed" ? (
                                <XCircle className="w-4 h-4 text-red-400" />
                              ) : (
                                <Clock className="w-4 h-4 text-yellow-400 animate-pulse" />
                              )}
                              <Badge variant="outline" className={exec.status === "completed" ? "border-green-500/30 text-green-300" : exec.status === "failed" ? "border-red-500/30 text-red-300" : "border-yellow-500/30 text-yellow-300"}>
                                {exec.status}
                              </Badge>
                              {!selectedSkillId && parentSkill && (
                                <span className="text-xs text-cyan-400 font-medium">{parentSkill.name}</span>
                              )}
                              <span className="text-xs text-gray-400">{exec.stepsCompleted}/{exec.totalSteps} étapes</span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-gray-500">
                              <span>{formatMs(exec.latencyMs)}</span>
                              <span>{new Date(exec.startedAt).toLocaleString("fr-FR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</span>
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </div>
                          </div>
                          {exec.errorMessage && (
                            <p className="text-xs text-red-400 mt-1">{exec.errorMessage}</p>
                          )}
                          {exec.stepResults && Array.isArray(exec.stepResults) && (
                            <div className="mt-2 space-y-1">
                              {(exec.stepResults as any[]).map((sr: any, i: number) => (
                                <div key={i}>
                                  <div className="flex items-center gap-2 text-[11px]">
                                    <Badge variant="outline" className={sr.status === "success" ? "border-green-500/30 text-green-300" : "border-red-500/30 text-red-300"}>
                                      {i + 1}
                                    </Badge>
                                    <span className="text-gray-400">{sr.step}</span>
                                    <span className="text-gray-500">({sr.tool})</span>
                                    <span className="ml-auto text-gray-500">{formatMs(sr.latencyMs)}</span>
                                  </div>
                                  {isExpanded && sr.output !== undefined && (
                                    <div className="ml-8 mt-1 mb-2">
                                      <p className="text-[10px] text-gray-500 mb-1 flex items-center gap-1"><Eye className="w-3 h-3" /> Résultat :</p>
                                      <StepResultDisplay output={sr.output} />
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              );
            })()}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function CreateSkillDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("general");

  const createMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/skills", {
        name,
        slug: slug || name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
        description,
        category,
        steps: [],
      });
    },
    onSuccess: () => {
      toast({ title: "Skill créée" });
      onOpenChange(false);
      onCreated();
      setName("");
      setSlug("");
      setDescription("");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-yellow-600 hover:bg-yellow-700" data-testid="button-create-skill">
          <Plus className="w-4 h-4 mr-1" /> Créer
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-gray-900 border-gray-700">
        <DialogHeader>
          <DialogTitle>Nouvelle Skill</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400">Nom</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-gray-800 border-gray-700" placeholder="Ex: Bilan Hebdo" data-testid="input-skill-name" />
          </div>
          <div>
            <label className="text-xs text-gray-400">Slug</label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} className="bg-gray-800 border-gray-700" placeholder="Auto-généré si vide" data-testid="input-skill-slug" />
          </div>
          <div>
            <label className="text-xs text-gray-400">Description</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="bg-gray-800 border-gray-700" placeholder="Que fait cette skill ?" data-testid="input-skill-description" />
          </div>
          <div>
            <label className="text-xs text-gray-400">Catégorie</label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="bg-gray-800 border-gray-700" data-testid="select-skill-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="general">Général</SelectItem>
                <SelectItem value="business">Business</SelectItem>
                <SelectItem value="daily">Quotidien</SelectItem>
                <SelectItem value="devops">DevOps</SelectItem>
                <SelectItem value="security">Sécurité</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full bg-yellow-600 hover:bg-yellow-700" onClick={() => createMutation.mutate()} disabled={!name || !description || createMutation.isPending} data-testid="button-submit-skill">
            {createMutation.isPending ? "Création..." : "Créer la Skill"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
