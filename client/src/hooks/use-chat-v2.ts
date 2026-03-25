import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface ConversationThread {
  id: number;
  userId: number;
  title: string;
  originDevice: string;
  lastDevice: string;
  messageCount: number;
  lastMessageAt: Date | null;
  createdAt: Date;
}

export interface ConversationMessage {
  id: number;
  threadId: number;
  userId: number;
  role: "user" | "assistant";
  content: string;
  modality: string;
  attachments: any[];
  metadata: any;
  createdAt: Date;
}

export function useConversationThreads() {
  return useQuery({
    queryKey: ["/api/v2/conversations"],
    queryFn: async () => {
      const res = await fetch("/api/v2/conversations", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch threads");
      const data = await res.json();
      return (data.threads || []) as ConversationThread[];
    },
  });
}

export function useConversationThread(threadId: number | null) {
  return useQuery({
    queryKey: ["/api/v2/conversations", threadId],
    queryFn: async () => {
      if (!threadId) return null;
      const res = await fetch(`/api/v2/conversations/${threadId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch thread");
      return (await res.json()) as { thread: ConversationThread; messages: ConversationMessage[] };
    },
    enabled: !!threadId,
  });
}

export function useDeleteConversationThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (threadId: number) => {
      const res = await fetch(`/api/v2/conversations/${threadId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete thread");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v2/conversations"] });
    },
  });
}

export async function sendMessageV2(
  message: string,
  threadId: number | null,
  onChunk: (content: string) => void,
  onThreadId: (id: number) => void
): Promise<string> {
  const res = await fetch("/api/v2/conversations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
    },
    credentials: "include",
    body: JSON.stringify({
      message,
      threadId,
      originDevice: "web",
      sessionContext: "assistant",
      contextHints: { includeMemory: true },
    }),
  });

  if (!res.ok) {
    throw new Error("Failed to send message");
  }

  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let fullResponse = "";

  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      const lines = text.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "start" && data.threadId) {
              onThreadId(data.threadId);
            } else if (data.type === "chunk" && data.content) {
              fullResponse += data.content;
              onChunk(fullResponse);
            }
          } catch {}
        }
      }
    }
  }

  return fullResponse;
}
