import { Router } from 'express';
import { getAuthUser, requireAuth } from '../middleware/auth.js';
import { listCustomerNotifications } from '../services/notification.service.js';

export const notificationRouter: Router = Router();

notificationRouter.use(requireAuth);

notificationRouter.get('/', async (req, res) => {
  const user = getAuthUser(req);
  res.status(200).json({ items: await listCustomerNotifications(user._id) });
});
