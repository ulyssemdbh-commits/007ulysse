import { createLogger } from './logger';
import { runtimeErrorCollector } from './runtimeErrorCollector';

type ErrorDomain = 'voice' | 'sports' | 'email' | 'calendar' | 'drive' | 'notion' | 'todoist' | 'sugu' | 'chat' | 'auth' | 'file' | 'api' | 'general';
type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

interface ErrorContext {
  userId?: number;
  action?: string;
  domain: ErrorDomain;
  metadata?: Record<string, any>;
}

interface ErrorResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  userMessage: string;
  recovered: boolean;
}

interface FallbackConfig<T> {
  fallbackValue?: T;
  fallbackFn?: () => T | Promise<T>;
  retries?: number;
  retryDelay?: number;
}

const USER_MESSAGES_FR: Record<ErrorDomain, Record<string, string>> = {
  voice: {
    default: "Un problème audio est survenu. Réessaie dans quelques secondes.",
    timeout: "La reconnaissance vocale a mis trop de temps. Réessaie.",
    connection: "Connexion audio perdue. Vérifie ta connexion.",
    api: "Le service vocal est temporairement indisponible."
  },
  sports: {
    default: "Impossible de récupérer les données sportives pour le moment.",
    api: "L'API sportive est indisponible. J'utilise les données en cache.",
    cache: "Pas de données sportives disponibles.",
    odds: "Les cotes ne sont pas disponibles actuellement."
  },
  email: {
    default: "Un problème est survenu avec l'envoi du mail.",
    send: "Le mail n'a pas pu être envoyé. Réessaie.",
    attachment: "Problème avec la pièce jointe.",
    connection: "Connexion au service mail impossible."
  },
  calendar: {
    default: "Impossible d'accéder au calendrier.",
    auth: "Reconnexion au calendrier nécessaire.",
    sync: "Synchronisation du calendrier échouée."
  },
  drive: {
    default: "Problème d'accès à Google Drive.",
    upload: "Échec du téléversement du fichier.",
    download: "Échec du téléchargement."
  },
  notion: {
    default: "Connexion à Notion impossible.",
    sync: "Synchronisation Notion échouée."
  },
  todoist: {
    default: "Connexion à Todoist impossible.",
    sync: "Synchronisation des tâches échouée."
  },
  sugu: {
    default: "Un problème est survenu avec le service.",
    sync: "Synchronisation du catalogue échouée.",
    email: "Envoi du rapport SUGU échoué."
  },
  chat: {
    default: "Je n'ai pas pu traiter ta demande. Réessaie.",
    ai: "Le service IA est temporairement indisponible.",
    context: "Problème de contexte de conversation."
  },
  auth: {
    default: "Problème d'authentification.",
    session: "Ta session a expiré. Reconnecte-toi.",
    permission: "Tu n'as pas accès à cette fonctionnalité."
  },
  file: {
    default: "Problème avec le fichier.",
    read: "Impossible de lire le fichier.",
    write: "Impossible d'enregistrer le fichier.",
    generate: "Génération du fichier échouée."
  },
  api: {
    default: "Le service externe est temporairement indisponible.",
    timeout: "Le service met trop de temps à répondre.",
    rate: "Trop de requêtes. Patiente quelques secondes."
  },
  general: {
    default: "Une erreur inattendue s'est produite.",
    unknown: "Quelque chose s'est mal passé. Réessaie."
  }
};

const SEVERITY_MAP: Record<ErrorDomain, ErrorSeverity> = {
  voice: 'high',
  sports: 'medium',
  email: 'high',
  calendar: 'medium',
  drive: 'medium',
  notion: 'low',
  todoist: 'low',
  sugu: 'medium',
  chat: 'high',
  auth: 'critical',
  file: 'medium',
  api: 'medium',
  general: 'low'
};

class ErrorHandler {
  private loggers = new Map<ErrorDomain, ReturnType<typeof createLogger>>();

  private getLogger(domain: ErrorDomain) {
    if (!this.loggers.has(domain)) {
      this.loggers.set(domain, createLogger(`Error:${domain}`));
    }
    return this.loggers.get(domain)!;
  }

  getUserMessage(domain: ErrorDomain, errorType: string = 'default'): string {
    const domainMessages = USER_MESSAGES_FR[domain] || USER_MESSAGES_FR.general;
    return domainMessages[errorType] || domainMessages.default;
  }

