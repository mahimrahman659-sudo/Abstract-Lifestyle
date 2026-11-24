import { z } from 'zod';
import { objectIdSchema } from './common.schema.js';
import { CLIENT_ACTIVITY_EVENT_TYPES } from '../models/activity-event.model.js';

/**
 * Validation for POST /api/events (Phase 1A).
 *
 * Strict rules:
 * - closed event-type enum (client subset only — server-authoritative types
 *   such as `order.purchased` or `payment.refunded` are rejected outright);
 * - UUID v4 event ids (dedup key);
 * - every field bounded; unknown fields are stripped (`.strip()`), so client
 *   attempts to send identity (`userId`) or privileged business state
 *   (`orderId`, `value`, `paymentStatus`, `ip`, `userAgent`, `email`, …)
 *   are silently discarded and never persisted;
 * - no metadata objects of any kind are accepted (there is no `meta` field).
 */

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_ID_PATTERN = /^[A-Za-z0-9-]{8,36}$/;
const DOMAIN_PATTERN = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const ISO_LIKE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/**
 * Strict timestamp: ISO-8601 string, a Date, or epoch milliseconds.
 * `z.coerce.date()` is deliberately NOT used — it also accepts booleans,
 * null and arrays, which would silently turn junk into 1970 dates.
 * Out-of-range values are clamped later by the service.
 */
const eventTimeSchema = z
  .union([
    z.string().regex(ISO_LIKE_PATTERN, 'ts must be an ISO-8601 timestamp'),
    z.date(),
    z.number().int().nonnegative('ts epoch milliseconds must be a non-negative integer'),
  ])
  .transform((value, ctx) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'ts must be a valid timestamp' });
      return z.NEVER;
    }
    return date;
  });

export const MAX_EVENT_BATCH = 20;
export const MAX_PATH_LENGTH = 200;
export const MAX_QUERY_LENGTH = 100;

export const clientActivityEventSchema = z
  .object({
    eventId: z.string().regex(UUID_V4_PATTERN, 'eventId must be a UUID v4'),
    type: z.enum(CLIENT_ACTIVITY_EVENT_TYPES),
    /** ISO-8601 string (JSON), Date or epoch ms; clamped before persist. */
    ts: eventTimeSchema,
    anonymousId: z.string().regex(SESSION_ID_PATTERN, 'invalid anonymousId').optional(),
    sessionId: z.string().regex(SESSION_ID_PATTERN, 'invalid sessionId').optional(),
    path: z
      .string()
      .min(1)
      .max(MAX_PATH_LENGTH)
      // D-3: reject control characters at the edge; the service applies the
      // strict route allowlist during normalization.
      .refine((value) => !/[\u0000-\u001F\u007F]/.test(value), {
        message: 'path must not contain control characters',
      })
      .optional(),
    productId: objectIdSchema.optional(),
    variantId: objectIdSchema.optional(),
    /** Structured search term — never a URL, never embedded in `path`. */
    query: z.string().trim().min(1).max(MAX_QUERY_LENGTH).optional(),
    quantity: z.number().int().min(1).max(999).optional(),
    /** Hostname only: no scheme, path, port or credentials. */
    referrerDomain: z
      .string()
      .max(100)
      .regex(DOMAIN_PATTERN, 'referrerDomain must be a bare hostname')
      .optional(),
    device: z.enum(['mobile', 'desktop', 'tablet']).optional(),
    // Deliberately absent: userId, orderId, value, ip, userAgent, email,
    // phone, address, password, paymentStatus, trxId, meta, … — stripped.
  })
  .strip();

export const eventIngestSchema = z.object({
  /**
   * Interim per-request consent gate (Phase 1A). Fail-closed: without an
   * explicit `consent: true` the batch is accepted at the edge but never
   * persisted. Phase 3 replaces this with the owner-decided (D1) consent
   * model; the shape stays compatible.
   */
  consent: z.boolean().default(false),
  events: z.array(clientActivityEventSchema).min(1).max(MAX_EVENT_BATCH),
});

export type ClientActivityEventInput = z.infer<typeof clientActivityEventSchema>;
export type EventIngestInput = z.infer<typeof eventIngestSchema>;
