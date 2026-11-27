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
import type { Subscription } from 'rxjs';
import type { Server, Socket } from 'socket.io';
import { MAX_ATTACHMENTS_PER_MESSAGE } from '../attachments/attachments.constants';
import { AttachmentsService } from '../attachments/attachments.service';
import { accountEvents } from '../auth/account-events';
import { authenticateSocket } from '../auth/socket-auth';
import { CLIENT_ORIGIN } from '../config';
import {
  type Conversation,
  ConversationAccessService,
  directKeyMembers,
  groupKey,
  parseConversationRef,
  rightsIn,
} from '../social/conversation-access.service';
import {
  actionsOfMessage,
  DIRECT_RIGHTS,
  restrictionError,
} from '../social/group-rights';
import {
  type AccessRevoked,
  SocialEvents,
} from '../social/social-events.service';
import { PresenceService } from '../social/presence.service';
import type { PresenceChange } from '../social/social.types';
import { SocialGateway } from '../social/social.gateway';
import { toPublicUser, userRoom } from '../social/social.utils';
import { isReactionEmoji } from './chat.constants';
import { ChatService } from './chat.service';
import type { ConversationStore } from './conversation-store';
import type {
  ChatMessage,
  ConversationInfo,
  DeleteMessageAck,
  SendMessageAck,
  SendMessagePayload,
  ServerToClientEvents,
  SocketData,
  UserActivity,
} from './chat.types';

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

const NO_ACCESS = "Vous n'avez plus accès à cette conversation";

/** Ce que le client sait de sa conversation, dont ses propres droits. */
function conversationInfo(
  conversation: Conversation,
  userId: string,
): ConversationInfo {
  const { type, title, photoUrl } = conversation;
  const rights = rightsIn(conversation, userId) ?? DIRECT_RIGHTS;
  return { type, title, photoUrl, rights };
}

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

/**
 * Discussions en temps réel : les conversations entre amis et celles des
 * groupes. Chaque connexion ouvre une seule conversation (sa « salle »),
 * et tout ce qui s'y passe reste dans cette salle.
 */
