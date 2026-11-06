import { Router } from 'express';
import {
  cancelOrderHandler,
  createOrderHandler,
  getOrderHandler,
  listOrdersHandler,
} from '../controllers/order.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { createOrderSchema } from '../schemas/order.schema.js';

export const orderRouter: Router = Router();

orderRouter.use(requireAuth);

orderRouter.post('/', validateBody(createOrderSchema), createOrderHandler);
orderRouter.get('/', listOrdersHandler);
orderRouter.get('/:id', getOrderHandler);
orderRouter.post('/:id/cancel', cancelOrderHandler);
