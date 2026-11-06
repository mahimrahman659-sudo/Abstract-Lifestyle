import { Router } from 'express';
import { listCategories } from '../controllers/category.controller.js';

export const categoryRouter: Router = Router();

categoryRouter.get('/', listCategories);
