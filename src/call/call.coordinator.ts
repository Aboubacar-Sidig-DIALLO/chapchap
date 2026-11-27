import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Subject, type Subscription } from 'rxjs';
import { isReactionEmoji } from '../chat/chat.constants';
import { ChatService } from '../chat/chat.service';
import type { ChatUser } from '../chat/chat.types';
import { OngoingCallsService } from '../social/ongoing-calls.service';
import { CallTransport } from './call-transport';
import {
  CallService,
  MAX_GROUP_CALL_PARTICIPANTS,
  type CallRoom,
} from './call.service';
import type {
  CallJoinAck,
  CallMedia,
  CallParticipant,
  CallSummary,
} from './call.types';

/** Sans réponse au bout de ce délai, un appel entre amis cesse de sonner. */
const RING_TIMEOUT_MS = 30_000;

/** Une connexion qui participe (ou veut participer) à un appel. */
export interface CallPeer {
  /** Identifiant de la connexion : l'adresse de la signalisation WebRTC. */
  peerId: string;
  user: ChatUser;
}

export function parseMedia(value: unknown): CallMedia {
  const { audio, video } = (value ?? {}) as Record<string, unknown>;
  return { audio: audio === true, video: video === true };
}

/**
 * Le déroulement des appels, quel que soit l'endroit d'où l'on s'y connecte
 * (membre de la conversation, ou invité d'un appel de groupe). Le son et
 * l'image passent directement d'un navigateur à l'autre (WebRTC) ; le serveur
 * tient la liste des participants et relaie les messages de mise en relation,
 * sans jamais sortir de l'appel.
 *
 * - Entre amis : un appel à deux. Il sonne chez l'autre, qui répond ou refuse
 *   (sinon il s'arrête après {@link RING_TIMEOUT_MS}), et prend fin pour les
 *   deux dès que l'un raccroche.
 * - En groupe : un direct ouvert, que chaque membre rejoint ou quitte
 *   librement. Les invités n'y restent pas seuls : quand le dernier membre
 *   part, l'appel prend fin pour tous.
 */
@Injectable()
export class CallCoordinator implements OnModuleInit, OnModuleDestroy {
  /** Appels entre amis qui sonnent, par conversation. */
  private readonly ringTimers = new Map<string, NodeJS.Timeout>();
  private subscription?: Subscription;
  /** Un appel vient de prendre fin (clé de sa conversation). */
  readonly ended$ = new Subject<string>();

  constructor(
    private readonly callService: CallService,
    private readonly chatService: ChatService,
    private readonly ongoingCalls: OngoingCallsService,
    private readonly transport: CallTransport,
  ) {}

  /** Refus venus de l'accueil (la sonnerie hors de la conversation). */
  onModuleInit() {
    this.subscription = this.ongoingCalls.declines$.subscribe(
      ({ conversationKey, userId }) => this.decline(conversationKey, userId),
    );
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
    this.ringTimers.forEach((timer) => clearTimeout(timer));
    this.ended$.complete();
  }

  /** Participants de l'appel en cours dans la conversation `key` (aucun s'il n'y en a pas). */
  participants(key: string): CallParticipant[] {
    return this.callService.find(key)?.list() ?? [];
  }

  /** Entre dans l'appel ; la réponse liste les participants à qui se connecter. */
  join(room: CallRoom, peer: CallPeer, media: CallMedia): CallJoinAck {
    const error = joinError(room, peer);
    if (error) {
      this.callService.release(room.key);
      return { ok: false, error };
    }
    const participants = room.join(peer.peerId, peer.user, media);
    this.refresh(room);
    return { ok: true, participants };
  }

  /**
   * Départ (volontaire, coupure ou retrait). Entre amis, l'appel prend fin
   * pour les deux ; en groupe, il prend fin aussi quand il n'y reste que des invités.
   */
  leave(key: string, peerId: string) {
    const room = this.callService.find(key);
    if (!room?.leave(peerId)) return;
    if (room.isDirect || !room.hasMembers()) this.end(room);
    else this.refresh(room);
  }

  /** Micro coupé ou rétabli, caméra allumée ou éteinte. */
  setMedia(key: string, peerId: string, media: CallMedia) {
    const room = this.callService.find(key);
    if (room?.setMedia(peerId, media)) this.broadcastParticipants(room);
  }

