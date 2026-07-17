import { Request, Response, NextFunction } from 'express';

const API_KEYS = process.env.API_KEYS?.split(',').map((k) => k.trim()).filter(Boolean) || [];

export const apiKeyAuth = (req: Request, res: Response, next: NextFunction) => {
  // Allow unauthenticated access when no keys are configured (local/dev)
  if (API_KEYS.length === 0) {
    return next();
  }

  const apiKey = req.headers['x-api-key'];
  if (!apiKey || !API_KEYS.includes(apiKey as string)) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }

  next();
};
