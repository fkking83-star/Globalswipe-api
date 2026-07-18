import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { logSecurityEvent } from './auth';

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

export const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }

    if (
      allowedOrigins.length === 0 ||
      allowedOrigins.includes(origin) ||
      process.env.NODE_ENV === 'development'
    ) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-User-ID'],
  credentials: true,
  maxAge: 86400,
};

export const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin',
  },
  frameguard: {
    action: 'deny',
  },
  noSniff: true,
  xssFilter: true,
});

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV === 'production') {
    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;
      const logData = {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        apiKey: req.headers['x-api-key'] ? 'present' : 'missing',
      };

      if (duration > 1000) {
        console.warn('Slow request:', logData);
      }

      if (res.statusCode >= 400) {
        console.info('Request error:', logData);
      }
    });
  }

  next();
}

/**
 * Let ekstra forsvarslag. Primær beskyttelse er parameterized queries i services.
 * Undgår at logge fulde query-værdier (PII / injection payloads).
 */
export function sanitizeInput(req: Request, res: Response, next: NextFunction) {
  const sqlPatterns = [
    /('|;|--)/,
    /(\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b)/i,
  ];

  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value === 'string') {
      for (const pattern of sqlPatterns) {
        if (pattern.test(value)) {
          void logSecurityEvent('sql_injection_attempt', req, {
            key,
            valueLength: value.length,
          });
          return res.status(400).json({ error: 'Invalid input detected' });
        }
      }
    }
  }

  next();
}

export { cors };
