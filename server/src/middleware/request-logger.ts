import type { RequestHandler } from 'express';

/**
 * Minimal request log: method, path, status, latency and the authenticated
 * user id (when signed in). Never logs bodies, cookies or headers.
 */
export const requestLogger: RequestHandler = (req, res, next) => {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const userId = req.user ? String(req.user._id) : '-';
    // Path only (no query string) — never bodies, cookies or headers.
    const pathOnly = req.originalUrl.split('?')[0] ?? req.path;
    console.log(
      `${req.method} ${pathOnly} ${res.statusCode} ${latencyMs.toFixed(1)}ms user=${userId}`,
    );
  });

  next();
};
