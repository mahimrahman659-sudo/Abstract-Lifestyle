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
  /** Flat fee from SHIPPING_FEE env (poisha) — always read from the server. */
  shippingFee: number;
  /** subtotal + shippingFee. */
  total: number;
}

/** Resolved display line for the guest (localStorage) cart — server catalog prices. */
export interface GuestCartLineView {
  variantId: string;
  quantity: number;
  name: string;
  slug: string;
  image: string | null;
  size: string | null;
  color: string | null;
  unitPrice: number;
  lineTotal: number;
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
