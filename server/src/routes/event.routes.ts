import { Router } from 'express';
import { validateBody } from '../middleware/validate.js';
import { eventRateLimiter } from '../middleware/rate-limit.js';
import { createEventsHandler } from '../controllers/event.controller.js';
import { eventIngestSchema } from '../schemas/activity.schema.js';

/**
 * Public, optional-auth event ingestion. Mount path: `/events`
 * (full route: POST /api/events).
 *
 * Order matters: rate limit first (cheap, IP/user keyed), then Zod
 * validation, then the handler. No `requireAuth` — anonymous browse events
 * are legitimate; authenticated identity is attributed opportunistically
 * from the verified cookie inside the handler.
 */
export const eventRouter: Router = Router();

eventRouter.post(
  '/',
  eventRateLimiter,
  validateBody(eventIngestSchema),
  createEventsHandler,
);
