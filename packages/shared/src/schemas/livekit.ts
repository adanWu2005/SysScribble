import { z } from 'zod';

export const livekitTokenResponseSchema = z.object({
  token: z.string(),
  url: z.string().url(),
  canPublish: z.boolean(),
  expiresAt: z.string(),
});
export type LivekitTokenResponse = z.infer<typeof livekitTokenResponseSchema>;
