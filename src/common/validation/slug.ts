// Shared by Products (route param) and Orders (cart items), so both modules
// accept exactly the same slugs without importing each other's internals.
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 100;
export const SLUG_MESSAGE =
  'slug must contain only lowercase letters, numbers, and hyphens';
