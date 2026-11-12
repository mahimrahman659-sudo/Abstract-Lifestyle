/**
 * Swatch colors for product color names (PDP variant swatches).
 * Pure lookup — no clock, no state: name is trimmed and lower-cased before the
 * table lookup; unknown names return null (caller renders a neutral swatch).
 */
const COLOR_HEX: Record<string, string> = {
  black: '#111111',
  white: '#ffffff',
  charcoal: '#3f4349',
  gray: '#9a9a9a',
  grey: '#9a9a9a',
  'light gray': '#d4d4d4',
  'light grey': '#d4d4d4',
  silver: '#c0c0c0',
  beige: '#d9c7a8',
  cream: '#f1e8d4',
  ivory: '#f5f0e1',
  tan: '#c8a77a',
  brown: '#7a5230',
  navy: '#1f2d4d',
  blue: '#2f5fa8',
  'sky blue': '#8fb8e0',
  green: '#2f6b34',
  olive: '#6b6b2f',
  khaki: '#b5a76c',
  red: '#b3261e',
  maroon: '#6d1d1d',
  orange: '#d9731a',
  yellow: '#e3c13a',
  pink: '#e4a0b4',
  purple: '#6b4a9a',
  burgundy: '#6d1d33',
};

/** Hex swatch for a color name (case-insensitive, trimmed), or null if unknown. */
export const getSwatchColor = (name: string): string | null => {
  const key = name.trim().toLowerCase();
  return key.length > 0 ? (COLOR_HEX[key] ?? null) : null;
};

/**
 * True for pale swatches (white, cream, ivory, light gray, beige…) that would
 * disappear against a light surface without a visible border. Uses a simple
 * perceptual luminance so new light colors are covered without extra entries.
 */
export const isLightSwatch = (hex: string): boolean => {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) {
    return false;
  }
  const value = Number.parseInt(match[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  // Rec. 601 luma, 0–255; anything brighter than ~200 reads as "light".
  return 0.299 * r + 0.587 * g + 0.114 * b > 200;
};