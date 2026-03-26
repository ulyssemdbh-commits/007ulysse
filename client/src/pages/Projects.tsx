import { PageContainer } from "@/components/layout/PageContainer";
import { CreateProjectDialog } from "@/components/CreateProjectDialog";
import { useProjects } from "@/hooks/use-projects";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarDays, FolderOpen } from "lucide-react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { Link } from "wouter";

export default function Projects() {
  const { data: projects, isLoading } = useProjects();

  return (
    <PageContainer 
      title="Projects" 
      action={<CreateProjectDialog />}
    >
      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-48 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {projects?.map((project, idx) => (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <Link href={`/projects/${project.id}`} data-testid={`link-project-${project.id}`}>
              <Card className="h-full bg-card border-border/50 shadow-lg hover:shadow-xl hover:border-primary/50 transition-all duration-300 group cursor-pointer">
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                  <div className="p-2 bg-primary/10 rounded-lg group-hover:bg-primary/20 transition-colors">
                    <FolderOpen className="w-5 h-5 text-primary" />
                  </div>
                  <StatusBadge status={project.status} />
                </CardHeader>
                <CardContent className="pt-4">
                  <CardTitle className="text-xl mb-2 group-hover:text-primary transition-colors">
                    {project.name}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground line-clamp-3">
                    {project.description || "No description provided."}
                  </p>
                </CardContent>
                <CardFooter className="text-xs text-muted-foreground border-t border-border/50 pt-4 mt-auto">
                  <div className="flex items-center">
                    <CalendarDays className="w-3 h-3 mr-1" />
                    Created {format(new Date(project.createdAt || new Date()), 'MMM d, yyyy')}
                  </div>
                </CardFooter>
              </Card>
              </Link>
            </motion.div>
          ))}
          
          {projects?.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center py-20 text-muted-foreground border-2 border-dashed border-border/50 rounded-2xl bg-secondary/10">
              <FolderOpen className="w-12 h-12 mb-4 opacity-50" />
              <p className="text-lg font-medium">No projects yet</p>
              <p className="text-sm">Create your first project to get started</p>
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}
