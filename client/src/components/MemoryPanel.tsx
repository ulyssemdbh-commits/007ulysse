import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Brain, Trash2, User, Folder, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface UlysseMemory {
  id: number;
  category: string;
  key: string;
  value: string;
  confidence: number;
  source: string | null;
}

interface ProjectMemory {
  id: number;
  projectName: string;
  summary: string | null;
  techStack: string[] | null;
  status: string;
}

interface MemoryData {
  memories: UlysseMemory[];
  projects: ProjectMemory[];
}

const categoryIcons: Record<string, string> = {
  personality: "personality",
  preference: "preferences",
  skill: "skills",
  interest: "interests",
  habit: "habits",
  fact: "facts"
};

const categoryColors: Record<string, string> = {
  personality: "bg-purple-500/10 text-purple-500 dark:bg-purple-500/20",
  preference: "bg-blue-500/10 text-blue-500 dark:bg-blue-500/20",
  skill: "bg-green-500/10 text-green-500 dark:bg-green-500/20",
  interest: "bg-yellow-500/10 text-yellow-500 dark:bg-yellow-500/20",
  habit: "bg-orange-500/10 text-orange-500 dark:bg-orange-500/20",
  fact: "bg-gray-500/10 text-gray-500 dark:bg-gray-500/20"
};

interface MemoryPanelProps {
  onClose: () => void;
}

export function MemoryPanel({ onClose }: MemoryPanelProps) {
  const queryClient = useQueryClient();
  
  const { data, isLoading } = useQuery<MemoryData>({
    queryKey: ["/api/memory"]
  });

  const deleteMemory = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/memory/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/memory"] });
    }
  });

  const deleteProject = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/memory/project/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/memory"] });
    }
  });

  const groupedMemories = data?.memories.reduce((acc, mem) => {
    if (!acc[mem.category]) acc[mem.category] = [];
    acc[mem.category].push(mem);
    return acc;
  }, {} as Record<string, UlysseMemory[]>) || {};

  return (
    <Card className="fixed inset-0 sm:inset-4 z-50 flex flex-col sm:max-w-2xl sm:mx-auto sm:max-h-[90vh] rounded-none sm:rounded-lg">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">Ce que je sais de toi</CardTitle>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-close-memory">
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      
      <ScrollArea className="flex-1">
        <CardContent className="p-4 space-y-6">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Chargement...
            </div>
          ) : !data?.memories.length && !data?.projects.length ? (
            <div className="text-center py-8 text-muted-foreground">
              <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Je n'ai encore rien appris sur toi.</p>
              <p className="text-sm mt-2">Discute avec moi et je retiendrai ce qui est important!</p>
            </div>
          ) : (
            <>
              {Object.entries(groupedMemories).map(([category, memories]) => (
                <div key={category}>
                  <div className="flex items-center gap-2 mb-3">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <h3 className="font-medium capitalize">{categoryIcons[category] || category}</h3>
                    <Badge variant="secondary" className="text-xs">
                      {memories.length}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    {memories.map((mem) => (
                      <div
                        key={mem.id}
                        className="group flex items-start justify-between gap-2 p-3 rounded-md bg-muted/50"
                        data-testid={`memory-item-${mem.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="font-medium text-sm">{mem.key}</span>
                            <Badge 
                              variant="outline" 
                              className={`text-xs ${categoryColors[mem.category] || ""}`}
                            >
                              {mem.confidence}%
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{mem.value}</p>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          onClick={() => deleteMemory.mutate(mem.id)}
                          disabled={deleteMemory.isPending}
                          data-testid={`button-delete-memory-${mem.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {data?.projects && data.projects.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Folder className="h-4 w-4 text-muted-foreground" />
                    <h3 className="font-medium">Projets</h3>
                    <Badge variant="secondary" className="text-xs">
                      {data.projects.length}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    {data.projects.map((proj) => (
                      <div
                        key={proj.id}
                        className="group flex items-start justify-between gap-2 p-3 rounded-md bg-muted/50"
                        data-testid={`project-item-${proj.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="font-medium text-sm">{proj.projectName}</span>
                            <Badge variant="outline" className="text-xs">
                              {proj.status}
                            </Badge>
                          </div>
                          {proj.summary && (
                            <p className="text-sm text-muted-foreground">{proj.summary}</p>
                          )}
                          {proj.techStack && proj.techStack.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {proj.techStack.map((tech, i) => (
                                <Badge key={i} variant="secondary" className="text-xs">
                                  {tech}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          onClick={() => deleteProject.mutate(proj.id)}
                          disabled={deleteProject.isPending}
                          data-testid={`button-delete-project-${proj.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </ScrollArea>
    </Card>
  );
}
