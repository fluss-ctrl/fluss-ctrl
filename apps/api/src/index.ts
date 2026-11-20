import { Hono } from 'hono'
import { ConfigError, loadEnv, type Env } from './env.ts'

type AppEnv = { Bindings: Record<string, unknown>, Variables: { config: Env } }

export const app = new Hono<AppEnv>()

// Refuse to serve on a bad config (SPEC §1): nothing, not even /health, answers until the
// environment validates. The problem-details error shape arrives with packages/core errors (#4).
app.use('*', async (c, next) => {
  c.set('config', loadEnv(c.env))
  await next()
})

// Shallow liveness check, no auth (SPEC §4 Meta).
app.get('/health', (c) => c.json({ status: 'ok' }))

app.onError((err, c) => {
  if (err instanceof ConfigError) {
    console.error(JSON.stringify({ level: 'error', msg: 'config_invalid', issues: err.issues }))
  } else {
    console.error(JSON.stringify({ level: 'error', msg: 'unhandled_error', name: err.name }))
  }
  return c.text('Internal Server Error', 500)
})

export default app
