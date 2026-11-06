import type { CategoryListResponse, ListEnvelope, ProductCard, ProductSort } from '../types';
import { apiFetch } from './client';

export interface ProductListParams {
  search?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  sizes?: string[];
  colors?: string[];
  sort?: ProductSort;
  page?: number;
  limit?: number;
}

const toQueryString = (params: ProductListParams): string => {
  const search = new URLSearchParams();

  if (params.search) search.set('search', params.search);
  if (params.category) search.set('category', params.category);
  if (params.minPrice !== undefined) search.set('minPrice', String(params.minPrice));
  if (params.maxPrice !== undefined) search.set('maxPrice', String(params.maxPrice));
  if (params.sizes && params.sizes.length > 0) search.set('sizes', params.sizes.join(','));
  if (params.colors && params.colors.length > 0) search.set('colors', params.colors.join(','));
  if (params.sort) search.set('sort', params.sort);
  if (params.page !== undefined) search.set('page', String(params.page));
  if (params.limit !== undefined) search.set('limit', String(params.limit));

  const qs = search.toString();
  return qs.length > 0 ? `?${qs}` : '';
};

export const catalogApi = {
  getCategories: () => apiFetch<CategoryListResponse>('/categories'),
  getProducts: (params: ProductListParams = {}, signal?: AbortSignal) =>
    apiFetch<ListEnvelope<ProductCard>>(`/products${toQueryString(params)}`, { signal }),
};

