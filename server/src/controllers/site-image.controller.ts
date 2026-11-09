import type { RequestHandler } from 'express';
import { listSiteImages } from '../services/site-image.service.js';

/** Public, read-only storefront image slots. */
export const listSiteImagesHandler: RequestHandler = async (_req, res) => {
  res.status(200).json({ items: await listSiteImages() });
};