import { afterEach, describe, expect, it, vi } from 'vitest'
import { log } from './log.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('log', () => {
  it('writes redacted JSON to the console method for its level', () => {
    const out = { error: vi.spyOn(console, 'error').mockImplementation(() => {}), warn: vi.spyOn(console, 'warn').mockImplementation(() => {}), log: vi.spyOn(console, 'log').mockImplementation(() => {}) }
    log('error', 'e', { phone: '+27825551234' })
    log('warn', 'w', { note: 'Bearer abc.def' })
    log('info', 'i')
    log('debug', 'd')
    expect(JSON.parse(String(out.error.mock.calls[0]?.[0]))).toEqual({ level: 'error', msg: 'e', phone: '[REDACTED]' })
    expect(JSON.parse(String(out.warn.mock.calls[0]?.[0]))).toEqual({ level: 'warn', msg: 'w', note: 'Bearer [REDACTED]' })
    expect(out.log).toHaveBeenCalledTimes(2)
  })
})
