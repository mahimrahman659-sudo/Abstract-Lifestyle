import type { RequestHandler } from 'express';
import { productListQuerySchema, productSlugSchema } from '../schemas/product.schema.js';
import {
  getProductBySlug,
  listProducts,
  listSitemapProducts,
} from '../services/product.service.js';

export const listProductsHandler: RequestHandler = async (req, res) => {
  const query = productListQuerySchema.parse(req.query);
  const result = await listProducts(query);
  res.status(200).json(result);
};

/** Active product slugs for /sitemap.xml (no catalog payload). */
export const listProductSitemapHandler: RequestHandler = async (_req, res) => {
  res.status(200).json({ items: await listSitemapProducts() });
};

export const getProductHandler: RequestHandler = async (req, res) => {
  const slug = productSlugSchema.parse(req.params.slug);
  const detail = await getProductBySlug(slug);
  res.status(200).json(detail);
};
