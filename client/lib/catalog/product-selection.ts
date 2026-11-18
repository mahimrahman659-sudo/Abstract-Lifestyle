export interface ProductSelection {
  size: string | null;
  color: string | null;
}

/** Shared by server rendering and client controls; contains no client boundary. */
export const pickInitialSelection = (
  variants: Array<{ size: string | null; color: string | null; stock: number }>,
): ProductSelection => {
  const initial = variants.find((variant) => variant.stock > 0) ?? variants[0] ?? null;
  return { size: initial?.size ?? null, color: initial?.color ?? null };
};
