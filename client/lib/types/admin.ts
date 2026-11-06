import type { OrderDto } from './order';

export type ProductStatus = 'draft' | 'active' | 'archived';

export interface AdminCategory {
  id: string;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  parent: string | null;
  sortOrder: number;
}

export interface AdminProduct {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  basePrice: number;
  images: string[];
  status: ProductStatus;
}

export interface AdminVariant {
  id: string;
  product: { id: string; name: string; slug: string };
  sku: string;
  size: string | null;
  color: string | null;
  price: number | null;
  stock: number;
  lowStockThreshold: number;
  images: string[];
  inStock: boolean;
  lowStock: boolean;
}

export interface AdminProductDetail {
  product: AdminProduct;
  variants: AdminVariant[];
}

export interface AdminOrderCustomer {
  id: string;
  name: string;
  email: string;
}

export interface AdminOrderDetail {
  order: OrderDto;
  customer: AdminOrderCustomer | null;
}

export interface CreateCategoryPayload {
  name: string;
  parent?: string | null;
  description?: string;
  sortOrder?: number;
}

export interface CreateProductPayload {
  name: string;
  description: string;
  category: string;
  basePrice: number;
  images: string[];
  status: ProductStatus;
}

export interface VariantPayload {
  sku: string;
  size?: string | null;
  color?: string | null;
  price?: number | null;
  stock: number;
  lowStockThreshold?: number;
  images?: string[];
}
