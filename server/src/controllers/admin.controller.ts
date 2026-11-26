import type { RequestHandler } from 'express';
import {
  createCategory,
  createProduct,
  createVariant,
  createVariantsBulk,
  deleteCategory,
  deleteProduct,
  deleteVariant,
  restoreVariant,
  getProductAdmin,
  listProducts,
  listVariants,
  updateCategory,
  updateProduct,
  updateVariant,
} from '../services/admin-catalog.service.js';
import { adminIdParamsSchema, adminVariantQuerySchema } from '../schemas/admin.schema.js';
import { createCategorySchema, updateCategorySchema } from '../schemas/category.schema.js';
import { createProductSchema, updateProductSchema } from '../schemas/product.schema.js';
import {
  bulkCreateVariantsSchema,
  createVariantSchema,
  updateVariantSchema,
} from '../schemas/variant.schema.js';
import { destroyAssetsSchema } from '../schemas/upload.schema.js';
import { siteImageKeySchema, updateSiteImageSchema } from '../schemas/site-image.schema.js';
import { listSiteImages, updateSiteImage } from '../services/site-image.service.js';

export const createCategoryHandler: RequestHandler = async (req, res) => {
  const input = createCategorySchema.parse(req.body);
  res.status(201).json({ category: await createCategory(input) });
};

export const updateCategoryHandler: RequestHandler = async (req, res) => {
  const { id } = adminIdParamsSchema.parse(req.params);
  const input = updateCategorySchema.parse(req.body);
  res.status(200).json({ category: await updateCategory(id, input) });
};

export const deleteCategoryHandler: RequestHandler = async (req, res) => {
  const { id } = adminIdParamsSchema.parse(req.params);
  await deleteCategory(id);
  res.status(204).end();
};

export const createProductHandler: RequestHandler = async (req, res) => {
  const input = createProductSchema.parse(req.body);
  res.status(201).json({ product: await createProduct(input) });
};

export const updateProductHandler: RequestHandler = async (req, res) => {
  const { id } = adminIdParamsSchema.parse(req.params);
  const input = updateProductSchema.parse(req.body);
  res.status(200).json({ product: await updateProduct(id, input) });
};

export const deleteProductHandler: RequestHandler = async (req, res) => {
  const { id } = adminIdParamsSchema.parse(req.params);
  const result = await deleteProduct(id);
  if (result.deleted) {
    res.status(204).end();
    return;
  }
  // Referenced by orders: archived instead of deleted (the reason is included so
  // the admin UI can explain why the row is still in the list).
  res.status(200).json({ product: result.product, archived: true, orders: result.orderCount ?? 0 });
};

export const createVariantHandler: RequestHandler = async (req, res) => {
  const { id } = adminIdParamsSchema.parse(req.params);
  const input = createVariantSchema.parse(req.body);
  res.status(201).json({ variant: await createVariant(id, input) });
};

/** Adds one variant per size in a single request (S/M/L/XL in one colour). */
export const createVariantsBulkHandler: RequestHandler = async (req, res) => {
  const { id } = adminIdParamsSchema.parse(req.params);
  const input = bulkCreateVariantsSchema.parse(req.body);
  res.status(201).json({ variants: await createVariantsBulk(id, input) });
};

export const updateVariantHandler: RequestHandler = async (req, res) => {
  const { id } = adminIdParamsSchema.parse(req.params);
  const input = updateVariantSchema.parse(req.body);
  res.status(200).json({ variant: await updateVariant(id, input) });
};

export const deleteVariantHandler: RequestHandler = async (req, res) => {
  const { id } = adminIdParamsSchema.parse(req.params);
  const result = await deleteVariant(id);
  if (result.archived) {
    // Kept for order history: the stock target must survive cancellations.
    res.status(200).json({ archived: true, orders: result.orderCount });
    return;
  }
  res.status(204).end();
};

