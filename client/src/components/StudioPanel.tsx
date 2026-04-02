import { useState, useRef, useEffect, useMemo, useCallback, Suspense } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Image as ImageIcon, FileText, Video, Send, Download,
  ChevronLeft, ChevronRight, Loader2, Pencil, Clock,
  ZoomIn, ZoomOut, RotateCcw, Tag, Sparkles, FileImage,
  Film, Music, Wand2, History, Layers, Eye, MessageCircle, Bot, User,
  Box, ArrowRightLeft, Ruler, Maximize2
} from "lucide-react";
import { Canvas, useLoader } from "@react-three/fiber";
import { OrbitControls, Grid, Environment } from "@react-three/drei";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { UlysseFile } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

interface StudioPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialFileId?: number;
}

type MediaType = "all" | "image" | "video" | "document" | "audio" | "3d";

function is3DFile(name: string, mime: string): boolean {
  const ext = name.toLowerCase().split(".").pop();
  return ext === "stl" || ext === "3mf" || mime === "model/stl" || mime === "application/vnd.ms-package.3dmanufacturing-3dmodel+xml";
}

function getFileIcon(mimeType: string, fileName?: string) {
  if (fileName && is3DFile(fileName, mimeType)) return Box;
  if (mimeType.startsWith("image/")) return ImageIcon;
  if (mimeType.startsWith("video/")) return Film;
  if (mimeType.startsWith("audio/")) return Music;
  return FileText;
}

function getMediaType(mimeType: string, fileName?: string): MediaType {
  if (fileName && is3DFile(fileName, mimeType)) return "3d";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}

function getTypeBadge(type: MediaType) {
  const colors: Record<MediaType, string> = {
    all: "bg-gray-500",
    image: "bg-blue-500",
    video: "bg-purple-500",
    audio: "bg-green-500",
    document: "bg-orange-500",
    "3d": "bg-cyan-500",
  };
  return colors[type] || colors.document;
}

interface Analysis3D {
  fileName: string;
  triangleCount: number;
  vertexCount: number;
  dimensions: { width: number; height: number; depth: number };
  volume?: number;
  surfaceArea?: number;
  isClosed?: boolean;
  format?: string;
  unit?: string;
}

function STLViewer({ url }: { url: string }) {
  const geometry = useLoader(STLLoader, url);

  const { center, scale: modelScale } = useMemo(() => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const c = new THREE.Vector3();
    box.getCenter(c);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    return { center: c, scale: maxDim > 0 ? 5 / maxDim : 1 };
  }, [geometry]);

  return (
    <mesh geometry={geometry} scale={modelScale} position={[-center.x * modelScale, -center.y * modelScale, -center.z * modelScale]}>
      <meshStandardMaterial color="#6d9eeb" metalness={0.3} roughness={0.5} />
    </mesh>
  );
}

