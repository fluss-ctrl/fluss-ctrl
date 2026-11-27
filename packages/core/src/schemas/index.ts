// Request and response schemas: the source of the OpenAPI document (SPEC §4). Each component
// schema names itself with `.meta({ id })`; apps/api registers them and generates openapi.json.
export * from './errors.ts'
export * from './ids.ts'
export * from './meta.ts'
export * from './pagination.ts'
