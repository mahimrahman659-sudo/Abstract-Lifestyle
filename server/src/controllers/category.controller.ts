import type { RequestHandler } from 'express';
import { getCategoryTree } from '../services/category.service.js';

export const listCategories: RequestHandler = async (_req, res) => {
  const items = await getCategoryTree();
  res.status(200).json({ items });
};