@WebSocketGateway({ cors: { origin: CLIENT_ORIGIN, credentials: true } })
export class ChatGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  // `!` : assigné par Nest après la construction (`@WebSocketServer`).
  @WebSocketServer()
  private readonly server!: ChatServer;
  private readonly subscriptions: Subscription[] = [];

  constructor(
    private readonly chatService: ChatService,
    private readonly attachmentsService: AttachmentsService,
    private readonly conversationAccess: ConversationAccessService,
    private readonly socialEvents: SocialEvents,
    private readonly socialGateway: SocialGateway,
    private readonly presence: PresenceService,
  ) {}

  /**
   * Chat et direct partagent ce serveur. Une connexion n'est acceptée
   * qu'avec une session valide, puis un accès vérifié à la conversation demandée.
   */
  afterInit(server: ChatServer) {
    server.use(authenticateSocket);
    server.use((socket, next) => this.authorizeConversation(socket, next));

    this.subscriptions.push(
      this.socialEvents.accessRevoked$.subscribe(
        (event) => void this.closeConversation(event),
      ),
      this.socialEvents.groupUpdated$.subscribe(
        (groupId) => void this.refreshGroupConversation(groupId),
      ),
      this.presence.changes$.subscribe((change) =>
        this.relayFriendPresence(change),
      ),
      // Sessions fermées (adresse changée, compte supprimé) : plus de conversation ouverte.
      accountEvents.signedOutEverywhere$.subscribe(({ userId }) => {
        this.server.to(userRoom(userId)).emit('session:ended');
        this.server.in(userRoom(userId)).disconnectSockets(true);
      }),
    );
  }

  onModuleDestroy() {
    for (const subscription of this.subscriptions) subscription.unsubscribe();
  }

  /** `client.data` est rempli par les middlewares : utilisateur et conversation sont garantis. */
  handleConnection(client: ChatSocket) {
    const { user, conversation } = client.data;
    void client.join([conversation.key, userRoom(user.id)]);
    this.chatService.addConnection(client.id, user, conversation.key);
    // Être dans une conversation, c'est aussi être en ligne pour ses amis.
    this.presence.connected(user.id);

    const store = this.chatService.conversation(conversation.key);
    client.emit('conversation:ready', conversationInfo(conversation, user.id));
    client.emit('chat:history', store.getHistory());
    client.emit('receipts:update', store.getReceipts());
    this.broadcastOnlineUsers(conversation.key);
    if (conversation.friendId) {
      void this.sendFriendPresence(client, conversation.friendId);
    }
  }

  handleDisconnect(client: ChatSocket) {
    const { user, conversation } = client.data;
    if (!user || !conversation) return;

    this.chatService.removeConnection(client.id);
    this.presence.disconnected(user.id);
    const room = client.to(conversation.key);
    room.emit('activity', { user, activity: null });
    room.emit('voice:listening', { user, messageId: null });
    this.broadcastOnlineUsers(conversation.key);
  }

  /** La valeur retournée est transmise au client comme accusé de réception. */
  @SubscribeMessage('message:send')
  async handleSendMessage(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() payload: SendMessagePayload,
  ): Promise<SendMessageAck> {
    const { user, conversation } = client.data;
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
      return { ok: false, error: 'Pièce jointe introuvable ou expirée' };
    }
    if (!content && attachments.length === 0) {
      return { ok: false, error: 'Message vide' };
    }

    // L'amitié, l'appartenance au groupe ou une autorisation a pu changer
    // depuis la connexion : les droits sont relus à chaque envoi.
    const rights = await this.conversationAccess.rights(user.id, conversation);
    if (!rights) return { ok: false, error: NO_ACCESS };
    const restricted = restrictionError(
      rights,
      actionsOfMessage(content, attachments),
    );
    if (restricted) return { ok: false, error: restricted };

    const { message, isNew } = this.chatService
      .conversation(conversation.key)
      .addMessage({
        id: payload.id,
        author: user,
        content,
        attachments,
        createdAt: new Date().toISOString(),
      });

    if (isNew) {
      this.attachmentsService.keepUntil(attachments, message.expiresAt);
      client.to(conversation.key).emit('message:new', message);
      this.notifyMembers(client, message);
    }

    return { ok: true, message };
  }

  /**
   * Le participant écrit (`typing`), enregistre un vocal (`recording`) ou
   * s'arrête (`null`). Ce qu'il n'a pas le droit d'envoyer n'est pas annoncé.
   */
  @SubscribeMessage('activity')
  handleActivity(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() activity: unknown,
  ) {
    const { user, conversation } = client.data;
    const restrictions = rightsIn(conversation, user.id)?.restrictions;
    const isAllowed =
      isUserActivity(activity) &&
      !restrictions?.[activity === 'typing' ? 'write' : 'voice'];

    client.to(conversation.key).emit('activity', {
      user,
      activity: isAllowed ? activity : null,
    });
  }

  /**
   * Supprime un message pour tout le monde : réservé au propriétaire et aux
   * administrateurs d'un groupe (droits relus en base). Ses fichiers sont
   * effacés aussitôt.
   */
  @SubscribeMessage('message:delete')
  async handleDelete(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() messageId: unknown,
  ): Promise<DeleteMessageAck> {
    const { user, conversation } = client.data;
    if (typeof messageId !== 'string') {
      return { ok: false, error: 'Message invalide' };
    }

    const rights = await this.conversationAccess.rights(user.id, conversation);
    if (!rights) return { ok: false, error: NO_ACCESS };
    if (!rights.moderate) {
      return {
        ok: false,
        error:
          'Seuls le propriétaire et les administrateurs du groupe peuvent supprimer un message',
      };
    }

    const attachments = this.store(client).deleteMessage(messageId, user);
    if (!attachments) {
      return { ok: false, error: 'Ce message a déjà disparu' };
    }
    void this.attachmentsService.discard(attachments);
    this.server
      .to(conversation.key)
      .emit('message:deleted', { messageId, deletedBy: user });
    return { ok: true };
  }

  /** Le participant a écouté un message vocal ; diffusé à tous (dont ses autres onglets). */
  @SubscribeMessage('voice:listened')
  handleListened(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() messageId: unknown,
  ) {
    const { user, conversation } = client.data;
    if (
      typeof messageId === 'string' &&
      this.store(client).markListened(messageId, user)
    ) {
      this.server
        .to(conversation.key)
        .emit('voice:listened', { messageId, user });
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
    const { user, conversation } = client.data;
    const isValid =
      typeof messageId === 'string' &&
      this.store(client).canListen(messageId, user);

    client.to(conversation.key).emit('voice:listening', {
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
    const { user, conversation } = client.data;
    if (
      typeof messageId === 'string' &&
      isPercent(percent) &&
      this.store(client).updateListenProgress(messageId, user, percent)
    ) {
      this.server
        .to(conversation.key)
        .emit('voice:progress', { messageId, user, percent });
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

    const reactions = this.store(client).setReaction(
      messageId,
      client.data.user,
      emoji,
    );
    if (reactions) {
      this.server
        .to(client.data.conversation.key)
        .emit('message:reactions', { messageId, reactions });
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

  /**
   * Middleware : la conversation demandée (`handshake.auth.conversation`)
   * doit être accessible à l'utilisateur, sinon la connexion est refusée.
   */
  private authorizeConversation(
    socket: ChatSocket,
    next: (error?: Error) => void,
  ) {
    const auth = socket.handshake.auth as Record<string, unknown> | undefined;
    const ref = parseConversationRef(auth?.conversation);
    if (!ref) return next(new Error('BAD_REQUEST'));

    this.conversationAccess
      .open(socket.data.user.id, ref)
      .then((conversation) => {
        if (!conversation) return next(new Error('FORBIDDEN'));
        socket.data.conversation = conversation;
        next();
      })
      .catch(() => next(new Error('FORBIDDEN')));
  }

  /** La conversation ouverte par cette connexion. */
  private store(client: ChatSocket) {
    return this.chatService.conversation(client.data.conversation.key);
  }

  /** Diffusé à toute la conversation, y compris l'émetteur (synchronise ses autres onglets). */
  private updateReceipt(
    client: ChatSocket,
    update: Parameters<ConversationStore['updateReceipt']>[1],
  ) {
    const receipt = this.store(client).updateReceipt(client.data.user, update);
    if (receipt) {
      this.server
        .to(client.data.conversation.key)
        .emit('receipts:update', [receipt]);
    }
  }

  /**
   * Signale le nouveau message aux autres membres d'une conversation privée ou
   * de groupe, sur leur accueil (sans son contenu).
   */
  private notifyMembers(client: ChatSocket, message: ChatMessage) {
    const { user, conversation } = client.data;
    const recipients = conversation.memberIds.filter((id) => id !== user.id);
    const from = toPublicUser(message.author);

    if (conversation.type === 'direct') {
      this.socialGateway.notifyMessage(recipients, {
        conversation: { type: 'direct', userId: user.id },
        from,
      });
    } else if (conversation.type === 'group' && conversation.groupId) {
      this.socialGateway.notifyMessage(recipients, {
        conversation: {
          type: 'group',
          groupId: conversation.groupId,
          groupName: conversation.title,
        },
        from,
      });
    }
  }

  /**
   * Ferme une conversation pour ceux qui n'y ont plus accès. Quand plus aucun
   * de ses membres n'y a droit (amitié rompue), ses messages sont effacés.
   */
  private async closeConversation({ conversationKey, userIds }: AccessRevoked) {
    const sockets = await this.server.in(conversationKey).fetchSockets();
    for (const socket of sockets) {
      if (userIds.includes(socket.data.user.id)) {
        socket.emit('conversation:closed');
        socket.disconnect(true);
      }
    }

    const members = sockets[0]?.data.conversation.memberIds;
    const everyoneRevoked =
      conversationKey.startsWith('direct:') ||
      (members?.every((id) => userIds.includes(id)) ?? false);
    if (everyoneRevoked) this.chatService.deleteConversation(conversationKey);
  }

  /**
   * Le groupe a changé : ses connexions ouvertes reprennent son nom, sa
   * photo, ses membres (à qui sont signalés les nouveaux messages) et les
   * droits de chacun, que son interface applique aussitôt.
   */
  private async refreshGroupConversation(groupId: string) {
    const key = groupKey(groupId);
    const sockets = await this.server.in(key).fetchSockets();
    if (sockets.length === 0) return;

    const conversation = await this.conversationAccess.group(groupId);
    if (!conversation) return;
    for (const socket of sockets) {
      socket.data.conversation = conversation;
      socket.emit(
        'conversation:updated',
        conversationInfo(conversation, socket.data.user.id),
      );
    }
  }

  /** Conversation privée : où en est l'ami (en ligne, hors ligne depuis…). */
  private async sendFriendPresence(client: ChatSocket, friendId: string) {
    try {
      const presence = await this.presence.presenceOf(friendId);
      client.emit('friend:presence', { userId: friendId, ...presence });
    } catch {
      // Base momentanément indisponible : l'en-tête s'en passe.
    }
  }

  /**
   * Relaie l'arrivée ou le départ d'un utilisateur dans ses conversations
   * privées ouvertes (l'autre ami y voit sa présence changer).
   */
  private relayFriendPresence(change: PresenceChange) {
    const keys = [...this.server.sockets.adapter.rooms.keys()].filter((key) =>
      directKeyMembers(key)?.includes(change.userId),
    );
    if (keys.length > 0) this.server.to(keys).emit('friend:presence', change);
  }

  private broadcastOnlineUsers(conversationKey: string) {
    this.server
      .to(conversationKey)
      .emit('users:online', this.chatService.getOnlineUsers(conversationKey));
  }
}
