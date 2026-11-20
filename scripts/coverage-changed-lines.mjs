#!/usr/bin/env node
// Coverage on changed lines (SPEC §11 item 1): reads an lcov report and the diff against a base
// commit, and prints a Markdown summary of how many added, executable lines the tests run.
// It is a guide, never a gate; the only hard floor is packages/core in vitest.config.ts.
//
// Usage: node scripts/coverage-changed-lines.mjs --lcov coverage/lcov.info --base <sha>
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { isAbsolute, relative } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

export const MARKER = '<!-- coverage-changed-lines -->'

/**
 * Parses lcov text into file -> (line -> hit count). Paths are made relative to `root`.
 * @param {string} text
 * @param {string} root
 * @returns {Map<string, Map<number, number>>}
 */
export function parseLcov (text, root) {
  const files = new Map()
  let current = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('SF:')) {
      const path = line.slice(3)
      const key = toPosix(isAbsolute(path) ? relative(root, path) : path)
      current = files.get(key) ?? new Map()
      files.set(key, current)
    } else if (line.startsWith('DA:') && current) {
      const [lineNo, hits] = line.slice(3).split(',')
      const n = Number(lineNo)
      const h = Number(hits)
      if (Number.isInteger(n) && Number.isFinite(h)) {
        current.set(n, (current.get(n) ?? 0) + h)
      }
    } else if (line === 'end_of_record') {
      current = null
    }
  }
  return files
}

/**
 * Parses a `git diff --unified=0` into file -> set of added line numbers in the new file.
 * Deleted files are skipped; renames are keyed by their new path.
 * @param {string} text
 * @returns {Map<string, Set<number>>}
 */
export function parseDiff (text) {
  const files = new Map()
  let current = null
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4)
      if (target === '/dev/null') {
        current = null
      } else {
        const path = target.startsWith('b/') ? target.slice(2) : target
        current = files.get(path) ?? new Set()
        files.set(path, current)
      }
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (hunk && current) {
      const start = Number(hunk[1])
      const count = hunk[2] === undefined ? 1 : Number(hunk[2])
      for (let i = 0; i < count; i++) current.add(start + i)
    }
  }
  return files
}

/**
 * Joins coverage and diff: for each changed file that coverage instruments, the added lines that
 * are executable, and which of them no test ran.
 * @param {Map<string, Map<number, number>>} coverage
 * @param {Map<string, Set<number>>} diff
 */
export function changedLineCoverage (coverage, diff) {
  const files = []
  for (const [path, added] of diff) {
    const lines = coverage.get(path)
    if (!lines) continue
    const executable = [...added].filter((n) => lines.has(n)).sort((a, b) => a - b)
    if (executable.length === 0) continue
    const uncovered = executable.filter((n) => lines.get(n) === 0)
    files.push({ path, executable: executable.length, covered: executable.length - uncovered.length, uncovered })
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  const executable = files.reduce((sum, f) => sum + f.executable, 0)
  const covered = files.reduce((sum, f) => sum + f.covered, 0)
  return { files, executable, covered }
}

/** Collapses sorted line numbers into ranges: [1, 2, 3, 7] -> "1-3, 7". */
export function formatRanges (lines) {
  const parts = []
  for (let i = 0; i < lines.length; i++) {
    let j = i
    while (j + 1 < lines.length && lines[j + 1] === lines[j] + 1) j++
    parts.push(i === j ? `${lines[i]}` : `${lines[i]}-${lines[j]}`)
    i = j
  }
  return parts.join(', ')
}

const pct = (covered, total) => `${((covered / total) * 100).toFixed(1)}%`

/** Renders the PR comment. */
export function renderMarkdown ({ files, executable, covered }) {
  const out = [MARKER, '### Coverage on changed lines', '']
  if (executable === 0) {
    out.push('No executable lines changed in instrumented source.')
  } else {
    out.push(`**${pct(covered, executable)}** of ${executable} changed executable lines run under test.`, '')
    out.push('| File | Covered | Uncovered lines |', '|---|---|---|')
    for (const f of files) {
      out.push(`| \`${f.path}\` | ${f.covered}/${f.executable} (${pct(f.covered, f.executable)}) | ${formatRanges(f.uncovered) || '—'} |`)
    }
  }
  out.push('', '_A guide, not a gate (SPEC §11). The hard floor on `packages/core` is enforced by `pnpm test:unit`._')
  return out.join('\n') + '\n'
}

const toPosix = (p) => p.split('\\').join('/')

function main () {
  const { values } = parseArgs({ options: { lcov: { type: 'string' }, base: { type: 'string' } } })
  if (!values.lcov || !values.base) {
    console.error('usage: coverage-changed-lines.mjs --lcov <file> --base <commit>')
    process.exit(2)
  }
  const root = process.cwd()
  const coverage = parseLcov(readFileSync(values.lcov, 'utf8'), root)
  const diff = parseDiff(execFileSync('git', ['diff', '--unified=0', '--no-color', '--no-ext-diff', `${values.base}...HEAD`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
  process.stdout.write(renderMarkdown(changedLineCoverage(coverage, diff)))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
