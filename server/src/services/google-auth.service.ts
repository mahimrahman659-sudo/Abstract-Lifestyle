import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { env } from '../config/env.js';
import { AppError } from '../middleware/error-handler.js';

/** Verified Google identity — only the claims the app actually needs. */
export interface GoogleProfile {
  /** Google account subject id (stable, unique per Google account). */
  sub: string;
  /** Verified email address (normalized: trimmed + lowercased). */
  email: string;
  /** Display name from the token; may be absent. */
  name?: string;
}

const TEST_SEAM_PREFIX = 'test-seam:';

/**
 * TEST SEAM (dev/test only). Active only when GOOGLE_AUTH_TEST_SEAM is set and
 * NODE_ENV is not "production"; env validation refuses to start when the seam
 * variable is present in production, so it can never be enabled there. When
 * inactive this branch is dead code and real verification always runs.
 */
const testSeamEnabled = env.NODE_ENV !== 'production' && env.GOOGLE_AUTH_TEST_SEAM.length > 0;

/** Generic failure — never distinguish bad token / wrong audience / unverified. */
const googleAuthFailed = (): AppError =>
  new AppError(401, 'UNAUTHORIZED', 'Google sign-in failed');

/**
 * Dev-only stand-in for verifyIdToken: parses `test-seam:<base64url-json>`
 * credentials and mirrors the library contract — in particular it rejects any
 * payload whose `aud` does not equal the requested audience, exercising the
 * same audience check the real verifier enforces.
 */
const verifyWithTestSeam = (credential: string, audience: string): GoogleProfile => {
  let parsed: unknown;
  try {
    const json = Buffer.from(credential.slice(TEST_SEAM_PREFIX.length), 'base64url').toString('utf8');
    parsed = JSON.parse(json);
  } catch {
    throw googleAuthFailed();
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw googleAuthFailed();
  }
  const record = parsed as Record<string, unknown>;
  if (record.aud !== audience) {
    throw googleAuthFailed();
  }
  return toGoogleProfile(record, audience);
};

/** Maps raw token payload claims to a GoogleProfile; strict on what matters. */
const toGoogleProfile = (payload: TokenPayload | Record<string, unknown>, audience: string): GoogleProfile => {
  const sub = (payload as { sub?: unknown }).sub;
  const email = (payload as { email?: unknown }).email;
  const emailVerified = (payload as { email_verified?: unknown }).email_verified;
  const aud = (payload as { aud?: unknown }).aud;
  const name = (payload as { name?: unknown }).name;

  if (typeof sub !== 'string' || sub.length === 0) {
    throw googleAuthFailed();
  }
  if (typeof email !== 'string' || email.length === 0) {
    throw googleAuthFailed();
  }
  // Only trust the address Google explicitly attests to.
  if (emailVerified !== true) {
    throw googleAuthFailed();
  }
  if (aud !== audience) {
    throw googleAuthFailed();
  }

  return {
    sub,
    email: email.trim().toLowerCase(),
    ...(typeof name === 'string' && name.trim().length > 0 ? { name: name.trim() } : {}),
  };
};

const oauthClient = new OAuth2Client();

/**
 * Verifies a Google Identity Services ID token and returns its profile.
 * Throws a generic 401 on ANY verification failure (bad signature, expired,
 * wrong audience, unverified email, missing claims) — the caller cannot tell
 * which check failed. The credential is never logged.
 */
export const verifyGoogleCredential = async (credential: string): Promise<GoogleProfile> => {
  const audience = env.GOOGLE_CLIENT_ID;

  if (testSeamEnabled && credential.startsWith(TEST_SEAM_PREFIX)) {
    return verifyWithTestSeam(credential, audience);
  }

  if (!audience) {
    // No client id configured: every verification fails the same way.
    throw googleAuthFailed();
  }

  let payload: TokenPayload | undefined;
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken: credential, audience });
    payload = ticket.getPayload();
  } catch {
    throw googleAuthFailed();
  }

  if (!payload) {
    throw googleAuthFailed();
  }
  return toGoogleProfile(payload, audience);
};
