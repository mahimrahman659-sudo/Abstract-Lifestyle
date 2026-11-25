import { Router } from 'express';
import {
  adminGetCustomerHandler,
  adminGetOrderHandler,
  adminListCustomersHandler,
  adminListOrdersHandler,
  adminListSiteImagesHandler,
  adminUpdateOrderStatusHandler,
  adminUpdateSiteImageHandler,
  adminReviewPaymentHandler,
  adminCompleteRefundHandler,
  createCategoryHandler,
  createProductHandler,
  createVariantHandler,
  createVariantsBulkHandler,
  deleteCategoryHandler,
  deleteProductHandler,
  deleteVariantHandler,
  destroyUploadedAssetsHandler,
  getProductHandler,
  listProductsHandler,
  listVariantsHandler,
  restoreVariantHandler,
  updateCategoryHandler,
  updateProductHandler,
  updateVariantHandler,
  uploadImagesHandler,
} from '../controllers/admin.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { uploadRateLimiter } from '../middleware/rate-limit.js';
import { uploadImages } from '../middleware/upload.js';
import { validateBody } from '../middleware/validate.js';
import { createCategorySchema, updateCategorySchema } from '../schemas/category.schema.js';
import { createProductSchema, updateProductSchema } from '../schemas/product.schema.js';
import { updateSiteImageSchema } from '../schemas/site-image.schema.js';
import { adminPaymentRefundSchema, adminPaymentReviewSchema } from '../schemas/admin.schema.js';
import {
  bulkCreateVariantsSchema,
  createVariantSchema,
  updateVariantSchema,
} from '../schemas/variant.schema.js';
import { destroyAssetsSchema } from '../schemas/upload.schema.js';
import { adminActivityRouter } from './admin-activity.routes.js';

export const adminRouter: Router = Router();

adminRouter.use(requireAuth, requireRole('admin'));

// Categories
adminRouter.post('/categories', validateBody(createCategorySchema), createCategoryHandler);
adminRouter.patch('/categories/:id', validateBody(updateCategorySchema), updateCategoryHandler);
adminRouter.delete('/categories/:id', deleteCategoryHandler);

// Products
adminRouter.get('/products', listProductsHandler);
adminRouter.get('/products/:id', getProductHandler);
adminRouter.post('/products', validateBody(createProductSchema), createProductHandler);
adminRouter.patch('/products/:id', validateBody(updateProductSchema), updateProductHandler);
adminRouter.delete('/products/:id', deleteProductHandler);

// Variants (per product)
adminRouter.post(
  '/products/:id/variants',
  validateBody(createVariantSchema),
  createVariantHandler,
);
adminRouter.post(
  '/products/:id/variants/bulk',
  validateBody(bulkCreateVariantsSchema),
  createVariantsBulkHandler,
);
adminRouter.get('/variants', listVariantsHandler);
adminRouter.patch('/variants/:id', validateBody(updateVariantSchema), updateVariantHandler);
adminRouter.patch('/variants/:id/restore', restoreVariantHandler);
adminRouter.delete('/variants/:id', deleteVariantHandler);

// Uploads
adminRouter.post('/uploads', uploadRateLimiter, uploadImages, uploadImagesHandler);
// Orphan cleanup: assets uploaded but never attached to a saved product.
adminRouter.post(
  '/uploads/destroy',
  validateBody(destroyAssetsSchema),
  destroyUploadedAssetsHandler,
);

// Orders
adminRouter.get('/orders', adminListOrdersHandler);
adminRouter.get('/orders/:id', adminGetOrderHandler);
adminRouter.patch('/orders/:id/status', adminUpdateOrderStatusHandler);
adminRouter.patch(
  '/orders/:id/payment',
  validateBody(adminPaymentReviewSchema),
  adminReviewPaymentHandler,
);
adminRouter.patch(
  '/orders/:id/payment/refund',
  validateBody(adminPaymentRefundSchema),
  adminCompleteRefundHandler,
);

// Customers
adminRouter.get('/customers', adminListCustomersHandler);
adminRouter.get('/customers/:id', adminGetCustomerHandler);

// Customer Activity Center (Phase 2) — inherits requireAuth + requireRole above.
adminRouter.use('/activity', adminActivityRouter);

// Site images (storefront marketing slots)
adminRouter.get('/site-images', adminListSiteImagesHandler);
adminRouter.put('/site-images/:key', validateBody(updateSiteImageSchema), adminUpdateSiteImageHandler);
