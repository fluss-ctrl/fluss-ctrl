#!/usr/bin/env node
// .claude/hooks/guard.mjs: PreToolUse guard for Fluss Ctrl.
//
// CLAUDE.md says what never to do. This makes the usual ways of doing it fail before they run:
//   - deploys, rollbacks, secrets and other live-infrastructure commands (wrangler, terraform)
//   - deploy, publish and release scripts run through pnpm, npm, turbo, make and friends
//   - pushes to main, force pushes, merging or approving PRs, and skipping the commit hooks
//   - calls to live hosts from curl-like tools and interpreter one-liners
//   - focused or skipped tests (denied) and lint, type or coverage suppressions (sent to a human)
//
// It is a tripwire, not a security boundary. It reads the command text, so a shell variable, an
// alias, a script file or a container can hide a command from it. The real boundaries are that
// this machine holds no production credentials, that GitHub rulesets protect `main`, and that
// tests refuse unmocked network calls. It is registered in .claude/settings.json with
// "onFailure": "block", so if this script crashes the tool call is blocked, not waved through.
//
// Test it:   node --test .claude/hooks/guard.test.mjs
// Try it:    echo '{"tool_name":"Bash","tool_input":{"command":"wrangler deploy"}}' | node .claude/hooks/guard.mjs

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Hosts that no session, test or one-liner may call. Add the vendor API hosts here when the
// unofficial providers are cleared and built (they are in the vendor OpenAPI `servers` blocks).
export const LIVE_HOSTS = ['v1.fluss-api.com', 'api.flussctrl.com']

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])
const WRAPPERS = new Set(['sudo', 'doas', 'command', 'builtin', 'exec', 'env', 'time', 'timeout', 'nohup',
  'nice', 'ionice', 'stdbuf', 'setsid', 'xargs', 'watch', 'caffeinate', 'parallel', 'flock'])
const PACKAGE_MANAGERS = new Set(['pnpm', 'npm', 'yarn', 'bun'])
const PACKAGE_RUNNERS = new Set(['npx', 'pnpx', 'bunx'])
const TASK_RUNNERS = new Set(['turbo', 'nx', 'make', 'just', 'task'])
const NETWORK_TOOLS = new Set(['curl', 'wget', 'http', 'https', 'xh', 'nc', 'ncat', 'telnet', 'fctl'])
const INTERPRETERS = new Set(['node', 'deno', 'bun', 'python', 'python3', 'ruby', 'perl', 'php'])
const GUARDED = new Set(['wrangler', 'terraform', 'tofu', 'git', 'gh', 'eval', ...SHELLS, ...PACKAGE_MANAGERS,
  ...PACKAGE_RUNNERS, ...TASK_RUNNERS, ...NETWORK_TOOLS, ...INTERPRETERS])
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', '--'])
const RELEASE_SCRIPT = /^(?:[\w@/.-]+:)?(?:deploy|publish|release|rollback|promote)(?:[:\-_][\w:-]*)?$/i

const deny = reason => ({ decision: 'deny', reason })
const ask = reason => ({ decision: 'ask', reason })
const isAssignment = word => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)

/** Program name without its path, version or extension: `./node_modules/.bin/wrangler@4` → `wrangler`. */
export function programName (word) {
  const path = word.replace(/\\/g, '/')
  const scoped = word.startsWith('@') && word.includes('/')
  const name = scoped ? word.slice(word.indexOf('/') + 1) : path.slice(path.lastIndexOf('/') + 1)
  return name.replace(/@[^/]*$/, '').replace(/\.(?:exe|cmd|ps1|bat)$/i, '').toLowerCase()
}

// ---------------------------------------------------------------------------------------------
// Shell parsing: just enough to find the programs a command line would run.
// ---------------------------------------------------------------------------------------------

/**
 * Heredoc bodies are data, not commands, so drop them: except when they are fed to a shell
 * (then they are commands) or to an interpreter (then keep the text so live hosts are still seen).
 */
