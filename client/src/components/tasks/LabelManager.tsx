import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tags, Plus, X, Check } from "lucide-react";
import {
  useTaskLabels,
  useCreateTaskLabel,
  useDeleteTaskLabel,
  useTaskLabelAssignments,
  useAssignLabel,
  useUnassignLabel,
} from "@/hooks/use-tasks";
import type { TaskLabel } from "@shared/schema";
import { cn } from "@/lib/utils";

const PRESET_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899",
];

export function LabelManagerDialog() {
  const { data: labels = [] } = useTaskLabels();
  const createLabel = useCreateTaskLabel();
  const deleteLabel = useDeleteTaskLabel();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [open, setOpen] = useState(false);

  const handleCreate = () => {
    if (!newName.trim()) return;
    createLabel.mutate({ name: newName.trim(), color: newColor });
    setNewName("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" data-testid="button-manage-labels">
          <Tags className="w-4 h-4" />
          Étiquettes
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Gérer les étiquettes</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nouvelle étiquette..."
              className="flex-1"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              data-testid="input-new-label"
            />
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-10 p-0"
                  style={{ backgroundColor: newColor }}
                  data-testid="button-select-color"
                />
              </PopoverTrigger>
              <PopoverContent className="w-auto p-2">
                <div className="grid grid-cols-5 gap-1">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      className={cn(
                        "w-6 h-6 rounded-full transition-transform hover:scale-110",
                        newColor === color && "ring-2 ring-offset-2 ring-primary"
                      )}
                      style={{ backgroundColor: color }}
                      onClick={() => setNewColor(color)}
                      data-testid={`color-${color.replace("#", "")}`}
                    />
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Button onClick={handleCreate} disabled={!newName.trim() || createLabel.isPending} data-testid="button-create-label">
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          <div className="space-y-2">
            {labels.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Aucune étiquette créée
              </p>
            ) : (
              labels.map((label) => (
                <div key={label.id} className="flex items-center justify-between gap-2 p-2 rounded-md hover:bg-muted/50">
                  <Badge
                    className="text-white"
                    style={{ backgroundColor: label.color }}
                  >
                    {label.name}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => deleteLabel.mutate(label.id)}
                    data-testid={`button-delete-label-${label.id}`}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface LabelPickerProps {
  taskId: number;
}

export function LabelPicker({ taskId }: LabelPickerProps) {
  const { data: allLabels = [] } = useTaskLabels();
  const { data: assignedLabels = [] } = useTaskLabelAssignments(taskId);
  const assignLabel = useAssignLabel();
  const unassignLabel = useUnassignLabel();

  const assignedIds = assignedLabels.map((l) => l.id);

  const handleToggle = (label: TaskLabel) => {
    if (assignedIds.includes(label.id)) {
      unassignLabel.mutate({ taskId, labelId: label.id });
    } else {
      assignLabel.mutate({ taskId, labelId: label.id });
    }
  };

  if (allLabels.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6" data-testid={`button-label-picker-${taskId}`}>
          <Tags className="w-3 h-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-2">
        <div className="space-y-1">
          {allLabels.map((label) => (
            <button
              key={label.id}
              className="flex items-center gap-2 w-full p-1.5 rounded-md hover:bg-muted/50 text-sm"
              onClick={() => handleToggle(label)}
              data-testid={`toggle-label-${label.id}-task-${taskId}`}
            >
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: label.color }}
              />
              <span className="flex-1 text-left">{label.name}</span>
              {assignedIds.includes(label.id) && (
                <Check className="w-3 h-3 text-primary" />
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
