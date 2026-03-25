import crypto from "crypto";
import { db } from "../db";
import { agentmailMessages, agentmailSendHistory } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";

const LOG_PREFIX = "[AgentMailSecurity]";

interface SecurityValidation {
  isValid: boolean;
  checks: SecurityCheck[];
  overallScore: number;
  recommendations: string[];
}

interface SecurityCheck {
  name: string;
  passed: boolean;
  severity: "low" | "medium" | "high" | "critical";
  details: string;
}

interface MessageIntegrity {
  checksum: string;
  timestamp: Date;
  verified: boolean;
}

interface SenderReputation {
  email: string;
  score: number;
  messageCount: number;
  lastSeen: Date;
  trusted: boolean;
  flags: string[];
}

const TRUSTED_DOMAINS = [
  "agentmail.to",
  "gmail.com",
  "outlook.com",
  "yahoo.com",
  "icloud.com",
  "protonmail.com",
  "hotmail.com"
];

const SUSPICIOUS_PATTERNS = [
  /urgent.*action.*required/i,
  /verify.*account.*immediately/i,
  /suspended.*account/i,
  /click.*here.*now/i,
  /password.*expired/i,
  /lottery.*winner/i,
  /prince.*nigeria/i,
  /wire.*transfer/i,
  /bitcoin.*wallet/i,
  /crypto.*investment/i
];

const BLOCKED_SENDERS: string[] = [];

class AgentMailSecurityService {
  private senderCache: Map<string, SenderReputation> = new Map();
  private auditLog: Array<{ timestamp: Date; action: string; details: any }> = [];
  private readonly MAX_AUDIT_LOG = 1000;

  generateChecksum(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  verifyChecksum(content: string, checksum: string): boolean {
    return this.generateChecksum(content) === checksum;
  }

  async validateMessage(messageId: string, from: string, subject: string, body: string): Promise<SecurityValidation> {
    const checks: SecurityCheck[] = [];
    const recommendations: string[] = [];

    const senderCheck = this.validateSender(from);
    checks.push(senderCheck);
    if (!senderCheck.passed) {
      recommendations.push(`Verify sender identity: ${from}`);
    }

    const domainCheck = this.validateDomain(from);
    checks.push(domainCheck);

    const contentCheck = this.scanContent(subject, body);
    checks.push(contentCheck);
    if (!contentCheck.passed) {
      recommendations.push("Review message content for suspicious patterns");
    }

    const linkCheck = this.validateLinks(body);
    checks.push(linkCheck);
    if (!linkCheck.passed) {
      recommendations.push("Be cautious with links in this message");
    }

    const sizeCheck = this.validateSize(body);
    checks.push(sizeCheck);

    const overallScore = this.calculateSecurityScore(checks);
    const isValid = overallScore >= 60 && !checks.some(c => c.severity === "critical" && !c.passed);

    this.logAudit("message_validation", {
      messageId,
      from,
      subject: subject.slice(0, 50),
      score: overallScore,
      isValid,
      checksCount: checks.length,
      failedChecks: checks.filter(c => !c.passed).map(c => c.name)
    });

    return {
      isValid,
      checks,
      overallScore,
      recommendations
    };
  }

  private validateSender(email: string): SecurityCheck {
    if (BLOCKED_SENDERS.includes(email.toLowerCase())) {
      return {
        name: "sender_blocked",
        passed: false,
        severity: "critical",
        details: "Sender is on block list"
      };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        name: "sender_format",
        passed: false,
        severity: "high",
        details: "Invalid email format"
      };
    }

    return {
      name: "sender_valid",
      passed: true,
      severity: "low",
      details: "Sender format validated"
    };
  }

  private validateDomain(email: string): SecurityCheck {
    const domain = email.split('@')[1]?.toLowerCase();
    
    if (!domain) {
      return {
        name: "domain_missing",
        passed: false,
        severity: "high",
        details: "No domain found in email"
      };
    }

    const isTrusted = TRUSTED_DOMAINS.some(td => domain === td || domain.endsWith(`.${td}`));

    return {
      name: "domain_trust",
      passed: true,
      severity: isTrusted ? "low" : "medium",
      details: isTrusted ? `Trusted domain: ${domain}` : `Unknown domain: ${domain}`
    };
  }

  private scanContent(subject: string, body: string): SecurityCheck {
    const fullContent = `${subject} ${body}`.toLowerCase();
    
    const matchedPatterns = SUSPICIOUS_PATTERNS.filter(pattern => pattern.test(fullContent));

    if (matchedPatterns.length >= 3) {
      return {
        name: "content_suspicious",
        passed: false,
        severity: "critical",
        details: `Multiple suspicious patterns detected (${matchedPatterns.length})`
      };
    }

    if (matchedPatterns.length > 0) {
      return {
        name: "content_warning",
        passed: true,
        severity: "medium",
        details: `${matchedPatterns.length} suspicious pattern(s) detected`
      };
    }

    return {
      name: "content_clean",
      passed: true,
      severity: "low",
      details: "No suspicious patterns detected"
    };
  }

