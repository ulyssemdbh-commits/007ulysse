import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateTask } from "@/hooks/use-tasks";
import { useProjects } from "@/hooks/use-projects";
import { useToast } from "@/hooks/use-toast";
import { Plus, Repeat } from "lucide-react";
import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertTaskSchema } from "@shared/schema";
import { z } from "zod";
import { Checkbox } from "@/components/ui/checkbox";

const clientTaskSchema = insertTaskSchema.omit({ userId: true });
type ClientTask = z.infer<typeof clientTaskSchema>;

const RECURRENCE_TYPES = [
  { value: "daily", label: "Quotidien" },
  { value: "weekly", label: "Hebdomadaire" },
  { value: "monthly", label: "Mensuel" },
  { value: "yearly", label: "Annuel" },
];

export function CreateTaskDialog({ projectId }: { projectId?: number }) {
  const [open, setOpen] = useState(false);
  const [showRecurrence, setShowRecurrence] = useState(false);
  const { toast } = useToast();
  const createTask = useCreateTask();
  const { data: projects } = useProjects();
  
  const form = useForm<ClientTask>({
    resolver: zodResolver(clientTaskSchema),
    defaultValues: {
      title: "",
      description: "",
      projectId: projectId || undefined,
      status: "todo",
      priority: "medium",
      recurrenceType: undefined,
      recurrenceInterval: 1
    }
  });

  const onSubmit = (data: ClientTask) => {
    createTask.mutate(data, {
      onSuccess: () => {
        setOpen(false);
        form.reset();
        toast({ title: "Succès", description: "Tâche créée avec succès" });
      },
      onError: (err) => {
        toast({ title: "Erreur", description: err.message, variant: "destructive" });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button 
          className="bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/25"
          data-testid="button-new-task"
        >
          <Plus className="mr-2 h-4 w-4" /> Nouvelle tâche
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">Créer une tâche</DialogTitle>
          <DialogDescription>
            Ajoutez une nouvelle tâche à votre liste.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="title">Titre</Label>
            <Input
              id="title"
              {...form.register("title")}
              placeholder="Corriger le bug de navigation"
              className="bg-secondary border-input"
              data-testid="input-task-title"
            />
            {form.formState.errors.title && (
              <p className="text-destructive text-xs">{form.formState.errors.title.message}</p>
            )}
          </div>
          
          {!projectId && projects && projects.length > 0 && (
            <div className="space-y-2">
              <Label>Projet (optionnel)</Label>
              <Controller
                control={form.control}
                name="projectId"
                render={({ field }) => (
                  <Select 
                    onValueChange={(val) => field.onChange(val === "none" ? undefined : parseInt(val))}
                    value={field.value?.toString() || "none"}
                  >
                    <SelectTrigger className="bg-secondary border-input" data-testid="select-project">
                      <SelectValue placeholder="Sélectionner un projet" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Aucun projet</SelectItem>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id.toString()}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Statut</Label>
              <Controller
                control={form.control}
                name="status"
                render={({ field }) => (
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <SelectTrigger className="bg-secondary border-input" data-testid="select-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todo">À faire</SelectItem>
                      <SelectItem value="in_progress">En cours</SelectItem>
                      <SelectItem value="done">Terminé</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            
            <div className="space-y-2">
              <Label>Priorité</Label>
              <Controller
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <Select onValueChange={field.onChange} defaultValue={field.value || "medium"}>
                    <SelectTrigger className="bg-secondary border-input" data-testid="select-priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Basse</SelectItem>
                      <SelectItem value="medium">Normale</SelectItem>
                      <SelectItem value="high">Haute</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              {...form.register("description")}
              placeholder="Détails de la tâche..."
              className="bg-secondary border-input min-h-[100px]"
              data-testid="input-task-description"
            />
          </div>

          <div className="space-y-3 border-t pt-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="recurrence"
                checked={showRecurrence}
                onCheckedChange={(checked) => {
                  setShowRecurrence(!!checked);
                  if (!checked) {
                    form.setValue("recurrenceType", undefined);
                    form.setValue("recurrenceInterval", 1);
                  }
                }}
                data-testid="checkbox-recurrence"
              />
              <Label htmlFor="recurrence" className="flex items-center gap-1 cursor-pointer">
                <Repeat className="w-3.5 h-3.5" />
                Tâche récurrente
              </Label>
            </div>

            {showRecurrence && (
              <div className="grid grid-cols-2 gap-3 pl-6">
                <div className="space-y-1">
                  <Label className="text-xs">Fréquence</Label>
                  <Controller
                    control={form.control}
                    name="recurrenceType"
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value || ""}>
                        <SelectTrigger className="bg-secondary border-input h-8 text-xs" data-testid="select-recurrence-type">
                          <SelectValue placeholder="Choisir..." />
                        </SelectTrigger>
                        <SelectContent>
                          {RECURRENCE_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tous les</Label>
                  <Controller
                    control={form.control}
                    name="recurrenceInterval"
                    render={({ field }) => (
                      <Select onValueChange={(v) => field.onChange(parseInt(v))} value={String(field.value || 1)}>
                        <SelectTrigger className="bg-secondary border-input h-8 text-xs" data-testid="select-recurrence-interval">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4, 5, 6, 7, 14, 30].map((n) => (
                            <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button 
              type="submit" 
              disabled={createTask.isPending}
              className="w-full bg-primary hover:bg-primary/90"
              data-testid="button-submit-task"
            >
              {createTask.isPending ? "Création..." : "Créer la tâche"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
