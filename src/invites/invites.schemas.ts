import { z } from 'zod';
import { idSchema } from '../social/social.schemas';
import { INVITE_TOKEN_PATTERN } from './invites.constants';

/** Validation des entrées de l'API des invitations. */

export const inviteTokenSchema = z
  .string()
  .regex(INVITE_TOKEN_PATTERN, 'Lien d’invitation invalide');

export const createInviteSchema = z.object({
  target: z.discriminatedUnion('type', [
    z.object({ type: z.literal('friend') }),
    z.object({ type: z.literal('group'), groupId: idSchema }),
  ]),
  /** Remplace l'invitation encore valable par une nouvelle (l'ancien lien cesse de marcher). */
  renew: z.boolean().default(false),
});

export type CreateInviteInput = z.infer<typeof createInviteSchema>;
