import { describe, expect, it } from 'vitest'
import { ConfigError, loadEnv } from './env.ts'

describe('loadEnv', () => {
  it('parses a valid config and applies defaults', () => {
    expect(loadEnv({ ENVIRONMENT: 'staging' })).toEqual({ ENVIRONMENT: 'staging', LOG_LEVEL: 'info' })
  })

  it('names the bad key without echoing its value', () => {
    const secretLooking = 'sk_live_should_never_be_logged'
    try {
      loadEnv({ ENVIRONMENT: secretLooking })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      expect((err as ConfigError).issues.join(' ')).toContain('ENVIRONMENT')
      expect((err as Error).message).not.toContain(secretLooking)
    }
  })

  it('rejects a missing env', () => {
    expect(() => loadEnv(undefined)).toThrow(ConfigError)
  })

  it('returns the cached result for the same env object', () => {
    const env = { ENVIRONMENT: 'dev' }
    expect(loadEnv(env)).toBe(loadEnv(env))
  })
})
