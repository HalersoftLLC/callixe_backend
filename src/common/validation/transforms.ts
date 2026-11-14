import { Transform } from 'class-transformer';

// Trims surrounding whitespace from string input.
export function Trim(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
}

// Trims, and turns an empty string into null. For optional text the admin can
// clear: an emptied form field and an explicit null both mean "no value".
export function TrimOrNull(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  });
}

// Trims, and turns an empty string into undefined so @IsOptional() skips it.
// HTML forms send "" for optional fields that were left blank.
export function TrimOrUndefined(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  });
}
