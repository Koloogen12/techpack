/**
 * Выгрузка JSON Schema из zod-декларации.
 *
 * Одна декларация — три потребителя: типы TypeScript, рантайм-валидатор
 * и вот эта схема. Она уходит во внешнюю документацию и в structured output
 * Claude API, поэтому расхождения между валидатором и промптом невозможны
 * по построению (ADR-0001 §1).
 *
 * Запуск: pnpm stylespec:schema
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { SPEC_VERSION, StyleSpecSchema } from '../src/index.js';

const OUT = join(dirname(new URL(import.meta.url).pathname), '../schema/stylespec.schema.json');

const schema = z.toJSONSchema(StyleSpecSchema, { io: 'output' });

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: `StyleSpec ${SPEC_VERSION}`,
      ...schema,
    },
    null,
    2,
  ) + '\n',
);

console.log(`✓ JSON Schema StyleSpec ${SPEC_VERSION} → ${OUT}`);
