// AgentMail Service - Direct API
// Enables Ulysse to receive, read, and reply to emails

import { db } from "../db";
import { agentmailMessages, agentmailAttachments, agentmailSendHistory, ulysseMemory, ulysseFiles } from "@shared/schema";
import { eq, desc, and, lt, sql } from "drizzle-orm";
import { getOwnerUserId } from "./knowledgeSync";
import { persistentStorageService } from "./persistentStorageService";
import { broadcastToUser } from "./realtimeSync";
import { globalOptimizerService } from "./globalOptimizerService";
import { agentMailSecurityService } from "./agentMailSecurity";
import { connectorBridge } from './connectorBridge';

let AgentMailClientClass: any = null;
async function loadAgentMail() {
  if (!AgentMailClientClass) {
    try {
      const mod = await import('agentmail');
      AgentMailClientClass = (mod as any).AgentMailClient || (mod as any).default;
    } catch {
      console.warn("[AgentMail] agentmail package not available");
      return null;
    }
  }
  return AgentMailClientClass;
}

async function getCredentials() {
  const conn = await connectorBridge.getAgentMail();
  if (conn.source === 'none' || !conn.apiKey) {
    throw new Error('AgentMail not configured. Set AGENTMAIL_API_KEY.');
  }
  return { apiKey: conn.apiKey };
}

async function getClient(): Promise<any> {
  const ClientClass = await loadAgentMail();
  if (!ClientClass) throw new Error('agentmail package not available');
  const { apiKey } = await getCredentials();
  return new ClientClass({ apiKey });
}

export interface EmailMessage {
  id: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
  timestamp: Date;
  isRead?: boolean;
  threadId?: string;
}

export interface EmailThread {
  id: string;
  subject: string;
  preview: string;
  messageCount: number;
  timestamp: Date;
  senders: string[];
  recipients: string[];
}

export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
  replyToMessageId?: string;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType: string;
  }>;
}

export interface EmailAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url?: string;
}

// Email addresses for each persona
const ULYSSE_EMAIL = 'ulysse@agentmail.to';
const IRIS_EMAIL = 'iris-assist@agentmail.to';
const ALFRED_EMAIL = 'max-assist@agentmail.to';

export type PersonaType = 'ulysse' | 'iris' | 'alfred';

class AgentMailService {
  private ulysseInboxId: string | null = null;
  private ulysseInboxAddress: string | null = null;
  private irisInboxId: string | null = null;
  private irisInboxAddress: string | null = null;
  private alfredInboxId: string | null = null;
  private alfredInboxAddress: string | null = null;

  async isConnected(): Promise<boolean> {
    try {
      await getCredentials();
      return true;
    } catch {
      return false;
    }
  }

  // Get inbox for a specific persona
  async getOrCreateInboxForPersona(persona: PersonaType): Promise<{ id: string; address: string }> {
    // Check cache first
    if (persona === 'ulysse' && this.ulysseInboxId && this.ulysseInboxAddress) {
      return { id: this.ulysseInboxId, address: this.ulysseInboxAddress };
    }
    if (persona === 'iris' && this.irisInboxId && this.irisInboxAddress) {
      return { id: this.irisInboxId, address: this.irisInboxAddress };
    }
    if (persona === 'alfred' && this.alfredInboxId && this.alfredInboxAddress) {
      return { id: this.alfredInboxId, address: this.alfredInboxAddress };
    }

    const targetEmail = persona === 'ulysse' ? ULYSSE_EMAIL : persona === 'alfred' ? ALFRED_EMAIL : IRIS_EMAIL;
    const targetUsername = persona === 'ulysse' ? 'ulysse' : persona === 'alfred' ? 'max-assist' : 'iris-assist';
    const displayName = persona === 'ulysse' ? 'Ulysse - Assistant Personnel' : persona === 'alfred' ? 'Max - Assistant Externe' : 'Iris - Assistant Familial';

    try {
      const client = await getClient();
      
      // List existing inboxes
      let inboxes: any[] = [];
      const response: any = await client.inboxes.list();
      
      if (Array.isArray(response)) {
        inboxes = response;
      } else if (response?.inboxes) {
        inboxes = response.inboxes;
      } else if (response?.data) {
        inboxes = Array.isArray(response.data) ? response.data : [response.data];
      } else if (response?.items) {
        inboxes = response.items;
      }
      
      console.log(`[AGENTMAIL] Looking for ${persona} inbox (${targetEmail})...`);
      
      // Look for the specific inbox
      let inbox = inboxes.find((i: any) => {
        const id = (i.inboxId || i.inbox_id || i.id || '').toLowerCase();
        return id === targetEmail.toLowerCase() || id.includes(targetUsername);
      });
      
      if (inbox) {
        const inboxIdValue = inbox.inboxId || inbox.inbox_id || inbox.id;
        console.log(`[AGENTMAIL] Found ${persona} inbox: ${inboxIdValue}`);
        
        if (persona === 'ulysse') {
          this.ulysseInboxId = inboxIdValue;
          this.ulysseInboxAddress = inboxIdValue;
        } else if (persona === 'alfred') {
          this.alfredInboxId = inboxIdValue;
          this.alfredInboxAddress = inboxIdValue;
        } else {
          this.irisInboxId = inboxIdValue;
          this.irisInboxAddress = inboxIdValue;
        }
        
        return { id: inboxIdValue, address: inboxIdValue };
      }

      // Create new inbox for this persona
      console.log(`[AGENTMAIL] Creating new inbox for ${persona}...`);
      const newInbox: any = await client.inboxes.create({
        username: targetUsername,
        displayName: displayName
      });
      
      console.log(`[AGENTMAIL] Created ${persona} inbox:`, JSON.stringify(newInbox, null, 2));

      const newInboxId = newInbox.inboxId || newInbox.inbox_id || newInbox.id;
      const newInboxAddress = newInbox.email || newInbox.emailAddress || `${targetUsername}@agentmail.to`;
      
      if (persona === 'ulysse') {
        this.ulysseInboxId = newInboxId;
        this.ulysseInboxAddress = newInboxAddress;
      } else if (persona === 'alfred') {
        this.alfredInboxId = newInboxId;
        this.alfredInboxAddress = newInboxAddress;
      } else {
        this.irisInboxId = newInboxId;
        this.irisInboxAddress = newInboxAddress;
      }
      
      return { id: newInboxId, address: newInboxAddress };
    } catch (error: any) {
      console.error(`[AGENTMAIL] Error getting/creating ${persona} inbox:`, error);
      throw new Error(`Failed to setup AgentMail inbox for ${persona}: ` + error.message);
    }
  }

