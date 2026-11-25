import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { SocialModule } from '../social/social.module';
import { CallGateway } from './call.gateway';
import { CallService } from './call.service';

@Module({
  // La trace d'un direct terminé est déposée dans la conversation ; les appels
  // en cours sont signalés au module social, qui les annonce sur l'accueil.
  imports: [ChatModule, SocialModule],
  providers: [CallGateway, CallService],
})
export class CallModule {}
