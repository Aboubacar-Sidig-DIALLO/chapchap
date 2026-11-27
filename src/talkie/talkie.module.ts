import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { SocialModule } from '../social/social.module';
import { TalkieGateway } from './talkie.gateway';
import { TalkieService } from './talkie.service';

@Module({
  // Le chat dit qui a la conversation ouverte ; le module social, qui a le droit d'y parler.
  imports: [ChatModule, SocialModule],
  providers: [TalkieGateway, TalkieService],
})
export class TalkieModule {}
