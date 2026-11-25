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
 * Signalisation du direct (appel audio / vidéo) du salon. Le son et l'image
 * passent directement d'un navigateur à l'autre (WebRTC) ; le serveur tient la
 * liste des participants et relaie les messages de mise en relation.
 */
@WebSocketGateway({ cors: { origin: CLIENT_ORIGIN } })
export class CallGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server: CallServer;

  constructor(
    private readonly callService: CallService,
    private readonly chatService: ChatService,
  ) {}

  /** Chacun voit s'il y a un direct en cours, même sans y être. */
  handleConnection(client: CallSocket) {
    client.emit('call:participants', this.callService.list());
  }

  handleDisconnect(client: CallSocket) {
    this.depart(client.id);
  }

  /** Rejoint le direct ; la réponse liste les participants à qui se connecter. */
  @SubscribeMessage('call:join')
  handleJoin(
    @ConnectedSocket() client: CallSocket,
    @MessageBody() media: unknown,
  ): CallJoinAck {
    if (!this.callService.has(client.id) && this.callService.isFull()) {
      return {
        ok: false,
        error: `Le direct est complet (${MAX_CALL_PARTICIPANTS} personnes)`,
      };
    }

    const participants = this.callService.join(
      client.id,
      client.data.user,
      parseMedia(media),
    );
    this.broadcastParticipants();
    return { ok: true, participants };
  }

  @SubscribeMessage('call:leave')
  handleLeave(@ConnectedSocket() client: CallSocket) {
    this.depart(client.id);
  }

  /** Micro coupé ou rétabli, caméra allumée ou éteinte. */
  @SubscribeMessage('call:media')
  handleMedia(
    @ConnectedSocket() client: CallSocket,
    @MessageBody() media: unknown,
  ) {
    if (this.callService.setMedia(client.id, parseMedia(media))) {
      this.broadcastParticipants();
    }
  }

  /** Relaie un message WebRTC à un autre participant (jamais hors du direct). */
  @SubscribeMessage('call:signal')
  handleSignal(
    @ConnectedSocket() client: CallSocket,
    @MessageBody() payload: unknown,
  ) {
    const { peerId, data } = (payload ?? {}) as Record<string, unknown>;
    if (
      typeof peerId !== 'string' ||
      typeof data !== 'object' ||
      data === null ||
      !this.callService.has(client.id) ||
      !this.callService.has(peerId)
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
    if (!this.callService.has(client.id) || !isReactionEmoji(emoji)) return;
    const peerIds = this.callService.list().map((item) => item.peerId);
    this.server.to(peerIds).emit('call:reaction', { peerId: client.id, emoji });
  }

  /** Départ (volontaire ou coupure) : le dernier à partir clôt le direct. */
  private depart(peerId: string) {
    if (!this.callService.leave(peerId)) return;
    this.broadcastParticipants();

    const summary = this.callService.endIfEmpty();
    if (summary) this.postSummary(summary);
  }

  /** Dépose la trace du direct dans la conversation, au nom de celui qui l'a lancé. */
  private postSummary(summary: CallSummary) {
    const { message } = this.chatService.addMessage({
      id: randomUUID(),
      author: summary.participants[0],
      content: '',
      attachments: [],
      createdAt: summary.endedAt,
      call: summary,
    });
    this.server.emit('message:new', message);
  }

  private broadcastParticipants() {
    this.server.emit('call:participants', this.callService.list());
  }
}
