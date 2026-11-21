// Row-level security and privileges for the API role (SPEC §5; issue #5 acceptance criteria).
// Every query here runs as `app_login`, a member of `fluss_app`, never as the owner.
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb, type Db } from './client.ts'
import * as s from './schema/index.ts'
import { withOrg } from './scope.ts'
import { testId } from './test/ids.ts'
import { countRows, dbError, ORG_SCOPED_TABLES, seedOrg, type SeededOrg } from './test/seed.ts'

let client: postgres.Sql
let owner: postgres.Sql
let db: Db
let a: SeededOrg
let b: SeededOrg

beforeAll(async () => {
  // One connection, so the "no context" checks also run on a connection that an earlier
  // org-scoped transaction has used (where the setting reads '' rather than NULL).
  client = postgres(inject('appUrl'), { max: 1, onnotice: () => {} })
  owner = postgres(inject('ownerUrl'), { max: 1, onnotice: () => {} })
  db = createDb(client)
  a = await seedOrg(db)
  b = await seedOrg(db)
})

afterAll(async () => {
  await client.end()
  await owner.end()
})

describe('catalogue', () => {
  it('forces a policy on every table except the provider catalogue', async () => {
    const rows = await owner<{ relname: string, rls: boolean, forced: boolean, policies: number, has_org: boolean }[]>`
      SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
             (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
             EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped) AS has_org
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      ORDER BY c.relname`
    const unprotected = rows.filter((r) => r.relname !== 'providers' && !(r.rls && r.forced && r.policies > 0))
    expect(unprotected.map((r) => r.relname)).toEqual([])
    const withoutOrg = rows.filter((r) => !r.has_org).map((r) => r.relname)
    expect(withoutOrg).toEqual(['organisations', 'providers'])
    expect(rows.map((r) => r.relname).sort()).toEqual([...ORG_SCOPED_TABLES, 'organisations', 'providers'].sort())
  })

  it('gives the API role no privilege on any partition, only on the parents', async () => {
    const rows = await owner<{ relname: string }[]>`
      SELECT c.relname FROM pg_class c
      WHERE c.relispartition AND (
        has_table_privilege('fluss_app', c.oid, 'SELECT') OR has_table_privilege('fluss_app', c.oid, 'INSERT') OR
        has_table_privilege('fluss_app', c.oid, 'UPDATE') OR has_table_privilege('fluss_app', c.oid, 'DELETE'))`
    expect(rows).toEqual([])
    const parts = await owner<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_class WHERE relispartition`
    expect(parts[0]!.n).toBeGreaterThanOrEqual(2 * 16)
  })

  it('logs in as a role that cannot bypass RLS', async () => {
    const [row] = await client<{ bypass: boolean, su: boolean }[]>`
      SELECT rolbypassrls AS bypass, rolsuper AS su FROM pg_roles WHERE rolname = current_user`
    expect(row).toEqual({ bypass: false, su: false })
  })
})

describe('without an org context', () => {
  it.each([...ORG_SCOPED_TABLES, 'organisations'])('%s returns no rows', async (table) => {
    expect(await countRows(db, table)).toBe(0)
    await db.transaction(async (tx) => {
      expect(await countRows(tx, table)).toBe(0)
    })
  })

  it('cannot insert', async () => {
    expect(await dbError(db.insert(s.organisations).values({ id: testId('org'), name: 'x', region: 'us' }))).toMatch(/row-level security/)
  })
})

describe('with org A as the context', () => {
  it.each([...ORG_SCOPED_TABLES, 'organisations'])('%s shows only org A rows', async (table) => {
    const col = table === 'organisations' ? 'id' : 'org_id'
    await withOrg(db, a.orgId, async ({ tx }) => {
      expect(await countRows(tx, table)).toBe(1)
      const other = await tx.execute<{ n: number }>(sql.raw(`SELECT count(*)::int AS n FROM "${table}" WHERE "${col}" <> '${a.orgId}'`))
      expect(other[0]!.n).toBe(0)
    })
  })

  it('cannot read org B rows even by id, without an org filter', async () => {
    await withOrg(db, a.orgId, async ({ tx }) => {
      expect(await tx.select().from(s.devices).where(sql`${s.devices.id} = ${b.deviceId}`)).toEqual([])
      expect(await tx.select().from(s.events).where(sql`${s.events.id} = ${b.eventId}`)).toEqual([])
    })
  })

  it('cannot write a row for org B', async () => {
    expect(await dbError(withOrg(db, a.orgId, async ({ tx }) => {
      await tx.insert(s.sites).values({ id: testId('site'), orgId: b.orgId, name: 'x', timezone: 'UTC' })
    }))).toMatch(/row-level security/)
  })

  it('cannot move its own row to org B', async () => {
    expect(await dbError(withOrg(db, a.orgId, async ({ tx }) => {
      await tx.update(s.sites).set({ orgId: b.orgId }).where(sql`${s.sites.id} = ${a.siteId}`)
    }))).toMatch(/row-level security/)
  })

  it('updates nothing of org B', async () => {
    const updated = await withOrg(db, a.orgId, async ({ tx }) =>
      tx.update(s.sites).set({ name: 'taken' }).where(sql`${s.sites.id} = ${b.siteId}`).returning())
    expect(updated).toEqual([])
  })

  it('does not leak the context into the next transaction on the connection', async () => {
    await withOrg(db, a.orgId, async () => {})
    const [row] = await db.execute<{ v: string | null }>(sql`SELECT current_setting('app.org_id', true) AS v`)
    expect(row!.v ?? '').toBe('')
    expect(await countRows(db, 'sites')).toBe(0)
  })
})

describe('privileges', () => {
  it('reads the provider catalogue but cannot change it', async () => {
    expect(await countRows(db, 'providers')).toBe(1)
    expect(await dbError(db.insert(s.providers).values({ code: 'rogue', name: 'x', onboardingMode: 'x' }))).toMatch(/permission denied/)
  })

  it('keeps events append-only apart from pseudonymisation', async () => {
    await withOrg(db, a.orgId, async ({ tx }) => {
      const done = await tx.update(s.events).set({ subjectId: null, data: {}, pseudonymisedAt: new Date() })
        .where(sql`${s.events.id} = ${a.eventId}`).returning({ id: s.events.id })
      expect(done).toHaveLength(1)
    })
    expect(await dbError(withOrg(db, a.orgId, ({ tx }) => tx.update(s.events).set({ type: 'access.granted' })))).toMatch(/permission denied/)
    expect(await dbError(withOrg(db, a.orgId, ({ tx }) => tx.delete(s.events)))).toMatch(/permission denied/)
    expect(await dbError(withOrg(db, a.orgId, ({ tx }) => tx.delete(s.auditLog)))).toMatch(/permission denied/)
  })

  it('cannot reach a partition directly', async () => {
    expect(await dbError(countRows(db, 'events_default'))).toMatch(/permission denied/)
  })

  it('cannot create partitions', async () => {
    expect(await dbError(db.execute(sql`SELECT create_month_partitions('events', '2030-01-01', 1)`))).toMatch(/permission denied/)
  })
})

describe('constraints that span organisations', () => {
  it('refuses a live controller another org has claimed, and allows it once archived', async () => {
    const claim = (orgId: string, siteId: string) => withOrg(db, orgId, ({ tx }) =>
      tx.insert(s.controllers).values({ id: testId('ctl'), orgId, siteId, provider: 'simulator', providerRef: a.controllerId }))
    expect(await dbError(claim(b.orgId, b.siteId))).toMatch(/controllers_provider_ref_live_key/)
    await withOrg(db, a.orgId, ({ tx }) => tx.update(s.controllers).set({ archivedAt: new Date() }).where(sql`${s.controllers.id} = ${a.controllerId}`))
    await expect(claim(b.orgId, b.siteId)).resolves.toBeDefined()
  })

  it('rejects a grant with both or neither of device and group', async () => {
    expect(await dbError(withOrg(db, a.orgId, async ({ tx }) => {
      const [sub] = await tx.select({ id: s.subjects.id }).from(s.subjects)
      await tx.insert(s.grants).values({ id: testId('grt'), orgId: a.orgId, siteId: a.siteId, subjectId: sub!.id, type: 'permanent', status: 'active' })
    }))).toMatch(/grants_target_check/)
  })

  it('honours the count_limited reservation guard from SPEC §6', async () => {
    await withOrg(db, a.orgId, async ({ tx }) => {
      const [sub] = await tx.select({ id: s.subjects.id }).from(s.subjects)
      const id = testId('grt')
      await tx.insert(s.grants).values({ id, orgId: a.orgId, siteId: a.siteId, subjectId: sub!.id, deviceId: a.deviceId, type: 'count_limited', status: 'active', maxUses: 1 })
      const reserve = () => tx.execute(sql`UPDATE grants SET reserved = reserved + 1 WHERE id = ${id} AND uses + reserved < max_uses RETURNING id`)
      expect(await reserve()).toHaveLength(1)
      expect(await reserve()).toHaveLength(0)
    })
  })

  it('keeps one idempotency key per client', async () => {
    const key = randomUUID()
    const insert = () => withOrg(db, a.orgId, ({ tx }) =>
      tx.insert(s.idempotencyKeys).values({ orgId: a.orgId, clientId: a.clientId, key, requestHash: 'r', expiresAt: new Date() }))
    await insert()
    expect(await dbError(insert())).toMatch(/idempotency_keys_pkey/)
  })
})