  // Default to Ulysse's inbox for backward compatibility
  async getOrCreateInbox(): Promise<{ id: string; address: string }> {
    return this.getOrCreateInboxForPersona('ulysse');
  }

  async getInboxAddress(persona: PersonaType = 'ulysse'): Promise<string> {
    const inbox = await this.getOrCreateInboxForPersona(persona);
    return inbox.address;
  }

  async listThreads(limit: number = 20, persona: PersonaType = 'ulysse'): Promise<EmailThread[]> {
    return globalOptimizerService.getOrFetch(
      `threads:${persona}:${limit}`,
      "email_inbox",
      async () => {
        try {
          const client = await getClient();
          const inbox = await this.getOrCreateInboxForPersona(persona);
          
          const response: any = await client.inboxes.threads.list(inbox.id, {
            limit: limit
          });

          const threads = response.threads || response.data || [];

          return threads.map((thread: any) => ({
            id: thread.thread_id || thread.id,
            subject: thread.subject || '(Sans objet)',
            preview: thread.preview || '',
            messageCount: thread.message_count || 0,
            timestamp: new Date(thread.timestamp || thread.created_at || Date.now()),
            senders: thread.senders || [],
            recipients: thread.recipients || []
          }));
        } catch (error: any) {
          console.error(`[AGENTMAIL] Error listing threads for ${persona}:`, error);
          throw new Error('Failed to list emails: ' + error.message);
        }
      }
    );
  }

  async getThread(threadId: string, persona: PersonaType = 'ulysse'): Promise<{ thread: EmailThread; messages: (EmailMessage & { attachments?: EmailAttachment[] })[] }> {
    try {
      const client = await getClient();
      const inbox = await this.getOrCreateInboxForPersona(persona);
      
      const response: any = await client.inboxes.threads.get(inbox.id, threadId);

      const thread: EmailThread = {
        id: response.thread_id || response.id,
        subject: response.subject || '(Sans objet)',
        preview: response.preview || '',
        messageCount: response.message_count || 0,
        timestamp: new Date(response.timestamp || Date.now()),
        senders: response.senders || [],
        recipients: response.recipients || []
      };

      const messages: (EmailMessage & { attachments?: EmailAttachment[] })[] = await Promise.all(
        (response.messages || []).map(async (msg: any) => {
          const rawAttachments = msg.attachments || [];
          const attachments: EmailAttachment[] = rawAttachments.map((att: any, index: number) => ({
            id: att.attachmentId || att.attachment_id || att.id || `${msg.message_id || msg.id}-att-${index}`,
            filename: att.filename || att.name || `attachment-${index}`,
            mimeType: att.contentType || att.content_type || att.mimeType || 'application/octet-stream',
            size: att.size || 0
          }));
          
          const fromEmail = msg.from_?.[0]?.email || msg.from || 'unknown';
          const msgSubject = msg.subject || response.subject || '(Sans objet)';
          const msgBody = msg.text || msg.html || '';
          const msgId = msg.message_id || msg.id;
          
          const validation = await agentMailSecurityService.validateMessage(
            msgId,
            fromEmail,
            msgSubject,
            msgBody
          );
          
          const sanitizedBody = validation.isValid 
            ? msgBody 
            : agentMailSecurityService.sanitizeContent(msgBody);
          
          return {
            id: msgId,
            from: fromEmail,
            to: (msg.to || []).map((t: any) => t.email || t),
            subject: msgSubject,
            body: sanitizedBody,
            timestamp: new Date(msg.timestamp || Date.now()),
            isRead: true,
            threadId: thread.id,
            attachments: attachments.length > 0 ? attachments : undefined,
            securityScore: validation.overallScore,
            securityWarnings: validation.recommendations.length > 0 ? validation.recommendations : undefined
          };
        })
      );

      return { thread, messages };
    } catch (error: any) {
      console.error('[AGENTMAIL] Error getting thread:', error);
      throw new Error('Failed to get thread: ' + error.message);
    }
  }

