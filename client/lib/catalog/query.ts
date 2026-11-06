import type { ProductListParams } from '@/lib/api/catalog';
import type { ProductSort } from '@/lib/types';

export const PRODUCT_SORT_OPTIONS: Array<{ value: ProductSort; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
];

const SORTS: ProductSort[] = PRODUCT_SORT_OPTIONS.map((option) => option.value);

const MAX_PAGE = 1000;
const MAX_PRICE_POISHA = 10_000_000; // ৳100,000 — sanity cap for URL input
const MAX_FILTER_VALUES = 10;

/** Sanitized catalog state, mirrored 1:1 in the URL query string. */
export interface CatalogQueryState {
  search?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  sizes: string[];
  colors: string[];
  sort: ProductSort;
  page: number;
}

const cleanString = (value: string | null, maxLength: number): string | undefined => {
  if (value === null) {
    return undefined;
  }
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed.length > 0 ? trimmed : undefined;
};

const cleanPrice = (value: string | null): number | undefined => {
  if (value === null) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_PRICE_POISHA) {
    return undefined;
  }
  return parsed;
};

const cleanCsv = (value: string | null): string[] => {
  if (value === null) {
    return [];
  }
  const parts = value
    .split(',')
    .map((part) => part.trim().slice(0, 40))
    .filter((part) => part.length > 0);
  return Array.from(new Set(parts)).slice(0, MAX_FILTER_VALUES);
};

/** Validates and clamps every value read from the URL before it reaches the API. */
export const parseCatalogQuery = (params: URLSearchParams): CatalogQueryState => {
  const rawSort = params.get('sort');
  const sort = SORTS.includes(rawSort as ProductSort) ? (rawSort as ProductSort) : 'newest';

  const rawPage = Number(params.get('page'));
  const page =
    Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= MAX_PAGE ? rawPage : 1;

  const minPrice = cleanPrice(params.get('minPrice'));
  const maxPriceCandidate = cleanPrice(params.get('maxPrice'));
  const maxPrice =
    minPrice !== undefined && maxPriceCandidate !== undefined && maxPriceCandidate < minPrice
      ? undefined
      : maxPriceCandidate;

  return {
    search: cleanString(params.get('search'), 100),
    category: cleanString(params.get('category'), 120),
    minPrice,
    maxPrice,
    sizes: cleanCsv(params.get('sizes')),
    colors: cleanCsv(params.get('colors')),
    sort,
    page,
  };
};

export const toProductListParams = (state: CatalogQueryState): ProductListParams => ({
  search: state.search,
  category: state.category,
  minPrice: state.minPrice,
  maxPrice: state.maxPrice,
  sizes: state.sizes.length > 0 ? state.sizes : undefined,
  colors: state.colors.length > 0 ? state.colors : undefined,
  sort: state.sort,
  page: state.page,
  limit: 12,
});

export const buildCatalogQueryString = (state: CatalogQueryState): string => {
  const params = new URLSearchParams();
  if (state.search) params.set('search', state.search);
  if (state.category) params.set('category', state.category);
  if (state.minPrice !== undefined) params.set('minPrice', String(state.minPrice));
  if (state.maxPrice !== undefined) params.set('maxPrice', String(state.maxPrice));
  if (state.sizes.length > 0) params.set('sizes', state.sizes.join(','));
  if (state.colors.length > 0) params.set('colors', state.colors.join(','));
  if (state.sort !== 'newest') params.set('sort', state.sort);
  if (state.page > 1) params.set('page', String(state.page));

  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
};

export const hasActiveCatalogFilters = (state: CatalogQueryState): boolean =>
  Boolean(state.search) ||
  Boolean(state.category) ||
  state.minPrice !== undefined ||
  state.maxPrice !== undefined ||
  state.sizes.length > 0 ||
  state.colors.length > 0;
