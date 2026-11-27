// Schemas for the meta endpoints (SPEC §4 Meta).
import { z } from 'zod'

export const HealthSchema = z.object({
  status: z.literal('ok'),
  version: z.string().min(1).optional().meta({
    description: 'The Cloudflare Worker version id that answered. Absent where the Worker has no version metadata, such as local development. The deploy smoke test uses it to tell a new version from the old one.',
  }),
}).meta({
  id: 'Health',
  description: 'Shallow liveness: the Worker is up and its configuration is valid. It does not check the database or providers.',
  examples: [{ status: 'ok', version: '8a3a1b0e-5f0c-4d8e-9a4b-2f1c3d4e5f60' }],
})
