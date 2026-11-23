import type { Request } from 'express';
import { Types } from 'mongoose';
import { env } from '../config/env.js';
import { AUTH_COOKIE_NAME } from '../middleware/auth.js';
import { verifyAuthToken } from '../utils/jwt.js';
import {
  ActivityEventModel,
  CLIENT_ACTIVITY_EVENT_TYPES,
  type ActivityEvent,
  type ActivityEventType,
} from '../models/activity-event.model.js';
import type { ClientActivityEventInput } from '../schemas/activity.schema.js';

/**
 * Customer Activity Center ingest service (Phase 1A).
 *
 * Invariants:
 * - Best-effort by design: `ingestClientEvents` NEVER throws. A failing
 *   analytics store can never affect checkout, orders, payments or any other
 *   request path; failures are logged without event payloads.
 * - Identity comes ONLY from the server-verified auth cookie
 *   (`resolveEventIdentity`); client-supplied identity fields never reach
 *   this module (the Zod schema strips them) and are ignored again here.
 * - Feature flag `ACTIVITY_EVENTS_ENABLED` (default false) is checked first:
 *   when disabled nothing is read from or written to the database.
 */

/** Client events older than this are clamped forward; future ones back. */
const TS_PAST_CLAMP_MS = 24 * 60 * 60 * 1000;
const TS_FUTURE_CLAMP_MS = 5 * 60 * 1000;

const CLIENT_TYPE_SET: ReadonlySet<string> = new Set<string>(
  CLIENT_ACTIVITY_EVENT_TYPES,
);

export interface IngestContext {
  /** Server-resolved only (verified JWT cookie); null = anonymous. */
  userId: Types.ObjectId | null;
  /** Fail-closed consent gate for this request. */
  consentGranted: boolean;
}

export type IngestStatus =
  | 'disabled'
  | 'consent_denied'
  | 'rejected'
  | 'stored'
  | 'failed';

export interface IngestResult {
  status: IngestStatus;
  accepted: number;
  deduped: number;
}

export const isActivityEnabled = (): boolean => env.ACTIVITY_EVENTS_ENABLED;

/**
 * Resolves the event identity from the verified `al_token` cookie.
 * Missing, malformed, expired or forged cookies resolve to anonymous —
 * this endpoint never 401s a tracking request and never trusts a payload.
 */
export const resolveEventIdentity = (
  req: Request,
): { userId: Types.ObjectId | null } => {
  const token: unknown = req.cookies?.[AUTH_COOKIE_NAME];
  if (typeof token !== 'string' || token.length === 0) {
    return { userId: null };
  }
  try {
    const payload = verifyAuthToken(token);
    if (!Types.ObjectId.isValid(payload.sub)) {
      return { userId: null };
    }
    return { userId: new Types.ObjectId(payload.sub) };
  } catch {
    // Invalid/expired/forged token → anonymous. Never fails the request.
    return { userId: null };
  }
};

/** Clamp client event time into [now-24h, now+5min]; invalid → now. */
export const clampEventTime = (value: Date, now = new Date()): Date => {
  const time = value.getTime();
  if (!Number.isFinite(time)) {
    return now;
  }
  const min = now.getTime() - TS_PAST_CLAMP_MS;
  const max = now.getTime() + TS_FUTURE_CLAMP_MS;
  return new Date(Math.min(Math.max(time, min), max));
};