export const restoreVariantHandler: RequestHandler = async (req, res) => {
  const { id } = adminIdParamsSchema.parse(req.params);
  res.status(200).json({ variant: await restoreVariant(id) });
};

export const listVariantsHandler: RequestHandler = async (req, res) => {
  const query = adminVariantQuerySchema.parse(req.query);
  res.status(200).json(await listVariants(query));
};

export const listProductsHandler: RequestHandler = async (req, res) => {
  const query = adminProductQuerySchema.parse(req.query);
  res.status(200).json(await listProducts(query));
};

export const getProductHandler: RequestHandler = async (req, res) => {
  const { id } = adminIdParamsSchema.parse(req.params);
  res.status(200).json(await getProductAdmin(id));
};

import { destroyOwnedAssets, saveImages } from '../services/upload.service.js';
import { adminGetOrder, adminListOrders, adminUpdateOrderStatus } from '../services/admin-order.service.js';
import {
  adminGetCustomer,
  adminListCustomers,
} from '../services/admin-customer.service.js';
import { getAuthUser } from '../middleware/auth.js';
import { AppError } from '../middleware/error-handler.js';
import { emitServerEvent } from '../services/activity.service.js';
import { performAuditedAdminRead } from '../services/admin-access-audit.service.js';
import { env } from '../config/env.js';
import {
  adminCustomerQuerySchema,
  adminOrderQuerySchema,
  adminOrderStatusUpdateSchema,
  adminPaymentRefundSchema,
  adminPaymentReviewSchema,
  adminProductQuerySchema,
} from '../schemas/admin.schema.js';
import {
  completeManualRefund,
  reviewManualPayment,
} from '../services/payment-claim.service.js';

export const uploadImagesHandler: RequestHandler = async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'No images provided' },
    });
    return;
  }

  const urls = await saveImages(files);
  res.status(201).json({ assets: urls });
};

/**
 * Destroys images that were uploaded but never attached to a saved product
 * (removed from a form before saving), so Cloudinary holds no orphans.
 */
export const destroyUploadedAssetsHandler: RequestHandler = async (req, res) => {
  const input = destroyAssetsSchema.parse(req.body);
  await destroyOwnedAssets(input.publicIds);
  res.status(204).end();
};

export const adminListOrdersHandler: RequestHandler = async (req, res) => {
  const query = adminOrderQuerySchema.parse(req.query);
  if (!env.ADMIN_ACCESS_AUDIT_LEGACY_ENABLED) {
    // Phase 2C rollout flag OFF: preserve pre-audit behavior exactly.
    // Access auditing for this route is NOT yet comprehensive (documented
    // in CUSTOMER_ACTIVITY_PHASE2C_IMPLEMENTATION_REPORT.md).
    res.status(200).json(await adminListOrders(query));
    return;
  }
  const admin = getAuthUser(req);
  const { data, correlationId } = await performAuditedAdminRead({
    action: 'order.list.viewed',
    adminId: admin._id,
    page: query.page,
    load: async () => {
      const result = await adminListOrders(query);
      return { data: result, resultCount: result.total };
    },
  });
  res.setHeader('X-Audit-Id', correlationId);
  if (!data) {
    throw new AppError(404, 'NOT_FOUND', 'Not found');
  }
  res.status(200).json(data);
};

export const adminGetOrderHandler: RequestHandler = async (req, res) => {
  const { id } = adminIdParamsSchema.parse(req.params);
  if (!env.ADMIN_ACCESS_AUDIT_LEGACY_ENABLED) {
    res.status(200).json(await adminGetOrder(id));
    return;
  }
  const admin = getAuthUser(req);
  const { data, correlationId } = await performAuditedAdminRead({
    action: 'order.detail.viewed',
    adminId: admin._id,
    targetOrderId: id,
    load: async () => ({ data: await adminGetOrder(id) }),
  });
  res.setHeader('X-Audit-Id', correlationId);
  if (!data) {
    throw new AppError(404, 'NOT_FOUND', 'Order not found');
  }
  res.status(200).json(data);
};

