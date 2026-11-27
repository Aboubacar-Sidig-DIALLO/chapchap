import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { SocialModule } from '../social/social.module';
import { CallTransport } from './call-transport';
import { CallCoordinator } from './call.coordinator';
import { CallGateway } from './call.gateway';
import { CallService } from './call.service';
import { CallGuestsController } from './guests/call-guests.controller';
import { CallGuestsService } from './guests/call-guests.service';
import { GuestCallGateway } from './guests/guest-call.gateway';

@Module({
  // La trace d'un direct terminé est déposée dans la conversation ; les appels
  // en cours sont signalés au module social, qui les annonce sur l'accueil.
  imports: [ChatModule, SocialModule],
  controllers: [CallGuestsController],
  providers: [
    CallGateway,
    GuestCallGateway,
    CallService,
    CallCoordinator,
    CallTransport,
    CallGuestsService,
  ],
})
export class CallModule {}
