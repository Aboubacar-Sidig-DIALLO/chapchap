import { z } from 'zod';
import { PUSH_SERVICE_HOSTS } from './push.config';

/** Clé du navigateur, en base64 « URL » (sans remplissage). */
const base64UrlKey = z
  .string()
  .min(16, 'Abonnement invalide')
  .max(256, 'Abonnement invalide')
  .regex(/^[\w-]+=*$/, 'Abonnement invalide');

function isPushServiceUrl(value: string) {
  try {
    const { protocol, hostname } = new URL(value);
    return (
      protocol === 'https:' &&
      PUSH_SERVICE_HOSTS.some(
        (host) => hostname === host || hostname.endsWith(`.${host}`),
      )
    );
  } catch {
    return false;
  }
}

const endpointSchema = z
  .string()
  .max(2048, 'Abonnement invalide')
  .refine(isPushServiceUrl, 'Service de notification non reconnu');

/** `PushSubscription.toJSON()` du navigateur. */
export const subscriptionSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({ p256dh: base64UrlKey, auth: base64UrlKey }),
});

export const unsubscribeSchema = z.object({ endpoint: endpointSchema });

export type SubscriptionInput = z.infer<typeof subscriptionSchema>;
