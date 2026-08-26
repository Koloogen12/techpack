import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SeamsterlyError } from '@seamsterly/core';
import { ArtworkAssetSchema, type ArtworkAsset } from './artwork.js';

/**
 * Файловое хранилище библиотеки.
 *
 * Простое намеренно: паспорт — JSON рядом с файлом арта, каталог — обычная
 * папка. Её можно открыть, посмотреть глазами, положить в гит и отдать
 * бренду целиком. База данных появится вместе с веб-приложением; до тех
 * пор папка честнее — concierge-режим ведёт человек, и он должен видеть,
 * с чем работает.
 */
export class ArtworkLibrary {
  constructor(private readonly dir: string = 'brand-library/artwork') {}

  private passport(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  /** Путь к файлу арта. Нужен, чтобы приложить его к паку. */
  filePath(asset: ArtworkAsset): string {
    return join(this.dir, asset.file);
  }

  list(): ArtworkAsset[] {
    let names: string[];
    try {
      names = readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
    return names
      .map((f) => this.readSafe(join(this.dir, f)))
      .filter((a): a is ArtworkAsset => a !== null)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): ArtworkAsset {
    const asset = this.readSafe(this.passport(id));
    if (!asset) {
      const available = this.list().map((a) => a.id);
      throw new SeamsterlyError('SPEC_INVALID', `в библиотеке нет арта «${id}»`, {
        userMessage: `Не нашли рисунок «${id}» в библиотеке бренда.`,
        userAction: available.length
          ? `Доступны: ${available.join(', ')}`
          : 'Библиотека пуста — создайте рисунок командой pnpm pattern и сохраните его',
        details: { id, available: available.join(', ') },
      });
    }
    return asset;
  }

  save(asset: ArtworkAsset, bytes: Uint8Array): ArtworkAsset {
    const parsed = ArtworkAssetSchema.parse(asset);
    mkdirSync(this.dir, { recursive: true });
    writeAtomic(join(this.dir, parsed.file), Buffer.from(bytes));
    writeAtomic(this.passport(parsed.id), Buffer.from(JSON.stringify(parsed, null, 2) + '\n'));
    return parsed;
  }

  /**
   * Отметить, что арт ушёл в пак.
   *
   * Повторную отметку не дублируем: один артикул в списке ровно один раз,
   * иначе «использован в 7 паках» будет означать семь перегенераций одного.
   */
  markUsed(id: string, article: string): ArtworkAsset {
    const asset = this.get(id);
    if (asset.used_in.includes(article)) return asset;
    const next = { ...asset, used_in: [...asset.used_in, article].sort() };
    writeAtomic(this.passport(id), Buffer.from(JSON.stringify(next, null, 2) + '\n'));
    return next;
  }

  private readSafe(path: string): ArtworkAsset | null {
    try {
      const parsed = ArtworkAssetSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
      // Битый паспорт равен отсутствующему: подсунуть в документполуразобранный
      // арт хуже, чем честно его не найти.
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}

function writeAtomic(path: string, data: Buffer): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, data);
  renameSync(temp, path);
}
