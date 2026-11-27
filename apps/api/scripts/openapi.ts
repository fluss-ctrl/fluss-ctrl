// `pnpm openapi`: regenerates apps/api/openapi.json from the route definitions (SPEC §11 item 2).
// Commit the result. `--check` writes nothing and exits 1 if the committed file is out of date.
// Runs on Node's built-in TypeScript type stripping: the routes and components it loads must not
// import the Workers runtime (cloudflare:*), which is why they live outside src/platform.
import { readFile, writeFile } from 'node:fs/promises'
import { buildOpenApiDocument, serialiseDocument } from '../src/openapi.ts'

const target = new URL('../openapi.json', import.meta.url)
const next = serialiseDocument(buildOpenApiDocument())

if (process.argv.includes('--check')) {
  const current = await readFile(target, 'utf8').catch(() => '')
  if (current !== next) {
    console.error('apps/api/openapi.json is out of date. Run `pnpm openapi` and commit the result.')
    process.exit(1)
  }
  console.log('apps/api/openapi.json is up to date.')
} else {
  await writeFile(target, next)
  console.log('Wrote apps/api/openapi.json.')
}
