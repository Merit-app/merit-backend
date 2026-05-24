import { z } from 'zod';

export const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  school: z.string().max(200).optional().nullable(),
  grade: z.number().int().min(6).max(12).optional(),
  graduationYear: z.number().int().min(2020).max(2040).optional(),
  phone: z.string().optional().nullable(),
  goalProgram: z.string().min(1).max(50).optional().nullable(),
  goalHours: z.number().min(1).max(9999).optional().nullable(),
  notifications: z
    .object({
      smsVerification: z.boolean().optional(),
      weeklyProgress: z.boolean().optional(),
      goalMilestones: z.boolean().optional(),
      productUpdates: z.boolean().optional(),
      marketingEmails: z.boolean().optional(),
    })
    .optional(),
  marketingConsent: z.boolean().optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