  private validateLinks(body: string): SecurityCheck {
    const urlRegex = /https?:\/\/[^\s<>"]+/gi;
    const links = body.match(urlRegex) || [];

    if (links.length === 0) {
      return {
        name: "links_none",
        passed: true,
        severity: "low",
        details: "No links in message"
      };
    }

    const suspiciousLinks = links.filter(link => {
      const lowerLink = link.toLowerCase();
      return lowerLink.includes('bit.ly') ||
             lowerLink.includes('tinyurl') ||
             lowerLink.includes('goo.gl') ||
             lowerLink.includes('.xyz') ||
             lowerLink.includes('.tk') ||
             lowerLink.includes('.ml') ||
             /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(lowerLink);
    });

    if (suspiciousLinks.length > 0) {
      return {
        name: "links_suspicious",
        passed: false,
        severity: "high",
        details: `${suspiciousLinks.length} suspicious link(s) detected`
      };
    }

    return {
      name: "links_ok",
      passed: true,
      severity: "low",
      details: `${links.length} link(s) validated`
    };
  }

  private validateSize(body: string): SecurityCheck {
    const sizeKB = Buffer.byteLength(body, 'utf8') / 1024;

    if (sizeKB > 500) {
      return {
        name: "size_large",
        passed: true,
        severity: "medium",
        details: `Large message: ${sizeKB.toFixed(1)}KB`
      };
    }

    return {
      name: "size_ok",
      passed: true,
      severity: "low",
      details: `Message size: ${sizeKB.toFixed(1)}KB`
    };
  }

  private calculateSecurityScore(checks: SecurityCheck[]): number {
    if (checks.length === 0) return 100;

    let score = 100;
    
    for (const check of checks) {
      if (!check.passed) {
        switch (check.severity) {
          case "critical": score -= 40; break;
          case "high": score -= 25; break;
          case "medium": score -= 10; break;
          case "low": score -= 5; break;
        }
      }
    }

    return Math.max(0, score);
  }

  sanitizeContent(content: string): string {
    let sanitized = content
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '[SCRIPT REMOVED]')
      .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '[IFRAME REMOVED]')
      .replace(/<object[^>]*>[\s\S]*?<\/object>/gi, '[OBJECT REMOVED]')
      .replace(/<embed[^>]*>/gi, '[EMBED REMOVED]')
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
      .replace(/javascript:/gi, 'javascript-blocked:')
      .replace(/data:text\/html/gi, 'data-blocked:');

    return sanitized;
  }

  async getSenderReputation(email: string): Promise<SenderReputation> {
    const cached = this.senderCache.get(email.toLowerCase());
    if (cached) return cached;

    const messages = await db.select().from(agentmailMessages)
      .where(sql`${agentmailMessages.fromAddress} ILIKE ${email}`)
      .orderBy(desc(agentmailMessages.receivedAt))
      .limit(100);

    const messageCount = messages.length;
    const lastSeen = messages[0]?.receivedAt || new Date();
    
    const domain = email.split('@')[1]?.toLowerCase();
    const isTrustedDomain = TRUSTED_DOMAINS.includes(domain);
    
    let score = 50;
    if (isTrustedDomain) score += 20;
    if (messageCount > 10) score += 10;
    if (messageCount > 50) score += 10;
    
    const flags: string[] = [];
    if (!isTrustedDomain) flags.push("unknown_domain");
    if (messageCount === 0) flags.push("first_contact");
    if (messageCount === 1) flags.push("new_sender");

    const reputation: SenderReputation = {
      email: email.toLowerCase(),
      score: Math.min(100, score),
      messageCount,
      lastSeen,
      trusted: score >= 70,
      flags
    };

    this.senderCache.set(email.toLowerCase(), reputation);
    return reputation;
  }

  async validateOutgoingMessage(to: string, subject: string, body: string): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      errors.push("Invalid recipient email format");
    }

    if (!subject || subject.trim().length === 0) {
      errors.push("Subject is required");
    }

    if (!body || body.trim().length === 0) {
      errors.push("Message body is required");
    }

    if (body && body.length > 100000) {
      errors.push("Message body too large (max 100KB)");
    }

    const sensitivePatterns = [
      /password\s*[:=]\s*\S+/i,
      /api[_-]?key\s*[:=]\s*\S+/i,
      /secret\s*[:=]\s*\S+/i,
      /bearer\s+\S{20,}/i
    ];

    for (const pattern of sensitivePatterns) {
      if (pattern.test(body)) {
        errors.push("Message may contain sensitive information (credentials/API keys)");
        break;
      }
    }

    this.logAudit("outgoing_validation", {
      to,
      subject: subject?.slice(0, 50),
      valid: errors.length === 0,
      errors
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }

  private logAudit(action: string, details: any): void {
    this.auditLog.push({
      timestamp: new Date(),
      action,
      details
    });

    if (this.auditLog.length > this.MAX_AUDIT_LOG) {
      this.auditLog = this.auditLog.slice(-this.MAX_AUDIT_LOG / 2);
    }

    if (details.severity === "critical" || !details.valid) {
      console.log(`${LOG_PREFIX} [AUDIT] ${action}:`, JSON.stringify(details));
    }
  }

  getAuditLog(limit: number = 100): Array<{ timestamp: Date; action: string; details: any }> {
    return this.auditLog.slice(-limit);
  }

  async getSecurityStats(): Promise<{
    totalValidations: number;
    failedValidations: number;
    blockedMessages: number;
    suspiciousPatterns: number;
    trustedSenders: number;
  }> {
    const recentAudit = this.auditLog.slice(-500);
    
    const validations = recentAudit.filter(a => a.action === "message_validation");
    const failed = validations.filter(a => !a.details.isValid);
    const suspicious = validations.filter(a => a.details.failedChecks?.includes("content_suspicious"));
    
    return {
      totalValidations: validations.length,
      failedValidations: failed.length,
      blockedMessages: failed.filter(a => a.details.score < 40).length,
      suspiciousPatterns: suspicious.length,
      trustedSenders: this.senderCache.size
    };
  }

  clearCache(): void {
    this.senderCache.clear();
    console.log(`${LOG_PREFIX} Sender cache cleared`);
  }
}

export const agentMailSecurityService = new AgentMailSecurityService();
