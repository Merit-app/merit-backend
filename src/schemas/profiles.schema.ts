import { z } from 'zod';

export const updateProfileSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must be at most 30 characters')
    .regex(
      /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
      'Only lowercase letters, numbers, and hyphens. Cannot start or end with a hyphen.',
    )
    .optional(),
  bio: z.string().max(200, 'Bio must be 200 characters or less').optional(),
  profilePublic: z.boolean().optional(),
  topBadgeIds: z.array(z.string()).max(3, 'You can feature at most 3 badges').optional(),
});

export const checkUsernameSchema = z.object({
  username: z.string().min(1).max(30),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CheckUsernameInput = z.infer<typeof checkUsernameSchema>;
