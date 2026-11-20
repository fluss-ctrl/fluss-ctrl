import { describe, expect, it } from 'vitest'
import { ApiError, ERROR_CODES, isErrorCode, problemDetails } from './errors.ts'

describe('ERROR_CODES', () => {
  it('uses snake_case codes and error statuses', () => {
    for (const [code, def] of Object.entries(ERROR_CODES)) {
      expect(code).toMatch(/^[a-z]+(_[a-z]+)*$/)
      expect(def.status).toBeGreaterThanOrEqual(400)
      expect(def.status).toBeLessThan(600)
    }
  })

  it('matches the statuses SPEC §1 and §7.3 give', () => {
    expect(ERROR_CODES.grant_invalid.status).toBe(403)
    expect(ERROR_CODES.grant_exhausted.status).toBe(403)
    expect(ERROR_CODES.device_offline.status).toBe(409)
    expect(ERROR_CODES.command_rate_limited.status).toBe(409)
    expect(ERROR_CODES.action_unsupported.status).toBe(422)
    expect(ERROR_CODES.provider_disabled.status).toBe(409)
    expect(ERROR_CODES.provider_unavailable.status).toBe(503)
    expect(ERROR_CODES.idempotency_key_reused.status).toBe(422)
    expect(ERROR_CODES.idempotency_in_progress.status).toBe(409)
    expect(ERROR_CODES.service_unavailable.status).toBe(503)
  })

  it('recognises codes', () => {
    expect(isErrorCode('device_offline')).toBe(true)
    expect(isErrorCode('toString')).toBe(false)
    expect(isErrorCode(1)).toBe(false)
  })
})

describe('problemDetails', () => {
  it('renders RFC 9457 members plus code and request_id', () => {
    expect(problemDetails('device_offline', 'req_1', { detail: 'Controller offline since 12:00' })).toEqual({
      type: 'https://docs.flussctrl.com/errors/device_offline',
      title: 'Device offline',
      status: 409,
      code: 'device_offline',
      detail: 'Controller offline since 12:00',
      request_id: 'req_1',
    })
  })

  it('omits detail when there is none', () => {
    expect(problemDetails('not_found', 'req_1')).not.toHaveProperty('detail')
  })

  it('adds extensions without letting them overwrite standard members', () => {
    const body = problemDetails('grant_invalid', 'req_1', { extensions: { command_id: 'cmd_1', status: 200, code: 'x' } })
    expect(body.command_id).toBe('cmd_1')
    expect(body.status).toBe(403)
    expect(body.code).toBe('grant_invalid')
  })
})

describe('ApiError', () => {
  it('carries the code status and renders its problem', () => {
    const err = new ApiError('grant_exhausted', { detail: 'No uses left', extensions: { command_id: 'cmd_1' } })
    expect(err.status).toBe(403)
    expect(err.message).toBe('No uses left')
    expect(err.toProblem('req_2')).toMatchObject({ code: 'grant_exhausted', detail: 'No uses left', command_id: 'cmd_1', request_id: 'req_2' })
  })

  it('falls back to the title as its message', () => {
    const err = new ApiError('not_found')
    expect(err.message).toBe('Not found')
    expect(err.toProblem('req_3')).not.toHaveProperty('detail')
  })
})
