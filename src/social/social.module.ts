import { Module } from '@nestjs/common';
import { PushModule } from '../push/push.module';
import { AccountEventsListener } from './account-events.listener';
import { ConversationAccessService } from './conversation-access.service';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';
import { GroupPhotosController } from './group-photos.controller';
import { GroupPhotosService } from './group-photos.service';
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
  // Ce qui est annoncé sur l'accueil l'est aussi par notification push.
  imports: [PushModule],
  controllers: [FriendsController, GroupsController, GroupPhotosController],
  providers: [
    AccountEventsListener,
    FriendsService,
    GroupsService,
    GroupPhotosService,
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
