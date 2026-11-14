// Login is the only public admin route, so it is rate limited to slow down
// password guessing.
export const ADMIN_LOGIN_RATE_LIMIT = 5;
export const ADMIN_LOGIN_TTL_MS = 60_000;

// One working day; after that the admin logs in again.
export const ADMIN_TOKEN_TTL_SECONDS = 8 * 60 * 60;

// There is exactly one admin, so the token carries no personal data.
export const ADMIN_TOKEN_SUBJECT = 'admin';

export interface AdminTokenPayload {
  sub: string;
}

// Admin list pages.
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const SEARCH_MAX_LENGTH = 100;

// Product limits. Text lengths match the database columns; the price cap
// (100,000.00) catches a typo such as an extra zero, in cents.
export const MAX_PRODUCT_PRICE = 10_000_000;
export const PRODUCT_NAME_MAX_LENGTH = 200;
export const PRODUCT_DESCRIPTION_MAX_LENGTH = 2000;
export const PRODUCT_BADGE_MAX_LENGTH = 50;