  async handle<T>(
    operation: () => T | Promise<T>,
    context: ErrorContext,
    config: FallbackConfig<T> = {}
  ): Promise<ErrorResult<T>> {
    const logger = this.getLogger(context.domain);
    const { fallbackValue, fallbackFn, retries = 0, retryDelay = 1000 } = config;
    
    let lastError: Error | null = null;
    let attempts = 0;

    while (attempts <= retries) {
      try {
        const result = await operation();
        return {
          success: true,
          data: result,
          userMessage: '',
          recovered: attempts > 0
        };
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        attempts++;

        if (attempts <= retries) {
          logger.warn(`Retry ${attempts}/${retries} for ${context.action}`, {
            error: lastError.message,
            userId: context.userId
          });
          await new Promise(r => setTimeout(r, retryDelay * attempts));
        }
      }
    }

    const errorType = this.categorizeError(lastError!);
    const userMessage = this.getUserMessage(context.domain, errorType);
    const severity = SEVERITY_MAP[context.domain];

    logger.error(`${context.action} failed`, lastError, {
      userId: context.userId,
      severity,
      errorType,
      ...context.metadata
    });

    if (context.userId) {
      runtimeErrorCollector.logBackendError(lastError!, context.userId, {
        endpoint: context.action,
        persona: context.metadata?.persona
      }).catch(() => {});
    }

    let recovered = false;
    let fallbackData: T | undefined;

    if (fallbackFn) {
      try {
        fallbackData = await fallbackFn();
        recovered = true;
        logger.info(`${context.action} recovered with fallback`, { userId: context.userId });
      } catch (fallbackErr) {
        logger.warn(`Fallback also failed for ${context.action}`, { 
          error: (fallbackErr as Error).message 
        });
      }
    } else if (fallbackValue !== undefined) {
      fallbackData = fallbackValue;
      recovered = true;
    }

    return {
      success: false,
      data: fallbackData,
      error: lastError?.message,
      userMessage,
      recovered
    };
  }

  wrap<T extends (...args: any[]) => any>(
    fn: T,
    context: Omit<ErrorContext, 'action'>,
    config: FallbackConfig<ReturnType<T>> = {}
  ): (...args: Parameters<T>) => Promise<ErrorResult<Awaited<ReturnType<T>>>> {
    return async (...args: Parameters<T>) => {
      return this.handle(
        () => fn(...args),
        { ...context, action: fn.name || 'anonymous' },
        config
      );
    };
  }

  async safeCall<T>(
    operation: () => T | Promise<T>,
    domain: ErrorDomain,
    fallback?: T
  ): Promise<T> {
    const result = await this.handle(operation, { domain, action: 'safeCall' }, { fallbackValue: fallback });
    if (result.success || result.recovered) {
      return result.data as T;
    }
    throw new Error(result.error);
  }

  logError(
    domain: ErrorDomain,
    message: string,
    error?: Error,
    context?: Partial<ErrorContext>
  ): void {
    const logger = this.getLogger(domain);
    logger.error(message, error, context?.metadata);

    if (context?.userId && error) {
      runtimeErrorCollector.logBackendError(error, context.userId, {
        endpoint: context.action,
        persona: context.metadata?.persona
      }).catch(() => {});
    }
  }

  logWarning(domain: ErrorDomain, message: string, context?: Partial<ErrorContext>): void {
    const logger = this.getLogger(domain);
    logger.warn(message, { userId: context?.userId, ...context?.metadata });
  }

  private categorizeError(error: Error): string {
    const message = error.message.toLowerCase();
    
    if (message.includes('timeout') || message.includes('timedout')) return 'timeout';
    if (message.includes('econnrefused') || message.includes('network') || message.includes('connection')) return 'connection';
    if (message.includes('unauthorized') || message.includes('401')) return 'auth';
    if (message.includes('forbidden') || message.includes('403')) return 'permission';
    if (message.includes('rate limit') || message.includes('429') || message.includes('too many')) return 'rate';
    if (message.includes('not found') || message.includes('404')) return 'notfound';
    if (message.includes('api') || message.includes('fetch')) return 'api';
    
    return 'default';
  }

  createDomainHandler(domain: ErrorDomain) {
    return {
      handle: <T>(op: () => T | Promise<T>, action: string, config?: FallbackConfig<T>) =>
        this.handle(op, { domain, action }, config),
      safeCall: <T>(op: () => T | Promise<T>, fallback?: T) =>
        this.safeCall(op, domain, fallback),
      log: (message: string, error?: Error, context?: Partial<ErrorContext>) =>
        this.logError(domain, message, error, context),
      warn: (message: string, context?: Partial<ErrorContext>) =>
        this.logWarning(domain, message, context),
      getMessage: (errorType?: string) => this.getUserMessage(domain, errorType)
    };
  }
}

export const errorHandler = new ErrorHandler();

export const voiceErrorHandler = errorHandler.createDomainHandler('voice');
export const sportsErrorHandler = errorHandler.createDomainHandler('sports');
export const emailErrorHandler = errorHandler.createDomainHandler('email');
export const calendarErrorHandler = errorHandler.createDomainHandler('calendar');
export const driveErrorHandler = errorHandler.createDomainHandler('drive');
export const suguErrorHandler = errorHandler.createDomainHandler('sugu');
export const chatErrorHandler = errorHandler.createDomainHandler('chat');
export const authErrorHandler = errorHandler.createDomainHandler('auth');
export const fileErrorHandler = errorHandler.createDomainHandler('file');
export const apiErrorHandler = errorHandler.createDomainHandler('api');