  async sendEmail(params: SendEmailParams, persona: PersonaType = 'ulysse', userId?: number): Promise<{ 
    success: boolean; 
    messageId?: string;
    deliveryStatus?: 'sent' | 'pending' | 'failed';
    details?: string;
    trackingId?: string;
  }> {
    const trackingId = `EMAIL-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const startTime = Date.now();
    const maxAttempts = 3;
    const retryDelayMs = 1000;
    
    console.log(`[AGENTMAIL] ========== EMAIL SEND START ==========`);
    console.log(`[AGENTMAIL] Tracking ID: ${trackingId}`);
    console.log(`[AGENTMAIL] Persona: ${persona}`);
    console.log(`[AGENTMAIL] To: ${params.to}`);
    console.log(`[AGENTMAIL] Subject: ${params.subject}`);
    console.log(`[AGENTMAIL] Body length: ${params.body?.length || 0} chars`);
    console.log(`[AGENTMAIL] Attachments: ${params.attachments?.length || 0}`);
    
    // Security validation for outgoing messages
    const securityCheck = await agentMailSecurityService.validateOutgoingMessage(
      params.to,
      params.subject,
      params.body
    );
    
    if (!securityCheck.valid) {
      console.error(`[AGENTMAIL] [${trackingId}] Security validation failed:`, securityCheck.errors);
      return {
        success: false,
        deliveryStatus: 'failed',
        details: `Security validation failed: ${securityCheck.errors.join(", ")}`,
        trackingId
      };
    }
    console.log(`[AGENTMAIL] [${trackingId}] Security validation passed`);
    
    // Create history record
    const ownerId = userId || await getOwnerUserId() || 1;
    try {
      await db.insert(agentmailSendHistory).values({
        trackingId,
        userId: ownerId,
        persona,
        toAddress: params.to,
        subject: params.subject,
        bodyLength: params.body?.length || 0,
        hasAttachments: (params.attachments?.length || 0) > 0,
        attachmentCount: params.attachments?.length || 0,
        status: 'pending',
        attempts: 0,
        maxAttempts,
      });
    } catch (dbError) {
      console.error(`[AGENTMAIL] [${trackingId}] Failed to create history record:`, dbError);
    }
    
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`[AGENTMAIL] [${trackingId}] Attempt ${attempt}/${maxAttempts}`);
        
        // Update history with attempt count
        await db.update(agentmailSendHistory)
          .set({ attempts: attempt, status: attempt > 1 ? 'retrying' : 'pending', lastAttemptAt: new Date() })
          .where(eq(agentmailSendHistory.trackingId, trackingId));
        
        const client = await getClient();
        console.log(`[AGENTMAIL] [${trackingId}] Client obtained (+${Date.now() - startTime}ms)`);
        
        const inbox = await this.getOrCreateInboxForPersona(persona);
        console.log(`[AGENTMAIL] [${trackingId}] Inbox: ${inbox.address} (ID: ${inbox.id}) (+${Date.now() - startTime}ms)`);

        const result: any = await client.inboxes.messages.send(inbox.id, {
          to: params.to,
          subject: params.subject,
          text: params.body
        });
        
        // Invalidate email cache after sending
        globalOptimizerService.invalidate("email_inbox");
        
        const messageId = result.message_id || result.id;
        const duration = Date.now() - startTime;
        
        console.log(`[AGENTMAIL] [${trackingId}] API Response:`, JSON.stringify(result, null, 2));
        console.log(`[AGENTMAIL] [${trackingId}] Message ID: ${messageId}`);
        console.log(`[AGENTMAIL] [${trackingId}] Total time: ${duration}ms (attempt ${attempt})`);
        console.log(`[AGENTMAIL] ========== EMAIL SEND SUCCESS ==========`);
        
        // Update history with success
        await db.update(agentmailSendHistory)
          .set({ 
            status: 'sent', 
            messageId,
            deliveryStatus: 'sent',
            sentAt: new Date()
          })
          .where(eq(agentmailSendHistory.trackingId, trackingId));
        
        return { 
          success: true, 
          messageId,
          deliveryStatus: 'sent',
          details: `Email envoyé via ${inbox.address} (tracking: ${trackingId}, attempt: ${attempt})`,
          trackingId
        };
      } catch (error: any) {
        lastError = error;
        console.error(`[AGENTMAIL] [${trackingId}] Attempt ${attempt} failed: ${error.message}`);
        
        if (attempt < maxAttempts) {
          const delay = retryDelayMs * Math.pow(2, attempt - 1); // True exponential backoff: 1s, 2s, 4s
          console.log(`[AGENTMAIL] [${trackingId}] Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // All attempts failed
    const duration = Date.now() - startTime;
    console.error(`[AGENTMAIL] [${trackingId}] ========== EMAIL SEND FAILED (all ${maxAttempts} attempts) ==========`);
    console.error(`[AGENTMAIL] [${trackingId}] Final error: ${lastError?.message}`);
    console.error(`[AGENTMAIL] [${trackingId}] Total duration: ${duration}ms`);
    
    // Update history with failure
    await db.update(agentmailSendHistory)
      .set({ 
        status: 'failed', 
        deliveryStatus: 'failed',
        errorMessage: lastError?.message || 'Unknown error'
      })
      .where(eq(agentmailSendHistory.trackingId, trackingId));
    
    return {
      success: false,
      deliveryStatus: 'failed',
      details: `Échec après ${maxAttempts} tentatives: ${lastError?.message} (tracking: ${trackingId})`,
      trackingId
    };
  }
  
  // Test email connectivity at startup
  async testConnectivity(): Promise<{ success: boolean; inboxes: string[]; error?: string }> {
    console.log('[AGENTMAIL] Testing connectivity...');
    try {
      const connected = await this.isConnected();
      if (!connected) {
        return { success: false, inboxes: [], error: 'Not connected to AgentMail' };
      }
      
      const inboxes: string[] = [];
      
      // Test Ulysse inbox
      try {
        const ulysseInbox = await this.getOrCreateInboxForPersona('ulysse');
        inboxes.push(ulysseInbox.address);
        console.log(`[AGENTMAIL] Ulysse inbox OK: ${ulysseInbox.address}`);
      } catch (e: any) {
        console.error('[AGENTMAIL] Ulysse inbox error:', e.message);
      }
      
      // Test Iris inbox
      try {
        const irisInbox = await this.getOrCreateInboxForPersona('iris');
        inboxes.push(irisInbox.address);
        console.log(`[AGENTMAIL] Iris inbox OK: ${irisInbox.address}`);
      } catch (e: any) {
        console.error('[AGENTMAIL] Iris inbox error:', e.message);
      }
      
      // Test Alfred inbox
      try {
        const alfredInbox = await this.getOrCreateInboxForPersona('alfred');
        inboxes.push(alfredInbox.address);
        console.log(`[AGENTMAIL] Alfred inbox OK: ${alfredInbox.address}`);
      } catch (e: any) {
        console.error('[AGENTMAIL] Alfred inbox error:', e.message);
      }
      
      console.log(`[AGENTMAIL] Connectivity test passed. Inboxes: ${inboxes.join(', ')}`);
      return { success: true, inboxes };
    } catch (error: any) {
      console.error('[AGENTMAIL] Connectivity test failed:', error.message);
      return { success: false, inboxes: [], error: error.message };
    }
  }
  
