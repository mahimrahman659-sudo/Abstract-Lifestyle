import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../middleware/error-handler.js';
import type { UserRole } from '../models/user.model.js';

/** JWT + cookie lifetime: 7 days. */
export const AUTH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthTokenPayload {
  sub: string;
  role: UserRole;
}

export const signAuthToken = (userId: string, role: UserRole): string =>
  jwt.sign({ sub: userId, role }, env.JWT_SECRET, {
    expiresIn: Math.floor(AUTH_TOKEN_TTL_MS / 1000),
  });

export const verifyAuthToken = (token: string): AuthTokenPayload => {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (typeof payload === 'string' || payload.sub === undefined) {
      throw new Error('Invalid token payload');
    }
    return {
      sub: String(payload.sub),
      role: payload.role === 'admin' ? 'admin' : 'customer',
    };
  } catch {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  }
};
