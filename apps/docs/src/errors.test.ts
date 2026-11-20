import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ERROR_CODES } from '@flussctrl/core'
import { describe, expect, it } from 'vitest'

// Every stable error code has a docs page, and every page is for a real code (CLAUDE.md
// "API contract"). The problem `type` URL points at these pages.
const dir = fileURLToPath(new URL('./content/docs/errors/', import.meta.url))
const pages = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'index.md').map((f) => f.slice(0, -3))

describe('error pages', () => {
  it('exist for every error code', () => {
    expect(pages.sort()).toEqual(Object.keys(ERROR_CODES).sort())
  })

  it.each(Object.entries(ERROR_CODES))('%s states its HTTP status', (code, def) => {
    const text = readFileSync(`${dir}${code}.md`, 'utf8')
    expect(text).toMatch(new RegExp(`^title: ${code}$`, 'm'))
    expect(text).toContain(`**HTTP status:** ${def.status}`)
  })
})
