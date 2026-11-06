import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const adminRouter: Router = Router();

adminRouter.use(requireAuth, requireRole('admin'));

// Temporary guard-check endpoint (real admin endpoints arrive in Task 7).
adminRouter.get('/ping', (_req, res) => {
  res.status(200).json({ ok: true });
});