function ThreeDViewer({ fileId, fileName }: { fileId: number; fileName: string }) {
  const isSTL = fileName.toLowerCase().endsWith(".stl");
  const url = `/api/files/${fileId}/preview`;

  return (
    <div className="w-full h-full" data-testid="viewer-3d">
      <Canvas camera={{ position: [8, 6, 8], fov: 45 }} style={{ background: "transparent" }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        <directionalLight position={[-5, -5, -5]} intensity={0.3} />
        <Suspense fallback={null}>
          {isSTL ? (
            <STLViewer url={url} />
          ) : (
            <mesh>
              <boxGeometry args={[2, 2, 2]} />
              <meshStandardMaterial color="#6d9eeb" />
            </mesh>
          )}
        </Suspense>
        <OrbitControls enableDamping dampingFactor={0.1} />
        <Grid args={[20, 20]} cellColor="#ffffff20" sectionColor="#ffffff10" fadeDistance={25} />
      </Canvas>
    </div>
  );
}

interface StudioChatMessage {
  role: "user" | "assistant";
  content: string;
}

function useStudioFileChat(fileId: number | null, fileName: string | null, mimeType: string | null) {
  const [fileConvMap, setFileConvMap] = useState<Record<number, number>>({});
  const [messages, setMessages] = useState<Record<number, StudioChatMessage[]>>({});
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");

  const currentMessages = useMemo(() => {
    if (!fileId) return [];
    return messages[fileId] || [];
  }, [fileId, messages]);

  useEffect(() => {
    setInput("");
  }, [fileId]);

  const sendMessage = useCallback(async (text: string, options?: { imageDataUrl?: string }) => {
    if (!fileId || !text.trim() || isStreaming) return;
    
    setInput("");
    setIsStreaming(true);
    setStreamingContent("");

    setMessages(prev => ({
      ...prev,
      [fileId]: [...(prev[fileId] || []), { role: "user", content: text }]
    }));

    let convId = fileConvMap[fileId];
    if (!convId) {
      try {
        const res = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: `Studio: ${fileName || `File #${fileId}`}` }),
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to create conversation");
        const conv = await res.json();
        convId = conv.id;
        setFileConvMap(prev => ({ ...prev, [fileId]: convId }));
      } catch {
        setIsStreaming(false);
        setMessages(prev => ({
          ...prev,
          [fileId]: [...(prev[fileId] || []), { role: "assistant", content: "⚠️ Erreur de création de conversation." }]
        }));
        return;
      }
    }

    let fullResponse = "";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);
    const capturedFileId = fileId;

    try {
      const res = await fetch(`/api/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, imageDataUrl: options?.imageDataUrl }),
        signal: controller.signal,
        credentials: "include",
      });

      clearTimeout(timeoutId);
      if (!res.ok) throw new Error("Erreur de communication");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                fullResponse += data.content;
                setStreamingContent(fullResponse);
              }
            } catch {}
          }
        }
      }

      if (fullResponse) {
        setMessages(prev => ({
          ...prev,
          [capturedFileId]: [...(prev[capturedFileId] || []), { role: "assistant", content: fullResponse }]
        }));
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      const errorMsg = err.name === "AbortError"
        ? "Ulysse met trop de temps à répondre."
        : err.message || "Erreur de communication";
      setMessages(prev => ({
        ...prev,
        [capturedFileId]: [...(prev[capturedFileId] || []), { role: "assistant", content: `⚠️ ${errorMsg}` }]
      }));
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
    }
  }, [fileId, fileName, isStreaming, fileConvMap]);

  return { messages: currentMessages, input, setInput, isStreaming, streamingContent, sendMessage };
}

export function StudioPanel({ isOpen, onClose, initialFileId }: StudioPanelProps) {
  const { toast } = useToast();
  const [selectedFileId, setSelectedFileId] = useState<number | null>(initialFileId || null);
  const [filterType, setFilterType] = useState<MediaType>("all");
  const [editPrompt, setEditPrompt] = useState("");
  const [showVersions, setShowVersions] = useState(false);
  const [editingLabel, setEditingLabel] = useState<number | null>(null);
  const [labelInput, setLabelInput] = useState("");
  const [zoom, setZoom] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [showChat, setShowChat] = useState(true);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const { data: files, isLoading } = useQuery<UlysseFile[]>({
    queryKey: ["/api/files"],
    enabled: isOpen,
  });

  const { data: versions } = useQuery<UlysseFile[]>({
    queryKey: ["/api/files", selectedFileId, "versions"],
    queryFn: async () => {
      if (!selectedFileId) return [];
      const res = await fetch(`/api/files/${selectedFileId}/versions`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedFileId && showVersions,
  });

  const filteredFiles = useMemo(() => {
    if (!files) return [];
    let result = files.filter(f => !f.parentFileId);
    if (filterType !== "all") {
      result = result.filter(f => getMediaType(f.mimeType, f.originalName) === filterType);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(f =>
        f.originalName.toLowerCase().includes(q) ||
        f.description?.toLowerCase().includes(q)
      );
    }
    return result.sort((a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
  }, [files, filterType, searchQuery]);

  const selectedFile = useMemo(() => {
    if (!selectedFileId || !files) return null;
    return files.find(f => f.id === selectedFileId) || null;
  }, [selectedFileId, files]);

  const studioChat = useStudioFileChat(
    selectedFileId,
    selectedFile?.originalName || null,
    selectedFile?.mimeType || null
  );

  const editMutation = useMutation({
    mutationFn: async ({ fileId, prompt }: { fileId: number; prompt: string }) => {
      const res = await apiRequest("POST", `/api/files/${fileId}/edit`, { prompt });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Edit failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
      if (data.file?.id) {
        setSelectedFileId(data.file.id);
      }
      setEditPrompt("");
      toast({ title: `Version ${data.version} créée` });
    },
    onError: (err: any) => {
      toast({
        title: "Erreur d'édition",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const labelMutation = useMutation({
    mutationFn: async ({ id, label }: { id: number; label: string }) => {
      await apiRequest("PATCH", `/api/files/${id}/label`, { label });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/files"] });
      setEditingLabel(null);
      toast({ title: "Label mis à jour" });
    },
  });

  const handleEdit = useCallback(() => {
    if (!editPrompt.trim() || !selectedFileId) return;
    editMutation.mutate({ fileId: selectedFileId, prompt: editPrompt.trim() });
  }, [editPrompt, selectedFileId, editMutation]);

  const handleDownload = useCallback(async () => {
    if (!selectedFileId) return;
    window.open(`/api/files/${selectedFileId}/download`, "_blank");
  }, [selectedFileId]);

  const handleStudioChat = useCallback(async () => {
    if (!studioChat.input.trim() || !selectedFile) return;
    const userMsg = studioChat.input.trim();
    const fileContext = `[Studio – fichier: ${selectedFile.originalName} (ID: ${selectedFile.id}, type: ${selectedFile.mimeType})]`;
    const fullContent = `${fileContext}\n${userMsg}`;

    if (selectedFile.mimeType.startsWith("image/")) {
      try {
        const imgRes = await fetch(`/api/files/${selectedFile.id}/preview`, { credentials: "include" });
        const blob = await imgRes.blob();
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        studioChat.sendMessage(fullContent, { imageDataUrl: dataUrl });
      } catch {
        studioChat.sendMessage(fullContent);
      }
    } else {
      studioChat.sendMessage(fullContent);
    }
  }, [studioChat, selectedFile]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [studioChat.messages, studioChat.streamingContent]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedFileId(initialFileId || null);
      setZoom(1);
      setEditPrompt("");
      setShowChat(true);
    }
  }, [isOpen, initialFileId]);

  const isImage = selectedFile?.mimeType.startsWith("image/");
  const isVideo = selectedFile?.mimeType.startsWith("video/");
  const isAudio = selectedFile?.mimeType.startsWith("audio/");
  const isPdf = selectedFile?.mimeType === "application/pdf";
  const is3D = selectedFile ? is3DFile(selectedFile.originalName, selectedFile.mimeType) : false;
  const canEdit = isImage;

  const [analysis3D, setAnalysis3D] = useState<Analysis3D | null>(null);
  const [loading3DAnalysis, setLoading3DAnalysis] = useState(false);

  const analyze3DFile = useCallback(async () => {
    if (!selectedFileId) return;
    setLoading3DAnalysis(true);
    try {
      const res = await fetch(`/api/files/3d/${selectedFileId}/analyze`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setAnalysis3D(data);
      }
    } catch (e) {
      console.error("3D analysis error:", e);
    } finally {
      setLoading3DAnalysis(false);
    }
  }, [selectedFileId]);

  useEffect(() => {
    if (is3D && selectedFileId) {
      analyze3DFile();
    } else {
      setAnalysis3D(null);
    }
  }, [is3D, selectedFileId]);

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm"
      data-testid="studio-panel"
    >
      <div className="h-full flex flex-col">
        <header className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-black/60">
          <div className="flex items-center gap-3">
            <Wand2 className="h-5 w-5 text-purple-400" />
            <h2 className="text-lg font-semibold text-white">Studio</h2>
            {selectedFile && (
              <Badge variant="outline" className="text-xs text-white/70 border-white/20">
                {selectedFile.originalName}
                {(selectedFile as any).version > 1 && ` (v${(selectedFile as any).version})`}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedFile && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-white/70 hover:text-white"
                  onClick={() => setShowVersions(!showVersions)}
                  data-testid="button-toggle-versions"
                >
                  <History className="h-4 w-4 mr-1" />
                  Versions
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-white/70 hover:text-white"
                  onClick={handleDownload}
                  data-testid="button-studio-download"
                >
                  <Download className="h-4 w-4 mr-1" />
                  Télécharger
                </Button>
              </>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="text-white/70 hover:text-white"
              onClick={onClose}
              data-testid="button-close-studio"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          <aside className="w-72 border-r border-white/10 bg-black/40 flex flex-col">
            <div className="p-3 space-y-2 border-b border-white/10">
              <Input
                placeholder="Rechercher..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 bg-white/5 border-white/10 text-white text-sm"
                data-testid="input-studio-search"
              />
              <div className="flex gap-1 flex-wrap">
                {(["all", "image", "video", "document", "audio", "3d"] as MediaType[]).map(type => (
                  <button
                    key={type}
                    onClick={() => setFilterType(type)}
                    className={`px-2 py-1 rounded text-xs transition-colors ${
                      filterType === type
                        ? "bg-purple-500/30 text-purple-300 border border-purple-500/50"
                        : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/70 border border-transparent"
                    }`}
                    data-testid={`button-filter-${type}`}
                  >
                    {type === "all" ? "Tous" :
                     type === "image" ? "Images" :
                     type === "video" ? "Vidéos" :
                     type === "audio" ? "Audio" :
                     type === "3d" ? "3D" : "Docs"}
                  </button>
                ))}
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-white/40" />
                  </div>
                ) : filteredFiles.length === 0 ? (
                  <p className="text-center text-white/30 text-sm py-8">
                    Aucun fichier
                  </p>
                ) : (
                  filteredFiles.map(file => {
                    const Icon = getFileIcon(file.mimeType, file.originalName);
                    const isSelected = selectedFileId === file.id;
                    const mediaType = getMediaType(file.mimeType, file.originalName);
                    return (
                      <button
                        key={file.id}
                        onClick={() => {
                          setSelectedFileId(file.id);
                          setZoom(1);
                          setShowVersions(false);
                        }}
                        className={`w-full flex items-center gap-2 p-2 rounded-lg text-left transition-all ${
                          isSelected
                            ? "bg-purple-500/20 border border-purple-500/40"
                            : "hover:bg-white/5 border border-transparent"
                        }`}
                        data-testid={`button-file-${file.id}`}
                      >
                        {file.mimeType.startsWith("image/") ? (
                          <div className="w-10 h-10 rounded bg-white/5 overflow-hidden flex-shrink-0">
                            <img
                              src={`/api/files/${file.id}/preview`}
                              alt={file.originalName}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          </div>
                        ) : (
                          <div className={`w-10 h-10 rounded flex items-center justify-center flex-shrink-0 ${getTypeBadge(mediaType)}/20`}>
                            <Icon className="h-5 w-5 text-white/60" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white/90 truncate">{file.originalName}</p>
                          <p className="text-xs text-white/40">
                            {file.createdAt && formatDistanceToNow(new Date(file.createdAt), { addSuffix: true, locale: fr })}
                          </p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </ScrollArea>

            <div className="p-3 border-t border-white/10">
              <p className="text-xs text-white/30 text-center">
                {filteredFiles.length} fichier{filteredFiles.length !== 1 ? "s" : ""}
              </p>
            </div>
          </aside>

          <main className="flex-1 flex flex-col">
            {!selectedFile ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center space-y-3">
                  <Layers className="h-16 w-16 text-white/10 mx-auto" />
                  <p className="text-white/30 text-lg">Sélectionnez un fichier pour commencer</p>
                  <p className="text-white/20 text-sm">Choisissez un fichier dans la liste pour le prévisualiser et l'éditer</p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex-1 flex overflow-hidden">
                  <div ref={previewRef} className="flex-1 flex items-center justify-center p-4 overflow-auto bg-black/20 relative">
                    {isImage && (
                      <>
                        <img
                          src={`/api/files/${selectedFile.id}/preview`}
                          alt={selectedFile.originalName}
                          className="max-h-full max-w-full object-contain rounded-lg shadow-2xl transition-transform"
                          style={{ transform: `scale(${zoom})` }}
                          data-testid="img-studio-preview"
                        />
                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/60 rounded-full px-3 py-1.5">
                          <button onClick={() => setZoom(z => Math.max(0.25, z - 0.25))} className="text-white/60 hover:text-white" data-testid="button-zoom-out">
                            <ZoomOut className="h-4 w-4" />
                          </button>
                          <span className="text-xs text-white/60 w-12 text-center">{Math.round(zoom * 100)}%</span>
                          <button onClick={() => setZoom(z => Math.min(4, z + 0.25))} className="text-white/60 hover:text-white" data-testid="button-zoom-in">
                            <ZoomIn className="h-4 w-4" />
                          </button>
                          <button onClick={() => setZoom(1)} className="text-white/60 hover:text-white" data-testid="button-zoom-reset">
                            <RotateCcw className="h-3 w-3" />
                          </button>
                        </div>
                      </>
                    )}
                    {isVideo && (
                      <video
                        src={`/api/files/${selectedFile.id}/preview`}
                        controls
                        className="max-h-full max-w-full rounded-lg shadow-2xl"
                        data-testid="video-studio-preview"
                      />
                    )}
                    {isAudio && (
                      <div className="text-center space-y-4">
                        <Music className="h-20 w-20 text-green-400/40 mx-auto" />
                        <audio
                          src={`/api/files/${selectedFile.id}/preview`}
                          controls
                          className="w-full max-w-md"
                          data-testid="audio-studio-preview"
                        />
                        <p className="text-white/50 text-sm">{selectedFile.originalName}</p>
                      </div>
                    )}
                    {isPdf && (
                      <iframe
                        src={`/api/files/${selectedFile.id}/preview`}
                        className="w-full h-full rounded-lg border border-white/10"
                        title={selectedFile.originalName}
                        data-testid="pdf-studio-preview"
                      />
                    )}
                    {is3D && (
                      <div className="w-full h-full flex">
                        <div className="flex-1 relative">
                          <ThreeDViewer fileId={selectedFile.id} fileName={selectedFile.originalName} />
                          <div className="absolute top-3 left-3 flex items-center gap-2">
                            <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-500/40 text-xs">
                              <Box className="h-3 w-3 mr-1" />
                              {selectedFile.originalName.split(".").pop()?.toUpperCase()}
                            </Badge>
                          </div>
                          <div className="absolute bottom-3 left-3 text-[10px] text-white/30">
                            Cliquer + glisser pour tourner · Molette pour zoomer
                          </div>
                        </div>
                        {analysis3D && (
                          <div className="w-56 border-l border-white/10 bg-black/50 p-3 space-y-3 overflow-y-auto" data-testid="panel-3d-info">
                            <h4 className="text-xs font-medium text-white/70 flex items-center gap-1.5">
                              <Ruler className="h-3.5 w-3.5 text-cyan-400" />
                              Analyse 3D
                            </h4>
                            <div className="space-y-2">
                              <div className="bg-white/5 rounded-lg p-2">
                                <p className="text-[10px] text-white/40 mb-1">Dimensions</p>
                                <p className="text-xs text-white/80">
                                  {analysis3D.dimensions.width.toFixed(1)} × {analysis3D.dimensions.height.toFixed(1)} × {analysis3D.dimensions.depth.toFixed(1)} mm
                                </p>
                              </div>
                              <div className="bg-white/5 rounded-lg p-2">
                                <p className="text-[10px] text-white/40 mb-1">Géométrie</p>
                                <p className="text-xs text-white/80">{analysis3D.triangleCount.toLocaleString()} triangles</p>
                                <p className="text-xs text-white/60">{analysis3D.vertexCount.toLocaleString()} sommets</p>
                              </div>
                              {analysis3D.volume != null && (
                                <div className="bg-white/5 rounded-lg p-2">
                                  <p className="text-[10px] text-white/40 mb-1">Volume</p>
                                  <p className="text-xs text-white/80">{analysis3D.volume.toFixed(2)} mm³</p>
                                </div>
                              )}
                              {analysis3D.surfaceArea != null && (
                                <div className="bg-white/5 rounded-lg p-2">
                                  <p className="text-[10px] text-white/40 mb-1">Surface</p>
                                  <p className="text-xs text-white/80">{analysis3D.surfaceArea.toFixed(2)} mm²</p>
                                </div>
                              )}
                              {analysis3D.isClosed != null && (
                                <div className="bg-white/5 rounded-lg p-2">
                                  <p className="text-[10px] text-white/40 mb-1">Maillage</p>
                                  <p className={`text-xs ${analysis3D.isClosed ? "text-green-400" : "text-yellow-400"}`}>
                                    {analysis3D.isClosed ? "✓ Fermé (imprimable)" : "⚠ Ouvert"}
                                  </p>
                                </div>
                              )}
                            </div>
                            <div className="space-y-1.5 pt-2 border-t border-white/10">
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full text-xs border-white/10 text-white/70 h-7"
                                onClick={handleDownload}
                                data-testid="button-3d-download"
                              >
                                <Download className="h-3 w-3 mr-1.5" />
                                Télécharger
                              </Button>
                            </div>
                          </div>
                        )}
                        {loading3DAnalysis && !analysis3D && (
                          <div className="w-56 border-l border-white/10 bg-black/50 flex items-center justify-center">
                            <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
                          </div>
                        )}
                      </div>
                    )}
                    {!isImage && !isVideo && !isAudio && !isPdf && !is3D && (
                      <div className="text-center space-y-4">
                        <FileText className="h-20 w-20 text-orange-400/40 mx-auto" />
                        <p className="text-white/60">{selectedFile.originalName}</p>
                        <p className="text-white/30 text-sm">{selectedFile.description}</p>
                        <Button
                          variant="outline"
                          className="border-white/20 text-white/70"
                          onClick={handleDownload}
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Télécharger pour visualiser
                        </Button>
                      </div>
                    )}
                  </div>

                  <AnimatePresence>
                    {showVersions && versions && versions.length > 0 && (
                      <motion.div
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 240, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        className="border-l border-white/10 bg-black/40 overflow-hidden"
                      >
                        <div className="p-3 border-b border-white/10">
                          <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
                            <Clock className="h-4 w-4" />
                            Historique ({versions.length})
                          </h3>
                        </div>
                        <ScrollArea className="h-full">
                          <div className="p-2 space-y-1">
                            {versions.map((v, i) => (
                              <button
                                key={v.id}
                                onClick={() => setSelectedFileId(v.id)}
                                className={`w-full p-2 rounded text-left transition-colors ${
                                  selectedFileId === v.id
                                    ? "bg-purple-500/20 border border-purple-500/40"
                                    : "hover:bg-white/5 border border-transparent"
                                }`}
                                data-testid={`button-version-${v.id}`}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-medium text-white/80">
                                    V{(v as any).version || i + 1}
                                  </span>
                                  {(v as any).versionLabel && (
                                    <Badge variant="outline" className="text-[10px] text-white/50 border-white/20">
                                      {(v as any).versionLabel}
                                    </Badge>
                                  )}
                                </div>
                                {v.mimeType.startsWith("image/") && (
                                  <img
                                    src={`/api/files/${v.id}/preview`}
                                    alt={`V${(v as any).version}`}
                                    className="w-full h-24 object-cover rounded mt-1"
                                    loading="lazy"
                                  />
                                )}
                                <p className="text-[10px] text-white/30 mt-1 truncate">
                                  {(v as any).editPrompt || v.description || "Original"}
                                </p>
                                <p className="text-[10px] text-white/20">
                                  {v.createdAt && formatDistanceToNow(new Date(v.createdAt), { addSuffix: true, locale: fr })}
                                </p>
                                {editingLabel === v.id ? (
                                  <div className="flex gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
                                    <Input
                                      value={labelInput}
                                      onChange={(e) => setLabelInput(e.target.value)}
                                      placeholder="Label..."
                                      className="h-6 text-[10px] bg-white/5 border-white/10 text-white"
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          labelMutation.mutate({ id: v.id, label: labelInput });
                                        }
                                        if (e.key === "Escape") setEditingLabel(null);
                                      }}
                                      autoFocus
                                    />
                                  </div>
                                ) : (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingLabel(v.id);
                                      setLabelInput((v as any).versionLabel || "");
                                    }}
                                    className="text-[10px] text-purple-400/50 hover:text-purple-400 mt-1 flex items-center gap-1"
                                  >
                                    <Tag className="h-3 w-3" />
                                    {(v as any).versionLabel ? "Renommer" : "Ajouter label"}
                                  </button>
                                )}
                              </button>
                            ))}
                          </div>
                        </ScrollArea>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {selectedFile && (
                  <div className="border-t border-white/10 bg-black/60">
                    {canEdit && !showChat && (
                      <div className="p-3">
                        <div className="flex items-end gap-2 max-w-3xl mx-auto">
                          <div className="flex-1">
                            <p className="text-xs text-white/30 mb-1 flex items-center gap-1">
                              <Sparkles className="h-3 w-3 text-purple-400" />
                              Modifier cette image
                            </p>
                            <Textarea
                              ref={chatInputRef}
                              value={editPrompt}
                              onChange={(e) => {
                                setEditPrompt(e.target.value);
                                const el = e.target;
                                el.style.height = "0px";
                                el.style.height = Math.min(el.scrollHeight, 100) + "px";
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  handleEdit();
                                }
                              }}
                              placeholder="Ex: Change le fond en bleu, ajoute du texte..."
                              className="min-h-[40px] max-h-[100px] bg-white/5 border-white/10 text-white text-sm rounded-xl resize-none"
                              disabled={editMutation.isPending}
                              rows={1}
                              data-testid="input-studio-edit"
                            />
                          </div>
                          <Button
                            onClick={handleEdit}
                            disabled={!editPrompt.trim() || editMutation.isPending}
                            className="bg-purple-500 hover:bg-purple-600 text-white rounded-xl h-10 px-4"
                            data-testid="button-studio-send"
                          >
                            {editMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Send className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                        {editMutation.isPending && (
                          <div className="mt-2 flex items-center gap-2 justify-center">
                            <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
                            <p className="text-xs text-purple-300">Ulysse édite votre image...</p>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="px-3 py-2">
                      <button
                        onClick={() => setShowChat(!showChat)}
                        className="flex items-center gap-2 text-xs text-white/40 hover:text-white/70 transition-colors w-full justify-center"
                        data-testid="button-toggle-studio-chat"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        {showChat ? "Masquer le chat" : "Discuter avec Ulysse à propos de ce fichier"}
                      </button>
                    </div>

                    <AnimatePresence>
                      {showChat && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          {studioChat.messages.length > 0 && (
                            <div
                              ref={chatScrollRef}
                              className="max-h-[200px] overflow-y-auto px-3 space-y-2 border-t border-white/5 pt-2"
                              data-testid="studio-chat-history"
                            >
                              {studioChat.messages.slice(-10).map((msg, i) => (
                                <div
                                  key={i}
                                  className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                                >
                                  {msg.role === "assistant" && (
                                    <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                                      <Bot className="h-3.5 w-3.5 text-purple-400" />
                                    </div>
                                  )}
                                  <div
                                    className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                                      msg.role === "user"
                                        ? "bg-purple-500/20 text-white/90"
                                        : "bg-white/5 text-white/80"
                                    }`}
                                    data-testid={`studio-chat-msg-${msg.role}-${i}`}
                                  >
                                    <ReactMarkdown
                                      components={{
                                        p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                                        strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
                                        ul: ({ children }) => <ul className="list-disc pl-4 mb-1">{children}</ul>,
                                        ol: ({ children }) => <ol className="list-decimal pl-4 mb-1">{children}</ol>,
                                        li: ({ children }) => <li className="mb-0.5">{children}</li>,
                                        code: ({ children }) => <code className="bg-white/10 px-1 rounded text-xs">{children}</code>,
                                      }}
                                    >
                                      {msg.role === "user" ? msg.content.replace(/^\[Studio[^\]]*\]\n?/, "") : msg.content}
                                    </ReactMarkdown>
                                  </div>
                                  {msg.role === "user" && (
                                    <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                                      <User className="h-3.5 w-3.5 text-blue-400" />
                                    </div>
                                  )}
                                </div>
                              ))}
                              {studioChat.isStreaming && studioChat.streamingContent && (
                                <div className="flex gap-2 justify-start">
                                  <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                                    <Bot className="h-3.5 w-3.5 text-purple-400" />
                                  </div>
                                  <div className="max-w-[80%] bg-white/5 rounded-xl px-3 py-2 text-sm text-white/80">
                                    <ReactMarkdown>{studioChat.streamingContent}</ReactMarkdown>
                                  </div>
                                </div>
                              )}
                              {studioChat.isStreaming && !studioChat.streamingContent && (
                                <div className="flex gap-2 justify-start">
                                  <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                                    <Loader2 className="h-3.5 w-3.5 text-purple-400 animate-spin" />
                                  </div>
                                  <div className="bg-white/5 rounded-xl px-3 py-2 text-sm text-white/50">
                                    Ulysse réfléchit...
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          <div className="p-3 flex items-end gap-2">
                            <Textarea
                              value={studioChat.input}
                              onChange={(e) => {
                                studioChat.setInput(e.target.value);
                                const el = e.target;
                                el.style.height = "0px";
                                el.style.height = Math.min(el.scrollHeight, 80) + "px";
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  handleStudioChat();
                                }
                              }}
                              placeholder={`Posez une question sur ${selectedFile.originalName}...`}
                              className="min-h-[36px] max-h-[80px] bg-white/5 border-white/10 text-white text-sm rounded-xl resize-none flex-1"
                              disabled={studioChat.isStreaming}
                              rows={1}
                              data-testid="input-studio-chat"
                            />
                            <Button
                              onClick={handleStudioChat}
                              disabled={!studioChat.input.trim() || studioChat.isStreaming}
                              size="sm"
                              className="bg-purple-500 hover:bg-purple-600 text-white rounded-xl h-9 px-3"
                              data-testid="button-studio-chat-send"
                            >
                              {studioChat.isStreaming ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Send className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      </div>
    </motion.div>
  );
}
