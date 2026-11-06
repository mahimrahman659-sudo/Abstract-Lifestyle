import type { RequestHandler } from 'express';
import {
  createCategory,
  createProduct,
  createVariant,
  deleteCategory,
  deleteProduct,
  deleteVariant,
  listVariants,
  updateCategory,
  updateProduct,
  updateVariant,
} from '../services/admin-catalog.service.js';
import { adminIdParamsSchema, adminVariantQuerySchema } from '../schemas/admin.schema.js';
import { createCategorySchema, updateCategorySchema } from '../schemas/category.schema.js';
import { createProductSchema, updateProductSchema } from '../schemas/product.schema.js';
import { createVariantSchema, updateVariantSchema } from '../schemas/variant.schema.js';

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
  // Referenced by orders: archived instead of deleted.
  res.status(200).json({ product: result.product, archived: true });
};

export const createVariantHandler: RequestHandler = async (req, res) => {
  const { id } = adminIdParamsSchema.parse(req.params);
  const input = createVariantSchema.parse(req.body);
  res.status(201).json({ variant: await createVariant(id, input) });
};

export const updateVariantHandler: RequestHandler = async (req, res) => {
  const { id } = adminIdParamsSchema.parse(req.params);
  const input = updateVariantSchema.parse(req.body);
  res.status(200).json({ variant: await updateVariant(id, input) });
};

export const deleteVariantHandler: RequestHandler = async (req, res) => {
  const { id } = adminIdParamsSchema.parse(req.params);
  await deleteVariant(id);
  res.status(204).end();
};

export const listVariantsHandler: RequestHandler = async (req, res) => {
  const query = adminVariantQuerySchema.parse(req.query);
  res.status(200).json(await listVariants(query));
};

import { saveImages } from '../services/upload.service.js';
import {
  adminListOrders,
  adminUpdateOrderStatus,
} from '../services/admin-order.service.js';
import {
  adminGetCustomer,
  adminListCustomers,
} from '../services/admin-customer.service.js';
import { getOrder } from '../services/order.service.js';
import { getAuthUser } from '../middleware/auth.js';
import {
  adminCustomerQuerySchema,
  adminOrderQuerySchema,
  adminOrderStatusUpdateSchema,
} from '../schemas/admin.schema.js';

export const uploadImagesHandler: RequestHandler = async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'No images provided' },
    });
    return;
  }

  const urls = await saveImages(files);
  res.status(201).json({ urls });
};

export const adminListOrdersHandler: RequestHandler = async (req, res) => {
  const query = adminOrderQuerySchema.parse(req.query);
  res.status(200).json(await adminListOrders(query));
};

export const adminGetOrderHandler: RequestHandler = async (req, res) => {
  const { id } = adminIdParamsSchema.parse(req.params);
  const user = getAuthUser(req);
  res.status(200).json({ order: await getOrder(user, id) });
};

export const adminUpdateOrderStatusHandler: RequestHandler = async (req, res) => {
  const { id } = adminIdParamsSchema.parse(req.params);
  const input = adminOrderStatusUpdateSchema.parse(req.body);
  const admin = getAuthUser(req);
  res.status(200).json({ order: await adminUpdateOrderStatus(admin, id, input) });
};

export const adminListCustomersHandler: RequestHandler = async (req, res) => {
  const query = adminCustomerQuerySchema.parse(req.query);
  res.status(200).json(await adminListCustomers(query));
};

export const adminGetCustomerHandler: RequestHandler = async (req, res) => {
  const { id } = adminIdParamsSchema.parse(req.params);
  res.status(200).json(await adminGetCustomer(id));
};

