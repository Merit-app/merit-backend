import { z } from 'zod';

export const confirmMagicLinkSchema = z.object({
  token: z.string().min(1),
  response: z.enum(['YES', 'NO', 'STOP']).optional().default('YES'),
});
