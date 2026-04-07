import { useState, useRef, useEffect, useCallback, memo } from "react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type { Repo, ChatMessage } from "./types";
import { saveRepoThread, setActiveRepoThread, getActiveRepoThread } from "./helpers";
import {
  Plus,
  CheckCircle,
  XCircle,
  Loader2,
  Send,
  StopCircle,
  File,
  Bot,
  Zap,
  Minimize2,
  Maximize2,
  X,
  MessageSquare,
  Paperclip,
  AlertTriangle,
  Image,
} from "lucide-react";

export const MarkdownContent = memo(function MarkdownContent({
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

export function DevOpsChatBox({
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

