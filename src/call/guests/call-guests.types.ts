/** Contrat de l'API des invités d'appel — à garder synchronisé avec le front (`chat-nextjs/src/features/call-guests/types.ts`). */
import type { ChatUser } from '../../chat/chat.types';

/** Lien d'invité créé : à usage unique, valable jusqu'à son utilisation ou la fin de l'appel. */
export interface CreatedGuestLink {
  /** Le lien est `/appel/<token>` sur le front. */
  token: string;
  /** Date ISO 8601 au-delà de laquelle, inutilisé, il ne marche plus. */
  expiresAt: string;
}

/** Ce que voit l'invité avant d'entrer (sans compte). */
export interface GuestLinkPreview {
  group: { name: string; photoUrl: string | null };
  /** Qui l'invite. */
  inviterName: string;
  /** Personnes dans l'appel en ce moment. */
  participantCount: number;
}

/** Lien utilisé : l'identité de l'invité dans l'appel, et son laissez-passer. */
export interface GuestClaim {
  /** Secret à présenter à la connexion (`auth.pass`) ; il ne vaut que pour cet appel. */
  pass: string;
  guest: ChatUser;
  group: { name: string; photoUrl: string | null };
}
