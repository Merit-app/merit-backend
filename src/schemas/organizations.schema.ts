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

// Schema for user-facing org creation (any authenticated user)
export const createPublicOrgSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  category: z.string().min(1, 'Category is required').max(50),
  city: z.string().min(2, 'City is required').max(100),
  province: z.string().max(50).optional(),
  country: z.string().default('Canada'),
  websiteUrl: z.string().url().optional().or(z.literal('')),
  description: z.string().max(500).optional(),
  contactEmail: z.string().email().optional().or(z.literal('')),
  contactPhone: z.string().max(20).optional(),
  isRecruiting: z.boolean().default(false),
});

// Schema for org admins updating their org
export const updateOrgSchema = z.object({
  description: z.string().max(500).optional(),
  websiteUrl: z.string().url().optional().or(z.literal('')),
  contactEmail: z.string().email().optional().or(z.literal('')),
  contactPhone: z.string().max(20).optional(),
  isRecruiting: z.boolean().optional(),
});

export type OrgSearchInput = z.infer<typeof orgSearchSchema>;
export type CreateOrgInput = z.infer<typeof createOrgSchema>;
export type CreatePublicOrgInput = z.infer<typeof createPublicOrgSchema>;
export type UpdateOrgInput = z.infer<typeof updateOrgSchema>;
