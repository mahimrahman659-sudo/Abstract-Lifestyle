/** A cart line as returned by the API — prices always recomputed server-side. */
export interface CartItemView {
  variantId: string;
  product: string | null;
  name: string | null;
  sku: string | null;
  size: string | null;
  color: string | null;
  image: string | null;
  unitPrice: number | null;
  quantity: number;
  lineTotal: number | null;
  outOfStock: boolean;
  insufficientStock: boolean;
  unavailable: boolean;
}

export interface CartView {
  items: CartItemView[];
  subtotal: number;
}

/**
 * Guest cart line stored in localStorage — variantId and quantity ONLY,
 * never prices (display always uses server data).
 */
export interface GuestCartItem {
  variantId: string;
  quantity: number;
}

export interface MergeCartPayload {
  items: GuestCartItem[];
}
