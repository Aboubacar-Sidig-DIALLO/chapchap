import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Subscription } from 'rxjs';
import { accountEvents, type DeletedAccount } from '../auth/account-events';
import { directKey, groupKey } from './conversation-access.service';
import { FriendsService } from './friends.service';
import { GroupsService } from './groups.service';
import { SocialEvents } from './social-events.service';
import { SocialGateway } from './social.gateway';

/**
 * Répercute la vie d'un compte sur les autres utilisateurs : un nouveau nom
 * apparaît aussitôt dans leurs listes ; un compte supprimé en disparaît, et
 * ses conversations se ferment.
 */
@Injectable()
export class AccountEventsListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountEventsListener.name);
  private readonly subscriptions: Subscription[] = [];

  constructor(
    private readonly friendsService: FriendsService,
    private readonly groupsService: GroupsService,
    private readonly socialEvents: SocialEvents,
    private readonly socialGateway: SocialGateway,
  ) {}

  onModuleInit() {
    this.subscriptions.push(
      accountEvents.updated$.subscribe(({ userId }) =>
        this.run(this.onUpdated(userId)),
      ),
      accountEvents.deleted$.subscribe((account) =>
        this.run(this.onDeleted(account)),
      ),
    );
  }

  onModuleDestroy() {
    for (const subscription of this.subscriptions) subscription.unsubscribe();
  }

  /** Amis, demandes et membres de ses groupes rechargent leurs listes. */
  private async onUpdated(userId: string) {
    const [related, coMembers] = await Promise.all([
      this.friendsService.relatedUserIds(userId),
      this.groupsService.coMemberIds(userId),
    ]);
    this.socialGateway.notifyChange(unique([...related, ...coMembers]));
  }

  private async onDeleted({
    userId,
    relatedUserIds,
    groupIds,
  }: DeletedAccount) {
    // Conversations privées : fermées des deux côtés, messages effacés.
    for (const otherId of relatedUserIds) {
      this.socialEvents.revokeAccess({
        conversationKey: directKey(userId, otherId),
        userIds: [userId, otherId],
      });
    }
    // Groupes : il en sort ; un groupe resté sans membre disparaît.
    for (const groupId of groupIds) {
      this.socialEvents.revokeAccess({
        conversationKey: groupKey(groupId),
        userIds: [userId],
      });
    }
    const groupMembers = await this.groupsService.pruneAndListMembers(groupIds);
    this.socialGateway.notifyChange(
      unique([...relatedUserIds, ...groupMembers]),
    );
  }

  /** Une erreur ici ne doit pas interrompre l'écoute des événements suivants. */
  private run(task: Promise<void>) {
    task.catch((error: unknown) =>
      this.logger.error(`Événement de compte non traité : ${String(error)}`),
    );
  }
}

function unique(ids: string[]) {
  return [...new Set(ids)];
}
