import { Router } from 'express';
import {
  adminGetCustomerHandler,
  adminGetOrderHandler,
  adminListCustomersHandler,
  adminListOrdersHandler,
  adminUpdateOrderStatusHandler,
  createCategoryHandler,
  createProductHandler,
  createVariantHandler,
  deleteCategoryHandler,
  deleteProductHandler,
  deleteVariantHandler,
  getProductHandler,
  listProductsHandler,
  listVariantsHandler,
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
import { createVariantSchema, updateVariantSchema } from '../schemas/variant.schema.js';

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
adminRouter.get('/variants', listVariantsHandler);
adminRouter.patch('/variants/:id', validateBody(updateVariantSchema), updateVariantHandler);
adminRouter.delete('/variants/:id', deleteVariantHandler);

// Uploads
adminRouter.post('/uploads', uploadRateLimiter, uploadImages, uploadImagesHandler);

// Orders
adminRouter.get('/orders', adminListOrdersHandler);
adminRouter.get('/orders/:id', adminGetOrderHandler);
adminRouter.patch('/orders/:id/status', adminUpdateOrderStatusHandler);

// Customers
adminRouter.get('/customers', adminListCustomersHandler);
adminRouter.get('/customers/:id', adminGetCustomerHandler);
