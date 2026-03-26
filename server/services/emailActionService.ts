// Email Action Service - Detects and executes email actions from AI responses
import { agentMailService, PersonaType } from "./agentMailService";
import { fileService } from "./fileService";
import { persistentStorageService } from "./persistentStorageService";
import { broadcastToUser } from "./realtimeSync";
import { db } from "../db";
import { ulysseFiles } from "@shared/schema";
import * as fs from "fs";

interface EmailAction {
  type: 'send' | 'reply' | 'read' | 'markRead' | 'sendWithPdf' | 'sendWithWord' | 'sendWithExcel' | 'previewPdf' | 'previewWord' | 'fetchLatest' | 'getInbox';
  to?: string;
  subject?: string;
  body?: string;
  threadId?: string;
  messageId?: string;
  pdfTitle?: string;
  pdfContent?: string;
  wordTitle?: string;
  wordContent?: string;
  excelData?: string;
  limit?: number;
  category?: string;
}

// Content validation thresholds
const CONTENT_VALIDATION = {
  MIN_PDF_CONTENT_LENGTH: 100,    // Minimum 100 characters for PDF content
  MIN_WORD_CONTENT_LENGTH: 50,    // Minimum 50 characters for Word content
  MIN_SECTIONS: 1,                 // At least 1 paragraph/section
  WARN_SHORT_CONTENT: 300,        // Warn if content is shorter than this
};

interface ActionResult {
  success: boolean;
  action: EmailAction;
  messageId?: string;
  error?: string;
  // File attachment info (for display in chat card)
  attachmentInfo?: {
    fileName: string;
    storagePath: string;
    mimeType: string;
    sizeBytes: number;
  };
}

