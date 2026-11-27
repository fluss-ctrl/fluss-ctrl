// Zod schemas for RFC 9457 problem details (SPEC §1, §7.3). The code list comes from the registry
// in ../errors.ts, so adding a code there adds it to the OpenAPI enum too.
import { z } from 'zod'
import { ERROR_CODES, ERROR_DOCS_BASE, type ErrorCode } from '../errors.ts'
import { RequestIdSchema } from './ids.ts'

const codes = Object.keys(ERROR_CODES) as [ErrorCode, ...ErrorCode[]]

export const ErrorCodeSchema = z.enum(codes).meta({
  id: 'ErrorCode',
  description: 'Stable error code. Codes are the API contract and are only ever added; `title` and `detail` wording is not.',
})

/** The body of every error response, served as `application/problem+json`. */
export const ProblemDetailsSchema = z.looseObject({
  type: z.url().meta({ description: `The code's documentation page: \`${ERROR_DOCS_BASE}<code>\`.` }),
  title: z.string().meta({ description: 'Short human-readable summary of the code. Not contract.' }),
  status: z.int().min(400).max(599).meta({ description: 'The HTTP status, repeated.' }),
  code: ErrorCodeSchema,
  detail: z.string().optional().meta({ description: 'What went wrong in this case. Not contract.' }),
  request_id: RequestIdSchema,
}).meta({
  id: 'ProblemDetails',
  description: 'RFC 9457 problem details. Extension members, such as `command_id` on a recorded command rejection (SPEC §7.3), may be present.',
  examples: [{
    type: `${ERROR_DOCS_BASE}not_found`,
    title: 'Not found',
    status: 404,
    code: 'not_found',
    request_id: 'req_01934f6e-7b1a-7c3d-8e9f-0a1b2c3d4e5f',
  }],
})
