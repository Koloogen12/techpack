import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Защита от целого класса багов, который мы уже поймали руками:
 * два модуля экспортируют одно имя, index.ts реэкспортирует оба через `export *`,
 * реэкспорт становится неоднозначным — и в рантайме тихо побеждает не тот.
 *
 * Такой баг не падает, а даёт неправильный ответ. Счётчик предположений показал бы
 * ноль на всём продукте, и никто бы не заметил.
 */
const SRC = new URL('../src/', import.meta.url).pathname;

function exportedNames(file: string): string[] {
  const source = readFileSync(join(SRC, file), 'utf8');
  const names: string[] = [];
  const re = /^export\s+(?:async\s+)?(?:function|const|let|class|type|interface|enum)\s+(\w+)/gm;
  for (const m of source.matchAll(re)) if (m[1]) names.push(m[1]);
  return names;
}

describe('публичный API пакета', () => {
  it('не содержит двух модулей, экспортирующих одно имя', () => {
    const modules = readdirSync(SRC).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

    const owners = new Map<string, string[]>();
    for (const file of modules) {
      for (const name of exportedNames(file)) {
        owners.set(name, [...(owners.get(name) ?? []), file]);
      }
    }

    const collisions = [...owners.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([name, files]) => `${name} — ${files.join(', ')}`);

    expect(collisions).toEqual([]);
  });
});
