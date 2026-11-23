import { Router } from 'express';
import { apiRateLimiter } from '../middleware/rate-limit.js';
import { adminRouter } from './admin.routes.js';
import { authRouter } from './auth.routes.js';
import { cartRouter } from './cart.routes.js';
import { categoryRouter } from './category.routes.js';
import { eventRouter } from './event.routes.js';
import { healthRouter } from './health.routes.js';
import { notificationRouter } from './notification.routes.js';
import { orderRouter } from './order.routes.js';
import { paymentRouter } from './payment.routes.js';
import { productRouter } from './product.routes.js';
import { siteImageRouter } from './site-image.routes.js';
import { userRouter } from './user.routes.js';

export const apiRouter: Router = Router();

// Generous per-IP baseline for everything under /api.
apiRouter.use(apiRateLimiter);

apiRouter.use(healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/cart', cartRouter);
apiRouter.use('/categories', categoryRouter);
apiRouter.use('/events', eventRouter);
apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/orders', orderRouter);
apiRouter.use('/payments', paymentRouter);
apiRouter.use('/products', productRouter);
apiRouter.use('/site-images', siteImageRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/admin', adminRouter);




