'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export interface ProductSelection {
  size: string | null;
  color: string | null;
}

interface ProductSelectionContextValue {
  selection: ProductSelection;
  setSelection: (next: ProductSelection) => void;
}

const ProductSelectionContext = createContext<ProductSelectionContextValue | null>(null);

/** First purchasable variant (or the first one when everything is sold out). */
export const pickInitialSelection = (
  variants: Array<{ size: string | null; color: string | null; stock: number }>,
): ProductSelection => {
  const initial = variants.find((variant) => variant.stock > 0) ?? variants[0] ?? null;
  return { size: initial?.size ?? null, color: initial?.color ?? null };
};

/**
 * Shares the PDP variant selection between the gallery (variant images) and the
 * purchase panel, so choosing a size/colour updates both without a client page.
 */
export function ProductSelectionProvider({
  initial,
  children,
}: {
  initial: ProductSelection;
  children: ReactNode;
}) {
  const [selection, setSelection] = useState(initial);
  const value = useMemo(() => ({ selection, setSelection }), [selection]);
  return (
    <ProductSelectionContext.Provider value={value}>{children}</ProductSelectionContext.Provider>
  );
}

/** Null outside the PDP provider (the panel keeps its own local state then). */
export const useProductSelectionContext = (): ProductSelectionContextValue | null =>
  useContext(ProductSelectionContext);
