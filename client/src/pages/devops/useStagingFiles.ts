import { useState, useRef, useCallback } from "react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Repo, FileData } from "./types";
import { getErrMsg } from "./types";

export function useStagingFiles(selectedRepo: Repo | null) {
  const { toast } = useToast();

  const [stagingFile, setStagingFile] = useState<{
    path: string;
    content: string;
    isImage?: boolean;
    rawBase64?: string;
    sha?: string;
  } | null>(null);
  const [stagingPath, setStagingPath] = useState<string>("");
  const [stagingSearch, setStagingSearch] = useState("");
  const [stagingFileLoading, setStagingFileLoading] = useState(false);
  const [stagingEditMode, setStagingEditMode] = useState(false);
  const [stagingEditContent, setStagingEditContent] = useState("");
  const [stagingEditMsg, setStagingEditMsg] = useState("");
  const [stagingSaving, setStagingSaving] = useState(false);
  const [stagingModified, setStagingModified] = useState(false);
  const [stagingDeploying, setStagingDeploying] = useState(false);
  const [stagingDeployStatus, setStagingDeployStatus] = useState<string | null>(null);
  const stagingOriginalRef = useRef<string>("");
  const stagingEditRef = useRef<HTMLTextAreaElement>(null);
  const stagingContentCache = useRef<Map<string, { content: string; sha?: string; isImage?: boolean; rawBase64?: string }>>(new Map());

  const loadStagingFile = useCallback(
    async (filePath: string) => {
      if (!selectedRepo) return;
      const cacheKey = `staging:${selectedRepo.full_name}:${filePath}`;
      const cached = stagingContentCache.current.get(cacheKey);
      if (cached) {
        setStagingFile({ path: filePath, ...cached });
        return;
      }
      setStagingFileLoading(true);
      try {
        const res = await fetch(
          `/api/devops/repos/${selectedRepo.full_name}/contents/${filePath}?ref=staging`,
          { credentials: "include" },
        );
        const data = await res.json();
        if (data.content) {
          const ext = filePath.split(".").pop()?.toLowerCase() || "";
          const imageExts = ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"];
          const binaryExts = [...imageExts, "pdf", "zip", "tar", "gz", "woff", "woff2", "ttf", "eot", "mp3", "mp4", "wav", "ogg"];
          let fileData: FileData;
          if (imageExts.includes(ext)) {
            const mimeType = ext === "svg" ? "image/svg+xml" : ext === "ico" ? "image/x-icon" : `image/${ext === "jpg" ? "jpeg" : ext}`;
            fileData = { content: "", isImage: true, rawBase64: `data:${mimeType};base64,${data.content}`, sha: data.sha };
          } else if (binaryExts.includes(ext)) {
            fileData = { content: `[Fichier binaire — ${ext.toUpperCase()}]`, sha: data.sha };
          } else {
            try {
              const raw = atob(data.content.replace(/\n/g, ""));
              const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
              const decoded = new TextDecoder("utf-8").decode(bytes);
              fileData = { content: decoded, sha: data.sha };
            } catch {
              fileData = { content: atob(data.content.replace(/\n/g, "")), sha: data.sha };
            }
          }
          stagingContentCache.current.set(cacheKey, fileData);
          setStagingFile({ path: filePath, ...fileData });
        }
      } catch {
        toast({ title: "Erreur", description: "Impossible de charger le fichier staging", variant: "destructive" });
      }
      setStagingFileLoading(false);
    },
    [selectedRepo, toast],
  );

  const saveStagingFile = useCallback(async () => {
    if (!selectedRepo || !stagingFile) return;
    setStagingSaving(true);
    try {
      const encoded = btoa(unescape(encodeURIComponent(stagingEditContent)));
      await apiRequest(
        "PUT",
        `/api/devops/repos/${selectedRepo.full_name}/contents/${stagingFile.path}`,
        {
          content: encoded,
          message: stagingEditMsg || `[staging] Edit ${stagingFile.path.split("/").pop()}`,
          branch: "staging",
          sha: stagingFile.sha || undefined,
          isBase64: true,
        },
      );
      stagingContentCache.current.delete(`staging:${selectedRepo.full_name}:${stagingFile.path}`);
      toast({ title: "Sauvegardé sur staging", description: stagingEditMsg || stagingFile.path });
      setStagingEditMode(false);
      setStagingEditMsg("");
      setStagingModified(false);
      loadStagingFile(stagingFile.path);
      queryClient.invalidateQueries({ queryKey: ["/api/devops/repos", selectedRepo.full_name, "tree-staging"] });
      queryClient.invalidateQueries({ queryKey: ["/api/devops/repos", selectedRepo.full_name, "commits"] });
    } catch (err: unknown) {
      toast({ title: "Erreur", description: getErrMsg(err) || "Impossible de sauvegarder", variant: "destructive" });
    }
    setStagingSaving(false);
  }, [selectedRepo, stagingFile, stagingEditContent, stagingEditMsg, toast, loadStagingFile]);

  const deployStagingToProd = useCallback(async () => {
    if (!selectedRepo) return;
    setStagingDeploying(true);
    setStagingDeployStatus("Vérification du statut staging...");
    try {
      const commitsRes = await fetch(
        `/api/devops/repos/${selectedRepo.full_name}/commits?branch=staging&per_page=1`,
        { credentials: "include" },
      );
      const commitsData = await commitsRes.json();
      if (!commitsData?.length) {
        toast({ title: "Erreur", description: "Aucun commit sur la branche staging", variant: "destructive" });
        setStagingDeploying(false);
        setStagingDeployStatus(null);
        return;
      }

      const lastCommitSha = commitsData[0].sha;
      setStagingDeployStatus("Vérification des checks CI/CD...");

      const statusRes = await fetch(
        `/api/devops/repos/${selectedRepo.full_name}/commits/${lastCommitSha}/status`,
        { credentials: "include" },
      );

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        if (statusData.state === "failure" || statusData.state === "error") {
          toast({
            title: "Déploiement bloqué",
            description: "Les checks CI/CD sur staging ont échoué. Corrigez avant de déployer.",
            variant: "destructive",
          });
          setStagingDeploying(false);
          setStagingDeployStatus(null);
          return;
        }
        if (statusData.state === "pending") {
          toast({
            title: "Déploiement en attente",
            description: "Des checks CI/CD sont encore en cours sur staging. Réessayez dans quelques minutes.",
            variant: "destructive",
          });
          setStagingDeploying(false);
          setStagingDeployStatus(null);
          return;
        }
      }

      setStagingDeployStatus("Comparaison staging ↔ prod...");

      const compareRes = await fetch(
        `/api/devops/repos/${selectedRepo.full_name}/compare/${selectedRepo.default_branch}...staging`,
        { credentials: "include" },
      );

      if (compareRes.ok) {
        const compareData = await compareRes.json();
        if (compareData.status === "identical" || compareData.ahead_by === 0) {
          toast({ title: "Info", description: "Staging est déjà à jour avec la prod (rien à déployer)." });
          setStagingDeploying(false);
          setStagingDeployStatus(null);
          return;
        }
      }

      setStagingDeployStatus("Création de la PR staging → prod...");

      let prNumber: number | null = null;
      try {
        const prRes = await apiRequest(
          "POST",
          `/api/devops/repos/${selectedRepo.full_name}/pulls`,
          {
            title: `[Deploy] Staging → Production (${new Date().toLocaleDateString("fr-FR")})`,
            body: `Déploiement automatique depuis staging.\n\nDernier commit: ${lastCommitSha.slice(0, 7)}\nDate: ${new Date().toLocaleString("fr-FR")}`,
            head: "staging",
            base: selectedRepo.default_branch,
          },
        );
        const prData = await prRes.json();
        prNumber = prData.number;
      } catch (prErr: unknown) {
        const errMsg = getErrMsg(prErr);
        if (errMsg.includes("422") || errMsg.toLowerCase().includes("no commits") || errMsg.toLowerCase().includes("already")) {
          toast({ title: "Info", description: "Staging est déjà à jour avec la prod (rien à merger)." });
          setStagingDeploying(false);
          setStagingDeployStatus(null);
          return;
        }
        throw prErr;
      }

      if (!prNumber) {
        toast({ title: "Info", description: "Staging est déjà à jour avec la prod (rien à merger)." });
        setStagingDeploying(false);
        setStagingDeployStatus(null);
        return;
      }

      setStagingDeployStatus(`Merge de la PR #${prNumber}...`);

      await apiRequest(
        "PUT",
        `/api/devops/repos/${selectedRepo.full_name}/pulls/${prNumber}/merge`,
        { merge_method: "merge" },
      );

      toast({
        title: "Déploiement réussi !",
        description: `PR #${prNumber} mergée : staging → ${selectedRepo.default_branch}`,
      });

      setStagingDeployStatus("Déploiement terminé !");
      queryClient.invalidateQueries({ queryKey: ["/api/devops/repos", selectedRepo.full_name, "tree"] });
      queryClient.invalidateQueries({ queryKey: ["/api/devops/repos", selectedRepo.full_name, "commits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/devops/repos", selectedRepo.full_name, "pulls"] });

      setTimeout(() => setStagingDeployStatus(null), 3000);
    } catch (err: unknown) {
      toast({
        title: "Erreur de déploiement",
        description: getErrMsg(err) || "Impossible de merger staging vers prod",
        variant: "destructive",
      });
      setStagingDeployStatus(null);
    }
    setStagingDeploying(false);
  }, [selectedRepo, toast]);

  const resetStagingState = useCallback(() => {
    setStagingFile(null);
    setStagingPath("");
    setStagingSearch("");
    setStagingEditMode(false);
    setStagingDeployStatus(null);
    stagingContentCache.current.clear();
  }, []);

  return {
    stagingFile, setStagingFile,
    stagingPath, setStagingPath,
    stagingSearch, setStagingSearch,
    stagingFileLoading,
    stagingEditMode, setStagingEditMode,
    stagingEditContent, setStagingEditContent,
    stagingEditMsg, setStagingEditMsg,
    stagingSaving,
    stagingModified, setStagingModified,
    stagingDeploying,
    stagingDeployStatus,
    stagingOriginalRef, stagingEditRef,
    stagingContentCache,
    loadStagingFile,
    saveStagingFile,
    deployStagingToProd,
    resetStagingState,
  };
}
