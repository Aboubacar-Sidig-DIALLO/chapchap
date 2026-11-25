import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Valide (et nettoie) une entrée avec un schéma zod :
 * `@Body(new ZodValidationPipe(schema)) body: z.infer<typeof schema>`.
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<
  unknown,
  z.infer<T>
> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(
        result.error.issues[0]?.message ?? 'Requête invalide',
      );
    }
    return result.data;
  }
}
