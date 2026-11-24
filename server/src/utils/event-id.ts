import { createHash } from 'node:crypto';

/**
 * Deterministic event identifiers (RFC 4122 UUID version 5) for
 * server-authoritative business events.
 *
 * Why: retries and duplicate submissions of the same business fact (order
 * placed, claim reviewed, …) must collapse to ONE document via the unique
 * `eventId` index instead of double-counting analytics. Implemented with
 * `node:crypto` only — no new dependencies.
 *
 * Known-vector verified in `activity-authoritative.test.ts`
 * (RFC-style DNS namespace + "www.example.com").
 */
const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/** UUID v5 of `name` inside the RFC 4122 DNS namespace. */
export const deterministicEventId = (name: string): string => {
  const namespaceBytes = Buffer.from(DNS_NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(namespaceBytes).update(name, 'utf8').digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  // RFC 4122 version 5 + variant bits (noUncheckedIndexedAccess-safe).
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};
