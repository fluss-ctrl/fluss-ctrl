// The OpenAPI v1 document (SPEC §1, §4, §11 item 2; PLAN decision 14). It is generated from the
// route definitions with @hono/zod-openapi, never written by hand: `pnpm openapi` writes
// apps/api/openapi.json, and the contract tests fail if the committed file differs from what the
// routes generate or if a response does not match it.
//
// Phase 0 holds `/health` and the shared components only (decision on #13): problem details and
// error codes, the shared error responses, pagination and the id formats. Phase 1 endpoints add
// themselves here as they are built.
import { ApiError } from '@flussctrl/core'
import { OpenAPIHono } from '@hono/zod-openapi'
import type { AppEnv } from './app-env.ts'
import { registerComponents } from './openapi-components.ts'
import { registerMetaRoutes } from './routes/meta.ts'

export const OPENAPI_VERSION = '3.1.0'

/** The document's `info`, `servers` and `tags`. `info.version` is the contract version, not the app's release. */
export const DOCUMENT_CONFIG = {
  openapi: OPENAPI_VERSION,
  info: {
    title: 'Fluss Ctrl API',
    version: '1.0.0',
    description: 'Hardware-agnostic access control for gates, booms and doors: status, trigger, share, revoke and logs. Errors are RFC 9457 problem details whose `code` is the contract (https://docs.flussctrl.com/errors/). Lists are cursor-paginated.',
    contact: { name: 'Fluss Ctrl', url: 'https://docs.flussctrl.com' },
  },
  servers: [{ url: 'https://api.flussctrl.com/v1', description: 'Production' }],
  tags: [{ name: 'Meta', description: 'Service health and metadata.' }],
}

/** Mounts every documented route. The Worker (index.ts) and the generator share this. */
export function registerRoutes (app: OpenAPIHono<AppEnv>): void {
  registerMetaRoutes(app)
}

/** A request that fails its route's Zod schema is `422 validation_failed` (SPEC §7.3). */
export function createOpenApiApp (): OpenAPIHono<AppEnv> {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) {
        const fields = [...new Set(result.error.issues.map((i) => [result.target, ...i.path].join('.')))]
        throw new ApiError('validation_failed', { detail: `Invalid ${fields.join(', ')}` })
      }
    },
  })
}

/** Generates the document from an app's registered routes and components. */
export function openApiDocument (app: OpenAPIHono<AppEnv>): ReturnType<OpenAPIHono<AppEnv>['getOpenAPI31Document']> {
  return app.getOpenAPI31Document(DOCUMENT_CONFIG)
}

/** The document for the routes the Worker serves, without building the Worker. */
export function buildOpenApiDocument (): ReturnType<typeof openApiDocument> {
  const app = createOpenApiApp()
  registerComponents(app)
  registerRoutes(app)
  return openApiDocument(app)
}

/** The committed file's exact text: two-space JSON and a final newline, so regeneration is byte-stable. */
export function serialiseDocument (doc: unknown): string {
  return `${JSON.stringify(doc, null, 2)}\n`
}