export function stripHeredocs (text) {
  const out = []
  let until = null
  let mode = 'drop'
  let body = []
  let opener = -1
  const close = () => {
    if (mode === 'arg') out[opener] += ` '${body.join('\n').replaceAll("'", '')}'`
    until = null
    body = []
  }
  for (const line of text.split('\n')) {
    if (until !== null) {
      if (line.trim() === until) close()
      else if (mode === 'shell') out.push(line)
      else if (mode === 'arg') body.push(line)
      continue
    }
    const m = line.match(/(?<!<)<<(?!<)-?\s*(['"]?)([A-Za-z_][\w.-]*)\1/)
    if (!m) {
      out.push(line)
      continue
    }
    until = m[2]
    const head = line.slice(0, m.index)
    const tail = line.slice(m.index + m[0].length)
    const prog = programName(head.trim().split(/\s+/).find(w => !isAssignment(w) && w !== 'sudo') ?? '')
    const pipedToShell = /\|\s*(?:sudo\s+)?(?:ba|z|k|da)?sh\b/.test(tail)
    mode = SHELLS.has(prog) || pipedToShell ? 'shell' : INTERPRETERS.has(prog) ? 'arg' : 'drop'
    out.push(`${head} ${tail}`)
    opener = out.length - 1
  }
  if (until !== null) close()
  return out.join('\n')
}

/** Read a parenthesised group starting at `open`. Returns its body and the index after it. */
function readParen (s, open) {
  let depth = 0
  let i = open
  while (i < s.length) {
    const c = s[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === "'") {
      const close = s.indexOf("'", i + 1)
      i = close === -1 ? s.length : close + 1
      continue
    }
    if (c === '(') depth++
    if (c === ')') {
      depth--
      if (depth === 0) return [s.slice(open + 1, i), i + 1]
    }
    i++
  }
  return [s.slice(open + 1), s.length]
}

/** Split a command line into simple commands (arrays of words) plus any $(...) or `...` bodies. */
export function parse (input) {
  const s = stripHeredocs(input)
  const commands = []
  const nested = []
  let words = []
  let word = null // null: no word in progress

  const add = text => {
    word = (word ?? '') + text
  }
  const endWord = () => {
    if (word !== null) words.push(word)
    word = null
  }
  const endCommand = () => {
    endWord()
    if (words.length) commands.push(words)
    words = []
  }
  const startsSubstitution = i => s[i] === '`' || (s[i] === '$' && s[i + 1] === '(')
  // Record the body of a `...` or $(...) starting at i; return the index after it.
  const substitution = i => {
    add('$()')
    if (s[i] === '`') {
      const close = s.indexOf('`', i + 1)
      const end = close === -1 ? s.length : close
      nested.push(s.slice(i + 1, end))
      return end + 1
    }
    const [inner, next] = readParen(s, i + 1)
    nested.push(inner)
    return next
  }

  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === "'") {
      const close = s.indexOf("'", i + 1)
      const end = close === -1 ? s.length : close
      add(s.slice(i + 1, end))
      i = end + 1
    } else if (c === '"') {
      add('')
      i++
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length) {
          add(s[i + 1])
          i += 2
        } else if (startsSubstitution(i)) {
          i = substitution(i) // a double-quoted `...` or $(...) still runs
        } else {
          add(s[i])
          i++
        }
      }
      i++
    } else if (c === '\\') {
      if (s[i + 1] !== '\n') add(s[i + 1] ?? '')
      i += 2
    } else if (startsSubstitution(i)) {
      i = substitution(i)
    } else if (c === '#' && word === null) {
      const newline = s.indexOf('\n', i)
      i = newline === -1 ? s.length : newline
    } else if (c === ' ' || c === '\t') {
      endWord()
      i++
    } else if (c === '\n' || c === ';' || c === '(' || c === ')') {
      endCommand()
      i++
    } else if (c === '&' && (s[i + 1] === '>' || s[i - 1] === '>' || s[i - 1] === '<')) {
      add(c) // part of a redirection such as 2>&1
      i++
    } else if (c === '&' || c === '|') {
      endCommand()
      i += s[i + 1] === c || (c === '|' && s[i + 1] === '&') ? 2 : 1
    } else {
      add(c)
      i++
    }
  }
  endCommand()
  return { commands, nested }
}

// ---------------------------------------------------------------------------------------------
// Rules for commands
// ---------------------------------------------------------------------------------------------

