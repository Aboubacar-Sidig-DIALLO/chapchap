import type { OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { randomUUID } from 'node:crypto';
import type { Subscription } from 'rxjs';
import type { Server, Socket } from 'socket.io';
import { isReactionEmoji } from '../chat/chat.constants';
import { ChatService } from '../chat/chat.service';
import type { ServerToClientEvents, SocketData } from '../chat/chat.types';
import { CLIENT_ORIGIN } from '../config';
import { ConversationAccessService } from '../social/conversation-access.service';
import { restrictionError } from '../social/group-rights';
import { OngoingCallsService } from '../social/ongoing-calls.service';
import {
  CallService,
  MAX_GROUP_CALL_PARTICIPANTS,
  type CallRoom,
} from './call.service';
import type { CallJoinAck, CallMedia, CallSummary } from './call.types';

/** Sans réponse au bout de ce délai, un appel entre amis cesse de sonner. */
const RING_TIMEOUT_MS = 30_000;

type CallServer = Server<
  Record<string, never>,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
type CallSocket = Socket<
  Record<string, never>,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

function parseMedia(value: unknown): CallMedia {
  const { audio, video } = (value ?? {}) as Record<string, unknown>;
  return { audio: audio === true, video: video === true };
}

/**
 * Signalisation des appels audio / vidéo de chaque conversation. Le son et
 * l'image passent directement d'un navigateur à l'autre (WebRTC) ; le serveur
 * tient la liste des participants et relaie les messages de mise en relation,
 * sans jamais sortir de la conversation.
 *
 * - Entre amis : un appel à deux. Il sonne chez l'autre, qui répond ou refuse
 *   (sinon il s'arrête après {@link RING_TIMEOUT_MS}), et prend fin pour les
 *   deux dès que l'un raccroche.
 * - En groupe : un direct ouvert, que chacun rejoint ou quitte librement ;
 *   le dernier à partir le clôt. Le lancer peut être réservé aux
 *   administrateurs par le propriétaire ; le rejoindre, jamais.
 */
@WebSocketGateway({ cors: { origin: CLIENT_ORIGIN, credentials: true } })
export class CallGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  // `!` : assigné par Nest après la construction (`@WebSocketServer`).
  @WebSocketServer()
  private readonly server!: CallServer;
  /** Appels entre amis qui sonnent, par conversation. */
  private readonly ringTimers = new Map<string, NodeJS.Timeout>();
  private subscription?: Subscription;

  constructor(
    private readonly callService: CallService,
    private readonly chatService: ChatService,
    private readonly ongoingCalls: OngoingCallsService,
    private readonly conversationAccess: ConversationAccessService,
  ) {}

  /** Refus venus de l'accueil (la sonnerie hors de la conversation). */
  afterInit() {
    this.subscription = this.ongoingCalls.declines$.subscribe(
      ({ conversationKey, userId }) => this.decline(conversationKey, userId),
    );
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
    this.ringTimers.forEach((timer) => clearTimeout(timer));
  }

  /** Chacun voit s'il y a un appel en cours dans sa conversation, même sans y être. */
  handleConnection(client: CallSocket) {
    const room = this.callService.find(client.data.conversation.key);
    client.emit('call:participants', room?.list() ?? []);
  }

  handleDisconnect(client: CallSocket) {
    if (client.data.conversation) this.depart(client);
  }

  /** Lance l'appel ou y entre ; la réponse liste les participants à qui se connecter. */
  @SubscribeMessage('call:join')
  async handleJoin(
    @ConnectedSocket() client: CallSocket,
    @MessageBody() media: unknown,
  ): Promise<CallJoinAck> {
    const { user, conversation } = client.data;
    const startError = await this.startError(client);
    if (startError) return { ok: false, error: startError };

    const room = this.callService.room(conversation);
    const error = this.joinError(room, client);
    if (error) {
      this.callService.release(room.key);
      return { ok: false, error };
    }

    const participants = room.join(client.id, user, parseMedia(media));
    this.refresh(room);
    return { ok: true, participants };
  }

  /** Raccroche (entre amis, l'appel prend fin pour les deux) ou quitte le direct. */
  @SubscribeMessage('call:leave')
  handleLeave(@ConnectedSocket() client: CallSocket) {
    this.depart(client);
  }

  /** Refuse l'appel d'un ami qui sonne, depuis la conversation. */
  @SubscribeMessage('call:decline')
  handleDecline(@ConnectedSocket() client: CallSocket) {
    this.decline(client.data.conversation.key, client.data.user.id);
  }

  /** Micro coupé ou rétabli, caméra allumée ou éteinte. */
  @SubscribeMessage('call:media')
  handleMedia(
    @ConnectedSocket() client: CallSocket,
    @MessageBody() media: unknown,
  ) {
    const room = this.callService.find(client.data.conversation.key);
    if (room?.setMedia(client.id, parseMedia(media))) {
      this.broadcastParticipants(room);
    }
  }

  /** Relaie un message WebRTC à un autre participant du même appel (jamais au-delà). */
  @SubscribeMessage('call:signal')
  handleSignal(
    @ConnectedSocket() client: CallSocket,
    @MessageBody() payload: unknown,
  ) {
    const { peerId, data } = (payload ?? {}) as Record<string, unknown>;
    const room = this.callService.find(client.data.conversation.key);
    if (
      !room ||
      typeof peerId !== 'string' ||
      typeof data !== 'object' ||
      data === null ||
      !room.has(client.id) ||
      !room.has(peerId)
    ) {
      return;
    }
    this.server.to(peerId).emit('call:signal', { peerId: client.id, data });
  }

  /** Réaction envoyée pendant l'appel : elle s'envole chez tous les participants. */
  @SubscribeMessage('call:react')
  handleReact(
    @ConnectedSocket() client: CallSocket,
    @MessageBody() emoji: unknown,
  ) {
    const room = this.callService.find(client.data.conversation.key);
    if (!room?.has(client.id) || !isReactionEmoji(emoji)) return;
    const peerIds = room.list().map((item) => item.peerId);
    this.server.to(peerIds).emit('call:reaction', { peerId: client.id, emoji });
  }

  /**
   * Lancer un appel (personne n'y est encore) exige d'en avoir le droit, relu
   * en base ; rejoindre un appel en cours, seulement d'être membre.
   */
  private async startError(client: CallSocket): Promise<string | null> {
    const { user, conversation } = client.data;
    const ongoing = this.callService.find(conversation.key);
    if (ongoing && ongoing.list().length > 0) return null;

    const rights = await this.conversationAccess.rights(user.id, conversation);
    if (!rights) return "Vous n'avez plus accès à cette conversation";
    return restrictionError(rights, ['call']);
  }

  /** Pourquoi cette connexion ne peut pas entrer dans l'appel ; `null` si elle le peut. */
  private joinError(room: CallRoom, client: CallSocket): string | null {
    if (room.has(client.id)) return null;
    // Deux onglets dans le même appel : on s'entendrait en écho.
    if (room.hasUser(client.data.user.id)) {
      return 'Vous êtes déjà dans cet appel depuis un autre onglet ou appareil';
    }
    if (room.isFull()) {
      return room.isDirect
        ? 'Un appel est déjà en cours'
        : `Le direct est complet (${MAX_GROUP_CALL_PARTICIPANTS} personnes)`;
    }
    return null;
  }

  /** Départ (volontaire ou coupure) : entre amis, l'appel prend fin pour les deux. */
  private depart(client: CallSocket) {
    const room = this.callService.find(client.data.conversation.key);
    if (!room?.leave(client.id)) return;
    if (room.isDirect) this.end(room);
    else this.refresh(room);
  }

  /** L'appelé refuse : l'appel s'arrête aussitôt chez l'appelant. */
  private decline(conversationKey: string, userId: string) {
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
    if (remaining.length > 0) this.server.to(remaining).emit('call:ended');
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
    if (summary) this.postSummary(room.key, summary);
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
   * lancé. Éphémère comme tout message : elle disparaît au bout d'une heure.
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
    this.server.to(conversationKey).emit('message:new', message);
  }

  /**
   * Participants à jour pour toute la conversation, et pour l'accueil de ses
   * membres (appel visible sans entrer, sonnerie quand il commence).
   */
  private broadcastParticipants(room: CallRoom) {
    const participants = room.list();
    this.server.to(room.key).emit('call:participants', participants);
    this.ongoingCalls.update(
      room.conversation,
      participants.map((participant) => participant.user),
      room.startedAt(),
    );
  }
}
