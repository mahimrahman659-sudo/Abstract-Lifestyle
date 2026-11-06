import type {
  AdminCategory,
  AdminImageAsset,
  AdminOrderDetail,
  AdminProduct,
  AdminProductDetail,
  AdminVariant,
  CreateCategoryPayload,
  CreateProductPayload,
  ListEnvelope,
  OrderDto,
  OrderStatus,
  ProductStatus,
  VariantPayload,
} from '../types';
import { apiFetch } from './client';

export interface AdminProductQuery {
  search?: string;
  status?: ProductStatus;
  page?: number;
  limit?: number;
}

export interface AdminOrderQuery {
  status?: OrderStatus;
  page?: number;
  limit?: number;
}

const toQueryString = (params: Record<string, string | number | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs.length > 0 ? `?${qs}` : '';
};

export const adminApi = {
  // Categories
  createCategory: (payload: CreateCategoryPayload) =>
    apiFetch<{ category: AdminCategory }>('/admin/categories', { method: 'POST', body: payload }),
  updateCategory: (id: string, payload: Partial<CreateCategoryPayload>) =>
    apiFetch<{ category: AdminCategory }>(`/admin/categories/${id}`, {
      method: 'PATCH',
      body: payload,
    }),
  deleteCategory: (id: string) =>
    apiFetch<void>(`/admin/categories/${id}`, { method: 'DELETE' }),

  // Products
  listProducts: (query: AdminProductQuery = {}) =>
    apiFetch<ListEnvelope<AdminProduct>>(`/admin/products${toQueryString({ ...query })}`),
  getProduct: (id: string) => apiFetch<AdminProductDetail>(`/admin/products/${id}`),
  createProduct: (payload: CreateProductPayload) =>
    apiFetch<{ product: AdminProduct }>('/admin/products', { method: 'POST', body: payload }),
  updateProduct: (id: string, payload: Partial<CreateProductPayload>) =>
    apiFetch<{ product: AdminProduct }>(`/admin/products/${id}`, { method: 'PATCH', body: payload }),
  deleteProduct: (id: string) =>
    apiFetch<{ product?: AdminProduct; archived?: boolean }>(`/admin/products/${id}`, {
      method: 'DELETE',
    }),

  // Variants
  createVariant: (productId: string, payload: VariantPayload) =>
    apiFetch<{ variant: AdminVariant }>(`/admin/products/${productId}/variants`, {
      method: 'POST',
      body: payload,
    }),
  updateVariant: (id: string, payload: Partial<VariantPayload>) =>
    apiFetch<{ variant: AdminVariant }>(`/admin/variants/${id}`, { method: 'PATCH', body: payload }),
  deleteVariant: (id: string) =>
    apiFetch<void>(`/admin/variants/${id}`, { method: 'DELETE' }),
  listLowStockVariants: (limit = 10) =>
    apiFetch<ListEnvelope<AdminVariant>>(`/admin/variants?lowStock=true&page=1&limit=${limit}`),

  // Uploads
  uploadImages: (files: File[]) => {
    const form = new FormData();
    for (const file of files) {
      form.append('images', file);
    }
    return apiFetch<{ assets: AdminImageAsset[] }>('/admin/uploads', {
      method: 'POST',
      body: form,
    });
  },

  // Orders
  listOrders: (query: AdminOrderQuery = {}) =>
    apiFetch<ListEnvelope<OrderDto>>(`/admin/orders${toQueryString({ ...query })}`),
  getOrder: (id: string) => apiFetch<AdminOrderDetail>(`/admin/orders/${id}`),
  updateOrderStatus: (id: string, status: OrderStatus) =>
    apiFetch<{ order: OrderDto }>(`/admin/orders/${id}/status`, {
      method: 'PATCH',
      body: { status },
    }),
};
