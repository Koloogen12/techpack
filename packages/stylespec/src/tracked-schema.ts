import { CONFIDENCE_LEVELS } from '@seamsterly/core';
import { z } from 'zod';

export const ConfidenceSchema = z.enum(CONFIDENCE_LEVELS);

/**
 * Схема значения вместе с происхождением.
 *
 * Ровно та форма, в которой Tracked<T> уезжает в JSON. Схема требует
 * confidence и source — снапшот со значением без источника не провалидируется
 * и не загрузится. Это тот же принцип, что и в типе, только на границе хранения.
 */
export const tracked = <T extends z.ZodType>(inner: T) =>
  z.object({
    value: inner,
    confidence: ConfidenceSchema,
    /** Адрес источника: 'kb:pom_templates/tshirt#T03', 'vision:v1', 'user:wizard.q2'. */
    source: z.string().min(1),
    /** Человеческим языком: что с этим делать. */
    note: z.string().optional(),
  });

export type TrackedOf<T> = {
  value: T;
  confidence: (typeof CONFIDENCE_LEVELS)[number];
  source: string;
  note?: string;
};
