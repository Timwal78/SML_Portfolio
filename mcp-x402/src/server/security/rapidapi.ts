import { type Request, type Response, type NextFunction } from 'express';

export function rapidApiGuard(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env['RAPIDAPI_PROXY_SECRET'];
  if (!secret) { next(); return; }  // disabled if env var not set
  if (req.headers['x-rapidapi-proxy-secret'] === secret) { next(); return; }
  res.status(403).json({ error: 'Forbidden' });
}