  // Get send history for diagnostics
  async getSendHistory(limit: number = 20): Promise<any[]> {
    try {
      const history = await db.select()
        .from(agentmailSendHistory)
        .orderBy(desc(agentmailSendHistory.createdAt))
        .limit(limit);
      return history;
    } catch (error) {
      console.error('[AGENTMAIL] Error fetching send history:', error);
      return [];
    }
  }
  
  // Retry failed emails that haven't exceeded max attempts
  async retryFailedEmails(): Promise<{ retried: number; succeeded: number }> {
    console.log('[AGENTMAIL] Checking for failed emails to retry...');
    try {
      // Get failed emails where attempts < maxAttempts
      const failedEmails = await db.select()
        .from(agentmailSendHistory)
        .where(and(
          eq(agentmailSendHistory.status, 'failed'),
          sql`${agentmailSendHistory.attempts} < ${agentmailSendHistory.maxAttempts}`
        ))
        .limit(10);
      
      let retried = 0;
      let succeeded = 0;
      
      for (const email of failedEmails) {
        console.log(`[AGENTMAIL] Retrying ${email.trackingId} (attempt ${email.attempts + 1}/${email.maxAttempts})...`);
        const result = await this.sendEmail(
          { to: email.toAddress, subject: email.subject, body: '' },
          email.persona as PersonaType,
          email.userId
        );
        retried++;
        if (result.success) succeeded++;
      }
      
      console.log(`[AGENTMAIL] Retry complete: ${retried} retried, ${succeeded} succeeded`);
      return { retried, succeeded };
    } catch (error) {
      console.error('[AGENTMAIL] Retry failed emails error:', error);
      return { retried: 0, succeeded: 0 };
    }
  }
  
  // Diagnostic function to test AgentMail connection and capabilities
  async runDiagnostics(): Promise<{
    connected: boolean;
    inboxes: { persona: string; address: string; id: string }[];
    capabilities: string[];
    recentActivity: { sent: number; received: number };
    errors: string[];
  }> {
    const errors: string[] = [];
    const inboxes: { persona: string; address: string; id: string }[] = [];
    let sent = 0, received = 0;
    
    console.log('[AGENTMAIL] Running diagnostics...');
    
    try {
      // Test connection
      const connected = await this.isConnected();
      if (!connected) {
        return { connected: false, inboxes: [], capabilities: [], recentActivity: { sent: 0, received: 0 }, errors: ['AgentMail not connected'] };
      }
      
      // Test Ulysse inbox
      try {
        const ulysseInbox = await this.getOrCreateInboxForPersona('ulysse');
        inboxes.push({ persona: 'ulysse', address: ulysseInbox.address, id: ulysseInbox.id });
        
        // Count threads
        const threads = await this.listThreads(50, 'ulysse');
        received = threads.length;
      } catch (e: any) {
        errors.push(`Ulysse inbox: ${e.message}`);
      }
      
      // Test Iris inbox
      try {
        const irisInbox = await this.getOrCreateInboxForPersona('iris');
        inboxes.push({ persona: 'iris', address: irisInbox.address, id: irisInbox.id });
      } catch (e: any) {
        errors.push(`Iris inbox: ${e.message}`);
      }
      
      // Check DB for total emails count
      try {
        const allEmails = await db.select()
          .from(agentmailMessages)
          .limit(100);
        // Estimate sent based on emails where 'from' contains our inbox addresses
        sent = allEmails.filter(e => 
          e.from?.includes('ulysse@agentmail.to') || 
          e.from?.includes('iris-assist@agentmail.to')
        ).length;
      } catch (e: any) {
        errors.push(`DB query: ${e.message}`);
      }
      
      const capabilities = [
        'receive_emails',
        'send_emails',
        'reply_to_threads',
        'attachments_download',
        'attachments_send',
        'dual_persona_ulysse_iris'
      ];
      
      console.log('[AGENTMAIL] Diagnostics complete:', { connected: true, inboxes: inboxes.length, sent, received, errors: errors.length });
      
      return {
        connected: true,
        inboxes,
        capabilities,
        recentActivity: { sent, received },
        errors
      };
    } catch (error: any) {
      console.error('[AGENTMAIL] Diagnostics failed:', error.message);
      return {
        connected: false,
        inboxes: [],
        capabilities: [],
        recentActivity: { sent: 0, received: 0 },
        errors: [error.message]
      };
    }
  }

  async replyToMessage(messageId: string, body: string, persona: PersonaType = 'ulysse'): Promise<{ success: boolean; messageId?: string }> {
    try {
      const client = await getClient();
      const inbox = await this.getOrCreateInboxForPersona(persona);

      const result: any = await client.inboxes.messages.reply(inbox.id, messageId, {
        text: body
      });

      console.log(`[AGENTMAIL] Reply sent successfully from ${persona}`);
      return { success: true, messageId: result.message_id || result.id };
    } catch (error: any) {
      console.error(`[AGENTMAIL] Error replying for ${persona}:`, error);
      throw new Error('Failed to reply: ' + error.message);
    }
  }

  async getUnreadCount(persona: PersonaType = 'ulysse'): Promise<number> {
    try {
      const threads = await this.listThreads(50, persona);
      return threads.length;
    } catch {
      return 0;
    }
  }

