/** Shared helper for the migrate-to-hostinger start/continue/status routes.
 *  Kept out of route.ts because Next.js's route type-checking only allows
 *  a fixed set of named exports (GET/POST/runtime/etc.) from a route file
 *  -- exporting anything else, like this, fails the build. */
export const jobKind = (format: string) => `hostinger_migrate_${format}`;
