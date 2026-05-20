import { z } from 'zod';

export const orgSearchSchema = z.object({
  q: z.string().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

export const createOrgSchema = z.object({
  name: z.string().min(1).max(200),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  country: z.string().max(10).default('US'),
  website: z.string().url().optional(),
  ein: z.string().optional(),
});

export type OrgSearchInput = z.infer<typeof orgSearchSchema>;
export type CreateOrgInput = z.infer<typeof createOrgSchema>;
