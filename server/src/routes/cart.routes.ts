import { Router } from 'express';
import {
  addItemHandler,
  clearCartHandler,
  getCartHandler,
  mergeCartHandler,
  removeItemHandler,
  updateItemHandler,
} from '../controllers/cart.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { addToCartSchema, updateCartItemSchema } from '../schemas/cart.schema.js';

export const cartRouter: Router = Router();

cartRouter.use(requireAuth);

cartRouter.get('/', getCartHandler);
cartRouter.post('/items', validateBody(addToCartSchema), addItemHandler);
cartRouter.patch('/items/:variantId', validateBody(updateCartItemSchema), updateItemHandler);
cartRouter.delete('/items/:variantId', removeItemHandler);
cartRouter.delete('/', clearCartHandler);
cartRouter.post('/merge', mergeCartHandler);