// Patterns to detect email actions in AI response
// NOTE: For pdfContent/wordContent, we use a greedy pattern that captures until the LAST "] in the message
// This handles cases where the content itself contains quotes
const EMAIL_ACTION_PATTERNS = {
  // More flexible patterns to capture content with quotes and special chars
  sendConfirmation: /\[EMAIL_ENVOYÉ\s*:\s*to="([^"]+)"\s*,\s*subject="([^"]+)"(?:\s*,\s*body="([^"]*)")?\]/i,
  sendConfirmationAlt: /\[EMAIL_ENVOYÉ\s*:\s*to=([^\s,\]]+)\s*,\s*subject=([^\]]+?)(?:\s*,\s*body=([^\]]+))?\]/i,
  replyConfirmation: /\[RÉPONSE_ENVOYÉE\s*:\s*messageId="([^"]+)"\s*,\s*body="([^"]*)"\]/i,
  replyConfirmationAlt: /\[RÉPONSE_ENVOYÉE\s*:\s*messageId=([^\s,\]]+)\s*,\s*body=([^\]]+)\]/i,
  // Patterns for file attachments - use greedy capture for content, then trim trailing "]
  sendWithPdf: /\[EMAIL_AVEC_PDF\s*:\s*to="([^"]+)"\s*,\s*subject="([^"]+)"\s*,\s*body="([^"]*)"\s*,\s*pdfTitle="([^"]+)"\s*,\s*pdfContent="([\s\S]+)"\]/i,
  sendWithWord: /\[EMAIL_AVEC_WORD\s*:\s*to="([^"]+)"\s*,\s*subject="([^"]+)"\s*,\s*body="([^"]*)"\s*,\s*wordTitle="([^"]+)"\s*,\s*wordContent="([\s\S]+)"\]/i,
  // Fallback: capture truncated content (when AI response is cut off before closing bracket)
  sendWithPdfTruncated: /\[EMAIL_AVEC_PDF\s*:\s*to="([^"]+)"\s*,\s*subject="([^"]+)"\s*,\s*body="([^"]*)"\s*,\s*pdfTitle="([^"]+)"\s*,\s*pdfContent="([\s\S]{100,})$/i,
  sendWithWordTruncated: /\[EMAIL_AVEC_WORD\s*:\s*to="([^"]+)"\s*,\s*subject="([^"]+)"\s*,\s*body="([^"]*)"\s*,\s*wordTitle="([^"]+)"\s*,\s*wordContent="([\s\S]{50,})$/i,
  // NEW: Preview patterns (for validation before sending)
  previewPdf: /\[APERÇU_PDF\s*:\s*to="([^"]+)"\s*,\s*subject="([^"]+)"\s*,\s*body="([^"]*)"\s*,\s*pdfTitle="([^"]+)"\s*,\s*pdfContent="([\s\S]+)"\]/i,
  previewWord: /\[APERÇU_WORD\s*:\s*to="([^"]+)"\s*,\s*subject="([^"]+)"\s*,\s*body="([^"]*)"\s*,\s*wordTitle="([^"]+)"\s*,\s*wordContent="([\s\S]+)"\]/i,
  previewPdfTruncated: /\[APERÇU_PDF\s*:\s*to="([^"]+)"\s*,\s*subject="([^"]+)"\s*,\s*body="([^"]*)"\s*,\s*pdfTitle="([^"]+)"\s*,\s*pdfContent="([\s\S]{100,})$/i,
  // NEW: Email reading actions
  fetchLatest: /\[ACTUALISER_EMAILS\]/i,
  getInbox: /\[LIRE_BOITE_MAIL(?:\s*:\s*limit=(\d+))?\]/i,
  readMessage: /\[LIRE_EMAIL\s*:\s*id="([^"]+)"\]/i,
};

// Structured action markers that AI should include for explicit actions
const STRUCTURED_ACTION_MARKERS = {
  send: /\[ACTION:SEND_EMAIL\]\s*to:\s*(.+?)\s*subject:\s*(.+?)\s*body:\s*([\s\S]+?)\[\/ACTION\]/i,
  reply: /\[ACTION:REPLY_EMAIL\]\s*messageId:\s*(.+?)\s*body:\s*([\s\S]+?)\[\/ACTION\]/i,
};

export interface ContentValidation {
  isValid: boolean;
  warnings: string[];
  errors: string[];
  stats: {
    characterCount: number;
    lineCount: number;
    wordCount: number;
  };
}

export class EmailActionService {
  
  // Normalize escaped quotes in AI response (LLMs sometimes escape quotes)
  private normalizeQuotes(response: string): string {
    // Replace escaped double quotes "" with single "
    return response.replace(/""/g, '"');
  }
  
  // Validate document content before generation
  validateDocumentContent(content: string, type: 'pdf' | 'word'): ContentValidation {
    const result: ContentValidation = {
      isValid: true,
      warnings: [],
      errors: [],
      stats: {
        characterCount: content.length,
        lineCount: content.split('\n').filter(l => l.trim()).length,
        wordCount: content.split(/\s+/).filter(w => w.trim()).length
      }
    };
    
    const minLength = type === 'pdf' 
      ? CONTENT_VALIDATION.MIN_PDF_CONTENT_LENGTH 
      : CONTENT_VALIDATION.MIN_WORD_CONTENT_LENGTH;
    
    // Check minimum content length
    if (content.length < minLength) {
      result.isValid = false;
      result.errors.push(`Le contenu est trop court (${content.length} caractères, minimum requis: ${minLength})`);
    }
    
    // Check for empty or placeholder content
    if (!content.trim() || content.trim() === '...' || content.trim() === '[contenu]') {
      result.isValid = false;
      result.errors.push('Le contenu est vide ou contient un placeholder');
    }
    
    // Warn if content seems short
    if (content.length < CONTENT_VALIDATION.WARN_SHORT_CONTENT && result.isValid) {
      result.warnings.push(`Le contenu semble court (${content.length} caractères). Vérifie que tout le contenu voulu est bien inclus.`);
    }
    
    // Check for minimum structure (at least some line breaks for documents)
    if (result.stats.lineCount < CONTENT_VALIDATION.MIN_SECTIONS && type === 'pdf') {
      result.warnings.push('Le document ne contient qu\'un seul paragraphe. Pense à structurer avec des sections.');
    }
    
    return result;
  }
  
  // Format preview for user validation
  formatPreviewForUser(action: EmailAction): string {
    const validation = this.validateDocumentContent(
      action.pdfContent || action.wordContent || '', 
      action.type === 'previewPdf' ? 'pdf' : 'word'
    );
    
    let preview = `\n📄 **APERÇU DU DOCUMENT**\n`;
    preview += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    preview += `**Destinataire:** ${action.to}\n`;
    preview += `**Objet:** ${action.subject}\n`;
    preview += `**Titre document:** ${action.pdfTitle || action.wordTitle}\n`;
    preview += `**Type:** ${action.type === 'previewPdf' ? 'PDF' : 'Word'}\n`;
    preview += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    preview += `**Statistiques:**\n`;
    preview += `- ${validation.stats.characterCount} caractères\n`;
    preview += `- ${validation.stats.wordCount} mots\n`;
    preview += `- ${validation.stats.lineCount} lignes\n`;
    preview += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    preview += `**Contenu du document:**\n\n`;
    preview += `${action.pdfContent || action.wordContent}\n`;
    preview += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    
    if (validation.errors.length > 0) {
      preview += `\n⛔ **ERREURS (envoi bloqué):**\n`;
      for (const err of validation.errors) {
        preview += `- ${err}\n`;
      }
    }
    
    if (validation.warnings.length > 0) {
      preview += `\n⚠️ **Avertissements:**\n`;
      for (const warn of validation.warnings) {
        preview += `- ${warn}\n`;
      }
    }
    
    if (validation.isValid) {
      preview += `\n✅ **Document prêt à être envoyé.** Réponds "ok" ou "envoie" pour confirmer l'envoi.\n`;
    } else {
      preview += `\n❌ **Document non valide.** Corrige les erreurs et régénère le contenu.\n`;
    }
    
    return preview;
  }
  
  // Parse AI response for email actions
  parseEmailActions(response: string): EmailAction[] {
    const actions: EmailAction[] = [];
    
    // Normalize quotes before parsing
    const normalizedResponse = this.normalizeQuotes(response);

    // Check for structured action markers (preferred)
    const sendMatch = normalizedResponse.match(STRUCTURED_ACTION_MARKERS.send);
    if (sendMatch) {
      actions.push({
        type: 'send',
        to: sendMatch[1].trim(),
        subject: sendMatch[2].trim(),
        body: sendMatch[3].trim()
      });
    }

    const replyMatch = normalizedResponse.match(STRUCTURED_ACTION_MARKERS.reply);
    if (replyMatch) {
      actions.push({
        type: 'reply',
        messageId: replyMatch[1].trim(),
        body: replyMatch[2].trim()
      });
    }

    // Check for send confirmation markers (try both patterns)
    let simpleConfirm = normalizedResponse.match(EMAIL_ACTION_PATTERNS.sendConfirmation);
    if (!simpleConfirm) {
      simpleConfirm = normalizedResponse.match(EMAIL_ACTION_PATTERNS.sendConfirmationAlt);
    }
    if (simpleConfirm) {
      actions.push({
        type: 'send',
        to: simpleConfirm[1].trim(),
        subject: simpleConfirm[2].trim(),
        body: simpleConfirm[3]?.trim() || ''
      });
      console.log(`[EmailAction] Parsed send action: to=${simpleConfirm[1]}, subject=${simpleConfirm[2]}`);
    }

    // Check for reply confirmation markers (try both patterns)
    let replyConfirm = normalizedResponse.match(EMAIL_ACTION_PATTERNS.replyConfirmation);
    if (!replyConfirm) {
      replyConfirm = normalizedResponse.match(EMAIL_ACTION_PATTERNS.replyConfirmationAlt);
    }
    if (replyConfirm) {
      actions.push({
        type: 'reply',
        messageId: replyConfirm[1].trim(),
        body: replyConfirm[2].trim()
      });
      console.log(`[EmailAction] Parsed reply action: messageId=${replyConfirm[1]}`);
    }

    // Check for PDF attachment email (try complete pattern first, then truncated fallback)
    let pdfMatch = normalizedResponse.match(EMAIL_ACTION_PATTERNS.sendWithPdf);
    let pdfTruncated = false;
    if (!pdfMatch) {
      pdfMatch = normalizedResponse.match(EMAIL_ACTION_PATTERNS.sendWithPdfTruncated);
      pdfTruncated = !!pdfMatch;
    }
    if (pdfMatch) {
      // Clean up content that may have trailing quotes/brackets from truncation
      let pdfContent = pdfMatch[5].trim().replace(/\\n/g, '\n');
      // Remove any trailing incomplete patterns like ", or "] at the end
      pdfContent = pdfContent.replace(/["',\s\]]+$/, '');
      
      actions.push({
        type: 'sendWithPdf',
        to: pdfMatch[1].trim(),
        subject: pdfMatch[2].trim(),
        body: pdfMatch[3].trim(),
        pdfTitle: pdfMatch[4].trim(),
        pdfContent
      });
      console.log(`[EmailAction] Parsed PDF email action: to=${pdfMatch[1]}, pdfTitle=${pdfMatch[4]}, truncated=${pdfTruncated}, contentLength=${pdfContent.length}`);
    }

    // Check for Word attachment email (try complete pattern first, then truncated fallback)
    let wordMatch = normalizedResponse.match(EMAIL_ACTION_PATTERNS.sendWithWord);
    let wordTruncated = false;
    if (!wordMatch) {
      wordMatch = normalizedResponse.match(EMAIL_ACTION_PATTERNS.sendWithWordTruncated);
      wordTruncated = !!wordMatch;
    }
    if (wordMatch) {
      let wordContent = wordMatch[5].trim().replace(/\\n/g, '\n');
      wordContent = wordContent.replace(/["',\s\]]+$/, '');
      
      actions.push({
        type: 'sendWithWord',
        to: wordMatch[1].trim(),
        subject: wordMatch[2].trim(),
        body: wordMatch[3].trim(),
        wordTitle: wordMatch[4].trim(),
        wordContent
      });
      console.log(`[EmailAction] Parsed Word email action: to=${wordMatch[1]}, wordTitle=${wordMatch[4]}, truncated=${wordTruncated}`);
    }

    // Check for PDF preview (validation before sending) - try complete then truncated
    let previewPdfMatch = normalizedResponse.match(EMAIL_ACTION_PATTERNS.previewPdf);
    let previewPdfTruncated = false;
    if (!previewPdfMatch) {
      previewPdfMatch = normalizedResponse.match(EMAIL_ACTION_PATTERNS.previewPdfTruncated);
      previewPdfTruncated = !!previewPdfMatch;
    }
    if (previewPdfMatch) {
      let pdfContent = previewPdfMatch[5].trim().replace(/\\n/g, '\n');
      pdfContent = pdfContent.replace(/["',\s\]]+$/, '');
      
      actions.push({
        type: 'previewPdf',
        to: previewPdfMatch[1].trim(),
        subject: previewPdfMatch[2].trim(),
        body: previewPdfMatch[3].trim(),
        pdfTitle: previewPdfMatch[4].trim(),
        pdfContent
      });
      console.log(`[EmailAction] Parsed PDF preview action: pdfTitle=${previewPdfMatch[4]}, contentLength=${pdfContent.length}, truncated=${previewPdfTruncated}`);
    }

    // Check for Word preview (validation before sending)
    const previewWordMatch = normalizedResponse.match(EMAIL_ACTION_PATTERNS.previewWord);
    if (previewWordMatch) {
      let wordContent = previewWordMatch[5].trim().replace(/\\n/g, '\n');
      wordContent = wordContent.replace(/["',\s\]]+$/, '');
      
      actions.push({
        type: 'previewWord',
        to: previewWordMatch[1].trim(),
        subject: previewWordMatch[2].trim(),
        body: previewWordMatch[3].trim(),
        wordTitle: previewWordMatch[4].trim(),
        wordContent
      });
      console.log(`[EmailAction] Parsed Word preview action: wordTitle=${previewWordMatch[4]}, contentLength=${wordContent.length}`);
    }

    // Check for fetch latest emails action
    const fetchLatestMatch = normalizedResponse.match(EMAIL_ACTION_PATTERNS.fetchLatest);
    if (fetchLatestMatch) {
      actions.push({ type: 'fetchLatest' });
      console.log(`[EmailAction] Parsed fetchLatest action`);
    }

    // Check for read inbox action
    const getInboxMatch = normalizedResponse.match(EMAIL_ACTION_PATTERNS.getInbox);
    if (getInboxMatch) {
      actions.push({ 
        type: 'getInbox',
        limit: getInboxMatch[1] ? parseInt(getInboxMatch[1]) : 10
      });
      console.log(`[EmailAction] Parsed getInbox action, limit=${getInboxMatch[1] || 10}`);
    }

    // Check for read specific message action
    const readMessageMatch = normalizedResponse.match(EMAIL_ACTION_PATTERNS.readMessage);
    if (readMessageMatch) {
      actions.push({
        type: 'read',
        messageId: readMessageMatch[1].trim()
      });
      console.log(`[EmailAction] Parsed read message action: messageId=${readMessageMatch[1]}`);
    }

    return actions;
  }

  // Execute detected email actions
  async executeActions(actions: EmailAction[], persona: PersonaType = 'ulysse', userId?: number): Promise<ActionResult[]> {
    const results: ActionResult[] = [];

    for (const action of actions) {
      try {
        console.log(`[EmailAction] Executing ${action.type} action for ${persona}`);
        
        switch (action.type) {
          case 'send':
            if (action.to && action.subject) {
              const sendResult = await agentMailService.sendEmail({
                to: action.to,
                subject: action.subject,
                body: action.body || ''
              }, persona, userId);
              results.push({
                success: sendResult.success,
                action,
                messageId: sendResult.messageId,
                error: sendResult.success ? undefined : sendResult.details
              });
              console.log(`[EmailAction] Email ${sendResult.deliveryStatus || 'unknown'} to ${action.to} from ${persona} (tracking: ${sendResult.trackingId})`);
              if (sendResult.details) {
                console.log(`[EmailAction] Details: ${sendResult.details}`);
              }
            } else {
              results.push({
                success: false,
                action,
                error: 'Missing to or subject'
              });
            }
            break;

          case 'reply':
            if (action.messageId && action.body) {
              const replyResult = await agentMailService.replyToMessage(action.messageId, action.body, persona);
              results.push({
                success: replyResult.success,
                action,
                messageId: replyResult.messageId
              });
              console.log(`[EmailAction] Reply sent to ${action.messageId} from ${persona}: ${replyResult.success}`);
            } else {
              results.push({
                success: false,
                action,
                error: 'Missing messageId or body'
              });
            }
            break;

          case 'sendWithPdf':
            if (action.to && action.subject && action.pdfContent) {
              // VALIDATION GATE: Block sending if content is invalid
              const pdfValidation = this.validateDocumentContent(action.pdfContent, 'pdf');
              if (!pdfValidation.isValid) {
                const errorMsg = `PDF bloqué - Contenu invalide: ${pdfValidation.errors.join(', ')}`;
                console.error(`[EmailAction] ${errorMsg}`);
                results.push({
                  success: false,
                  action,
                  error: errorMsg
                });
                break;
              }
              
              // Log warnings but proceed
              if (pdfValidation.warnings.length > 0) {
                console.warn(`[EmailAction] PDF warnings: ${pdfValidation.warnings.join(', ')}`);
              }
              
              try {
                // Generate PDF file
                const pdfFile = await fileService.generatePDF(action.pdfContent, { title: action.pdfTitle });
                console.log(`[EmailAction] PDF generated: ${pdfFile.filePath} (${pdfValidation.stats.characterCount} chars, ${pdfValidation.stats.wordCount} words)`);
                
                // Read file content
                const pdfBuffer = fs.readFileSync(pdfFile.filePath);
                
                // Save copy to Object Storage and database (permanent storage)
                let attachmentInfo: ActionResult['attachmentInfo'] = undefined;
                if (userId && persistentStorageService.isConfigured()) {
                  try {
                    const storedFile = await persistentStorageService.uploadBuffer(
                      pdfBuffer,
                      pdfFile.fileName,
                      "generated",
                      userId
                    );
                    
                    // Save metadata to database
                    const [createdFile] = await db.insert(ulysseFiles).values({
                      userId,
                      filename: pdfFile.fileName,
                      originalName: action.pdfTitle || pdfFile.fileName,
                      mimeType: 'application/pdf',
                      sizeBytes: pdfBuffer.length,
                      storagePath: storedFile.objectPath,
                      description: `PDF envoyé à ${action.to}: ${action.subject}`,
                      generatedBy: persona,
                      category: 'generated'
                    }).returning();
                    
                    // Notify connected clients about new file in real-time
                    broadcastToUser(userId, {
                      type: "files.updated",
                      userId,
                      data: { fileId: createdFile.id, action: "created", fileName: pdfFile.fileName },
                      timestamp: Date.now()
                    });
                    
                    // Store attachment info for chat card display (ensure .pdf extension)
                    const displayName = action.pdfTitle ? 
                      (action.pdfTitle.toLowerCase().endsWith('.pdf') ? action.pdfTitle : `${action.pdfTitle}.pdf`) : 
                      pdfFile.fileName;
                    attachmentInfo = {
                      fileName: displayName,
                      storagePath: storedFile.objectPath,
                      mimeType: 'application/pdf',
                      sizeBytes: pdfBuffer.length
                    };
                    
                    console.log(`[EmailAction] PDF copy saved to storage: ${storedFile.objectPath}`);
                  } catch (storageError: any) {
                    console.error(`[EmailAction] Failed to save PDF copy to storage:`, storageError.message);
                    // Continue - email sending is more important
                  }
                }
                
                // Send email with attachment
                const sendResult = await agentMailService.sendEmailWithAttachments({
                  to: action.to,
                  subject: action.subject,
                  body: action.body || '',
                  attachments: [{
                    filename: pdfFile.fileName,
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                  }]
                }, persona);
                
                // Cleanup temp file
                fs.unlinkSync(pdfFile.filePath);
                
                results.push({
                  success: sendResult.success,
                  action,
                  messageId: sendResult.messageId,
                  attachmentInfo
                });
                console.log(`[EmailAction] PDF email sent to ${action.to} from ${persona}: ${sendResult.success}`);
              } catch (pdfError: any) {
                console.error(`[EmailAction] PDF generation/send error:`, pdfError);
                results.push({
                  success: false,
                  action,
                  error: `PDF error: ${pdfError.message}`
                });
              }
            } else {
              results.push({
                success: false,
                action,
                error: 'Missing to, subject, or pdfContent'
              });
            }
            break;

          case 'sendWithWord':
            if (action.to && action.subject && action.wordContent) {
              // VALIDATION GATE: Block sending if content is invalid
              const wordValidation = this.validateDocumentContent(action.wordContent, 'word');
              if (!wordValidation.isValid) {
                const errorMsg = `Word bloqué - Contenu invalide: ${wordValidation.errors.join(', ')}`;
                console.error(`[EmailAction] ${errorMsg}`);
                results.push({
                  success: false,
                  action,
                  error: errorMsg
                });
                break;
              }
              
              // Log warnings but proceed
              if (wordValidation.warnings.length > 0) {
                console.warn(`[EmailAction] Word warnings: ${wordValidation.warnings.join(', ')}`);
              }
              
              try {
                // Generate Word file
                const wordFile = await fileService.generateWord(action.wordContent, { title: action.wordTitle });
                console.log(`[EmailAction] Word generated: ${wordFile.filePath} (${wordValidation.stats.characterCount} chars, ${wordValidation.stats.wordCount} words)`);
                
                // Read file content
                const wordBuffer = fs.readFileSync(wordFile.filePath);
                
                // Save copy to Object Storage and database (permanent storage)
                let attachmentInfo: ActionResult['attachmentInfo'] = undefined;
                if (userId && persistentStorageService.isConfigured()) {
                  try {
                    const storedFile = await persistentStorageService.uploadBuffer(
                      wordBuffer,
                      wordFile.fileName,
                      "generated",
                      userId
                    );
                    
                    // Save metadata to database
                    const [createdWordFile] = await db.insert(ulysseFiles).values({
                      userId,
                      filename: wordFile.fileName,
                      originalName: action.wordTitle || wordFile.fileName,
                      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                      sizeBytes: wordBuffer.length,
                      storagePath: storedFile.objectPath,
                      description: `Word envoyé à ${action.to}: ${action.subject}`,
                      generatedBy: persona,
                      category: 'generated'
                    }).returning();
                    
                    // Notify connected clients about new file in real-time
                    broadcastToUser(userId, {
                      type: "files.updated",
                      userId,
                      data: { fileId: createdWordFile.id, action: "created", fileName: wordFile.fileName },
                      timestamp: Date.now()
                    });
                    
                    // Store attachment info for chat card display (ensure .docx extension)
                    const displayName = action.wordTitle ? 
                      (action.wordTitle.toLowerCase().endsWith('.docx') ? action.wordTitle : `${action.wordTitle}.docx`) : 
                      wordFile.fileName;
                    attachmentInfo = {
                      fileName: displayName,
                      storagePath: storedFile.objectPath,
                      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                      sizeBytes: wordBuffer.length
                    };
                    
                    console.log(`[EmailAction] Word copy saved to storage: ${storedFile.objectPath}`);
                  } catch (storageError: any) {
                    console.error(`[EmailAction] Failed to save Word copy to storage:`, storageError.message);
                    // Continue - email sending is more important
                  }
                }
                
                // Send email with attachment
                const sendResult = await agentMailService.sendEmailWithAttachments({
                  to: action.to,
                  subject: action.subject,
                  body: action.body || '',
                  attachments: [{
                    filename: wordFile.fileName,
                    content: wordBuffer,
                    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                  }]
                }, persona);
                
                // Cleanup temp file
                fs.unlinkSync(wordFile.filePath);
                
                results.push({
                  success: sendResult.success,
                  action,
                  messageId: sendResult.messageId,
                  attachmentInfo
                });
                console.log(`[EmailAction] Word email sent to ${action.to} from ${persona}: ${sendResult.success}`);
              } catch (wordError: any) {
                console.error(`[EmailAction] Word generation/send error:`, wordError);
                results.push({
                  success: false,
                  action,
                  error: `Word error: ${wordError.message}`
                });
              }
            } else {
              results.push({
                success: false,
                action,
                error: 'Missing to, subject, or wordContent'
              });
            }
            break;

          case 'fetchLatest':
            try {
              const fetchResult = await agentMailService.fetchAndStoreEmails();
              results.push({
                success: true,
                action,
                messageId: `fetched:${fetchResult.newEmails}new,${fetchResult.processed}processed`
              });
              console.log(`[EmailAction] Fetched emails: ${fetchResult.summary}`);
            } catch (fetchError: any) {
              results.push({
                success: false,
                action,
                error: `Fetch error: ${fetchError.message}`
              });
            }
            break;

          case 'getInbox':
            try {
              const emails = await agentMailService.getStoredEmails(userId || 1, { limit: action.limit || 10 });
              results.push({
                success: true,
                action,
                messageId: `inbox:${emails.length}emails`
              });
              console.log(`[EmailAction] Retrieved ${emails.length} emails from inbox`);
            } catch (inboxError: any) {
              results.push({
                success: false,
                action,
                error: `Inbox error: ${inboxError.message}`
              });
            }
            break;

          case 'read':
            if (action.messageId) {
              try {
                await agentMailService.markAsRead(action.messageId);
                results.push({
                  success: true,
                  action,
                  messageId: action.messageId
                });
                console.log(`[EmailAction] Marked message as read: ${action.messageId}`);
              } catch (readError: any) {
                results.push({
                  success: false,
                  action,
                  error: `Read error: ${readError.message}`
                });
              }
            } else {
              results.push({
                success: false,
                action,
                error: 'Missing messageId'
              });
            }
            break;

          default:
            results.push({
              success: false,
              action,
              error: `Unknown action type: ${action.type}`
            });
        }
      } catch (error: any) {
        console.error(`[EmailAction] Error executing ${action.type}:`, error);
        results.push({
          success: false,
          action,
          error: error.message
        });
      }
    }

    return results;
  }

  // Check if user message is requesting an email action
  detectEmailIntent(userMessage: string): { intent: 'send' | 'reply' | 'read' | 'none'; details?: any } {
    const lower = userMessage.toLowerCase();

    // Check for send intent
    if (/(envoie|envoi|écris|rédige|compose).*(email|mail|message).*(?:à|pour|to)/i.test(userMessage)) {
      return { intent: 'send' };
    }

    // Check for reply intent
    if (/(réponds|répondre|reply).*(email|mail|message)/i.test(userMessage)) {
      return { intent: 'reply' };
    }

    // Check for read intent
    if (/(lis|lire|montre|affiche|read|show).*(email|mail|inbox|boîte)/i.test(userMessage)) {
      return { intent: 'read' };
    }

    // Check for confirmation after draft
    if (/^(oui|yes|ok|go|envoie|vas-y|confirme|confirmed?|parfait)$/i.test(lower.trim())) {
      return { intent: 'send', details: { confirmationOnly: true } };
    }

    return { intent: 'none' };
  }

  // Build instruction for AI to handle email actions properly
  getEmailActionInstructions(): string {
    return `
ACTIONS EMAIL - Tu peux vraiment envoyer ET LIRE des emails:

═══════════════════════════════════════════════════════════════
LECTURE DES EMAILS (TRÈS IMPORTANT)
═══════════════════════════════════════════════════════════════

Les emails sont AUTOMATIQUEMENT injectés dans ton contexte quand Maurice parle d'emails.
Tu verras une section "📧 Boîte AgentMail" avec les emails récents.
UTILISE CES INFORMATIONS directement - tu LIS vraiment les emails!

Si tu veux forcer une actualisation des emails:
[ACTUALISER_EMAILS]
→ Récupère les nouveaux emails depuis AgentMail

Si tu as besoin de lire la boîte mail explicitement:
[LIRE_BOITE_MAIL] ou [LIRE_BOITE_MAIL: limit=20]
→ Récupère les X derniers emails stockés

RÈGLE ABSOLUE: Quand tu vois des emails dans ton contexte, UTILISE-LES pour répondre!
Ne dis JAMAIS "je ne peux pas voir tes emails" si tu vois la section emails.

═══════════════════════════════════════════════════════════════
ENVOI D'EMAILS
═══════════════════════════════════════════════════════════════

EMAIL SIMPLE (pas d'aperçu requis):
[EMAIL_ENVOYÉ: to="destinataire@email.com", subject="Sujet", body="Contenu"]

RÉPONDRE À UN EMAIL:
[RÉPONSE_ENVOYÉE: messageId="xxx", body="Contenu de la réponse"]

═══════════════════════════════════════════════════════════════
DOCUMENTS ATTACHÉS (PDF/WORD)
═══════════════════════════════════════════════════════════════

Pour tout envoi de PDF ou Word, tu DOIS d'abord montrer un APERÇU avant l'envoi.

ÉTAPE 1 - APERÇU (OBLIGATOIRE pour PDF/Word):
[APERÇU_PDF: to="email", subject="Sujet", body="Message", pdfTitle="Titre", pdfContent="CONTENU COMPLET ICI"]
[APERÇU_WORD: to="email", subject="Sujet", body="Message", wordTitle="Titre", wordContent="CONTENU COMPLET ICI"]

ÉTAPE 2 - ENVOI (après confirmation utilisateur):
[EMAIL_AVEC_PDF: to="email", subject="Sujet", body="Message", pdfTitle="Titre", pdfContent="CONTENU COMPLET ICI"]
[EMAIL_AVEC_WORD: to="email", subject="Sujet", body="Message", wordTitle="Titre", wordContent="CONTENU COMPLET ICI"]

RÈGLES CONTENU PDF:
- Minimum 100 caractères requis (sinon erreur)
- Moins de 300 caractères = avertissement "contenu court"
- Ne JAMAIS mettre de placeholder comme "..." ou "[contenu]"

═══════════════════════════════════════════════════════════════
Ces marqueurs déclenchent des actions réelles via AgentMail.
`;
  }
}

export const emailActionService = new EmailActionService();
