/**
 * Centralized Environment Variable Validation
 * 
 * Validates all required environment variables at startup BEFORE
 * any service initialization. Fails fast with clear error messages.
 */

interface EnvVarConfig {
    name: string;
    required: boolean;
    requiredInProduction?: boolean;
    minLength?: number;
    pattern?: RegExp;
    defaultValue?: string;
    description: string;
    sensitive?: boolean;
}

const ENV_CONFIG: EnvVarConfig[] = [
    // Database
    {
        name: 'DATABASE_URL',
        required: false,
        requiredInProduction: true,
        description: 'PostgreSQL connection string',
        sensitive: true,
    },

    // Security
    {
        name: 'JWT_SECRET',
        required: false,
        requiredInProduction: true,
        minLength: 32,
        description: 'JWT signing secret (min 32 chars in production)',
        sensitive: true,
    },
    {
        name: 'OWNER_CODE_PIN',
        required: false,
        requiredInProduction: true,
        minLength: 4,
        description: 'Owner PIN code for sensitive operations',
        sensitive: true,
    },
    {
        name: 'ENCRYPTION_KEY',
        required: false,
        requiredInProduction: true,
        description: 'Encryption key for sensitive data',
        sensitive: true,
    },

    // Server
    {
        name: 'PORT',
        required: false,
        defaultValue: '5000',
        pattern: /^\d{2,5}$/,
        description: 'Server port number',
    },
    {
        name: 'NODE_ENV',
        required: false,
        defaultValue: 'development',
        pattern: /^(development|production|test)$/,
        description: 'Node environment',
    },
    {
        name: 'BASE_URL',
        required: false,
        defaultValue: 'http://localhost:5000',
        description: 'Public base URL of this server',
    },

    // AI Services (warn if missing, don't fail)
    {
        name: 'OPENAI_API_KEY',
        required: false,
        description: 'OpenAI API key (or AI_INTEGRATIONS_OPENAI_API_KEY)',
        sensitive: true,
    },
];

interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    applied: string[];
}

export function validateEnvironment(): ValidationResult {
    const result: ValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
        applied: [],
    };

    const isProduction = process.env.NODE_ENV === 'production';

    for (const config of ENV_CONFIG) {
        const value = process.env[config.name];
        const hasValue = value !== undefined && value !== '';

        // Apply defaults
        if (!hasValue && config.defaultValue) {
            process.env[config.name] = config.defaultValue;
            result.applied.push(`${config.name} = ${config.defaultValue} (default)`);
            continue;
        }

        // Check required
        if (config.required && !hasValue) {
            result.errors.push(`Missing required: ${config.name} — ${config.description}`);
            result.valid = false;
            continue;
        }

        // Check production-required
        if (config.requiredInProduction && isProduction && !hasValue) {
            result.errors.push(`Missing in production: ${config.name} — ${config.description}`);
            result.valid = false;
            continue;
        }

        if (!hasValue) continue;

        // Check min length
        if (config.minLength && isProduction && value!.length < config.minLength) {
            result.errors.push(
                `${config.name} too short: ${value!.length} chars (min ${config.minLength} in production)`
            );
            result.valid = false;
        }

        // Check pattern
        if (config.pattern && !config.pattern.test(value!)) {
            result.warnings.push(
                `${config.name} has unexpected format (expected: ${config.pattern.source})`
            );
        }
    }

    // Special validations
    const jwtSecret = process.env.JWT_SECRET;
    if (jwtSecret && isProduction) {
        const weakSecrets = [
            'dev-secret', 'change-in-production', 'secret', 'test', 'development'
        ];
        if (weakSecrets.some(w => jwtSecret.toLowerCase().includes(w))) {
            result.errors.push('JWT_SECRET contains development/test values — generate a real secret');
            result.valid = false;
        }
    }

    // Check for OpenAI key (either name)
    const hasOpenAI = !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY);
    if (!hasOpenAI) {
        result.warnings.push('No OpenAI API key set — AI chat features will be disabled');
    }

    return result;
}

/**
 * Run environment validation and log results.
 * In production, exits the process on critical errors.
 */
export function validateAndLogEnvironment(): void {
    const result = validateEnvironment();
    const isProduction = process.env.NODE_ENV === 'production';

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('[ENV] Environment Validation');
    console.log('═══════════════════════════════════════════════════════════');

    if (result.applied.length > 0) {
        console.log('\n  Defaults applied:');
        for (const msg of result.applied) {
            console.log(`    → ${msg}`);
        }
    }

    if (result.warnings.length > 0) {
        console.log('\n  ⚠️  Warnings:');
        for (const msg of result.warnings) {
            console.log(`    ⚠ ${msg}`);
        }
    }

    if (result.errors.length > 0) {
        console.log('\n  ❌ Errors:');
        for (const msg of result.errors) {
            console.log(`    ✗ ${msg}`);
        }
    }

    if (result.valid) {
        console.log('\n  ✅ Environment validation passed');
    } else {
        console.error('\n  ❌ Environment validation FAILED');
        if (isProduction) {
            console.error('  Exiting — fix environment variables before deploying to production');
            process.exit(1);
        } else {
            console.warn('  Continuing in development mode despite errors...');
        }
    }

    console.log('═══════════════════════════════════════════════════════════\n');
}
