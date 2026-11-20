import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { MARKER, changedLineCoverage, formatRanges, parseDiff, parseLcov, renderMarkdown, unquoteGitPath } from './coverage-changed-lines.mjs'

const lcov = `TN:
SF:/repo/packages/core/src/a.ts
DA:1,1
DA:2,0
DA:3,4
DA:5,0
end_of_record
SF:packages/db/src/b.ts
DA:10,2
end_of_record
`

const diff = `diff --git a/packages/core/src/a.ts b/packages/core/src/a.ts
index 1..2 100644
--- a/packages/core/src/a.ts
+++ b/packages/core/src/a.ts
@@ -0,0 +1,3 @@
+one
+two
+three
@@ -9 +4,2 @@
-gone
+four
+five
@@ -20,2 +7,0 @@
-x
-y
diff --git a/old.ts b/old.ts
deleted file mode 100644
--- a/old.ts
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -3 +3 @@
-a
+b
`

describe('parseLcov', () => {
  it('reads hits per line and makes absolute paths relative to the root', () => {
    const files = parseLcov(lcov, '/repo')
    expect([...files.keys()]).toEqual(['packages/core/src/a.ts', 'packages/db/src/b.ts'])
    expect(files.get('packages/core/src/a.ts')).toEqual(new Map([[1, 1], [2, 0], [3, 4], [5, 0]]))
  })
})

describe('parseDiff', () => {
  it('collects added lines in the new file and skips deleted files', () => {
    const files = parseDiff(diff)
    expect(files.get('packages/core/src/a.ts')).toEqual(new Set([1, 2, 3, 4, 5]))
    expect(files.get('README.md')).toEqual(new Set([3]))
    expect(files.has('old.ts')).toBe(false)
  })

  it('recovers exactly the added lines of any set of hunks', () => {
    // Property: write hunks for random disjoint added ranges, parse them back.
    const ranges = fc.uniqueArray(fc.integer({ min: 1, max: 5000 }), { maxLength: 200 })
    fc.assert(fc.property(ranges, (lines) => {
      const sorted = [...lines].sort((a, b) => a - b)
      const hunks = []
      for (let i = 0; i < sorted.length; i++) {
        let j = i
        while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
        const count = j - i + 1
        hunks.push(`@@ -1,0 +${sorted[i]}${count === 1 ? '' : `,${count}`} @@`, ...Array(count).fill('+x'))
        i = j
      }
      const text = ['--- a/f.ts', '+++ b/f.ts', ...hunks].join('\n')
      expect(parseDiff(text).get('f.ts')).toEqual(new Set(sorted))
    }))
  })
})

describe('unquoteGitPath', () => {
  it('decodes octal-escaped UTF-8 and C escapes, and leaves plain paths alone', () => {
    expect(unquoteGitPath('"b/packages/core/src/caf\\303\\251.ts"')).toBe('b/packages/core/src/café.ts')
    expect(unquoteGitPath('"b/a\\tb\\"c\\\\d.ts"')).toBe('b/a\tb"c\\d.ts')
    expect(unquoteGitPath('b/plain.ts')).toBe('b/plain.ts')
    expect(unquoteGitPath('"b/packages/core/src/😀\\"a.ts"')).toBe('b/packages/core/src/😀"a.ts')
  })

  it('joins a quoted non-ASCII diff path with its lcov entry', () => {
    const quoted = ['--- "a/packages/core/src/caf\\303\\251.ts"', '+++ "b/packages/core/src/caf\\303\\251.ts"', '@@ -0,0 +1,2 @@', '+a', '+b'].join('\n')
    const coverage = parseLcov('SF:packages/core/src/café.ts\nDA:1,1\nDA:2,0\nend_of_record\n', '/repo')
    expect(changedLineCoverage(coverage, parseDiff(quoted)).files).toEqual([
      { path: 'packages/core/src/café.ts', executable: 2, covered: 1, uncovered: [2] },
    ])
  })
})

describe('changedLineCoverage', () => {
  it('counts only changed lines that coverage instruments', () => {
    const result = changedLineCoverage(parseLcov(lcov, '/repo'), parseDiff(diff))
    expect(result).toEqual({
      files: [{ path: 'packages/core/src/a.ts', executable: 4, covered: 2, uncovered: [2, 5] }],
      executable: 4,
      covered: 2,
    })
  })
})

describe('formatRanges', () => {
  it('collapses runs', () => {
    expect(formatRanges([1, 2, 3, 7, 9, 10])).toBe('1-3, 7, 9-10')
    expect(formatRanges([])).toBe('')
  })

  it('names every line exactly once', () => {
    fc.assert(fc.property(fc.uniqueArray(fc.nat({ max: 1000 })), (lines) => {
      const sorted = [...lines].sort((a, b) => a - b)
      const expanded = formatRanges(sorted).split(', ').filter(Boolean).flatMap((part) => {
        const [from, to = from] = part.split('-').map(Number)
        return Array.from({ length: to - from + 1 }, (_, k) => from + k)
      })
      expect(expanded).toEqual(sorted)
    }))
  })
})

describe('renderMarkdown', () => {
  it('starts with the marker the workflow uses to update its comment', () => {
    const md = renderMarkdown({ files: [{ path: 'a.ts', executable: 4, covered: 2, uncovered: [2, 5] }], executable: 4, covered: 2 })
    expect(md.startsWith(MARKER)).toBe(true)
    expect(md).toContain('**50.0%** of 4')
    expect(md).toContain('| `a.ts` | 2/4 (50.0%) | 2, 5 |')
  })

  it('says so when no executable line changed', () => {
    expect(renderMarkdown({ files: [], executable: 0, covered: 0 })).toContain('No executable lines changed')
  })
})
