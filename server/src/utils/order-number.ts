import { randomInt } from 'node:crypto';

// Unambiguous alphabet (no 0/O/1/I) for human-readable order numbers.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const randomToken = (length: number): string => {
  let token = '';
  for (let i = 0; i < length; i += 1) {
    token += ALPHABET.charAt(randomInt(ALPHABET.length));
  }
  return token;
};

/** Order number format: `AL-YYYYMMDD-XXXX` (e.g. AL-20261106-K3ZM). */
export const generateOrderNumber = (date: Date = new Date()): string => {
  const yyyy = String(date.getFullYear()).padStart(4, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');

  return `AL-${yyyy}${mm}${dd}-${randomToken(4)}`;
};
