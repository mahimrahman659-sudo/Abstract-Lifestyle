import { randomUUID } from 'node:crypto';

/**
 * Fixtures for Customer Activity Center Phase 1A tests.
 * Deterministic UUIDs (v4), closed-enum types, clamped timestamps.
 */

export interface TestEventInput {
  eventId?: string;
  type?: string;
  ts?: unknown;
  anonymousId?: string;
  sessionId?: string;
  path?: string;
  productId?: string;
  variantId?: string;
  query?: string;
  quantity?: number;
  referrerDomain?: string;
  device?: string;
  [key: string]: unknown;
}

export interface TestEvent {
  eventId: string;
  type: string;
  ts: unknown;
  [key: string]: unknown;
}

export const makeEvent = (overrides: TestEventInput = {}): TestEvent =>
  ({
    eventId: randomUUID(),
    type: 'page.view',
    ts: new Date().toISOString(),
    ...overrides,
  }) as TestEvent;

/** `count` distinct events; overrides are applied to every event except eventId. */
export const makeBatch = (
  count: number,
  overrides: TestEventInput = {},
): TestEvent[] => Array.from({ length: count }, () => makeEvent(overrides));

export interface PostEventsResponse {
  status: number;
  body: unknown;
}

export const postEvents = async (
  origin: string,
  payload: unknown,
  cookie?: string,
): Promise<PostEventsResponse> => {
  const response = await fetch(`${origin}/api/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body: unknown = undefined;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body };
};
