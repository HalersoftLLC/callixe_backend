// Single free shipping option (CLAUDE.md section 5).
export const STANDARD_SHIPPING_PRICE = 0;

export const MAX_QUANTITY_PER_ITEM = 10;
export const MAX_ITEMS_PER_ORDER = 20;
export const DISCOUNT_CODE_MAX_LENGTH = 50;

// Must match the country list in the frontend checkout form.
export const ALLOWED_COUNTRIES = [
  'Pakistan',
  'United States',
  'United Kingdom',
  'Canada',
  'Australia',
  'United Arab Emirates',
] as const;

// Rate limits (per IP, per minute) for the public write endpoints.
export const RATE_LIMIT_TTL_MS = 60_000;
export const CREATE_ORDER_RATE_LIMIT = 8;
export const VALIDATE_DISCOUNT_RATE_LIMIT = 10;
