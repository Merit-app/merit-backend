import { z } from 'zod';

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  school: z.string().max(200).optional(),
  grade: z.number().int().min(6).max(12).optional(),
  goalProgram: z.string().min(1).max(50).optional(),
  goalHours: z.number().min(1).max(9999).optional(),
  marketingConsent: z.boolean().optional().default(false),
  parentEmail: z.string().email().optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const requestPasswordResetSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

export const confirmEmailSchema = z.object({
  token: z.string().min(1),
});

export const resendConfirmationSchema = z.object({
  email: z.string().email(),
});

export const parentalConsentSchema = z.object({
  token: z.string().min(1),
  consent: z.boolean(),
  parentName: z.string().min(1).max(100),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
