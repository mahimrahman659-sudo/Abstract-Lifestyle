import type { CookieOptions, RequestHandler } from 'express';
import { env } from '../config/env.js';
import { AUTH_COOKIE_NAME, getAuthUser } from '../middleware/auth.js';
import { loginUser, registerUser } from '../services/auth.service.js';
import { toUserDto } from '../services/user.service.js';
import { AUTH_TOKEN_TTL_MS, signAuthToken } from '../utils/jwt.js';

const authCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: env.NODE_ENV === 'production',
  path: '/',
  maxAge: AUTH_TOKEN_TTL_MS,
});

export const register: RequestHandler = async (req, res) => {
  const user = await registerUser(req.body);

  res.cookie(AUTH_COOKIE_NAME, signAuthToken(user._id.toString(), user.role), authCookieOptions());
  res.status(201).json({ user: toUserDto(user) });
};

export const login: RequestHandler = async (req, res) => {
  const user = await loginUser(req.body);

  res.cookie(AUTH_COOKIE_NAME, signAuthToken(user._id.toString(), user.role), authCookieOptions());
  res.status(200).json({ user: toUserDto(user) });
};

export const logout: RequestHandler = (_req, res) => {
  const { maxAge: _maxAge, ...clearOptions } = authCookieOptions();
  res.clearCookie(AUTH_COOKIE_NAME, clearOptions);
  res.status(204).end();
};

export const me: RequestHandler = (req, res) => {
  res.status(200).json({ user: toUserDto(getAuthUser(req)) });
};
