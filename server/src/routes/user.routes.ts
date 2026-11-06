import { Router } from 'express';
import {
  createAddress,
  getAddresses,
  patchAddress,
  removeAddress,
  updateMe,
} from '../controllers/user.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { me } from '../controllers/auth.controller.js';
import { addressSchema, addressUpdateSchema, updateProfileSchema } from '../schemas/user.schema.js';

export const userRouter: Router = Router();

userRouter.use(requireAuth);

userRouter.get('/me', me);
userRouter.patch('/me', validateBody(updateProfileSchema), updateMe);

userRouter.get('/me/addresses', getAddresses);
userRouter.post('/me/addresses', validateBody(addressSchema), createAddress);
userRouter.patch('/me/addresses/:id', validateBody(addressUpdateSchema), patchAddress);
userRouter.delete('/me/addresses/:id', removeAddress);
