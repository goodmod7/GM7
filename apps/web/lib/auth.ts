const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3001';
const CSRF_COOKIE_NAME = 'csrf_token';
const ACCESS_TOKEN_STORAGE_KEY = 'ai_operator_access_token';
let lastRateLimitNoticeAt = 0;

export interface SessionUser {
  id: string;
  email: string;
}

export interface BrowserSession {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt?: string | null;
  userAgent?: string | null;
}

export interface BillingStatus {
  subscriptionStatus: 'active' | 'inactive';
  subscriptionCurrentPeriodEnd?: string | null;
  planPriceId?: string | null;
}

export interface DesktopDownloadInfo {
  version: string;
  windowsUrl: string;
  macIntelUrl: string;
  macArmUrl: string;
  notes?: string;
  publishedAt?: string;
}

interface ApiFetchOptions extends RequestInit {
  retryOnAuthFailure?: boolean;
}

function getBrowserStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getStoredAccessToken(): string | null {
  const storage = getBrowserStorage();
  if (!storage) {
    return null;
  }

  try {
    const token = storage.getItem(ACCESS_TOKEN_STORAGE_KEY);
    return token?.trim() || null;
  } catch {
    return null;
  }
}

function storeAccessToken(token: string | null): void {
  const storage = getBrowserStorage();
  if (!storage) {
    return;
  }

  try {
    if (token && token.trim()) {
      storage.setItem(ACCESS_TOKEN_STORAGE_KEY, token.trim());
      return;
    }

    storage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage access failures in locked-down browser contexts.
  }
}

function clearStoredAccessToken(): void {
  storeAccessToken(null);
}

function shouldSetJsonContentType(init: RequestInit): boolean {
  return Boolean(init.body) && !(init.body instanceof FormData);
}

function getCsrfToken(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const cookies = document.cookie.split(';');
  for (const part of cookies) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName === CSRF_COOKIE_NAME) {
      return decodeURIComponent(rest.join('='));
    }
  }

  return null;
}

function isMutation(method?: string): boolean {
  const normalized = (method || 'GET').toUpperCase();
  return normalized === 'POST' || normalized === 'PUT' || normalized === 'PATCH' || normalized === 'DELETE';
}

function shouldAttemptRefresh(path: string): boolean {
  return path !== '/auth/login' && path !== '/auth/register' && path !== '/auth/refresh';
}

async function refreshSession(): Promise<boolean> {
  const headers = new Headers();
  const csrfToken = getCsrfToken();
  if (csrfToken) {
    headers.set('x-csrf-token', csrfToken);
  }

  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers,
  });
  return response.ok;
}

function redirectToLogin(): void {
  if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
}

function notifyRateLimit(): void {
  if (typeof window === 'undefined') {
    return;
  }

  const now = Date.now();
  if (now - lastRateLimitNoticeAt < 30_000) {
    return;
  }

  lastRateLimitNoticeAt = now;
  window.alert('Rate limit exceeded, retry later');
}

export function buildApiUrl(path: string, options: { includeAccessTokenQuery?: boolean } = {}): string {
  const url = new URL(path, API_BASE);

  if (options.includeAccessTokenQuery) {
    const token = getStoredAccessToken();
    if (token) {
      url.searchParams.set('token', token);
    }
  }

  return url.toString();
}

export async function apiFetch(path: string, init: ApiFetchOptions = {}): Promise<Response> {
  const { retryOnAuthFailure = true, ...requestInit } = init;
  const headers = new Headers(requestInit.headers);
  const accessToken = getStoredAccessToken();

  if (!headers.has('Content-Type') && shouldSetJsonContentType(requestInit)) {
    headers.set('Content-Type', 'application/json');
  }

  if (accessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  if (isMutation(requestInit.method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers.set('x-csrf-token', csrfToken);
    }
  }

  const response = await fetch(buildApiUrl(path), {
    ...requestInit,
    headers,
    credentials: 'include',
  });

  if (
    response.status === 401 &&
    retryOnAuthFailure &&
    shouldAttemptRefresh(path)
  ) {
    const refreshed = await refreshSession();
    if (!refreshed) {
      if (accessToken) {
        clearStoredAccessToken();
      }
      redirectToLogin();
      return response;
    }

    return apiFetch(path, {
      ...requestInit,
      retryOnAuthFailure: false,
    });
  }

  if (response.status === 429) {
    notifyRateLimit();
  }

  return response;
}

export async function getMe(): Promise<SessionUser | null> {
  const response = await apiFetch('/auth/me');
  if (response.status === 401) {
    clearStoredAccessToken();
    return null;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch current user');
  }

  return data.user as SessionUser;
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Login failed');
  }

  if (typeof data.token === 'string' && data.token.trim()) {
    storeAccessToken(data.token);
  }

  return data.user as SessionUser;
}

export async function logout(): Promise<void> {
  try {
    const response = await apiFetch('/auth/logout', {
      method: 'POST',
    });
    const data = await response.json().catch(() => ({ error: 'Logout failed' }));

    if (!response.ok) {
      throw new Error(data.error || 'Logout failed');
    }
  } finally {
    clearStoredAccessToken();
  }
}

export async function logoutAllSessions(): Promise<void> {
  try {
    const response = await apiFetch('/auth/logout_all', {
      method: 'POST',
    });
    const data = await response.json().catch(() => ({ error: 'Logout all failed' }));

    if (!response.ok) {
      throw new Error(data.error || 'Logout all failed');
    }
  } finally {
    clearStoredAccessToken();
  }
}

export async function getSessions(): Promise<BrowserSession[]> {
  const response = await apiFetch('/auth/sessions');
  if (response.status === 401) {
    return [];
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch sessions');
  }

  return (data.sessions || []) as BrowserSession[];
}

export async function getBillingStatus(): Promise<BillingStatus> {
  const response = await apiFetch('/billing/status');
  const data = await response.json().catch(() => ({ error: 'Failed to fetch billing status' }));

  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch billing status');
  }

  return data as BillingStatus;
}

export async function createCheckoutSession(): Promise<string> {
  const response = await apiFetch('/billing/checkout', {
    method: 'POST',
  });
  const data = await response.json().catch(() => ({ error: 'Failed to create checkout session' }));

  if (!response.ok) {
    throw new Error(data.error || 'Failed to create checkout session');
  }

  return data.url as string;
}

export async function createPortalSession(): Promise<string> {
  const response = await apiFetch('/billing/portal', {
    method: 'POST',
  });
  const data = await response.json().catch(() => ({ error: 'Failed to create billing portal session' }));

  if (!response.ok) {
    throw new Error(data.error || 'Failed to create billing portal session');
  }

  return data.url as string;
}

export async function getDesktopDownloads(): Promise<DesktopDownloadInfo | null> {
  const response = await apiFetch('/downloads/desktop');
  if (response.status === 402) {
    return null;
  }

  const data = await response.json().catch(() => ({ error: 'Failed to fetch desktop downloads' }));

  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch desktop downloads');
  }

  return data as DesktopDownloadInfo;
}
