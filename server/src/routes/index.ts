import { Router } from 'express';
import { adminRouter } from './admin.routes.js';
import { authRouter } from './auth.routes.js';
import { cartRouter } from './cart.routes.js';
import { categoryRouter } from './category.routes.js';
import { healthRouter } from './health.routes.js';
import { orderRouter } from './order.routes.js';
import { productRouter } from './product.routes.js';
import { userRouter } from './user.routes.js';

export const apiRouter: Router = Router();

apiRouter.use(healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/cart', cartRouter);
apiRouter.use('/categories', categoryRouter);
apiRouter.use('/orders', orderRouter);
apiRouter.use('/products', productRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/admin', adminRouter);



