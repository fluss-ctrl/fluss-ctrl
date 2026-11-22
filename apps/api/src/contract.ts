// Contract checks against the committed openapi.json (SPEC §11 item 2). Tests send a request to the
// app and pass the response here with the operation it should satisfy; this checks the status is
// documented, the media type matches, required headers are present and valid, and the body
// validates against the documented schema. It reads the committed file, not the Zod schemas, so a
// route whose behaviour drifts from what was published fails even if the generator agrees with it.
// @cfworker/json-schema is used because it validates without code generation (no eval), which
// workerd forbids.
import { Validator, type Schema } from '@cfworker/json-schema'
import committed from '../openapi.json'

export type OpenApiDocument = typeof committed & Record<string, unknown>

type Json = Record<string, unknown>

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const
export type Method = typeof METHODS[number]

function escapePointer (segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1')
}

function resolve (doc: Json, value: unknown): { node: Json, pointer: string } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const ref = (value as Json)['$ref']
  if (typeof ref !== 'string') return undefined
  if (!ref.startsWith('#/')) throw new Error(`Only local $refs are supported: ${ref}`)
  let node: unknown = doc
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replaceAll('~1', '/').replaceAll('~0', '~')
    node = (node as Json | undefined)?.[key]
  }
  if (typeof node !== 'object' || node === null) throw new Error(`Unresolvable $ref: ${ref}`)
  return { node: node as Json, pointer: ref.slice(1) }
}

/** Follows `$ref`s to the object they name, keeping the JSON pointer of where it ended up. */
function deref (doc: Json, value: Json, pointer: string): { node: Json, pointer: string } {
  let current = { node: value, pointer }
  for (let i = 0; i < 16; i++) {
    const next = resolve(doc, current.node)
    if (next === undefined) return current
    current = next
  }
  throw new Error(`$ref chain too deep at ${pointer}`)
}

/** The operations the document lists, as `METHOD path` strings. */
export function documentedOperations (doc: OpenApiDocument = committed): string[] {
  const out: string[] = []
  for (const [path, item] of Object.entries(doc.paths as Json)) {
    for (const method of METHODS) {
      if ((item as Json)[method] !== undefined) out.push(`${method.toUpperCase()} ${path}`)
    }
  }
  return out.sort()
}

function validate (doc: Json, schemaPointer: string, value: unknown): string[] {
  // The whole document is the root schema, so local $refs to components resolve; the root's own
  // OpenAPI members are not JSON Schema keywords and are ignored.
  const validator = new Validator({ ...doc, $ref: `#${schemaPointer}` } as unknown as Schema, '2020-12', false)
  const result = validator.validate(value)
  return result.valid ? [] : result.errors.map((e) => `${e.instanceLocation}: ${e.error}`)
}

function headerValue (schema: Json | undefined, raw: string): unknown {
  const type = schema?.['type']
  if ((type === 'integer' || type === 'number') && raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw)
  return raw
}

/**
 * Returns the ways `res` breaks the documented contract for `method path` (the path as written in
 * the document, such as `/devices/{id}`), or an empty array. Consumes the body.
 */
export async function contractViolations (res: Response, method: Method, path: string, doc: OpenApiDocument = committed): Promise<string[]> {
  const root = doc as Json
  const where = `${method.toUpperCase()} ${path}`
  const base = `/paths/${escapePointer(path)}/${method}`
  const operation = ((doc.paths as Json)[path] as Json | undefined)?.[method] as Json | undefined
  if (operation === undefined) return [`${where} is not in openapi.json`]

  const responses = operation['responses'] as Json
  const status = String(res.status)
  const key = status in responses ? status : 'default' in responses ? 'default' : undefined
  if (key === undefined) return [`${where} does not document status ${status}`]
  const response = deref(root, responses[key] as Json, `${base}/responses/${escapePointer(key)}`)

  const problems: string[] = []

  for (const [name, declared] of Object.entries((response.node['headers'] ?? {}) as Json)) {
    const header = deref(root, declared as Json, `${response.pointer}/headers/${escapePointer(name)}`)
    const raw = res.headers.get(name)
    if (raw === null) {
      if (header.node['required'] === true) problems.push(`${where} ${status}: missing required header ${name}`)
      continue
    }
    if (header.node['schema'] !== undefined) {
      const schema = deref(root, header.node['schema'] as Json, `${header.pointer}/schema`)
      for (const e of validate(root, schema.pointer, headerValue(schema.node, raw))) problems.push(`${where} ${status}: header ${name} ${e}`)
    }
  }

  const content = response.node['content'] as Json | undefined
  const body = await res.text()
  if (content === undefined) {
    if (body !== '') problems.push(`${where} ${status}: documents no body but got one`)
    return problems
  }

  const mediaType = (res.headers.get('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (!(mediaType in content)) {
    problems.push(`${where} ${status}: media type ${mediaType || '(none)'} is not one of ${Object.keys(content).join(', ')}`)
    return problems
  }
  const media = content[mediaType] as Json
  if (media['schema'] === undefined) return problems

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    problems.push(`${where} ${status}: body is not JSON`)
    return problems
  }
  const schemaPointer = `${response.pointer}/content/${escapePointer(mediaType)}/schema`
  for (const e of validate(root, schemaPointer, parsed)) problems.push(`${where} ${status}: body ${e}`)
  return problems
}
