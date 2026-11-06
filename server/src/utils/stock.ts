/** Default low-stock threshold used by models, schemas and the low-stock indicator. */
export const LOW_STOCK_THRESHOLD_DEFAULT = 5;

export const isInStock = (stock: number): boolean => stock > 0;

/** Same semantics as the public catalog: low stock when 0 < stock ≤ threshold. */
export const isLowStock = (stock: number, threshold: number): boolean =>
  stock > 0 && stock <= threshold;