/** Strip query string/fragment; empty result drops the field. */
export const normalizeEventPath = (path: string): string | undefined => {
  const cut = path.search(/[?#]/);
  const normalized = (cut === -1 ? path : path.slice(0, cut)).trim();
  return normalized.length > 0 ? normalized.slice(0, 200) : undefined;
};

const isDuplicateKeyOnlyError = (error: unknown): {
  duplicateOnly: boolean;
  duplicateCount: number;
} => {
  if (typeof error !== 'object' || error === null) {
    return { duplicateOnly: false, duplicateCount: 0 };
  }
  const writeErrors = (error as { writeErrors?: unknown }).writeErrors;
  if (!Array.isArray(writeErrors) || writeErrors.length === 0) {
    // Single-document duplicate (code 11000) surfaced without a writeErrors list.
    const code = (error as { code?: unknown }).code;
    if (code === 11000) {
      return { duplicateOnly: true, duplicateCount: 1 };
    }
    return { duplicateOnly: false, duplicateCount: 0 };
  }
  const codes = writeErrors.map((entry) =>
    typeof entry === 'object' && entry !== null
      ? (entry as { code?: unknown }).code
      : undefined,
  );
  const duplicateOnly = codes.every((code) => code === 11000);
  return { duplicateOnly, duplicateCount: codes.filter((code) => code === 11000).length };
};

const logIngestFailure = (error: unknown): void => {
  // Never log event payloads — message only (no PII by construction).
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[activity] event ingest failed: ${message}`);
};

/**
 * Builds persistence documents field-by-field so any property not listed
 * here (including forged `userId`/`orderId`/`ip`/… passed by a direct
 * caller) can never be written.
 */
const buildDocuments = (
  events: readonly ClientActivityEventInput[],
  context: IngestContext,
  now: Date,
): ActivityEvent[] => {
  const documents: ActivityEvent[] = [];
  for (const event of events) {
    const path = event.path !== undefined ? normalizeEventPath(event.path) : undefined;
    const document: ActivityEvent = {
      eventId: event.eventId,
      type: event.type as ActivityEventType,
      source: 'client',
      ts: clampEventTime(event.ts, now),
      ...(context.userId ? { userId: context.userId } : {}),
      ...(event.anonymousId ? { anonymousId: event.anonymousId } : {}),
      ...(event.sessionId ? { sessionId: event.sessionId } : {}),
      ...(path !== undefined ? { path } : {}),
      ...(event.productId ? { productId: new Types.ObjectId(event.productId) } : {}),
      ...(event.variantId ? { variantId: new Types.ObjectId(event.variantId) } : {}),
      ...(event.query !== undefined ? { query: event.query } : {}),
      ...(event.quantity !== undefined ? { quantity: event.quantity } : {}),
      ...(event.referrerDomain !== undefined
        ? { referrerDomain: event.referrerDomain }
        : {}),
      ...(event.device !== undefined ? { device: event.device } : {}),
      createdAt: now,
    };
    documents.push(document);
  }
  return documents;
};

/**
 * Persists a validated client event batch. Never throws.
 *
 * Status semantics:
 * - `disabled`        flag off — zero reads, zero writes.
 * - `consent_denied`  consent not granted — zero writes.
 * - `rejected`        a non-client event type reached the service (defense
 *                     in depth against direct callers) — zero writes.
 * - `stored`          write completed (duplicate ids counted in `deduped`).
 * - `failed`          storage error — logged, zero guarantees; request path
 *                     is unaffected either way.
 */
export const ingestClientEvents = async (
  events: readonly ClientActivityEventInput[],
  context: IngestContext,
): Promise<IngestResult> => {
  if (!isActivityEnabled()) {
    return { status: 'disabled', accepted: 0, deduped: 0 };
  }
  if (!context.consentGranted) {
    return { status: 'consent_denied', accepted: 0, deduped: 0 };
  }
  if (events.length === 0) {
    return { status: 'stored', accepted: 0, deduped: 0 };
  }
  if (!events.every((event) => CLIENT_TYPE_SET.has(event.type))) {
    // Server-authoritative types (order.purchased, payment.refunded, …)
    // must never enter through the client ingest path.
    return { status: 'rejected', accepted: 0, deduped: 0 };
  }

  try {
    const now = new Date();
    const seen = new Set<string>();
    const uniqueEvents: ClientActivityEventInput[] = [];
    let inBatchDuplicates = 0;
    for (const event of events) {
      if (seen.has(event.eventId)) {
        inBatchDuplicates += 1;
        continue;
      }
      seen.add(event.eventId);
      uniqueEvents.push(event);
    }

    if (uniqueEvents.length === 0) {
      return { status: 'stored', accepted: 0, deduped: inBatchDuplicates };
    }

    const documents = buildDocuments(uniqueEvents, context, now);
    try {
      await ActivityEventModel.insertMany(documents, { ordered: false });
      return {
        status: 'stored',
        accepted: documents.length,
        deduped: inBatchDuplicates,
      };
    } catch (error) {
      const { duplicateOnly, duplicateCount } = isDuplicateKeyOnlyError(error);
      if (duplicateOnly && duplicateCount > 0) {
        // Unique-index collisions are the idempotent happy path on retries.
        return {
          status: 'stored',
          accepted: documents.length - duplicateCount,
          deduped: inBatchDuplicates + duplicateCount,
        };
      }
      logIngestFailure(error);
      return { status: 'failed', accepted: 0, deduped: 0 };
    }
  } catch (error) {
    logIngestFailure(error);
    return { status: 'failed', accepted: 0, deduped: 0 };
  }
};
