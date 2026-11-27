import type { ViewOnceKind } from '../chat/chat.types';

/**
 * Notification envoyée au navigateur, chiffrée de bout en bout jusqu'à lui.
 * Jamais le contenu d'un message : seulement qui, où, et quel genre.
 * À garder synchronisé avec le service worker (`chat-nextjs/public/sw.js`).
 */
export interface PushNotification {
  /** Regroupe les notifications : une seule par conversation, par appel… */
  tag: string;
  kind: 'message' | 'call' | 'social';
  title: string;
  body: string;
  /** Page à ouvrir au toucher (relative au front). */
  url: string;
  /** Date ISO 8601 de l'événement. */
  createdAt: string;
}

/** Ce que contient un message, pour l'annoncer sans en dévoiler le contenu. */
export type MessagePreview =
  | { type: 'text' }
  | { type: 'voice'; durationMs: number }
  | { type: 'photo'; count: number }
  | { type: 'file'; count: number }
  /** Vue unique : son genre seulement (le premier, s'il y en a plusieurs). */
  | { type: 'view-once'; kind: ViewOnceKind };

export interface PushDelivery {
  /** Délai (s) au-delà duquel le service push abandonne la livraison. */
  ttl: number;
  /** `high` : réveille l'appareil tout de suite (appel). */
  urgency: 'normal' | 'high';
}
