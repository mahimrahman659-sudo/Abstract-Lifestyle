/**
 * Shared responsive card grids (home page + product listing use the same
 * column counts and 1rem gaps).
 *
 * Rows are flex-wrapped and centred so the last row is centred instead of
 * leaving a lonely card on the left — 5 product cards or 7 category tiles still
 * look intentional. Item widths are exact column fractions:
 * products 2 → 3 → 4 columns, category tiles 2 → 3 → 6 columns.
 */
export const PRODUCT_GRID_CLASS = 'flex flex-wrap justify-center gap-4';
export const PRODUCT_GRID_ITEM_CLASS =
  'w-[calc((100%-1rem)/2)] sm:w-[calc((100%-2rem)/3)] xl:w-[calc((100%-3rem)/4)]';

export const CATEGORY_GRID_CLASS = 'flex flex-wrap justify-center gap-4';
export const CATEGORY_GRID_ITEM_CLASS =
  'w-[calc((100%-1rem)/2)] sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-5rem)/6)]';
