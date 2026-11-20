// Run with: node --test .claude/hooks/guard.test.mjs
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { check, checkEdit } from './guard.mjs'

const here = dirname(fileURLToPath(import.meta.url))

function repoOn (branch) {
  const dir = mkdtempSync(join(tmpdir(), 'guard-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', branch)
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
  return dir
}
const onMain = { cwd: repoOn('main') }
const onFeature = { cwd: repoOn('feat/12-grants') }
const decision = (cmd, ctx = onFeature) => check(cmd, ctx)?.decision ?? 'none'

test('deploys, infrastructure and releases are denied', () => {
  for (const cmd of [
    'wrangler deploy',
    'pnpm wrangler deploy --env production',
    'pnpm --filter api exec wrangler deploy',
    'npx wrangler@4 deploy',
    './node_modules/.bin/wrangler versions deploy',
    'cd apps/api && wrangler secret put SIGNING_KEY',
    'bash -c "wrangler deploy"',
    "sh -lc 'cd apps/api; wrangler rollback'",
    'timeout -s KILL 30 wrangler deploy',
    'env CLOUDFLARE_ENV=production wrangler deploy',
    'echo $(wrangler deploy)',
    'wrangler kv key put --binding KV a b',
    'wrangler deploy --dry-run --outdir dist',
    'wrangler hyperdrive update abc --caching-disabled false',
    'terraform apply -auto-approve',
    'terraform -chdir=infra/terraform plan',
    'pnpm run deploy',
    'pnpm deploy:staging',
    'pnpm release-please',
    'npm publish',
    'turbo run deploy --filter=api',
    'make deploy',
    'bash <<EOF\nwrangler deploy\nEOF',
    'if git diff --quiet; then wrangler deploy; fi',
    '(cd apps/api && sudo wrangler deploy)',
    'pnpm -r exec -- wrangler deploy',
    'npx --yes wrangler pages deploy dist',
    'nx run api:deploy',
    'find . -name wrangler.toml -exec wrangler deploy \\;',
    'cat <<< "notes"\nwrangler deploy'
  ]) assert.equal(decision(cmd), 'deny', cmd)
})

test('local wrangler and terraform work is left alone', () => {
  for (const cmd of [
    'wrangler dev',
    'pnpm wrangler dev --port 8787',
    'wrangler types',
    'wrangler --version',
    'wrangler d1 execute db --local --command "select 1"',
    'wrangler versions list',
    'command -v wrangler',
    'terraform fmt -check',
    'terraform validate'
  ]) assert.equal(decision(cmd), 'none', cmd)
})

test('everyday commands are left alone', () => {
  for (const cmd of [
    'pnpm install',
    'pnpm add zod',
    'pnpm dev',
    'pnpm test',
    'pnpm test:unit',
    'pnpm --filter core test -- grants.test.ts -t "expiry"',
    'pnpm lint && pnpm typecheck',
    'pnpm db:generate',
    'echo "wrangler deploy"',
    'grep -rn "gh pr merge" docs/',
    'rg "v1.fluss-api.com" packages/',
    "cat <<'EOF' > NOTES.md\nwrangler deploy\ngit push origin main\nEOF",
    'curl https://registry.npmjs.org/zod',
    'curl -s http://localhost:8787/v1/health 2>&1 | head -5',
    'find . -name "*.ts" -newer package.json',
    'pnpm test -- deploy.test.ts',
    'turbo run test -- release.test.ts',
    'nohup pnpm dev &',
    'timeout 120 pnpm test:integration',
    'pnpm test -- --reporter=verbose 2>&1 | tee out.log'
  ]) assert.equal(decision(cmd), 'none', cmd)
})

test('pushes to main, force pushes and skipped hooks are denied', () => {
  for (const cmd of [
    'git push origin main',
    'git push -u origin HEAD:main',
    'git push origin :main',
    'git push origin --delete main',
    'git -C . push origin refs/heads/main',
    'git push --force origin feat/12-grants',
    'git push -f',
    'git push --no-verify origin feat/12-grants',
    'git commit --no-verify -m "wip"',
    'git commit -nm "wip"',
    'LEFTHOOK=0 git commit -m "wip"',
    'git -c core.hooksPath=/dev/null commit -m "wip"',
    'git config core.hooksPath .nohooks',
    'git commit -m "wip" -n',
    'git push upstream master',
    'git push origin HEAD:refs/heads/main',
    'for b in main next; do git push --force origin $b; done'
  ]) assert.equal(decision(cmd), 'deny', cmd)
  assert.equal(decision('git push -u origin "$(git branch --show-current)"', onMain), 'deny')
  for (const cmd of ['git push', 'git push origin', 'git push -u origin HEAD']) {
    assert.equal(decision(cmd, onMain), 'deny', `${cmd} (on main)`)
  }
})

test('heredocs are data unless a shell reads them', () => {
  const commit = `git commit -m "$(cat <<'EOF'
feat(api): grants (#12)

Don't run wrangler deploy here :)
wrangler deploy
git push origin main
EOF
)"`
  const prBody = `gh pr create --title "feat: grants" --body "$(cat <<'EOF'
- gh pr merge is a human step
- 1) first  2) second
EOF
)"`
  assert.equal(decision(commit), 'none')
  assert.equal(decision(prBody), 'none')
  assert.equal(decision('cat > docs/runbooks/deploy.md <<EOF\nRun: wrangler deploy\nEOF'), 'none')
  assert.equal(decision("cat > notes.md <<'EOF'\nnotes\nEOF\nwrangler deploy"), 'deny')
  assert.equal(decision("cat <<'EOF' | bash\nwrangler deploy\nEOF"), 'deny')
  assert.equal(decision('cat <<EOF | wrangler deploy\nx\nEOF'), 'deny')
  // a double-quoted backtick really is a command substitution
  assert.equal(decision('git commit -m "docs: why `wrangler deploy` is CI-only"'), 'deny')
  assert.equal(decision("git commit -m 'docs: why `wrangler deploy` is CI-only'"), 'none')
})

test('normal git work is left alone', () => {
  for (const cmd of [
    'git push',
    'git push -u origin HEAD',
    'git push -u origin feat/12-grants',
    'git push --force-with-lease origin feat/12-grants',
    'git push origin feature/main',
    'git commit -m "fix(api): reject stale grants (#123)"',
    'git commit -am "docs: gh pr merge is a human step; wrangler deploy runs in CI"',
    'git status && git diff --stat',
    'git rebase origin/main',
    'git push -u origin "$(git branch --show-current)"',
    'git push origin main:feat/12-grants',
    'git push origin v1.2.3',
    'git commit -uno -m "feat: add -n flag"',
    'git push origin feat/12-grants && gh pr create --fill'
  ]) assert.equal(decision(cmd), 'none', cmd)
})

test('merging, approving and repository changes through gh are denied', () => {
  for (const cmd of [
    'gh pr merge 12 --squash --admin',
    'gh pr review 12 --approve',
    'gh release create v1.0.0',
    'gh workflow run deploy.yml',
    'gh secret set CLOUDFLARE_API_TOKEN',
    'gh api -X PUT repos/o/r/pulls/12/merge',
    'gh api repos/o/r/issues -f title=x',
    'gh ruleset delete 3'
  ]) assert.equal(decision(cmd), 'deny', cmd)
  for (const cmd of [
    'gh pr create --fill',
    'gh pr view 12 --json state',
    'gh pr checks',
    'gh pr review 12 --comment -b "note"',
    'gh api repos/o/r/pulls/12',
    'gh release list',
    'gh run rerun 123'
  ]) assert.equal(decision(cmd), 'none', cmd)
})

test('live hosts are denied to network tools and one-liners', () => {
  for (const cmd of [
    'curl https://v1.fluss-api.com/v1/list',
    'curl -H "authorization: Bearer x" https://api.flussctrl.com/v1/devices',
    'pnpm exec curl https://v1.fluss-api.com/v1/list',
    'node -e "fetch(\'https://v1.fluss-api.com/v1/status/1\')"',
    "node <<'EOF'\nfetch('https://v1.fluss-api.com/v1/list')\nEOF",
    'node scripts/smoke.mjs --base https://api.flussctrl.com'
  ]) assert.equal(decision(cmd), 'deny', cmd)
  assert.equal(decision('curl -fsSL https://docs.flussctrl.com/llms.txt'), 'none')
})

test('focused or skipped tests are denied; suppressions go to a human', () => {
  const write = (file, content) => checkEdit({ file_path: file, content })?.decision ?? 'none'
  const edit = (file, newString) => checkEdit({ file_path: file, old_string: 'x', new_string: newString })?.decision ?? 'none'
  assert.equal(write('/repo/packages/core/src/grants.test.ts', "it.only('expires', () => {})"), 'deny')
  assert.equal(edit('/repo/packages/core/src/grants.test.ts', "describe.skip('schedules', () => {})"), 'deny')
  assert.equal(edit('/repo/packages/core/src/grants.test.ts', "test.concurrent.only('x', () => {})"), 'deny')
  assert.equal(edit('/repo/packages/core/src/grants.test.ts', "it.skipIf(!hasDocker)('uses postgres', () => {})"), 'none')
  assert.equal(edit('/repo/packages/core/src/grants.ts', '// eslint-disable-next-line no-console'), 'ask')
  assert.equal(edit('/repo/packages/core/src/grants.ts', '// @ts-expect-error vendor types are wrong (#41)'), 'ask')
  assert.equal(edit('/repo/packages/core/src/grants.ts', 'export const x = 1'), 'none')
  assert.equal(edit('/repo/CLAUDE.md', 'no `eslint-disable` without a reason'), 'none')
  assert.equal(edit('/repo/.claude/hooks/guard.mjs', 'eslint-disable'), 'none')
  assert.equal(edit('/repo/x.ts', 'a'), 'none')
  // old_string is what is being removed, so it never counts
  assert.equal(checkEdit({ file_path: '/repo/a.test.ts', old_string: 'it.only(', new_string: 'it(' }), null)
})

test('the script speaks the hook protocol', () => {
  const run = input => spawnSync('node', [join(here, 'guard.mjs')], { input, encoding: 'utf8' })
  const denied = run(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: onFeature.cwd, tool_input: { command: 'wrangler deploy' } }))
  assert.equal(denied.status, 0)
  const out = JSON.parse(denied.stdout).hookSpecificOutput
  assert.equal(out.hookEventName, 'PreToolUse')
  assert.equal(out.permissionDecision, 'deny')
  assert.match(out.permissionDecisionReason, /CI/)

  const allowed = run(JSON.stringify({ tool_name: 'Bash', cwd: onFeature.cwd, tool_input: { command: 'pnpm test:unit' } }))
  assert.equal(allowed.status, 0)
  assert.equal(allowed.stdout, '')

  const other = run(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/repo/README.md' } }))
  assert.equal(other.status, 0)
  assert.equal(other.stdout, '')

  // Malformed input must fail (non-zero), so that "onFailure": "block" blocks the call.
  assert.notEqual(run('not json').status, 0)
})
