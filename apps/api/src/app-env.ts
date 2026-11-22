// The Hono environment every route and middleware shares. Type-only, so the OpenAPI generator
// (scripts/openapi.ts) can load the routes in Node without the Workers runtime.
import type { Env } from './env.ts'
import type { Platform } from './platform/index.ts'

export type AppEnv = { Bindings: Record<string, unknown>, Variables: { config: Env, platform: Platform, requestId: string } }
