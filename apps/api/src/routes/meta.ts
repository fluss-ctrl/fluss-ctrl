// Meta endpoints (SPEC §4 Meta). Phase 0 has the shallow health check only; `/health/deep` and
// `/providers` arrive with the work that gives them something to report.
import { HealthSchema } from '@flussctrl/core'
import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import type { AppEnv } from '../app-env.ts'
import { problemResponseRef, requestIdHeader } from '../openapi-components.ts'

export const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  operationId: 'getHealth',
  tags: ['Meta'],
  summary: 'Liveness check',
  description: 'Shallow liveness check. Needs no authentication. Answers `200` once the Worker is up with a valid configuration; on a bad configuration nothing is served, this included, and the answer is `500 internal_error`.',
  security: [],
  responses: {
    200: {
      description: 'The Worker is up and its configuration is valid.',
      headers: requestIdHeader,
      content: { 'application/json': { schema: HealthSchema } },
    },
    500: problemResponseRef('internal_error'),
  },
})

export function registerMetaRoutes (app: OpenAPIHono<AppEnv>): void {
  app.openapi(healthRoute, (c) => c.json({ status: 'ok' as const }, 200))
}
