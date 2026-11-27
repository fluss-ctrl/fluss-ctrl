// Schemas for the meta endpoints (SPEC §4 Meta).
import { z } from 'zod'

export const HealthSchema = z.object({
  status: z.literal('ok'),
}).meta({
  id: 'Health',
  description: 'Shallow liveness: the Worker is up and its configuration is valid. It does not check the database or providers.',
  examples: [{ status: 'ok' }],
})
