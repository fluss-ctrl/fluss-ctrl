import { redact } from '@flussctrl/core'

type Level = 'debug' | 'info' | 'warn' | 'error'

/**
 * Writes one structured JSON log line (SPEC §1). Every line carries the request id when there is
 * one, and goes through the redaction helper, so phone numbers and secrets never reach Workers Logs.
 */
export function log (level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify(redact({ level, msg, ...fields }))
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}
