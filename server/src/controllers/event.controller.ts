import type { RequestHandler } from 'express';
import { eventIngestSchema, type EventIngestInput } from '../schemas/activity.schema.js';
import {
  ingestClientEvents,
  resolveEventIdentity,
} from '../services/activity.service.js';

/**
 * POST /api/events — client event ingestion (Phase 1A).
 *
 * Contract:
 * - 202 `{ accepted, deduped }` when the batch was processed (including
 *   storage failures: events are best-effort and never fail the request);
 * - 204 no body when the feature flag is off or consent was not granted —
 *   nothing is persisted;
 * - 400/429 come from `validateBody` / `eventRateLimiter`.
 *
 * Identity is resolved exclusively from the verified auth cookie; any
 * identity fields inside the payload were already stripped by Zod.
 * `ingestClientEvents` never throws, so this handler always answers.
 */
export const createEventsHandler: RequestHandler = async (req, res) => {
  const parsed = eventIngestSchema.parse(req.body) as EventIngestInput;
  const { userId } = resolveEventIdentity(req);

  try {
    const result = await ingestClientEvents(parsed.events, {
      userId,
      consentGranted: parsed.consent,
    });
    if (result.status === 'disabled' || result.status === 'consent_denied') {
      res.status(204).end();
      return;
    }
    // `stored` and `failed` both answer 202 with actual counts; storage
    // failures are logged inside the service without payloads.
    res.status(202).json({ accepted: result.accepted, deduped: result.deduped });
  } catch {
    // ingestClientEvents is documented never to throw; defensive parity so a
    // future regression still cannot surface as a 500 on this endpoint.
    res.status(202).json({ accepted: 0, deduped: 0 });
  }
};
