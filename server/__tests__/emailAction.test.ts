import { describe, it, expect } from 'vitest';
import { emailActionService, ContentValidation } from '../services/emailActionService';

describe('Email Action Parsing', () => {
  describe('Simple email send', () => {
    it('should parse basic email send marker', () => {
      const response = '[EMAIL_ENVOYÉ: to="test@example.com", subject="Test Subject", body="Test body"]';
      const actions = emailActionService.parseEmailActions(response);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('send');
      expect(actions[0].to).toBe('test@example.com');
      expect(actions[0].subject).toBe('Test Subject');
    });

    it('should handle email without body', () => {
      const response = '[EMAIL_ENVOYÉ: to="user@domain.com", subject="Subject only"]';
      const actions = emailActionService.parseEmailActions(response);
      expect(actions).toHaveLength(1);
      expect(actions[0].to).toBe('user@domain.com');
    });
  });

  describe('PDF email send', () => {
    it('should parse PDF attachment email', () => {
      const response = `[EMAIL_AVEC_PDF: to="user@test.com", subject="Rapport", body="Voici le rapport", pdfTitle="Rapport_2026", pdfContent="Ce rapport contient une analyse détaillée des performances de l'équipe sur la période écoulée avec des recommandations précises."]`;
      const actions = emailActionService.parseEmailActions(response);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('sendWithPdf');
      expect(actions[0].pdfTitle).toBe('Rapport_2026');
      expect(actions[0].pdfContent).toContain('analyse détaillée');
    });

    it('should handle truncated PDF content', () => {
      const truncatedContent = 'A'.repeat(150);
      const response = `[EMAIL_AVEC_PDF: to="user@test.com", subject="Doc", body="Body", pdfTitle="Title", pdfContent="${truncatedContent}`;
      const actions = emailActionService.parseEmailActions(response);
      expect(actions).toHaveLength(1);
      expect(actions[0].pdfContent?.length).toBeGreaterThanOrEqual(100);
    });

    it('should handle newlines in PDF content', () => {
      const response = `[EMAIL_AVEC_PDF: to="user@test.com", subject="Doc", body="Body", pdfTitle="Title", pdfContent="Line 1\\nLine 2\\nLine 3 with more content to reach minimum length requirement for validation."]`;
      const actions = emailActionService.parseEmailActions(response);
      expect(actions).toHaveLength(1);
      expect(actions[0].pdfContent).toContain('\n');
    });
  });

  describe('PDF preview', () => {
    it('should parse PDF preview marker', () => {
      const response = `[APERÇU_PDF: to="user@test.com", subject="Preview", body="Body", pdfTitle="Preview_Doc", pdfContent="Preview content that is long enough to pass validation minimum length requirement."]`;
      const actions = emailActionService.parseEmailActions(response);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('previewPdf');
    });
  });

  describe('Reply email', () => {
    it('should parse reply confirmation marker', () => {
      const response = '[RÉPONSE_ENVOYÉE: messageId="msg123", body="Merci pour votre message"]';
      const actions = emailActionService.parseEmailActions(response);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('reply');
      expect(actions[0].messageId).toBe('msg123');
    });
  });
});

describe('Content Validation', () => {
  describe('PDF content validation', () => {
    it('should reject content shorter than minimum', () => {
      const result = emailActionService.validateDocumentContent('Too short', 'pdf');
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should accept content meeting minimum length', () => {
      const validContent = 'A'.repeat(150);
      const result = emailActionService.validateDocumentContent(validContent, 'pdf');
      expect(result.isValid).toBe(true);
    });

    it('should warn about short but valid content', () => {
      const shortContent = 'A'.repeat(150);
      const result = emailActionService.validateDocumentContent(shortContent, 'pdf');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should reject content with placeholder', () => {
      const placeholderContent = '[contenu]';
      const result = emailActionService.validateDocumentContent(placeholderContent, 'pdf');
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('placeholder'))).toBe(true);
    });

    it('should calculate stats correctly', () => {
      const content = 'Word one two three\nLine two here\nThird line plus extra content to meet minimum requirements for validation.';
      const result = emailActionService.validateDocumentContent(content, 'word');
      expect(result.stats.lineCount).toBeGreaterThanOrEqual(3);
      expect(result.stats.wordCount).toBeGreaterThan(5);
    });
  });

  describe('Word content validation', () => {
    it('should have lower minimum for Word documents', () => {
      const shortForPdf = 'A'.repeat(60);
      const pdfResult = emailActionService.validateDocumentContent(shortForPdf, 'pdf');
      const wordResult = emailActionService.validateDocumentContent(shortForPdf, 'word');
      expect(pdfResult.isValid).toBe(false);
      expect(wordResult.isValid).toBe(true);
    });
  });
});

describe('Edge Cases', () => {
  it('should handle empty response', () => {
    const actions = emailActionService.parseEmailActions('');
    expect(actions).toHaveLength(0);
  });

  it('should handle response with no markers', () => {
    const actions = emailActionService.parseEmailActions('Just a normal response without any email markers.');
    expect(actions).toHaveLength(0);
  });

  it('should handle special characters in content', () => {
    const response = `[EMAIL_ENVOYÉ: to="user@test.com", subject="Test avec accents éàü", body="Contenu avec caractères spéciaux"]`;
    const actions = emailActionService.parseEmailActions(response);
    expect(actions).toHaveLength(1);
    expect(actions[0].subject).toContain('accents');
  });

  it('should handle email reading actions', () => {
    const response = '[ACTUALISER_EMAILS]';
    const actions = emailActionService.parseEmailActions(response);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('fetchLatest');
  });

  it('should handle inbox listing with limit', () => {
    const response = '[LIRE_BOITE_MAIL: limit=5]';
    const actions = emailActionService.parseEmailActions(response);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('getInbox');
    expect(actions[0].limit).toBe(5);
  });
});
