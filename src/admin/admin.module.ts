import { Module } from '@nestjs/common';
import { SocialModule } from '../social/social.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/** Statistiques de l'administration (la présence vient du module social). */
@Module({
  imports: [SocialModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
