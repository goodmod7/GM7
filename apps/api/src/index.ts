import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import fastifyRawBody from 'fastify-raw-body';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { config } from './config.js';
import { setupWebSocket, sendToDevice, getWsConnectionsCount } from './lib/ws-handler.js';
import { deviceStore } from './store/devices.js';
import { runStore } from './store/runs.js';
import { screenStore } from './store/screen.js';
import { actionStore } from './store/actions.js';
import { toolStore } from './store/tools.js';
import { setRunPersistence, setSSEBroadcast } from './engine/runEngine.js';
import { createServerMessage, redactActionForLog } from '@ai-operator/shared';
import type { Device, InputAction, RunMode, ServerEventType } from '@ai-operator/shared';
import { prisma } from './db/prisma.js';
import { actionsRepo } from './repos/actions.js';
import { auditRepo } from './repos/audit.js';
import { devicesRepo } from './repos/devices.js';
import { runsRepo } from './repos/runs.js';
import { sessionsRepo } from './repos/sessions.js';
import { toolsRepo } from './repos/tools.js';
import { usersRepo } from './repos/users.js';
import { stripeEventsRepo } from './repos/stripe-events.js';
import { ownership } from './lib/ownership.js';
import { fetchDesktopRelease, getGitHubReleaseCacheStats } from './lib/releases/github.js';
import { resolveDesktopAssets, resolveDesktopDownloadAssets } from './lib/releases/resolveDesktopAssets.js';
import { validateDesktopDownloadsPayload, validateDesktopUpdateManifest } from './lib/releases/validation.js';
import { consumeRateLimit, getRateLimitKeyCount } from './lib/ratelimit.js';
import { stripe, mapStripeSubscriptionStatus } from './lib/stripe.js';
import { requireActiveSubscription } from './lib/subscription.js';
import { evaluateReadiness } from './lib/readiness.js';
import { getAppVersion, getVersionDriftWarnings } from './lib/version.js';
import { getPresence } from './lib/presence.js';
import { recoverInProgressRunsOnStartup } from './lib/run-recovery.js';
import { redact } from './lib/redact.js';
import { registerRootRoute } from './lib/root-route.js';
import { buildSseHeaders } from './lib/sse.js';
import {
  buildDesktopSignInUrl,
  desktopAuth,
  validateDesktopLoopbackCallbackUrl,
} from './lib/desktop-auth.js';
import { buildDesktopAccountSnapshot } from './lib/desktop-account.js';
import { createRunForOwnedDevice } from './lib/run-creation.js';
import { authenticateDesktopDeviceSession, revokeDesktopSession } from './lib/desktop-session.js';
import { startRetentionScheduler } from './lib/retention.js';
import { createSecurityOnSendHook, DEFAULT_JSON_BODY_LIMIT, WEBHOOK_RAW_BODY_LIMIT } from './lib/security.js';
import { dispatchDeviceCommand, isDeviceCommandQueueEnabled } from './lib/device-commands.js';
import {
  counterLabelsFromRateLimitKey,
  incCounter,
  metricLabels,
  observeDuration,
  renderPrometheusMetrics,
  setGauge,
} from './lib/metrics.js';
import {
  type AuthenticatedRequest,
  clearAuthCookies,
  getRefreshCookieToken,
  getRequestAuthUser,
  getRefreshTokenExpiryDate,
  hashPassword,
  hashRefreshToken,
  isValidCsrf,
  issueAccessToken,
  issueCsrfToken,
  issueRefreshToken,
  requireAuth,
  setSessionCookies,
  shouldCheckCsrf,
  verifyAccessToken,
  verifyPassword,
  type AuthUser,
} from './lib/auth.js';

const fastify = Fastify({
  bodyLimit: DEFAULT_JSON_BODY_LIMIT,
  logger: {
    level: config.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-admin-api-key"]',
        'req.body.password',
        'req.body.token',
        'req.body.accessToken',
        'req.body.refreshToken',
        'req.body.handoffToken',
        'req.body.csrfToken',
        'res.headers["set-cookie"]',
      ],
      remove: true,
    },
  },
  requestIdHeader: 'x-request-id',
  genReqId(req) {
    const header = req.headers['x-request-id'];
    if (typeof header === 'string' && header.trim()) {
      return header.trim();
    }
    if (Array.isArray(header) && typeof header[0] === 'string' && header[0].trim()) {
      return header[0].trim();
    }
    return randomUUID();
  },
});

async function dispatchDeviceCommandToDevice(
  deviceId: string,
  commandType: string,
  payload: Record<string, unknown>
) {
  return dispatchDeviceCommand(
    config.RATE_LIMIT_BACKEND,
    config.REDIS_URL,
    deviceId,
    commandType,
    payload,
    (message) => sendToDevice(deviceId, message)
  );
}

const appVersion = getAppVersion();
const versionDriftWarnings = getVersionDriftWarnings();

await fastify.register(cookie);
await fastify.register(cors, {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (config.WEB_ORIGINS.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Origin not allowed'), false);
  },
  credentials: true,
  allowedHeaders: ['Authorization', 'Content-Type', 'X-CSRF-Token'],
});
await fastify.register(fastifyRawBody, {
  field: 'rawBody',
  global: false,
  encoding: false,
  runFirst: true,
});

fastify.addHook('onRequest', async (request, reply) => {
  reply.header('x-request-id', request.id);
  (request as FastifyRequest & { startedAt?: bigint }).startedAt = process.hrtime.bigint();
});

fastify.addHook('onSend', createSecurityOnSendHook({ nodeEnv: config.NODE_ENV }));

fastify.addHook('preHandler', async (request, reply) => {
  if (!shouldCheckCsrf(request)) {
    return;
  }

  if (isValidCsrf(request)) {
    return;
  }

  reply.status(403);
  return reply.send({
    error: 'CSRF token required',
    code: 'CSRF_REQUIRED',
  });
});

fastify.addHook('onResponse', async (request, reply) => {
  const startedAt = (request as FastifyRequest & { startedAt?: bigint }).startedAt;
  const durationMs = startedAt
    ? Number(process.hrtime.bigint() - startedAt) / 1_000_000
    : undefined;
  const authenticated = request as AuthenticatedRequest;
  const userId = authenticated.user?.id ?? getRequestAuthUser(request)?.id ?? null;
  const auditContext = getRequestAuditContext(request);

  fastify.log.info(
    {
      requestId: request.id,
      method: request.method,
      path: request.url.split('?')[0],
      status: reply.statusCode,
      duration_ms: durationMs ? Math.round(durationMs * 100) / 100 : undefined,
      userId,
      ip: auditContext.ip,
      userAgent: auditContext.userAgent,
    },
    'HTTP request completed'
  );

  const route = request.routeOptions?.url ?? request.url.split('?')[0];
  incCounter('http_requests_total', metricLabels({
    method: request.method,
    route,
    status: reply.statusCode,
  }));
  if (durationMs !== undefined) {
    observeDuration('http_request_duration_ms', durationMs, metricLabels({
      method: request.method,
      route,
    }));
  }
});

// SSE clients
interface SSEClient {
  id: string;
  userId: string;
  reply: FastifyReply;
}
const sseClients = new Map<string, SSEClient>();
setGauge('ws_connections_current', 0);
setGauge('sse_clients_current', 0);

interface RequestAuditContext {
  ip: string | null;
  userAgent: string | null;
}

function getHeaderValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : null;
  }
  return typeof value === 'string' ? value : null;
}

function getCoarseIp(ip: string | undefined): string | null {
  if (!ip) {
    return null;
  }
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }
  }
  if (ip.includes(':')) {
    return `${ip.split(':').slice(0, 4).join(':')}::`;
  }
  return ip;
}

function getRequestAuditContext(request: FastifyRequest): RequestAuditContext {
  return {
    ip: getCoarseIp(request.ip),
    userAgent: getHeaderValue(request.headers['user-agent']),
  };
}

function getActionAuditMeta(action: InputAction): Record<string, unknown> {
  if (action.kind === 'type') {
    return { kind: 'type', length: action.text.length };
  }

  if (action.kind === 'hotkey') {
    return { kind: 'hotkey', key: action.key };
  }

  return { kind: action.kind };
}

