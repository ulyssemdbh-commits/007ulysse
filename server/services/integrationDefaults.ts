/**
 * Integration Defaults & Availability Detection
 * 
 * Platform-agnostic service availability checker.
 * Services are available when their required env vars are configured,
 * regardless of hosting platform (Docker, VPS, Railway, local, etc.)
 */

/**
 * Map of services → required environment variables
 * If ALL required vars are set, the service is available.
 */
const SERVICE_REQUIREMENTS: Record<string, string[]> = {
  spotify: ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'],
  notion: ['NOTION_TOKEN'],
  todoist: ['TODOIST_API_KEY'],
  googleDrive: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  googleCalendar: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
};

/**
 * Services that require OAuth (need their env vars configured)
 */
export const OPTIONAL_SERVICES = Object.keys(SERVICE_REQUIREMENTS);

export function isReplitIntegration(serviceName: string): boolean {
  // Keep backward compat — now checks if it's an optional integration
  return serviceName.toLowerCase() in SERVICE_REQUIREMENTS;
}

/**
 * Check if a service has its required configuration
 */
export function isServiceConfigured(serviceName: string): boolean {
  const requirements = SERVICE_REQUIREMENTS[serviceName.toLowerCase()];
  if (!requirements) return true; // Unknown service = assume available
  return requirements.every(envVar => !!process.env[envVar]);
}

/**
 * Legacy compat — now just checks if we're NOT in local dev without any integrations
 */
export function isReplitEnvironment(): boolean {
  // Returns true if ANY optional service is configured (i.e., we're in a real deployment)
  return OPTIONAL_SERVICES.some(s => isServiceConfigured(s)) ||
    process.env.NODE_ENV === 'production';
}

export interface IntegrationStatus {
  serviceName: string;
  available: boolean;
  environment: 'production' | 'development' | 'unknown';
  reason: string;
  fallbackBehavior: string;
}

export function getIntegrationStatus(serviceName: string): IntegrationStatus {
  const configured = isServiceConfigured(serviceName);
  const requirements = SERVICE_REQUIREMENTS[serviceName.toLowerCase()];
  const env = process.env.NODE_ENV === 'production' ? 'production' : 'development';
  const missingVars = requirements?.filter(v => !process.env[v]) || [];

  return {
    serviceName,
    available: configured,
    environment: env,
    reason: !configured
      ? `Missing env vars: ${missingVars.join(', ')}`
      : 'Available',
    fallbackBehavior: !configured
      ? `${serviceName} features disabled — set ${missingVars.join(', ')} in .env`
      : 'Normal operation',
  };
}

/**
 * Generate helpful error message for unavailable integration
 */
export function getIntegrationUnavailableMessage(serviceName: string): string {
  const status = getIntegrationStatus(serviceName);

  if (status.available) {
    return `✅ ${serviceName} is available`;
  }

  return `
⚠️  ${serviceName.toUpperCase()} NOT AVAILABLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Reason: ${status.reason}

To enable ${serviceName}:
1. Add the required environment variables to your .env file
2. Restart the server

${status.fallbackBehavior}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `.trim();
}

/**
 * Check if a service should be available at runtime
 */
export async function validateIntegrationAvailability(serviceName: string): Promise<{
  ok: boolean;
  message: string;
}> {
  const status = getIntegrationStatus(serviceName);

  if (!status.available) {
    return {
      ok: false,
      message: `${serviceName} is not available — ${status.reason}`,
    };
  }

  return {
    ok: true,
    message: `${serviceName} is available`,
  };
}

/**
 * List all integration statuses
 */
export function getAllIntegrationStatuses(): Record<string, IntegrationStatus> {
  const statuses: Record<string, IntegrationStatus> = {};

  for (const service of OPTIONAL_SERVICES) {
    statuses[service] = getIntegrationStatus(service);
  }

  return statuses;
}

/**
 * Log integration status to console (useful for startup diagnostics)
 */
export function logIntegrationStatus(): void {
  const env = process.env.NODE_ENV === 'production' ? 'PRODUCTION' : 'DEVELOPMENT';
  const allStatuses = getAllIntegrationStatuses();

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`[Integrations] Environment: ${env === 'PRODUCTION' ? '🚀 PRODUCTION' : '💻 DEVELOPMENT'}`);
  console.log('═══════════════════════════════════════════════════════════');

  const available = Object.values(allStatuses).filter(s => s.available);
  const unavailable = Object.values(allStatuses).filter(s => !s.available);

  if (available.length > 0) {
    console.log('\n✅ Configured Services:');
    for (const status of available) {
      console.log(`   • ${status.serviceName}`);
    }
  }

  if (unavailable.length > 0) {
    console.log('\n⚠️  Unconfigured Services (set env vars to enable):');
    for (const status of unavailable) {
      console.log(`   • ${status.serviceName} — ${status.reason}`);
    }
  }

  console.log('═══════════════════════════════════════════════════════════\n');
}
