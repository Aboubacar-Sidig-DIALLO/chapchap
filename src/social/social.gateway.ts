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
import type { Namespace, Socket } from 'socket.io';
import { accountEvents } from '../auth/account-events';
import { type AuthSocketData, authenticateSocket } from '../auth/socket-auth';
import { CLIENT_ORIGIN } from '../config';
import {
  type Conversation,
  directKey,
  parseConversationRef,
} from './conversation-access.service';
import { FriendsService } from './friends.service';
import { GroupsService } from './groups.service';
import {
  type OngoingCallUpdate,
  OngoingCallsService,
} from './ongoing-calls.service';
import { PresenceService } from './presence.service';
import type {
  ConversationTarget,
  MessageNotice,
  PresenceChange,
  SocialClientEvents,
  SocialNotice,
  SocialServerEvents,
} from './social.types';
import { userRoom } from './social.utils';

type SocialNamespace = Namespace<
  SocialClientEvents,
  SocialServerEvents,
  Record<string, never>,
  AuthSocketData
>;
type SocialSocket = Socket<
  SocialClientEvents,
  SocialServerEvents,
  Record<string, never>,
  AuthSocketData
>;

/**
 * Temps réel de l'accueil (espace `/social`, distinct des conversations).
 * Relaie aussi la présence
 * de chacun (en ligne, hors ligne depuis…) à ses seuls amis, et les appels
 * des conversations privées et de groupe à leurs seuls membres.
 *
 * Le serveur ne fait que prévenir : le client recharge ensuite ses listes
 * depuis l'API, qui reste la seule source de vérité. Seul message accepté du
 * client : le refus d'un appel qui sonne (« Refuser » sur l'accueil).
 */
@WebSocketGateway({
  namespace: 'social',
  cors: { origin: CLIENT_ORIGIN, credentials: true },
})
export class SocialGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  // `!` : assigné par Nest après la construction (`@WebSocketServer`).
  @WebSocketServer()
  private readonly server!: SocialNamespace;
  private readonly subscriptions: Subscription[] = [];

  constructor(
    private readonly presence: PresenceService,
    private readonly friendsService: FriendsService,
    private readonly groupsService: GroupsService,
    private readonly ongoingCalls: OngoingCallsService,
  ) {}

  /** Seules les connexions avec une session valide sont acceptées. */
  afterInit(server: SocialNamespace) {
    server.use(authenticateSocket);
    this.subscriptions.push(
      this.presence.changes$.subscribe(
        (change) => void this.notifyPresence(change),
      ),
      this.ongoingCalls.changes$.subscribe(
        (update) => void this.notifyCall(update),
      ),
      accountEvents.signedOutEverywhere$.subscribe(({ userId }) =>
        this.endSessions(userId),
      ),
    );
  }

  onModuleDestroy() {
    for (const subscription of this.subscriptions) subscription.unsubscribe();
  }

  /** `client.data.user` vient de la session (voir `authenticateSocket`). */
  async handleConnection(client: SocialSocket) {
    this.presence.connected(client.data.user.id);
    await client.join(userRoom(client.data.user.id));
  }

  handleDisconnect(client: SocialSocket) {
    if (client.data.user) this.presence.disconnected(client.data.user.id);
  }

  /**
   * Refuse l'appel d'un ami. La conversation est déduite de la session : on ne
   * peut refuser qu'un appel qui vous est destiné.
   */
  @SubscribeMessage('call:decline')
  handleDeclineCall(
    @ConnectedSocket() client: SocialSocket,
    @MessageBody() payload: unknown,
  ) {
    const { userId } = (payload ?? {}) as Record<string, unknown>;
    const ref = parseConversationRef({ type: 'direct', userId });
    const self = client.data.user.id;
    if (ref?.type !== 'direct' || ref.userId === self) return;
    this.ongoingCalls.decline(directKey(self, ref.userId), self);
  }

  /** Sessions fermées : prévient ses onglets, puis ferme leurs connexions. */
  private endSessions(userId: string) {
    this.server.to(userRoom(userId)).emit('session:ended');
    this.server.in(userRoom(userId)).disconnectSockets(true);
  }

  /** Annonce une arrivée ou un départ aux seuls amis de l'utilisateur. */
  private async notifyPresence(change: PresenceChange) {
    const friendIds = await this.friendsService.friendIds(change.userId);
    if (friendIds.length === 0) return;
    this.server.to(friendIds.map(userRoom)).emit('presence:changed', change);
  }

  /**
   * Annonce un appel (début, participants, fin) aux membres de la
   * conversation, et le fait sonner chez les autres quand il commence.
   */
  private async notifyCall({
    conversation,
    call,
    startedBy,
  }: OngoingCallUpdate) {
    for (const userId of await this.membersOf(conversation)) {
      const target = targetFor(conversation, userId);
      if (!target) continue;
      const room = userRoom(userId);
      this.server.to(room).emit('call:changed', { conversation: target, call });
      if (startedBy && startedBy.id !== userId) {
        this.server
          .to(room)
          .emit('call:started', { conversation: target, startedBy });
      }
    }
  }

  /**
   * Membres à prévenir. Pour un groupe, relus en base : la liste connue à
   * l'ouverture de la conversation inclut peut-être quelqu'un qui l'a quitté.
   */
  private async membersOf(conversation: Conversation): Promise<string[]> {
    if (conversation.groupId) {
      return this.groupsService.memberIds(conversation.groupId);
    }
    return conversation.memberIds;
  }

  /**
   * Prévient `userIds` que leurs amis, demandes ou groupes ont changé, avec
   * éventuellement un événement à leur annoncer.
   */
  notifyChange(userIds: string[], notice: SocialNotice | null = null) {
    if (userIds.length === 0) return;
    this.server.to(userIds.map(userRoom)).emit('social:changed', { notice });
  }

  /** Signale un nouveau message aux destinataires (sur l'accueil : pastille et annonce). */
  notifyMessage(userIds: string[], notice: MessageNotice) {
    if (userIds.length === 0) return;
    this.server.to(userIds.map(userRoom)).emit('social:message', notice);
  }
}

/** La conversation vue par `userId` : l'ami avec qui il parle, ou le groupe. */
function targetFor(
  conversation: Conversation,
  userId: string,
): ConversationTarget | null {
  if (conversation.groupId) {
    return {
      type: 'group',
      groupId: conversation.groupId,
      groupName: conversation.title,
    };
  }
  const friendId = conversation.memberIds.find((id) => id !== userId);
  return friendId ? { type: 'direct', userId: friendId } : null;
}
