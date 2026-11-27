import { Module } from '@nestjs/common';
import { SocialModule } from '../social/social.module';
import { InvitesController } from './invites.controller';
import { InvitesService } from './invites.service';

/** Invitations éphémères (lien ou QR code) : devenir ami, ou rejoindre un groupe. */
@Module({
  imports: [SocialModule],
  controllers: [InvitesController],
  providers: [InvitesService],
})
export class InvitesModule {}
