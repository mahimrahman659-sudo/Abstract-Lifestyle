import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { UPLOADS_DIR } from './config/paths.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { apiRouter } from './routes/index.js';
import { healthRouter } from './routes/health.routes.js';

export const createApp = (): express.Express => {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  // Product images: static files with safe headers (types verified at upload).
  app.use(
    '/uploads',
    express.static(UPLOADS_DIR, {
      immutable: true,
      maxAge: '365d',
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Disposition', 'inline');
      },
    }),
  );

  // Health: exposed at GET /health and, for the browser, at GET /api/health (via Next.js proxy).
  app.use('/api', apiRouter);
  app.use(healthRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