/** Positional arguments: skips flags, and the values of the flags named in `valueFlags`. */
function positionals (args, valueFlags = new Set()) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    if (valueFlags.has(args[i])) i++
    else if (!args[i].startsWith('-')) out.push(args[i])
  }
  return out
}

function currentBranch (cwd) {
  try {
    const options = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], options).trim()
  } catch {
    return null
  }
}

function wrangler (args) {
  const [sub, sub2] = positionals(args, new Set(['-c', '--config', '-e', '--env', '--cwd', '--env-file']))
  if (!sub) return null // --version, --help
  if (['dev', 'types', 'whoami', 'docs', 'complete'].includes(sub)) return null
  if (args.includes('--local')) return null // local Miniflare state only
  if (['versions', 'deployments'].includes(sub) && ['list', 'view', 'status'].includes(sub2)) return null
  return deny(`\`wrangler ${sub}\` touches live Cloudflare resources. Deploys, rollbacks and secrets run ` +
    'from CI after a human approval (CLAUDE.md). Only dev, types and read-only listings run here; for a build ' +
    'check use the package build script. Otherwise stop and ask.')
}

function terraform (args) {
  const [sub] = positionals(args)
  if (!sub || ['fmt', 'validate', 'version'].includes(sub)) return null
  return deny(`\`terraform ${sub}\` runs from CI only (CLAUDE.md). Locally you may run fmt and validate: stop and ask.`)
}

function git (args, ctx) {
  // Global options come before the subcommand.
  let cwd = ctx.cwd
  let i = 0
  while (i < args.length && args[i].startsWith('-')) {
    const value = args[i + 1] ?? ''
    if (args[i] === '-c' && /^core\.hookspath/i.test(value)) {
      return deny('Overriding core.hooksPath skips the commit hooks (CLAUDE.md: never weaken a check).')
    }
    if (args[i] === '-C') cwd = resolve(cwd, value || '.')
    i += ['-c', '-C', '--git-dir', '--work-tree', '--namespace'].includes(args[i]) ? 2 : 1
  }
  const sub = args[i]
  const rest = args.slice(i + 1)
  // A short-flag cluster such as -nm or -fu. `-uno` (untracked files: no) is not one.
  const shortHas = (flag, letter) => /^-(?!u)[A-Za-z]+$/.test(flag) && flag.includes(letter)

  if (sub === 'config' && rest.some(a => /^core\.hookspath/i.test(a))) {
    return deny('Changing core.hooksPath skips the commit hooks (CLAUDE.md: never weaken a check).')
  }
  if (sub === 'commit' && rest.some(a => a === '--no-verify' || shortHas(a, 'n'))) {
    return deny('`git commit --no-verify` skips Lefthook (lint, gitleaks, commitlint). Fix what the hook reports instead.')
  }
  if (sub !== 'push') return null

  if (rest.includes('--no-verify')) {
    return deny('`git push --no-verify` skips the pre-push hooks. Fix what they report instead.')
  }
  if (rest.some(a => ['--force', '--mirror', '--all', '--prune'].includes(a) || shortHas(a, 'f'))) {
    return deny('Force, mirror and all-branch pushes are not allowed. If a rebase needs it, use --force-with-lease on your own feature branch.')
  }
  const [, ...refspecs] = positionals(rest, new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']))
  const toProtected = ref => /^\+?(?:[^:]*:)?(?:refs\/heads\/)?(?:main|master)$/.test(ref)
  if (refspecs.some(toProtected)) {
    return deny('Pushing to main is a human step (CLAUDE.md): push your feature branch, open the PR and stop.')
  }
  // No refspec, HEAD, or one we cannot resolve ($VAR, $(...)): it depends on the current branch.
  const followsCurrentBranch = ref => /^\+?(?:HEAD|@)$/.test(ref) || ref.includes('$')
  if (refspecs.length === 0 || refspecs.some(followsCurrentBranch)) {
    const branch = currentBranch(cwd)
    if (branch === 'main' || branch === 'master') {
      return deny(`You are on ${branch}, and pushing to it is a human step (CLAUDE.md): create a feature branch, push that, open the PR and stop.`)
    }
  }
  return null
}

function gh (args) {
  const [area, action] = positionals(args, new Set(['-R', '--repo']))
  const humanStep = what => deny(`${what} is a human step (CLAUDE.md). Open or update the PR and stop.`)

  if (area === 'pr' && action === 'merge') return humanStep('Merging a PR')
  if (area === 'pr' && action === 'review' && args.some(a => a === '--approve' || a === '-a')) return humanStep('Approving a PR')
  if (area === 'release' && !['list', 'view', 'download'].includes(action)) return humanStep('Creating or changing a release')
  if (area === 'workflow' && ['run', 'enable', 'disable'].includes(action)) return humanStep('Running or toggling a workflow')
  if (['secret', 'variable'].includes(area) && !['list', 'get'].includes(action)) return humanStep('Changing repository secrets or variables')
  if (area === 'ruleset' && !['list', 'view', 'check'].includes(action)) return humanStep('Changing rulesets')
  if (area === 'repo' && ['delete', 'edit', 'rename', 'archive', 'unarchive', 'deploy-key'].includes(action)) return humanStep('Changing repository settings')
  if (area !== 'api') return null

  let method = null
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-X' || args[i] === '--method') method = args[i + 1]
    else if (args[i].startsWith('--method=')) method = args[i].slice('--method='.length)
    else if (/^-X.+/.test(args[i])) method = args[i].slice(2)
  }
  const sendsFields = args.some(a => /^(?:-f|-F|--field|--raw-field|--input)(?:=|$)/.test(a))
  const effective = method ?? (sendsFields ? 'POST' : 'GET') // gh switches to POST when fields are given
  return effective.toUpperCase() === 'GET' ? null : humanStep('A write through `gh api`')
}