  /** Relaie un message WebRTC à un autre participant du même appel (jamais au-delà). */
  signal(key: string, peerId: string, payload: unknown) {
    const { peerId: targetId, data } = (payload ?? {}) as Record<
      string,
      unknown
    >;
    const room = this.callService.find(key);
    if (
      !room ||
      typeof targetId !== 'string' ||
      typeof data !== 'object' ||
      data === null ||
      !room.has(peerId) ||
      !room.has(targetId)
    ) {
      return;
    }
    this.transport.signal(targetId, { peerId, data });
  }

  /** Réaction envoyée pendant l'appel : elle s'envole chez tous les participants. */
  react(key: string, peerId: string, emoji: unknown) {
    const room = this.callService.find(key);
    if (!room?.has(peerId) || !isReactionEmoji(emoji)) return;
    const peerIds = room.list().map((item) => item.peerId);
    this.transport.reaction(peerIds, { peerId, emoji });
  }

  /** L'appelé refuse : l'appel s'arrête aussitôt chez l'appelant. */
  decline(conversationKey: string, userId: string) {
    const room = this.callService.find(conversationKey);
    if (
      !room?.isRinging() ||
      room.hasUser(userId) ||
      !room.conversation.memberIds.includes(userId)
    ) {
      return;
    }
    room.markDeclined();
    this.end(room);
  }

  /** Termine l'appel pour tous ceux qui y sont encore. */
  private end(room: CallRoom) {
    const remaining = room.clear().map((participant) => participant.peerId);
    this.transport.ended(remaining);
    this.refresh(room);
  }

  /**
   * Après chaque changement : sonnerie, participants diffusés, et, si l'appel
   * vient de se vider, sa trace déposée dans la conversation.
   */
  private refresh(room: CallRoom) {
    this.updateRinging(room);
    this.broadcastParticipants(room);

    const summary = room.endIfEmpty();
    this.callService.release(room.key);
    if (summary) {
      this.postSummary(room.key, summary);
      this.ended$.next(room.key);
    }
  }

  /** Arme le délai de sonnerie d'un appel entre amis, ou le désarme dès qu'il n'a plus lieu d'être. */
  private updateRinging(room: CallRoom) {
    const timer = this.ringTimers.get(room.key);
    if (room.isRinging() === (timer !== undefined)) return;

    if (timer) {
      clearTimeout(timer);
      this.ringTimers.delete(room.key);
      return;
    }
    const ringTimer = setTimeout(() => {
      this.ringTimers.delete(room.key);
      if (room.isRinging()) this.end(room);
    }, RING_TIMEOUT_MS);
    ringTimer.unref();
    this.ringTimers.set(room.key, ringTimer);
  }

  /**
   * Dépose la trace de l'appel dans la conversation, au nom de celui qui l'a
   * lancé (toujours un membre). Éphémère comme tout message : elle disparaît
   * au bout d'une heure.
   */
  private postSummary(conversationKey: string, summary: CallSummary) {
    const { message } = this.chatService
      .conversation(conversationKey)
      .addMessage({
        id: randomUUID(),
        author: summary.participants[0],
        content: '',
        attachments: [],
        createdAt: summary.endedAt,
        call: summary,
      });
    this.transport.newMessage(conversationKey, message);
  }

  /**
   * Participants à jour pour tous ceux qui suivent l'appel, et pour l'accueil
   * des membres (appel visible sans entrer, sonnerie quand il commence).
   */
  private broadcastParticipants(room: CallRoom) {
    const participants = room.list();
    this.transport.participants(room.key, participants);
    this.ongoingCalls.update(
      room.conversation,
      participants.map((participant) => participant.user),
      room.startedAt(),
    );
  }
}

/** Pourquoi cette connexion ne peut pas entrer dans l'appel ; `null` si elle le peut. */
function joinError(room: CallRoom, peer: CallPeer): string | null {
  if (room.has(peer.peerId)) return null;
  // Deux onglets dans le même appel : on s'entendrait en écho.
  if (room.hasUser(peer.user.id)) {
    return 'Vous êtes déjà dans cet appel depuis un autre onglet ou appareil';
  }
  if (room.isFull()) {
    return room.isDirect
      ? 'Un appel est déjà en cours'
      : `Le direct est complet (${MAX_GROUP_CALL_PARTICIPANTS} personnes)`;
  }
  return null;
}
