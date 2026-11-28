// Event paging (SPEC §4, §5; issues #5 and #30): lists follow recorded_at, never occurred_at, the
// cursor walks every event exactly once, paging never crosses organisations, and a page never holds
// an event recorded inside the settle window, so a cursor cannot pass one that is still committing.
import { sql } from 'drizzle-orm'
import fc from 'fast-check'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb, type Db } from '../client.ts'
import { organisations } from '../schema/index.ts'
import { withOrg } from '../scope.ts'
import { testId } from '../test/ids.ts'
import { seedOrg, type SeededOrg } from '../test/seed.ts'
import { DEFAULT_LIMIT, EVENT_ID_MAX_AGE_MS, EVENT_SETTLE_MS, insertEvent, listEvents, recordedAtFromId, StaleEventIdError, type EventRow } from './events.ts'

let client: postgres.Sql
let db: Db
let a: SeededOrg
let b: SeededOrg
const DAY = 86_400_000
const base = Date.UTC(2026, 10, 25) // 25 Nov 2026
// A clock reading by which every fixture below has settled, including the rows seedOrg() records
// at the wall clock.
const FAR = new Date(Date.UTC(2100, 0, 1))

beforeAll(async () => {
  client = postgres(inject('appUrl'), { max: 2, onnotice: () => {} })
  db = createDb(client)
  a = await seedOrg(db)
  b = await seedOrg(db)
  // Recorded across two monthly partitions and the default one (2031 has no monthly partition);
  // device time deliberately runs backwards, as a late or wrong device clock would.
  const recordedDays = [0, 1, 2, 10, 11, 40, 1900]
  await withOrg(db, a.orgId, async (scope) => {
    for (const [i, day] of recordedDays.entries()) {
      await insertEvent(scope, {
        id: testId('evt', base + day * DAY),
        type: 'access.granted',
        occurredAt: new Date(base - i * DAY),
        deviceId: i % 2 === 0 ? a.deviceId : null,
        method: 'api',
        result: 'ok',
      }, new Date(base + day * DAY))
    }
  })
  await withOrg(db, b.orgId, (scope) => insertEvent(scope, { id: testId('evt', base + DAY / 2), type: 'access.denied', occurredAt: new Date(base) }, new Date(base + DAY / 2)))
})

afterAll(async () => { await client.end() })

async function walk (orgId: string, limit: number, extra: Parameters<typeof listEvents>[1] = {}): Promise<EventRow[]> {
  const out: EventRow[] = []
  let cursor: string | null = null
  do {
    const page = await withOrg(db, orgId, (scope) => listEvents(scope, { ...extra, limit, cursor }, FAR))
    expect(page.data.length).toBeLessThanOrEqual(limit)
    out.push(...page.data)
    cursor = page.nextCursor
  } while (cursor)
  return out
}