function build429Reply(reply: FastifyReply, retryAfterSeconds: number) {
  reply.header('Retry-After', String(retryAfterSeconds));
  reply.status(429);
  return {
    error: 'Rate limit exceeded',
    code: 'RATE_LIMITED',
    retryAfterSeconds,
  };
}

async function getReadinessReport() {
  return evaluateReadiness({
    billingEnabled: config.BILLING_ENABLED,
    desktopReleaseSource: config.DESKTOP_RELEASE_SOURCE,
    stripe: {
      secretKeyConfigured: Boolean(config.STRIPE_SECRET_KEY),
      webhookSecretConfigured: Boolean(config.STRIPE_WEBHOOK_SECRET),
      priceIdConfigured: Boolean(config.STRIPE_PRICE_ID),
    },
    github: {
      repoConfigured: Boolean(config.GITHUB_REPO_OWNER && config.GITHUB_REPO_NAME),
    },
    checkGitHubRelease: async () => {
      if (config.DESKTOP_RELEASE_SOURCE !== 'github') {
        return;
      }

      const releaseResult = await fetchDesktopRelease();
      resolveDesktopDownloadAssets(releaseResult.release);
    },
    checkDatabase: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    checkSchema: async () => {
      const requiredTables = ['User', 'Device', 'Run', 'Session', 'AuditEvent'];
      const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('User', 'Device', 'Run', 'Session', 'AuditEvent')
      `;
      const found = new Set(rows.map((row) => row.table_name));
      for (const table of requiredTables) {
        if (!found.has(table)) {
          throw new Error(`Missing table ${table}`);
        }
      }
    },
  });
}

async function enforceHttpRateLimit(reply: FastifyReply, key: string, limit: number, windowMs: number): Promise<boolean> {
  const result = await consumeRateLimit(key, limit, windowMs, {
    backend: config.RATE_LIMIT_BACKEND,
    redisUrl: config.REDIS_URL,
  });
  if (result.allowed) {
    return true;
  }

  incCounter('rate_limit_hits_total', counterLabelsFromRateLimitKey(key));
  void reply.send(build429Reply(reply, result.retryAfterSeconds));
  return false;
}

async function createAuditEvent(
  request: FastifyRequest | null,
  event: {
    userId?: string | null;
    deviceId?: string | null;
    runId?: string | null;
    actionId?: string | null;
    toolName?: string | null;
    eventType: string;
    meta?: Record<string, unknown> | null;
  }
) {
  const context = request ? getRequestAuditContext(request) : { ip: null, userAgent: null };
  try {
    await auditRepo.createEvent({
      ...event,
      ip: context.ip,
      userAgent: context.userAgent,
    });
  } catch (err) {
    fastify.log.warn(
      { eventType: event.eventType, err: err instanceof Error ? err.message : String(err) },
      'Audit event write failed'
    );
  }
}

function authFromQueryToken(token?: string): AuthUser | null {
  if (!token) return null;
  return verifyAccessToken(token);
}

function extractBearerToken(authorizationHeader: unknown): string | null {
  const header = getHeaderValue(authorizationHeader);
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(/\s+/, 2);
  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token;
}

async function requireDesktopDeviceSession(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<{ deviceId: string; userId: string; deviceToken: string } | null> {
  const deviceToken = extractBearerToken(request.headers.authorization);
  if (!deviceToken) {
    reply.status(401);
    return null;
  }

  const session = await authenticateDesktopDeviceSession({
    deviceToken,
    devicesRepo,
  });
  if (!session.ok) {
    reply.status(401);
    return null;
  }

  return {
    deviceId: session.deviceId,
    userId: session.userId,
    deviceToken: session.deviceToken,
  };
}

function buildSessionIdentity(request: { ip: string; headers: Record<string, unknown> }) {
  const userAgentHeader = request.headers['user-agent'];
  const userAgent = Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader;

  return {
    userAgent: typeof userAgent === 'string' ? userAgent : null,
    ip: getCoarseIp(request.ip),
  };
}

async function startSession(reply: FastifyReply, user: AuthUser, request: { ip: string; headers: Record<string, unknown> }) {
  const accessToken = issueAccessToken(user);
  const refreshToken = issueRefreshToken();
  const csrfToken = issueCsrfToken();

  await sessionsRepo.create({
    userId: user.id,
    refreshTokenHash: hashRefreshToken(refreshToken),
    expiresAt: getRefreshTokenExpiryDate(),
    ...buildSessionIdentity(request),
  });

  setSessionCookies(reply, accessToken, refreshToken, csrfToken);
  return accessToken;
}

function getBillingSnapshot(user: {
  subscriptionStatus?: string | null;
  subscriptionCurrentPeriodEnd?: Date | null;
  planPriceId?: string | null;
}) {
  const active = user.subscriptionStatus === 'active';
  return {
    subscriptionStatus: active ? 'active' : 'inactive',
    subscriptionCurrentPeriodEnd: user.subscriptionCurrentPeriodEnd?.toISOString() ?? null,
    planPriceId: user.planPriceId ?? null,
    localAiPlan: active ? 'plus' : 'free',
    freeLocalTaskLimit: active ? null : 5,
    visionBoostIncluded: active,
  };
}

function getSubscriptionFields(subscription: {
  id?: string | null;
  status?: string | null;
  current_period_end?: number | null;
  items?: { data?: Array<{ price?: { id?: string | null } | null }> } | null;
}) {
  const currentPeriodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null;
  const planPriceId = subscription.items?.data?.[0]?.price?.id ?? null;

  return {
    subscriptionId: subscription.id ?? null,
    subscriptionStatus: mapStripeSubscriptionStatus(subscription.status),
    subscriptionCurrentPeriodEnd: currentPeriodEnd,
    planPriceId,
  };
}

interface DesktopUpdateManifest {
  version: string;
  notes?: string;
  pub_date?: string;
  platforms?: Record<string, { url: string; signature: string }>;
}

function getDesktopUpdateManifestPath(platform: string, arch: string): string | null {
  if (!/^[a-z0-9_-]+$/i.test(platform) || !/^[a-z0-9_-]+$/i.test(arch)) {
    return null;
  }

  return resolve(process.cwd(), config.DESKTOP_UPDATE_FEED_DIR, `desktop-${platform}-${arch}.json`);
}

function getDesktopArtifactPath(artifactName: string): string | null {
  if (!/^[a-z0-9._-]+$/i.test(artifactName)) {
    return null;
  }

  return resolve(process.cwd(), config.DESKTOP_UPDATE_FEED_DIR, 'artifacts', artifactName);
}

function getDesktopArtifactContentType(artifactName: string) {
  switch (extname(artifactName).toLowerCase()) {
    case '.dmg':
      return 'application/x-apple-diskimage';
    case '.msi':
      return 'application/x-msi';
    case '.exe':
      return 'application/vnd.microsoft.portable-executable';
    default:
      return 'application/octet-stream';
  }
}

function getFileBasedDesktopDownloads() {
  const validated = validateDesktopDownloadsPayload(
    {
      version: config.DESKTOP_VERSION,
      windowsUrl: config.DESKTOP_WIN_URL,
      macIntelUrl: config.DESKTOP_MAC_INTEL_URL,
      macArmUrl: config.DESKTOP_MAC_ARM_URL,
    },
    {
      nodeEnv: config.NODE_ENV,
      allowInsecureDev: config.ALLOW_INSECURE_DEV,
      apiPublicBaseUrl: config.API_PUBLIC_BASE_URL,
    }
  );

  return {
    version: validated.version,
    windowsUrl: validated.windowsUrl,
    macIntelUrl: validated.macIntelUrl,
    macArmUrl: validated.macArmUrl,
    notes: 'Signed release artifacts and updater metadata are published through the desktop release pipeline.',
    publishedAt: null,
  };
}

async function getDesktopDownloadsPayload() {
  if (config.DESKTOP_RELEASE_SOURCE === 'file') {
    return getFileBasedDesktopDownloads();
  }

  const releaseResult = await fetchDesktopRelease();
  const resolved = resolveDesktopDownloadAssets(releaseResult.release);

  fastify.log.info(
    {
      releaseTag: releaseResult.release.tagName,
      assetCount: releaseResult.release.assets.length,
      cache: releaseResult.cacheHit ? 'hit' : 'miss',
    },
    'Resolved desktop downloads from GitHub release'
  );

  return {
    version: resolved.version,
    windowsUrl: resolved.windowsUrl,
    macIntelUrl: resolved.macIntelUrl,
    macArmUrl: resolved.macArmUrl,
    notes: resolved.notes,
    publishedAt: resolved.publishedAt,
  };
}

async function getDesktopUpdateManifest(platform: string, arch: string, currentVersion: string): Promise<DesktopUpdateManifest> {
  if (config.DESKTOP_RELEASE_SOURCE === 'file') {
    const manifestPath = getDesktopUpdateManifestPath(platform, arch);
    if (!manifestPath) {
      throw new Error('Invalid update target');
    }

    const target = `${platform}-${arch}`;
    const manifestText = await readFile(manifestPath, 'utf8');
    const manifest = validateDesktopUpdateManifest(JSON.parse(manifestText) as DesktopUpdateManifest, {
      target,
      apiPublicBaseUrl: config.API_PUBLIC_BASE_URL,
      nodeEnv: config.NODE_ENV,
      allowInsecureDev: config.ALLOW_INSECURE_DEV,
    });

    fastify.log.debug(
      { platform, arch, currentVersion, latestVersion: manifest.version },
      'Desktop update manifest requested (file)'
    );

    return manifest;
  }

  const releaseResult = await fetchDesktopRelease();
  const resolved = await resolveDesktopAssets(releaseResult.release);
  const target = `${platform}-${arch}`;
  const platformMap: Record<string, { url: string; signature: string } | undefined> = {
    'windows-x86_64': resolved.windows,
    'macos-x86_64': resolved.macIntel,
    'macos-aarch64': resolved.macArm,
    'darwin-x86_64': resolved.macIntel,
    'darwin-aarch64': resolved.macArm,
  };
  const targetAsset = platformMap[target];

  if (!targetAsset) {
    throw new Error('Invalid update target');
  }

  fastify.log.info(
    {
      releaseTag: releaseResult.release.tagName,
      assetCount: releaseResult.release.assets.length,
      cache: releaseResult.cacheHit ? 'hit' : 'miss',
      platform,
      arch,
      currentVersion,
    },
    'Desktop update manifest requested (github)'
  );

  return {
    version: resolved.version,
    notes: resolved.notes,
    pub_date: resolved.publishedAt ?? new Date().toISOString(),
    platforms: {
      [target]: targetAsset,
    },
  };
}

async function getOwnedDevices(userId: string) {
  const owned = await devicesRepo.listOwned(userId);
  return Promise.all(owned.map((device) => withPresenceState(device)));
}

async function getOwnedDevice(userId: string, deviceId: string) {
  const device = await devicesRepo.getOwned(deviceId, userId);
  return device ? withPresenceState(device) : null;
}

async function getPairableDevice(deviceId: string) {
  const persisted = await devicesRepo.findByDeviceId(deviceId);
  if (!persisted) {
    return null;
  }

  return {
    ...persisted,
    device: await withPresenceState(persisted.device),
  };
}

async function withPresenceState(device: Device) {
  const now = Date.now();
  const connectionThresholdMs = 45_000;
  const presence = await getPresence(config.RATE_LIMIT_BACKEND, config.REDIS_URL, device.deviceId);
  if (presence) {
    return {
      ...device,
      connected: presence.connected,
      lastSeenAt: Math.max(device.lastSeenAt, presence.lastSeenAt),
    };
  }
  return {
    ...device,
    connected: now - device.lastSeenAt < connectionThresholdMs,
  };
}

function eventBelongsToUser(event: ServerEventType, userId: string): boolean {
  switch (event.type) {
    case 'device_update':
      return Boolean(event.device && typeof event.device === 'object' && 'deviceId' in event.device)
        ? ownership.getDeviceOwner((event.device as { deviceId: string }).deviceId) === userId
        : false;
    case 'run_update':
      return ownership.getRunOwner(event.run.runId) === userId;
    case 'step_update':
    case 'log_line':
      return event.runId ? ownership.getRunOwner(event.runId) === userId : false;
    case 'screen_update':
      return ownership.getDeviceOwner(event.deviceId) === userId;
    case 'action_update':
      return ownership.getActionOwner(event.action.actionId) === userId;
    case 'tool_update':
      return ownership.getToolOwner(event.tool.toolEventId) === userId;
    default:
      return false;
  }
}

async function persistRunIfOwned(runId: string): Promise<void> {
  const run = runStore.get(runId);
  const ownerUserId = ownership.getRunOwner(runId);
  if (!run || !ownerUserId) return;
  await runsRepo.save(run, ownerUserId);
  if (run.status === 'done' || run.status === 'failed') {
    await createAuditEvent(null, {
      userId: ownerUserId,
      deviceId: run.deviceId,
      runId,
      eventType: `run.${run.status}`,
      meta: { mode: run.mode ?? 'manual' },
    });
  }
}

// Set up SSE broadcast from run engine
setSSEBroadcast((event) => {
  const data = JSON.stringify(event);
  for (const [clientId, client] of sseClients) {
    if (!eventBelongsToUser(event as ServerEventType, client.userId)) {
      continue;
    }
    try {
      client.reply.raw.write(`data: ${data}\n\n`);
    } catch (err) {
      fastify.log.warn({ clientId, err: redact(err) }, 'Failed to send SSE to client, removing');
      sseClients.delete(clientId);
    }
  }
});

setRunPersistence((runId) => {
  void persistRunIfOwned(runId);
});

const [persistedDevices, persistedRuns, persistedActions, persistedTools] = await Promise.all([
  devicesRepo.loadAll(),
  runsRepo.loadAll(),
  actionsRepo.loadAll(),
  toolsRepo.loadAll(),
]);

deviceStore.load(
  persistedDevices.map(({ device }) => device)
);
for (const persisted of persistedDevices) {
  ownership.setDeviceOwner(persisted.device.deviceId, persisted.ownerUserId);
}

runStore.load(
  persistedRuns.map(({ run }) => run)
);
for (const persisted of persistedRuns) {
  ownership.setRunOwner(persisted.run.runId, persisted.ownerUserId);
}

actionStore.load(
  persistedActions.map(({ action }) => action)
);
for (const persisted of persistedActions) {
  ownership.setActionOwner(persisted.action.actionId, persisted.ownerUserId);
}

toolStore.load(
  persistedTools.map(({ tool }) => tool)
);
for (const persisted of persistedTools) {
  ownership.setToolOwner(persisted.tool.toolEventId, persisted.ownerUserId);
}

const recoveredRuns = await recoverInProgressRunsOnStartup(config.RUN_RECOVERY_POLICY, {
  listInProgressRuns: () => runsRepo.listInProgressRuns(),
  persistRun: (run, ownerUserId) => runsRepo.save(run, ownerUserId),
  createAuditEvent: async ({ userId, deviceId, runId, eventType, meta }) => {
    await createAuditEvent(null, { userId, deviceId, runId, eventType, meta });
  },
});
if (recoveredRuns > 0) {
  fastify.log.warn({ recoveredRuns, policy: config.RUN_RECOVERY_POLICY }, 'Recovered in-progress runs after restart');
}

const stopRetentionScheduler = startRetentionScheduler({
  nodeEnv: config.NODE_ENV,
  prismaClient: prisma,
  logger: fastify.log,
  auditRetentionDays: config.AUDIT_RETENTION_DAYS,
  stripeEventRetentionDays: config.STRIPE_EVENT_RETENTION_DAYS,
  sessionRetentionDays: config.SESSION_RETENTION_DAYS,
  runRetentionDays: config.RUN_RETENTION_DAYS,
});

// ============================================================================
// Service Index
// ============================================================================

registerRootRoute(fastify, {
  appVersion,
  apiPublicBaseUrl: config.API_PUBLIC_BASE_URL,
  nodeEnv: config.NODE_ENV,
});

// ============================================================================
// Health Check
// ============================================================================

fastify.get('/health', async () => {
  return {
    ok: true,
    version: appVersion,
    uptimeSeconds: Math.floor(process.uptime()),
    ts: Date.now(),
  };
});

fastify.get('/ready', async (_request, reply) => {
  const readiness = await getReadinessReport();
  if (!readiness.ok) {
    incCounter('readiness_failures_total');
    reply.status(503);
  }

  return {
    ok: readiness.ok,
    checks: readiness.checks,
    version: appVersion,
    ts: Date.now(),
    failures: readiness.failures,
  };
});

fastify.get('/admin/health', async (request, reply) => {
  const adminKey = getHeaderValue(request.headers['x-admin-api-key']);
  if (!config.ADMIN_API_KEY || adminKey !== config.ADMIN_API_KEY) {
    reply.status(401);
    return { error: 'Unauthorized' };
  }

  const readiness = await getReadinessReport();
  if (!readiness.ok) {
    reply.status(503);
  }

  return {
    ok: readiness.ok,
    live: true,
    readiness,
    wsConnectionsCount: getWsConnectionsCount(),
    sseClientsCount: sseClients.size,
    screenFramesInMemoryCount: screenStore.count(),
    rateLimitKeysCount: getRateLimitKeyCount(),
    githubReleaseCache: getGitHubReleaseCacheStats(),
    uptimeSeconds: Math.floor(process.uptime()),
  };
});

fastify.get('/metrics', async (request, reply) => {
  const adminKey = getHeaderValue(request.headers['x-admin-api-key']);
  const allowPublicMetrics = config.METRICS_PUBLIC;
  const authorized = allowPublicMetrics || (Boolean(config.ADMIN_API_KEY) && adminKey === config.ADMIN_API_KEY);
  if (!authorized) {
    reply.status(401);
    return { error: 'Unauthorized' };
  }

  reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  return reply.send(renderPrometheusMetrics());
});

// ============================================================================
// Auth Endpoints
// ============================================================================

fastify.post('/auth/register', async (request, reply) => {
  if (!(await enforceHttpRateLimit(reply, `ip:${request.ip}:auth:register`, config.AUTH_LOGIN_PER_MIN, 60_000))) {
    return;
  }

  const { email, password } = request.body as { email?: string; password?: string };
  if (!email || !password || password.length < 8) {
    reply.status(400);
    return { error: 'email and password (min 8 chars) are required' };
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await usersRepo.findByEmail(normalizedEmail);
  if (existing) {
    reply.status(409);
    return { error: 'User already exists' };
  }

  const passwordHash = await hashPassword(password);
  const createdUser = await usersRepo.create(normalizedEmail, passwordHash);
  await createAuditEvent(request, {
    userId: createdUser.id,
    eventType: 'auth.register',
  });
  return { ok: true };
});

fastify.post('/auth/login', async (request, reply) => {
  if (!(await enforceHttpRateLimit(reply, `ip:${request.ip}:auth:login`, config.AUTH_LOGIN_PER_MIN, 60_000))) {
    return;
  }

  const { email, password } = request.body as { email?: string; password?: string };
  if (!email || !password) {
    reply.status(400);
    return { error: 'email and password are required' };
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = await usersRepo.findByEmail(normalizedEmail);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    reply.status(401);
    return { error: 'Invalid credentials' };
  }

  const authUser = { id: user.id, email: user.email };
  const token = await startSession(reply, authUser, request);
  await createAuditEvent(request, {
    userId: authUser.id,
    eventType: 'auth.login',
  });
  return {
    token,
    user: {
      id: authUser.id,
      email: authUser.email,
    },
  };
});

fastify.post('/auth/refresh', async (request, reply) => {
  if (!(await enforceHttpRateLimit(reply, `ip:${request.ip}:auth:refresh`, config.AUTH_REFRESH_PER_MIN, 60_000))) {
    return;
  }

  const refreshToken = getRefreshCookieToken(request);
  if (!refreshToken) {
    clearAuthCookies(reply);
    reply.status(401);
    return { error: 'Unauthorized' };
  }

  const session = await sessionsRepo.findByRefreshTokenHash(hashRefreshToken(refreshToken));
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    clearAuthCookies(reply);
    reply.status(401);
    return { error: 'Unauthorized' };
  }

  const accessToken = issueAccessToken({
    id: session.user.id,
    email: session.user.email,
  });
  const nextRefreshToken = issueRefreshToken();
  const csrfToken = issueCsrfToken();

  await sessionsRepo.rotate(
    session.id,
    hashRefreshToken(nextRefreshToken),
    getRefreshTokenExpiryDate()
  );

  setSessionCookies(reply, accessToken, nextRefreshToken, csrfToken);
  await createAuditEvent(request, {
    userId: session.user.id,
    eventType: 'auth.refresh',
  });
  return { ok: true };
});

fastify.post('/auth/logout', async (request, reply) => {
  const refreshToken = getRefreshCookieToken(request);
  const session = refreshToken
    ? await sessionsRepo.findByRefreshTokenHash(hashRefreshToken(refreshToken))
    : null;
  if (refreshToken) {
    await sessionsRepo.revokeByRefreshTokenHash(hashRefreshToken(refreshToken));
  }
  clearAuthCookies(reply);
  await createAuditEvent(request, {
    userId: session?.user.id ?? null,
    eventType: 'auth.logout',
  });
  return { ok: true };
});

fastify.post('/auth/logout_all', async (request, reply) => {
  const user = await requireAuth(request, reply);
  if (!user) {
    return { error: 'Unauthorized' };
  }

  await sessionsRepo.revokeAllForUser(user.id);
  clearAuthCookies(reply);
  await createAuditEvent(request, {
    userId: user.id,
    eventType: 'auth.logout_all',
  });
  return { ok: true };
});

fastify.get('/auth/me', async (request, reply) => {
  const user = await requireAuth(request, reply);
  if (!user) {
    return { error: 'Unauthorized' };
  }

  return {
    user: {
      id: user.id,
      email: user.email,
    },
  };
});

fastify.get('/auth/sessions', async (request, reply) => {
  const user = await requireAuth(request, reply);
  if (!user) {
    return { error: 'Unauthorized' };
  }

  const sessions = await sessionsRepo.listByUser(user.id);
  return {
    sessions: sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
      userAgent: session.userAgent,
    })),
  };
});

fastify.post('/desktop/auth/start', async (request, reply) => {
  if (!(await enforceHttpRateLimit(reply, `ip:${request.ip}:desktop-auth:start`, config.AUTH_LOGIN_PER_MIN, 60_000))) {
    return;
  }

  const { deviceId, callbackUrl, state, nonce } = request.body as {
    deviceId?: string;
    callbackUrl?: string;
    state?: string;
    nonce?: string;
  };

  if (!deviceId || !callbackUrl || !state || !nonce) {
    reply.status(400);
    return { error: 'deviceId, callbackUrl, state, and nonce are required' };
  }

  const validatedCallback = validateDesktopLoopbackCallbackUrl(callbackUrl);
  if (!validatedCallback.ok) {
    reply.status(400);
    return { error: validatedCallback.error };
  }

  const attempt = desktopAuth.startAttempt({
    deviceId,
    callbackUrl: validatedCallback.callbackUrl,
    state,
    nonce,
  });

  return {
    ok: true,
    attemptId: attempt.attemptId,
    expiresAt: attempt.expiresAt,
    authUrl: buildDesktopSignInUrl(config.APP_BASE_URL, attempt.attemptId),
  };
});

fastify.post('/desktop/auth/exchange', async (request, reply) => {
  if (!(await enforceHttpRateLimit(reply, `ip:${request.ip}:desktop-auth:exchange`, config.AUTH_LOGIN_PER_MIN, 60_000))) {
    return;
  }

  const { handoffToken, deviceId, state, nonce } = request.body as {
    handoffToken?: string;
    deviceId?: string;
    state?: string;
    nonce?: string;
  };

  if (!handoffToken || !deviceId || !state || !nonce) {
    reply.status(400);
    return { error: 'handoffToken, deviceId, state, and nonce are required' };
  }

  const consumed = desktopAuth.consumeHandoff({
    handoffToken,
    deviceId,
    state,
    nonce,
  });

  if (!consumed.ok) {
    if (consumed.error === 'HANDOFF_ALREADY_USED') {
      reply.status(409);
    } else if (consumed.error === 'HANDOFF_EXPIRED') {
      reply.status(410);
    } else if (consumed.error === 'HANDOFF_NOT_FOUND') {
      reply.status(404);
    } else {
      reply.status(400);
    }

    return { error: consumed.error };
  }

  const persistedDevice = await devicesRepo.findByDeviceId(deviceId);
  if (!persistedDevice) {
    reply.status(404);
    return { error: 'Device not found' };
  }

  const deviceToken = randomBytes(36).toString('base64url');
  await devicesRepo.claimDevice(deviceId, consumed.userId, deviceToken);
  deviceStore.claimDevice(deviceId);
  ownership.setDeviceOwner(deviceId, consumed.userId);
  await createAuditEvent(request, {
    userId: consumed.userId,
    deviceId,
    eventType: 'device.claimed',
  });
  await createAuditEvent(request, {
    userId: consumed.userId,
    deviceId,
    eventType: 'device.token_issued',
  });

  return {
    ok: true,
    deviceToken,
    device: await getOwnedDevice(consumed.userId, deviceId),
  };
});

fastify.post('/desktop/auth/logout', async (request, reply) => {
  if (!(await enforceHttpRateLimit(reply, `ip:${request.ip}:desktop-auth:logout`, config.AUTH_LOGIN_PER_MIN, 60_000))) {
    return;
  }

  const desktopSession = await requireDesktopDeviceSession(request, reply);
  if (!desktopSession) {
    return { error: 'Unauthorized' };
  }

  const revoked = await revokeDesktopSession({
    deviceToken: desktopSession.deviceToken,
    devicesRepo,
  });

  if (!revoked.ok) {
    reply.status(401);
    return { error: 'Unauthorized' };
  }

  deviceStore.revokeSession(revoked.deviceId);
  ownership.setDeviceOwner(revoked.deviceId, revoked.userId);
  await createAuditEvent(request, {
    userId: revoked.userId,
    deviceId: revoked.deviceId,
    eventType: 'device.token_revoked',
  });

  return {
    ok: true,
    device: await getOwnedDevice(revoked.userId, revoked.deviceId),
  };
});

fastify.post('/desktop/auth/complete', async (request, reply) => {
  const user = await requireAuth(request, reply);
  if (!user) {
    return { error: 'Unauthorized' };
  }

  if (!(await enforceHttpRateLimit(reply, `user:${user.id}:desktop-auth:complete`, config.AUTH_LOGIN_PER_MIN, 60_000))) {
    return;
  }

  const { attemptId } = request.body as {
    attemptId?: string;
  };

  if (!attemptId) {
    reply.status(400);
    return { error: 'attemptId is required' };
  }

  const issued = desktopAuth.issueHandoff({
    attemptId,
    userId: user.id,
  });

  if (!issued.ok) {
    reply.status(issued.error === 'ATTEMPT_EXPIRED' ? 410 : 404);
    return { error: issued.error };
  }

  await createAuditEvent(request, {
    userId: user.id,
    deviceId: issued.deviceId,
    eventType: 'desktop.auth_handoff_issued',
    meta: { attemptId: issued.attemptId },
  });

  return {
    ok: true,
    handoffToken: issued.handoffToken,
    callbackUrl: issued.callbackUrl,
    state: issued.state,
    expiresAt: issued.expiresAt,
  };
});

fastify.get('/desktop/me', async (request, reply) => {
  const desktopSession = await requireDesktopDeviceSession(request, reply);
  if (!desktopSession) {
    return { error: 'Unauthorized' };
  }

  const user = await usersRepo.findById(desktopSession.userId);
  if (!user) {
    reply.status(401);
    return { error: 'Unauthorized' };
  }

  const [device, runs] = await Promise.all([
    getOwnedDevice(user.id, desktopSession.deviceId),
    runsRepo.listOwnedByDevice(user.id, desktopSession.deviceId, 12),
  ]);

  if (!device) {
    reply.status(404);
    return { error: 'Device not found' };
  }

  const activeRun = runs.find((run) => ['queued', 'running', 'waiting_for_user'].includes(run.status)) ?? null;

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
    },
    billing: getBillingSnapshot(user),
    device,
    runs,
    activeRun,
    readiness: {
      billingEnabled: config.BILLING_ENABLED,
      subscriptionStatus: user.subscriptionStatus === 'active' ? 'active' : 'inactive',
    },
  };
});

fastify.get('/desktop/account', async (request, reply) => {
  const desktopSession = await requireDesktopDeviceSession(request, reply);
  if (!desktopSession) {
    return { error: 'Unauthorized' };
  }

  const user = await usersRepo.findById(desktopSession.userId);
  if (!user) {
    reply.status(401);
    return { error: 'Unauthorized' };
  }

  const snapshot = await buildDesktopAccountSnapshot({
    user,
    currentDeviceId: desktopSession.deviceId,
    listOwnedDevices: () => getOwnedDevices(user.id),
  });

  return {
    ok: true,
    ...snapshot,
  };
});

fastify.post('/desktop/runs', async (request, reply) => {
  const desktopSession = await requireDesktopDeviceSession(request, reply);
  if (!desktopSession) {
    return { error: 'Unauthorized' };
  }

  if (!(await enforceHttpRateLimit(reply, `user:${desktopSession.userId}:runs:create`, config.RUNS_CREATE_PER_MIN, 60_000))) {
    return;
  }

  const user = await usersRepo.findById(desktopSession.userId);
  if (!user) {
    reply.status(401);
    return { error: 'Unauthorized' };
  }

  const { goal, mode } = request.body as {
    goal?: string;
    mode?: RunMode;
  };

  if (!goal?.trim()) {
    reply.status(400);
    return { error: 'goal is required' };
  }

  const device = await getOwnedDevice(user.id, desktopSession.deviceId);
  if (!device) {
    reply.status(404);
    return { error: 'Device not found' };
  }

  if (!device.paired) {
    reply.status(400);
    return { error: 'Device must be signed in before starting a run' };
  }

  const created = await createRunForOwnedDevice({
    userId: user.id,
    device,
    goal: goal.trim(),
    mode,
    queueEnabled: isDeviceCommandQueueEnabled(config.RATE_LIMIT_BACKEND),
    runStore,
    ownership,
    runsRepo,
    dispatchRunStart: (deviceId, payload) => dispatchDeviceCommandToDevice(deviceId, 'run.start', payload),
  });

  await createAuditEvent(request, {
    userId: user.id,
    deviceId: desktopSession.deviceId,
    runId: created.run.runId,
    eventType: 'run.created',
    meta: { mode: created.mode, initiatedBy: 'desktop' },
  });

  fastify.log.info(
    { runId: created.run.runId, deviceId: desktopSession.deviceId, mode: created.mode },
    'Desktop run created'
  );

  if (created.delivery && (created.delivery.queued || created.delivery.delivered)) {
    fastify.log.info(
      { runId: created.run.runId, mode: created.mode, queued: created.delivery.queued },
      'Desktop run start dispatched to device'
    );
  }

  return {
    ok: true,
    run: created.run,
  };
});

fastify.post('/desktop/devices/:deviceId/revoke', async (request, reply) => {
  const desktopSession = await requireDesktopDeviceSession(request, reply);
  if (!desktopSession) {
    return { error: 'Unauthorized' };
  }

  if (!(await enforceHttpRateLimit(reply, `user:${desktopSession.userId}:desktop-devices:revoke`, config.AUTH_LOGIN_PER_MIN, 60_000))) {
    return;
  }

  const { deviceId } = request.params as { deviceId: string };

  if (deviceId === desktopSession.deviceId) {
    reply.status(400);
    return { error: 'Use desktop sign out to revoke the current desktop session' };
  }

  const targetDevice = await devicesRepo.findByDeviceId(deviceId);
  if (!targetDevice || targetDevice.ownerUserId !== desktopSession.userId) {
    reply.status(404);
    return { error: 'Device not found' };
  }

  if (targetDevice.device.paired) {
    await devicesRepo.revokeOwnedDeviceSession(deviceId, desktopSession.userId);
    deviceStore.revokeSession(deviceId);
    ownership.setDeviceOwner(deviceId, desktopSession.userId);
    await createAuditEvent(request, {
      userId: desktopSession.userId,
      deviceId,
      eventType: 'device.token_revoked',
      meta: {
        initiatedBy: 'desktop',
        initiatedFromDeviceId: desktopSession.deviceId,
      },
    });
  }

  return {
    ok: true,
    device: await getOwnedDevice(desktopSession.userId, deviceId),
  };
});

// ============================================================================
// Billing Endpoints
// ============================================================================

fastify.get('/updates/desktop/:platform/:arch/:currentVersion.json', async (request, reply) => {
  if (!config.DESKTOP_UPDATE_ENABLED) {
    reply.status(404);
    return { error: 'Desktop updates are disabled' };
  }

  const { platform, arch, currentVersion } = request.params as {
    platform: string;
    arch: string;
    currentVersion: string;
  };

  try {
    const manifest = await getDesktopUpdateManifest(platform, arch, currentVersion);
    return manifest;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    fastify.log.warn({ platform, arch, err: message }, 'Desktop update manifest unavailable');
    reply.status(message === 'Invalid update target' ? 400 : 404);
    return { error: message === 'Invalid update target' ? 'Invalid update target' : 'Update manifest not found' };
  }
});

fastify.get('/billing/status', async (request, reply) => {
  const user = await requireAuth(request, reply);
  if (!user) {
    return { error: 'Unauthorized' };
  }

  const billing = await usersRepo.getBilling(user.id);
  if (!billing) {
    reply.status(404);
    return { error: 'User not found' };
  }

  return getBillingSnapshot(billing);
});

fastify.get('/downloads/desktop', async (_request, reply) => {
  try {
    return await getDesktopDownloadsPayload();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    fastify.log.warn({ err: message }, 'Desktop downloads unavailable');
    reply.status(503);
    return { error: 'Downloads are not configured. Contact support.' };
  }
});

fastify.get('/downloads/desktop/artifacts/:artifactName', async (request, reply) => {
  const { artifactName } = request.params as { artifactName: string };
  const artifactPath = getDesktopArtifactPath(artifactName);

  if (!artifactPath) {
    reply.status(400);
    return { error: 'Invalid artifact name' };
  }

  try {
    const artifact = await readFile(artifactPath);
    reply.header('Cache-Control', 'no-store');
    reply.type(getDesktopArtifactContentType(artifactName));
    return reply.send(artifact);
  } catch {
    reply.status(404);
    return { error: 'Artifact not found' };
  }
});

fastify.post('/billing/checkout', async (request, reply) => {
  const user = await requireAuth(request, reply);
  if (!user) {
    return { error: 'Unauthorized' };
  }
  if (!(await enforceHttpRateLimit(reply, `user:${user.id}:billing`, config.BILLING_PER_MIN, 60_000))) {
    return;
  }

  const currentUser = await usersRepo.getBilling(user.id);
  if (!currentUser) {
    reply.status(404);
    return { error: 'User not found' };
  }

  let stripeCustomerId = currentUser.stripeCustomerId;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: currentUser.email,
      metadata: {
        userId: currentUser.id,
      },
    });
    stripeCustomerId = customer.id;
    await usersRepo.updateStripeCustomerId(currentUser.id, stripeCustomerId);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: stripeCustomerId,
    line_items: [
      {
        price: config.STRIPE_PRICE_ID,
        quantity: 1,
      },
    ],
    success_url: `${config.APP_BASE_URL}/dashboard?billing=success`,
    cancel_url: `${config.APP_BASE_URL}/billing?billing=cancel`,
    allow_promotion_codes: true,
  });

  await createAuditEvent(request, {
    userId: user.id,
    eventType: 'billing.checkout_requested',
  });

  return { url: session.url };
});

fastify.post('/billing/portal', async (request, reply) => {
  const user = await requireAuth(request, reply);
  if (!user) {
    return { error: 'Unauthorized' };
  }
  if (!(await enforceHttpRateLimit(reply, `user:${user.id}:billing`, config.BILLING_PER_MIN, 60_000))) {
    return;
  }

  const currentUser = await usersRepo.getBilling(user.id);
  if (!currentUser?.stripeCustomerId) {
    reply.status(400);
    return { error: 'No Stripe customer found' };
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: currentUser.stripeCustomerId,
    return_url: `${config.APP_BASE_URL}/billing`,
  });

  await createAuditEvent(request, {
    userId: user.id,
    eventType: 'billing.portal_requested',
  });

  return { url: session.url };
});

fastify.post('/billing/webhook', {
  config: { rawBody: true },
  bodyLimit: WEBHOOK_RAW_BODY_LIMIT,
}, async (request, reply) => {
  if (!(await enforceHttpRateLimit(reply, `ip:${request.ip}:billing:webhook`, config.BILLING_PER_MIN, 60_000))) {
    return;
  }

  const signature = request.headers['stripe-signature'];
  const rawBody = (request as typeof request & { rawBody?: Buffer }).rawBody;

  if (!signature || Array.isArray(signature) || !rawBody) {
    incCounter('stripe_webhook_failures_total', metricLabels({ reason: 'invalid_request' }));
    reply.status(400);
    return { error: 'Invalid webhook request' };
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, config.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    incCounter('stripe_webhook_failures_total', metricLabels({ reason: 'invalid_signature' }));
    fastify.log.warn({ err: redact(err) }, 'Stripe webhook signature verification failed');
    reply.status(400);
    return { error: 'Invalid signature' };
  }

  fastify.log.info({ eventId: event.id, eventType: event.type }, 'Stripe webhook received');

  if (await stripeEventsRepo.exists(event.id)) {
    fastify.log.info({ eventId: event.id, eventType: event.type }, 'Stripe webhook duplicate ignored');
    return { received: true, duplicate: true };
  }

  try {
    await stripeEventsRepo.create(event.id, event.type);
  } catch {
    fastify.log.info({ eventId: event.id, eventType: event.type }, 'Stripe webhook duplicate race ignored');
    return { received: true, duplicate: true };
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as any;
        const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
        if (customerId) {
          await usersRepo.updateSubscriptionByStripeCustomerId(
            customerId,
            getSubscriptionFields(subscription)
          );
        }
        break;
      }

      case 'checkout.session.completed': {
        const session = event.data.object as any;
        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
        if (customerId && typeof session.subscription === 'string') {
          await usersRepo.updateSubscriptionByStripeCustomerId(customerId, {
            subscriptionStatus: 'active',
            subscriptionId: session.subscription,
          });
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    incCounter('stripe_webhook_failures_total', metricLabels({ reason: 'processing_error' }));
    fastify.log.error(
      { eventId: event.id, eventType: event.type, err: err instanceof Error ? err.message : String(err) },
      'Stripe webhook processing failed'
    );
    reply.status(500);
    return { error: 'Webhook processing failed' };
  }

  return { received: true };
});

// ============================================================================
// Device REST Endpoints
// ============================================================================

fastify.get('/devices', async (request, reply) => {
  const user = await requireAuth(request, reply);
  if (!user) {
    return { error: 'Unauthorized' };
  }

  return {
    devices: await getOwnedDevices(user.id),
  };
});

fastify.get('/devices/:deviceId', async (request, reply) => {
  const user = await requireAuth(request, reply);
  if (!user) {
    return { error: 'Unauthorized' };
  }

  const { deviceId } = request.params as { deviceId: string };
  const device = await getOwnedDevice(user.id, deviceId);

  if (!device) {
    reply.status(404);
    return { error: 'Device not found' };
  }

  return { device };
});

fastify.post('/devices/:deviceId/pair', async (request, reply) => {
  const user = await requireAuth(request, reply);
  if (!user) {
    return { error: 'Unauthorized' };
  }

  const { deviceId } = request.params as { deviceId: string };
  const { pairingCode } = request.body as { pairingCode: string };

  if (!pairingCode) {
    reply.status(400);
    return { error: 'pairingCode is required' };
  }

  const pairable = await getPairableDevice(deviceId);
  if (!pairable || !pairable.device.connected) {
    reply.status(400);
    return { error: 'Device must be connected before pairing' };
  }

  const normalizedCode = pairingCode.toUpperCase().trim();
  if (!pairable.device.pairingCode || pairable.device.pairingCode !== normalizedCode) {
    reply.status(400);
    return { error: 'Invalid pairing code' };
  }

  if (pairable.device.pairingExpiresAt && Date.now() > pairable.device.pairingExpiresAt) {
    reply.status(400);
    return { error: 'Pairing code expired' };
  }

  const deviceToken = randomBytes(36).toString('base64url');
  await devicesRepo.claimDevice(deviceId, user.id, deviceToken);
  deviceStore.claimDevice(deviceId);
  ownership.setDeviceOwner(deviceId, user.id);
  await createAuditEvent(request, {
    userId: user.id,
    deviceId,
    eventType: 'device.claimed',
  });
  await createAuditEvent(request, {
    userId: user.id,
    deviceId,
    eventType: 'device.token_issued',
  });

  await dispatchDeviceCommandToDevice(deviceId, 'device.token', {
    deviceToken,
  });
  sendToDevice(deviceId, createServerMessage('server.chat.message', {
    deviceId,
    message: {
      role: 'agent' as const,
      text: '🎉 Device paired successfully! You can now receive commands.',
      createdAt: Date.now(),
    },
  }));

  return { ok: true, device: await getOwnedDevice(user.id, deviceId) };
});

// ============================================================================
// Screen Preview Endpoints (Iteration 4)
// ============================================================================

fastify.get('/devices/:deviceId/screen/meta', async (request, reply) => {
  const queryUser = authFromQueryToken((request.query as { token?: string }).token);
  const user = queryUser ?? await requireAuth(request, reply);
  if (!user) {
    return { error: 'Unauthorized' };
  }

  const { deviceId } = request.params as { deviceId: string };
  
  const device = deviceStore.get(deviceId);
  if (!device || ownership.getDeviceOwner(deviceId) !== user.id) {
    reply.status(404);
    return { error: 'Device not found' };
  }

  const meta = screenStore.getMeta(deviceId);
  if (!meta) {
    reply.status(404);
    return { error: 'No screen frame available' };
  }

  return { ok: true, meta };
});

fastify.get('/devices/:deviceId/screen.png', async (request, reply) => {
  const queryUser = authFromQueryToken((request.query as { token?: string }).token);
  const user = queryUser ?? await requireAuth(request, reply);
  if (!user) {
    return { error: 'Unauthorized' };
  }

  const { deviceId } = request.params as { deviceId: string };
  
  const device = deviceStore.get(deviceId);
  if (!device || ownership.getDeviceOwner(deviceId) !== user.id) {
    reply.status(404);
    return { error: 'Device not found' };
  }

  const frame = screenStore.getFrame(deviceId);
  if (!frame) {
    reply.status(404);
    return { error: 'No screen frame available' };
  }

  reply.header('Content-Type', 'image/png');
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  reply.header('Pragma', 'no-cache');
  reply.header('Expires', '0');
  
  return reply.send(frame.bytes);
});

// ============================================================================
// Remote Control Endpoints (Iteration 5)
// ============================================================================

// Create a new control action
fastify.post('/devices/:deviceId/actions', async (request, reply) => {
  const user = await requireAuth(request, reply);
  if (!user) {
    return { error: 'Unauthorized' };
  }

  if (!(await requireActiveSubscription(request, reply, user))) {
    return;
  }

  const { deviceId } = request.params as { deviceId: string };
  const { action } = request.body as { action: InputAction };
  if (!(await enforceHttpRateLimit(reply, `device:${deviceId}:control:request`, config.CONTROL_ACTIONS_PER_10S, 10_000))) {
    return;
  }

  // Validate device exists
  const device = deviceStore.get(deviceId);
  if (!device || ownership.getDeviceOwner(deviceId) !== user.id) {
    reply.status(404);
    return { error: 'Device not found' };
  }

  const queueEnabled = isDeviceCommandQueueEnabled(config.RATE_LIMIT_BACKEND);

  // Without Redis queuing, device commands still require a live connection.
  if (!queueEnabled && !device.connected) {
    reply.status(400);
    return { error: 'Device is not connected' };
  }

  // Check device is paired
  if (!device.paired) {
    reply.status(400);
    return { error: 'Device must be paired for remote control' };
  }

  // Check control is enabled
  const controlState = deviceStore.getControlState(deviceId);
  if (!controlState?.enabled) {
    reply.status(403);
    return { error: 'Remote control is not enabled on this device', code: 'CONTROL_NOT_ENABLED' };
  }

  // Create action
  const deviceAction = actionStore.createAction(deviceId, action, 'web');
  ownership.setActionOwner(deviceAction.actionId, user.id);
  await actionsRepo.save(deviceAction, user.id);
  await createAuditEvent(request, {
    userId: user.id,
    deviceId,
    actionId: deviceAction.actionId,
    eventType: 'control.requested',
    meta: getActionAuditMeta(action),
  });
  
  // Log action (with redaction for sensitive data)
  fastify.log.info({ 
    actionId: deviceAction.actionId, 
    deviceId, 
    action: redactActionForLog(action),
  }, 'Control action created');

  const delivery = await dispatchDeviceCommandToDevice(deviceId, 'action.request', {
    actionId: deviceAction.actionId,
    action,
    requestedAt: Date.now(),
  });

  if (!delivery.queued && !delivery.delivered) {
    // Device disconnected between check and direct fallback send.
    const failedAction = actionStore.setResult(deviceAction.actionId, false, { code: 'DEVICE_DISCONNECTED', message: 'Device disconnected' });
    if (failedAction) {
      await actionsRepo.save(failedAction, user.id);
    }
    await createAuditEvent(request, {
      userId: user.id,
      deviceId,
      actionId: deviceAction.actionId,
      eventType: 'control.failed',
      meta: getActionAuditMeta(action),
    });
    reply.status(503);
    return { error: 'Device disconnected' };
  }

  // Update status to awaiting_user
  const awaitingAction = actionStore.setStatus(deviceAction.actionId, 'awaiting_user');
  if (awaitingAction) {
    await actionsRepo.save(awaitingAction, user.id);
  }
  await createAuditEvent(request, {
    userId: user.id,
    deviceId,
    actionId: deviceAction.actionId,
    eventType: 'control.awaiting_user',
    meta: getActionAuditMeta(action),
  });

  return { ok: true, actionId: deviceAction.actionId };
});

// List actions for a device
fastify.get('/devices/:deviceId/actions', async (request, reply) => {
  const user = await requireAuth(request, reply);
  if (!user) {
    return { error: 'Unauthorized' };
  }

  const { deviceId } = request.params as { deviceId: string };
  const limit = Math.min(100, parseInt((request.query as { limit?: string }).limit || '50', 10));

  const device = deviceStore.get(deviceId);
  if (!device || ownership.getDeviceOwner(deviceId) !== user.id) {
    reply.status(404);
    return { error: 'Device not found' };
  }

  const actions = actionStore.getByDevice(deviceId, limit).filter((entry) => ownership.getActionOwner(entry.actionId) === user.id);
  return { actions };
});

// ============================================================================
// Run REST Endpoints
// ============================================================================

fastify.post('/runs', async (request, reply) => {
  const user = await requireAuth(request, reply);
  if (!user) {
    return { error: 'Unauthorized' };
  }
  if (!(await enforceHttpRateLimit(reply, `user:${user.id}:runs:create`, config.RUNS_CREATE_PER_MIN, 60_000))) {
    return;
  }

  if (!(await requireActiveSubscription(request, reply, user))) {
    return;
  }

  const { deviceId, goal, mode } = request.body as { deviceId: string; goal: string; mode?: RunMode };

  if (!deviceId || !goal?.trim()) {
    reply.status(400);
    return { error: 'deviceId and goal are required' };
  }

  const device = deviceStore.get(deviceId);
  if (!device || ownership.getDeviceOwner(deviceId) !== user.id) {
    reply.status(404);
    return { error: 'Device not found' };
  }

  if (!device.paired) {
    reply.status(400);
    return { error: 'Device must be paired before starting a run' };
  }

  const created = await createRunForOwnedDevice({
    userId: user.id,
    device,
    goal: goal.trim(),
    mode,
    queueEnabled: isDeviceCommandQueueEnabled(config.RATE_LIMIT_BACKEND),
    runStore,
    ownership,
    runsRepo,
    dispatchRunStart: (targetDeviceId, payload) => dispatchDeviceCommandToDevice(targetDeviceId, 'run.start', payload),
  });

  await createAuditEvent(request, {
    userId: user.id,
    deviceId,
    runId: created.run.runId,
    eventType: 'run.created',
    meta: { mode: created.mode },
  });
  
  fastify.log.info({ runId: created.run.runId, deviceId, mode: created.mode }, 'Run created');

  if (created.delivery?.queued || created.delivery?.delivered) {
    fastify.log.info(
      { runId: created.run.runId, mode: created.mode, queued: created.delivery.queued },
      'Run start dispatched to device'
    );
  } else if (device.connected || isDeviceCommandQueueEnabled(config.RATE_LIMIT_BACKEND)) {
    fastify.log.warn({ runId: created.run.runId, deviceId }, 'Failed to dispatch run.start to device');
  }

  return { run: created.run };
});

fastify.get('/runs/:runId', async (request, reply) => {
  const user = await requireAuth(request, reply);
  if (!user) {
    return { error: 'Unauthorized' };
  }

  const { runId } = request.params as { runId: string };
  const run = runStore.get(runId);

  if (!run || ownership.getRunOwner(runId) !== user.id) {
    reply.status(404);
    return { error: 'Run not found' };
  }

  return { run };
});

fastify.get('/runs', async (request, reply) => {
  const user = await requireAuth(request, reply);
  if (!user) {
    return { error: 'Unauthorized' };
  }

  return {
    runs: runStore.getAll().filter((run) => ownership.getRunOwner(run.runId) === user.id),
  };
});

fastify.get('/devices/:deviceId/runs', async (request, reply) => {
  const user = await requireAuth(request, reply);
  if (!user) {
    return { error: 'Unauthorized' };
  }

  const { deviceId } = request.params as { deviceId: string };
  if (ownership.getDeviceOwner(deviceId) !== user.id) {
    reply.status(404);
    return { error: 'Device not found' };
  }

  const runs = runStore.getByDevice(deviceId).filter((run) => ownership.getRunOwner(run.runId) === user.id);
  return { runs };
});

fastify.post('/runs/:runId/cancel', async (request, reply) => {
  const user = await requireAuth(request, reply);
  if (!user) {
    return { error: 'Unauthorized' };
  }

  const { runId } = request.params as { runId: string };
  const { reason } = request.body as { reason?: string } || {};

  const run = runStore.get(runId);
  if (!run || ownership.getRunOwner(runId) !== user.id) {
    reply.status(404);
    return { error: 'Run not found' };
  }

  const canceled = runStore.cancel(runId, reason || 'Canceled by user');
  if (!canceled) {
    reply.status(400);
    return { error: 'Run cannot be canceled (may already be completed or failed)' };
  }

  await dispatchDeviceCommandToDevice(run.deviceId, 'run.canceled', {
    runId,
  });

  await runsRepo.save(canceled, user.id);
  await createAuditEvent(request, {
    userId: user.id,
    deviceId: canceled.deviceId,
    runId,
    eventType: 'run.canceled',
  });
  fastify.log.info({ runId }, 'Run canceled');
  return { run: canceled };
});

// ============================================================================
// Tool Timeline Endpoints (Iteration 8)
// ============================================================================

// Get tool timeline for a run
fastify.get('/runs/:runId/tools', async (request, reply) => {
  const user = await requireAuth(request, reply);
  if (!user) {
    return { error: 'Unauthorized' };
  }

  const { runId } = request.params as { runId: string };
  const limit = Math.min(100, parseInt((request.query as { limit?: string }).limit || '50', 10));

  const run = runStore.get(runId);
  if (!run || ownership.getRunOwner(runId) !== user.id) {
    reply.status(404);
    return { error: 'Run not found' };
  }

  const tools = toolStore.getByRun(runId, limit).filter((tool) => ownership.getToolOwner(tool.toolEventId) === user.id);
  return { tools };
});

// Get tool timeline for a device
fastify.get('/devices/:deviceId/tools', async (request, reply) => {
  const user = await requireAuth(request, reply);
  if (!user) {
    return { error: 'Unauthorized' };
  }

  const { deviceId } = request.params as { deviceId: string };
  const limit = Math.min(100, parseInt((request.query as { limit?: string }).limit || '50', 10));

  const device = deviceStore.get(deviceId);
  if (!device || ownership.getDeviceOwner(deviceId) !== user.id) {
    reply.status(404);
    return { error: 'Device not found' };
  }

  const tools = toolStore.getByDevice(deviceId, limit).filter((tool) => ownership.getToolOwner(tool.toolEventId) === user.id);
  return { tools };
});

// ============================================================================
// SSE Endpoint for Real-time Updates
// ============================================================================

fastify.get('/events', async (request, reply) => {
  if (!(await enforceHttpRateLimit(reply, `ip:${request.ip}:sse`, config.SSE_CONNECT_PER_MIN, 60_000))) {
    return;
  }

  const cookieOrBearerUser = getRequestAuthUser(request);
  const queryUser = authFromQueryToken((request.query as { token?: string }).token);
  const user = cookieOrBearerUser ?? queryUser;
  if (!user) {
    reply.status(401);
    return { error: 'Unauthorized' };
  }

  reply.raw.writeHead(200, buildSseHeaders(request.headers.origin, config.WEB_ORIGINS));

  const clientId = randomUUID();
  sseClients.set(clientId, { id: clientId, userId: user.id, reply });
  setGauge('sse_clients_current', sseClients.size);

  fastify.log.info({ clientId, count: sseClients.size, requestId: request.id }, 'SSE client connected');

  // Send initial connection message
  reply.raw.write(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`);

  // Handle client disconnect
  request.raw.on('close', () => {
    sseClients.delete(clientId);
    setGauge('sse_clients_current', sseClients.size);
    fastify.log.info({ clientId, count: sseClients.size, requestId: request.id }, 'SSE client disconnected');
  });

  // Keep connection alive
  const keepAlive = setInterval(() => {
    try {
      reply.raw.write(': keepalive\n\n');
    } catch {
      clearInterval(keepAlive);
      sseClients.delete(clientId);
      setGauge('sse_clients_current', sseClients.size);
    }
  }, 30000);

  // Don't close the connection
  return reply;
});

// ============================================================================
// WebSocket Setup
// ============================================================================

setupWebSocket(fastify);

// ============================================================================
// Start Server
// ============================================================================

try {
  for (const warning of versionDriftWarnings) {
    fastify.log.warn({ warning }, 'Version drift detected');
  }
  await fastify.listen({ port: config.PORT, host: '0.0.0.0' });
  fastify.log.info(`API server listening on port ${config.PORT}`);
} catch (err) {
  fastify.log.error({ err: redact(err) }, 'API server failed to start');
  process.exit(1);
}

// Graceful shutdown
process.on('SIGINT', async () => {
  fastify.log.info('Shutting down gracefully...');
  stopRetentionScheduler?.();
  deviceStore.markAllDisconnected();
  
  for (const [, client] of sseClients) {
    try {
      client.reply.raw.end();
    } catch {
      // Ignore
    }
  }
  sseClients.clear();
  
  await fastify.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  fastify.log.info('Shutting down gracefully...');
  stopRetentionScheduler?.();
  deviceStore.markAllDisconnected();
  
  for (const [, client] of sseClients) {
    try {
      client.reply.raw.end();
    } catch {
      // Ignore
    }
  }
  sseClients.clear();
  
  await fastify.close();
  process.exit(0);
});
