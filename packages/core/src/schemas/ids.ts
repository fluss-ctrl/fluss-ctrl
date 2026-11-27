// Zod schemas for the prefixed resource ids (SPEC §1). Each one carries an OpenAPI component name
// in its `.meta({ id })`, so the generated document has one `components.schemas.<Name>Id` per prefix.
import { z } from 'zod'
import { UUID_V7_PATTERN, type Id, type IdPrefix } from '../ids.ts'

/** The OpenAPI component name for each prefix's id schema. */
export const ID_SCHEMA_NAMES = {
  org: 'OrganisationId',
  site: 'SiteId',
  ctl: 'ControllerId',
  dev: 'DeviceId',
  grp: 'DeviceGroupId',
  sub: 'SubjectId',
  grt: 'GrantId',
  cmd: 'CommandId',
  evt: 'EventId',
  whk: 'WebhookEndpointId',
  cli: 'ClientId',
  req: 'RequestId',
} as const satisfies Record<IdPrefix, string>

function idSchema<P extends IdPrefix> (prefix: P): z.ZodType<Id<P>> {
  return z.string()
    .regex(new RegExp(`^${prefix}_${UUID_V7_PATTERN}$`))
    .meta({
      id: ID_SCHEMA_NAMES[prefix],
      description: `An id with the \`${prefix}_\` prefix, followed by a lower-case UUIDv7, so ids sort by creation time.`,
      examples: [`${prefix}_01934f6e-7b1a-7c3d-8e9f-0a1b2c3d4e5f`],
    }) as unknown as z.ZodType<Id<P>>
}

export const OrganisationIdSchema = idSchema('org')
export const SiteIdSchema = idSchema('site')
export const ControllerIdSchema = idSchema('ctl')
export const DeviceIdSchema = idSchema('dev')
export const DeviceGroupIdSchema = idSchema('grp')
export const SubjectIdSchema = idSchema('sub')
export const GrantIdSchema = idSchema('grt')
export const CommandIdSchema = idSchema('cmd')
export const EventIdSchema = idSchema('evt')
export const WebhookEndpointIdSchema = idSchema('whk')
export const ClientIdSchema = idSchema('cli')
export const RequestIdSchema = idSchema('req')

/** Every id schema, keyed by prefix. */
export const ID_SCHEMAS = {
  org: OrganisationIdSchema,
  site: SiteIdSchema,
  ctl: ControllerIdSchema,
  dev: DeviceIdSchema,
  grp: DeviceGroupIdSchema,
  sub: SubjectIdSchema,
  grt: GrantIdSchema,
  cmd: CommandIdSchema,
  evt: EventIdSchema,
  whk: WebhookEndpointIdSchema,
  cli: ClientIdSchema,
  req: RequestIdSchema,
} as const satisfies { [P in IdPrefix]: z.ZodType<Id<P>> }
