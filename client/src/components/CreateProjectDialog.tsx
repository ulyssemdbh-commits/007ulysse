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
import { useCreateProject } from "@/hooks/use-projects";
import { useToast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertProjectSchema } from "@shared/schema";
import { z } from "zod";

const createProjectFormSchema = insertProjectSchema.omit({ userId: true });
type CreateProjectForm = z.infer<typeof createProjectFormSchema>;

export function CreateProjectDialog() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const createProject = useCreateProject();
  
  const form = useForm<CreateProjectForm>({
    resolver: zodResolver(createProjectFormSchema),
    defaultValues: {
      name: "",
      description: "",
      status: "active"
    }
  });

  const onSubmit = (data: CreateProjectForm) => {
    createProject.mutate(data as any, {
      onSuccess: () => {
        setOpen(false);
        form.reset();
        toast({ title: "Success", description: "Project created successfully" });
      },
      onError: (err) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/25">
          <Plus className="mr-2 h-4 w-4" /> New Project
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">Create Project</DialogTitle>
          <DialogDescription>
            Add a new project to track your development progress.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-foreground">Name</Label>
            <Input
              id="name"
              {...form.register("name")}
              placeholder="Project Alpha"
              className="bg-secondary border-input focus:border-primary focus:ring-primary/20"
            />
            {form.formState.errors.name && (
              <p className="text-destructive text-xs">{form.formState.errors.name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="description" className="text-foreground">Description</Label>
            <Textarea
              id="description"
              {...form.register("description")}
              placeholder="What is this project about?"
              className="bg-secondary border-input focus:border-primary focus:ring-primary/20 min-h-[100px]"
            />
          </div>
          <DialogFooter>
            <Button 
              type="submit" 
              disabled={createProject.isPending}
              className="w-full bg-primary hover:bg-primary/90"
            >
              {createProject.isPending ? "Creating..." : "Create Project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
