import { z } from 'zod';

export const createSessionSchema = z.object({
  orgId: z.string().uuid().optional().nullable(),
  newOrg: z
    .object({
      name: z.string().min(1).max(200),
      city: z.string().max(100).optional(),
      state: z.string().max(100).optional(),
      website: z.string().url().optional(),
    })
    .optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  hours: z.number().min(0.5).max(12),
  activity: z.string().min(1).max(500),
  supervisorName: z.string().min(1).max(100),
  supervisorPhone: z.string().optional(),
  supervisorEmail: z.string().email().optional(),
}).refine((d) => d.orgId || d.newOrg, {
  message: 'Must provide orgId or newOrg',
}).refine((d) => d.supervisorPhone || d.supervisorEmail, {
  message: 'Must provide supervisorPhone or supervisorEmail',
});

export const updateSessionSchema = z.object({
  activity: z.string().min(1).max(500).optional(),
  supervisorName: z.string().min(1).max(100).optional(),
  supervisorPhone: z.string().optional(),
  supervisorEmail: z.string().email().optional(),
});

export const sessionQuerySchema = z.object({
  status: z.enum(['pending', 'verified', 'disputed', 'expired']).optional(),
  verificationTier: z
    .enum(['unverified', 'verified_basic', 'verified_institutional'])
    .optional(),
  orgId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