function liveHost (words) {
  const text = words.join(' ').toLowerCase()
  const host = LIVE_HOSTS.find(h => text.includes(h))
  if (!host) return null
  return deny(`${host} is a live service. Sessions and tests never call live backends or vendor clouds (CLAUDE.md): ` +
    'use the simulator or recorded fixtures, or stop and ask.')
}

const releaseStep = name => deny(`\`${name}\` looks like a deploy, publish or release step. Those run from CI after a human approval (CLAUDE.md): stop and ask.`)

/** Decide on one simple command. Returns a verdict, or null for no opinion. */
function command (words, ctx, depth) {
  const w = [...words]
  const assignments = []
  while (w.length && (KEYWORDS.has(w[0]) || isAssignment(w[0]))) {
    const first = w.shift()
    if (isAssignment(first)) assignments.push(first)
  }
  if (assignments.some(a => /^(?:LEFTHOOK|HUSKY)=(?:0|false)$/i.test(a))) {
    return deny('Disabling the commit hooks with an environment variable is not allowed (CLAUDE.md: never weaken a check).')
  }
  if (!w.length) return null
  const prog = programName(w[0])
  const args = w.slice(1)

  // Programs that run their arguments: continue from the first guarded program they name.
  const findRuns = prog === 'find' && args.some(a => ['-exec', '-execdir', '-ok'].includes(a))
  if (WRAPPERS.has(prog) || findRuns) {
    const k = args.findIndex(a => GUARDED.has(programName(a)) || isAssignment(a))
    return k === -1 ? null : command(args.slice(k), ctx, depth)
  }
  if (SHELLS.has(prog)) {
    const c = args.findIndex(a => /^-[A-Za-z]*c[A-Za-z]*$/.test(a))
    return c === -1 || args[c + 1] === undefined ? null : check(args[c + 1], ctx, depth + 1)
  }
  if (prog === 'eval') return check(args.join(' '), ctx, depth + 1)

  if (prog === 'wrangler') return wrangler(args)
  if (prog === 'terraform' || prog === 'tofu') return terraform(args)
  if (prog === 'git') return git(args, ctx)
  if (prog === 'gh') return gh(args)

  if (PACKAGE_RUNNERS.has(prog)) {
    const call = args.findIndex(a => a === '-c' || a === '--call')
    if (call !== -1 && args[call + 1] !== undefined) return check(args[call + 1], ctx, depth + 1)
    const k = args.findIndex((a, i) => !a.startsWith('-') && !['-p', '--package'].includes(args[i - 1]))
    return k === -1 ? null : command(args.slice(k), ctx, depth)
  }
  if (PACKAGE_MANAGERS.has(prog)) {
    if (prog === 'bun' && args.some(a => ['-e', '--eval', '-p', '--print'].includes(a))) return liveHost(w)
    const valueFlags = new Set(['--filter', '-F', '-C', '--dir', '--prefix', '--cwd', '--workspace'])
    if (prog === 'npm') valueFlags.add('-w')
    let i = 0
    while (i < args.length && (args[i].startsWith('-') || valueFlags.has(args[i - 1]))) i++
    let rest = args.slice(i)
    if (['exec', 'dlx', 'x'].includes(rest[0])) return command(rest.slice(1), ctx, depth)
    if (['run', 'run-script'].includes(rest[0])) rest = rest.slice(1)
    if (!rest.length) return null
    if (RELEASE_SCRIPT.test(rest[0])) return releaseStep(`${prog} ${rest[0]}`)
    return command(rest, ctx, depth) // `pnpm wrangler deploy` runs the wrangler binary
  }
  if (TASK_RUNNERS.has(prog)) {
    const target = positionals(args).find(a => RELEASE_SCRIPT.test(a))
    return target ? releaseStep(`${prog} ${target}`) : null
  }
  if (NETWORK_TOOLS.has(prog) || INTERPRETERS.has(prog)) return liveHost(w)
  return null
}

