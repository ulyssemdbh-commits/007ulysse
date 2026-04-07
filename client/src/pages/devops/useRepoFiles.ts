import { useState, useRef, useCallback } from "react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Repo, FileData } from "./types";
import { getErrMsg } from "./types";

export function useRepoFiles(selectedRepo: Repo | null) {
  const { toast } = useToast();

  const [selectedFile, setSelectedFile] = useState<{
    path: string;
    content: string;
    isImage?: boolean;
    rawBase64?: string;
    sha?: string;
  } | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [currentPath, setCurrentPath] = useState<string>("");
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editCommitMsg, setEditCommitMsg] = useState("");
  const [savingFile, setSavingFile] = useState(false);
  const [deletingFile, setDeletingFile] = useState(false);
  const [showNewFileDialog, setShowNewFileDialog] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [newFileContent, setNewFileContent] = useState("");
  const [creatingFile, setCreatingFile] = useState(false);
  const [isFileModified, setIsFileModified] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const originalContentRef = useRef<string>("");
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const fileContentCache = useRef<
    Map<string, { content: string; sha?: string; isImage?: boolean; rawBase64?: string }>
  >(new Map());

  const loadFileContent = useCallback(
    async (filePath: string) => {
      if (!selectedRepo) return;

      const cacheKey = `${selectedRepo.full_name}:${filePath}`;
      const cached = fileContentCache.current.get(cacheKey);
      if (cached) {
        setSelectedFile({ path: filePath, ...cached });
        return;
      }

      setFileLoading(true);
      try {
        const res = await fetch(
          `/api/devops/repos/${selectedRepo.full_name}/contents/${filePath}`,
          { credentials: "include" },
        );
        const data = await res.json();
        if (data.content) {
          const ext = filePath.split(".").pop()?.toLowerCase() || "";
          const imageExts = [
            "png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp",
          ];
          const binaryExts = [
            "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp",
            "pdf", "zip", "tar", "gz", "woff", "woff2", "ttf", "eot",
            "mp3", "mp4", "wav", "ogg",
          ];

          let fileData: FileData;
          if (imageExts.includes(ext)) {
            const mimeType =
              ext === "svg"
                ? "image/svg+xml"
                : ext === "ico"
                  ? "image/x-icon"
                  : `image/${ext === "jpg" ? "jpeg" : ext}`;
            fileData = {
              content: "",
              isImage: true,
              rawBase64: `data:${mimeType};base64,${data.content}`,
              sha: data.sha,
            };
          } else if (binaryExts.includes(ext)) {
            fileData = {
              content: `[Fichier binaire — ${ext.toUpperCase()} — ${data.size ? `${(data.size / 1024).toFixed(1)}KB` : "taille inconnue"}]`,
              sha: data.sha,
            };
          } else {
            const raw = atob(data.content.replace(/\n/g, ""));
            const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
            const decoded = new TextDecoder("utf-8").decode(bytes);
            fileData = { content: decoded.slice(0, 10000), sha: data.sha };
          }
          fileContentCache.current.set(cacheKey, fileData);
          setSelectedFile({ path: filePath, ...fileData });
        }
      } catch {
        toast({
          title: "Erreur",
          description: "Impossible de lire le fichier",
          variant: "destructive",
        });
      }
      setFileLoading(false);
    },
    [selectedRepo, toast],
  );

  const handleFileUpload = useCallback(
    async (file: globalThis.File, targetPath: string, sha?: string) => {
      if (!selectedRepo) return;
      setUploadingFile(true);
      try {
        const reader = new FileReader();
        const base64Content = await new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const result = reader.result as string;
            const base64 = result.split(",")[1];
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        await apiRequest(
          "PUT",
          `/api/devops/repos/${selectedRepo.full_name}/contents/${targetPath}`,
          {
            content: base64Content,
            message: `Update ${targetPath.split("/").pop()}`,
            branch: selectedRepo.default_branch,
            sha: sha || undefined,
            isBase64: true,
          },
        );

        fileContentCache.current.delete(
          `${selectedRepo.full_name}:${targetPath}`,
        );
        toast({ title: "Fichier mis a jour", description: targetPath });
        loadFileContent(targetPath);
        queryClient.invalidateQueries({
          queryKey: ["/api/devops/repos", selectedRepo.full_name, "tree"],
        });
      } catch (err: unknown) {
        toast({
          title: "Erreur",
          description: getErrMsg(err) || "Impossible de mettre a jour le fichier",
          variant: "destructive",
        });
      }
      setUploadingFile(false);
    },
    [selectedRepo, toast, loadFileContent],
  );

  const handleNewFileUpload = useCallback(
    async (file: globalThis.File) => {
      if (!selectedRepo) return;
      const targetPath = currentPath
        ? `${currentPath}/${file.name}`
        : file.name;
      await handleFileUpload(file, targetPath);
    },
    [selectedRepo, currentPath, handleFileUpload],
  );

  const deleteCurrentFile = useCallback(async () => {
    if (!selectedRepo || !selectedFile) return;
    setDeletingFile(true);
    try {
      await apiRequest(
        "DELETE",
        `/api/devops/repos/${selectedRepo.full_name}/contents/${selectedFile.path}`,
        {
          message: `Delete ${selectedFile.path.split("/").pop()}`,
          branch: selectedRepo.default_branch,
        },
      );
      fileContentCache.current.delete(
        `${selectedRepo.full_name}:${selectedFile.path}`,
      );
      toast({ title: "Fichier supprime", description: selectedFile.path });
      setSelectedFile(null);
      setEditMode(false);
      queryClient.invalidateQueries({
        queryKey: ["/api/devops/repos", selectedRepo.full_name, "tree"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/devops/repos", selectedRepo.full_name, "commits"],
      });
    } catch (err: unknown) {
      toast({
        title: "Erreur",
        description: getErrMsg(err) || "Impossible de supprimer",
        variant: "destructive",
      });
    }
    setDeletingFile(false);
  }, [selectedRepo, selectedFile, toast]);

  const saveFileContent = useCallback(async () => {
    if (!selectedRepo || !selectedFile || !editContent) return;
    setSavingFile(true);
    try {
      const encoded = btoa(unescape(encodeURIComponent(editContent)));
      await apiRequest(
        "PUT",
        `/api/devops/repos/${selectedRepo.full_name}/contents/${selectedFile.path}`,
        {
          content: encoded,
          message:
            editCommitMsg || `Edit ${selectedFile.path.split("/").pop()}`,
          branch: selectedRepo.default_branch,
          sha: selectedFile.sha || undefined,
          isBase64: true,
        },
      );
      fileContentCache.current.delete(
        `${selectedRepo.full_name}:${selectedFile.path}`,
      );
      toast({
        title: "Sauvegarde",
        description:
          editCommitMsg || `Edit ${selectedFile.path.split("/").pop()}`,
      });
      setEditMode(false);
      setEditCommitMsg("");
      setIsFileModified(false);
      loadFileContent(selectedFile.path);
      queryClient.invalidateQueries({
        queryKey: ["/api/devops/repos", selectedRepo.full_name, "commits"],
      });
    } catch (err: unknown) {
      toast({
        title: "Erreur",
        description: getErrMsg(err) || "Impossible de sauvegarder",
        variant: "destructive",
      });
    }
    setSavingFile(false);
  }, [
    selectedRepo,
    selectedFile,
    editContent,
    editCommitMsg,
    toast,
    loadFileContent,
  ]);

  const createNewFile = useCallback(async () => {
    if (!selectedRepo || !newFileName.trim()) return;
    setCreatingFile(true);
    try {
      const filePath = currentPath ? `${currentPath}/${newFileName.trim()}` : newFileName.trim();
      const content = newFileContent || "";
      const encoded = btoa(unescape(encodeURIComponent(content)));
      await apiRequest(
        "PUT",
        `/api/devops/repos/${selectedRepo.full_name}/contents/${filePath}`,
        {
          content: encoded,
          message: `Create ${filePath}`,
          branch: selectedRepo.default_branch,
          isBase64: true,
        },
      );
      fileContentCache.current.delete(`${selectedRepo.full_name}:${filePath}`);
      toast({ title: "Fichier cree", description: filePath });
      setShowNewFileDialog(false);
      setNewFileName("");
      setNewFileContent("");
      queryClient.invalidateQueries({
        queryKey: ["/api/devops/repos", selectedRepo.full_name, "tree"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/devops/repos", selectedRepo.full_name, "commits"],
      });
      setTimeout(() => loadFileContent(filePath), 800);
    } catch (err: unknown) {
      toast({
        title: "Erreur",
        description: getErrMsg(err) || "Impossible de creer le fichier",
        variant: "destructive",
      });
    }
    setCreatingFile(false);
  }, [selectedRepo, newFileName, newFileContent, currentPath, toast, loadFileContent]);

  const getFileIcon = useCallback((fileName: string) => {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    const iconMap: Record<string, string> = {
      js: "text-yellow-500", jsx: "text-yellow-500", ts: "text-blue-500", tsx: "text-blue-500",
      html: "text-orange-500", css: "text-purple-500", scss: "text-pink-500",
      json: "text-green-500", md: "text-gray-400", py: "text-green-600",
      svg: "text-emerald-500", yml: "text-red-400", yaml: "text-red-400",
      sh: "text-gray-500", env: "text-yellow-600", sql: "text-cyan-500",
      php: "text-indigo-500", rb: "text-red-500", go: "text-cyan-600",
      rs: "text-orange-600", java: "text-red-600", xml: "text-orange-400",
    };
    return iconMap[ext] || "text-muted-foreground";
  }, []);

  const getSyntaxLang = useCallback((filePath: string) => {
    const ext = filePath.split(".").pop()?.toLowerCase() || "";
    const langMap: Record<string, string> = {
      js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
      html: "html", htm: "html", css: "css", scss: "css",
      json: "json", md: "markdown", py: "python", sh: "bash",
      sql: "sql", yml: "yaml", yaml: "yaml", xml: "xml",
      php: "php", rb: "ruby", go: "go", rs: "rust", java: "java",
    };
    return langMap[ext] || "text";
  }, []);

  const resetFileState = useCallback(() => {
    setCurrentPath("");
    setSelectedFile(null);
    setEditMode(false);
    setFileSearchQuery("");
    fileContentCache.current.clear();
  }, []);

  return {
    selectedFile, setSelectedFile,
    uploadingFile, fileLoading,
    currentPath, setCurrentPath,
    editMode, setEditMode,
    editContent, setEditContent,
    editCommitMsg, setEditCommitMsg,
    savingFile, deletingFile,
    showNewFileDialog, setShowNewFileDialog,
    newFileName, setNewFileName,
    newFileContent, setNewFileContent,
    creatingFile,
    isFileModified, setIsFileModified,
    fileSearchQuery, setFileSearchQuery,
    originalContentRef, editTextareaRef,
    fileContentCache,
    loadFileContent,
    handleFileUpload, handleNewFileUpload,
    deleteCurrentFile, saveFileContent,
    createNewFile,
    getFileIcon, getSyntaxLang,
    resetFileState,
  };
}
