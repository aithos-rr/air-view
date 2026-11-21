import type { SeedRecord } from './routeResolver.js';

/**
 * Parses the pre-built route cache into the records RouteResolver.seed()
 * consumes.
 *
 * Two shapes are accepted. The current one is the envelope
 * `{ gridCursor, records }`, where the cursor belongs to the offline sampler
 * and the records to the resolver. The bare `SeedRecord[]` is what runs
 * before the cursor existed wrote, and it is still read: such a file is hours
 * of adsbdb lookups against a provider that bans at a few requests per
 * second, and a reader must not throw that away.
 *
 * Malformed JSON is allowed to throw — the caller turns that into "route
 * cache unreadable, starting cold" — but a well-formed document of the wrong
 * shape seeds nothing rather than seeding the envelope object itself.
 */
export function readRouteCache(text: string): SeedRecord[] {
  const parsed: unknown = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed as SeedRecord[];
  if (typeof parsed === 'object' && parsed !== null) {
    const records = (parsed as { records?: unknown }).records;
    if (Array.isArray(records)) return records as SeedRecord[];
  }
  return [];
}
