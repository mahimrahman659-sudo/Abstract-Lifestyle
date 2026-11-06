import { Router } from 'express';
import { getProductHandler, listProductsHandler } from '../controllers/product.controller.js';

export const productRouter: Router = Router();

productRouter.get('/', listProductsHandler);
productRouter.get('/:slug', getProductHandler);
