import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  FolderOpen,
  FileText,
  Image,
  Music,
  Video,
  Download,
  Eye,
  Sparkles,
  File,
  FolderPlus,
} from "lucide-react";

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

function getFileIcon(type: string) {
  if (type.startsWith("image")) return Image;
  if (type.startsWith("audio")) return Music;
  if (type.startsWith("video")) return Video;
  if (type.includes("pdf") || type.includes("text")) return FileText;
  return File;
}

interface UserFile {
  id: number;
  name: string;
  type: string;
  size: number;
  category: string;
  createdAt: string;
  url?: string;
}

export default function IrisFiles() {
  const [, navigate] = useLocation();
  const { user } = useAuth();

  const ownerName = getOwnerName(user?.username || "");
  const cfg = THEME[ownerName] || THEME.Kelly;

  const { data: files = [] } = useQuery<UserFile[]>({
    queryKey: ["/api/files", user?.id],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/files?userId=${user?.id}`, { credentials: "include" });
        if (!res.ok) return [];
        return res.json();
      } catch {
        return [];
      }
    },
  });

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const categories = [
    { label: "Tout", value: null, icon: FolderOpen },
    { label: "Images", value: "image", icon: Image },
    { label: "Documents", value: "document", icon: FileText },
    { label: "Audio", value: "audio", icon: Music },
    { label: "Vidéos", value: "video", icon: Video },
  ];

  const filteredFiles = selectedCategory
    ? files.filter((f) => f.type?.startsWith(selectedCategory) || f.category === selectedCategory)
    : files;

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="min-h-screen bg-background" data-testid="iris-files-page">
      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        <motion.header initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => navigate("/iris")} data-testid="button-back-iris">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-2">
              <FolderOpen className={`h-6 w-6 ${cfg.accent}`} />
              <div>
                <h1 className={`text-lg font-black bg-gradient-to-r ${cfg.gradient} bg-clip-text text-transparent`}>Mes Fichiers</h1>
                <p className="text-[10px] text-muted-foreground">{files.length} fichier{files.length !== 1 ? "s" : ""} {cfg.emoji}</p>
              </div>
            </div>
          </div>
        </motion.header>

        <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {categories.map((cat) => {
            const Icon = cat.icon;
            const isActive = selectedCategory === cat.value;
            return (
              <Button
                key={cat.label}
                variant={isActive ? "default" : "outline"}
                size="sm"
                className={`rounded-xl text-xs flex-shrink-0 ${isActive ? `bg-gradient-to-r ${cfg.gradient} border-0 text-white` : ""}`}
                onClick={() => setSelectedCategory(cat.value)}
                data-testid={`filter-${cat.label.toLowerCase()}`}
              >
                <Icon className={`h-3 w-3 mr-1 ${isActive ? "text-white" : cfg.accent}`} />
                {cat.label}
              </Button>
            );
          })}
        </div>

        {filteredFiles.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Card className="border-dashed border-2">
              <CardContent className="p-12 text-center">
                <FolderPlus className={`h-12 w-12 mx-auto mb-3 ${cfg.accent}`} />
                <h3 className="font-bold mb-1">Pas encore de fichiers</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Demande à Iris de générer une image ou d'exporter un document !
                </p>
                <Button variant="outline" className="rounded-xl" onClick={() => navigate("/iris")} data-testid="button-back-chat">
                  <Sparkles className={`h-4 w-4 mr-2 ${cfg.accent}`} />
                  Parler à Iris
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filteredFiles.map((file, idx) => {
              const FileIcon = getFileIcon(file.type);
              return (
                <motion.div key={file.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
                  <Card className="overflow-hidden group hover:shadow-md transition-shadow" data-testid={`file-${file.id}`}>
                    <div className={`h-1 bg-gradient-to-r ${cfg.gradient}`} />
                    <CardContent className="p-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                          <FileIcon className={`h-5 w-5 ${cfg.accent}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{file.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge variant="outline" className="text-[9px]">{file.type?.split("/")[1] || "fichier"}</Badge>
                            <span className="text-[10px] text-muted-foreground">{formatSize(file.size)}</span>
                          </div>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {file.url && (
                            <>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg" asChild>
                                <a href={file.url} target="_blank" rel="noopener noreferrer" data-testid={`view-${file.id}`}>
                                  <Eye className="h-3.5 w-3.5" />
                                </a>
                              </Button>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg" asChild>
                                <a href={file.url} download data-testid={`download-${file.id}`}>
                                  <Download className="h-3.5 w-3.5" />
                                </a>
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
