export interface CategoryTreeItem {
  id: string;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  sortOrder: number;
  children: CategoryTreeItem[];
}

export interface CategoryListResponse {
  items: CategoryTreeItem[];
}

export interface ProductCardCategory {
  id: string;
  name: string;
  slug: string;
}

export interface ProductCard {
  id: string;
  name: string;
  slug: string;
  category: ProductCardCategory | null;
  image: string | null;
  priceFrom: number;
  priceTo: number;
  sizes: string[];
  colors: string[];
  inStock: boolean;
  /** ISO 8601 creation timestamp — gates the "New" badge (last 14 days). */
  createdAt: string;
}

export interface PublicVariant {
  id: string;
  sku: string;
  size: string | null;
  color: string | null;
  price: number;
  stock: number;
  inStock: boolean;
  lowStock: boolean;
  images: string[];
}

export interface ProductDetailProduct {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: ProductCardCategory | null;
  basePrice: number;
  images: string[];
  /** ISO 8601 creation timestamp — gates the "New Arrival" flag (last 14 days). */
  createdAt: string;
}

export interface ProductDetail {
  product: ProductDetailProduct;
  variants: PublicVariant[];
  sizeGuideKey: 'clothing' | null;
}

export type ProductSort = 'newest' | 'price_asc' | 'price_desc' | 'relevance';
