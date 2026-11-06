export type ClassValue = string | false | null | undefined;

/** Minimal className joiner (no extra dependency). */
export const cn = (...classes: ClassValue[]): string => classes.filter(Boolean).join(' ');
