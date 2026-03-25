export const config = {
  env: process.env.NODE_ENV || "development",
  isDev: (process.env.NODE_ENV || "development") === "development",
  isProd: process.env.NODE_ENV === "production",
  port: parseInt(process.env.PORT || "5000", 10),

  openai: {
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "",
    baseUrl: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "https://api.openai.com/v1",
  },

  gemini: {
    apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY || "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL || "",
  },

  grok: {
    apiKey: process.env.XAI_API_KEY || "",
  },

  perplexity: {
    apiKey: process.env.PERPLEXITY_API_KEY || "",
  },

  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
  },

  google: {
    apiKey: process.env.GOOGLE_API_KEY || "",
    accessToken: process.env.GOOGLE_ACCESS_TOKEN || "",
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN || "",
    clientId: process.env.GMAIL_CLIENT_ID || "",
    clientSecret: process.env.GMAIL_CLIENT_SECRET || "",
  },

  github: {
    token: process.env.GITHUB_TOKEN || "",
    oauthClientId: process.env.GITHUB_OAUTH_CLIENT_ID || "",
    oauthClientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET || "",
  },

  sports: {
    apiFootballKey: process.env.API_FOOTBALL_KEY || "",
    oddsApiKey: process.env.ODDS_API_KEY || "",
    finnhubKey: process.env.FINNHUB_API_KEY || "",
    alphaVantageKey: process.env.ALPHA_VANTAGE_KEY || "",
  },

  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID || "",
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET || "",
    refreshToken: process.env.SPOTIFY_REFRESH_TOKEN || "",
  },

  agentmail: {
    apiKey: process.env.AGENTMAIL_API_KEY || "",
  },

  discord: {
    token: process.env.DISCORD_BOT_TOKEN || "",
    webhookUrl: process.env.DISCORD_WEBHOOK_URL || "",
  },

  hetzner: {
    ip: "65.21.209.102",
    sshUser: process.env.HETZNER_SSH_USER || "root",
    sshKeyPath: process.env.HETZNER_SSH_KEY_PATH || "",
  },

  objectStorage: {
    bucketId: process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "",
  },

  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || "",
    privateKey: process.env.VAPID_PRIVATE_KEY || "",
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
  },
} as const;
