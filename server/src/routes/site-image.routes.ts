import { Router } from 'express';
import { listSiteImagesHandler } from '../controllers/site-image.controller.js';

export const siteImageRouter: Router = Router();

siteImageRouter.get('/', listSiteImagesHandler);