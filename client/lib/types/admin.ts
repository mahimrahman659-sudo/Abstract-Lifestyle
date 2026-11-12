import type { OrderDto } from './order';

export type ProductStatus = 'draft' | 'active' | 'archived';

/** Cloudinary-backed image stored on admin products (url + public_id). */
export interface AdminImageAsset {
  url: string;
  publicId: string | null;
}

/** Storefront marketing image slots managed from the admin. */
export type SiteImageKey = 'hero' | 'promo-1' | 'promo-2';

export interface SiteImage {
  key: SiteImageKey;
  image: AdminImageAsset | null;
}

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
  compareAtPrice: number | null;
  images: AdminImageAsset[];
  status: ProductStatus;
}

export interface AdminVariant {
  id: string;
  product: { id: string; name: string; slug: string };
  sku: string;
  size: string | null;
  color: string | null;
  price: number | null;
  compareAtPrice: number | null;
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
  compareAtPrice?: number | null;
  images: AdminImageAsset[];
  status: ProductStatus;
}

export interface VariantPayload {
  sku: string;
  size?: string | null;
  color?: string | null;
  price?: number | null;
  compareAtPrice?: number | null;
  stock: number;
  lowStockThreshold?: number;
  images?: string[];
}
