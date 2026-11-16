import { Router } from 'express';
import {
  getProductHandler,
  listProductsHandler,
  listProductSitemapHandler,
} from '../controllers/product.controller.js';

export const productRouter: Router = Router();

productRouter.get('/', listProductsHandler);
// Must stay above '/:slug', otherwise "sitemap" would be parsed as a product slug.
productRouter.get('/sitemap', listProductSitemapHandler);
productRouter.get('/:slug', getProductHandler);
