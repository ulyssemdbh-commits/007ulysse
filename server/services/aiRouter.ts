import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";

export type AIProvider = "openai" | "gemini" | "grok" | "auto";

type ChatCompletionTool = OpenAI.Chat.Completions.ChatCompletionTool;

export interface AIRouterConfig {
  provider: AIProvider;
  model?: string;
  tools?: ChatCompletionTool[];
  onToolCall?: (name: string, args: any) => Promise<string>;
  toolChoice?: "auto" | "required" | "none";
  maxToolRounds?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | { type: string; [key: string]: any }[];
}

export interface StreamResponse {
  content: string;
  done: boolean;
}

import { getSmartAI, markOpenAIDown, isOpenAIAvailable as isOpenAICircuitOk } from "./core/openaiClient";

// Grok (xAI) client - uses OpenAI SDK with xAI base URL
function getGrokClient(): OpenAI | null {
  if (!isGrokAvailable()) return null;
  return new OpenAI({
    apiKey: process.env.XAI_API_KEY!,
    baseURL: "https://api.x.ai/v1",
  });
}

function getGeminiClient(): GoogleGenAI | null {
  if (!isGeminiAvailable()) return null;
  const apiKey = process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY!;
  const opts: any = { apiKey };
  if (process.env.AI_INTEGRATIONS_GEMINI_BASE_URL) {
    opts.httpOptions = { apiVersion: "", baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL };
  }
  return new GoogleGenAI(opts);
}

const DEFAULT_OPENAI_MODEL = "gpt-5.1";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-pro";
const DEFAULT_GROK_MODEL = "grok-2-1212";

function isGeminiAvailable(): boolean {
  return !!(process.env.GEMINI_API_KEY || (process.env.AI_INTEGRATIONS_GEMINI_BASE_URL && process.env.AI_INTEGRATIONS_GEMINI_API_KEY));
}

function isOpenAIAvailable(): boolean {
  return !!(process.env.OPENAI_API_KEY || (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY));
}

function isGrokAvailable(): boolean {
  return !!process.env.XAI_API_KEY;
}

function hasComplexContent(messages: ChatMessage[]): boolean {
  return messages.some(msg => {
    if (!Array.isArray(msg.content)) return false;
    return msg.content.some(c => {
      if (c.type === "text") return false;
      return true;
    });
  });
}

function hasMultimodalContent(messages: ChatMessage[]): boolean {
  return hasComplexContent(messages);
}

function convertMessagesToGemini(messages: ChatMessage[]): { role: "user" | "model"; parts: { text: string }[] }[] {
  const geminiMessages: { role: "user" | "model"; parts: { text: string }[] }[] = [];
  let systemPrompt = "";
  
  for (const msg of messages) {
    const content = typeof msg.content === "string" 
      ? msg.content 
      : msg.content.map(c => c.type === "text" ? c.text : "").join("\n");
    
    if (msg.role === "system") {
      systemPrompt += (systemPrompt ? "\n\n" : "") + content;
    } else if (msg.role === "user") {
      const text = systemPrompt ? `${systemPrompt}\n\n${content}` : content;
      geminiMessages.push({ role: "user", parts: [{ text }] });
      systemPrompt = "";
    } else if (msg.role === "assistant") {
      geminiMessages.push({ role: "model", parts: [{ text: content }] });
    }
  }
  
  if (systemPrompt && geminiMessages.length === 0) {
    geminiMessages.push({ role: "user", parts: [{ text: systemPrompt }] });
  }
  
  return geminiMessages;
}