  async getFormattedEmailsForAI(limit: number = 10, persona: PersonaType = 'ulysse'): Promise<string> {
    try {
      const threads = await this.listThreads(limit, persona);
      const inboxAddress = await this.getInboxAddress(persona);
      const personaName = persona === 'ulysse' ? 'Ulysse' : 'Iris';
      
      // Get received files (email attachments) with their IDs for display
      const ownerId = await getOwnerUserId();
      let receivedFiles: Array<{id: number; originalName: string; mimeType: string; description: string | null; createdAt: Date | null}> = [];
      if (ownerId) {
        receivedFiles = await db.select({
          id: ulysseFiles.id,
          originalName: ulysseFiles.originalName,
          mimeType: ulysseFiles.mimeType,
          description: ulysseFiles.description,
          createdAt: ulysseFiles.createdAt
        })
        .from(ulysseFiles)
        .where(and(
          eq(ulysseFiles.userId, ownerId),
          eq(ulysseFiles.category, 'received')
        ))
        .orderBy(ulysseFiles.createdAt)
        .limit(20);
      }
      
      let formatted = `\n### EMAILS AGENTMAIL (${personaName}) - UTILISE CES DONNÉES POUR RÉPONDRE ###\n`;
      formatted += `Tu as accès MAINTENANT à ta boîte email. Voici les données réelles:\n\n`;
      formatted += `Adresse: ${inboxAddress}\n\n`;
      
      if (threads.length === 0) {
        formatted += `ÉTAT: Aucun email reçu pour l'instant.\n`;
        formatted += `Les gens peuvent t'écrire à ${inboxAddress} et tu pourras lire et répondre.\n`;
        return formatted;
      }

      formatted += `EMAILS REÇUS (${threads.length} conversations):\n\n`;
      
      for (const thread of threads.slice(0, limit)) {
        const date = thread.timestamp.toLocaleDateString('fr-FR', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit'
        });
        const senders = thread.senders.join(', ') || 'unknown';
        
        formatted += `---\n`;
        formatted += `SUJET: ${thread.subject}\n`;
        formatted += `DE: ${senders}\n`;
        formatted += `DATE: ${date}\n`;
        formatted += `MESSAGES: ${thread.messageCount}\n`;
        formatted += `APERÇU: ${thread.preview.substring(0, 150)}${thread.preview.length > 150 ? '...' : ''}\n`;
        formatted += `THREAD ID: ${thread.id}\n`;
      }
      
      // Add received files section if any
      if (receivedFiles.length > 0) {
        formatted += `\n### PIÈCES JOINTES REÇUES (fichiers affichables) ###\n`;
        formatted += `IMPORTANT: Pour AFFICHER une image, utilise le marqueur avec l'ID NUMERIQUE:\n`;
        formatted += `[AFFICHER_IMAGE: fileId="<ID_NUMERIQUE>", title="<TITRE>"]\n\n`;
        formatted += `EXEMPLE: [AFFICHER_IMAGE: fileId="5", title="Photo des sushis"]\n\n`;
        formatted += `LISTE DES FICHIERS DISPONIBLES:\n`;
        
        for (const file of receivedFiles) {
          const isImage = file.mimeType.startsWith('image/');
          const fileType = isImage ? '[IMAGE]' : '[FICHIER]';
          formatted += `- ${fileType} ID=${file.id} | Nom: ${file.originalName} | ${file.description || 'Pièce jointe'}\n`;
        }
        formatted += `\n`;
      }
      
      formatted += `---\n\n`;
      formatted += `ACTIONS POSSIBLES: Répondre à un email, envoyer un nouveau message, AFFICHER une image reçue.\n`;
      formatted += `### FIN DES EMAILS ###`;

      return formatted;
    } catch (error: any) {
      return `### EMAILS AGENTMAIL - ERREUR ###\nImpossible de récupérer les emails: ${error.message}\n### FIN ###`;
    }
  }

  // Fetch emails and store them in database
  async fetchAndStoreEmails(): Promise<{ newEmails: number; processed: number; attachmentsDownloaded: number; summary?: string }> {
    try {
      const client = await getClient();
      const inbox = await this.getOrCreateInbox();
      const ownerId = await getOwnerUserId();
      
      if (!ownerId) {
        console.log("[AGENTMAIL] No owner found, skipping storage");
        return { newEmails: 0, processed: 0, attachmentsDownloaded: 0 };
      }

      // Get threads from AgentMail
      const response: any = await client.inboxes.threads.list(inbox.id, { limit: 50 });
      const threads = response.threads || response.data || [];
      
      let newEmails = 0;
      let processed = 0;
      let attachmentsDownloaded = 0;
      const newEmailSubjects: string[] = [];

      for (const thread of threads) {
        try {
          // Get thread ID - validate before API call
          const threadId = thread.thread_id || thread.threadId || thread.id;
          if (!threadId || typeof threadId !== 'string') {
            console.log('[AGENTMAIL] Skipping thread with invalid ID:', thread);
            continue;
          }

          // Get full thread details
          const threadDetails: any = await client.inboxes.threads.get(inbox.id, threadId);
          const messages = threadDetails.messages || [];

          for (const msg of messages) {
            const messageId = msg.message_id || msg.messageId || msg.id;
            
            // Skip messages without valid ID
            if (!messageId || typeof messageId !== 'string') {
              console.log('[AGENTMAIL] Skipping message with invalid ID:', msg.subject || 'unknown');
              continue;
            }
            
            // Check if already stored
            const existing = await db.select()
              .from(agentmailMessages)
              .where(eq(agentmailMessages.messageId, messageId))
              .limit(1);

            if (existing.length === 0) {
              // New email - store it
              const fromEmail = msg.from_?.[0]?.email || msg.from || 'unknown';
              const toEmails = (msg.to || []).map((t: any) => t.email || t);
              const ccEmails = (msg.cc || []).map((c: any) => c.email || c);
              const subject = msg.subject || thread.subject || '(Sans objet)';
              const body = msg.text || '';
              const htmlBody = msg.html || '';
              
              // Extract attachments info - capture attachmentId correctly
              const rawAttachments = msg.attachments || [];
              
              const attachmentsList = rawAttachments.map((att: any, index: number) => ({
                id: att.attachmentId || att.attachment_id || att.id || `${messageId}-att-${index}`,
                filename: att.filename || att.name,
                mimeType: att.contentType || att.content_type || att.mimeType,
                size: att.size || 0,
                url: att.url,
                inline: att.inline || false
              }));
              
              if (attachmentsList.length > 0) {
                console.log(`[AGENTMAIL] Attachments for "${subject}":`, attachmentsList.map((a: any) => `${a.filename} (id: ${a.id})`));
              }

              // AI categorization (simple for now)
              const { category, priority, sentiment } = this.categorizeEmail(fromEmail, subject, body);

              await db.insert(agentmailMessages).values({
                userId: ownerId,
                messageId,
                threadId: threadId,
                inboxId: inbox.id,
                from: fromEmail,
                to: toEmails,
                cc: ccEmails,
                subject,
                body,
                htmlBody,
                snippet: body.substring(0, 200),
                isRead: false,
                isProcessed: false,
                category,
                priority,
                sentiment,
                attachments: attachmentsList,
                metadata: { originalMsg: msg },
                receivedAt: msg.timestamp ? new Date(msg.timestamp) : new Date()
              });

              // Store attachments separately and download to Object Storage
              for (const att of attachmentsList) {
                await db.insert(agentmailAttachments).values({
                  messageId,
                  attachmentId: att.id,
                  filename: att.filename,
                  mimeType: att.mimeType,
                  size: att.size,
                  url: att.url
                });
                
                // Download attachment and store in Object Storage + ulysseFiles table
                // RULE: Never save a file that was already received once (prevent duplicates)
                try {
                  if (att.id && persistentStorageService.isConfigured()) {
                    // Check if this attachment was already saved (by attachmentId in description or filename+size combo)
                    const existingFiles = await db.select().from(ulysseFiles).where(
                      and(
                        eq(ulysseFiles.userId, ownerId),
                        eq(ulysseFiles.category, 'received')
                      )
                    );
                    
                    const isDuplicate = existingFiles.some(f => 
                      f.originalName === (att.filename || `attachment-${att.id}`) && 
                      f.sizeBytes === att.size
                    );
                    
                    if (isDuplicate) {
                      console.log(`[AGENTMAIL] Skipping duplicate attachment: ${att.filename} (already exists)`);
                      continue;
                    }
                    
                    console.log(`[AGENTMAIL] Downloading attachment: ${att.filename}`);
                    const attachmentData = await this.getAttachmentContent(client, inbox.id, messageId, att.id);
                    
                    if (attachmentData) {
                      // Store in Object Storage
                      const storedFile = await persistentStorageService.uploadBuffer(
                        attachmentData.content,
                        att.filename || `attachment-${att.id}`,
                        "received",
                        ownerId
                      );
                      
                      // Add to ulysseFiles table
                      const [createdAttachment] = await db.insert(ulysseFiles).values({
                        userId: ownerId,
                        filename: att.filename || `attachment-${att.id}`,
                        originalName: att.filename || `attachment-${att.id}`,
                        mimeType: att.mimeType || 'application/octet-stream',
                        sizeBytes: attachmentData.content.length,
                        storagePath: storedFile.objectPath,
                        description: `Pièce jointe de: ${fromEmail} - ${subject}`,
                        generatedBy: ownerId === 1 ? 'ulysse' : ownerId >= 5 ? 'alfred' : 'iris',
                        category: 'received'
                      }).returning();
                      
                      broadcastToUser(ownerId, {
                        type: "files.updated",
                        userId: ownerId,
                        data: { fileId: createdAttachment.id, action: "received", fileName: att.filename },
                        timestamp: Date.now()
                      });
                      
                      console.log(`[AGENTMAIL] Stored attachment: ${att.filename} in Object Storage`);
                      attachmentsDownloaded++;
                    }
                  }
                } catch (attError) {
                  console.error(`[AGENTMAIL] Error downloading attachment ${att.filename}:`, attError);
                }
              }

              newEmails++;
              newEmailSubjects.push(subject);
            } else {
              // Existing email - check if attachments need to be downloaded
              const existingEmail = existing[0];
              // Use original message metadata which contains attachmentId
              const metadata = existingEmail.metadata as any || {};
              const originalAttachments = metadata.originalMsg?.attachments || [];
              const existingAttachments = originalAttachments.length > 0 
                ? originalAttachments.map((att: any) => ({
                    id: att.attachmentId || att.id,
                    filename: att.filename,
                    mimeType: att.contentType || att.mimeType,
                    size: att.size
                  }))
                : (existingEmail.attachments as any[] || []);
              
              if (existingAttachments.length > 0 && persistentStorageService.isConfigured()) {
                for (const att of existingAttachments) {
                  try {
                    if (!att.id) {
                      console.log(`[AGENTMAIL] Skipping attachment without ID: ${att.filename}`);
                      continue;
                    }
                    
                    // Check if this attachment was already saved
                    const existingFiles = await db.select().from(ulysseFiles).where(
                      and(
                        eq(ulysseFiles.userId, ownerId),
                        eq(ulysseFiles.category, 'received')
                      )
                    );
                    
                    const isDuplicate = existingFiles.some(f => 
                      f.originalName === (att.filename || `attachment-${att.id}`) && 
                      f.sizeBytes === att.size
                    );
                    
                    if (!isDuplicate) {
                      console.log(`[AGENTMAIL] Downloading missing attachment: ${att.filename}`);
                      const attachmentData = await this.getAttachmentContent(client, inbox.id, messageId, att.id);
                      
                      if (attachmentData) {
                        const storedFile = await persistentStorageService.uploadBuffer(
                          attachmentData.content,
                          att.filename || `attachment-${att.id}`,
                          "received",
                          ownerId
                        );
                        
                        const [createdAttachment] = await db.insert(ulysseFiles).values({
                          userId: ownerId,
                          filename: att.filename || `attachment-${att.id}`,
                          originalName: att.filename || `attachment-${att.id}`,
                          mimeType: att.mimeType || 'application/octet-stream',
                          sizeBytes: attachmentData.content.length,
                          storagePath: storedFile.objectPath,
                          description: `Pièce jointe de: ${existingEmail.from} - ${existingEmail.subject}`,
                          generatedBy: ownerId === 1 ? 'ulysse' : ownerId >= 5 ? 'alfred' : 'iris',
                          category: 'received'
                        }).returning();
                        
                        broadcastToUser(ownerId, {
                          type: "files.updated",
                          userId: ownerId,
                          data: { fileId: createdAttachment.id, action: "received", fileName: att.filename },
                          timestamp: Date.now()
                        });
                        
                        console.log(`[AGENTMAIL] Stored missing attachment: ${att.filename}`);
                        attachmentsDownloaded++;
                      }
                    }
                  } catch (attError) {
                    console.error(`[AGENTMAIL] Error downloading missing attachment ${att.filename}:`, attError);
                  }
                }
              }
            }
            processed++;
          }
        } catch (threadError) {
          console.error("[AGENTMAIL] Error processing thread:", threadError);
        }
      }

      const summary = newEmails > 0 
        ? `${newEmails} nouveaux emails: ${newEmailSubjects.slice(0, 3).join(', ')}${newEmailSubjects.length > 3 ? '...' : ''}`
        : 'Aucun nouvel email';

      console.log(`[AGENTMAIL] Fetch complete: ${newEmails} new, ${processed} processed, ${attachmentsDownloaded} attachments`);
      return { newEmails, processed, attachmentsDownloaded, summary };
    } catch (error: any) {
      console.error("[AGENTMAIL] Error fetching emails:", error);
      throw error;
    }
  }

  // Simple email categorization
  private categorizeEmail(from: string, subject: string, body: string): { category: string; priority: string; sentiment: string } {
    const lowerSubject = subject.toLowerCase();
    const lowerBody = body.toLowerCase();
    const lowerFrom = from.toLowerCase();

    // Category detection
    let category = 'general';
    if (lowerFrom.includes('noreply') || lowerFrom.includes('notification')) {
      category = 'notification';
    } else if (lowerSubject.includes('urgent') || lowerSubject.includes('important')) {
      category = 'urgent';
    } else if (lowerSubject.includes('facture') || lowerSubject.includes('invoice') || lowerSubject.includes('paiement')) {
      category = 'finance';
    } else if (lowerSubject.includes('projet') || lowerSubject.includes('project') || lowerSubject.includes('travail')) {
      category = 'work';
    } else if (lowerSubject.includes('newsletter') || lowerFrom.includes('newsletter')) {
      category = 'newsletter';
    }

    // Priority detection
    let priority = 'normal';
    if (lowerSubject.includes('urgent') || lowerSubject.includes('asap') || lowerSubject.includes('immédiat')) {
      priority = 'urgent';
    } else if (lowerSubject.includes('important') || lowerSubject.includes('action requise')) {
      priority = 'high';
    } else if (category === 'newsletter' || category === 'notification') {
      priority = 'low';
    }

    // Simple sentiment detection
    let sentiment = 'neutral';
    const positiveWords = ['merci', 'excellent', 'super', 'parfait', 'félicitations', 'bravo', 'content'];
    const negativeWords = ['problème', 'erreur', 'urgent', 'retard', 'plainte', 'insatisfait', 'déçu'];
    
    const text = lowerSubject + ' ' + lowerBody;
    const positiveCount = positiveWords.filter(w => text.includes(w)).length;
    const negativeCount = negativeWords.filter(w => text.includes(w)).length;
    
    if (positiveCount > negativeCount) sentiment = 'positive';
    else if (negativeCount > positiveCount) sentiment = 'negative';

    return { category, priority, sentiment };
  }

  // Get stored emails from database
  async getStoredEmails(userId: number, options: { limit?: number; category?: string; unreadOnly?: boolean } = {}): Promise<any[]> {
    try {
      let query = db.select()
        .from(agentmailMessages)
        .where(eq(agentmailMessages.userId, userId))
        .orderBy(desc(agentmailMessages.receivedAt))
        .limit(options.limit || 50);

      const emails = await query;
      
      // Filter by category/unread if specified
      let filtered = emails;
      if (options.category) {
        filtered = filtered.filter(e => e.category === options.category);
      }
      if (options.unreadOnly) {
        filtered = filtered.filter(e => !e.isRead);
      }
      
      return filtered;
    } catch (error) {
      console.error("[AGENTMAIL] Error getting stored emails:", error);
      return [];
    }
  }

  // Mark email as read
  async markAsRead(messageId: string): Promise<void> {
    try {
      await db.update(agentmailMessages)
        .set({ isRead: true })
        .where(eq(agentmailMessages.messageId, messageId));
    } catch (error) {
      console.error("[AGENTMAIL] Error marking as read:", error);
    }
  }

  // Get email summary for AI context
  async getEmailSummaryForAI(userId: number): Promise<string> {
    try {
      const emails = await this.getStoredEmails(userId, { limit: 20 });
      const unreadCount = emails.filter(e => !e.isRead).length;
      const urgentCount = emails.filter(e => e.priority === 'urgent' || e.priority === 'high').length;
      const inboxAddress = await this.getInboxAddress();

      if (emails.length === 0) {
        return `📧 Boîte AgentMail (${inboxAddress}): Aucun email stocké.`;
      }

      let summary = `📧 Boîte AgentMail (${inboxAddress})\n`;
      summary += `📊 Stats: ${emails.length} emails total, ${unreadCount} non lus, ${urgentCount} urgents/importants\n\n`;

      // Group by category
      const byCategory: Record<string, any[]> = {};
      for (const email of emails.slice(0, 10)) {
        const cat = email.category || 'general';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(email);
      }

      for (const [cat, catEmails] of Object.entries(byCategory)) {
        summary += `**${cat.toUpperCase()}** (${catEmails.length}):\n`;
        for (const email of catEmails.slice(0, 3)) {
          const status = email.isRead ? '✓' : '●';
          const priority = email.priority === 'urgent' ? '🔴' : email.priority === 'high' ? '🟠' : '';
          const date = email.receivedAt ? new Date(email.receivedAt).toLocaleDateString('fr-FR') : '';
          summary += `${status} ${priority} ${email.subject} - ${email.from} (${date})\n`;
        }
        summary += '\n';
      }

      return summary;
    } catch (error) {
      console.error("[AGENTMAIL] Error generating summary:", error);
      return "❌ Erreur lors de la génération du résumé email";
    }
  }

  // Send email with attachments
  async sendEmailWithAttachments(params: SendEmailParams, persona: PersonaType = 'ulysse'): Promise<{ success: boolean; messageId?: string }> {
    try {
      const client = await getClient();
      const inbox = await this.getOrCreateInboxForPersona(persona);

      const sendParams: any = {
        to: params.to,
        subject: params.subject,
        text: params.body
      };

      // Handle attachments if any
      if (params.attachments && params.attachments.length > 0) {
        sendParams.attachments = params.attachments.map(att => ({
          filename: att.filename,
          content: typeof att.content === 'string' ? att.content : att.content.toString('base64'),
          contentType: att.contentType
        }));
      }

      const result: any = await client.inboxes.messages.send(inbox.id, sendParams);

      console.log('[AGENTMAIL] Email with attachments sent successfully');
      return { success: true, messageId: result.message_id || result.id };
    } catch (error: any) {
      console.error('[AGENTMAIL] Error sending email with attachments:', error);
      throw new Error('Failed to send email: ' + error.message);
    }
  }

  // Internal helper to get attachment content with provided client and inbox
  private async getAttachmentContent(client: AgentMailClient, inboxId: string, messageId: string, attachmentId: string): Promise<{ content: Buffer; mimeType: string } | null> {
    try {
      console.log(`[AGENTMAIL] Fetching attachment: inboxId=${inboxId}, messageId=${messageId}, attachmentId=${attachmentId}`);
      const attachment: any = await (client.inboxes.messages as any).getAttachment(inboxId, messageId, attachmentId);
      
      if (!attachment) {
        console.log('[AGENTMAIL] getAttachment returned null/undefined');
        return null;
      }
      
      // Handle different response formats
      let content: Buffer;
      let mimeType: string = 'application/octet-stream';
      
      if (Buffer.isBuffer(attachment)) {
        content = attachment;
      } else if (typeof attachment.arrayBuffer === 'function') {
        // BinaryResponse / Response object - use arrayBuffer()
        const arrayBuffer = await attachment.arrayBuffer();
        content = Buffer.from(arrayBuffer);
        // Try to get content type from headers if available
        if (attachment.headers?.get) {
          mimeType = attachment.headers.get('content-type') || mimeType;
        }
      } else if (typeof attachment.bytes === 'function') {
        // Alternative binary response format
        const bytes = await attachment.bytes();
        content = Buffer.from(bytes);
      } else if (attachment.content) {
        content = Buffer.from(attachment.content, 'base64');
        mimeType = attachment.content_type || attachment.mimeType || mimeType;
      } else if (attachment.body) {
        content = Buffer.isBuffer(attachment.body) ? attachment.body : Buffer.from(attachment.body, 'base64');
        mimeType = attachment.content_type || attachment.mimeType || mimeType;
      } else if (typeof attachment === 'string') {
        content = Buffer.from(attachment, 'base64');
      } else {
        console.log('[AGENTMAIL] Unknown attachment format:', Object.keys(attachment));
        return null;
      }
      
      console.log(`[AGENTMAIL] Attachment downloaded: ${content.length} bytes`);
      return { content, mimeType };
    } catch (error: any) {
      console.error('[AGENTMAIL] Error getting attachment content:', error.message || error);
      return null;
    }
  }

  // Get attachment content (public API)
  async getAttachment(messageId: string, attachmentId: string, persona: PersonaType = 'ulysse'): Promise<{ filename: string; content: Buffer; mimeType: string } | null> {
    try {
      const client = await getClient();
      const inbox = await this.getOrCreateInboxForPersona(persona);
      
      // Get attachment metadata from database to verify ownership and get filename
      const attachmentMeta = await db.select()
        .from(agentmailAttachments)
        .where(eq(agentmailAttachments.attachmentId, attachmentId))
        .limit(1);
      
      const filename = attachmentMeta[0]?.filename || `attachment-${attachmentId}`;
      const storedMimeType = attachmentMeta[0]?.mimeType || 'application/octet-stream';
      
      // Use the same robust logic as getAttachmentContent
      const attachmentData = await this.getAttachmentContent(client, inbox.id, messageId, attachmentId);
      
      if (!attachmentData) {
        console.log('[AGENTMAIL] getAttachment: Failed to download content');
        return null;
      }
      
      return {
        filename,
        content: attachmentData.content,
        mimeType: attachmentData.mimeType || storedMimeType
      };
    } catch (error: any) {
      console.error('[AGENTMAIL] Error getting attachment:', error);
      return null;
    }
  }
}

export const agentMailService = new AgentMailService();