export const adminUpdateOrderStatusHandler: RequestHandler = async (req, res) => {
  const { id } = adminIdParamsSchema.parse(req.params);
  const input = adminOrderStatusUpdateSchema.parse(req.body);
  const admin = getAuthUser(req);
  res.status(200).json({ order: await adminUpdateOrderStatus(admin, id, input) });
};

export const adminReviewPaymentHandler: RequestHandler = async (req, res) => {
  const { id } = adminIdParamsSchema.parse(req.params);
  const input = adminPaymentReviewSchema.parse(req.body);
  const admin = getAuthUser(req);
  res.status(200).json({ order: await reviewManualPayment(admin, id, input) });
};

export const adminCompleteRefundHandler: RequestHandler = async (req, res) => {
  const { id } = adminIdParamsSchema.parse(req.params);
  const input = adminPaymentRefundSchema.parse(req.body);
  const admin = getAuthUser(req);
  res.status(200).json({ order: await completeManualRefund(admin, id, input) });
};

export const adminListCustomersHandler: RequestHandler = async (req, res) => {
  const query = adminCustomerQuerySchema.parse(req.query);
  if (!env.ADMIN_ACCESS_AUDIT_LEGACY_ENABLED) {
    // Phase 2C rollout flag OFF: preserve pre-audit behavior exactly.
    // Access auditing for this route is NOT yet comprehensive (documented
    // in CUSTOMER_ACTIVITY_PHASE2C_IMPLEMENTATION_REPORT.md).
    res.status(200).json(await adminListCustomers(query));
    return;
  }
  const admin = getAuthUser(req);
  const { data, correlationId } = await performAuditedAdminRead({
    action: 'customer.list.viewed',
    adminId: admin._id,
    page: query.page,
    load: async () => {
      const result = await adminListCustomers(query);
      return { data: result, resultCount: result.total };
    },
  });
  res.setHeader('X-Audit-Id', correlationId);
  if (!data) {
    throw new AppError(404, 'NOT_FOUND', 'Not found');
  }
  res.status(200).json(data);
};

export const adminGetCustomerHandler: RequestHandler = async (req, res) => {
  const { id } = adminIdParamsSchema.parse(req.params);
  const admin = getAuthUser(req);

  if (!env.ADMIN_ACCESS_AUDIT_LEGACY_ENABLED) {
    // Phase 2C rollout flag OFF: existing behavior (read + supplementary
    // feed event) — durable audit for this route not yet enforced.
    const payload = await adminGetCustomer(id);
    emitServerEvent({
      type: 'admin.customer_viewed',
      userId: admin._id,
      customerId: payload.user.id,
    });
    res.status(200).json(payload);
    return;
  }

  // Enforcement ON: durable audit BEFORE identifiable data returns.
  const { data, correlationId } = await performAuditedAdminRead({
    action: 'customer.detail.viewed',
    adminId: admin._id,
    targetCustomerId: id,
    load: async () => ({ data: await adminGetCustomer(id) }),
  });
  res.setHeader('X-Audit-Id', correlationId);
  if (!data) {
    throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  }
  // Supplementary feed event (flag-gated no-op; never the security audit).
  emitServerEvent({
    type: 'admin.customer_viewed',
    userId: admin._id,
    customerId: data.user.id,
  });
  res.status(200).json(data);
};

// Site images (storefront marketing slots)
export const adminListSiteImagesHandler: RequestHandler = async (_req, res) => {
  res.status(200).json({ items: await listSiteImages() });
};

export const adminUpdateSiteImageHandler: RequestHandler = async (req, res) => {
  const key = siteImageKeySchema.parse(req.params.key);
  const input = updateSiteImageSchema.parse(req.body);
  res.status(200).json({ item: await updateSiteImage(key, input.image) });
};