export const aiRouter = {
  getAvailableProviders(): AIProvider[] {
    const providers: AIProvider[] = [];
    if (isOpenAIAvailable()) providers.push("openai");
    if (isGeminiAvailable()) providers.push("gemini");
    if (isGrokAvailable()) providers.push("grok");
    return providers;
  },

  selectProvider(config: AIRouterConfig, messages?: ChatMessage[]): "openai" | "gemini" | "grok" {
    const openaiAvailable = isOpenAIAvailable();
    const geminiAvailable = isGeminiAvailable();
    const grokAvailable = isGrokAvailable();
    
    if (!openaiAvailable && !geminiAvailable && !grokAvailable) {
      throw new Error("No AI provider available. Please configure OpenAI, Gemini or Grok credentials.");
    }

    if (messages && hasMultimodalContent(messages)) {
      if (!openaiAvailable) {
        throw new Error("Multimodal content requires OpenAI, which is not available.");
      }
      console.log("[AIRouter] Forcing OpenAI for multimodal content");
      return "openai";
    }

    if (config.provider === "grok") {
      if (grokAvailable) return "grok";
      console.log("[AIRouter] Grok requested but unavailable, falling back");
      if (openaiAvailable) return "openai";
      if (geminiAvailable) return "gemini";
    }

    if (config.provider === "gemini") {
      if (geminiAvailable) return "gemini";
      if (openaiAvailable) {
        console.log("[AIRouter] Gemini requested but unavailable, falling back to OpenAI");
        return "openai";
      }
    }

    if (config.provider === "openai") {
      if (openaiAvailable) return "openai";
      if (geminiAvailable) {
        console.log("[AIRouter] OpenAI requested but unavailable, falling back to Gemini");
        return "gemini";
      }
    }

    if (config.provider === "auto") {
      if (openaiAvailable && isOpenAICircuitOk()) return "openai";
      if (geminiAvailable) return "gemini";
      if (openaiAvailable) return "openai";
      return "grok";
    }
    
    return openaiAvailable ? "openai" : (geminiAvailable ? "gemini" : "grok");
  },

  async streamChat(
    messages: ChatMessage[],
    config: AIRouterConfig,
    onChunk: (content: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const provider = this.selectProvider(config, messages);
    console.log(`[AIRouter] Using provider: ${provider}${config.tools ? ` with ${config.tools.length} tools` : ''}`);

    // Tools only work with OpenAI currently
    if (config.tools && config.tools.length > 0) {
      return this.streamOpenAI(
        messages, 
        config.model || DEFAULT_OPENAI_MODEL, 
        onChunk, 
        signal,
        config.tools,
        config.onToolCall,
        config.toolChoice || "auto",
        config.maxToolRounds || 10
      );
    }

    if (provider === "grok") {
      try {
        return await this.streamGrok(messages, config.model || DEFAULT_GROK_MODEL, onChunk, signal);
      } catch (grokError) {
        console.error("[AIRouter] Grok failed, falling back:", grokError);
        if (isOpenAIAvailable()) {
          return this.streamOpenAI(messages, DEFAULT_OPENAI_MODEL, onChunk, signal);
        }
        throw grokError;
      }
    } else if (provider === "gemini") {
      try {
        return await this.streamGemini(messages, config.model || DEFAULT_GEMINI_MODEL, onChunk, signal);
      } catch (geminiError) {
        if (isOpenAIAvailable()) {
          console.error("[AIRouter] Gemini failed, falling back to OpenAI:", geminiError);
          return this.streamOpenAI(messages, DEFAULT_OPENAI_MODEL, onChunk, signal);
        }
        throw geminiError;
      }
    } else {
      try {
        return await this.streamOpenAI(messages, config.model || DEFAULT_OPENAI_MODEL, onChunk, signal);
      } catch (openaiError: any) {
        const isQuotaOrRate = openaiError?.status === 429 || openaiError?.code === 'insufficient_quota' || openaiError?.type === 'insufficient_quota';
        if (isQuotaOrRate) {
          console.warn("[AIRouter] OpenAI quota/rate exceeded, falling back...");
          if (isGeminiAvailable()) {
            console.log("[AIRouter] Falling back to Gemini");
            try {
              return await this.streamGemini(messages, DEFAULT_GEMINI_MODEL, onChunk, signal);
            } catch (geminiError) {
              console.error("[AIRouter] Gemini fallback also failed:", geminiError);
              if (isGrokAvailable()) {
                console.log("[AIRouter] Falling back to Grok");
                return await this.streamGrok(messages, DEFAULT_GROK_MODEL, onChunk, signal);
              }
              throw geminiError;
            }
          } else if (isGrokAvailable()) {
            console.log("[AIRouter] Falling back to Grok");
            return await this.streamGrok(messages, DEFAULT_GROK_MODEL, onChunk, signal);
          }
        }
        throw openaiError;
      }
    }
  },

  async streamOpenAI(
    messages: ChatMessage[],
    model: string,
    onChunk: (content: string) => void,
    signal?: AbortSignal,
    tools?: ChatCompletionTool[],
    onToolCall?: (name: string, args: any) => Promise<string>,
    toolChoice: "auto" | "required" | "none" = "auto",
    maxToolRounds: number = 10
  ): Promise<string> {
    // Agentic loop: supports multi-tool chaining (up to maxToolRounds rounds)
    let conversationMessages: any[] = messages as any[];
    let fullResponse = "";
    let round = 0;

    while (round < maxToolRounds) {
      round++;
      const hasTool = tools && tools.length > 0 && !!onToolCall;
      const createParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
        model,
        messages: conversationMessages,
        stream: true,
        max_completion_tokens: 8192,
      };
      if (hasTool) {
        createParams.tools = tools;
        createParams.tool_choice = round === 1 ? toolChoice : "auto";
        (createParams as any).parallel_tool_calls = true;
      }

      let stream: any;
      try {
        stream = await getSmartAI().chat.completions.create(createParams, { signal });
      } catch (initErr: any) {
        const isQuota = initErr.status === 429 || initErr.code === 'insufficient_quota' || initErr.message?.includes('insufficient_quota');
        if (isQuota) {
          markOpenAIDown();
          console.log("[AIRouter] OpenAI quota exceeded, switching to Gemini");
          if (isGeminiAvailable()) {
            return await this.streamGemini(messages, DEFAULT_GEMINI_MODEL, onChunk, signal);
          }
        }
        throw initErr;
      }

      let roundText = "";
      let pendingToolCalls: { id: string; name: string; arguments: string }[] = [];
      let finishReason = "";

      for await (const chunk of stream) {
        if (signal?.aborted) break;
        const choice = chunk.choices[0];
        if (!choice) continue;

        const content = choice.delta?.content || "";
        if (content) {
          roundText += content;
          fullResponse += content;
          onChunk(content);
        }

        if (choice.delta?.tool_calls) {
          for (const toolCall of choice.delta.tool_calls) {
            const idx = toolCall.index;
            if (!pendingToolCalls[idx]) {
              pendingToolCalls[idx] = { id: toolCall.id || "", name: "", arguments: "" };
            }
            if (toolCall.id) pendingToolCalls[idx].id = toolCall.id;
            if (toolCall.function?.name) pendingToolCalls[idx].name = toolCall.function.name;
            if (toolCall.function?.arguments) pendingToolCalls[idx].arguments += toolCall.function.arguments;
          }
        }

        if (choice.finish_reason) finishReason = choice.finish_reason;
      }

      if (signal?.aborted) break;

      // If model called tools, execute them and loop again
      if (finishReason === "tool_calls" && hasTool && pendingToolCalls.length > 0) {
        // Add assistant message with tool_calls to conversation
        const assistantMsg: any = {
          role: "assistant",
          content: roundText || null,
          tool_calls: pendingToolCalls.filter(tc => tc.name).map(tc => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.arguments }
          }))
        };
        conversationMessages = [...conversationMessages, assistantMsg];

        const CRITICAL_TOOLS = new Set([
          "devops_github", "devops_server", "email_send", "email_reply",
          "commax_manage", "dgm_manage", "manage_ai_system"
        ]);
        let hasCriticalAction = false;

        const validCalls = pendingToolCalls.filter(tc => tc.name && tc.id);
        if (validCalls.length > 1) {
          console.log(`[AIRouter] ⚡ PARALLEL execution of ${validCalls.length} tool calls (round ${round})`);
        }

        const toolPromises = validCalls.map(async (tc) => {
          try {
            const args = JSON.parse(tc.arguments || "{}");
            console.log(`[AIRouter] Tool round ${round}: ${tc.name}`, JSON.stringify(args).slice(0, 120));
            const result = await onToolCall!(tc.name, args);
            if (CRITICAL_TOOLS.has(tc.name)) hasCriticalAction = true;
            return { tool_call_id: tc.id, role: "tool" as const, content: result };
          } catch (err: any) {
            console.error(`[AIRouter] Tool failed: ${tc.name}`, err);
            return { tool_call_id: tc.id, role: "tool" as const, content: JSON.stringify({ error: err.message }) };
          }
        });

        const toolResultsMapped = await Promise.all(toolPromises);
        const failedTools: string[] = [];
        for (const tr of toolResultsMapped) {
          conversationMessages.push(tr);
          if (tr.content?.includes('"error"') || tr.content?.startsWith('ÉCHEC OUTIL')) {
            failedTools.push(tr.content.slice(0, 100));
          }
        }

        if (hasCriticalAction && round < maxToolRounds - 1) {
          conversationMessages.push({
            role: "system",
            content: "⚡ POST-ACTION VALIDATION: Tu viens d'exécuter une action critique. AVANT de répondre à l'utilisateur, VÉRIFIE le résultat : appelle un outil de vérification si disponible (ex: devops_server status après un deploy, query après un write DB, etc.). Si la vérification échoue, tente un fix automatique ou signale clairement l'échec."
          });
        }

        if (failedTools.length > 0 && round < maxToolRounds - 1) {
          conversationMessages.push({
            role: "system",
            content: `🔄 AUTO-CORRECTION REQUISE: ${failedTools.length} outil(s) ont échoué ce round. Tu as encore ${maxToolRounds - round} rounds disponibles. ANALYSE l'erreur, CHANGE de stratégie si nécessaire, et RETENTE. N'accepte PAS l'échec comme réponse finale — trouve une solution alternative.`
          });
        }

        // Continue loop for next round
        continue;
      }

      // Model responded with text (or stop) → done
      break;
    }

    return fullResponse;
  },

  async streamGemini(
    messages: ChatMessage[],
    model: string,
    onChunk: (content: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const geminiClient = getGeminiClient();
    if (!geminiClient) {
      throw new Error("Gemini client not available");
    }
    
    const geminiMessages = convertMessagesToGemini(messages);
    
    const stream = await geminiClient.models.generateContentStream({
      model,
      contents: geminiMessages,
    });

    let fullResponse = "";
    for await (const chunk of stream) {
      if (signal?.aborted) {
        console.log("[AIRouter] Gemini stream aborted by client");
        break;
      }
      const content = chunk.text || "";
      if (content) {
        fullResponse += content;
        onChunk(content);
      }
    }
    return fullResponse;
  },

  async streamGrok(
    messages: ChatMessage[],
    model: string,
    onChunk: (content: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const grokClient = getGrokClient();
    if (!grokClient) {
      throw new Error("Grok client not available");
    }

    const stream = await grokClient.chat.completions.create(
      {
        model,
        messages: messages as any,
        stream: true,
        max_tokens: 8192,
      },
      { signal }
    );

    let fullResponse = "";
    for await (const chunk of stream) {
      if (signal?.aborted) break;
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        fullResponse += content;
        onChunk(content);
      }
    }
    return fullResponse;
  },

  async nonStreamingChat(
    messages: ChatMessage[],
    config: AIRouterConfig
  ): Promise<string> {
    const provider = this.selectProvider(config, messages);
    console.log(`[AIRouter] Non-streaming using provider: ${provider}`);

    if (provider === "grok") {
      try {
        const grokClient = getGrokClient();
        if (!grokClient) {
          throw new Error("Grok client not available");
        }
        const response = await grokClient.chat.completions.create({
          model: config.model || DEFAULT_GROK_MODEL,
          messages: messages as any,
          max_tokens: 8192,
        });
        return response.choices[0]?.message?.content || "";
      } catch (grokError) {
        console.error("[AIRouter] Grok non-streaming failed, falling back:", grokError);
        if (isOpenAIAvailable()) {
          const response = await openaiClient.chat.completions.create({
            model: DEFAULT_OPENAI_MODEL,
            messages: messages as any,
            max_completion_tokens: 8192,
          });
          return response.choices[0]?.message?.content || "";
        }
        throw grokError;
      }
    } else if (provider === "gemini") {
      try {
        const geminiClient = getGeminiClient();
        if (!geminiClient) {
          throw new Error("Gemini client not available");
        }
        const geminiMessages = convertMessagesToGemini(messages);
        const response = await geminiClient.models.generateContent({
          model: config.model || DEFAULT_GEMINI_MODEL,
          contents: geminiMessages,
        });
        return response.text || "";
      } catch (geminiError) {
        if (isOpenAIAvailable()) {
          console.error("[AIRouter] Gemini non-streaming failed, falling back to OpenAI:", geminiError);
          const response = await openaiClient.chat.completions.create({
            model: DEFAULT_OPENAI_MODEL,
            messages: messages as any,
            max_completion_tokens: 8192,
          });
          return response.choices[0]?.message?.content || "";
        }
        throw geminiError;
      }
    } else {
      try {
        const response = await openaiClient.chat.completions.create({
          model: config.model || DEFAULT_OPENAI_MODEL,
          messages: messages as any,
          max_completion_tokens: 8192,
        });
        return response.choices[0]?.message?.content || "";
      } catch (openaiError: any) {
        const isQuotaOrRate = openaiError?.status === 429 || openaiError?.code === 'insufficient_quota' || openaiError?.type === 'insufficient_quota';
        if (isQuotaOrRate) {
          console.warn("[AIRouter] OpenAI quota/rate exceeded (non-streaming), falling back...");
          if (isGeminiAvailable()) {
            console.log("[AIRouter] Non-streaming fallback to Gemini");
            try {
              const geminiClient = getGeminiClient();
              if (!geminiClient) throw new Error("Gemini not available");
              const geminiMessages = convertMessagesToGemini(messages);
              const response = await geminiClient.models.generateContent({
                model: DEFAULT_GEMINI_MODEL,
                contents: geminiMessages,
              });
              return response.text || "";
            } catch (geminiError) {
              console.error("[AIRouter] Gemini fallback also failed:", geminiError);
              if (isGrokAvailable()) {
                console.log("[AIRouter] Non-streaming fallback to Grok");
                const grokClient = getGrokClient();
                if (!grokClient) throw new Error("Grok not available");
                const grokResp = await grokClient.chat.completions.create({
                  model: DEFAULT_GROK_MODEL,
                  messages: messages as any,
                  max_tokens: 8192,
                });
                return grokResp.choices[0]?.message?.content || "";
              }
              throw geminiError;
            }
          } else if (isGrokAvailable()) {
            console.log("[AIRouter] Non-streaming fallback to Grok");
            const grokClient = getGrokClient();
            if (!grokClient) throw new Error("Grok not available");
            const grokResp = await grokClient.chat.completions.create({
              model: DEFAULT_GROK_MODEL,
              messages: messages as any,
              max_tokens: 8192,
            });
            return grokResp.choices[0]?.message?.content || "";
          }
        }
        throw openaiError;
      }
    }
  },

  getModelForProvider(provider: "openai" | "gemini" | "grok"): string {
    if (provider === "grok") return DEFAULT_GROK_MODEL;
    if (provider === "gemini") return DEFAULT_GEMINI_MODEL;
    return DEFAULT_OPENAI_MODEL;
  },

  getProviderInfo(): { openai: boolean; gemini: boolean; grok: boolean; default: string } {
    return {
      openai: isOpenAIAvailable(),
      gemini: isGeminiAvailable(),
      grok: isGrokAvailable(),
      default: isOpenAIAvailable() ? "openai" : (isGeminiAvailable() ? "gemini" : (isGrokAvailable() ? "grok" : "none")),
    };
  },

  isMultimodal(messages: ChatMessage[]): boolean {
    return hasMultimodalContent(messages);
  },
};

export default aiRouter;