describe('listEvents', () => {
  it('orders by recorded_at and walks every event once, whatever the page size', async () => {
    for (const limit of [1, 2, 3, 50]) {
      const rows = await walk(a.orgId, limit)
      expect(rows).toHaveLength(8) // seven above plus the seeded one
      expect(new Set(rows.map((r) => r.id)).size).toBe(8)
      const recorded = rows.map((r) => r.recordedAt.getTime())
      expect(recorded).toEqual([...recorded].sort((x, y) => x - y))
      expect(rows.every((r) => r.orgId === a.orgId)).toBe(true)
    }
  })

  it('derives recorded_at from the id and lands rows in the right partition', async () => {
    const rows = await walk(a.orgId, 50)
    for (const r of rows) {
      expect(r.recordedAt.getTime()).toBe(Number.parseInt(r.id.slice(4).replaceAll('-', '').slice(0, 12), 16))
    }
    const parts = await withOrg(db, a.orgId, ({ tx }) =>
      tx.execute<{ p: string }>(sql`SELECT DISTINCT tableoid::regclass::text AS p FROM events ORDER BY 1`))
    expect(parts.map((r) => r.p)).toEqual(['events_default', 'events_y2026m11', 'events_y2026m12', 'events_y2027m01'])
  })

  it('filters on occurred_at without changing the order', async () => {
    // The seeded event uses the wall clock, so select the fixtures by type.
    const rows = await walk(a.orgId, 2, { type: 'access.granted', occurredSince: new Date(base - 2 * DAY), occurredUntil: new Date(base + 1) })
    expect(rows.map((r) => r.occurredAt.getTime())).toEqual([base, base - DAY, base - 2 * DAY])
  })

  it('filters on recorded_at and device', async () => {
    const rows = await walk(a.orgId, 2, { type: 'access.granted', since: new Date(base), until: new Date(base + 30 * DAY), deviceId: a.deviceId })
    expect(rows).toHaveLength(3)
  })

  it('treats a non-finite limit as the default, never as no limit', async () => {
    // More rows than the default page, so a dropped LIMIT would show.
    const c = await seedOrg(db)
    await withOrg(db, c.orgId, async (scope) => {
      for (let i = 0; i < DEFAULT_LIMIT + 10; i++) {
        await insertEvent(scope, { id: testId('evt', base + i * 1000), type: 'access.granted', occurredAt: new Date(base) }, new Date(base + i * 1000))
      }
    })
    // Capture the SQL the driver sends, so the test sees the LIMIT itself, not just the page.
    const sent: { query: string, parameters: unknown[] }[] = []
    const traced = postgres(inject('appUrl'), { max: 1, onnotice: () => {}, debug: (_conn, query, parameters) => { sent.push({ query, parameters }) } })
    try {
      const tracedDb = createDb(traced)
      for (const limit of [Number.NaN, Number.POSITIVE_INFINITY]) {
        sent.length = 0
        const page = await withOrg(tracedDb, c.orgId, (scope) => listEvents(scope, { limit }, FAR))
        expect(page.data).toHaveLength(DEFAULT_LIMIT)
        expect(page.nextCursor).not.toBeNull()
        const select = sent.find((q) => q.query.includes('from "events"'))
        expect(select?.query).toMatch(/limit \$\d+$/)
        expect(Number(select?.parameters.at(-1))).toBe(DEFAULT_LIMIT + 1)
      }
    } finally {
      await traced.end()
    }
  })

  it('returns a null cursor on the last page and rejects a forged one', async () => {
    const page = await withOrg(db, a.orgId, (scope) => listEvents(scope, { limit: 200 }, FAR))
    expect(page.nextCursor).toBeNull()
    await expect(withOrg(db, a.orgId, (scope) => listEvents(scope, { cursor: 'not-a-cursor' }, FAR))).rejects.toThrow('Invalid cursor')
  })

  it('never shows another organisation, even with its cursor', async () => {
    const aPage = await withOrg(db, a.orgId, (scope) => listEvents(scope, { limit: 1 }, FAR))
    expect(aPage.nextCursor).not.toBeNull()
    const bPage = await withOrg(db, b.orgId, (scope) => listEvents(scope, { limit: 200, cursor: aPage.nextCursor }, FAR))
    expect(bPage.data.length).toBeGreaterThan(0)
    expect(bPage.data.every((r) => r.orgId === b.orgId)).toBe(true)
    const rows = await walk(b.orgId, 1)
    expect(rows.map((r) => r.type).sort()).toEqual(['access.denied', 'command.requested'])
  })
})

