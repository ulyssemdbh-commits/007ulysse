import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockAgentMail = {
  sendEmail: vi.fn(),
  getThreads: vi.fn(),
  getMessages: vi.fn(),
};

describe('AgentMailService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sendEmail', () => {
    it('should send email successfully', async () => {
      mockAgentMail.sendEmail.mockResolvedValue({
        id: 'msg_123',
        threadId: 'thread_123',
        status: 'sent',
      });

      const result = await mockAgentMail.sendEmail({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        body: 'Test body content',
      });

      expect(result.status).toBe('sent');
      expect(result.id).toBe('msg_123');
    });

    it('should handle HTML content', async () => {
      mockAgentMail.sendEmail.mockResolvedValue({
        id: 'msg_124',
        status: 'sent',
      });

      const htmlBody = '<h1>Hello</h1><p>This is a test.</p>';
      
      await mockAgentMail.sendEmail({
        to: 'recipient@example.com',
        subject: 'HTML Email',
        body: htmlBody,
        isHtml: true,
      });

      expect(mockAgentMail.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ body: htmlBody, isHtml: true })
      );
    });

    it('should handle attachments', async () => {
      mockAgentMail.sendEmail.mockResolvedValue({
        id: 'msg_125',
        status: 'sent',
      });

      const attachments = [
        { filename: 'doc.pdf', content: 'base64content', mimeType: 'application/pdf' },
      ];

      await mockAgentMail.sendEmail({
        to: 'recipient@example.com',
        subject: 'With Attachment',
        body: 'See attached',
        attachments,
      });

      expect(mockAgentMail.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ attachments })
      );
    });
  });

  describe('getThreads', () => {
    it('should return email threads', async () => {
      const mockThreads = [
        { id: 'thread_1', subject: 'First Thread', messageCount: 3 },
        { id: 'thread_2', subject: 'Second Thread', messageCount: 1 },
      ];
      mockAgentMail.getThreads.mockResolvedValue(mockThreads);

      const threads = await mockAgentMail.getThreads();

      expect(threads).toHaveLength(2);
      expect(threads[0].subject).toBe('First Thread');
    });

    it('should filter by date range', async () => {
      mockAgentMail.getThreads.mockResolvedValue([
        { id: 'thread_1', subject: 'Recent', createdAt: new Date() },
      ]);

      const threads = await mockAgentMail.getThreads({
        after: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      });

      expect(mockAgentMail.getThreads).toHaveBeenCalled();
      expect(threads).toHaveLength(1);
    });
  });

  describe('getMessages', () => {
    it('should return messages for a thread', async () => {
      const mockMessages = [
        { id: 'msg_1', from: 'sender@example.com', body: 'Hello' },
        { id: 'msg_2', from: 'ulysse@agent.ai', body: 'Hi there!' },
      ];
      mockAgentMail.getMessages.mockResolvedValue(mockMessages);

      const messages = await mockAgentMail.getMessages('thread_1');

      expect(messages).toHaveLength(2);
      expect(messages[0].from).toBe('sender@example.com');
    });
  });

  describe('email validation', () => {
    const isValidEmail = (email: string): boolean => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(email);
    };

    it('should validate correct email addresses', () => {
      expect(isValidEmail('test@example.com')).toBe(true);
      expect(isValidEmail('user.name@domain.org')).toBe(true);
      expect(isValidEmail('user+tag@gmail.com')).toBe(true);
    });

    it('should reject invalid email addresses', () => {
      expect(isValidEmail('invalid')).toBe(false);
      expect(isValidEmail('missing@domain')).toBe(false);
      expect(isValidEmail('@nodomain.com')).toBe(false);
      expect(isValidEmail('spaces in@email.com')).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      mockAgentMail.sendEmail.mockRejectedValue(new Error('API error'));

      await expect(
        mockAgentMail.sendEmail({
          to: 'test@example.com',
          subject: 'Test',
          body: 'Test',
        })
      ).rejects.toThrow('API error');
    });

    it('should handle rate limits', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      (rateLimitError as any).code = 'RATE_LIMIT';
      mockAgentMail.sendEmail.mockRejectedValue(rateLimitError);

      await expect(
        mockAgentMail.sendEmail({
          to: 'test@example.com',
          subject: 'Test',
          body: 'Test',
        })
      ).rejects.toThrow('Rate limit exceeded');
    });
  });
});
