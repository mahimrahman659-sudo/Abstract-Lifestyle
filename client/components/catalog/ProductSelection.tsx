'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ProductSelection } from '@/lib/catalog/product-selection';

interface ProductSelectionContextValue {
  selection: ProductSelection;
  setSelection: (next: ProductSelection) => void;
}

const ProductSelectionContext = createContext<ProductSelectionContextValue | null>(null);

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
