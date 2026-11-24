import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { env } from '../config/env.js';
import { getActivityIndexReadiness } from '../config/activity-index.js';
import { AUTH_COOKIE_NAME } from '../middleware/auth.js';
import { verifyAuthToken } from '../utils/jwt.js';
import {
  ActivityEventModel,
  ACTIVITY_EVENT_TYPES,
  CLIENT_ACTIVITY_EVENT_TYPES,
  type ActivityEvent,
  type ActivityEventType,
  type OrderStatusLike,
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

/** The 25 server-authoritative types; client input can never carry these. */
const SERVER_TYPE_SET: ReadonlySet<string> = new Set<string>(
  ACTIVITY_EVENT_TYPES.filter((type) => !CLIENT_TYPE_SET.has(type)),
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
  | 'index_not_ready'
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

/**
 * Strip query string/fragment, normalize separators, then enforce a strict
 * path allowlist. Anything that survives must look like a route path:
 * starts with `/`, only `A-Za-z0-9 - . _ ~ / %`, ≤200 chars. Anything else
 * (control characters, whitespace, non-ASCII, traversal attempts) drops the
 * field instead of being persisted (D-3).
 */
export const normalizeEventPath = (input: string): string | undefined => {
  const cut = input.search(/[?#]/);
  let path = (cut === -1 ? input : input.slice(0, cut)).trim();
  path = path.replace(/\\/g, '/');
  path = path.replace(/\/{2,}/g, '/');
  if (path.length > 0 && !path.startsWith('/')) {
    path = `/${path}`;
  }
  if (path.length > 200) {
    path = path.slice(0, 200);
  }
  if (!/^\/[A-Za-z0-9\-._~%/]*$/.test(path)) {
    return undefined;
  }
  return path;
};

interface BulkFailureInfo {
  /** writeError codes (11000 = duplicate key); empty when unknown. */
  codes: number[];
  /**
   * Documents the server confirmed as inserted, when the driver reports it.
   * `null` means "unknown" — callers must treat unknown as zero so a failed
   * insert is never counted as accepted (D-2).
   */
  insertedCount: number | null;
}

const describeBulkFailure = (error: unknown): BulkFailureInfo => {
  if (typeof error !== 'object' || error === null) {
    return { codes: [], insertedCount: null };
  }
  const record = error as {
    writeErrors?: unknown;
    code?: unknown;
    result?: { insertedCount?: unknown };
  };
  let codes: number[] = [];
  if (Array.isArray(record.writeErrors)) {
    codes = record.writeErrors
      .map((entry) =>
        typeof entry === 'object' && entry !== null
          ? (entry as { code?: unknown }).code
          : undefined,
      )
      .filter((code): code is number => typeof code === 'number');
  } else if (typeof record.code === 'number') {
    // Single-document duplicate surfaced without a writeErrors list.
    codes = [record.code];
  }
  const inserted =
    typeof record.result?.insertedCount === 'number'
      ? record.result.insertedCount
      : null;
  return { codes, insertedCount: inserted };
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
 * - `index_not_ready` required indexes missing/mismatched while enabled —
 *                     fail-closed, zero writes (R-1).
 * - `stored`          write completed (duplicate ids counted in `deduped`).
 * - `failed`          storage error — logged; `accepted` reflects only the
 *                     documents the server confirmed as inserted (D-2), so
 *                     failed inserts are never reported as accepted.
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
    // R-1 fail-closed: never write when the unique/TTL indexes are missing
    // or mismatched — event-id uniqueness must not silently degrade.
    const readiness = await getActivityIndexReadiness();
    if (!readiness.ready) {
      console.error(`[activity] ingest refused: ${readiness.reason}`);
      return { status: 'index_not_ready', accepted: 0, deduped: 0 };
    }

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
      const { codes, insertedCount } = describeBulkFailure(error);
      const duplicateCount = codes.filter((code) => code === 11000).length;
      const otherFailures = codes.length - duplicateCount;
      if (codes.length > 0 && otherFailures === 0) {
        // Every failure was an idempotent unique-index collision: the rest
        // of the batch was inserted (confirmed by the driver when known).
        const accepted =
          insertedCount ?? Math.max(0, documents.length - duplicateCount);
        return {
          status: 'stored',
          accepted,
          deduped: inBatchDuplicates + duplicateCount,
        };
      }
      // Mixed or unknown failure: report only what the server confirmed as
      // inserted; unknown (null) counts as zero — never as accepted (D-2).
      logIngestFailure(error);
      return {
        status: 'failed',
        accepted: insertedCount ?? 0,
        deduped: inBatchDuplicates + duplicateCount,
      };
    }
  } catch (error) {
    logIngestFailure(error);
    return { status: 'failed', accepted: 0, deduped: 0 };
  }
};

/**
 * Server-authoritative business event (Phase 1B-B).
 *
 * Delivery contract — BEST-EFFORT BY DESIGN:
 * - `emitServerEvent` is synchronous, returns void, and NEVER throws or
 *   returns a promise: callers must invoke it fire-and-forget AFTER a
 *   successful business operation has committed, never inside a MongoDB
 *   transaction and never on a failure path.
 * - If analytics storage is unavailable the event is lost (logged, not
 *   retried). Official sales/financial reporting always comes from the
 *   authoritative `orders` / payment records, never from these events.
 * - `ACTIVITY_EVENTS_ENABLED=false` ⇒ zero writes; enabled ⇒ the same
 *   fail-closed index-readiness gate as client ingest (R-1).
 * - Duplicate suppression: pass a deterministic `eventId`
 *   (`deterministicEventId(...)`) for retryable facts.
 *
 * Privacy: payloads are id/enumerated-outcome fields only — never IP, user
 * agent, payment transaction references, sender numbers, addresses or
 * contact data. `userId` is the ACTOR from trusted server context.
 */
export interface ServerEventInput {
  /** Must be one of the 25 server-only taxonomy types. */
  type: ActivityEventType;
  /** Deterministic (preferred) or random-v4 id; defaults to random v4. */
  eventId?: string;
  /** Actor from trusted server context (never a request payload). */
  userId?: Types.ObjectId | null;
  orderId?: Types.ObjectId | string;
  customerId?: Types.ObjectId | string;
  productId?: Types.ObjectId | string;
  variantId?: Types.ObjectId | string;
  quantity?: number;
  /** Integer poisha (e.g. order total). */
  value?: number;
  decision?: 'paid' | 'rejected';
  fromStatus?: OrderStatusLike;
  toStatus?: OrderStatusLike;
  /** Defaults to server time. */
  ts?: Date;
}

const toObjectId = (
  value: Types.ObjectId | string | undefined,
): Types.ObjectId | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value instanceof Types.ObjectId) {
    return value;
  }
  return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : undefined;
};

