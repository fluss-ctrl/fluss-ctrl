import { afterEach, describe, expect, it, vi } from 'vitest'
import { app } from './index.ts'

const goodEnv = { ENVIRONMENT: 'dev' }

describe('GET /health', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('answers ok on a valid config', async () => {
    const res = await app.request('/health', {}, goodEnv)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('refuses to serve when the config is invalid', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await app.request('/health', {}, { ENVIRONMENT: 'prod' })
    expect(res.status).toBe(500)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('config_invalid'))
  })

  it('refuses to serve when the config is missing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await app.request('/health', {}, {})
    expect(res.status).toBe(500)
  })
})
