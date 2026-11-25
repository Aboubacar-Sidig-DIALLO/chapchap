import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { MAX_ATTACHMENTS_PER_MESSAGE } from '../attachments/attachments.constants';
import { AttachmentsService } from '../attachments/attachments.service';
import { CLIENT_ORIGIN } from '../config';
import { isReactionEmoji } from './chat.constants';
import { ChatService } from './chat.service';
import type {
  ChatUser,
  SendMessageAck,
  SendMessagePayload,
  ServerToClientEvents,
  SocketData,
  UserActivity,
} from './chat.types';

const MAX_NAME_LENGTH = 32;
const MAX_MESSAGE_LENGTH = 2000;

type ChatServer = Server<
  Record<string, never>,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
type ChatSocket = Socket<
  Record<string, never>,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

function isUserActivity(value: unknown): value is UserActivity {
  return value === 'typing' || value === 'recording';
}

function isSeq(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isPercent(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 100
  );
}

function parseUser(auth: unknown): ChatUser | null {
  const { id, name } = (auth ?? {}) as Partial<Record<keyof ChatUser, unknown>>;
  if (typeof id !== 'string' || typeof name !== 'string') return null;

  const trimmedName = name.trim().slice(0, MAX_NAME_LENGTH);
  if (!id || !trimmedName) return null;

  return { id, name: trimmedName };
}

@WebSocketGateway({ cors: { origin: CLIENT_ORIGIN } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server: ChatServer;

  constructor(
    private readonly chatService: ChatService,
    private readonly attachmentsService: AttachmentsService,
  ) {}

  handleConnection(client: ChatSocket) {
    const user = parseUser(client.handshake.auth);
    if (!user) {
      client.disconnect(true);
      return;
    }

    client.data.user = user;
    this.chatService.addConnection(client.id, user);

    client.emit('chat:history', this.chatService.getHistory());
    client.emit('receipts:update', this.chatService.getReceipts());
    this.broadcastOnlineUsers();
  }

  handleDisconnect(client: ChatSocket) {
    const { user } = client.data;
    if (!user) return;

    this.chatService.removeConnection(client.id);
    client.broadcast.emit('activity', { user, activity: null });
    client.broadcast.emit('voice:listening', { user, messageId: null });
    this.broadcastOnlineUsers();
  }

  /** La valeur retournée est transmise au client comme accusé de réception. */
  @SubscribeMessage('message:send')
  handleSendMessage(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() payload: SendMessagePayload,
  ): SendMessageAck {
    const content =
      typeof payload?.content === 'string' ? payload.content.trim() : '';
    const attachmentIds: unknown[] = Array.isArray(payload?.attachmentIds)
      ? payload.attachmentIds
      : [];

    if (typeof payload?.id !== 'string') {
      return { ok: false, error: 'Message invalide' };
    }
    if (content.length > MAX_MESSAGE_LENGTH) {
      return { ok: false, error: 'Message trop long' };
    }
    if (attachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      return { ok: false, error: 'Trop de pièces jointes' };
    }

    const attachments = this.attachmentsService.resolve(attachmentIds);
    if (!attachments) {
      return { ok: false, error: 'Pièce jointe introuvable' };
    }
    if (!content && attachments.length === 0) {
      return { ok: false, error: 'Message vide' };
    }

    const { message, isNew } = this.chatService.addMessage({
      id: payload.id,
      author: client.data.user,
      content,
      attachments,
      createdAt: new Date().toISOString(),
    });

    if (isNew) client.broadcast.emit('message:new', message);

    return { ok: true, message };
  }

  /** Le participant écrit (`typing`), enregistre un vocal (`recording`) ou s'arrête (`null`). */
  @SubscribeMessage('activity')
  handleActivity(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() activity: unknown,
  ) {
    client.broadcast.emit('activity', {
      user: client.data.user,
      activity: isUserActivity(activity) ? activity : null,
    });
  }

  /** Le participant a écouté un message vocal ; diffusé à tous (dont ses autres onglets). */
  @SubscribeMessage('voice:listened')
  handleListened(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() messageId: unknown,
  ) {
    const { user } = client.data;
    if (
      typeof messageId === 'string' &&
      this.chatService.markListened(messageId, user)
    ) {
      this.server.emit('voice:listened', { messageId, user });
    }
  }

  /**
   * Le participant écoute un vocal en ce moment (`messageId`) ou s'arrête (`null`).
   * Éphémère, comme `activity` : rien n'est stocké, la déconnexion y met fin.
   */
  @SubscribeMessage('voice:listening')
  handleListening(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() messageId: unknown,
  ) {
    const { user } = client.data;
    const isValid =
      typeof messageId === 'string' &&
      this.chatService.canListen(messageId, user);

    client.broadcast.emit('voice:listening', {
      user,
      messageId: isValid ? messageId : null,
    });
  }

  /** Le participant a écouté `percent` % du vocal ; diffusé à tous s'il avance. */
  @SubscribeMessage('voice:progress')
  handleProgress(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() payload: unknown,
  ) {
    const { messageId, percent } = (payload ?? {}) as Record<string, unknown>;
    const { user } = client.data;
    if (
      typeof messageId === 'string' &&
      isPercent(percent) &&
      this.chatService.updateListenProgress(messageId, user, percent)
    ) {
      this.server.emit('voice:progress', { messageId, user, percent });
    }
  }

  /** Le participant réagit à un message (`emoji`), ou retire sa réaction (`null`). */
  @SubscribeMessage('message:react')
  handleReact(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() payload: unknown,
  ) {
    const { messageId, emoji } = (payload ?? {}) as Record<string, unknown>;
    if (typeof messageId !== 'string') return;
    if (emoji !== null && !isReactionEmoji(emoji)) return;

    const reactions = this.chatService.setReaction(
      messageId,
      client.data.user,
      emoji,
    );
    if (reactions) {
      this.server.emit('message:reactions', { messageId, reactions });
    }
  }

  /** Le navigateur a reçu tous les messages jusqu'à `seq` inclus. */
  @SubscribeMessage('messages:delivered')
  handleDelivered(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() seq: unknown,
  ) {
    if (isSeq(seq)) this.updateReceipt(client, { deliveredSeq: seq });
  }

  /** L'utilisateur a vu à l'écran tous les messages jusqu'à `seq` inclus. */
  @SubscribeMessage('messages:read')
  handleRead(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() seq: unknown,
  ) {
    if (isSeq(seq)) this.updateReceipt(client, { readSeq: seq });
  }

  /** Diffusé à tous, y compris l'émetteur (synchronise ses autres onglets). */
  private updateReceipt(
    client: ChatSocket,
    update: Parameters<ChatService['updateReceipt']>[1],
  ) {
    const receipt = this.chatService.updateReceipt(client.data.user, update);
    if (receipt) this.server.emit('receipts:update', [receipt]);
  }

  private broadcastOnlineUsers() {
    this.server.emit('users:online', this.chatService.getOnlineUsers());
  }
}
