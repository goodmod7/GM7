import { z } from 'zod';

const configSchema = z.object({
  PORT: z.string().transform((s) => parseInt(s, 10)).default('3001'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  ACCESS_TOKEN_EXPIRES_IN: z.string().default('30m'),
  REFRESH_TOKEN_TTL_DAYS: z.string().transform((s) => parseInt(s, 10)).default('14'),
  CSRF_COOKIE_NAME: z.string().default('csrf_token'),
  ACCESS_COOKIE_NAME: z.string().default('access_token'),
  REFRESH_COOKIE_NAME: z.string().default('refresh_token'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRICE_ID: z.string().min(1),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  API_PUBLIC_BASE_URL: z.string().url().default('http://localhost:3001'),
  DESKTOP_UPDATE_FEED_DIR: z.string().default('./updates'),
  DESKTOP_UPDATE_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  DESKTOP_RELEASE_SOURCE: z.enum(['file', 'github']).default('file'),
  GITHUB_REPO_OWNER: z.string().default(''),
  GITHUB_REPO_NAME: z.string().default(''),
  GITHUB_TOKEN: z.string().optional(),
  DESKTOP_RELEASE_CACHE_TTL_SECONDS: z.string().transform((s) => parseInt(s, 10)).default('60'),
  DESKTOP_RELEASE_TAG: z.string().default('latest'),
  DESKTOP_VERSION: z.string().default('0.1.0'),
  DESKTOP_WIN_URL: z.string().url().default('https://example.com/downloads/ai-operator-setup.exe'),
  DESKTOP_MAC_INTEL_URL: z
    .string()
    .url()
    .default('https://example.com/downloads/ai-operator-macos-intel.dmg'),
  DESKTOP_MAC_ARM_URL: z
    .string()
    .url()
    .default('https://example.com/downloads/ai-operator-macos-apple-silicon.dmg'),
  ADMIN_API_KEY: z.string().default(''),
  AUTH_LOGIN_PER_MIN: z.string().transform((s) => parseInt(s, 10)).default('10'),
  AUTH_REFRESH_PER_MIN: z.string().transform((s) => parseInt(s, 10)).default('30'),
  BILLING_PER_MIN: z.string().transform((s) => parseInt(s, 10)).default('10'),
  RUNS_CREATE_PER_MIN: z.string().transform((s) => parseInt(s, 10)).default('6'),
  CONTROL_ACTIONS_PER_10S: z.string().transform((s) => parseInt(s, 10)).default('5'),
  TOOL_EVENTS_PER_10S: z.string().transform((s) => parseInt(s, 10)).default('20'),
  SSE_CONNECT_PER_MIN: z.string().transform((s) => parseInt(s, 10)).default('30'),
});

function loadConfig() {
  const raw = {
    PORT: process.env.PORT,
    NODE_ENV: process.env.NODE_ENV,
    LOG_LEVEL: process.env.LOG_LEVEL,
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    ACCESS_TOKEN_EXPIRES_IN: process.env.ACCESS_TOKEN_EXPIRES_IN ?? process.env.JWT_EXPIRES_IN,
    REFRESH_TOKEN_TTL_DAYS: process.env.REFRESH_TOKEN_TTL_DAYS,
    CSRF_COOKIE_NAME: process.env.CSRF_COOKIE_NAME,
    ACCESS_COOKIE_NAME: process.env.ACCESS_COOKIE_NAME,
    REFRESH_COOKIE_NAME: process.env.REFRESH_COOKIE_NAME,
    WEB_ORIGIN: process.env.WEB_ORIGIN,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID,
    APP_BASE_URL: process.env.APP_BASE_URL,
    API_PUBLIC_BASE_URL: process.env.API_PUBLIC_BASE_URL,
    DESKTOP_UPDATE_FEED_DIR: process.env.DESKTOP_UPDATE_FEED_DIR,
    DESKTOP_UPDATE_ENABLED: process.env.DESKTOP_UPDATE_ENABLED,
    DESKTOP_RELEASE_SOURCE: process.env.DESKTOP_RELEASE_SOURCE,
    GITHUB_REPO_OWNER: process.env.GITHUB_REPO_OWNER,
    GITHUB_REPO_NAME: process.env.GITHUB_REPO_NAME,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    DESKTOP_RELEASE_CACHE_TTL_SECONDS: process.env.DESKTOP_RELEASE_CACHE_TTL_SECONDS,
    DESKTOP_RELEASE_TAG: process.env.DESKTOP_RELEASE_TAG,
    DESKTOP_VERSION: process.env.DESKTOP_VERSION,
    DESKTOP_WIN_URL: process.env.DESKTOP_WIN_URL,
    DESKTOP_MAC_INTEL_URL: process.env.DESKTOP_MAC_INTEL_URL,
    DESKTOP_MAC_ARM_URL: process.env.DESKTOP_MAC_ARM_URL,
    ADMIN_API_KEY: process.env.ADMIN_API_KEY,
    AUTH_LOGIN_PER_MIN: process.env.AUTH_LOGIN_PER_MIN,
    AUTH_REFRESH_PER_MIN: process.env.AUTH_REFRESH_PER_MIN,
    BILLING_PER_MIN: process.env.BILLING_PER_MIN,
    RUNS_CREATE_PER_MIN: process.env.RUNS_CREATE_PER_MIN,
    CONTROL_ACTIONS_PER_10S: process.env.CONTROL_ACTIONS_PER_10S,
    TOOL_EVENTS_PER_10S: process.env.TOOL_EVENTS_PER_10S,
    SSE_CONNECT_PER_MIN: process.env.SSE_CONNECT_PER_MIN,
  };

  const result = configSchema.safeParse(raw);

  if (!result.success) {
    console.error('❌ Invalid configuration:');
    for (const issue of result.error.issues) {
      console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
    }
    console.error('\nRequired environment variables:');
    console.error('   PORT (default: 3001)');
    console.error('   NODE_ENV (default: development)');
    console.error('   LOG_LEVEL (default: info)');
    console.error('   DATABASE_URL');
    console.error('   JWT_SECRET');
    console.error('   ACCESS_TOKEN_EXPIRES_IN (default: 30m)');
    console.error('   REFRESH_TOKEN_TTL_DAYS (default: 14)');
    console.error('   CSRF_COOKIE_NAME (default: csrf_token)');
    console.error('   ACCESS_COOKIE_NAME (default: access_token)');
    console.error('   REFRESH_COOKIE_NAME (default: refresh_token)');
    console.error('   WEB_ORIGIN (default: http://localhost:3000)');
    console.error('   STRIPE_SECRET_KEY');
    console.error('   STRIPE_WEBHOOK_SECRET');
    console.error('   STRIPE_PRICE_ID');
    console.error('   APP_BASE_URL (default: http://localhost:3000)');
    console.error('   API_PUBLIC_BASE_URL (default: http://localhost:3001)');
    console.error('   DESKTOP_UPDATE_FEED_DIR (default: ./updates)');
    console.error('   DESKTOP_UPDATE_ENABLED (default: true)');
    console.error('   DESKTOP_RELEASE_SOURCE (default: file)');
    console.error('   GITHUB_REPO_OWNER (required for github mode)');
    console.error('   GITHUB_REPO_NAME (required for github mode)');
    console.error('   GITHUB_TOKEN (optional, required for private repos)');
    console.error('   DESKTOP_RELEASE_CACHE_TTL_SECONDS (default: 60)');
    console.error('   DESKTOP_RELEASE_TAG (default: latest)');
    console.error('   DESKTOP_VERSION (default: 0.1.0)');
    console.error('   DESKTOP_WIN_URL (default: https://example.com/downloads/ai-operator-setup.exe)');
    console.error('   DESKTOP_MAC_INTEL_URL (default: https://example.com/downloads/ai-operator-macos-intel.dmg)');
    console.error('   DESKTOP_MAC_ARM_URL (default: https://example.com/downloads/ai-operator-macos-apple-silicon.dmg)');
    console.error('   ADMIN_API_KEY (default: disabled)');
    console.error('   AUTH_LOGIN_PER_MIN (default: 10)');
    console.error('   AUTH_REFRESH_PER_MIN (default: 30)');
    console.error('   BILLING_PER_MIN (default: 10)');
    console.error('   RUNS_CREATE_PER_MIN (default: 6)');
    console.error('   CONTROL_ACTIONS_PER_10S (default: 5)');
    console.error('   TOOL_EVENTS_PER_10S (default: 20)');
    console.error('   SSE_CONNECT_PER_MIN (default: 30)');
    process.exit(1);
  }

  return {
    ...result.data,
    WEB_ORIGINS: result.data.WEB_ORIGIN.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}

export const config = loadConfig();
