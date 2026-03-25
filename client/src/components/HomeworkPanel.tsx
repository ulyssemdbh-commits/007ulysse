import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { X, Plus, CheckCircle, Clock, Trash2, BookOpen, AlertCircle, Repeat, Loader2, Pencil, Calendar, ChevronDown, ChevronUp, Filter, ArrowUpDown, FileText, AlertTriangle, Play } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UlysseHomework } from "@shared/schema";

interface HomeworkPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type SortOption = "priority" | "dueDate" | "createdAt";
type FilterOption = "all" | "high" | "medium" | "low";

interface EnrichedHomework extends UlysseHomework {
  executionStats?: {
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    hasResults: boolean;
    lastRunAt: string | null;
    lastResultSummary: string | null;
    lastResultArtifacts: any;
  };
}

export function HomeworkPanel({ isOpen, onClose }: HomeworkPanelProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPriority, setNewPriority] = useState<"low" | "medium" | "high">("medium");
  const [newRecurrence, setNewRecurrence] = useState<"none" | "daily" | "weekly" | "monthly" | "yearly">("none");
  const [newDueDate, setNewDueDate] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPriority, setEditPriority] = useState<"low" | "medium" | "high">("medium");
  const [editRecurrence, setEditRecurrence] = useState<"none" | "daily" | "weekly" | "monthly" | "yearly">("none");
  const [editDueDate, setEditDueDate] = useState("");

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [expandedResultId, setExpandedResultId] = useState<number | null>(null);
  
  const [sortBy, setSortBy] = useState<SortOption>("priority");
  const [filterBy, setFilterBy] = useState<FilterOption>("all");

  const startEditing = (item: UlysseHomework) => {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditDescription(item.description || "");
    setEditPriority((item.priority as "low" | "medium" | "high") || "medium");
    setEditRecurrence((item.recurrence as "none" | "daily" | "weekly" | "monthly" | "yearly") || "none");
    setEditDueDate(item.dueDate ? new Date(item.dueDate).toISOString().split('T')[0] : "");
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditTitle("");
    setEditDescription("");
    setEditPriority("medium");
    setEditRecurrence("none");
    setEditDueDate("");
  };

  const saveEditing = () => {
    if (!editingId || !editTitle.trim()) return;
    updateMutation.mutate({
      id: editingId,
      title: editTitle,
      description: editDescription || undefined,
      priority: editPriority,
      recurrence: editRecurrence,
      dueDate: editDueDate || undefined,
    });
    cancelEditing();
  };

  const { data: homework = [], isLoading } = useQuery<EnrichedHomework[]>({
    queryKey: ["/api/homework"],
    enabled: isOpen,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { title: string; description?: string; priority: string; recurrence: string; dueDate?: string }) => {
      return apiRequest("POST", "/api/homework", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/homework"] });
      setNewTitle("");
      setNewDescription("");
      setNewPriority("medium");
      setNewRecurrence("none");
      setNewDueDate("");
      setShowAddForm(false);
      toast({
        title: "Homework créé",
        description: "La tâche a été enregistrée avec succès.",
      });
    },
    onError: (error: Error) => {
      console.error("[HomeworkPanel] Failed to create homework:", error);
      toast({
        title: "Erreur de création",
        description: "La tâche n'a pas pu être enregistrée. Réessaie.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number; status?: string; title?: string; description?: string; priority?: string; recurrence?: string; dueDate?: string }) => {
      return apiRequest("PATCH", `/api/homework/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/homework"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/homework/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/homework"] });
      setDeleteConfirmId(null);
    },
  });

  const executeMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("POST", `/api/homework/${id}/execute`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/homework"] });
      toast({
        title: "Homework exécuté",
        description: "La tâche a été exécutée avec succès.",
      });
    },
    onError: (error: Error) => {
      const errorMessage = error?.message || "Erreur inconnue";
      console.error("[HomeworkPanel] Failed to execute homework:", errorMessage, error);
      toast({
        title: "Erreur d'exécution",
        description: errorMessage || "La tâche n'a pas pu être exécutée.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    createMutation.mutate({
      title: newTitle,
      description: newDescription || undefined,
      priority: newPriority,
      recurrence: newRecurrence,
      dueDate: newDueDate || undefined,
    });
  };

  const recurrenceLabels: Record<string, string> = {
    none: "Unique",
    daily: "Quotidien",
    weekly: "Hebdo",
    monthly: "Mensuel",
    yearly: "Annuel",
  };

  const priorityOrder = { high: 0, medium: 1, low: 2 };

  const getFilteredAndSortedTasks = (tasks: EnrichedHomework[]) => {
    let filtered = filterBy !== "all" 
      ? tasks.filter(t => t.priority === filterBy) 
      : tasks;
    
    // Use slice() to avoid mutating the original array from React Query
    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "priority":
          return (priorityOrder[a.priority as keyof typeof priorityOrder] || 1) - 
                 (priorityOrder[b.priority as keyof typeof priorityOrder] || 1);
        case "dueDate":
          if (!a.dueDate && !b.dueDate) return 0;
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        case "createdAt":
          // createdAt is guaranteed in schema, but handle undefined gracefully
          const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return bTime - aTime;
        default:
          return 0;
      }
    });
  };

  const pendingTasks = getFilteredAndSortedTasks(homework.filter(h => h.status === "pending" || h.status === "in_progress"));
  const completedTasks = homework.filter(h => h.status === "completed");

  const priorityColors = {
    low: "bg-blue-500/20 text-blue-500 border-blue-500/30",
    medium: "bg-yellow-500/20 text-yellow-500 border-yellow-500/30",
    high: "bg-red-500/20 text-red-500 border-red-500/30",
  };

  const getTimeRemaining = (dueDate: string | Date | null) => {
    if (!dueDate) return null;
    
    const now = new Date();
    const due = new Date(dueDate);
    const diffMs = due.getTime() - now.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (diffMs < 0) {
      const overdueDays = Math.abs(diffDays);
      return { text: `Retard ${overdueDays}j`, isOverdue: true };
    }
    
    if (diffDays === 0) {
      return { text: `Dans ${diffHours}h`, isOverdue: false, isUrgent: true };
    }
    
    if (diffDays === 1) {
      return { text: "Demain", isOverdue: false, isUrgent: true };
    }
    
    if (diffDays <= 7) {
      return { text: `Dans ${diffDays}j`, isOverdue: false, isUrgent: diffDays <= 2 };
    }
    
    return { text: `Dans ${diffDays}j`, isOverdue: false, isUrgent: false };
  };

  const getTaskProgress = (task: EnrichedHomework) => {
    if (task.status === "completed") return 100;
    
    const stats = task.executionStats;
    if (!stats) {
      if (task.status === "in_progress") return 60;
      if (task.lastExecutedAt) return 40;
      return 10;
    }
    
    let progress = 5;
    if (stats.totalRuns > 0) progress += 15;
    progress += Math.min(stats.completedRuns, 3) * 20;
    if (stats.hasResults) progress += 10;
    if (task.status === "in_progress") progress += 10;
    
    return Math.min(progress, 95);
  };

  const getProgressColor = (progress: number) => {
    if (progress >= 100) return "bg-green-500";
    if (progress >= 60) return "bg-yellow-500";
    if (progress >= 40) return "bg-blue-500";
    return "bg-muted-foreground/30";
  };

  if (!isOpen) return null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-2xl max-h-[85vh] flex flex-col"
        >
          <Card className="flex flex-col overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3 border-b">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-primary" />
                <CardTitle className="text-lg">Homework</CardTitle>
                <Badge variant="outline" className="ml-2">
                  {pendingTasks.length} en attente
                </Badge>
              </div>
              <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-close-homework">
                <X className="w-4 h-4" />
              </Button>
            </CardHeader>

            <CardContent className="flex-1 overflow-hidden p-0">
              <div className="flex items-center gap-2 p-3 border-b bg-muted/30">
                <Select value={filterBy} onValueChange={(v) => setFilterBy(v as FilterOption)}>
                  <SelectTrigger className="w-28" data-testid="select-filter-priority">
                    <Filter className="w-3 h-3 mr-1" />
                    <SelectValue placeholder="Filtrer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes</SelectItem>
                    <SelectItem value="high">Haute</SelectItem>
                    <SelectItem value="medium">Moyenne</SelectItem>
                    <SelectItem value="low">Basse</SelectItem>
                  </SelectContent>
                </Select>
                
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
                  <SelectTrigger className="w-32" data-testid="select-sort-by">
                    <ArrowUpDown className="w-3 h-3 mr-1" />
                    <SelectValue placeholder="Trier" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="priority">Priorité</SelectItem>
                    <SelectItem value="dueDate">Échéance</SelectItem>
                    <SelectItem value="createdAt">Date création</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <ScrollArea className="h-[50vh]">
                <div className="p-4 space-y-3">
                  <AnimatePresence>
                    {showAddForm && (
                      <motion.form
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        onSubmit={handleSubmit}
                        className="space-y-3 p-3 bg-muted/50 rounded-md border"
                      >
                        <Input
                          placeholder="Titre de la tâche..."
                          value={newTitle}
                          onChange={(e) => setNewTitle(e.target.value)}
                          data-testid="input-homework-title"
                          autoFocus
                        />
                        <Textarea
                          placeholder="Description (optionnel)..."
                          value={newDescription}
                          onChange={(e) => setNewDescription(e.target.value)}
                          className="min-h-[60px]"
                          data-testid="input-homework-description"
                        />
                        <div className="flex items-center gap-2 flex-wrap">
                          <Select value={newPriority} onValueChange={(v) => setNewPriority(v as any)}>
                            <SelectTrigger className="w-28" data-testid="select-homework-priority">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="low">Basse</SelectItem>
                              <SelectItem value="medium">Moyenne</SelectItem>
                              <SelectItem value="high">Haute</SelectItem>
                            </SelectContent>
                          </Select>
                          <Select value={newRecurrence} onValueChange={(v) => setNewRecurrence(v as any)}>
                            <SelectTrigger className="w-32" data-testid="select-homework-recurrence">
                              <Repeat className="w-3 h-3 mr-1" />
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Unique</SelectItem>
                              <SelectItem value="daily">Quotidien</SelectItem>
                              <SelectItem value="weekly">Hebdomadaire</SelectItem>
                              <SelectItem value="monthly">Mensuel</SelectItem>
                              <SelectItem value="yearly">Annuel</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-muted-foreground" />
                          <Input
                            type="date"
                            value={newDueDate}
                            onChange={(e) => setNewDueDate(e.target.value)}
                            className="flex-1"
                            data-testid="input-homework-duedate"
                          />
                        </div>
                        <div className="flex items-center gap-2 justify-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowAddForm(false)}
                          >
                            Annuler
                          </Button>
                          <Button
                            type="submit"
                            size="sm"
                            disabled={!newTitle.trim() || createMutation.isPending}
                            data-testid="button-submit-homework"
                          >
                            {createMutation.isPending ? "..." : "Ajouter"}
                          </Button>
                        </div>
                      </motion.form>
                    )}
                  </AnimatePresence>

                  {!showAddForm && (
                    <Button
                      variant="outline"
                      className="w-full justify-start gap-2"
                      onClick={() => setShowAddForm(true)}
                      data-testid="button-add-homework"
                    >
                      <Plus className="w-4 h-4" />
                      Ajouter une tâche pour Ulysse
                    </Button>
                  )}

                  {isLoading ? (
                    <div className="text-center py-8 text-muted-foreground">
                      Chargement...
                    </div>
                  ) : pendingTasks.length === 0 && completedTasks.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-50" />
                      <p>Aucune tâche assignée</p>
                      <p className="text-sm">Ajoutez des tâches pour qu'Ulysse se prépare</p>
                    </div>
                  ) : (
                    <>
                      {pendingTasks.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            En cours ({pendingTasks.length})
                          </h4>
                          {pendingTasks.map((item) => (
                            <motion.div
                              key={item.id}
                              layout
                              className="p-3 bg-card border rounded-md space-y-2"
                            >
                              {editingId === item.id ? (
                                <div className="space-y-2">
                                  <Input
                                    value={editTitle}
                                    onChange={(e) => setEditTitle(e.target.value)}
                                    data-testid={`input-edit-title-${item.id}`}
                                    autoFocus
                                  />
                                  <Textarea
                                    value={editDescription}
                                    onChange={(e) => setEditDescription(e.target.value)}
                                    className="min-h-[120px]"
                                    data-testid={`input-edit-description-${item.id}`}
                                  />
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Select value={editPriority} onValueChange={(v) => setEditPriority(v as any)}>
                                      <SelectTrigger className="w-24">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="low">Basse</SelectItem>
                                        <SelectItem value="medium">Moyenne</SelectItem>
                                        <SelectItem value="high">Haute</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <Select value={editRecurrence} onValueChange={(v) => setEditRecurrence(v as any)}>
                                      <SelectTrigger className="w-28">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="none">Unique</SelectItem>
                                        <SelectItem value="daily">Quotidien</SelectItem>
                                        <SelectItem value="weekly">Hebdo</SelectItem>
                                        <SelectItem value="monthly">Mensuel</SelectItem>
                                        <SelectItem value="yearly">Annuel</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <Input
                                      type="date"
                                      value={editDueDate}
                                      onChange={(e) => setEditDueDate(e.target.value)}
                                      className="w-36"
                                    />
                                  </div>
                                  <div className="flex items-center gap-2 justify-end">
                                    <Button size="sm" variant="ghost" onClick={cancelEditing}>
                                      Annuler
                                    </Button>
                                    <Button size="sm" onClick={saveEditing} disabled={updateMutation.isPending}>
                                      {updateMutation.isPending ? "..." : "Sauver"}
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <div className="flex items-start gap-2">
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="shrink-0 mt-0.5"
                                      onClick={() => updateMutation.mutate({ id: item.id, status: "completed" })}
                                      disabled={updateMutation.isPending}
                                      data-testid={`button-complete-homework-${item.id}`}
                                    >
                                      {item.status === "in_progress" ? (
                                        <Loader2 className="w-4 h-4 text-yellow-500 animate-spin" />
                                      ) : (
                                        <AlertCircle className="w-4 h-4 text-muted-foreground" />
                                      )}
                                    </Button>
                                    <div className="flex-1 min-w-0">
                                      <div className="space-y-2">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="font-medium">{item.title}</span>
                                          <Badge
                                            variant="outline"
                                            className={cn("text-xs", priorityColors[item.priority as keyof typeof priorityColors])}
                                          >
                                            {item.priority}
                                          </Badge>
                                          {item.recurrence && item.recurrence !== "none" && (
                                            <Badge variant="outline" className="text-xs bg-purple-500/20 text-purple-500 border-purple-500/30">
                                              <Repeat className="w-3 h-3 mr-1" />
                                              {recurrenceLabels[item.recurrence] || item.recurrence}
                                            </Badge>
                                          )}
                                          {item.dueDate && (() => {
                                            const timeInfo = getTimeRemaining(item.dueDate);
                                            if (!timeInfo) return null;
                                            return (
                                              <Badge 
                                                variant="outline" 
                                                className={cn(
                                                  "text-xs",
                                                  timeInfo.isOverdue && "bg-red-500/20 text-red-500 border-red-500/30",
                                                  timeInfo.isUrgent && !timeInfo.isOverdue && "bg-orange-500/20 text-orange-500 border-orange-500/30",
                                                  !timeInfo.isOverdue && !timeInfo.isUrgent && "bg-muted text-muted-foreground"
                                                )}
                                              >
                                                <Clock className="w-3 h-3 mr-1" />
                                                {timeInfo.text}
                                              </Badge>
                                            );
                                          })()}
                                        </div>
                                        <div className="flex items-center gap-1">
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-7 w-7 text-green-600"
                                            onClick={() => executeMutation.mutate(item.id)}
                                            disabled={executeMutation.isPending || item.status === "in_progress"}
                                            title="Exécuter maintenant"
                                            data-testid={`button-execute-homework-${item.id}`}
                                          >
                                            {executeMutation.isPending ? (
                                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            ) : (
                                              <Play className="w-3.5 h-3.5" />
                                            )}
                                          </Button>
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-7 w-7"
                                            onClick={() => startEditing(item)}
                                            data-testid={`button-edit-homework-${item.id}`}
                                          >
                                            <Pencil className="w-3.5 h-3.5" />
                                          </Button>
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-7 w-7 text-destructive"
                                            onClick={() => setDeleteConfirmId(item.id)}
                                            disabled={deleteMutation.isPending}
                                            data-testid={`button-delete-homework-${item.id}`}
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </Button>
                                          <span className="text-xs text-muted-foreground ml-auto">Actions</span>
                                        </div>
                                      </div>
                                      {item.description && (
                                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                                          {item.description}
                                        </p>
                                      )}
                                      <div className="mt-2 flex items-center gap-2">
                                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                          <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: `${getTaskProgress(item)}%` }}
                                            transition={{ duration: 0.5, ease: "easeOut" }}
                                            className={cn("h-full rounded-full", getProgressColor(getTaskProgress(item)))}
                                          />
                                        </div>
                                        <span className="text-xs text-muted-foreground w-8 text-right">
                                          {getTaskProgress(item)}%
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                  
                                  {item.executionStats?.hasResults && item.executionStats.lastResultSummary && (
                                    <Collapsible 
                                      open={expandedResultId === item.id}
                                      onOpenChange={() => setExpandedResultId(expandedResultId === item.id ? null : item.id)}
                                    >
                                      <CollapsibleTrigger asChild>
                                        <Button 
                                          variant="ghost" 
                                          size="sm" 
                                          className="w-full justify-between text-xs text-muted-foreground hover:text-foreground"
                                        >
                                          <span className="flex items-center gap-1">
                                            <FileText className="w-3 h-3" />
                                            Voir les résultats
                                          </span>
                                          {expandedResultId === item.id ? (
                                            <ChevronUp className="w-3 h-3" />
                                          ) : (
                                            <ChevronDown className="w-3 h-3" />
                                          )}
                                        </Button>
                                      </CollapsibleTrigger>
                                      <CollapsibleContent>
                                        <div className="mt-2 p-3 bg-muted/50 rounded-md text-sm overflow-x-auto">
                                          <div className="prose prose-sm dark:prose-invert max-w-none prose-table:text-xs prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1 prose-table:border-collapse prose-th:border prose-td:border prose-th:bg-muted prose-th:font-semibold">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                              {item.executionStats.lastResultSummary}
                                            </ReactMarkdown>
                                          </div>
                                          {item.executionStats.lastRunAt && (
                                            <p className="text-xs text-muted-foreground mt-2">
                                              Dernière exécution: {new Date(item.executionStats.lastRunAt).toLocaleString("fr-FR")}
                                            </p>
                                          )}
                                        </div>
                                      </CollapsibleContent>
                                    </Collapsible>
                                  )}
                                </div>
                              )}
                            </motion.div>
                          ))}
                        </div>
                      )}

                      {completedTasks.length > 0 && (
                        <div className="space-y-2 mt-4">
                          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            Terminées ({completedTasks.length})
                          </h4>
                          {completedTasks.slice(0, 5).map((item) => (
                            <motion.div
                              key={item.id}
                              layout
                              className="p-3 bg-muted/30 border rounded-md space-y-2 opacity-60"
                            >
                              <div className="flex items-center gap-2">
                                <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                                <span className="flex-1 line-through text-sm">{item.title}</span>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="shrink-0 text-destructive"
                                  onClick={() => setDeleteConfirmId(item.id)}
                                  disabled={deleteMutation.isPending}
                                  data-testid={`button-delete-completed-homework-${item.id}`}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                              
                              {(item as EnrichedHomework).executionStats?.lastResultSummary && (
                                <Collapsible 
                                  open={expandedResultId === item.id}
                                  onOpenChange={() => setExpandedResultId(expandedResultId === item.id ? null : item.id)}
                                >
                                  <CollapsibleTrigger asChild>
                                    <Button 
                                      variant="ghost" 
                                      size="sm" 
                                      className="w-full justify-between text-xs text-muted-foreground hover:text-foreground"
                                    >
                                      <span className="flex items-center gap-1">
                                        <FileText className="w-3 h-3" />
                                        Résultats
                                      </span>
                                      {expandedResultId === item.id ? (
                                        <ChevronUp className="w-3 h-3" />
                                      ) : (
                                        <ChevronDown className="w-3 h-3" />
                                      )}
                                    </Button>
                                  </CollapsibleTrigger>
                                  <CollapsibleContent>
                                    <div className="mt-2 p-3 bg-background/50 rounded-md text-sm overflow-x-auto">
                                      <div className="prose prose-sm dark:prose-invert max-w-none prose-table:text-xs prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1 prose-table:border-collapse prose-th:border prose-td:border prose-th:bg-muted prose-th:font-semibold">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                          {(item as EnrichedHomework).executionStats?.lastResultSummary || ""}
                                        </ReactMarkdown>
                                      </div>
                                    </div>
                                  </CollapsibleContent>
                                </Collapsible>
                              )}
                            </motion.div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      <Dialog open={deleteConfirmId !== null} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Confirmer la suppression
            </DialogTitle>
            <DialogDescription>
              Êtes-vous sûr de vouloir supprimer cette tâche ? Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteConfirmId(null)}>
              Annuler
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-homework"
            >
              {deleteMutation.isPending ? "Suppression..." : "Supprimer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
