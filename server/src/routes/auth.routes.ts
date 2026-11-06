import { Router } from 'express';
import { googleLogin, login, logout, me, register } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { authRateLimiter } from '../middleware/rate-limit.js';
import { validateBody } from '../middleware/validate.js';
import { googleAuthSchema, loginSchema, registerSchema } from '../schemas/user.schema.js';

export const authRouter: Router = Router();

authRouter.post('/register', authRateLimiter, validateBody(registerSchema), register);
authRouter.post('/login', authRateLimiter, validateBody(loginSchema), login);
authRouter.post('/google', authRateLimiter, validateBody(googleAuthSchema), googleLogin);
authRouter.post('/logout', logout);
authRouter.get('/me', requireAuth, me);
