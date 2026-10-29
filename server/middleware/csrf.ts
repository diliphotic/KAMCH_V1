import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export const CSRF_COOKIE_NAME = 'kamch_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

/**
 * Generates a cryptographically secure random token for CSRF protection.
 */
export function generateCsrfToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * Attaches or refreshes the CSRF cookie on a response.
 */
export function setCsrfCookie(res: Response, token: string, isSecure = false): void {
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false, // Must be readable by client JS to send in custom request header
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 1000, // 1 hour
  });
}

/**
 * Validates CSRF tokens on state-changing requests (POST, PUT, PATCH, DELETE).
 * Public login is exempted from header check to allow initial session bootstrapping,
 * but all authenticated state changes strictly enforce matching tokens.
 */
export function validateCsrf(req: Request, res: Response, next: NextFunction): void {
  // Safe idempotent HTTP methods are exempt from CSRF checks
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Public login endpoint is exempted from pre-session CSRF token validation
  // It issues a fresh CSRF token immediately upon successful authentication
  if (req.path === '/login' || req.path === '/api/auth/login') {
    return next();
  }

  const tokenFromHeader = req.headers[CSRF_HEADER_NAME] || req.headers['X-CSRF-Token'];
  const tokenFromCookie = req.cookies?.[CSRF_COOKIE_NAME];

  if (
    !tokenFromHeader ||
    !tokenFromCookie ||
    typeof tokenFromHeader !== 'string' ||
    typeof tokenFromCookie !== 'string' ||
    tokenFromHeader.length < 16 ||
    tokenFromHeader !== tokenFromCookie
  ) {
    res.status(403).json({
      error: 'Invalid or missing CSRF security token',
      code: 'INVALID_CSRF_TOKEN',
    });
    return;
  }

  next();
}
