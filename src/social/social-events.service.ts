import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

/** Des utilisateurs perdent l'accès à une conversation (ami retiré, groupe quitté). */
export interface AccessRevoked {
  conversationKey: string;
  userIds: string[];
}

/**
 * Événements internes du module social, écoutés par le chat sans que les
 * deux modules dépendent l'un de l'autre.
 */
@Injectable()
export class SocialEvents {
  private readonly accessRevokedSubject = new Subject<AccessRevoked>();

  /** À écouter pour fermer les conversations devenues interdites. */
  readonly accessRevoked$ = this.accessRevokedSubject.asObservable();

  revokeAccess(event: AccessRevoked) {
    this.accessRevokedSubject.next(event);
  }
}
