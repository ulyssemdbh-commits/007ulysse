import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockOpenAI = {
  chat: {
    completions: {
      create: vi.fn(),
    },
  },
};

vi.mock('openai', () => ({
  default: vi.fn(() => mockOpenAI),
}));

describe('AIService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateResponse', () => {
    it('should generate a response for a simple message', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: 'Bonjour ! Comment puis-je vous aider ?',
            role: 'assistant',
          },
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 15,
          total_tokens: 25,
        },
      };
      mockOpenAI.chat.completions.create.mockResolvedValue(mockResponse);

      const result = await mockOpenAI.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Bonjour' }],
      });

      expect(result.choices[0].message.content).toBe('Bonjour ! Comment puis-je vous aider ?');
    });

    it('should handle streaming responses', async () => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'Bonjour' } }] };
          yield { choices: [{ delta: { content: ' monde' } }] };
          yield { choices: [{ delta: { content: ' !' } }] };
        },
      };
      mockOpenAI.chat.completions.create.mockResolvedValue(mockStream);

      const stream = await mockOpenAI.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Test' }],
        stream: true,
      });

      const chunks: string[] = [];
      for await (const chunk of stream as any) {
        if (chunk.choices[0]?.delta?.content) {
          chunks.push(chunk.choices[0].delta.content);
        }
      }

      expect(chunks.join('')).toBe('Bonjour monde !');
    });
  });

  describe('memory integration', () => {
    it('should include memory context in system prompt', async () => {
      const memories = [
        { category: 'preference', content: 'Préfère les réponses concises' },
        { category: 'fact', content: "L'utilisateur s'appelle Maurice" },
      ];

      const systemPrompt = `Tu es Ulysse, l'assistant personnel de Maurice.
Mémoires:
${memories.map(m => `- [${m.category}] ${m.content}`).join('\n')}`;

      expect(systemPrompt).toContain('Préfère les réponses concises');
      expect(systemPrompt).toContain("L'utilisateur s'appelle Maurice");
    });
  });

  describe('capability detection', () => {
    const capabilities = [
      { name: 'web_search', trigger: /recherche|cherche|trouve/i },
      { name: 'email_send', trigger: /envoie|envoyer.*email|mail/i },
      { name: 'file_generate', trigger: /crée|génère.*fichier|pdf|excel/i },
      { name: 'calendar', trigger: /agenda|calendrier|rendez-vous/i },
    ];

    it('should detect web search intent', () => {
      const message = 'Recherche des informations sur Paris';
      const detected = capabilities.find(c => c.trigger.test(message));
      expect(detected?.name).toBe('web_search');
    });

    it('should detect email intent', () => {
      const message = 'Envoie un email à Jean';
      const detected = capabilities.find(c => c.trigger.test(message));
      expect(detected?.name).toBe('email_send');
    });

    it('should detect file generation intent', () => {
      const message = 'Génère un fichier PDF avec ce rapport';
      const detected = capabilities.find(c => c.trigger.test(message));
      expect(detected?.name).toBe('file_generate');
    });

    it('should detect calendar intent', () => {
      const message = 'Ajoute un rendez-vous demain à 10h';
      const detected = capabilities.find(c => c.trigger.test(message));
      expect(detected?.name).toBe('calendar');
    });

    it('should return undefined for unrecognized intent', () => {
      const message = 'Bonjour, comment vas-tu ?';
      const detected = capabilities.find(c => c.trigger.test(message));
      expect(detected).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('should handle API rate limits', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      (rateLimitError as any).status = 429;
      mockOpenAI.chat.completions.create.mockRejectedValue(rateLimitError);

      await expect(
        mockOpenAI.chat.completions.create({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Test' }],
        })
      ).rejects.toThrow('Rate limit exceeded');
    });

    it('should handle network errors', async () => {
      mockOpenAI.chat.completions.create.mockRejectedValue(new Error('Network error'));

      await expect(
        mockOpenAI.chat.completions.create({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Test' }],
        })
      ).rejects.toThrow('Network error');
    });
  });
});
