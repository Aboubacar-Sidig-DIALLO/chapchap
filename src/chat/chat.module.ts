import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { SocialModule } from '../social/social.module';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

@Module({
  // Le module social dit qui peut parler où, et prévient quand cet accès prend fin.
  imports: [AttachmentsModule, SocialModule],
  providers: [ChatGateway, ChatService],
  exports: [ChatService],
})
export class ChatModule {}
