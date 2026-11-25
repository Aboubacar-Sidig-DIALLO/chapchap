import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { isReactionEmoji } from '../chat/chat.constants';
import { ChatService } from '../chat/chat.service';
import type { ServerToClientEvents, SocketData } from '../chat/chat.types';
import { CLIENT_ORIGIN } from '../config';
import { OngoingCallsService } from '../social/ongoing-calls.service';
import { CallService, MAX_CALL_PARTICIPANTS } from './call.service';
import type { CallJoinAck, CallMedia, CallSummary } from './call.types';

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
 * Signalisation du direct (appel audio / vidéo) de chaque conversation, avec
 * un ami ou dans un groupe. Le son et l'image passent directement d'un
 * navigateur à l'autre (WebRTC) ; le serveur tient la liste des participants
 * et relaie les messages de mise en relation, sans jamais sortir de la conversation.
 */
@WebSocketGateway({ cors: { origin: CLIENT_ORIGIN, credentials: true } })
export class CallGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server: CallServer;

  constructor(
    private readonly callService: CallService,
    private readonly chatService: ChatService,
    private readonly ongoingCalls: OngoingCallsService,
  ) {}

  /** Chacun voit s'il y a un direct en cours dans sa conversation, même sans y être. */
  handleConnection(client: CallSocket) {
    client.emit('call:participants', this.room(client).list());
  }

  handleDisconnect(client: CallSocket) {
    if (client.data.conversation) this.depart(client);
  }

  /** Rejoint le direct ; la réponse liste les participants à qui se connecter. */
  @SubscribeMessage('call:join')
  handleJoin(
    @ConnectedSocket() client: CallSocket,
    @MessageBody() media: unknown,
  ): CallJoinAck {
    const room = this.room(client);
    if (!room.has(client.id) && room.isFull()) {
      return {
        ok: false,
        error: `Le direct est complet (${MAX_CALL_PARTICIPANTS} personnes)`,
      };
    }

    const participants = room.join(
      client.id,
      client.data.user,
      parseMedia(media),
    );
    this.broadcastParticipants(client);
    return { ok: true, participants };
  }

  @SubscribeMessage('call:leave')
  handleLeave(@ConnectedSocket() client: CallSocket) {
    this.depart(client);
  }

  /** Micro coupé ou rétabli, caméra allumée ou éteinte. */
  @SubscribeMessage('call:media')
  handleMedia(
    @ConnectedSocket() client: CallSocket,
    @MessageBody() media: unknown,
  ) {
    if (this.room(client).setMedia(client.id, parseMedia(media))) {
      this.broadcastParticipants(client);
    }
  }

  /** Relaie un message WebRTC à un autre participant du même direct (jamais au-delà). */
  @SubscribeMessage('call:signal')
  handleSignal(
    @ConnectedSocket() client: CallSocket,
    @MessageBody() payload: unknown,
  ) {
    const { peerId, data } = (payload ?? {}) as Record<string, unknown>;
    const room = this.room(client);
    if (
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

  /** Réaction envoyée pendant le direct : elle s'envole chez tous les participants. */
  @SubscribeMessage('call:react')
  handleReact(
    @ConnectedSocket() client: CallSocket,
    @MessageBody() emoji: unknown,
  ) {
    const room = this.room(client);
    if (!room.has(client.id) || !isReactionEmoji(emoji)) return;
    const peerIds = room.list().map((item) => item.peerId);
    this.server.to(peerIds).emit('call:reaction', { peerId: client.id, emoji });
  }

  /** Le direct de la conversation ouverte par cette connexion. */
  private room(client: CallSocket) {
    return this.callService.room(client.data.conversation.key);
  }

  /** Départ (volontaire ou coupure) : le dernier à partir clôt le direct. */
  private depart(client: CallSocket) {
    const key = client.data.conversation.key;
    const room = this.room(client);
    if (!room.leave(client.id)) return;
    this.broadcastParticipants(client);

    const summary = room.endIfEmpty();
    this.callService.release(key);
    if (summary) this.postSummary(key, summary);
  }

  /**
   * Dépose la trace du direct dans la conversation, au nom de celui qui l'a
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
  private broadcastParticipants(client: CallSocket) {
    const { conversation } = client.data;
    const room = this.callService.room(conversation.key);
    const participants = room.list();
    this.server.to(conversation.key).emit('call:participants', participants);
    this.ongoingCalls.update(
      conversation,
      participants.map((participant) => participant.user),
      room.startedAt(),
    );
  }
}