describe('the settle window', () => {
  const t0 = Date.UTC(2026, 11, 1, 8) // 1 Dec 2026 08:00:00.000Z

  /** An organisation with no events, so every row a test reads is one it wrote. */
  async function emptyOrg (): Promise<string> {
    const orgId = testId('org')
    await withOrg(db, orgId, ({ tx }) => tx.insert(organisations).values({ id: orgId, name: 'Settle window', region: 'za' }))
    return orgId
  }

  /** Writes an event as a writer keeping SPEC §5 does: the id is minted at the insert. */
  function record (orgId: string, ms: number): Promise<EventRow> {
    return withOrg(db, orgId, (scope) => insertEvent(scope, { id: testId('evt', ms), type: 'access.granted', occurredAt: new Date(ms) }, new Date(ms)))
  }

  /** Inserts an event in a transaction of its own and leaves it open until the returned function is called. */
  async function hold (on: Db, orgId: string, id: string): Promise<() => Promise<void>> {
    let inserted!: () => void
    let release!: () => void
    const isInserted = new Promise<void>((resolve) => { inserted = resolve })
    const mayCommit = new Promise<void>((resolve) => { release = resolve })
    const tx = withOrg(on, orgId, async (scope) => {
      await insertEvent(scope, { id, type: 'access.granted', occurredAt: recordedAtFromId(id) }, recordedAtFromId(id))
      inserted()
      await mayCommit
    })
    await Promise.race([isInserted, tx])
    return async () => {
      release()
      await tx
    }
  }

  /**
   * A consumer tailing the log: it follows `next_cursor` while it is given one and, at the end of
   * the list, reads again from the last cursor it holds. `read` resolves to whether a cursor came back.
   */
  function tail (on: Db, orgId: string, limit: number): { seen: EventRow[], read: (nowMs: number) => Promise<boolean> } {
    const seen: EventRow[] = []
    let cursor: string | null = null
    return {
      seen,
      read: async (nowMs) => {
        const page = await withOrg(on, orgId, (scope) => listEvents(scope, { limit, cursor }, new Date(nowMs)))
        for (const e of page.data) if (!seen.some((s) => s.id === e.id)) seen.push(e)
        cursor = page.nextCursor ?? cursor
        return page.nextCursor !== null
      },
    }
  }

  it('gives a consumer paging by cursor both events when two transactions commit out of order', async () => {
    const orgId = await emptyOrg()
    const old = await record(orgId, t0 - 60_000)
    // `slow` takes the earlier id, then stays open while `fast` and `next` commit behind it.
    const slowId = testId('evt', t0)
    const commitSlow = await hold(db, orgId, slowId)
    const consumer = tail(db, orgId, 1)
    let fast: EventRow
    let next: EventRow
    try {
      fast = await record(orgId, t0 + 20)
      next = await record(orgId, t0 + 40)
      // 100 ms on, `fast` is committed and `slow` is not. A page that returned `fast` would hand
      // out a cursor that sits past `slow`.
      await consumer.read(t0 + 100)
      await consumer.read(t0 + 100)
      expect(consumer.seen).toEqual([old])
    } finally {
      await commitSlow()
    }

    const settled = t0 + 40 + EVENT_SETTLE_MS + 1
    while (await consumer.read(settled));
    expect(consumer.seen.map((e) => e.id)).toEqual([old.id, slowId, fast.id, next.id])
  })

  it('holds an event back until it was recorded more than 5 s ago', async () => {
    expect(EVENT_SETTLE_MS).toBe(5000)
    const orgId = await emptyOrg()
    const first = await record(orgId, t0)
    const second = await record(orgId, t0 + 1)
    const at = (nowMs: number) => withOrg(db, orgId, (scope) => listEvents(scope, { limit: 1 }, new Date(nowMs)))

    expect(await at(t0 + 5000)).toEqual({ data: [], nextCursor: null })
    // `second` is committed but not settled: the list ends at `first`, with no cursor past it.
    expect(await at(t0 + 5001)).toEqual({ data: [first], nextCursor: null })
    const page = await at(t0 + 5002)
    expect(page.data).toEqual([first])
    const rest = await withOrg(db, orgId, (scope) => listEvents(scope, { cursor: page.nextCursor }, new Date(t0 + 5002)))
    expect(rest).toEqual({ data: [second], nextCursor: null })
  })

  it('applies with a cursor, and whatever since and until ask for', async () => {
    const orgId = await emptyOrg()
    const first = await record(orgId, t0)
    await record(orgId, t0 + 1000)
    await record(orgId, t0 + 2000)
    const now = new Date(t0 + 1000 + EVENT_SETTLE_MS) // only `first` has settled

    const page = await withOrg(db, orgId, (scope) => listEvents(scope, { since: new Date(t0), until: new Date(t0 + DAY) }, now))
    expect(page).toEqual({ data: [first], nextCursor: null })
    const cursor = await withOrg(db, orgId, (scope) => listEvents(scope, { limit: 1 }, FAR)).then((p) => p.nextCursor)
    expect(cursor).not.toBeNull()
    expect(await withOrg(db, orgId, (scope) => listEvents(scope, { cursor }, now))).toEqual({ data: [], nextCursor: null })
  })

  it('shows a tailing consumer every event, in order, whatever order the writers commit in', async () => {
    // Writers keep their side (SPEC §5): each event commits within the window of its recorded_at.
    // Reads land anywhere in between; the last ones come after everything has settled.
    const lastWrite = 2000
    const write = fc.record({ at: fc.integer({ min: 0, max: lastWrite }), commitAfter: fc.integer({ min: 0, max: EVENT_SETTLE_MS }) })
    const writes = fc.array(write, { minLength: 2, maxLength: 6 })
    const reads = fc.array(fc.integer({ min: 0, max: lastWrite + EVENT_SETTLE_MS + 1000 }), { maxLength: 10 })
    // One connection for each transaction a run can hold open, and one for the reader.
    const pool = postgres(inject('appUrl'), { max: 7, onnotice: () => {} })
    const poolDb = createDb(pool)
    try {
      await fc.assert(fc.asyncProperty(writes, reads, fc.integer({ min: 1, max: 3 }), async (ws, rs, limit) => {
        const orgId = await emptyOrg()
        const ids = ws.map((w) => testId('evt', t0 + w.at))
        const steps = [
          ...ws.map((w, i) => ({ t: w.at, order: 0, kind: 'insert' as const, i })),
          ...ws.map((w, i) => ({ t: w.at + w.commitAfter, order: 1, kind: 'commit' as const, i })),
          ...rs.map((t) => ({ t, order: 2, kind: 'read' as const, i: -1 })),
        ].sort((x, y) => x.t - y.t || x.order - y.order)
        const consumer = tail(poolDb, orgId, limit)
        const commits = new Map<number, () => Promise<void>>()
        try {
          for (const step of steps) {
            if (step.kind === 'insert') commits.set(step.i, await hold(poolDb, orgId, ids[step.i]!))
            else if (step.kind === 'commit') await commits.get(step.i)!()
            else await consumer.read(t0 + step.t)
          }
        } finally {
          // A no-op for a transaction that has already committed.
          await Promise.all([...commits.values()].map((commit) => commit()))
        }
        const settled = t0 + lastWrite + EVENT_SETTLE_MS + 1
        while (await consumer.read(settled));

        const inOrder = [...consumer.seen].sort((x, y) => x.recordedAt.getTime() - y.recordedAt.getTime())
        expect(consumer.seen.map((e) => e.recordedAt.getTime())).toEqual(inOrder.map((e) => e.recordedAt.getTime()))
        expect(consumer.seen.map((e) => e.id).sort()).toEqual([...ids].sort())
      }), {
        numRuns: 40,
        examples: [
          // A read between two commits that land out of order.
          [[{ at: 0, commitAfter: 3 }, { at: 1, commitAfter: 0 }], [2], 1],
          // Two events commit behind an open one: without the window the cursor moves past it.
          [[{ at: 0, commitAfter: 3000 }, { at: 10, commitAfter: 0 }, { at: 20, commitAfter: 0 }], [100, 100, 4000], 1],
        ],
      })
    } finally {
      await pool.end()
    }
  })
})

