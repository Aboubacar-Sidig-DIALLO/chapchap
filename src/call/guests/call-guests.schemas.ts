import { z } from 'zod';
import { idSchema } from '../../social/social.schemas';
import {
  GUEST_NAME_MAX_LENGTH,
  GUEST_TOKEN_PATTERN,
} from './call-guests.constants';

/** Validation des entrées de l'API des invités d'appel. */

export const guestTokenSchema = z
  .string()
  .regex(GUEST_TOKEN_PATTERN, 'Lien d’invitation invalide');

export const createGuestLinkSchema = z.object({ groupId: idSchema });
export type CreateGuestLinkInput = z.infer<typeof createGuestLinkSchema>;

/**
 * Nom affiché de l'invité : caractères invisibles ou de contrôle retirés,
 * espaces superflus réduits.
 */
const guestNameSchema = z
  .string({ error: 'Indiquez votre nom' })
  .transform((name) =>
    name
      .replace(/[\p{C}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim(),
  )
  .pipe(
    z
      .string()
      .min(1, 'Indiquez votre nom')
      .max(GUEST_NAME_MAX_LENGTH, 'Nom trop long'),
  );

export const claimGuestLinkSchema = z.object({ name: guestNameSchema });
export type ClaimGuestLinkInput = z.infer<typeof claimGuestLinkSchema>;
