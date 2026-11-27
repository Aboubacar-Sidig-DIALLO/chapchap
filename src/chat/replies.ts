import type { ChatMessage, ReplyRef } from './chat.types';

/**
 * Réponses et moments d'un vocal : on répond à un message, ou à un passage
 * précis d'un vocal (« à 0:42 »), et l'on peut aussi y réagir (« 🔥 à 0:42 »).
 */

/**
 * Durée du vocal d'un message, s'il en contient un qu'on peut citer. Un vocal
 * à écoute unique n'a pas de moments : sa forme d'onde n'est jamais diffusée.
 */
export function voiceDurationOf(message: ChatMessage): number | null {
  if (message.viewOnce || message.deletedBy) return null;
  const voice = message.attachments.find((item) => item.voice)?.voice;
  return voice ? voice.durationMs : null;
}

/** Vrai si `atMs` désigne un instant de ce vocal (entier, entre 0 et sa durée). */
export function isMomentOf(
  message: ChatMessage,
  atMs: unknown,
): atMs is number {
  const durationMs = voiceDurationOf(message);
  return (
    durationMs !== null &&
    Number.isSafeInteger(atMs) &&
    (atMs as number) >= 0 &&
    (atMs as number) <= durationMs
  );
}

export type ReplyParsing =
  { ok: true; replyTo?: ReplyRef } | { ok: false; error: string };

const INVALID_REPLY = 'Réponse invalide';
const REPLY_GONE = "Le message auquel vous répondez n'est plus disponible";
const INVALID_MOMENT = "Ce moment n'existe pas dans le vocal";

/**
 * Vérifie la référence envoyée par un client : le message cité doit être
 * encore là (ni supprimé, ni trace d'appel) et le moment, s'il y en a un,
 * tomber dans son vocal. Absente (`undefined` ou `null`) : pas de réponse.
 */
export function parseReplyTo(
  raw: unknown,
  find: (messageId: string) => ChatMessage | undefined,
): ReplyParsing {
  if (raw === undefined || raw === null) return { ok: true };
  if (typeof raw !== 'object') return { ok: false, error: INVALID_REPLY };

  const { messageId, atMs } = raw as Record<string, unknown>;
  if (typeof messageId !== 'string') {
    return { ok: false, error: INVALID_REPLY };
  }

  const target = find(messageId);
  if (!target || target.deletedBy || target.call) {
    return { ok: false, error: REPLY_GONE };
  }
  if (atMs === undefined || atMs === null)
    return { ok: true, replyTo: { messageId } };
  if (!isMomentOf(target, atMs)) return { ok: false, error: INVALID_MOMENT };
  return { ok: true, replyTo: { messageId, atMs } };
}
