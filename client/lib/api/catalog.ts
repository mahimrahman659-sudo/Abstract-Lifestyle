import type { CategoryListResponse } from '../types';
import { apiFetch } from './client';

export const catalogApi = {
  getCategories: () => apiFetch<CategoryListResponse>('/categories'),
};