/** Decide on a whole command line. `deny` beats `ask`; null means no opinion. */
export function check (text, ctx = { cwd: process.cwd() }, depth = 0) {
  if (depth > 5) return null
  const { commands, nested } = parse(String(text ?? ''))
  const verdicts = [
    ...commands.map(words => command(words, ctx, depth)),
    ...nested.map(inner => check(inner, ctx, depth + 1))
  ].filter(Boolean)
  return verdicts.find(v => v.decision === 'deny') ?? verdicts[0] ?? null
}

// ---------------------------------------------------------------------------------------------
// Rules for edits
// ---------------------------------------------------------------------------------------------

/** Everything an Edit or Write adds: every string in the tool input except paths and removed text. */
function addedText (value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(addedText).join('\n')
  if (!value || typeof value !== 'object') return ''
  return Object.entries(value)
    .filter(([key]) => !['file_path', 'notebook_path', 'old_string'].includes(key))
    .map(([, v]) => addedText(v))
    .join('\n')
}

/** Decide on an Edit or Write to a code file. */
export function checkEdit (toolInput = {}) {
  const file = String(toolInput.file_path ?? toolInput.notebook_path ?? '').replace(/\\/g, '/')
  if (!/\.[cm]?[jt]sx?$/.test(file) || file.includes('/.claude/')) return null
  const text = addedText(toolInput)

  const isTest = /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) || file.includes('/__tests__/')
  const focusedOrSkipped = /\b(?:describe|it|test|suite|bench)(?:\.\w+)*\.(?:only|skip)\b|\b(?:fit|fdescribe|xit|xdescribe|xtest)\s*\(/
  if (isTest && focusedOrSkipped.test(text)) {
    return deny('Focused or skipped tests are not allowed (CLAUDE.md: never weaken a check). Remove .only/.skip; if a test really must be disabled, stop and ask.')
  }
  const suppression = text.match(/eslint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck|(?:istanbul|v8|c8) ignore/)
  if (suppression) {
    return ask(`This edit adds \`${suppression[0]}\`. CLAUDE.md allows a suppression only with a reason and an issue number in the comment: approve it only if both are there.`)
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

async function main () {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  // Malformed input throws: a non-zero exit, which "onFailure": "block" turns into a block.
  const event = JSON.parse(raw)
  const input = event.tool_input ?? {}

  let verdict = null
  if (['Bash', 'PowerShell'].includes(event.tool_name)) {
    verdict = check(input.command, { cwd: event.cwd ?? process.cwd() })
  } else if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(event.tool_name)) {
    verdict = checkEdit(input)
  }
  if (!verdict) return // no opinion: the normal permission flow applies

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: verdict.decision,
      permissionDecisionReason: `[guard] ${verdict.reason}`
    }
  }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
