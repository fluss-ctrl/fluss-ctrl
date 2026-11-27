// Cursor pagination (SPEC §1): `?limit=` (default 50, max 200) and `?cursor=`; list responses are
// `{ data: [...], next_cursor }`. There are no offsets anywhere in the API.
import { z } from 'zod'

export const PAGE_LIMIT_DEFAULT = 50
export const PAGE_LIMIT_MAX = 200

export const LimitParamSchema = z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT).meta({
  description: `Page size, 1 to ${PAGE_LIMIT_MAX}. Defaults to ${PAGE_LIMIT_DEFAULT}.`,
  param: { name: 'limit', in: 'query' },
})

export const CursorParamSchema = z.string().min(1).optional().meta({
  description: 'Opaque cursor from the previous page\'s `next_cursor`. Omit it for the first page.',
  param: { name: 'cursor', in: 'query' },
})

/** The query every list endpoint accepts. Endpoints extend it with their own filters. */
export const PaginationQuerySchema = z.object({
  limit: LimitParamSchema,
  cursor: CursorParamSchema,
})

export const NextCursorSchema = z.string().min(1).nullable().meta({
  id: 'NextCursor',
  description: 'Cursor for the next page, or `null` on the last page. Opaque: do not parse it.',
})

/** The envelope of a list response, for the given item schema. */
export function listEnvelope<T extends z.ZodType> (item: T): z.ZodObject<{ data: z.ZodArray<T>, next_cursor: typeof NextCursorSchema }> {
  return z.object({ data: z.array(item), next_cursor: NextCursorSchema })
}
