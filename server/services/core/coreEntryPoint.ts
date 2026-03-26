import { getOpenAINullable } from './openaiClient.js';
import { aiRouter, type AIRouterConfig, type ChatMessage } from "../aiRouter";
import { coreConversationIntegration } from "./CoreConversationIntegration";

export const coreEntryPoint = {
    async streamChat(
        messages: ChatMessage[],
        config: AIRouterConfig,
        onChunk: (content: string) => void,
        signal?: AbortSignal
    ): Promise<string> {
        return aiRouter.streamChat(messages, config, onChunk, signal);
    },

    async nonStreamingChat(messages: ChatMessage[], config: AIRouterConfig): Promise<string> {
        return aiRouter.nonStreamingChat(messages, config);
    },

    getProviderInfo() {
        return aiRouter.getProviderInfo();
    },

    getAvailableProviders() {
        return aiRouter.getAvailableProviders();
    },

    async processConversation(
        query: string,
        context: Parameters<typeof coreConversationIntegration.processWithCore>[1]
    ) {
        const client = getOpenAINullable();
        if (!client) {
            throw new Error("OpenAI credentials missing for coreEntryPoint processConversation");
        }
        return coreConversationIntegration.processWithCore(query, context, client);
    }
};

export type { AIRouterConfig, ChatMessage };
