import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTabListener } from "@/hooks/useAppNavigation";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { emitChatSync, getSharedConversationId } from "@/contexts/UlysseChatContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  GitBranch,
  GitPullRequest,
  GitCommit,
  FolderGit2,
  RefreshCw,
  Plus,
  ExternalLink,
  Star,
  Eye,
  GitFork,
  Search,
  Code,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  FileCode,
  ArrowLeft,
  Home,
  MessageSquare,
  Minimize2,
  Maximize2,
  Send,
  X,
  Bot,
  Play,
  RotateCcw,
  StopCircle,
  Folder,
  File,
  ChevronRight,
  Activity,
  Upload,
  Replace,
  FilePlus,
  Globe,
  RefreshCcw,
  Rocket,
  Save,
  Pencil,
  Terminal,
  ChevronDown,
  ChevronUp,
  Diff,
  Minus,
  PlusCircle,
  Server,
  Paperclip,
  ImageIcon,
  Trash2,
  AlertTriangle,
  Cpu,
  HardDrive,
  Wifi,
  WifiOff,
  RotateCw,
  Zap,
  Command,
  ArrowUpDown,
  Settings,
  ArrowRight,
  Lock,
  Shield,
  Palette,
  Crown,
  Smartphone,
  Monitor,
  TabletSmartphone,
  CheckCircle2,
  XOctagon,
  Signal,
  Layout,
  BookOpen,
  Camera,
  Gamepad2,
  Music,
  ShoppingBag,
  FlaskConical,
  Merge,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Repo, Branch, Commit, PullRequest, WorkflowRun, TreeItem, ChatMessage, ToolActivity, DeployedApp } from "./devops/types";
import { timeAgo, langColor, getRepoThreads, saveRepoThread, setActiveRepoThread, getActiveRepoThread, useDebounce, getLastVisitedRepo, setLastVisitedRepo, getLastActiveTab, setLastActiveTab } from "./devops/helpers";

const MarkdownContent = memo(function MarkdownContent({
  content,
}: {
  content: string;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const isInline = !className;
          if (isInline) {
            return (
              <code
                className="bg-primary/10 text-primary px-1 py-0.5 rounded text-[11px] font-mono"
                {...props}
              >
                {children}
              </code>
            );
          }
          return (
            <pre className="bg-zinc-950 text-zinc-300 rounded-md p-2 overflow-x-auto my-1.5 text-[11px]">
              <code className={className} {...props}>
                {children}
              </code>
            </pre>
          );
        },
        p({ children }) {
          return <p className="mb-1.5 last:mb-0">{children}</p>;
        },
        ul({ children }) {
          return (
            <ul className="list-disc list-inside mb-1.5 space-y-0.5">
              {children}
            </ul>
          );
        },
        ol({ children }) {
          return (
            <ol className="list-decimal list-inside mb-1.5 space-y-0.5">
              {children}
            </ol>
          );
        },
        li({ children }) {
          return <li className="text-sm">{children}</li>;
        },
        a({ href, children }) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {children}
            </a>
          );
        },
        h1({ children }) {
          return <h1 className="text-sm font-bold mb-1">{children}</h1>;
        },
        h2({ children }) {
          return <h2 className="text-sm font-bold mb-1">{children}</h2>;
        },
        h3({ children }) {
          return <h3 className="text-xs font-bold mb-1">{children}</h3>;
        },
        blockquote({ children }) {
          return (
            <blockquote className="border-l-2 border-primary/30 pl-2 italic text-muted-foreground">
              {children}
            </blockquote>
          );
        },
        table({ children }) {
          return (
            <table className="text-[11px] border-collapse w-full my-1">
              {children}
            </table>
          );
        },
        th({ children }) {
          return (
            <th className="border border-border px-1.5 py-0.5 bg-muted text-left">
              {children}
            </th>
          );
        },
        td({ children }) {
          return (
            <td className="border border-border px-1.5 py-0.5">{children}</td>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
});

