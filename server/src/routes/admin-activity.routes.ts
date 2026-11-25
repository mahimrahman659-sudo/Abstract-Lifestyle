import { Router } from 'express';
import {
  adminCustomerTimelineHandler,
  adminLiveActivityHandler,
  adminRecentActivityHandler,
} from '../controllers/admin-activity.controller.js';

/**
 * Admin Activity Center reads (Phase 2). Mounted by `admin.routes.ts` AFTER
 * the router-level `requireAuth + requireRole('admin')` guard, so every
 * endpoint here is server-verified admin-only. No public or customer read
 * surface exists for activity data.
 */
export const adminActivityRouter: Router = Router();

adminActivityRouter.get('/live', adminLiveActivityHandler);
adminActivityRouter.get('/recent', adminRecentActivityHandler);
adminActivityRouter.get('/customers/:id/timeline', adminCustomerTimelineHandler);
