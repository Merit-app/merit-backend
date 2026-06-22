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
  supervisorName: z.string().min(1).max(100).optional(),
  supervisorPhone: z.string().optional().nullable(),
  supervisorEmail: z.string().email().optional().nullable(),
  selfReported: z.boolean().default(false),
  // When true, log the verified session but DON'T text the supervisor yet — it
  // sits as "Not sent yet" until the student sends it (individually or in a batch).
  // Supervisor name + a contact are still required so the deferred send is one tap.
  sendLater: z.boolean().default(false),
  trackerNote: z.string().max(200).optional(),
}).refine((d) => d.orgId || d.newOrg, {
  message: 'Must provide orgId or newOrg',
}).refine((d) => d.selfReported || d.supervisorName, {
  message: 'Must provide supervisor name',
  path: ['supervisorName'],
}).refine((d) => d.selfReported || d.supervisorPhone || d.supervisorEmail, {
  message: 'Must provide supervisorPhone or supervisorEmail',
});

export const updateSessionSchema = z.object({
  activity: z.string().min(1).max(500).optional(),
  supervisorName: z.string().min(1).max(100).optional(),
  supervisorPhone: z.string().optional().nullable(),
  supervisorEmail: z.string().email().optional().nullable(),
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
