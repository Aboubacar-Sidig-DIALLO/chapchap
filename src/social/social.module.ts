import { Module } from '@nestjs/common';
import { AccountEventsListener } from './account-events.listener';
import { ConversationAccessService } from './conversation-access.service';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { OngoingCallsService } from './ongoing-calls.service';
import { PresenceService } from './presence.service';
import { SocialEvents } from './social-events.service';
import { SocialGateway } from './social.gateway';

/**
 * Amis (recherche, demandes) et groupes d'amis, avec leur temps réel.
 * Expose au chat qui peut parler où, et quand cet accès prend fin ; reçoit
 * du module d'appel les appels en cours, pour les annoncer.
 */
@Module({
  controllers: [FriendsController, GroupsController],
  providers: [
    AccountEventsListener,
    FriendsService,
    GroupsService,
    SocialGateway,
    SocialEvents,
    ConversationAccessService,
    PresenceService,
    OngoingCallsService,
  ],
  exports: [
    SocialGateway,
    SocialEvents,
    ConversationAccessService,
    PresenceService,
    OngoingCallsService,
  ],
})
export class SocialModule {}