function DevOpsChatBox({
  repoContext,
  availableRepos,
  onActionComplete,
  externalMessage,
  onExternalMessageConsumed,
  activeTab,
  previewUrl,
  previewHtml,
  dgmActive,
  dgmSessionId,
  dgmObjective,
  dgmRepoContext,
}: {
  repoContext?: string;
  availableRepos?: Repo[];
  onActionComplete?: () => void;
  externalMessage?: string | null;
  onExternalMessageConsumed?: () => void;
  activeTab?: string;
  previewUrl?: string;
  previewHtml?: string;
  dgmActive?: boolean;
  dgmSessionId?: number;
  dgmObjective?: string;
  dgmRepoContext?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState<number | null>(null);
  const [attachments, setAttachments] = useState<
    { name: string; type: string; dataUrl: string }[]
  >([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [streamError, setStreamError] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastRepoRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sendMessageRef = useRef<((msg: string) => void) | null>(null);

  const pendingExternalRef = useRef<string | null>(null);

  useEffect(() => {
    if (externalMessage && sendMessageRef.current) {
      setIsOpen(true);
      if (isLoading) {
        pendingExternalRef.current = externalMessage;
      } else {
        sendMessageRef.current(externalMessage);
      }
      onExternalMessageConsumed?.();
    }
  }, [externalMessage, onExternalMessageConsumed, isLoading]);

  useEffect(() => {
    if (!isLoading && pendingExternalRef.current && sendMessageRef.current) {
      const pending = pendingExternalRef.current;
      pendingExternalRef.current = null;
      sendMessageRef.current(pending);
    }
  }, [isLoading]);

  useEffect(() => {
    if (!repoContext) return;
    if (lastRepoRef.current === repoContext) return;
    lastRepoRef.current = repoContext;

    const savedThreadId = getActiveRepoThread(repoContext);
    if (savedThreadId) {
      setThreadId(savedThreadId);
      setMessages([]);
      setLoadingHistory(true);
      fetch(`/api/v2/conversations/${savedThreadId}`, {
        credentials: "include",
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.messages?.length) {
            const loaded: ChatMessage[] = data.messages
              .filter((m: any) => m.role === "user" || m.role === "assistant")
              .map((m: any) => ({
                role: m.role,
                content: m.content,
                attachments: m.attachments,
              }));
            if (loaded.length) setMessages(loaded);
          }
        })
        .catch(() => {})
        .finally(() => setLoadingHistory(false));
    } else {
      setThreadId(null);
      setMessages([]);
    }
  }, [repoContext]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const startNewChat = useCallback(() => {
    setThreadId(null);
    setMessages([]);
    setAttachments([]);
    setStreamError(false);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
      Array.from(files).forEach((file) => {
        if (file.size > 10 * 1024 * 1024) return;
        const reader = new FileReader();
        reader.onload = () => {
          setAttachments((prev) => [
            ...prev,
            {
              name: file.name,
              type: file.type,
              dataUrl: reader.result as string,
            },
          ]);
        };
        reader.readAsDataURL(file);
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [],
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      let hasFiles = false;
      Array.from(items).forEach((item) => {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (!file || file.size > 10 * 1024 * 1024) return;
          hasFiles = true;
          const reader = new FileReader();
          reader.onload = () => {
            setAttachments((prev) => [
              ...prev,
              {
                name: file.name || `paste-${Date.now()}.${file.type.split("/")[1] || "png"}`,
                type: file.type,
                dataUrl: reader.result as string,
              },
            ]);
          };
          reader.readAsDataURL(file);
        }
      });
      if (hasFiles) {
        e.preventDefault();
      }
    },
    [],
  );

  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const addFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach((file) => {
      if (file.size > 10 * 1024 * 1024) return;
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments((prev) => [
          ...prev,
          {
            name: file.name,
            type: file.type,
            dataUrl: reader.result as string,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer?.types?.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;
    if (e.dataTransfer?.files?.length) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const sendMessage = useCallback(
    async (retryMsg?: string) => {
      const msgToSend = retryMsg || input.trim();
      if ((!msgToSend && attachments.length === 0) || isLoading) return;
      const userMsg = msgToSend;
      const currentAttachments = retryMsg ? [] : [...attachments];
      if (!retryMsg) setInput("");
      setAttachments([]);
      setStreamError(false);

      const attachmentDesc =
        currentAttachments.length > 0
          ? `\n[Fichiers joints: ${currentAttachments.map((a) => a.name).join(", ")}]`
          : "";

      if (!retryMsg) {
        setMessages((prev) => [
          ...prev,
          {
            role: "user",
            content: userMsg + attachmentDesc,
            attachments: currentAttachments.map((a) => ({
              name: a.name,
              type: a.type,
              preview: a.type.startsWith("image/") ? a.dataUrl : undefined,
            })),
          },
        ]);
      }
      setIsLoading(true);

      const activeRepo = repoContext
        ? availableRepos?.find((r) => r.full_name === repoContext)
        : null;
      const repoList =
        availableRepos?.length && !repoContext
          ? `Repos disponibles: ${availableRepos.map((r) => `${r.full_name} (${r.private ? "prive" : "public"}, lang: ${r.language || "?"})`).join(", ")}.`
          : "";
      const devopsActions =
        "Actions GitHub: list_repos, repo_info, list_branches, delete_branch, list_commits, list_prs, create_branch, create_pr, merge_pr, get_file, update_file, delete_file, apply_patch, browse_files, search_code, list_workflows, list_workflow_runs, trigger_workflow, rerun_workflow, cancel_workflow, create_repo, get_deploy_urls, set_deploy_urls, analyze_preview. Tu as aussi l'outil sensory_hub pour voir/analyser visuellement les sites (vision_analyze, brain_state, sensory_summary).";
      const visualContext = activeTab
        ? `\n[CONTEXTE VISUEL] L'utilisateur regarde l'onglet "${activeTab}" dans l'interface DevOps.${
            activeTab === "preview" && previewUrl
              ? ` L'aperçu montre le site déployé à l'URL: ${previewUrl}. Tu peux utiliser crawl_preview pour analyser le contenu/SEO, ou analyze_preview (ou sensory_hub/vision_analyze) pour VOIR et analyser le design visuel (esthétique, UI/UX, couleurs, layout) via screenshot + GPT-4 Vision.`
              : activeTab === "preview" && previewHtml
                ? ` L'aperçu montre un rendu HTML local du projet (GitHub Pages ou sources). Tu peux utiliser sensory_hub/vision_analyze avec l'URL du repo pour voir le design.`
                : ""
          }`
        : "";
      const deployRules = `\n[DEPLOY RULES] Quand tu deploies une app via devops_server/deploy, tu DOIS passer caller='ulysse'. Tes ports sont 5100-5200 (reserves Ulysse). Les ports 6000+ sont reserves a Max, les ports 5200+ a Iris. URL par defaut: appName.ulyssepro.org. Tu DOIS verifier qu'aucune app n'utilise deja le meme port avant de deployer.`;
      const devopsHint = repoContext
        ? `Interface DevOps Bridge. Repo actif: ${repoContext}. Branche par defaut: ${activeRepo?.default_branch || "main"}. ${devopsActions} Pour ecrire/modifier des fichiers: utilise devops_github/update_file (jamais generate_file). Tu as l'autorisation complete.${visualContext}${deployRules}`
        : `Interface DevOps Bridge. ${repoList} ${devopsActions} Pour ecrire/modifier des fichiers: utilise devops_github/update_file (jamais generate_file). Tu as l'autorisation complete.${visualContext}${deployRules}`;

      let messageContent = userMsg;
      if (currentAttachments.length > 0) {
        const fileDescs = currentAttachments
          .map((a) => {
            if (a.type.startsWith("image/")) return `[Image: ${a.name}]`;
            return `[Fichier: ${a.name} (${a.type})]`;
          })
          .join("\n");
        messageContent = `${userMsg}\n\n${fileDescs}`;
      }

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const bodyPayload: any = {
          message: messageContent,
          threadId,
          originDevice: "web",
          sessionContext: "devops",
          contextHints: {
            includeMemory: true,
            devopsContext: devopsHint,
            forceTools: ["devops_github", "devops_server", "sensory_hub"],
            ...(dgmActive && { dgmActive: true, dgmSessionId, dgmObjective, dgmRepoContext }),
          },
        };

        if (currentAttachments.length > 0) {
          bodyPayload.attachments = currentAttachments.map((a) => ({
            name: a.name,
            type: a.type,
            data: a.dataUrl,
          }));
        }

        const res = await fetch("/api/v2/conversations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          credentials: "include",
          body: JSON.stringify(bodyPayload),
          signal: controller.signal,
        });

        if (!res.ok) throw new Error("Failed");

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let fullResponse = "";
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            for (const line of text.split("\n")) {
              if (line.startsWith("data: ")) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.type === "start" && data.threadId) {
                    const newThreadId = data.threadId;
                    setThreadId(newThreadId);
                    if (repoContext) {
                      saveRepoThread(repoContext, newThreadId);
                      setActiveRepoThread(repoContext, newThreadId);
                    }
                  } else if (data.type === "tool_status") {
                    if (data.status === "executing") {
                      setMessages((prev) => {
                        const updated = [...prev];
                        const last = updated[updated.length - 1];
                        const activity = [...(last.toolActivity || [])];
                        activity.push({
                          tool: data.tool,
                          label: data.label,
                          status: "executing",
                        });
                        updated[updated.length - 1] = {
                          ...last,
                          toolActivity: activity,
                        };
                        return updated;
                      });
                    } else if (
                      data.status === "done" ||
                      data.status === "error"
                    ) {
                      setMessages((prev) => {
                        const updated = [...prev];
                        const last = updated[updated.length - 1];
                        const activity = [...(last.toolActivity || [])];
                        const idx = activity.findLastIndex(
                          (a) =>
                            a.tool === data.tool && a.status === "executing",
                        );
                        if (idx >= 0) {
                          activity[idx] = {
                            ...activity[idx],
                            status: data.status,
                            durationMs: data.durationMs,
                          };
                        }
                        updated[updated.length - 1] = {
                          ...last,
                          toolActivity: activity,
                        };
                        return updated;
                      });
                    }
                  } else if (data.type === "chunk" && data.content) {
                    fullResponse += data.content;
                    const captured = fullResponse;
                    setMessages((prev) => {
                      const updated = [...prev];
                      updated[updated.length - 1] = {
                        ...updated[updated.length - 1],
                        role: "assistant",
                        content: captured,
                      };
                      return updated;
                    });
                  }
                } catch {}
              }
            }
          }
        }
        queryClient.invalidateQueries({ queryKey: ["/api/devops/repos"] });
        if (repoContext) {
          queryClient.invalidateQueries({
            queryKey: ["/api/devops/repos", repoContext, "branches"],
          });
          queryClient.invalidateQueries({
            queryKey: ["/api/devops/repos", repoContext, "commits"],
          });
          queryClient.invalidateQueries({
            queryKey: ["/api/devops/repos", repoContext, "pulls"],
          });
          queryClient.invalidateQueries({
            queryKey: ["/api/devops/repos", repoContext, "actions/runs"],
          });
          queryClient.invalidateQueries({
            queryKey: ["/api/devops/repos", repoContext, "tree"],
          });
        }
        queryClient.invalidateQueries({
          queryKey: ["/api/devops/deploy-urls"],
        });
        setTimeout(() => onActionComplete?.(), 1500);
      } catch (err: any) {
        if (err.name === "AbortError") return;
        setStreamError(true);
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant" && !last.content) {
            updated[updated.length - 1] = {
              ...last,
              content: "Erreur de connexion.",
            };
          } else if (last?.role !== "assistant") {
            updated.push({
              role: "assistant",
              content: "Erreur de connexion.",
            });
          }
          return updated;
        });
      } finally {
        setIsLoading(false);
        abortRef.current = null;
        const sharedId = getSharedConversationId();
        if (sharedId) emitChatSync(sharedId, "devops");
      }
    },
    [
      input,
      isLoading,
      threadId,
      repoContext,
      onActionComplete,
      attachments,
      availableRepos,
    ],
  );

  sendMessageRef.current = sendMessage;

  const cancelStream = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      setIsLoading(false);
      setStreamError(false);
    }
  }, []);

  const retryLast = useCallback(() => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (lastUserMsg) {
      setMessages((prev) => {
        const idx = prev.lastIndexOf(lastUserMsg);
        return prev.slice(0, idx + 1);
      });
      sendMessage(lastUserMsg.content.split("\n[Fichiers joints:")[0]);
    }
  }, [messages, sendMessage]);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-all flex items-center justify-center hover:scale-105"
        data-testid="button-open-devops-chat"
      >
        <MessageSquare className="w-6 h-6" />
      </button>
    );
  }

  const chatWidth = isExpanded ? "w-[600px]" : "w-[380px]";
  const chatHeight = isExpanded ? "h-[600px]" : "h-[420px]";
  const repoShortName = repoContext ? repoContext.split("/").pop() : null;

  return (
    <div
      className={cn(
        "fixed bottom-6 right-6 z-50 rounded-xl border border-border bg-background shadow-2xl flex flex-col overflow-hidden transition-all duration-200",
        chatWidth,
        chatHeight,
        isDragging && "ring-2 ring-primary ring-offset-2"
      )}
      data-testid="devops-chat-panel"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-primary/10 backdrop-blur-sm flex items-center justify-center rounded-xl pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-primary">
            <Paperclip className="w-8 h-8" />
            <span className="text-sm font-medium">Deposer le fichier ici</span>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between px-4 py-2.5 bg-primary/5 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Bot className="w-4 h-4 text-primary shrink-0" />
          <span className="font-semibold text-sm shrink-0">Ulysse</span>
          {repoShortName && (
            <Badge
              variant="outline"
              className="text-[10px] truncate max-w-[120px]"
            >
              {repoShortName}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={startNewChat}
            className="p-1.5 rounded-md hover:bg-muted transition-colors"
            title="Nouvelle conversation"
            data-testid="button-new-chat"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded-md hover:bg-muted transition-colors"
            data-testid="button-toggle-chat-size"
          >
            {isExpanded ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 rounded-md hover:bg-muted transition-colors"
            data-testid="button-close-chat"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {loadingHistory && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            <span className="ml-2 text-xs text-muted-foreground">
              Chargement...
            </span>
          </div>
        )}
        {!loadingHistory && messages.length === 0 && (
          <div className="text-center text-muted-foreground text-xs py-6">
            <Bot className="w-7 h-7 mx-auto mb-2 opacity-30" />
            <p className="font-medium mb-1.5">
              {repoShortName ? `Chat ${repoShortName}` : "Demande a Ulysse"}
            </p>
            <div className="space-y-1">
              {(repoShortName
                ? [
                    "Montre les derniers commits",
                    "Cree une branche feature/test",
                    "Modifie le fichier index.html",
                  ]
                : [
                    "Liste mes repos GitHub",
                    "Cree une branche feature/test",
                    "Montre les derniers commits",
                  ]
              ).map((hint, i) => (
                <button
                  key={i}
                  className="block w-full text-left text-[11px] italic px-3 py-1.5 rounded-md hover:bg-muted transition-colors cursor-pointer"
                  onClick={() => {
                    setInput(hint);
                  }}
                  data-testid={`button-hint-${i}`}
                >
                  "{hint}"
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              "flex flex-col",
              msg.role === "user" ? "items-end" : "items-start",
            )}
          >
            {msg.role === "user" ? (
              <div className="max-w-[85%] space-y-1">
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-1 justify-end">
                    {msg.attachments.map((att: any, ai: number) =>
                      att.preview ? (
                        <img
                          key={ai}
                          src={att.preview}
                          alt={att.name}
                          className="w-16 h-16 object-cover rounded-md border"
                        />
                      ) : (
                        <div
                          key={ai}
                          className="flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] bg-muted"
                        >
                          <Paperclip className="w-3 h-3" /> {att.name}
                        </div>
                      ),
                    )}
                  </div>
                )}
                <div
                  className="rounded-lg px-3 py-2 text-sm whitespace-pre-wrap bg-primary text-primary-foreground"
                  data-testid={`chat-message-user-${i}`}
                >
                  {msg.content}
                </div>
              </div>
            ) : (
              <div
                className="w-full max-w-[90%] space-y-1.5"
                data-testid={`chat-message-assistant-${i}`}
              >
                {msg.toolActivity && msg.toolActivity.length > 0 && (
                  <div
                    className="rounded-lg border border-border/60 bg-card/50 overflow-hidden"
                    data-testid={`tool-activity-${i}`}
                  >
                    <div className="px-2 py-1 bg-muted/40 border-b border-border/40 flex items-center gap-1.5">
                      <Zap className="w-3 h-3 text-primary" />
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        {msg.toolActivity.some((a) => a.status === "executing")
                          ? "En cours..."
                          : `${msg.toolActivity.filter((a) => a.status === "done").length} action(s)`}
                      </span>
                      {msg.toolActivity.some(
                        (a) => a.status === "executing",
                      ) && (
                        <div className="ml-auto flex gap-0.5">
                          <div className="w-1 h-1 rounded-full bg-blue-500 animate-pulse" />
                          <div
                            className="w-1 h-1 rounded-full bg-blue-500 animate-pulse"
                            style={{ animationDelay: "0.2s" }}
                          />
                          <div
                            className="w-1 h-1 rounded-full bg-blue-500 animate-pulse"
                            style={{ animationDelay: "0.4s" }}
                          />
                        </div>
                      )}
                    </div>
                    <div className="divide-y divide-border/30">
                      {msg.toolActivity.map((act, j) => (
                        <div
                          key={j}
                          className="flex items-center gap-2 px-2 py-0.5 text-[11px]"
                        >
                          {act.status === "executing" ? (
                            <Loader2 className="w-3 h-3 animate-spin text-blue-500 shrink-0" />
                          ) : act.status === "done" ? (
                            <CheckCircle className="w-3 h-3 text-emerald-500 shrink-0" />
                          ) : (
                            <XCircle className="w-3 h-3 text-red-500 shrink-0" />
                          )}
                          <span
                            className={cn(
                              "flex-1 truncate",
                              act.status === "executing"
                                ? "text-foreground font-medium"
                                : "text-muted-foreground",
                            )}
                          >
                            {act.label}
                          </span>
                          {act.durationMs != null && (
                            <span className="shrink-0 text-[10px] font-mono text-muted-foreground/60">
                              {act.durationMs < 1000
                                ? `${act.durationMs}ms`
                                : `${(act.durationMs / 1000).toFixed(1)}s`}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {(msg.content || (isLoading && i === messages.length - 1)) && (
                  <div className="rounded-lg px-3 py-2 text-sm bg-muted text-foreground">
                    {msg.content ? (
                      <MarkdownContent content={msg.content} />
                    ) : (
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                        <span className="text-xs text-muted-foreground italic">
                          {msg.toolActivity?.some(
                            (a) => a.status === "executing",
                          )
                            ? "Actions en cours..."
                            : "Redaction..."}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {streamError && !isLoading && (
          <div className="flex items-center gap-2 justify-center py-1.5">
            <AlertTriangle className="w-3 h-3 text-yellow-500" />
            <span className="text-xs text-muted-foreground">
              Connexion interrompue
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-5 text-[11px] gap-1 px-2"
              onClick={retryLast}
              data-testid="button-retry-stream"
            >
              <RotateCw className="w-3 h-3" /> Reessayer
            </Button>
          </div>
        )}
      </div>

      {attachments.length > 0 && (
        <div className="px-3 py-1.5 border-t border-border/50 bg-muted/30 flex flex-wrap gap-1.5">
          {attachments.map((att, i) => (
            <div
              key={i}
              className="flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[10px]"
            >
              {att.type.startsWith("image/") ? (
                <img
                  src={att.dataUrl}
                  alt={att.name}
                  className="w-5 h-5 object-cover rounded"
                />
              ) : (
                <Paperclip className="w-2.5 h-2.5 text-muted-foreground" />
              )}
              <span className="truncate max-w-[80px]">{att.name}</span>
              <button
                onClick={() => removeAttachment(i)}
                className="text-muted-foreground hover:text-destructive"
                data-testid={`button-remove-attachment-${i}`}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="p-2.5 border-t border-border shrink-0">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.txt,.json,.js,.ts,.html,.css,.md,.yml,.yaml,.xml,.csv,.log"
          className="hidden"
          onChange={handleFileSelect}
          data-testid="input-file-upload"
        />
        <div className="flex gap-1.5">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
            title="Joindre un fichier"
            data-testid="button-attach-file"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <Input
            ref={inputRef}
            placeholder={
              repoShortName
                ? `Message ${repoShortName}...`
                : "Demande a Ulysse..."
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
            onPaste={handlePaste}
            disabled={isLoading}
            className="text-sm h-9"
            data-testid="input-devops-chat"
          />
          {isLoading ? (
            <Button
              size="sm"
              variant="destructive"
              className="h-9 px-3"
              onClick={cancelStream}
              data-testid="button-cancel-stream"
            >
              <StopCircle className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-9 px-3"
              onClick={() => sendMessage()}
              disabled={!input.trim() && attachments.length === 0}
              data-testid="button-send-devops-chat"
            >
              <Send className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function DeploymentsPanel() {
  const { toast } = useToast();
  const [logsApp, setLogsApp] = useState<string | null>(null);
  const [logsContent, setLogsContent] = useState<string>("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [restartingApp, setRestartingApp] = useState<string | null>(null);
  const [deletingApp, setDeletingApp] = useState<string | null>(null);

  const { data: deployments, isLoading, refetch } = useQuery<DeployedApp[]>({
    queryKey: ["/api/devops/server/deployments"],
    staleTime: 15000,
    refetchInterval: 30000,
  });

  const loadLogs = useCallback(async (appName: string) => {
    setLogsApp(appName);
    setLogsLoading(true);
    try {
      const res = await fetch(`/api/devops/server/app/${appName}/logs?lines=40`, { credentials: "include" });
      const data = await res.json();
      setLogsContent(data.logs || "Pas de logs");
    } catch {
      setLogsContent("Erreur de chargement");
    }
    setLogsLoading(false);
  }, []);

  const restartApp = useCallback(async (appName: string) => {
    setRestartingApp(appName);
    try {
      const res = await fetch(`/api/devops/server/app/${appName}/restart`, { method: "POST", credentials: "include" });
      const data = await res.json();
      if (data.output) {
        toast({ title: "Redemarree", description: appName });
        setTimeout(() => refetch(), 3000);
      }
    } catch {
      toast({ title: "Erreur", description: "Echec du redemarrage", variant: "destructive" });
    }
    setRestartingApp(null);
  }, [toast, refetch]);

  const deleteApp = useCallback(async (appName: string) => {
    if (!confirm(`Supprimer "${appName}" ?\n\nCela va:\n- Supprimer le process PM2\n- Supprimer la config Nginx\n- Supprimer le dossier /var/www/apps/${appName}\n- Liberer les URLs Cloudflare (staging + prod)\n- Liberer les ports dedies`)) return;
    setDeletingApp(appName);
    try {
      const res = await fetch(`/api/devops/server/app/${appName}`, { method: "DELETE", credentials: "include" });
      const data = await res.json();
      if (data.success) {
        const d = data.details || {};
        const parts = [`${appName} supprimee`];
        if (d.cloudflareRemoved?.length) parts.push(`DNS: ${d.cloudflareRemoved.join(", ")}`);
        if (d.portsFreed) parts.push("Ports liberes");
        if (d.peerExists) parts.push(`⚠ "${d.peerName}" encore present`);
        toast({ title: "Supprimee", description: parts.join(" | ") });
        setTimeout(() => refetch(), 2000);
      } else {
        toast({ title: "Erreur", description: data.error || "Echec de la suppression", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Impossible de supprimer l'app", variant: "destructive" });
    }
    setDeletingApp(null);
  }, [toast, refetch]);

  const activeStatuses = ["online", "static", "deployed"];
  const activeApps = deployments?.filter(a => activeStatuses.includes(a.status)) || [];
  const offlineApps = deployments?.filter(a => !activeStatuses.includes(a.status)) || [];

  return (
    <div className="space-y-4" data-testid="deployments-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Rocket className="w-5 h-5 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">Deployments *.ulyssepro.org</h2>
            <p className="text-[11px] text-muted-foreground">Hetzner AX42 — 65.21.209.102</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] h-5">
            {activeApps.length} en ligne
          </Badge>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => refetch()} data-testid="button-refresh-deployments">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Connexion au serveur...
        </div>
      ) : !deployments?.length ? (
        <Card className="p-6 text-center">
          <Server className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">Aucune app deployee</p>
          <p className="text-[11px] text-muted-foreground mt-1">Demande a Ulysse de deployer un projet</p>
        </Card>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {[...activeApps, ...offlineApps].map((app) => {
            const isUlysse = app.name === "ulysse";
            const appDomain = app.domain || (isUlysse ? "ulyssepro.org" : `${app.name}.ulyssepro.org`);
            const fullUrl = `https://${appDomain}`;
            const uptimeStr = app.uptime ? timeAgo(app.uptime) : null;
            const isActive = activeStatuses.includes(app.status);

            return (
              <Card
                key={app.name}
                className={cn(
                  "overflow-hidden transition-colors",
                  isActive ? "hover:border-green-500/30" : "hover:border-red-500/30 opacity-80"
                )}
                data-testid={`card-deployment-${app.name}`}
              >
                <div className={cn(
                  "h-1",
                  isActive ? "bg-green-500" : app.status === "stopping" ? "bg-yellow-500" : "bg-red-500"
                )} />
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className={cn(
                        "w-2 h-2 rounded-full shrink-0",
                        isActive ? "bg-green-500 animate-pulse" : "bg-red-500"
                      )} />
                      <h3 className="font-semibold text-sm truncate" data-testid={`text-deploy-name-${app.name}`}>
                        {app.name}
                      </h3>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge variant="outline" className="text-[8px] h-4">
                        {app.type === "static" ? "HTML" : "Node"}
                      </Badge>
                      <Badge
                        variant={isActive ? "default" : "destructive"}
                        className="text-[9px] h-4"
                      >
                        {app.status}
                      </Badge>
                    </div>
                  </div>

                  <a
                    href={fullUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-[11px] text-primary hover:underline mb-2 truncate"
                    onClick={(e) => e.stopPropagation()}
                    data-testid={`link-deployment-${app.name}`}
                  >
                    <Globe className="w-3 h-3 shrink-0" />
                    <span className="truncate">{appDomain}</span>
                    <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-50" />
                  </a>

                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-2">
                    {app.type === "node" && (
                      <>
                        <span className="flex items-center gap-1">
                          <Cpu className="w-2.5 h-2.5" /> {app.cpu}%
                        </span>
                        <span className="flex items-center gap-1">
                          <HardDrive className="w-2.5 h-2.5" /> {app.memory}
                        </span>
                      </>
                    )}
                    {app.type === "static" && (
                      <span className="flex items-center gap-1">
                        <Globe className="w-2.5 h-2.5" /> Nginx
                      </span>
                    )}
                    {app.port && (
                      <span className="flex items-center gap-1">
                        :{app.port}
                      </span>
                    )}
                    {app.restarts > 0 && (
                      <span className="flex items-center gap-1 text-yellow-600">
                        <RotateCw className="w-2.5 h-2.5" /> {app.restarts}
                      </span>
                    )}
                  </div>

                  {uptimeStr && (
                    <p className="text-[10px] text-muted-foreground mb-2">
                      <Clock className="w-2.5 h-2.5 inline mr-0.5" /> Depuis {uptimeStr}
                    </p>
                  )}

                  <div className="flex items-center gap-1 border-t border-border pt-2 mt-1">
                    {app.type === "node" && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[10px] px-2 gap-1"
                          onClick={() => loadLogs(app.name)}
                          disabled={logsLoading && logsApp === app.name}
                          data-testid={`button-deploy-logs-${app.name}`}
                        >
                          <Terminal className="w-3 h-3" /> Logs
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[10px] px-2 gap-1"
                          onClick={() => restartApp(app.name)}
                          disabled={restartingApp === app.name}
                          data-testid={`button-deploy-restart-${app.name}`}
                        >
                          {restartingApp === app.name ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RotateCcw className="w-3 h-3" />
                          )}
                          Restart
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px] px-2 gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={(e) => { e.stopPropagation(); deleteApp(app.name); }}
                      disabled={deletingApp === app.name}
                      data-testid={`button-deploy-delete-${app.name}`}
                    >
                      {deletingApp === app.name ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Trash2 className="w-3 h-3" />
                      )}
                    </Button>
                    <a
                      href={fullUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto"
                      data-testid={`button-deploy-open-${app.name}`}
                    >
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2 gap-1">
                        <ExternalLink className="w-3 h-3" /> Ouvrir
                      </Button>
                    </a>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {logsApp && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-zinc-950">
            <span className="text-xs font-mono text-zinc-300">
              <Terminal className="w-3 h-3 inline mr-1" />
              {logsApp} — logs
            </span>
            <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-zinc-400 hover:text-zinc-200" onClick={() => { setLogsApp(null); setLogsContent(""); }} data-testid="button-close-deploy-logs">
              <X className="w-3 h-3" />
            </Button>
          </div>
          {logsLoading ? (
            <div className="flex items-center gap-2 p-4 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Chargement...
            </div>
          ) : (
            <pre className="bg-zinc-950 text-zinc-300 p-3 text-[11px] font-mono max-h-[300px] overflow-auto whitespace-pre-wrap" data-testid="deploy-logs-content">
              {logsContent}
            </pre>
          )}
        </Card>
      )}
    </div>
  );
}

function HetznerServerTab() {
  const { toast } = useToast();
  const [serverLogs, setServerLogs] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [restartingApp, setRestartingApp] = useState<string | null>(null);
  const [deletingApp, setDeletingApp] = useState<string | null>(null);
  const [cleanupResult, setCleanupResult] = useState<any>(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);

  const {
    data: serverStatus,
    isLoading: statusLoading,
    refetch: refetchStatus,
  } = useQuery<any>({
    queryKey: ["/api/devops/server/status"],
    staleTime: 20000,
    refetchInterval: 30000,
  });

  const {
    data: serverApps,
    isLoading: appsLoading,
    refetch: refetchApps,
  } = useQuery<any[]>({
    queryKey: ["/api/devops/server/apps"],
    staleTime: 10000,
    refetchInterval: 15000,
  });

  const runCleanup = useCallback(async (dryRun: boolean) => {
    setCleanupLoading(true);
    try {
      const res = await fetch("/api/devops/server/cleanup-orphans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dryRun }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Erreur serveur", description: data.error || "Echec du scan", variant: "destructive" });
        setCleanupLoading(false);
        return;
      }
      setCleanupResult(data);
      if (!dryRun && data.deleted?.length > 0) {
        toast({ title: "Nettoyage termine", description: `${data.deleted.length} app(s) orpheline(s) supprimee(s)` });
        setTimeout(() => refetchApps(), 2000);
      } else if (dryRun) {
        toast({ title: "Scan termine", description: `${data.orphaned?.length || 0} app(s) orpheline(s) detectee(s)` });
      }
    } catch {
      toast({ title: "Erreur", description: "Echec du scan de nettoyage", variant: "destructive" });
    }
    setCleanupLoading(false);
  }, [toast, refetchApps]);

  const loadAppLogs = useCallback(async (appName: string) => {
    setLogsLoading(true);
    try {
      const res = await fetch(
        `/api/devops/server/app/${appName}/logs?lines=50`,
        { credentials: "include" },
      );
      const data = await res.json();
      setServerLogs(data.logs || "Pas de logs disponibles");
    } catch {
      setServerLogs("Erreur de chargement des logs");
    }
    setLogsLoading(false);
  }, []);

  const restartApp = useCallback(
    async (appName: string) => {
      setRestartingApp(appName);
      try {
        const res = await fetch(`/api/devops/server/app/${appName}/restart`, {
          method: "POST",
          credentials: "include",
        });
        const data = await res.json();
        if (data.success) {
          toast({
            title: "App redemarree",
            description: `${appName} a ete redemarree`,
          });
          setTimeout(() => refetchApps(), 3000);
        } else {
          toast({
            title: "Erreur",
            description: data.error || "Echec du redemarrage",
            variant: "destructive",
          });
        }
      } catch {
        toast({
          title: "Erreur",
          description: "Impossible de redemarrer l'app",
          variant: "destructive",
        });
      }
      setRestartingApp(null);
    },
    [toast, refetchApps],
  );

  const deleteApp = useCallback(async (appName: string) => {
    if (!confirm(`Supprimer "${appName}" ?\n\nCela va:\n- Supprimer le process PM2\n- Supprimer la config Nginx\n- Supprimer le dossier /var/www/apps/${appName}\n- Liberer les URLs Cloudflare (staging + prod)\n- Liberer les ports dedies`)) return;
    setDeletingApp(appName);
    try {
      const res = await fetch(`/api/devops/server/app/${appName}`, { method: "DELETE", credentials: "include" });
      const data = await res.json();
      if (data.success) {
        const d = data.details || {};
        const parts = [`${appName} supprimee`];
        if (d.cloudflareRemoved?.length) parts.push(`DNS: ${d.cloudflareRemoved.join(", ")}`);
        if (d.portsFreed) parts.push("Ports liberes");
        if (d.peerExists) parts.push(`⚠ "${d.peerName}" encore present`);
        toast({ title: "Supprimee", description: parts.join(" | ") });
        setTimeout(() => refetchApps(), 2000);
      } else {
        toast({ title: "Erreur", description: data.error || "Echec", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Impossible de supprimer", variant: "destructive" });
    }
    setDeletingApp(null);
  }, [toast, refetchApps]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Hetzner (ulyssepro.org)</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => runCleanup(true)}
            disabled={cleanupLoading}
            data-testid="button-scan-orphans"
          >
            {cleanupLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            <span className="ml-1 text-xs">Orphelins</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => {
              refetchStatus();
              refetchApps();
            }}
            data-testid="button-refresh-server"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {cleanupResult && (
        <Card className="p-3 border-orange-500/30 bg-orange-500/5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Scan orphelins: {cleanupResult.orphaned?.length || 0} detectee(s)</span>
            {cleanupResult.orphaned?.length > 0 && !cleanupResult.deleted?.length && (
              <Button size="sm" variant="destructive" className="h-6 text-xs" onClick={() => runCleanup(false)} disabled={cleanupLoading} data-testid="button-delete-orphans">
                Supprimer {cleanupResult.orphaned.length} orphelin(s)
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setCleanupResult(null)} data-testid="button-close-cleanup">X</Button>
          </div>
          {cleanupResult.orphaned?.length > 0 && (
            <div className="text-xs text-muted-foreground space-y-0.5">
              {cleanupResult.orphaned.map((name: string) => (
                <div key={name} className={cleanupResult.deleted?.includes(name) ? "line-through text-red-400" : ""}>{name}</div>
              ))}
            </div>
          )}
          {cleanupResult.errors?.length > 0 && (
            <div className="text-xs text-destructive mt-1">{cleanupResult.errors.join(", ")}</div>
          )}
          {cleanupResult.deleted?.length > 0 && (
            <div className="text-xs text-green-500 mt-1">{cleanupResult.deleted.length} app(s) supprimee(s) avec succes</div>
          )}
        </Card>
      )}

      {statusLoading ? (
        <div className="flex items-center gap-2 py-3 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Connexion...
        </div>
      ) : serverStatus?.error ? (
        <Card className="p-3 border-destructive/30 bg-destructive/5">
          <div className="flex items-center gap-2 text-destructive text-sm">
            <WifiOff className="w-4 h-4" /> Serveur inaccessible
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {serverStatus.error}
          </p>
        </Card>
      ) : serverStatus ? (
        <div className="grid grid-cols-4 gap-2">
          {[
            {
              icon: Wifi,
              color: "text-green-500",
              label: "Statut",
              value: "En ligne",
              valueColor: "text-green-600",
            },
            {
              icon: Cpu,
              color: "text-blue-500",
              label: "CPU",
              value: serverStatus.cpu || "N/A",
            },
            {
              icon: HardDrive,
              color: "text-purple-500",
              label: "RAM",
              value: serverStatus.memory || "N/A",
            },
            {
              icon: HardDrive,
              color: "text-orange-500",
              label: "Disque",
              value: serverStatus.disk || "N/A",
            },
          ].map((s, i) => (
            <Card key={i} className="p-2.5">
              <div className="flex items-center gap-1.5 mb-0.5">
                <s.icon className={cn("w-3 h-3", s.color)} />
                <span className="text-[9px] text-muted-foreground uppercase">
                  {s.label}
                </span>
              </div>
              <p className={cn("text-sm font-semibold", s.valueColor)}>
                {s.value}
              </p>
            </Card>
          ))}
        </div>
      ) : null}

      <div>
        <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-muted-foreground" />
          Applications PM2
        </h3>
        {appsLoading ? (
          <div className="flex items-center gap-2 py-3 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Chargement...
          </div>
        ) : (
          <div className="space-y-1.5">
            {(serverApps || []).map((app: any) => (
              <Card
                key={app.name}
                className="p-2.5"
                data-testid={`card-server-app-${app.name}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <div
                      className={cn(
                        "w-2 h-2 rounded-full shrink-0",
                        app.status === "online"
                          ? "bg-green-500"
                          : app.status === "stopping"
                            ? "bg-yellow-500"
                            : "bg-red-500",
                      )}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{app.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        CPU: {app.cpu || 0}% · RAM: {app.memory || "?"} ·
                        Restarts: {app.restarts || 0}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={() => loadAppLogs(app.name)}
                      disabled={logsLoading}
                      data-testid={`button-logs-${app.name}`}
                    >
                      <Terminal className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                      onClick={() => restartApp(app.name)}
                      disabled={restartingApp === app.name}
                      data-testid={`button-restart-${app.name}`}
                    >
                      {restartingApp === app.name ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3.5 h-3.5" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => deleteApp(app.name)}
                      disabled={deletingApp === app.name}
                      data-testid={`button-delete-${app.name}`}
                    >
                      {deletingApp === app.name ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </Button>
                    <Badge
                      variant={
                        app.status === "online" ? "default" : "destructive"
                      }
                      className="text-[10px] h-5"
                    >
                      {app.status}
                    </Badge>
                  </div>
                </div>
              </Card>
            ))}
            {!(serverApps || []).length && (
              <p className="text-muted-foreground text-sm">
                Aucune application PM2
              </p>
            )}
          </div>
        )}
      </div>

      {serverLogs !== null && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium">Logs</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={() => setServerLogs(null)}
              data-testid="button-close-server-logs"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
          <pre
            className="bg-zinc-950 text-zinc-300 rounded-lg p-3 text-[11px] font-mono max-h-[350px] overflow-auto whitespace-pre-wrap"
            data-testid="server-logs-content"
          >
            {serverLogs}
          </pre>
        </div>
      )}
    </div>
  );
}

function QuickRepoSwitcher({
  repos,
  currentRepo,
  onSwitch,
}: {
  repos: Repo[];
  currentRepo: Repo;
  onSwitch: (repo: Repo) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    if (!search)
      return repos.filter((r) => r.id !== currentRepo.id).slice(0, 8);
    const q = search.toLowerCase();
    return repos
      .filter(
        (r) =>
          r.id !== currentRepo.id &&
          (r.name.toLowerCase().includes(q) ||
            r.full_name.toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [repos, currentRepo, search]);

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 gap-1 text-xs text-muted-foreground"
        onClick={() => setOpen(!open)}
        data-testid="button-switch-repo"
      >
        <ArrowUpDown className="w-3 h-3" /> Changer
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute top-full left-0 mt-1 z-50 w-72 rounded-lg border border-border bg-background shadow-xl p-2"
            data-testid="repo-switcher-dropdown"
          >
            <Input
              placeholder="Rechercher un repo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 text-xs mb-1.5"
              autoFocus
              data-testid="input-switch-repo-search"
            />
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {filtered.map((r) => (
                <button
                  key={r.id}
                  className="w-full text-left px-2 py-1.5 rounded-md hover:bg-muted flex items-center gap-2 transition-colors"
                  onClick={() => {
                    onSwitch(r);
                    setOpen(false);
                    setSearch("");
                  }}
                  data-testid={`switch-to-${r.name}`}
                >
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full shrink-0",
                      langColor(r.language),
                    )}
                  />
                  <span className="text-xs font-medium truncate flex-1">
                    {r.name}
                  </span>
                  <Badge
                    variant={r.private ? "secondary" : "outline"}
                    className="text-[9px] h-4 shrink-0"
                  >
                    {r.private ? "P" : "O"}
                  </Badge>
                </button>
              ))}
              {!filtered.length && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Aucun autre repo
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function DevOps() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const debouncedSearch = useDebounce(searchFilter, 150);
  const [activeTab, setActiveTab] = useState(() => getLastActiveTab());
  useTabListener(setActiveTab, ["projects", "branches", "commits", "prs", "cicd", "library", "library-test", "preview", "editor", "server", "rollback"]);
  const [newBranchOpen, setNewBranchOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchFrom, setNewBranchFrom] = useState("main");
  const [newPrOpen, setNewPrOpen] = useState(false);
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [prHead, setPrHead] = useState("");
  const [prBase, setPrBase] = useState("main");
  const [patchOpen, setPatchOpen] = useState(false);
  const [patchBranch, setPatchBranch] = useState("");
  const [patchMessage, setPatchMessage] = useState("");
  const [patchFiles, setPatchFiles] = useState<string>("[]");
  const [newRepoOpen, setNewRepoOpen] = useState(false);
  const [urlsOpen, setUrlsOpen] = useState(false);
  const [urlsEdit, setUrlsEdit] = useState<string[]>([]);
  const [urlsNewInput, setUrlsNewInput] = useState("");
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoDesc, setNewRepoDesc] = useState("");
  const [newRepoPrivate, setNewRepoPrivate] = useState(false);
  const [newRepoTemplate, setNewRepoTemplate] = useState("portfolio");
  const [editDeployRepo, setEditDeployRepo] = useState<string | null>(null);
  const [editDeployInput, setEditDeployInput] = useState("");
  const [hetznerDeploying, setHetznerDeploying] = useState(false);
  const [hetznerDeployLog, setHetznerDeployLog] = useState<string | null>(null);
  const [commitPage, setCommitPage] = useState(1);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [rollbackBranch, setRollbackBranch] = useState("");
  const [rollbackConfirmSha, setRollbackConfirmSha] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [dgmActive, setDgmActive] = useState(false);
  const [dgmSessionId, setDgmSessionId] = useState<number | null>(null);
  const [dgmObjective, setDgmObjective] = useState("");
  const [dgmTasks, setDgmTasks] = useState<any[]>([]);
  const [dgmLoading, setDgmLoading] = useState(false);
  const [dgmPanelOpen, setDgmPanelOpen] = useState(false);
  const [dgmAllSessions, setDgmAllSessions] = useState<any[]>([]);

  const fetchDgmForRepo = useCallback((repoFullName: string | null) => {
    if (!repoFullName) {
      setDgmActive(false);
      setDgmSessionId(null);
      setDgmObjective("");
      setDgmTasks([]);
      return;
    }
    fetch(`/api/ulysse-dev/dgm/status?repo=${encodeURIComponent(repoFullName)}`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          setDgmActive(data.active);
          if (data.session) {
            setDgmSessionId(data.session.id);
            setDgmObjective(data.session.objective || "");
          } else {
            setDgmSessionId(null);
            setDgmObjective("");
          }
          setDgmTasks(data.tasks || []);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchDgmForRepo(selectedRepo?.full_name || null);
  }, [selectedRepo?.full_name, fetchDgmForRepo]);

  useEffect(() => {
    fetch("/api/ulysse-dev/dgm/status", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.sessions) {
          setDgmAllSessions(data.sessions);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!dgmActive || !selectedRepo?.full_name) return;
    const interval = setInterval(() => {
      fetchDgmForRepo(selectedRepo.full_name);
    }, 4000);
    return () => clearInterval(interval);
  }, [dgmActive, selectedRepo?.full_name, fetchDgmForRepo]);

  const toggleDgm = async (activate: boolean) => {
    if (!selectedRepo) return;
    setDgmLoading(true);
    try {
      console.log("[DGM] Toggling:", { activate, repo: selectedRepo.full_name, objective: dgmObjective });
      const res = await fetch("/api/ulysse-dev/dgm/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          active: activate,
          objective: dgmObjective || undefined,
          repoContext: selectedRepo.full_name,
        }),
      });
      const data = await res.json();
      console.log("[DGM] Toggle response:", data);
      setDgmActive(data.active);
      if (data.session) {
        setDgmSessionId(data.session.id);
        setDgmTasks([]);
      }
      if (!activate) {
        setDgmPanelOpen(false);
      }
      fetch("/api/ulysse-dev/dgm/status", { credentials: "include" })
        .then((r) => r.ok ? r.json() : null)
        .then((d) => { if (d?.sessions) setDgmAllSessions(d.sessions); })
        .catch(() => {});
    } catch (err: any) {
      console.error("[DGM] Toggle error:", err);
    }
    setDgmLoading(false);
  };

  useEffect(() => {
    setLastActiveTab(activeTab);
  }, [activeTab]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (selectedRepo) return;
        searchInputRef.current?.focus();
      }
      if (e.key === "Escape") {
        if (selectedRepo) {
          setSelectedRepo(null);
          setCurrentPath("");
          setSelectedFile(null);
          setPreviewHtml("");
          setCommitPage(1);
          fileContentCache.current.clear();
        }
      }
      if (selectedRepo && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tabMap: Record<string, string> = {
          "1": "branches",
          "2": "commits",
          "3": "prs",
          "4": "cicd",
          "5": "library",
          "6": "preview",
          "7": "server",
          "8": "rollback",
        };
        if (
          tabMap[e.key] &&
          document.activeElement?.tagName !== "INPUT" &&
          document.activeElement?.tagName !== "TEXTAREA"
        ) {
          e.preventDefault();
          setActiveTab(tabMap[e.key]);
          if (tabMap[e.key] === "preview" && !previewHtml && !previewLoading) {
            buildPreview();
          }
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedRepo]);

  const { data: ghUser } = useQuery<any>({
    queryKey: ["/api/devops/user"],
    staleTime: 300000,
  });

  const { data: repos, isLoading: reposLoading } = useQuery<Repo[]>({
    queryKey: ["/api/devops/repos"],
    staleTime: 30000,
  });

  const { data: deployUrls } = useQuery<Record<string, string[]>>({
    queryKey: ["/api/devops/deploy-urls"],
    staleTime: 60000,
  });

  const { data: hetznerApps } = useQuery<DeployedApp[]>({
    queryKey: ["/api/devops/server/deployments"],
    staleTime: 30000,
  });

  const hetznerAppMap = useMemo(() => {
    const map = new Map<string, DeployedApp>();
    if (hetznerApps) {
      for (const app of hetznerApps) {
        map.set(app.name.toLowerCase(), app);
      }
    }
    return map;
  }, [hetznerApps]);

  useEffect(() => {
    if (!selectedRepo && repos?.length) {
      const lastRepo = getLastVisitedRepo();
      if (lastRepo) {
        const found = repos.find((r) => r.full_name === lastRepo);
        if (found) {
          // Don't auto-navigate, just prefetch
          queryClient.prefetchQuery({
            queryKey: ["/api/devops/repos", found.full_name, "branches"],
            queryFn: async () => {
              const res = await fetch(
                `/api/devops/repos/${found.full_name}/branches`,
                { credentials: "include" },
              );
              const data = await res.json();
              return Array.isArray(data) ? data : [];
            },
            staleTime: 30000,
          });
        }
      }
    }
  }, [repos, selectedRepo]);

  const { data: branches } = useQuery<Branch[]>({
    queryKey: ["/api/devops/repos", selectedRepo?.full_name, "branches"],
    queryFn: async () => {
      const res = await fetch(
        `/api/devops/repos/${selectedRepo!.full_name}/branches`,
        { credentials: "include" },
      );
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: !!selectedRepo,
    staleTime: 30000,
  });

  const { data: commits, isLoading: commitsLoading } = useQuery<Commit[]>({
    queryKey: [
      "/api/devops/repos",
      selectedRepo?.full_name,
      "commits",
      commitPage,
    ],
    queryFn: async () => {
      const res = await fetch(
        `/api/devops/repos/${selectedRepo!.full_name}/commits?per_page=${commitPage * 20}`,
        { credentials: "include" },
      );
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: !!selectedRepo,
    staleTime: 20000,
  });

  const { data: pullRequests } = useQuery<PullRequest[]>({
    queryKey: ["/api/devops/repos", selectedRepo?.full_name, "pulls"],
    queryFn: async () => {
      const res = await fetch(
        `/api/devops/repos/${selectedRepo!.full_name}/pulls?state=all`,
        { credentials: "include" },
      );
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: !!selectedRepo,
    staleTime: 30000,
  });

  const { data: workflowRuns, isLoading: runsLoading } = useQuery<{
    workflow_runs: WorkflowRun[];
    total_count: number;
  }>({
    queryKey: ["/api/devops/repos", selectedRepo?.full_name, "actions/runs"],
    queryFn: async () => {
      const res = await fetch(
        `/api/devops/repos/${selectedRepo!.full_name}/actions/runs`,
        { credentials: "include" },
      );
      return res.json();
    },
    enabled: !!selectedRepo,
    staleTime: 15000,
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasActive = data?.workflow_runs?.some(
        (r: WorkflowRun) => r.status === "in_progress" || r.status === "queued",
      );
      return hasActive ? 8000 : false;
    },
  });

  const { data: fileTree, isLoading: treeLoading } = useQuery<{
    tree: TreeItem[];
    sha: string;
    truncated: boolean;
  }>({
    queryKey: ["/api/devops/repos", selectedRepo?.full_name, "tree"],
    queryFn: async () => {
      const res = await fetch(
        `/api/devops/repos/${selectedRepo!.full_name}/tree/${selectedRepo!.default_branch}`,
        { credentials: "include" },
      );
      return res.json();
    },
    enabled: !!selectedRepo,
    staleTime: 30000,
  });

  const hasStagingBranch = useMemo(() => {
    return branches?.some((b: Branch) => b.name === "staging") || false;
  }, [branches]);

  const { data: stagingTree, isLoading: stagingTreeLoading } = useQuery<{
    tree: TreeItem[];
    sha: string;
    truncated: boolean;
  }>({
    queryKey: ["/api/devops/repos", selectedRepo?.full_name, "tree-staging"],
    queryFn: async () => {
      const res = await fetch(
        `/api/devops/repos/${selectedRepo!.full_name}/tree/staging`,
        { credentials: "include" },
      );
      return res.json();
    },
    enabled: !!selectedRepo && hasStagingBranch,
    staleTime: 30000,
  });

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
          let fileData: any;
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
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message || "Impossible de sauvegarder", variant: "destructive" });
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
      } catch (prErr: any) {
        const errMsg = prErr?.message || "";
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
    } catch (err: any) {
      toast({
        title: "Erreur de déploiement",
        description: err.message || "Impossible de merger staging vers prod",
        variant: "destructive",
      });
      setStagingDeployStatus(null);
    }
    setStagingDeploying(false);
  }, [selectedRepo, toast]);

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
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  const browserIframeRef = useRef<HTMLIFrameElement>(null);
  const [browserUrl, setBrowserUrl] = useState<string>("");
  const [browserInputUrl, setBrowserInputUrl] = useState<string>("");
  const [browserHistory, setBrowserHistory] = useState<string[]>([]);
  const [browserHistoryIndex, setBrowserHistoryIndex] = useState(-1);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [browserViewport, setBrowserViewport] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [browserPageInfo, setBrowserPageInfo] = useState<{ title?: string; status?: number; favicon?: string; meta?: any; performance?: any } | null>(null);
  const [browserSiteStatus, setBrowserSiteStatus] = useState<{ reachable?: boolean; status?: number; statusText?: string; server?: string; ssl?: boolean } | null>(null);
  const browserAutoLoaded = useRef<string>("");
  const [chatExternalMessage, setChatExternalMessage] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editCommitMsg, setEditCommitMsg] = useState("");
  const [savingFile, setSavingFile] = useState(false);
  const [commitDiff, setCommitDiff] = useState<{
    sha: string;
    message: string;
    files: any[];
  } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [deletingFile, setDeletingFile] = useState(false);
  const [showNewFileDialog, setShowNewFileDialog] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [newFileContent, setNewFileContent] = useState("");
  const [creatingFile, setCreatingFile] = useState(false);
  const [isFileModified, setIsFileModified] = useState(false);
  const originalContentRef = useRef<string>("");

  const fileContentCache = useRef<
    Map<
      string,
      { content: string; sha?: string; isImage?: boolean; rawBase64?: string }
    >
  >(new Map());

  const selectRepo = useCallback((repo: Repo) => {
    setSelectedRepo(repo);
    setActiveTab(getLastActiveTab());
    setCurrentPath("");
    setSelectedFile(null);
    setPreviewHtml("");
    setCommitPage(1);
    setRollbackBranch(repo.default_branch);
    setRollbackConfirmSha(null);
    setLastVisitedRepo(repo.full_name);
    fileContentCache.current.clear();
    stagingContentCache.current.clear();
    setStagingFile(null);
    setStagingPath("");
    setStagingSearch("");
    setStagingEditMode(false);
    setStagingDeployStatus(null);
    setBrowserUrl("");
    setBrowserInputUrl("");
    setBrowserHistory([]);
    setBrowserHistoryIndex(-1);
    setBrowserLoading(false);
    browserAutoLoaded.current = "";
  }, []);

  const switchRepo = useCallback((repo: Repo) => {
    fileContentCache.current.clear();
    stagingContentCache.current.clear();
    setSelectedFile(null);
    setCurrentPath("");
    setPreviewHtml("");
    setCommitDiff(null);
    setCommitPage(1);
    setSelectedRepo(repo);
    setLastVisitedRepo(repo.full_name);
    setStagingFile(null);
    setStagingPath("");
    setStagingSearch("");
    setStagingEditMode(false);
    setStagingDeployStatus(null);
    setBrowserUrl("");
    setBrowserInputUrl("");
    setBrowserHistory([]);
    setBrowserHistoryIndex(-1);
    setBrowserLoading(false);
    browserAutoLoaded.current = "";
  }, []);

  useEffect(() => {
    if (!selectedRepo || browserUrl) return;
    const allDeployUrls = deployUrls?.[selectedRepo.full_name] || [];
    const repoHomepage = selectedRepo.homepage || null;
    const ghPagesUrl = selectedRepo.has_pages
      ? `https://${selectedRepo.owner?.login || selectedRepo.full_name.split("/")[0]}.github.io/${selectedRepo.name}/`
      : null;
    const rawUrls = [
      ...allDeployUrls.filter((u: string) => !u.includes(".replit.app") && !u.includes(".replit.dev")),
      ...(repoHomepage && !repoHomepage.includes(".replit.app") && !repoHomepage.includes(".replit.dev") && !allDeployUrls.includes(repoHomepage) ? [repoHomepage] : []),
      ...(ghPagesUrl && !allDeployUrls.includes(ghPagesUrl) ? [ghPagesUrl] : []),
    ];
    const urls = [
      ...rawUrls.filter((u: string) => u.includes(".ulyssepro.org")),
      ...rawUrls.filter((u: string) => !u.includes(".ulyssepro.org")),
    ];
    const url = urls[0];
    if (!url) return;
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
      normalizedUrl = "https://" + normalizedUrl;
    }
    setBrowserUrl(normalizedUrl);
    setBrowserInputUrl(normalizedUrl);
    setBrowserLoading(true);
    setBrowserHistory([normalizedUrl]);
    setBrowserHistoryIndex(0);
  }, [selectedRepo, deployUrls, browserUrl]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "devops-browser-navigate") {
        const newUrl = e.data.url;
        if (newUrl && newUrl !== browserUrl) {
          setBrowserUrl(newUrl);
          setBrowserInputUrl(newUrl);
          setBrowserLoading(true);
          const newHistory = browserHistory.slice(0, browserHistoryIndex + 1);
          newHistory.push(newUrl);
          setBrowserHistory(newHistory);
          setBrowserHistoryIndex(newHistory.length - 1);
        }
      }
      if (e.data?.type === "devops-browser-loaded") {
        setBrowserPageInfo({
          title: e.data.title,
          status: e.data.status,
          favicon: e.data.favicon,
          meta: e.data.meta,
          performance: e.data.performance,
        });
        setBrowserLoading(false);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [browserUrl, browserHistory, browserHistoryIndex]);

  useEffect(() => {
    if (!browserUrl) {
      setBrowserSiteStatus(null);
      setBrowserPageInfo(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`/api/devops/proxy/check?url=${encodeURIComponent(browserUrl)}`);
        const data = await resp.json();
        if (!cancelled) setBrowserSiteStatus(data);
      } catch {
        if (!cancelled) setBrowserSiteStatus({ reachable: false, status: 0, statusText: "Erreur reseau" });
      }
    })();
    return () => { cancelled = true; };
  }, [browserUrl]);

  const prefetchRepoData = useCallback(
    (repoFullName: string, defaultBranch: string) => {
      queryClient.prefetchQuery({
        queryKey: ["/api/devops/repos", repoFullName, "branches"],
        queryFn: async () => {
          const res = await fetch(
            `/api/devops/repos/${repoFullName}/branches`,
            { credentials: "include" },
          );
          const data = await res.json();
          return Array.isArray(data) ? data : [];
        },
        staleTime: 30000,
      });
      queryClient.prefetchQuery({
        queryKey: ["/api/devops/repos", repoFullName, "commits", 1],
        queryFn: async () => {
          const res = await fetch(
            `/api/devops/repos/${repoFullName}/commits?per_page=20`,
            { credentials: "include" },
          );
          const data = await res.json();
          return Array.isArray(data) ? data : [];
        },
        staleTime: 20000,
      });
      queryClient.prefetchQuery({
        queryKey: ["/api/devops/repos", repoFullName, "tree"],
        queryFn: async () => {
          const res = await fetch(
            `/api/devops/repos/${repoFullName}/tree/${defaultBranch}`,
            { credentials: "include" },
          );
          return res.json();
        },
        staleTime: 30000,
      });
    },
    [],
  );

  const deployToHetzner = useCallback(async () => {
    setHetznerDeploying(true);
    setHetznerDeployLog("Deploiement ulysse sur Hetzner...");
    try {
      const res = await fetch("/api/devops/server/deploy-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ appName: "ulysse" }),
      });
      const data = await res.json();
      if (data.success) {
        setHetznerDeployLog(data.output || "Deploiement reussi");
        toast({
          title: "Deploiement Hetzner reussi",
          description: "ulyssepro.org mis a jour",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/devops/server/deployments"] });
      } else {
        setHetznerDeployLog(data.error || data.output || "Erreur inconnue");
        toast({
          title: "Erreur de deploiement",
          description: data.error || "Echec",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      setHetznerDeployLog(err.message);
      toast({
        title: "Erreur",
        description: err.message,
        variant: "destructive",
      });
    }
    setHetznerDeploying(false);
  }, [toast]);

  const [runLogs, setRunLogs] = useState<{
    runId: number;
    jobs: any[];
    expandedJob: number | null;
    logs: Record<number, string>;
    logsLoading: Record<number, boolean>;
  } | null>(null);
  const [runLogsLoading, setRunLogsLoading] = useState(false);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const buildPreview = useCallback(async () => {
    if (!selectedRepo || !fileTree?.tree) return;
    setPreviewLoading(true);
    try {
      const tree = fileTree.tree;

      const hasPkgJson = tree.some(
        (f) => f.path === "package.json" && f.type === "blob",
      );
      const hasViteConfig = tree.some(
        (f) =>
          (f.path === "vite.config.ts" || f.path === "vite.config.js") &&
          f.type === "blob",
      );
      const hasNextConfig = tree.some(
        (f) =>
          (f.path === "next.config.js" ||
            f.path === "next.config.ts" ||
            f.path === "next.config.mjs") &&
          f.type === "blob",
      );
      const isBuildProject =
        hasPkgJson &&
        (hasViteConfig ||
          hasNextConfig ||
          tree.some((f) => f.path === "tsconfig.json"));

      const rootHtml = tree.find(
        (f) => f.path === "index.html" && f.type === "blob",
      );
      const anyHtml = tree.find(
        (f) => f.path.endsWith(".html") && f.type === "blob",
      );
      const htmlFile = rootHtml || (!isBuildProject ? anyHtml : null);

      if (!htmlFile) {
        const projectType = hasNextConfig
          ? "Next.js"
          : hasViteConfig
            ? "Vite"
            : hasPkgJson
              ? "Node.js"
              : null;
        const deployUrl =
          selectedRepo.homepage ||
          (selectedRepo.has_pages
            ? `https://${selectedRepo.owner?.login || selectedRepo.full_name.split("/")[0]}.github.io/${selectedRepo.name}/`
            : null);

        const msgHtml = projectType
          ? `<html><body style='font-family:system-ui;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;color:#666;margin:0;gap:16px;text-align:center;padding:40px'>
              <div style='font-size:40px'>🔧</div>
              <p style='font-size:16px;font-weight:600;color:#333'>Projet ${projectType}</p>
              <p style='font-size:13px;max-width:400px'>Ce projet necessite un serveur de developpement (<code>npm run dev</code>) pour fonctionner.</p>
              ${deployUrl ? `<a href="${deployUrl}" target="_blank" style='font-size:13px;color:#3b82f6;text-decoration:underline'>Voir le site deploye</a>` : '<p style="font-size:12px;color:#999">Aucun deploiement detecte</p>'}
            </body></html>`
          : "<html><body style='font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;color:#888;margin:0'><p>Aucun fichier HTML trouve dans ce repo</p></body></html>";
        setPreviewHtml(msgHtml);
        setPreviewLoading(false);
        return;
      }

      const decodeBase64Utf8 = (b64: string): string => {
        const binStr = atob(b64);
        const bytes = Uint8Array.from(binStr, (c) => c.charCodeAt(0));
        return new TextDecoder("utf-8").decode(bytes);
      };
      const fetchFile = async (path: string): Promise<string> => {
        const res = await fetch(
          `/api/devops/repos/${selectedRepo.full_name}/contents/${path}`,
          { credentials: "include" },
        );
        const data = await res.json();
        if (data.content)
          return decodeBase64Utf8(data.content.replace(/\n/g, ""));
        return "";
      };

      let html = await fetchFile(htmlFile.path);
      const cssFiles = tree.filter(
        (f) => f.type === "blob" && f.path.endsWith(".css"),
      );
      const jsFiles = tree.filter(
        (f) => f.type === "blob" && f.path.endsWith(".js"),
      );

      const [cssContents, jsContents] = await Promise.all([
        Promise.all(
          cssFiles.map((f) =>
            fetchFile(f.path).then((c) => ({ path: f.path, content: c })),
          ),
        ),
        Promise.all(
          jsFiles.map((f) =>
            fetchFile(f.path).then((c) => ({ path: f.path, content: c })),
          ),
        ),
      ]);

      for (const css of cssContents) {
        const linkPattern = new RegExp(
          `<link[^>]*href=["']${css.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*/?>`,
          "gi",
        );
        if (linkPattern.test(html)) {
          html = html.replace(linkPattern, `<style>${css.content}</style>`);
        } else {
          html = html.replace(
            "</head>",
            `<style>/* ${css.path} */\n${css.content}</style>\n</head>`,
          );
        }
      }

      for (const js of jsContents) {
        const scriptPattern = new RegExp(
          `<script[^>]*src=["']${js.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>\\s*</script>`,
          "gi",
        );
        if (scriptPattern.test(html)) {
          html = html.replace(scriptPattern, `<script>${js.content}</script>`);
        } else {
          html = html.replace(
            "</body>",
            `<script>/* ${js.path} */\n${js.content}</script>\n</body>`,
          );
        }
      }

      if (
        !html.includes("<meta charset") &&
        !html.includes('<meta http-equiv="Content-Type"')
      ) {
        html = html.replace(/<head>/i, '<head><meta charset="utf-8">');
        if (!html.includes("<head>") && !html.includes("<HEAD>")) {
          html = `<html><head><meta charset="utf-8"></head>${html}</html>`;
        }
      }
      setPreviewHtml(html);
    } catch {
      setPreviewHtml(
        "<html><head><meta charset='utf-8'></head><body style='font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;color:#c00;margin:0'><p>Erreur lors du chargement de l'apercu</p></body></html>",
      );
    }
    setPreviewLoading(false);
  }, [selectedRepo, fileTree]);

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
            "png",
            "jpg",
            "jpeg",
            "gif",
            "svg",
            "webp",
            "ico",
            "bmp",
          ];
          const binaryExts = [
            "png",
            "jpg",
            "jpeg",
            "gif",
            "webp",
            "ico",
            "bmp",
            "pdf",
            "zip",
            "tar",
            "gz",
            "woff",
            "woff2",
            "ttf",
            "eot",
            "mp3",
            "mp4",
            "wav",
            "ogg",
          ];

          let fileData: any;
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
      } catch (err: any) {
        toast({
          title: "Erreur",
          description: err.message || "Impossible de mettre a jour le fichier",
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
    } catch (err: any) {
      toast({
        title: "Erreur",
        description: err.message || "Impossible de supprimer",
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
    } catch (err: any) {
      toast({
        title: "Erreur",
        description: err.message || "Impossible de sauvegarder",
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
    } catch (err: any) {
      toast({
        title: "Erreur",
        description: err.message || "Impossible de creer le fichier",
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

  const loadCommitDiff = useCallback(
    async (sha: string) => {
      if (!selectedRepo) return;
      setDiffLoading(true);
      try {
        const res = await fetch(
          `/api/devops/repos/${selectedRepo.full_name}/commits/${sha}`,
          { credentials: "include" },
        );
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setCommitDiff({
          sha: data.sha || sha,
          message: data.commit?.message || "",
          files: data.files || [],
        });
      } catch {
        toast({
          title: "Erreur",
          description: "Impossible de charger le diff",
          variant: "destructive",
        });
      }
      setDiffLoading(false);
    },
    [selectedRepo, toast],
  );

  const loadRunJobs = useCallback(
    async (runId: number) => {
      if (!selectedRepo) return;
      setRunLogsLoading(true);
      try {
        const res = await fetch(
          `/api/devops/repos/${selectedRepo.full_name}/actions/runs/${runId}/jobs`,
          { credentials: "include" },
        );
        const data = await res.json();
        setRunLogs({
          runId,
          jobs: data.jobs || [],
          expandedJob: null,
          logs: {},
          logsLoading: {},
        });
      } catch {
        toast({
          title: "Erreur",
          description: "Impossible de charger les jobs",
          variant: "destructive",
        });
      }
      setRunLogsLoading(false);
    },
    [selectedRepo, toast],
  );

  const loadJobLogs = useCallback(
    async (jobId: number) => {
      if (!selectedRepo || !runLogs) return;
      setRunLogs((prev) =>
        prev
          ? { ...prev, logsLoading: { ...prev.logsLoading, [jobId]: true } }
          : prev,
      );
      try {
        const res = await fetch(
          `/api/devops/repos/${selectedRepo.full_name}/actions/jobs/${jobId}/logs`,
          { credentials: "include" },
        );
        const data = await res.json();
        setRunLogs((prev) =>
          prev
            ? {
                ...prev,
                expandedJob: prev.expandedJob === jobId ? null : jobId,
                logs: {
                  ...prev.logs,
                  [jobId]: data.logs || "Pas de logs disponibles",
                },
                logsLoading: { ...prev.logsLoading, [jobId]: false },
              }
            : prev,
        );
      } catch {
        setRunLogs((prev) =>
          prev
            ? {
                ...prev,
                expandedJob: prev.expandedJob === jobId ? null : jobId,
                logs: {
                  ...prev.logs,
                  [jobId]: "Erreur: impossible de recuperer les logs",
                },
                logsLoading: { ...prev.logsLoading, [jobId]: false },
              }
            : prev,
        );
      }
    },
    [selectedRepo, runLogs],
  );

  const deleteBranchMutation = useMutation({
    mutationFn: async (branchName: string) => {
      return apiRequest(
        "DELETE",
        `/api/devops/repos/${selectedRepo!.full_name}/branches/${branchName}`,
      );
    },
    onSuccess: (_data, branchName) => {
      toast({ title: "Branche supprimee", description: branchName });
      queryClient.invalidateQueries({
        queryKey: ["/api/devops/repos", selectedRepo?.full_name, "branches"],
      });
    },
    onError: (err: any) => {
      toast({
        title: "Erreur",
        description: err.message || "Impossible de supprimer la branche",
        variant: "destructive",
      });
    },
  });

  const createRepoMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/devops/repos", {
        name: newRepoName,
        description: newRepoDesc,
        isPrivate: newRepoPrivate,
        templateId: newRepoTemplate,
      });
    },
    onSuccess: () => {
      toast({ title: "Projet cree !", description: newRepoName });
      setNewRepoOpen(false);
      setNewRepoName("");
      setNewRepoDesc("");
      setNewRepoPrivate(false);
      setNewRepoTemplate("portfolio");
      queryClient.invalidateQueries({ queryKey: ["/api/devops/repos"] });
    },
    onError: (err: any) => {
      toast({
        title: "Erreur",
        description: err.message || "Impossible de creer le projet",
        variant: "destructive",
      });
    },
  });

  const createBranchMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(
        "POST",
        `/api/devops/repos/${selectedRepo!.full_name}/branches`,
        {
          branchName: newBranchName,
          fromBranch: newBranchFrom,
        },
      );
    },
    onSuccess: () => {
      toast({
        title: "Branche creee",
        description: `${newBranchName} depuis ${newBranchFrom}`,
      });
      setNewBranchOpen(false);
      setNewBranchName("");
      queryClient.invalidateQueries({
        queryKey: ["/api/devops/repos", selectedRepo?.full_name, "branches"],
      });
    },
    onError: (err: any) => {
      toast({
        title: "Erreur",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const createPrMutation = useMutation({
    mutationFn: async () => {
      return apiRequest(
        "POST",
        `/api/devops/repos/${selectedRepo!.full_name}/pulls`,
        {
          title: prTitle,
          body: prBody,
          head: prHead,
          base: prBase,
        },
      );
    },
    onSuccess: () => {
      toast({ title: "PR creee" });
      setNewPrOpen(false);
      setPrTitle("");
      setPrBody("");
      setPrHead("");
      queryClient.invalidateQueries({
        queryKey: ["/api/devops/repos", selectedRepo?.full_name, "pulls"],
      });
    },
    onError: (err: any) => {
      toast({
        title: "Erreur",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const applyPatchMutation = useMutation({
    mutationFn: async () => {
      let files;
      try {
        files = JSON.parse(patchFiles);
      } catch {
        throw new Error("JSON invalide pour les fichiers");
      }
      return apiRequest(
        "POST",
        `/api/devops/repos/${selectedRepo!.full_name}/patch`,
        {
          branch: patchBranch,
          files,
          commitMessage: patchMessage,
        },
      );
    },
    onSuccess: () => {
      toast({ title: "Patch applique" });
      setPatchOpen(false);
      setPatchBranch("");
      setPatchMessage("");
      setPatchFiles("[]");
      queryClient.invalidateQueries({
        queryKey: ["/api/devops/repos", selectedRepo?.full_name, "commits"],
      });
    },
    onError: (err: any) => {
      toast({
        title: "Erreur",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const mergePrMutation = useMutation({
    mutationFn: async (prNumber: number) => {
      return apiRequest(
        "PUT",
        `/api/devops/repos/${selectedRepo!.full_name}/pulls/${prNumber}/merge`,
        {
          merge_method: "squash",
        },
      );
    },
    onSuccess: () => {
      toast({ title: "PR mergee" });
      queryClient.invalidateQueries({
        queryKey: ["/api/devops/repos", selectedRepo?.full_name, "pulls"],
      });
    },
    onError: (err: any) => {
      toast({
        title: "Erreur merge",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const { data: rollbackCommits, isLoading: rollbackCommitsLoading } = useQuery<Commit[]>({
    queryKey: ["/api/devops/repos", selectedRepo?.full_name, "commits", "rollback", rollbackBranch],
    queryFn: async () => {
      const res = await fetch(
        `/api/devops/repos/${selectedRepo!.full_name}/commits?per_page=50&sha=${rollbackBranch}`,
        { credentials: "include" },
      );
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: !!selectedRepo && !!rollbackBranch,
    staleTime: 15000,
  });

  const rollbackMutation = useMutation({
    mutationFn: async ({ targetSha, createBackup }: { targetSha: string; createBackup: boolean }) => {
      return apiRequest(
        "POST",
        `/api/devops/repos/${selectedRepo!.full_name}/rollback`,
        { branch: rollbackBranch, targetSha, createBackup },
      );
    },
    onSuccess: async (res: any) => {
      const data = await res.json();
      setRollbackConfirmSha(null);
      toast({
        title: "Rollback effectue",
        description: `${rollbackBranch} → ${data.rolledBackTo?.slice(0, 7)}${data.backupBranch ? ` (backup: ${data.backupBranch})` : ""}`,
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/devops/repos", selectedRepo?.full_name, "commits"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/devops/repos", selectedRepo?.full_name, "branches"],
      });
    },
    onError: (err: any) => {
      toast({
        title: "Echec du rollback",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const filteredRepos = useMemo(() => {
    return repos?.filter(
      (r) =>
        r.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        r.description?.toLowerCase().includes(debouncedSearch.toLowerCase()),
    );
  }, [repos, debouncedSearch]);

  const filteredTreeItems = useMemo(() => {
    if (!fileTree?.tree || !fileSearchQuery.trim()) return null;
    const q = fileSearchQuery.toLowerCase();
    return fileTree.tree
      .filter((f) => f.type === "blob" && f.path.toLowerCase().includes(q))
      .slice(0, 50);
  }, [fileTree, fileSearchQuery]);

  const tabBadges = useMemo(() => {
    const openPrs =
      pullRequests?.filter((pr) => pr.state === "open").length || 0;
    const activeRuns =
      workflowRuns?.workflow_runs?.filter(
        (r: WorkflowRun) => r.status === "in_progress" || r.status === "queued",
      ).length || 0;
    const failedRuns =
      workflowRuns?.workflow_runs
        ?.filter((r: WorkflowRun) => r.conclusion === "failure")
        .slice(0, 5).length || 0;
    return {
      branches: branches?.length || 0,
      commits: commits?.length || 0,
      prs: openPrs,
      cicd: activeRuns > 0 ? activeRuns : failedRuns > 0 ? failedRuns : 0,
      cicdColor:
        activeRuns > 0 ? "bg-blue-500" : failedRuns > 0 ? "bg-red-500" : "",
      library: fileTree?.tree?.filter((f) => f.type === "blob").length || 0,
    };
  }, [branches, commits, pullRequests, workflowRuns, fileTree]);

  if (selectedRepo) {
    return (
      <div
        className="min-h-screen bg-background p-3 md:p-4 max-w-6xl mx-auto"
        data-testid="devops-repo-detail"
      >
        <div className="flex items-center gap-2 mb-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => navigate("/")}
            data-testid="button-home-dashboard"
          >
            <Home className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              setSelectedRepo(null);
              setCurrentPath("");
              setSelectedFile(null);
              setPreviewHtml("");
              setCommitPage(1);
              fileContentCache.current.clear();
            }}
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <FolderGit2 className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold">{selectedRepo.name}</h1>
          <span className="text-xs text-muted-foreground">
            {selectedRepo.full_name.split("/")[0]}
          </span>
          <Badge
            variant={selectedRepo.private ? "secondary" : "outline"}
            className="text-[10px] h-5"
          >
            {selectedRepo.private ? "Prive" : "Public"}
          </Badge>
          {repos && repos.length > 1 && (
            <QuickRepoSwitcher
              repos={repos}
              currentRepo={selectedRepo}
              onSwitch={switchRepo}
            />
          )}
          <a
            href={selectedRepo.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1"
          >
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
          </a>
          <div className="ml-auto flex items-center gap-2">
            {(() => {
              const repoName = selectedRepo.name.toLowerCase();
              const isUlysseProject = repoName === "ulysseproject";
              const hetznerApp = hetznerAppMap.get(repoName) || (isUlysseProject ? hetznerAppMap.get("ulysse") : null);
              const allUrls = [
                ...new Set([
                  ...(deployUrls?.[selectedRepo.full_name] || []),
                  ...(selectedRepo.homepage ? [selectedRepo.homepage] : []),
                ]),
              ].filter(
                (u) => !u.includes(".replit.app") && !u.includes(".replit.dev") && !u.includes("github.io"),
              );

              return (
                <>
                  {isUlysseProject && (
                    <Button
                      size="sm"
                      variant="default"
                      className="gap-1.5 h-8"
                      onClick={deployToHetzner}
                      disabled={hetznerDeploying}
                      data-testid="button-deploy-hetzner"
                    >
                      {hetznerDeploying ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Rocket className="w-3.5 h-3.5" />
                      )}
                      Deploy Hetzner
                    </Button>
                  )}
                  {!isUlysseProject && hetznerApp && (
                    <Button
                      size="sm"
                      variant="default"
                      className="gap-1.5 h-8"
                      onClick={async () => {
                        setHetznerDeploying(true);
                        setHetznerDeployLog(`Deploiement ${repoName} sur Hetzner...`);
                        try {
                          const res = await fetch("/api/devops/server/deploy-repo", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ appName: repoName }),
                          });
                          const data = await res.json();
                          setHetznerDeployLog(data.output || data.error || "Done");
                          toast({
                            title: data.success ? "Deploiement reussi" : "Erreur",
                            description: data.success ? `${repoName} mis a jour sur Hetzner` : data.error,
                            variant: data.success ? "default" : "destructive",
                          });
                          queryClient.invalidateQueries({ queryKey: ["/api/devops/server/deployments"] });
                        } catch (err: any) {
                          setHetznerDeployLog(err.message);
                          toast({ title: "Erreur", description: err.message, variant: "destructive" });
                        }
                        setHetznerDeploying(false);
                      }}
                      disabled={hetznerDeploying}
                      data-testid="button-deploy-hetzner-repo"
                    >
                      {hetznerDeploying ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Rocket className="w-3.5 h-3.5" />
                      )}
                      Deploy Hetzner
                    </Button>
                  )}
                  {hetznerApp && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 h-8"
                      onClick={async () => {
                        setHetznerDeploying(true);
                        setHetznerDeployLog(`Push du code ${repoName} vers GitHub...`);
                        try {
                          const appNameForPush = isUlysseProject ? "ulysse" : repoName;
                          const res = await fetch("/api/devops/server/push-code", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ appName: appNameForPush, message: `Update ${repoName} from Ulysse DevOps` }),
                          });
                          const data = await res.json();
                          setHetznerDeployLog(data.output || data.error || "Done");
                          toast({
                            title: data.success ? "Push reussi" : "Erreur",
                            description: data.success ? `Code pousse sur GitHub` : data.error,
                            variant: data.success ? "default" : "destructive",
                          });
                        } catch (err: any) {
                          setHetznerDeployLog(err.message);
                          toast({ title: "Erreur", description: err.message, variant: "destructive" });
                        }
                        setHetznerDeploying(false);
                      }}
                      disabled={hetznerDeploying}
                      data-testid="button-push-code"
                    >
                      {hetznerDeploying ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Upload className="w-3.5 h-3.5" />
                      )}
                      Push Code
                    </Button>
                  )}
                  {allUrls.map((url: string, i: number) => (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 h-8 text-xs"
                        data-testid={`button-open-live-${i}`}
                      >
                        <Globe className="w-3.5 h-3.5" />{" "}
                        {(() => {
                          try {
                            return new URL(url).hostname;
                          } catch {
                            return "Live";
                          }
                        })()}
                      </Button>
                    </a>
                  ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={() => {
                      setUrlsEdit(deployUrls?.[selectedRepo.full_name] || []);
                      setUrlsNewInput("");
                      setUrlsOpen(true);
                    }}
                    data-testid="button-manage-urls"
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </Button>
                  <Dialog open={urlsOpen} onOpenChange={setUrlsOpen}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>URLs de deploiement</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-3">
                        {urlsEdit.map((url, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <Input
                              value={url}
                              onChange={(e) => {
                                const next = [...urlsEdit];
                                next[i] = e.target.value;
                                setUrlsEdit(next);
                              }}
                              className="text-xs h-8 font-mono"
                              data-testid={`input-url-${i}`}
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive shrink-0"
                              onClick={() =>
                                setUrlsEdit(urlsEdit.filter((_, j) => j !== i))
                              }
                              data-testid={`button-remove-url-${i}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        ))}
                        <div className="flex items-center gap-2">
                          <Input
                            placeholder="https://example.com"
                            value={urlsNewInput}
                            onChange={(e) => setUrlsNewInput(e.target.value)}
                            className="text-xs h-8 font-mono"
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && urlsNewInput.trim()) {
                                setUrlsEdit([...urlsEdit, urlsNewInput.trim()]);
                                setUrlsNewInput("");
                              }
                            }}
                            data-testid="input-url-new"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 shrink-0"
                            disabled={!urlsNewInput.trim()}
                            onClick={() => {
                              if (urlsNewInput.trim()) {
                                setUrlsEdit([...urlsEdit, urlsNewInput.trim()]);
                                setUrlsNewInput("");
                              }
                            }}
                            data-testid="button-add-url"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                        <Button
                          className="w-full"
                          onClick={async () => {
                            try {
                              const filtered = urlsEdit.filter((u) => u.trim());
                              await apiRequest(
                                "PUT",
                                `/api/devops/deploy-urls/${selectedRepo.full_name}`,
                                { urls: filtered },
                              );
                              queryClient.invalidateQueries({
                                queryKey: ["/api/devops/deploy-urls"],
                              });
                              toast({ title: "URLs mises a jour" });
                              setUrlsOpen(false);
                            } catch {
                              toast({
                                title: "Erreur",
                                variant: "destructive",
                              });
                            }
                          }}
                          data-testid="button-save-urls"
                        >
                          <Save className="w-3.5 h-3.5 mr-1.5" /> Enregistrer
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </>
              );
            })()}
          </div>
        </div>
        {hetznerDeployLog && (
          <div className="mb-3">
            <div className="bg-black/90 text-green-400 rounded-lg p-2.5 text-[11px] font-mono max-h-32 overflow-auto whitespace-pre-wrap flex items-start justify-between gap-2">
              <span>{hetznerDeployLog}</span>
              <button
                onClick={() => setHetznerDeployLog(null)}
                className="text-zinc-500 hover:text-zinc-300 shrink-0 mt-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <Dialog open={newBranchOpen} onOpenChange={setNewBranchOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                data-testid="button-new-branch"
              >
                <Plus className="w-3 h-3 mr-1" /> Branche
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nouvelle branche</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Input
                  placeholder="feature/ma-feature"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  data-testid="input-branch-name"
                />
                <Input
                  placeholder="Depuis (ex: main)"
                  value={newBranchFrom}
                  onChange={(e) => setNewBranchFrom(e.target.value)}
                  data-testid="input-branch-from"
                />
                <Button
                  onClick={() => createBranchMutation.mutate()}
                  disabled={createBranchMutation.isPending || !newBranchName}
                  data-testid="button-create-branch"
                >
                  {createBranchMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1" />
                  ) : null}
                  Creer
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={newPrOpen} onOpenChange={setNewPrOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                data-testid="button-new-pr"
              >
                <GitPullRequest className="w-3 h-3 mr-1" /> PR
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nouvelle Pull Request</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Input
                  placeholder="Titre"
                  value={prTitle}
                  onChange={(e) => setPrTitle(e.target.value)}
                  data-testid="input-pr-title"
                />
                <Textarea
                  placeholder="Description"
                  value={prBody}
                  onChange={(e) => setPrBody(e.target.value)}
                  data-testid="input-pr-body"
                />
                <div className="flex gap-2 items-center">
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground mb-1 block">
                      Depuis
                    </label>
                    <Select value={prHead} onValueChange={setPrHead}>
                      <SelectTrigger data-testid="select-pr-head">
                        <SelectValue placeholder="Source" />
                      </SelectTrigger>
                      <SelectContent>
                        {branches
                          ?.filter((b: Branch) => b.name !== prBase)
                          .map((b: Branch) => (
                            <SelectItem key={b.name} value={b.name}>
                              {b.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <span className="self-end pb-2 text-muted-foreground">→</span>
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground mb-1 block">
                      Vers
                    </label>
                    <Select value={prBase} onValueChange={setPrBase}>
                      <SelectTrigger data-testid="select-pr-base">
                        <SelectValue placeholder="Cible" />
                      </SelectTrigger>
                      <SelectContent>
                        {branches
                          ?.filter((b: Branch) => b.name !== prHead)
                          .map((b: Branch) => (
                            <SelectItem key={b.name} value={b.name}>
                              {b.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button
                  onClick={() => createPrMutation.mutate()}
                  disabled={createPrMutation.isPending || !prTitle || !prHead}
                  className="w-full"
                  data-testid="button-create-pr"
                >
                  {createPrMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1" />
                  ) : null}
                  Creer
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={patchOpen} onOpenChange={setPatchOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                data-testid="button-apply-patch"
              >
                <Code className="w-3 h-3 mr-1" /> Patch
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Appliquer un patch</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Input
                  placeholder="Branche cible"
                  value={patchBranch}
                  onChange={(e) => setPatchBranch(e.target.value)}
                  data-testid="input-patch-branch"
                />
                <Input
                  placeholder="Message de commit"
                  value={patchMessage}
                  onChange={(e) => setPatchMessage(e.target.value)}
                  data-testid="input-patch-message"
                />
                <Textarea
                  placeholder={
                    '[\n  { "path": "src/index.ts", "content": "console.log(\'hello\');" }\n]'
                  }
                  value={patchFiles}
                  onChange={(e) => setPatchFiles(e.target.value)}
                  className="font-mono text-xs min-h-[120px]"
                  data-testid="input-patch-files"
                />
                <Button
                  onClick={() => applyPatchMutation.mutate()}
                  disabled={
                    applyPatchMutation.isPending ||
                    !patchBranch ||
                    !patchMessage
                  }
                  data-testid="button-submit-patch"
                >
                  {applyPatchMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1" />
                  ) : null}
                  Appliquer
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <div className="ml-auto text-[10px] text-muted-foreground/40 hidden md:flex items-center gap-1">
            <Command className="w-3 h-3" /> 1-8 onglets · Esc retour
          </div>
        </div>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-9" data-testid="tabs-repo-detail">
            <TabsTrigger value="projects" className="text-xs gap-1 px-2.5">
              <FolderGit2 className="w-3.5 h-3.5" /> Projets
            </TabsTrigger>
            <TabsTrigger value="branches" className="text-xs gap-1 px-2.5">
              <GitBranch className="w-3.5 h-3.5" /> Branches
              {tabBadges.branches > 0 && (
                <span className="ml-0.5 text-[10px] text-muted-foreground">
                  {tabBadges.branches}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="commits" className="text-xs gap-1 px-2.5">
              <GitCommit className="w-3.5 h-3.5" /> Commits
            </TabsTrigger>
            <TabsTrigger value="prs" className="text-xs gap-1 px-2.5">
              <GitPullRequest className="w-3.5 h-3.5" /> PRs
              {tabBadges.prs > 0 && (
                <span className="ml-0.5 bg-green-500 text-white text-[9px] rounded-full w-4 h-4 inline-flex items-center justify-center">
                  {tabBadges.prs}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="cicd" className="text-xs gap-1 px-2.5">
              <Activity className="w-3.5 h-3.5" /> CI/CD
              {tabBadges.cicd > 0 && (
                <span
                  className={cn(
                    "ml-0.5 text-white text-[9px] rounded-full w-4 h-4 inline-flex items-center justify-center",
                    tabBadges.cicdColor,
                  )}
                >
                  {tabBadges.cicd}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="library" className="text-xs gap-1 px-2.5">
              <FileCode className="w-3.5 h-3.5" /> Librairie
            </TabsTrigger>
            <TabsTrigger
              value="library-test"
              className="text-xs gap-1 px-2.5"
            >
              <FlaskConical className="w-3.5 h-3.5" /> Librairie-Test
              {hasStagingBranch && <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />}
            </TabsTrigger>
            <TabsTrigger
              value="preview"
              className="text-xs gap-1 px-2.5"
              onClick={() => {
                if (!previewHtml && !previewLoading) buildPreview();
              }}
            >
              <Globe className="w-3.5 h-3.5" /> Apercu
            </TabsTrigger>
            <TabsTrigger value="server" className="text-xs gap-1 px-2.5">
              <Server className="w-3.5 h-3.5" /> Serveur
            </TabsTrigger>
            <TabsTrigger
              value="rollback"
              className="text-xs gap-1 px-2.5"
              onClick={() => {
                if (!rollbackBranch && selectedRepo) {
                  setRollbackBranch(selectedRepo.default_branch);
                }
              }}
            >
              <RotateCcw className="w-3.5 h-3.5" /> Rollback
            </TabsTrigger>
            <TabsTrigger
              value="dgm"
              className={cn("text-xs gap-1 px-2.5", dgmActive && "text-amber-600")}
            >
              <Crown className={cn("w-3.5 h-3.5", dgmActive ? "text-amber-500" : "")} /> DGM
              {dgmActive && <span className="ml-0.5 w-2 h-2 rounded-full bg-amber-500 inline-block animate-pulse" />}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="projects" className="mt-3">
            {(() => {
              if (!repos?.length) return <p className="text-muted-foreground text-sm py-4">Chargement des projets...</p>;

              const projectRepos = repos.map(repo => {
                const hApp = hetznerAppMap.get(repo.name.toLowerCase());
                const allUrls = deployUrls?.[repo.full_name] || [];
                const ulysseProUrls = allUrls.filter(u => u.includes(".ulyssepro.org"));
                const hetznerDomain = hApp?.domain;
                if (hetznerDomain && !ulysseProUrls.some(u => u.includes(hetznerDomain))) {
                  ulysseProUrls.unshift(`https://${hetznerDomain}`);
                }
                const liveUrls = [...new Set(ulysseProUrls)];
                const isLive = hApp && (hApp.status === "online" || hApp.status === "static" || hApp.status === "deployed");
                const isCurrentRepo = selectedRepo?.full_name === repo.full_name;

                return { repo, hApp, liveUrls, isLive, isCurrentRepo, allUrls };
              });

              const deployed = projectRepos.filter(p => p.hApp || p.liveUrls.length > 0);
              const active = projectRepos.filter(p => !p.hApp && p.liveUrls.length === 0 && !p.repo.private);
              const privateRepos = projectRepos.filter(p => !p.hApp && p.liveUrls.length === 0 && p.repo.private);

              const renderProjectCard = (p: typeof projectRepos[0]) => {
                const { repo, hApp, liveUrls, isLive, isCurrentRepo } = p;
                const daysSinceUpdate = Math.floor((Date.now() - new Date(repo.pushed_at || repo.updated_at).getTime()) / 86400000);
                const activityLevel = daysSinceUpdate < 1 ? "Tres actif" : daysSinceUpdate < 7 ? "Actif" : daysSinceUpdate < 30 ? "Modere" : "Inactif";
                const activityColor = daysSinceUpdate < 1 ? "text-green-500" : daysSinceUpdate < 7 ? "text-blue-500" : daysSinceUpdate < 30 ? "text-yellow-500" : "text-gray-400";

                return (
                  <Card
                    key={repo.full_name}
                    className={cn(
                      "p-3 cursor-pointer hover:shadow-md transition-all border",
                      isCurrentRepo && "ring-2 ring-primary/50 border-primary/30",
                    )}
                    onClick={() => selectRepo(repo)}
                    data-testid={`project-card-${repo.name}`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <FolderGit2 className={cn("w-4 h-4 shrink-0", isLive ? "text-green-500" : "text-muted-foreground")} />
                        <div className="min-w-0">
                          <h4 className="text-sm font-semibold truncate">{repo.name}</h4>
                          {repo.description && (
                            <p className="text-[11px] text-muted-foreground truncate">{repo.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isLive && (
                          <Badge className="text-[9px] h-4 bg-green-500/10 text-green-600 border-green-500/30">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1 animate-pulse" />
                            En ligne
                          </Badge>
                        )}
                        {repo.private && (
                          <Badge variant="outline" className="text-[9px] h-4">Prive</Badge>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2">
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <div className={cn("w-2 h-2 rounded-full", langColor(repo.language))} />
                        <span className="text-muted-foreground">{repo.language || "N/A"}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <Activity className={cn("w-3 h-3", activityColor)} />
                        <span className={activityColor}>{activityLevel}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        <span>{timeAgo(repo.pushed_at || repo.updated_at)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Star className="w-3 h-3" />
                        <span>{repo.stargazers_count}</span>
                        <GitFork className="w-3 h-3 ml-1" />
                        <span>{repo.forks_count}</span>
                      </div>
                    </div>

                    {hApp && (
                      <div className="mt-2 pt-2 border-t flex items-center gap-2 text-[11px]">
                        <Server className="w-3 h-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Hetzner</span>
                        <Badge variant="outline" className="text-[8px] h-3.5 px-1">
                          {hApp.type === "static" ? "HTML" : "Node"}
                        </Badge>
                        <span className="text-muted-foreground">Port {hApp.port}</span>
                        {hApp.memory && (
                          <span className="text-muted-foreground ml-auto">{hApp.memory}</span>
                        )}
                      </div>
                    )}

                    {liveUrls.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {liveUrls.slice(0, 2).map((url, i) => {
                          let hostname = "";
                          try { hostname = new URL(url).hostname; } catch { hostname = url; }
                          return (
                            <a
                              key={i}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-primary hover:underline flex items-center gap-1"
                              onClick={(e) => e.stopPropagation()}
                              data-testid={`project-url-${repo.name}-${i}`}
                            >
                              <Globe className="w-2.5 h-2.5" />
                              {hostname}
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </Card>
                );
              };

              return (
                <div className="space-y-4" data-testid="projects-tab">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h3 className="text-sm font-semibold">Projets DevOps</h3>
                      <Badge variant="outline" className="text-[10px]">{repos.length} repos</Badge>
                      {deployed.length > 0 && (
                        <Badge className="text-[10px] bg-green-500/10 text-green-600 border-green-500/30">
                          {deployed.length} deploye{deployed.length > 1 ? "s" : ""}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {deployed.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Rocket className="w-3.5 h-3.5 text-green-500" />
                        <span className="text-xs font-medium">Deployes ({deployed.length})</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {deployed.map(renderProjectCard)}
                      </div>
                    </div>
                  )}

                  {active.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Code className="w-3.5 h-3.5 text-blue-500" />
                        <span className="text-xs font-medium">En developpement ({active.length})</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {active.map(renderProjectCard)}
                      </div>
                    </div>
                  )}

                  {privateRepos.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium">Prives ({privateRepos.length})</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {privateRepos.map(renderProjectCard)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </TabsContent>

          <TabsContent value="branches" className="mt-3">
            <div className="space-y-1.5">
              {branches?.map((b: Branch) => (
                <Card key={b.name} className="p-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <GitBranch className="w-3.5 h-3.5 text-muted-foreground" />
                      <span
                        className="font-mono text-sm"
                        data-testid={`text-branch-${b.name}`}
                      >
                        {b.name}
                      </span>
                      {b.protected && (
                        <Badge variant="secondary" className="text-[10px] h-4">
                          protegee
                        </Badge>
                      )}
                      {b.name === selectedRepo.default_branch && (
                        <Badge variant="outline" className="text-[10px] h-4">
                          default
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="text-[11px] text-muted-foreground">
                        {b.commit.sha.slice(0, 7)}
                      </code>
                      {b.name !== selectedRepo.default_branch &&
                        !b.protected && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                            onClick={() => {
                              if (confirm(`Supprimer ${b.name} ?`))
                                deleteBranchMutation.mutate(b.name);
                            }}
                            disabled={deleteBranchMutation.isPending}
                            data-testid={`button-delete-branch-${b.name}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        )}
                    </div>
                  </div>
                </Card>
              ))}
              {!branches?.length && (
                <p className="text-muted-foreground text-sm">Aucune branche</p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="commits" className="mt-3">
            {commitDiff ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={() => setCommitDiff(null)}
                    data-testid="button-back-commits"
                  >
                    <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Retour
                  </Button>
                  <code className="text-[11px] text-muted-foreground font-mono">
                    {commitDiff.sha.slice(0, 7)}
                  </code>
                  <span className="text-sm font-medium truncate">
                    {commitDiff.message.split("\n")[0]}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {commitDiff.files.length} fichier
                  {commitDiff.files.length > 1 ? "s" : ""}
                </div>
                {commitDiff.files.map((f: any, i: number) => (
                  <Card key={i} className="overflow-hidden">
                    <div className="flex items-center gap-2 px-2.5 py-1.5 bg-muted/40 border-b">
                      <span
                        className={cn(
                          "text-[10px] font-bold px-1 py-0.5 rounded",
                          f.status === "added"
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : f.status === "removed"
                              ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                              : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                        )}
                      >
                        {f.status === "added"
                          ? "A"
                          : f.status === "removed"
                            ? "D"
                            : "M"}
                      </span>
                      <span className="font-mono text-xs truncate">
                        {f.filename}
                      </span>
                      <span className="ml-auto flex items-center gap-1 text-[10px] shrink-0">
                        {f.additions > 0 && (
                          <span className="text-green-600 dark:text-green-400">
                            +{f.additions}
                          </span>
                        )}
                        {f.deletions > 0 && (
                          <span className="text-red-600 dark:text-red-400">
                            -{f.deletions}
                          </span>
                        )}
                      </span>
                    </div>
                    {f.patch && (
                      <pre className="text-[11px] font-mono overflow-x-auto max-h-[300px] overflow-y-auto p-0 m-0">
                        {f.patch.split("\n").map((line: string, li: number) => (
                          <div
                            key={li}
                            className={cn(
                              "px-2.5 py-0.5",
                              line.startsWith("+") && !line.startsWith("+++")
                                ? "bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300"
                                : line.startsWith("-") &&
                                    !line.startsWith("---")
                                  ? "bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300"
                                  : line.startsWith("@@")
                                    ? "bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400"
                                    : "text-muted-foreground",
                            )}
                          >
                            {line}
                          </div>
                        ))}
                      </pre>
                    )}
                  </Card>
                ))}
              </div>
            ) : (
              <div className="space-y-1.5">
                {diffLoading && (
                  <div className="flex items-center gap-2 py-3 text-muted-foreground text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" /> Chargement du
                    diff...
                  </div>
                )}
                {commits?.map((c: Commit) => (
                  <Card
                    key={c.sha}
                    className="p-2.5 cursor-pointer hover:border-primary/40 transition-colors"
                    onClick={() => loadCommitDiff(c.sha)}
                    data-testid={`card-commit-${c.sha.slice(0, 7)}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-sm truncate"
                          data-testid={`text-commit-${c.sha.slice(0, 7)}`}
                        >
                          {c.commit.message.split("\n")[0]}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {c.commit.author.name} ·{" "}
                          {timeAgo(c.commit.author.date)}
                        </p>
                      </div>
                      <code className="text-[11px] text-muted-foreground font-mono shrink-0">
                        {c.sha.slice(0, 7)}
                      </code>
                    </div>
                  </Card>
                ))}
                {!commitsLoading &&
                  commits &&
                  commits.length >= commitPage * 20 && (
                    <Button
                      variant="ghost"
                      className="w-full text-xs h-8"
                      onClick={() => setCommitPage((p) => p + 1)}
                      data-testid="button-load-more-commits"
                    >
                      Plus de commits
                    </Button>
                  )}
                {commitsLoading && (
                  <div className="flex items-center gap-2 py-3 text-muted-foreground text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" /> Chargement...
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="prs" className="mt-3">
            <div className="space-y-1.5">
              {pullRequests?.map((pr: PullRequest) => (
                <Card key={pr.number} className="p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <GitPullRequest
                        className={cn(
                          "w-3.5 h-3.5 shrink-0",
                          pr.state === "open"
                            ? "text-green-500"
                            : pr.merged_at
                              ? "text-purple-500"
                              : "text-red-500",
                        )}
                      />
                      <div className="min-w-0">
                        <p
                          className="text-sm truncate"
                          data-testid={`text-pr-${pr.number}`}
                        >
                          #{pr.number} {pr.title}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {pr.head.ref} → {pr.base.ref} ·{" "}
                          {timeAgo(pr.created_at)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge
                        variant={pr.state === "open" ? "default" : "secondary"}
                        className="text-[10px] h-5"
                      >
                        {pr.merged_at ? "merged" : pr.state}
                      </Badge>
                      {pr.state === "open" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[11px] px-2"
                          onClick={() => mergePrMutation.mutate(pr.number)}
                          disabled={mergePrMutation.isPending}
                          data-testid={`button-merge-pr-${pr.number}`}
                        >
                          Merge
                        </Button>
                      )}
                      <a
                        href={pr.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="w-3 h-3 text-muted-foreground" />
                      </a>
                    </div>
                  </div>
                </Card>
              ))}
              {!pullRequests?.length && (
                <p className="text-muted-foreground text-sm">Aucune PR</p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="cicd" className="mt-3">
            {runLogs ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={() => setRunLogs(null)}
                    data-testid="button-back-cicd"
                  >
                    <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Retour
                  </Button>
                  <span className="text-sm font-medium">
                    Run #{runLogs.runId}
                  </span>
                </div>
                {runLogs.jobs.map((job: any) => (
                  <Card
                    key={job.id}
                    className="overflow-hidden"
                    data-testid={`card-job-${job.id}`}
                  >
                    <div
                      className="flex items-center justify-between gap-2 px-2.5 py-2 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => {
                        if (runLogs.logs[job.id]) {
                          setRunLogs((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  expandedJob:
                                    prev.expandedJob === job.id ? null : job.id,
                                }
                              : prev,
                          );
                        } else {
                          loadJobLogs(job.id);
                        }
                      }}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {job.conclusion === "success" ? (
                          <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                        ) : job.conclusion === "failure" ? (
                          <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                        ) : job.status === "in_progress" ? (
                          <Loader2 className="w-3.5 h-3.5 text-yellow-500 animate-spin shrink-0" />
                        ) : (
                          <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm truncate">{job.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {job.conclusion || job.status}
                            {job.steps && ` · ${job.steps.length} etapes`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {runLogs.logsLoading[job.id] && (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                        )}
                        {runLogs.expandedJob === job.id ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </div>
                    </div>
                    {job.steps && job.steps.length > 0 && (
                      <div className="border-t px-2.5 py-1.5 bg-muted/20">
                        {job.steps.map((step: any, si: number) => (
                          <div
                            key={si}
                            className="flex items-center gap-1.5 py-0.5 text-[11px]"
                          >
                            {step.conclusion === "success" ? (
                              <CheckCircle className="w-2.5 h-2.5 text-green-500" />
                            ) : step.conclusion === "failure" ? (
                              <XCircle className="w-2.5 h-2.5 text-red-500" />
                            ) : step.conclusion === "skipped" ? (
                              <Minus className="w-2.5 h-2.5 text-muted-foreground" />
                            ) : (
                              <Clock className="w-2.5 h-2.5 text-muted-foreground" />
                            )}
                            <span className="text-muted-foreground">
                              {step.name}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {runLogs.expandedJob === job.id && runLogs.logs[job.id] && (
                      <div className="border-t">
                        <pre
                          className="text-[11px] font-mono p-2.5 overflow-x-auto max-h-[350px] overflow-y-auto bg-zinc-950 text-zinc-300"
                          data-testid={`logs-job-${job.id}`}
                        >
                          {runLogs.logs[job.id]}
                        </pre>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            ) : (
              <div className="space-y-1.5">
                {runsLoading && (
                  <div className="flex items-center gap-2 text-muted-foreground py-3 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" /> Chargement...
                  </div>
                )}
                {runLogsLoading && (
                  <div className="flex items-center gap-2 text-muted-foreground py-3 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" /> Jobs...
                  </div>
                )}
                {workflowRuns?.workflow_runs?.some(
                  (r: WorkflowRun) =>
                    r.status === "in_progress" || r.status === "queued",
                ) && (
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[11px] text-blue-600 dark:text-blue-400">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Workflows en cours — auto-refresh 8s
                  </div>
                )}
                {workflowRuns?.workflow_runs?.map((run: WorkflowRun) => (
                  <Card
                    key={run.id}
                    className="p-2.5 cursor-pointer hover:border-primary/40 transition-colors"
                    onClick={() => loadRunJobs(run.id)}
                    data-testid={`card-run-${run.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {run.conclusion === "success" ? (
                          <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                        ) : run.conclusion === "failure" ? (
                          <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                        ) : run.status === "in_progress" ? (
                          <Loader2 className="w-3.5 h-3.5 text-yellow-500 animate-spin shrink-0" />
                        ) : (
                          <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm truncate">{run.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            #{run.run_number} · {run.head_branch} ·{" "}
                            {timeAgo(run.created_at)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Badge
                          variant={
                            run.conclusion === "success"
                              ? "default"
                              : run.conclusion === "failure"
                                ? "destructive"
                                : "secondary"
                          }
                          className="text-[10px] h-5"
                        >
                          {run.conclusion || run.status}
                        </Badge>
                        {run.conclusion === "failure" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await apiRequest(
                                  "POST",
                                  `/api/devops/repos/${selectedRepo!.full_name}/actions/runs/${run.id}/rerun`,
                                );
                                toast({ title: "Relance" });
                                queryClient.invalidateQueries({
                                  queryKey: [
                                    "/api/devops/repos",
                                    selectedRepo?.full_name,
                                    "actions/runs",
                                  ],
                                });
                              } catch {
                                toast({
                                  title: "Erreur",
                                  variant: "destructive",
                                });
                              }
                            }}
                            data-testid={`button-rerun-${run.id}`}
                          >
                            <RotateCcw className="w-3 h-3" />
                          </Button>
                        )}
                        {run.status === "in_progress" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await apiRequest(
                                  "POST",
                                  `/api/devops/repos/${selectedRepo!.full_name}/actions/runs/${run.id}/cancel`,
                                );
                                toast({ title: "Annule" });
                                queryClient.invalidateQueries({
                                  queryKey: [
                                    "/api/devops/repos",
                                    selectedRepo?.full_name,
                                    "actions/runs",
                                  ],
                                });
                              } catch {
                                toast({
                                  title: "Erreur",
                                  variant: "destructive",
                                });
                              }
                            }}
                            data-testid={`button-cancel-${run.id}`}
                          >
                            <StopCircle className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
                {!runsLoading && !workflowRuns?.workflow_runs?.length && (
                  <p className="text-muted-foreground text-sm">
                    Aucun workflow
                  </p>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="library" className="mt-3">
            {selectedFile ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7"
                      onClick={() => {
                        if (editMode && isFileModified) {
                          if (!confirm("Modifications non sauvegardees. Quitter quand meme ?")) return;
                        }
                        setSelectedFile(null);
                        setEditMode(false);
                        setEditCommitMsg("");
                        setIsFileModified(false);
                      }}
                      data-testid="button-back-library"
                    >
                      <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Retour
                    </Button>
                    <Badge variant="outline" className="text-[10px] h-4 border-green-400 text-green-600">
                      <Lock className="w-2.5 h-2.5 mr-0.5" /> prod · lecture seule
                    </Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {selectedFile.path}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="secondary" className="text-[9px] h-4">
                      {selectedRepo?.default_branch}
                    </Badge>
                  </div>
                </div>
                <Card className="p-0 overflow-hidden">
                  {selectedFile.isImage && selectedFile.rawBase64 ? (
                    <div
                      className="flex items-center justify-center p-4"
                      data-testid="image-file-preview"
                    >
                      <img
                        src={selectedFile.rawBase64}
                        alt={selectedFile.path}
                        className="max-w-full max-h-[450px] object-contain rounded"
                      />
                    </div>
                  ) : (
                    <div>
                      <div className="flex border-b bg-muted/30 px-2.5 py-1 items-center gap-2">
                        <Code className="w-3 h-3 text-muted-foreground" />
                        <span className="text-[11px] font-mono text-muted-foreground">
                          {selectedFile.path}
                        </span>
                        <Badge variant="outline" className="text-[9px] h-3.5 px-1">
                          {getSyntaxLang(selectedFile.path)}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {selectedFile.content.split("\n").length}L
                        </span>
                      </div>
                      <div className="flex max-h-[500px] overflow-y-auto">
                        <div className="select-none text-right pr-2 pl-2 pt-3 pb-3 bg-muted/20 border-r text-muted-foreground font-mono text-xs leading-[1.35rem] min-w-[2.5rem]" aria-hidden="true">
                          {selectedFile.content.split("\n").map((_, i) => (
                            <div key={i} className="text-[10px]">{i + 1}</div>
                          ))}
                        </div>
                        <pre
                          className="flex-1 text-xs font-mono whitespace-pre-wrap overflow-x-auto p-3 leading-[1.35rem]"
                          data-testid="text-file-content"
                        >
                          {selectedFile.content}
                        </pre>
                      </div>
                    </div>
                  )}
                </Card>
              </div>
            ) : (
              <div className="space-y-0.5">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-[11px] text-muted-foreground shrink-0 font-mono">
                      {currentPath ? `/${currentPath}` : "/"}
                    </span>
                    <div className="relative flex-1 max-w-[220px]">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                      <Input
                        placeholder="Rechercher..."
                        className="h-7 text-xs pl-7"
                        value={fileSearchQuery}
                        onChange={(e) => setFileSearchQuery(e.target.value)}
                        data-testid="input-search-library"
                      />
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] h-5 border-green-400 text-green-600 shrink-0">
                    <Lock className="w-2.5 h-2.5 mr-0.5" /> Prod · lecture seule
                  </Badge>
                </div>
                {treeLoading && (
                  <div className="flex items-center gap-2 text-muted-foreground py-3 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" /> Chargement...
                  </div>
                )}
                {fileLoading && (
                  <div className="flex items-center gap-2 text-muted-foreground py-3 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" /> Lecture...
                  </div>
                )}

                {filteredTreeItems ? (
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground mb-1">
                      {filteredTreeItems.length} resultat
                      {filteredTreeItems.length > 1 ? "s" : ""}
                    </p>
                    {filteredTreeItems.map((item) => (
                      <div
                        key={item.path}
                        className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted cursor-pointer text-sm group"
                        onClick={() => {
                          loadFileContent(item.path);
                          setFileSearchQuery("");
                        }}
                        data-testid={`search-result-${item.path.replace(/\//g, "-")}`}
                      >
                        <FileCode className={cn("w-3 h-3 shrink-0", getFileIcon(item.path.split("/").pop() || item.path))} />
                        <span className="font-mono text-xs truncate">
                          {item.path}
                        </span>
                        {item.size != null && (
                          <span className="text-[11px] text-muted-foreground ml-auto shrink-0">
                            {item.size > 1024
                              ? `${(item.size / 1024).toFixed(1)}K`
                              : `${item.size}B`}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    {currentPath && (
                      <>
                        <div
                          className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted cursor-pointer text-sm text-muted-foreground"
                          onClick={() => {
                            const parts = currentPath.split("/");
                            parts.pop();
                            setCurrentPath(parts.join("/"));
                          }}
                          data-testid="button-folder-up"
                        >
                          <ArrowLeft className="w-3 h-3" />
                          <span className="text-xs">.. (remonter)</span>
                        </div>
                        <div className="flex items-center gap-1 px-2 py-0.5 mb-0.5">
                          <span
                            className="text-[11px] text-primary cursor-pointer hover:underline"
                            onClick={() => setCurrentPath("")}
                          >
                            /
                          </span>
                          {currentPath.split("/").map((part, i, arr) => (
                            <span key={i} className="flex items-center gap-0.5">
                              <ChevronRight className="w-2.5 h-2.5 text-muted-foreground" />
                              <span
                                className={cn(
                                  "text-[11px]",
                                  i === arr.length - 1
                                    ? "font-medium"
                                    : "text-primary cursor-pointer hover:underline",
                                )}
                                onClick={() =>
                                  i < arr.length - 1 &&
                                  setCurrentPath(arr.slice(0, i + 1).join("/"))
                                }
                              >
                                {part}
                              </span>
                            </span>
                          ))}
                        </div>
                      </>
                    )}

                    {(() => {
                      if (!fileTree?.tree) return null;

                      const foldersInDir = new Set<string>();
                      const filesInDir: TreeItem[] = [];
                      const prefix = currentPath ? currentPath + "/" : "";

                      for (const item of fileTree.tree) {
                        if (!item.path.startsWith(prefix) && currentPath)
                          continue;
                        if (item.path === currentPath) continue;

                        const relativePath = currentPath
                          ? item.path.slice(prefix.length)
                          : item.path;
                        if (!relativePath) continue;

                        const slashIndex = relativePath.indexOf("/");
                        if (slashIndex !== -1) {
                          foldersInDir.add(
                            relativePath.substring(0, slashIndex),
                          );
                        } else if (item.type === "blob") {
                          filesInDir.push(item);
                        }
                      }

                      const sortedFolders = Array.from(foldersInDir).sort(
                        (a, b) => a.localeCompare(b),
                      );
                      const sortedFiles = filesInDir.sort((a, b) => {
                        const nameA = a.path.split("/").pop() || a.path;
                        const nameB = b.path.split("/").pop() || b.path;
                        return nameA.localeCompare(nameB);
                      });

                      return (
                        <>
                          {sortedFolders.map((folderName) => (
                            <div
                              key={folderName}
                              className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted cursor-pointer text-sm"
                              onClick={() =>
                                setCurrentPath(prefix + folderName)
                              }
                              data-testid={`folder-${folderName}`}
                            >
                              <Folder className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                              <span className="font-mono text-xs font-medium">
                                {folderName}
                              </span>
                              <ChevronRight className="w-3 h-3 text-muted-foreground ml-auto" />
                            </div>
                          ))}
                          {sortedFiles.map((item) => {
                            const fileName =
                              item.path.split("/").pop() || item.path;
                            return (
                              <div
                                key={item.path}
                                className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted cursor-pointer text-sm group"
                                onClick={() => loadFileContent(item.path)}
                                data-testid={`file-${item.path.replace(/\//g, "-")}`}
                              >
                                <FileCode className={cn("w-3.5 h-3.5 shrink-0", getFileIcon(fileName))} />
                                <span className="font-mono text-xs truncate group-hover:text-primary transition-colors">
                                  {fileName}
                                </span>
                                {item.size != null && (
                                  <span className="text-[11px] text-muted-foreground ml-auto shrink-0">
                                    {item.size > 1024
                                      ? `${(item.size / 1024).toFixed(1)}K`
                                      : `${item.size}B`}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                          {sortedFolders.length === 0 &&
                            sortedFiles.length === 0 &&
                            !treeLoading && (
                              <p className="text-muted-foreground text-sm py-2">
                                Dossier vide
                              </p>
                            )}
                        </>
                      );
                    })()}
                  </>
                )}

                {!treeLoading && !fileTree?.tree?.length && (
                  <p className="text-muted-foreground text-sm">Aucun fichier</p>
                )}
                {fileTree?.truncated && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Arborescence tronquee
                  </p>
                )}
              </div>
            )}

            <Dialog open={showNewFileDialog} onOpenChange={setShowNewFileDialog}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-base">
                    <FilePlus className="w-4 h-4" />
                    Nouveau fichier
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      Chemin du fichier {currentPath && <span className="font-mono">({currentPath}/)</span>}
                    </label>
                    <Input
                      placeholder="ex: script.js, components/Header.tsx, styles/main.css"
                      value={newFileName}
                      onChange={(e) => setNewFileName(e.target.value)}
                      className="font-mono text-sm"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newFileName.trim()) createNewFile();
                      }}
                      data-testid="input-new-filename"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Inclure un / pour creer dans un sous-dossier
                    </p>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      Contenu (optionnel)
                    </label>
                    <div className="relative border rounded-md overflow-hidden">
                      <div className="flex min-h-[200px] max-h-[350px] overflow-y-auto">
                        <div className="select-none text-right pr-2 pl-2 pt-2 pb-2 bg-muted/20 border-r text-muted-foreground font-mono text-xs leading-[1.35rem] min-w-[2.5rem]" aria-hidden="true">
                          {(newFileContent || "\n").split("\n").map((_, i) => (
                            <div key={i} className="text-[10px]">{i + 1}</div>
                          ))}
                        </div>
                        <textarea
                          value={newFileContent}
                          onChange={(e) => setNewFileContent(e.target.value)}
                          placeholder="// Votre code ici..."
                          spellCheck={false}
                          className="flex-1 p-2 font-mono text-xs bg-background resize-none focus:outline-none border-0 leading-[1.35rem]"
                          style={{ tabSize: 2 }}
                          onKeyDown={(e) => {
                            if (e.key === "Tab") {
                              e.preventDefault();
                              const start = e.currentTarget.selectionStart;
                              const end = e.currentTarget.selectionEnd;
                              const val = newFileContent;
                              setNewFileContent(val.substring(0, start) + "  " + val.substring(end));
                              setTimeout(() => {
                                e.currentTarget.selectionStart = e.currentTarget.selectionEnd = start + 2;
                              }, 0);
                            }
                          }}
                          data-testid="textarea-new-file-content"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowNewFileDialog(false)}
                      data-testid="button-cancel-new-file"
                    >
                      Annuler
                    </Button>
                    <Button
                      size="sm"
                      onClick={createNewFile}
                      disabled={!newFileName.trim() || creatingFile}
                      data-testid="button-create-file"
                    >
                      {creatingFile ? (
                        <Loader2 className="w-3 h-3 animate-spin mr-1" />
                      ) : (
                        <Plus className="w-3 h-3 mr-1" />
                      )}
                      Creer
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </TabsContent>

          <TabsContent value="library-test" className="mt-3">
            {!hasStagingBranch ? (
              <Card className="p-6 text-center">
                <FlaskConical className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mb-3">
                  Ce repo n'a pas de branche <code className="font-mono bg-muted px-1 rounded">staging</code>.
                </p>
                <p className="text-xs text-muted-foreground">
                  Créez-la depuis l'onglet Branches pour activer la Librairie-Test.
                </p>
              </Card>
            ) : stagingFile ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7"
                      onClick={() => {
                        if (stagingEditMode && stagingModified) {
                          if (!confirm("Modifications non sauvegardées. Quitter quand même ?")) return;
                        }
                        setStagingFile(null);
                        setStagingEditMode(false);
                        setStagingEditMsg("");
                        setStagingModified(false);
                      }}
                      data-testid="button-back-staging"
                    >
                      <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Retour
                    </Button>
                    <Badge variant="outline" className="text-[10px] h-4 border-amber-400 text-amber-600">
                      staging
                    </Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {stagingFile.path}
                    </span>
                    {stagingEditMode && (
                      <Badge variant="secondary" className="text-[10px] h-4">
                        Édition
                      </Badge>
                    )}
                    {stagingEditMode && stagingModified && (
                      <Badge variant="outline" className="text-[10px] h-4 border-orange-400 text-orange-500">
                        Modifié
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {!stagingFile.isImage &&
                      !stagingFile.content.startsWith("[Fichier binaire") &&
                      (stagingEditMode ? (
                        <>
                          <Input
                            placeholder="Commit msg..."
                            value={stagingEditMsg}
                            onChange={(e) => setStagingEditMsg(e.target.value)}
                            className="h-7 text-xs w-36"
                            data-testid="input-staging-commit-msg"
                          />
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            onClick={saveStagingFile}
                            disabled={stagingSaving}
                            data-testid="button-save-staging"
                          >
                            {stagingSaving ? (
                              <Loader2 className="w-3 h-3 animate-spin mr-1" />
                            ) : (
                              <Save className="w-3 h-3 mr-1" />
                            )}
                            Commit staging
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => setStagingEditMode(false)}
                            data-testid="button-cancel-staging-edit"
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            setStagingEditMode(true);
                            setStagingEditContent(stagingFile.content);
                            stagingOriginalRef.current = stagingFile.content;
                            setStagingModified(false);
                            setStagingEditMsg("");
                          }}
                          data-testid="button-edit-staging"
                        >
                          <Pencil className="w-3 h-3 mr-1" /> Modifier
                        </Button>
                      ))}
                  </div>
                </div>
                <Card className="p-0 overflow-hidden">
                  {stagingFile.isImage && stagingFile.rawBase64 ? (
                    <div className="flex items-center justify-center p-4" data-testid="staging-image-preview">
                      <img
                        src={stagingFile.rawBase64}
                        alt={stagingFile.path}
                        className="max-w-full max-h-[450px] object-contain rounded"
                      />
                    </div>
                  ) : stagingEditMode ? (
                    <div className="relative" data-testid="staging-code-editor">
                      <div className="flex border-b bg-muted/30 px-2.5 py-1 items-center gap-2">
                        <Code className="w-3 h-3 text-muted-foreground" />
                        <span className="text-[11px] font-mono text-muted-foreground">{stagingFile.path}</span>
                        <Badge variant="outline" className="text-[9px] h-3.5 px-1">{getSyntaxLang(stagingFile.path)}</Badge>
                        <Badge variant="outline" className="text-[9px] h-3.5 px-1 border-amber-400 text-amber-600">staging</Badge>
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {stagingEditContent.split("\n").length}L · Ctrl+S save
                        </span>
                      </div>
                      <div className="flex min-h-[450px] max-h-[600px] overflow-y-auto">
                        <div className="select-none text-right pr-2 pl-2 pt-3 pb-3 bg-muted/20 border-r text-muted-foreground font-mono text-xs leading-[1.35rem] min-w-[2.5rem]" aria-hidden="true">
                          {stagingEditContent.split("\n").map((_, i) => (
                            <div key={i} className="text-[10px]">{i + 1}</div>
                          ))}
                        </div>
                        <textarea
                          ref={stagingEditRef}
                          value={stagingEditContent}
                          onChange={(e) => {
                            setStagingEditContent(e.target.value);
                            setStagingModified(e.target.value !== stagingOriginalRef.current);
                          }}
                          spellCheck={false}
                          className="flex-1 p-3 font-mono text-xs bg-background resize-none focus:outline-none border-0 leading-[1.35rem]"
                          style={{ tabSize: 2 }}
                          onKeyDown={(e) => {
                            if (e.key === "Tab") {
                              e.preventDefault();
                              const start = e.currentTarget.selectionStart;
                              const end = e.currentTarget.selectionEnd;
                              const val = stagingEditContent;
                              const newVal = val.substring(0, start) + "  " + val.substring(end);
                              setStagingEditContent(newVal);
                              setStagingModified(newVal !== stagingOriginalRef.current);
                              setTimeout(() => {
                                if (stagingEditRef.current) {
                                  stagingEditRef.current.selectionStart = stagingEditRef.current.selectionEnd = start + 2;
                                }
                              }, 0);
                            }
                            if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                              e.preventDefault();
                              saveStagingFile();
                            }
                          }}
                          data-testid="textarea-staging-editor"
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex border-b bg-muted/30 px-2.5 py-1 items-center gap-2">
                        <Code className="w-3 h-3 text-muted-foreground" />
                        <span className="text-[11px] font-mono text-muted-foreground">{stagingFile.path}</span>
                        <Badge variant="outline" className="text-[9px] h-3.5 px-1">{getSyntaxLang(stagingFile.path)}</Badge>
                        <Badge variant="outline" className="text-[9px] h-3.5 px-1 border-amber-400 text-amber-600">staging</Badge>
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {stagingFile.content.split("\n").length}L
                        </span>
                      </div>
                      <div className="flex max-h-[500px] overflow-y-auto">
                        <div className="select-none text-right pr-2 pl-2 pt-3 pb-3 bg-muted/20 border-r text-muted-foreground font-mono text-xs leading-[1.35rem] min-w-[2.5rem]" aria-hidden="true">
                          {stagingFile.content.split("\n").map((_, i) => (
                            <div key={i} className="text-[10px]">{i + 1}</div>
                          ))}
                        </div>
                        <pre
                          className="flex-1 text-xs font-mono whitespace-pre-wrap overflow-x-auto p-3 leading-[1.35rem]"
                          data-testid="text-staging-content"
                        >
                          {stagingFile.content}
                        </pre>
                      </div>
                    </div>
                  )}
                </Card>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-1">
                    <Badge variant="outline" className="text-[10px] h-5 border-amber-400 text-amber-600 shrink-0">
                      <FlaskConical className="w-3 h-3 mr-1" /> staging
                    </Badge>
                    <span className="text-[11px] text-muted-foreground shrink-0 font-mono">
                      {stagingPath ? `/${stagingPath}` : "/"}
                    </span>
                    <div className="relative flex-1 max-w-[220px]">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                      <Input
                        placeholder="Rechercher..."
                        className="h-7 text-xs pl-7"
                        value={stagingSearch}
                        onChange={(e) => setStagingSearch(e.target.value)}
                        data-testid="input-search-staging"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="default"
                      className="h-7 text-xs bg-green-600 hover:bg-green-700"
                      disabled={stagingDeploying}
                      onClick={() => {
                        if (confirm("Déployer staging vers production ?\n\nCela va créer une PR et la merger dans la branche principale.")) {
                          deployStagingToProd();
                        }
                      }}
                      data-testid="button-deploy-staging"
                    >
                      {stagingDeploying ? (
                        <Loader2 className="w-3 h-3 animate-spin mr-1" />
                      ) : (
                        <Rocket className="w-3 h-3 mr-1" />
                      )}
                      Déployer en Prod
                    </Button>
                  </div>
                </div>

                {stagingDeployStatus && (
                  <div className="flex items-center gap-2 text-xs p-2 rounded bg-muted/50 border">
                    {stagingDeploying ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" />
                    ) : (
                      <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                    )}
                    <span className="text-muted-foreground">{stagingDeployStatus}</span>
                  </div>
                )}

                {stagingTreeLoading && (
                  <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" /> Chargement staging...
                  </div>
                )}

                {stagingFileLoading && (
                  <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground text-xs">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Chargement du fichier...
                  </div>
                )}

                <div className="space-y-0.5">
                  {(() => {
                    if (!stagingTree?.tree) return null;
                    const tree = stagingTree.tree;
                    const searchQ = stagingSearch.trim().toLowerCase();

                    if (searchQ) {
                      const results = tree
                        .filter((f) => f.type === "blob" && f.path.toLowerCase().includes(searchQ))
                        .slice(0, 50);
                      return results.map((item) => (
                        <div
                          key={item.path}
                          className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer text-xs"
                          onClick={() => loadStagingFile(item.path)}
                          data-testid={`staging-file-${item.path}`}
                        >
                          <File className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="font-mono truncate">{item.path}</span>
                        </div>
                      ));
                    }

                    const dirs = new Set<string>();
                    const files: TreeItem[] = [];
                    for (const item of tree) {
                      if (!stagingPath) {
                        const parts = item.path.split("/");
                        if (parts.length > 1) dirs.add(parts[0]);
                        else if (item.type === "blob") files.push(item);
                      } else {
                        if (!item.path.startsWith(stagingPath + "/")) continue;
                        const rest = item.path.slice(stagingPath.length + 1);
                        const parts = rest.split("/");
                        if (parts.length > 1) dirs.add(parts[0]);
                        else if (item.type === "blob") files.push(item);
                      }
                    }

                    const sortedDirs = Array.from(dirs).sort();
                    return (
                      <>
                        {stagingPath && (
                          <div
                            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer text-xs text-muted-foreground"
                            onClick={() => {
                              const parts = stagingPath.split("/");
                              parts.pop();
                              setStagingPath(parts.join("/"));
                            }}
                            data-testid="staging-nav-up"
                          >
                            <ArrowLeft className="w-3.5 h-3.5" />
                            <span>..</span>
                          </div>
                        )}
                        {sortedDirs.map((dir) => (
                          <div
                            key={dir}
                            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer text-xs"
                            onClick={() => setStagingPath(stagingPath ? `${stagingPath}/${dir}` : dir)}
                            data-testid={`staging-dir-${dir}`}
                          >
                            <Folder className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                            <span className="font-mono">{dir}</span>
                            <ChevronRight className="w-3 h-3 text-muted-foreground ml-auto" />
                          </div>
                        ))}
                        {files.map((item) => (
                          <div
                            key={item.path}
                            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer text-xs"
                            onClick={() => loadStagingFile(item.path)}
                            data-testid={`staging-file-${item.path}`}
                          >
                            <File className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="font-mono">{item.path.split("/").pop()}</span>
                          </div>
                        ))}
                      </>
                    );
                  })()}
                </div>

                {!stagingTreeLoading && !stagingTree?.tree?.length && (
                  <p className="text-xs text-muted-foreground text-center py-4">Aucun fichier sur staging</p>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="preview" className="mt-3">
            {(() => {
              const allDeployUrls = deployUrls?.[selectedRepo.full_name] || [];
              const repoHomepage = selectedRepo.homepage || null;
              const ghPagesUrl = selectedRepo.has_pages
                ? `https://${selectedRepo.owner?.login || selectedRepo.full_name.split("/")[0]}.github.io/${selectedRepo.name}/`
                : null;
              const rawUrls = [
                ...allDeployUrls.filter(u => !u.includes(".replit.app") && !u.includes(".replit.dev")),
                ...(repoHomepage && !repoHomepage.includes(".replit.app") && !repoHomepage.includes(".replit.dev") && !allDeployUrls.includes(repoHomepage) ? [repoHomepage] : []),
                ...(ghPagesUrl && !allDeployUrls.includes(ghPagesUrl) ? [ghPagesUrl] : []),
              ];
              const availableUrls = [
                ...rawUrls.filter(u => u.includes(".ulyssepro.org")),
                ...rawUrls.filter(u => !u.includes(".ulyssepro.org")),
              ];
              const defaultUrl = availableUrls[0] || "";

              const navigateTo = (targetUrl: string) => {
                if (!targetUrl) return;
                let normalizedUrl = targetUrl.trim();
                if (normalizedUrl && !normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
                  normalizedUrl = "https://" + normalizedUrl;
                }
                setBrowserUrl(normalizedUrl);
                setBrowserInputUrl(normalizedUrl);
                setBrowserLoading(true);
                const newHistory = browserHistory.slice(0, browserHistoryIndex + 1);
                newHistory.push(normalizedUrl);
                setBrowserHistory(newHistory);
                setBrowserHistoryIndex(newHistory.length - 1);
              };

              const goBack = () => {
                if (browserHistoryIndex > 0) {
                  const newIndex = browserHistoryIndex - 1;
                  setBrowserHistoryIndex(newIndex);
                  const prevUrl = browserHistory[newIndex];
                  setBrowserUrl(prevUrl);
                  setBrowserInputUrl(prevUrl);
                  setBrowserLoading(true);
                }
              };

              const goForward = () => {
                if (browserHistoryIndex < browserHistory.length - 1) {
                  const newIndex = browserHistoryIndex + 1;
                  setBrowserHistoryIndex(newIndex);
                  const nextUrl = browserHistory[newIndex];
                  setBrowserUrl(nextUrl);
                  setBrowserInputUrl(nextUrl);
                  setBrowserLoading(true);
                }
              };

              const refreshBrowser = () => {
                if (browserUrl) {
                  setBrowserLoading(true);
                  const iframe = browserIframeRef.current;
                  if (iframe) {
                    iframe.src = `/api/devops/proxy?url=${encodeURIComponent(browserUrl)}&_cb=${Date.now()}`;
                  }
                }
              };

              const isHttps = browserUrl.startsWith("https://");
              const displayHost = (() => {
                try { return new URL(browserUrl).hostname; } catch { return ""; }
              })();
              const isUlyssePro = displayHost.endsWith(".ulyssepro.org");
              const canBrowse = !!browserUrl;
              const hasBrowserContent = !!browserUrl;

              const vpWidths = { desktop: "100%", tablet: "768px", mobile: "375px" };
              const vpHeight = { desktop: "640px", tablet: "640px", mobile: "667px" };

              return (
                <div className="space-y-0">
                  <Card className="overflow-hidden rounded-xl border shadow-sm">
                    <div className="bg-muted/60 dark:bg-muted/30 border-b px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <div className="flex items-center gap-0.5">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={browserHistoryIndex <= 0} onClick={goBack} data-testid="button-browser-back">
                            <ArrowLeft className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={browserHistoryIndex >= browserHistory.length - 1} onClick={goForward} data-testid="button-browser-forward">
                            <ArrowRight className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={refreshBrowser} disabled={!browserUrl} data-testid="button-browser-refresh">
                            {browserLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />}
                          </Button>
                        </div>

                        <div className="flex-1 flex items-center gap-1.5 bg-background rounded-md border px-2 py-1 h-7">
                          {browserUrl && (
                            <div className="flex items-center shrink-0">
                              {isHttps ? <Lock className="w-3 h-3 text-green-600 dark:text-green-400" /> : <Shield className="w-3 h-3 text-muted-foreground" />}
                            </div>
                          )}
                          {browserSiteStatus && browserUrl && (
                            <div className="flex items-center shrink-0" title={`HTTP ${browserSiteStatus.status || "?"} ${browserSiteStatus.statusText || ""}`}>
                              {browserSiteStatus.reachable ? (
                                <div className={cn("w-2 h-2 rounded-full", browserSiteStatus.status && browserSiteStatus.status < 400 ? "bg-green-500" : "bg-amber-500")} />
                              ) : (
                                <div className="w-2 h-2 rounded-full bg-red-500" />
                              )}
                            </div>
                          )}
                          <input
                            type="text"
                            value={browserInputUrl}
                            onChange={(e) => setBrowserInputUrl(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") navigateTo(browserInputUrl); }}
                            onFocus={(e) => e.target.select()}
                            placeholder="Entrer une URL (ex: horlogemax.ulyssepro.org)"
                            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60 min-w-0"
                            data-testid="input-browser-url"
                          />
                          {browserLoading && (
                            <div className="w-3 h-3 shrink-0">
                              <div className="w-full h-full border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-0.5 shrink-0">
                          <div className="flex items-center border rounded-md overflow-hidden h-7">
                            {([
                              { key: "desktop" as const, icon: Monitor, title: "Desktop" },
                              { key: "tablet" as const, icon: TabletSmartphone, title: "Tablet (768px)" },
                              { key: "mobile" as const, icon: Smartphone, title: "Mobile (375px)" },
                            ]).map(({ key, icon: Icon, title }) => (
                              <button
                                key={key}
                                onClick={() => setBrowserViewport(key)}
                                title={title}
                                className={cn(
                                  "h-full px-1.5 transition-colors",
                                  browserViewport === key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                                )}
                                data-testid={`button-viewport-${key}`}
                              >
                                <Icon className="w-3.5 h-3.5" />
                              </button>
                            ))}
                          </div>
                          <Button size="sm" variant="ghost" className="h-7 text-xs px-2 gap-1" title="Crawl & SEO"
                            onClick={() => {
                              const analyzeUrl = browserUrl || defaultUrl;
                              const repoName = selectedRepo?.full_name || "";
                              setChatExternalMessage(analyzeUrl
                                ? `Analyse et crawle en temps réel le site déployé ${analyzeUrl} du repo ${repoName}. Vérifie le statut HTTP, la structure HTML, le SEO, les erreurs éventuelles et donne-moi un rapport complet.`
                                : `Crawle l'aperçu du repo ${repoName} et donne-moi un rapport complet (statut, SEO, erreurs).`);
                            }}
                            disabled={!browserUrl && !defaultUrl} data-testid="button-crawl-preview"
                          >
                            <Search className="w-3 h-3" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs px-2 gap-1" title="Analyser le design (Vision IA)"
                            onClick={() => {
                              const analyzeUrl = browserUrl || defaultUrl;
                              const repoName = selectedRepo?.full_name || "";
                              setChatExternalMessage(analyzeUrl
                                ? `Utilise analyze_preview pour prendre un screenshot du site ${analyzeUrl} (repo ${repoName}) et analyser le design visuel complet : esthétique, UI/UX, couleurs, layout, typographie, accessibilité. Donne-moi un rapport design détaillé avec des suggestions d'amélioration.`
                                : `Analyse le design visuel du site déployé du repo ${repoName} avec analyze_preview. Rapport complet UI/UX.`);
                            }}
                            disabled={!browserUrl && !defaultUrl} data-testid="button-analyze-design"
                          >
                            <Palette className="w-3 h-3" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs px-2 gap-1" title="Améliorer automatiquement"
                            onClick={() => {
                              const analyzeUrl = browserUrl || defaultUrl;
                              const repoName = selectedRepo?.full_name || "";
                              setChatExternalMessage(`Analyse le site ${analyzeUrl || "déployé"} du repo ${repoName} avec analyze_preview, puis applique automatiquement les améliorations design (couleurs, espacements, typographie, responsive) directement via apply_patch sur le repo. Fais les changements toi-même.`);
                            }}
                            disabled={!browserUrl && !defaultUrl} data-testid="button-auto-improve"
                          >
                            <Zap className="w-3 h-3" />
                          </Button>
                          {browserUrl && (
                            <a href={browserUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent" data-testid="link-preview-external">
                              <ExternalLink className="w-3 h-3 text-muted-foreground" />
                            </a>
                          )}
                        </div>
                      </div>

                      {availableUrls.length > 1 && (
                        <div className="flex items-center gap-1 mt-1 px-1 flex-wrap">
                          {availableUrls.map((u, i) => {
                            let hostname = "";
                            try { hostname = new URL(u).hostname; } catch { hostname = u; }
                            const isActive = browserUrl === u;
                            const isUP = hostname.endsWith(".ulyssepro.org");
                            return (
                              <button
                                key={i}
                                onClick={() => navigateTo(u)}
                                className={cn(
                                  "text-[10px] px-2 py-0.5 rounded-full border transition-colors",
                                  isActive
                                    ? "bg-primary/10 border-primary/30 text-primary"
                                    : "bg-transparent border-transparent text-muted-foreground hover:bg-muted hover:border-border",
                                  isUP && !isActive && "border-green-500/20 text-green-600 dark:text-green-400"
                                )}
                                data-testid={`button-quick-url-${i}`}
                              >
                                {isUP && <span className="mr-0.5">●</span>}
                                {hostname}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {browserPageInfo?.title && browserUrl && (
                        <div className="flex items-center gap-1.5 mt-1 px-1">
                          <span className="text-[10px] text-muted-foreground truncate">{browserPageInfo.title}</span>
                          {browserPageInfo.performance && (
                            <span className="text-[9px] text-muted-foreground/60 shrink-0">
                              {browserPageInfo.performance.domElements} el · {browserPageInfo.performance.images} img · {browserPageInfo.performance.scripts} js
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {canBrowse && browserUrl ? (
                      <div className={cn("w-full flex justify-center bg-[#1a1a2e]", browserViewport !== "desktop" && "py-3")}>
                        <iframe
                          ref={browserIframeRef}
                          src={`/api/devops/proxy?url=${encodeURIComponent(browserUrl)}`}
                          className={cn(
                            "border-0 bg-white transition-all duration-300",
                            browserViewport === "desktop" && "w-full",
                            browserViewport !== "desktop" && "rounded-lg shadow-xl border border-white/10"
                          )}
                          style={{
                            width: vpWidths[browserViewport],
                            height: vpHeight[browserViewport],
                            maxWidth: "100%",
                          }}
                          title="Apercu navigateur"
                          onLoad={() => setBrowserLoading(false)}
                          onError={() => setBrowserLoading(false)}
                          data-testid="iframe-preview-live"
                        />
                      </div>
                    ) : !browserUrl ? (
                      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                        <Globe className="w-10 h-10 opacity-30" />
                        <p className="text-sm">Aucune URL de deploiement configuree</p>
                        <p className="text-[11px] text-muted-foreground/70 max-w-sm text-center">
                          Tapez une URL dans la barre d'adresse ou configurez les URLs de deploiement du repo
                        </p>
                        <Button size="sm" variant="outline" className="h-7 text-xs mt-1"
                          onClick={() => { setPreviewHtml(""); buildPreview(); }}
                          disabled={previewLoading}
                        >
                          {previewLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Code className="w-3 h-3 mr-1" />}
                          Charger depuis les sources
                        </Button>
                        {previewLoading && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="w-4 h-4 animate-spin" /> Construction...
                          </div>
                        )}
                        {previewHtml && (
                          <div className="w-full px-2 pb-2">
                            <iframe ref={previewIframeRef} srcDoc={previewHtml} sandbox="allow-scripts" className="w-full border rounded-lg" style={{ height: "450px" }} title="Apercu source" data-testid="iframe-preview" />
                          </div>
                        )}
                      </div>
                    ) : null}

                    {browserUrl && (
                      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/40 border-t text-[10px] text-muted-foreground">
                        <div className="flex items-center gap-2">
                          {isUlyssePro && (
                            <Badge variant="outline" className="text-[9px] h-3.5 px-1.5 border-green-500/30 text-green-600">
                              ulyssepro.org
                            </Badge>
                          )}
                          {browserSiteStatus && (
                            <Badge
                              variant="outline"
                              className={cn("text-[9px] h-3.5 px-1.5",
                                browserSiteStatus.reachable && browserSiteStatus.status && browserSiteStatus.status < 400
                                  ? "border-green-500/30 text-green-600"
                                  : browserSiteStatus.reachable
                                    ? "border-amber-500/30 text-amber-600"
                                    : "border-red-500/30 text-red-600"
                              )}
                              data-testid="badge-http-status"
                            >
                              {browserSiteStatus.reachable ? `HTTP ${browserSiteStatus.status}` : "Hors ligne"}
                            </Badge>
                          )}
                          <span>{displayHost}</span>
                          {browserSiteStatus?.server && (
                            <span className="text-muted-foreground/50">{browserSiteStatus.server}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {isHttps && (
                            <span className="text-green-600 dark:text-green-400 flex items-center gap-0.5">
                              <Lock className="w-2.5 h-2.5" /> SSL
                            </span>
                          )}
                          <span className="text-muted-foreground/50">
                            {browserViewport === "desktop" ? "Desktop" : browserViewport === "tablet" ? "768px" : "375px"}
                          </span>
                          <span>{browserHistory.length} page{browserHistory.length > 1 ? "s" : ""}</span>
                        </div>
                      </div>
                    )}
                  </Card>
                </div>
              );
            })()}
          </TabsContent>

          <TabsContent value="server" className="mt-3">
            <HetznerServerTab />
          </TabsContent>

          <TabsContent value="rollback" className="mt-3">
            <div className="space-y-4" data-testid="rollback-tab">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
                <div>
                  <p className="text-sm font-medium text-destructive">Rollback System</p>
                  <p className="text-[11px] text-muted-foreground">
                    Force-push une branche vers un commit precedent. Un backup automatique de l'etat actuel est cree avant chaque rollback.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Branche cible :</span>
                </div>
                <Select
                  value={rollbackBranch}
                  onValueChange={(v) => {
                    setRollbackBranch(v);
                    setRollbackConfirmSha(null);
                  }}
                >
                  <SelectTrigger className="w-[200px] h-8" data-testid="select-rollback-branch">
                    <SelectValue placeholder="Choisir une branche" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches?.map((b: Branch) => (
                      <SelectItem key={b.name} value={b.name}>
                        {b.name} {b.name === selectedRepo?.default_branch ? "(default)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {rollbackBranch && (
                  <Badge variant="outline" className="text-[10px]">
                    HEAD: {branches?.find(b => b.name === rollbackBranch)?.commit.sha.slice(0, 7) || "..."}
                  </Badge>
                )}
              </div>

              {rollbackCommitsLoading && (
                <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> Chargement de l'historique...
                </div>
              )}

              {rollbackConfirmSha && (
                <Card className="p-4 border-destructive/40 bg-destructive/5">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-destructive mb-1">Confirmer le rollback</p>
                      <p className="text-[11px] text-muted-foreground mb-2">
                        Cette action va force-push <code className="bg-muted px-1 rounded">{rollbackBranch}</code> vers le commit{" "}
                        <code className="bg-muted px-1 rounded">{rollbackConfirmSha.slice(0, 7)}</code>.
                        {" "}Un backup de l'etat actuel sera cree automatiquement.
                      </p>
                      <p className="text-[11px] text-muted-foreground mb-3">
                        Commit: <strong>{rollbackCommits?.find(c => c.sha === rollbackConfirmSha)?.commit.message.split("\n")[0]}</strong>
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 text-xs"
                          onClick={() => rollbackMutation.mutate({ targetSha: rollbackConfirmSha, createBackup: true })}
                          disabled={rollbackMutation.isPending}
                          data-testid="button-confirm-rollback"
                        >
                          {rollbackMutation.isPending ? (
                            <Loader2 className="w-3 h-3 animate-spin mr-1" />
                          ) : (
                            <RotateCcw className="w-3 h-3 mr-1" />
                          )}
                          Rollback avec backup
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs text-destructive border-destructive/30"
                          onClick={() => rollbackMutation.mutate({ targetSha: rollbackConfirmSha, createBackup: false })}
                          disabled={rollbackMutation.isPending}
                          data-testid="button-confirm-rollback-no-backup"
                        >
                          Rollback sans backup
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => setRollbackConfirmSha(null)}
                          data-testid="button-cancel-rollback"
                        >
                          Annuler
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              )}

              {!rollbackCommitsLoading && rollbackCommits && rollbackCommits.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      Historique ({rollbackCommits.length} commits) — Selectionnez un commit cible
                    </span>
                  </div>
                  {rollbackCommits.map((c: Commit, idx: number) => {
                    const isHead = idx === 0;
                    const isSelected = rollbackConfirmSha === c.sha;
                    return (
                      <Card
                        key={c.sha}
                        className={cn(
                          "p-2.5 transition-all",
                          isHead && "border-green-500/30 bg-green-500/5",
                          isSelected && "ring-2 ring-destructive/50 border-destructive/40",
                          !isHead && !isSelected && "cursor-pointer hover:border-primary/40",
                        )}
                        onClick={() => {
                          if (!isHead) setRollbackConfirmSha(c.sha);
                        }}
                        data-testid={`rollback-commit-${c.sha.slice(0, 7)}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 flex-1 min-w-0">
                            <div className={cn(
                              "w-2 h-2 rounded-full mt-1.5 shrink-0",
                              isHead ? "bg-green-500" : "bg-muted-foreground/30"
                            )} />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm truncate" data-testid={`text-rollback-commit-${c.sha.slice(0, 7)}`}>
                                {c.commit.message.split("\n")[0]}
                              </p>
                              <p className="text-[11px] text-muted-foreground mt-0.5">
                                {c.commit.author.name} · {timeAgo(c.commit.author.date)}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {isHead && (
                              <Badge className="text-[9px] h-4 bg-green-500/10 text-green-600 border-green-500/30">
                                HEAD
                              </Badge>
                            )}
                            <code className="text-[11px] text-muted-foreground font-mono">
                              {c.sha.slice(0, 7)}
                            </code>
                            {!isHead && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-[10px] text-destructive hover:text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRollbackConfirmSha(c.sha);
                                }}
                                data-testid={`button-rollback-${c.sha.slice(0, 7)}`}
                              >
                                <RotateCcw className="w-3 h-3 mr-1" />
                                Rollback ici
                              </Button>
                            )}
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}

              {!rollbackBranch && (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <RotateCcw className="w-8 h-8 mb-3 opacity-40" />
                  <p className="text-sm">Selectionnez une branche pour voir l'historique</p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="dgm" className="mt-3">
            <div className="space-y-4" data-testid="dgm-tab">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <Crown className={cn("w-5 h-5 shrink-0", dgmActive ? "text-amber-500" : "text-muted-foreground")} />
                <div>
                  <p className="text-sm font-medium">DEV God Mode — {selectedRepo?.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    En mode God, Ulysse travaille en autonomie totale : une tache a la fois, 100% terminee et testee avant la suivante.
                  </p>
                </div>
                {dgmActive && <Badge className="ml-auto bg-amber-500/20 text-amber-600 border-amber-500/30">ACTIF</Badge>}
              </div>

              {selectedRepo && !dgmActive && (
                <div>
                  <label className="text-sm font-medium mb-1 block">Objectif (optionnel)</label>
                  <Input
                    placeholder="Ex: Refactor complet du module auth..."
                    value={dgmObjective}
                    onChange={(e) => setDgmObjective(e.target.value)}
                    data-testid="input-dgm-objective"
                  />
                </div>
              )}

              {dgmActive && dgmObjective && (
                <div className="text-sm p-2 rounded-md bg-amber-500/10 border border-amber-500/20">
                  <span className="font-medium text-amber-600">Objectif:</span> {dgmObjective}
                </div>
              )}

              {dgmActive && dgmTasks.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Taches DGM</p>
                  {dgmTasks.map((t: any, i: number) => (
                    <div key={t.id} className={cn("flex items-center gap-2 text-sm p-2 rounded-md border", t.status === "tested" || t.status === "completed" ? "bg-green-500/10 border-green-500/20" : t.status === "running" ? "bg-amber-500/10 border-amber-500/20" : t.status === "failed" ? "bg-red-500/10 border-red-500/20" : "bg-muted/30 border-border")}>
                      {t.status === "tested" || t.status === "completed" ? (
                        <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      ) : t.status === "running" ? (
                        <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin shrink-0" />
                      ) : t.status === "failed" ? (
                        <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      )}
                      <span className="truncate">{i + 1}. {t.title}</span>
                    </div>
                  ))}
                </div>
              )}

              {selectedRepo && (
                <Button
                  className={cn("w-full", dgmActive ? "bg-red-500 hover:bg-red-600" : "bg-amber-500 hover:bg-amber-600 text-black")}
                  onClick={() => toggleDgm(!dgmActive)}
                  disabled={dgmLoading}
                  data-testid="button-dgm-confirm"
                >
                  {dgmLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : dgmActive ? (
                    <>
                      <StopCircle className="w-4 h-4 mr-2" />
                      Desactiver God Mode
                    </>
                  ) : (
                    <>
                      <Crown className="w-4 h-4 mr-2" />
                      Activer God Mode
                    </>
                  )}
                </Button>
              )}
            </div>
          </TabsContent>
        </Tabs>
        <DevOpsChatBox
          repoContext={selectedRepo?.full_name}
          availableRepos={repos}
          externalMessage={chatExternalMessage}
          onExternalMessageConsumed={() => setChatExternalMessage(null)}
          activeTab={activeTab}
          previewUrl={browserUrl}
          previewHtml={previewHtml}
          dgmActive={dgmActive}
          dgmSessionId={dgmSessionId || undefined}
          dgmObjective={dgmObjective || undefined}
          dgmRepoContext={selectedRepo?.full_name || undefined}
          onActionComplete={() => {
            fileContentCache.current.clear();
            if (selectedFile) {
              loadFileContent(selectedFile.path);
            }
            if (activeTab === "preview") {
              setPreviewHtml("");
              buildPreview();
            }
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-background p-3 md:p-4 max-w-6xl mx-auto"
      data-testid="devops-page"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => navigate("/")}
            data-testid="button-back-dashboard"
          >
            <Home className="w-4 h-4" />
          </Button>
          <FolderGit2 className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold">DevOps Ulysse</h1>
            {ghUser && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">{ghUser.login}</span>
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={newRepoOpen} onOpenChange={setNewRepoOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8" data-testid="button-new-repo">
                <Plus className="w-3.5 h-3.5 mr-1" /> Nouveau
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Nouveau projet</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div>
                  <label className="text-sm font-medium mb-2 block">
                    Template
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: "portfolio", Icon: Layout, name: "Portfolio", color: "from-violet-500 to-purple-600", desc: "React, Tailwind" },
                      { id: "blog", Icon: BookOpen, name: "Blog", color: "from-emerald-500 to-teal-600", desc: "Next.js, MDX" },
                      { id: "galerie-photo", Icon: Camera, name: "Galerie Photo", color: "from-amber-500 to-orange-600", desc: "React, Lightbox" },
                      { id: "jeu-web", Icon: Gamepad2, name: "Jeu Web", color: "from-red-500 to-pink-600", desc: "Phaser, TypeScript" },
                      { id: "playlist", Icon: Music, name: "Playlist", color: "from-green-500 to-emerald-600", desc: "React, Spotify API" },
                      { id: "boutique", Icon: ShoppingBag, name: "Boutique", color: "from-blue-500 to-indigo-600", desc: "React, Stripe" },
                      { id: "art-design", Icon: Palette, name: "Art & Design", color: "from-pink-500 to-rose-600", desc: "React, Canvas" },
                      { id: "react-vite", Icon: Code, name: "React+Vite", color: "from-cyan-500 to-blue-600", desc: "SPA classique" },
                      { id: "empty", Icon: FilePlus, name: "Projet Libre", color: "from-slate-500 to-zinc-600", desc: "À définir" },
                    ].map((t) => (
                      <div
                        key={t.id}
                        className={cn(
                          "border rounded-lg p-2 cursor-pointer transition-all text-center",
                          newRepoTemplate === t.id
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "hover:border-primary/40",
                        )}
                        onClick={() => {
                          setNewRepoTemplate(t.id);
                          if (!newRepoDesc) setNewRepoDesc(t.desc);
                        }}
                        data-testid={`template-${t.id}`}
                      >
                        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${t.color} flex items-center justify-center mx-auto`}>
                          <t.Icon className="h-4 w-4 text-white" />
                        </div>
                        <p className="text-xs font-medium mt-1">{t.name}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Nom</label>
                  <Input
                    placeholder="mon-projet"
                    value={newRepoName}
                    onChange={(e) =>
                      setNewRepoName(
                        e.target.value.replace(/[^a-zA-Z0-9._-]/g, "-"),
                      )
                    }
                    data-testid="input-new-repo-name"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">
                    Description
                  </label>
                  <Input
                    placeholder="Optionnel"
                    value={newRepoDesc}
                    onChange={(e) => setNewRepoDesc(e.target.value)}
                    data-testid="input-new-repo-desc"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="repo-private"
                    checked={newRepoPrivate}
                    onChange={(e) => setNewRepoPrivate(e.target.checked)}
                    className="rounded border-border"
                  />
                  <label htmlFor="repo-private" className="text-sm">
                    Prive
                  </label>
                </div>
                <Button
                  onClick={() => createRepoMutation.mutate()}
                  disabled={createRepoMutation.isPending || !newRepoName.trim()}
                  className="w-full"
                  data-testid="button-confirm-create-repo"
                >
                  {createRepoMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Plus className="w-4 h-4 mr-2" />
                  )}
                  Creer
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: ["/api/devops/repos"] })
            }
            data-testid="button-refresh-repos"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="mb-4">
        <DeploymentsPanel />
      </div>

      <div className="flex items-center gap-2 mb-3">
        <Rocket className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Repos GitHub</h2>
      </div>
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          ref={searchInputRef}
          placeholder="Rechercher un repo... (Ctrl+K)"
          className="pl-9 h-9"
          value={searchFilter}
          onChange={(e) => setSearchFilter(e.target.value)}
          data-testid="input-search-repos"
        />
      </div>
      {reposLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {filteredRepos?.map((repo: Repo) => (
            <Card
              key={repo.id}
              className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => selectRepo(repo)}
              onMouseEnter={() =>
                prefetchRepoData(repo.full_name, repo.default_branch)
              }
              data-testid={`card-repo-${repo.name}`}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full shrink-0",
                      langColor(repo.language),
                    )}
                  />
                  <h3
                    className="font-semibold text-sm truncate flex-1"
                    data-testid={`text-repo-name-${repo.name}`}
                  >
                    {repo.name}
                  </h3>
                  <Badge
                    variant={repo.private ? "secondary" : "outline"}
                    className="text-[9px] h-4 shrink-0"
                  >
                    {repo.private ? "P" : "O"}
                  </Badge>
                </div>
                {repo.description && (
                  <p className="text-[11px] text-muted-foreground line-clamp-1 mb-1.5">
                    {repo.description}
                  </p>
                )}
                <div className="flex flex-col gap-0.5">
                  {(() => {
                    const hApp = hetznerAppMap.get(repo.name.toLowerCase());
                    const isLive = hApp && ["online", "static", "deployed"].includes(hApp.status);
                    const allUrls = deployUrls?.[repo.full_name] || [];
                    const ulysseProUrls = allUrls.filter(u => u.includes(".ulyssepro.org"));
                    const otherUrls = allUrls.filter(u => !u.includes(".ulyssepro.org"));
                    const hetznerDomain = hApp?.domain;
                    if (hetznerDomain && !ulysseProUrls.some(u => u.includes(hetznerDomain))) {
                      ulysseProUrls.unshift(`https://${hetznerDomain}`);
                    }
                    const shownUlysseUrls = [...new Set(ulysseProUrls)];

                    return (
                      <>
                        {shownUlysseUrls.map((url, i) => {
                          let hostname = "";
                          try { hostname = new URL(url).hostname; } catch { hostname = url.replace(/^https?:\/\//, ""); }
                          return (
                            <a
                              key={`ulysse-${i}`}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] flex items-center gap-1 truncate hover:underline"
                              onClick={(e) => e.stopPropagation()}
                              data-testid={`link-ulysse-${repo.name}-${i}`}
                            >
                              <div className={cn(
                                "w-1.5 h-1.5 rounded-full shrink-0",
                                isLive ? "bg-green-500" : "bg-yellow-500"
                              )} />
                              <span className="truncate text-primary font-medium">
                                {hostname}
                              </span>
                              {hApp && (
                                <Badge variant="outline" className="text-[7px] h-3 px-1 shrink-0">
                                  {hApp.type === "static" ? "HTML" : "Node"}
                                </Badge>
                              )}
                            </a>
                          );
                        })}
                        {otherUrls.slice(0, 2).map((url, i) => (
                          <a
                            key={`deploy-${i}`}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-primary hover:underline flex items-center gap-1 truncate"
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`link-deploy-${repo.name}-${i}`}
                          >
                            <Globe className="w-2.5 h-2.5 shrink-0" />
                            <span className="truncate">
                              {(() => {
                                try { return new URL(url).hostname; } catch { return url; }
                              })()}
                            </span>
                          </a>
                        ))}
                        {repo.homepage && !allUrls.includes(repo.homepage) && (
                          <a
                            href={repo.homepage}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-muted-foreground hover:underline flex items-center gap-1 truncate"
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`link-homepage-${repo.name}`}
                          >
                            <Globe className="w-2.5 h-2.5 shrink-0" />
                            <span className="truncate">
                              {(() => {
                                try { return new URL(repo.homepage).hostname; } catch { return repo.homepage; }
                              })()}
                            </span>
                          </a>
                        )}
                      </>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-2 mt-1.5 text-[11px] text-muted-foreground">
                  {repo.language && <span>{repo.language}</span>}
                  {repo.stargazers_count > 0 && (
                    <span className="flex items-center gap-0.5">
                      <Star className="w-2.5 h-2.5" />
                      {repo.stargazers_count}
                    </span>
                  )}
                  <span className="ml-auto">{timeAgo(repo.updated_at)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {!reposLoading && !filteredRepos?.length && (
        <div className="text-center py-16 text-muted-foreground">
          <FolderGit2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Aucun repo</p>
        </div>
      )}
      <Dialog
        open={!!editDeployRepo}
        onOpenChange={(open) => {
          if (!open) setEditDeployRepo(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>URLs de deploiement</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground mb-2">{editDeployRepo}</p>
          <Textarea
            value={editDeployInput}
            onChange={(e) => setEditDeployInput(e.target.value)}
            placeholder="https://monapp.com"
            rows={3}
            className="text-sm"
            data-testid="input-deploy-urls"
          />
          <p className="text-[11px] text-muted-foreground">Une URL par ligne</p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditDeployRepo(null)}
              data-testid="button-cancel-deploy"
            >
              Annuler
            </Button>
            <Button
              size="sm"
              data-testid="button-save-deploy"
              onClick={async () => {
                if (!editDeployRepo) return;
                const urls = editDeployInput
                  .split("\n")
                  .map((u) => u.trim())
                  .filter(Boolean);
                const [owner, repo] = editDeployRepo.split("/");
                await apiRequest(
                  "PUT",
                  `/api/devops/deploy-urls/${owner}/${repo}`,
                  { urls },
                );
                queryClient.invalidateQueries({
                  queryKey: ["/api/devops/deploy-urls"],
                });
                setEditDeployRepo(null);
                toast({ title: "URLs mises a jour" });
              }}
            >
              Enregistrer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <DevOpsChatBox
        repoContext={selectedRepo?.full_name}
        availableRepos={repos}
        dgmActive={dgmActive}
        dgmSessionId={dgmSessionId || undefined}
        dgmObjective={dgmObjective || undefined}
        dgmRepoContext={selectedRepo?.full_name || undefined}
      />
    </div>
  );
}