const isDuplicateKeyError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const record = error as { code?: unknown; writeErrors?: unknown };
  if (record.code === 11000) {
    return true;
  }
  if (Array.isArray(record.writeErrors) && record.writeErrors.length > 0) {
    return record.writeErrors.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { code?: unknown }).code === 11000,
    );
  }
  return false;
};

const persistServerEvent = async (input: ServerEventInput): Promise<void> => {
  try {
    if (!SERVER_TYPE_SET.has(input.type)) {
      console.error(`[activity] refused non-server event type: ${input.type}`);
      return;
    }
    const readiness = await getActivityIndexReadiness();
    if (!readiness.ready) {
      console.error(`[activity] server event refused: ${readiness.reason}`);
      return;
    }
    const orderId = toObjectId(input.orderId);
    const customerId = toObjectId(input.customerId);
    const productId = toObjectId(input.productId);
    const variantId = toObjectId(input.variantId);
    const now = input.ts ?? new Date();
    const document: ActivityEvent = {
      eventId: input.eventId ?? randomUUID(),
      type: input.type,
      source: 'server',
      ts: now,
      ...(input.userId ? { userId: input.userId } : {}),
      ...(orderId ? { orderId } : {}),
      ...(customerId ? { customerId } : {}),
      ...(productId ? { productId } : {}),
      ...(variantId ? { variantId } : {}),
      ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
      ...(input.value !== undefined ? { value: input.value } : {}),
      ...(input.decision !== undefined ? { decision: input.decision } : {}),
      ...(input.fromStatus !== undefined ? { fromStatus: input.fromStatus } : {}),
      ...(input.toStatus !== undefined ? { toStatus: input.toStatus } : {}),
      createdAt: now,
    };
    await ActivityEventModel.insertMany([document], { ordered: false });
  } catch (error) {
    // Deterministic-id collisions are the idempotent happy path on retries.
    if (isDuplicateKeyError(error)) {
      return;
    }
    logIngestFailure(error);
  }
};

/**
 * Fire-and-forget emit for backend business events. Call AFTER the business
 * transaction has committed, on success paths only:
 *
 *   void emitServerEvent({ type: 'order.purchased', orderId, userId, ... });
 */
export const emitServerEvent = (input: ServerEventInput): void => {
  try {
    if (!isActivityEnabled()) {
      return;
    }
    void persistServerEvent(input);
  } catch (error) {
    logIngestFailure(error);
  }
};
