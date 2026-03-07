import argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';

export interface AuthUser {
  id: string;
  email: string;
}

export type AuthenticatedRequest = FastifyRequest & { user?: AuthUser };

const authAttempts = new Map<string, number[]>();
const AUTH_WINDOW_MS = 60_000;
const AUTH_LIMIT = 10;

function parseDurationSeconds(expiresIn: string): number {
  const trimmed = expiresIn.trim();
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  const match = trimmed.match(/^(\d+)([smhd])$/i);
  if (!match) {
    return 30 * 60;
  }

  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 's':
      return amount;
    case 'm':
      return amount * 60;
    case 'h':
      return amount * 60 * 60;
    case 'd':
      return amount * 60 * 60 * 24;
    default:
      return 30 * 60;
  }
}

function getCookieBaseOptions() {
  return {
    sameSite: 'lax' as const,
    secure: config.NODE_ENV === 'production',
    path: '/',
  };
}

function getAccessCookieOptions() {
  return {
    ...getCookieBaseOptions(),
    httpOnly: true,
    maxAge: parseDurationSeconds(config.ACCESS_TOKEN_EXPIRES_IN),
  };
}

function getRefreshCookieOptions() {
  return {
    ...getCookieBaseOptions(),
    httpOnly: true,
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
  };
}

function getCsrfCookieOptions() {
  return {
    ...getCookieBaseOptions(),
    httpOnly: false,
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
  };
}

export function rateLimitAuth(key: string): boolean {
  const now = Date.now();
  const timestamps = (authAttempts.get(key) ?? []).filter((ts) => now - ts < AUTH_WINDOW_MS);
  if (timestamps.length >= AUTH_LIMIT) {
    authAttempts.set(key, timestamps);
    return false;
  }
  timestamps.push(now);
  authAttempts.set(key, timestamps);
  return true;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return argon2.verify(passwordHash, password);
}

export function issueAccessToken(user: AuthUser): string {
  return jwt.sign(user, config.JWT_SECRET, {
    expiresIn: config.ACCESS_TOKEN_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    subject: user.id,
  });
}

export function verifyAccessToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const decoded = payload as jwt.JwtPayload;
    if (typeof decoded.id !== 'string' || typeof decoded.email !== 'string') {
      return null;
    }
    return { id: decoded.id, email: decoded.email };
  } catch {
    return null;
  }
}

export function issueRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256')
    .update(config.JWT_SECRET)
    .update(':')
    .update(token)
    .digest('hex');
}

export function issueCsrfToken(): string {
  return randomBytes(24).toString('base64url');
}

export function getRefreshTokenExpiryDate(): Date {
  return new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function getBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return null;
  }
  return header.slice('Bearer '.length).trim() || null;
}

export function hasBearerAuth(request: FastifyRequest): boolean {
  return Boolean(getBearerToken(request));
}

export function getCookieValue(request: FastifyRequest, cookieName: string): string | null {
  const cookies = request.cookies as Record<string, string> | undefined;
  const value = cookies?.[cookieName];
  return value ? value.trim() : null;
}

export function getAccessCookieToken(request: FastifyRequest): string | null {
  return getCookieValue(request, config.ACCESS_COOKIE_NAME);
}

export function getRefreshCookieToken(request: FastifyRequest): string | null {
  return getCookieValue(request, config.REFRESH_COOKIE_NAME);
}

export function getCsrfCookieToken(request: FastifyRequest): string | null {
  return getCookieValue(request, config.CSRF_COOKIE_NAME);
}

export function getRequestAuthUser(request: FastifyRequest): AuthUser | null {
  const token = getBearerToken(request) ?? getAccessCookieToken(request);
  if (!token) {
    return null;
  }
  return verifyAccessToken(token);
}

export function setAccessCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(config.ACCESS_COOKIE_NAME, token, getAccessCookieOptions());
}

export function setRefreshCookie(reply: FastifyReply, refreshToken: string): void {
  reply.setCookie(config.REFRESH_COOKIE_NAME, refreshToken, getRefreshCookieOptions());
}

export function setCsrfCookie(reply: FastifyReply, csrfToken: string): void {
  reply.setCookie(config.CSRF_COOKIE_NAME, csrfToken, getCsrfCookieOptions());
}

export function setSessionCookies(reply: FastifyReply, accessToken: string, refreshToken: string, csrfToken: string): void {
  setAccessCookie(reply, accessToken);
  setRefreshCookie(reply, refreshToken);
  setCsrfCookie(reply, csrfToken);
}

export function clearAuthCookies(reply: FastifyReply): void {
  const baseOptions = getCookieBaseOptions();
  reply.clearCookie(config.ACCESS_COOKIE_NAME, {
    ...baseOptions,
    httpOnly: true,
  });
  reply.clearCookie(config.REFRESH_COOKIE_NAME, {
    ...baseOptions,
    httpOnly: true,
  });
  reply.clearCookie(config.CSRF_COOKIE_NAME, {
    ...baseOptions,
    httpOnly: false,
  });
}

export function shouldCheckCsrf(request: FastifyRequest): boolean {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return false;
  }

  const path = request.url.split('?')[0];

  if (path === '/auth/login' || path === '/auth/register') {
    return false;
  }

  if (path === '/billing/webhook') {
    return false;
  }

  if (hasBearerAuth(request)) {
    return false;
  }

  return Boolean(getAccessCookieToken(request) || getRefreshCookieToken(request));
}

export function isValidCsrf(request: FastifyRequest): boolean {
  const headerValue = request.headers['x-csrf-token'];
  const csrfHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const csrfCookie = getCsrfCookieToken(request);
  return Boolean(csrfCookie && csrfHeader && csrfHeader === csrfCookie);
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null> {
  const user = getRequestAuthUser(request);
  if (!user) {
    reply.status(401);
    return null;
  }

  (request as AuthenticatedRequest).user = user;
  return user;
}
