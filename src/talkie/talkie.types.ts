import type { ChatUser } from '../chat/chat.types';

/** Une prise de parole en direct, identifiée par l'id du vocal qui la suivra. */
export interface TalkEvent {
  id: string;
  user: ChatUser;
}

/** Fin d'une prise de parole ; `cancelled` : l'orateur a annulé son vocal. */
export interface TalkEndedEvent extends TalkEvent {
  cancelled: boolean;
}

/** Morceau de son PCM 16 bits (voir `TALKIE_SAMPLE_RATE`). */
export interface TalkChunkEvent {
  id: string;
  audio: Buffer;
}

/**
 * Réponse à une demande de prise de parole. Refusée, le client enregistre
 * simplement un vocal classique :
 * - `alone` : personne d'autre n'a la conversation ouverte ;
 * - `busy` : quelqu'un parle déjà (`speaker`) ;
 * - `forbidden` : pas le droit d'envoyer de vocal ici (`error`).
 */
export type TalkStartAck =
  | { ok: true; listeners: ChatUser[] }
  | { ok: false; reason: 'alone' }
  | { ok: false; reason: 'busy'; speaker: ChatUser }
  | { ok: false; reason: 'forbidden' | 'invalid'; error: string };
