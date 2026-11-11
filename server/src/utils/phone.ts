/**
 * Bangladeshi mobile numbers: 01[3-9]XXXXXXXX (11 digits). Accepts the
 * +880 / 880 international prefixes and ignores spaces, dashes and brackets;
 * everything is normalized to the local 01XXXXXXXXX form before saving.
 */
const BD_MOBILE = /^01[3-9]\d{8}$/;

export const BD_MOBILE_ERROR = 'Enter a valid Bangladeshi mobile number.';

/** Returns the number normalized to 01XXXXXXXXX, or null when invalid. */
export const normalizeBdMobile = (input: string): string | null => {
  const digits = input.replace(/[\s\-()]/g, '');
  let local = digits;
  if (local.startsWith('+880')) {
    local = `0${local.slice(4)}`;
  } else if (local.startsWith('880')) {
    local = `0${local.slice(3)}`;
  }
  return BD_MOBILE.test(local) ? local : null;
};