describe('insertEvent and the age of the id', () => {
  const t0 = Date.UTC(2026, 11, 2, 8) // 2 Dec 2026 08:00:00.000Z

  it('stores an event whose id was minted up to 1 s before the insert', async () => {
    expect(EVENT_ID_MAX_AGE_MS).toBe(1000)
    const c = await seedOrg(db)
    const rows = await withOrg(db, c.orgId, async (scope) => [
      await insertEvent(scope, { id: testId('evt', t0), type: 'access.granted', occurredAt: new Date(t0) }, new Date(t0)),
      await insertEvent(scope, { id: testId('evt', t0), type: 'access.granted', occurredAt: new Date(t0) }, new Date(t0 + EVENT_ID_MAX_AGE_MS)),
    ])
    expect(rows.map((r) => r.recordedAt.getTime())).toEqual([t0, t0])
  })

  it('refuses an id minted earlier and stores nothing from that transaction', async () => {
    const c = await seedOrg(db)
    const kept = testId('evt', t0)
    const stale = testId('evt', t0)
    // The first insert is fine; the second reuses an id minted 1.001 s before, as a retry would.
    const work = withOrg(db, c.orgId, async (scope) => {
      await insertEvent(scope, { id: kept, type: 'access.granted', occurredAt: new Date(t0) }, new Date(t0))
      await insertEvent(scope, { id: stale, type: 'access.granted', occurredAt: new Date(t0) }, new Date(t0 + EVENT_ID_MAX_AGE_MS + 1))
    })
    await expect(work).rejects.toThrow(StaleEventIdError)
    const page = await withOrg(db, c.orgId, (scope) => listEvents(scope, { type: 'access.granted' }, FAR))
    expect(page.data).toEqual([])
  })
})
