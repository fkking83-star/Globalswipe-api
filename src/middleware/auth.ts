import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import pool from '../config/database';

dotenv.config();

const API_KEYS = (process.env.API_KEYS || '').split(',').map((k) => k.trim()).filter(Boolean);

export interface JwtPayload {
  userId: string;
  email?: string;
  role?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      authType?: 'api_key' | 'jwt';
    }
  }
}

export async function logSecurityEvent(
  eventType: string,
  req: Request,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    const headerUserId = req.headers['x-user-id'];
    const jwtUserId = req.user?.userId;
    const rawUserId = (typeof headerUserId === 'string' ? headerUserId : null) || jwtUserId || null;

    // user_id kolonnen er UUID – API-keys er ikke UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const userId = rawUserId && uuidRegex.test(rawUserId) ? rawUserId : null;

    const ip = req.ip || req.socket.remoteAddress || null;
    const userAgent = (req.headers['user-agent'] as string) || null;

    const safeDetails = {
      ...(details || {}),
      authType: req.authType,
      apiKeyPresent: Boolean(req.headers['x-api-key']),
      // Aldrig log rå API-nøgler
    };

    await pool.query(`SELECT log_security_event($1, $2, $3::inet, $4, $5::jsonb)`, [
      eventType,
      userId,
      ip,
      userAgent,
      JSON.stringify(safeDetails),
    ]);
  } catch (error) {
    console.error('Failed to log security event:', error);
  }
}

export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string | undefined;

  if (!apiKey) {
    void logSecurityEvent('api_key_missing', req);
    return res.status(401).json({ error: 'API key required' });
  }

  if (API_KEYS.length === 0) {
    console.error('API_KEYS is empty – reject all API key auth');
    void logSecurityEvent('api_key_invalid', req, { reason: 'no_keys_configured' });
    return res.status(503).json({ error: 'Auth not configured' });
  }

  if (!API_KEYS.includes(apiKey)) {
    void logSecurityEvent('api_key_invalid', req, { reason: 'key_mismatch' });
    return res.status(403).json({ error: 'Invalid API key' });
  }

  req.authType = 'api_key';
  // Service/API-key callers behandles som service-rolle
  req.user = { userId: '00000000-0000-0000-0000-000000000000', role: 'service' };
  next();
}

export function verifyJWT(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    void logSecurityEvent('jwt_missing', req);
    return res.status(401).json({ error: 'JWT token required' });
  }

  if (!process.env.JWT_SECRET) {
    return res.status(503).json({ error: 'JWT not configured' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET) as JwtPayload;
    req.user = decoded;
    req.authType = 'jwt';

    if (decoded.userId) {
      req.headers['x-user-id'] = decoded.userId;
    }

    next();
  } catch (error: unknown) {
    const err = error as { name?: string; message?: string };
    void logSecurityEvent('jwt_invalid', req, { error: err.message });

    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(403).json({ error: 'Invalid token' });
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (apiKey) {
    return apiKeyAuth(req, res, next);
  }

  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    return verifyJWT(req, res, next);
  }

  void logSecurityEvent('auth_missing', req);
  return res.status(401).json({ error: 'Authentication required (API key or JWT)' });
}

export function requireRole(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userRole = req.user?.role || (req.authType === 'api_key' ? 'service' : 'user');

    if (!roles.includes(userRole)) {
      void logSecurityEvent('unauthorized_access', req, { requiredRoles: roles, userRole });
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

export const perUserRateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const key =
      (req.headers['x-api-key'] as string) ||
      req.user?.userId ||
      req.ip ||
      'anonymous';
    return key;
  },
  handler: (req, res) => {
    void logSecurityEvent('rate_limit_exceeded', req);
    res.status(429).json({ error: 'Too many requests, please try again later.' });
  },
});
