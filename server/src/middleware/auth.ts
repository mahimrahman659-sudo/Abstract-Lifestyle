import type { Request, RequestHandler } from 'express';
import { AppError } from './error-handler.js';
import { UserModel, type UserDocument, type UserRole } from '../models/user.model.js';
import { verifyAuthToken } from '../utils/jwt.js';

export const AUTH_COOKIE_NAME = 'al_token';

/** Loads the authenticated user from the `al_token` cookie; 401 when missing/invalid/expired. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token: unknown = req.cookies?.[AUTH_COOKIE_NAME];
  if (typeof token !== 'string' || token.length === 0) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  const payload = verifyAuthToken(token);
  const user = await UserModel.findById(payload.sub);
  if (!user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  }

  req.user = user;
  next();
};

/** Restricts a route to a role. Must run after requireAuth. */
export const requireRole =
  (role: UserRole): RequestHandler =>
  (req, _res, next) => {
    const user = req.user;
    if (!user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    if (user.role !== role) {
      throw new AppError(403, 'FORBIDDEN', 'Insufficient permissions');
    }
    next();
  };

/** Returns the authenticated user set by requireAuth, or throws 401. */
export const getAuthUser = (req: Request): UserDocument => {
  const user = req.user;
  if (!user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  }
  return user;
};
