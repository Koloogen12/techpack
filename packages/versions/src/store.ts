import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { SeamsterError } from '@seamster/core';
import { parseStyleSpec, specFingerprint, type StyleSpec } from '@seamster/stylespec';

/**
 * Хранилище версий техпака.
 *
 * ADR-0001 §4: снапшот никогда не переписывается на месте. Правка порождает
 * НОВУЮ версию, а старая остаётся ровно такой, какой её отправили на фабрику.
 * Это не архивная прихоть: спор с фабрикой разрешается сверкой с тем, что
 * ей прислали, и если тот файл перезаписан, спор не разрешается вовсе.
 *
 * Папка с JSON, а не база. Простое намеренно: версии можно открыть, положить
 * в гит, отдать бренду целиком и прочитать глазами через год.
 */

export interface VersionEntry {
  n: number;
  /** Отпечаток СОДЕРЖАНИЯ. По нему видно, что версия действительно новая. */
  fingerprint: string;
  created_at: string;
  /** Почему появилась версия — человеческим языком. */
  reason_ru: string;
  /** Отпечаток родителя. У первой версии пусто. */
  parent: string | null;
}

const INDEX = 'versions.json';

export class VersionStore {
  constructor(private readonly dir = 'versions') {}

  private articleDir(article: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/.test(article)) {
      throw new SeamsterError('SPEC_INVALID', `недопустимый артикул: ${article}`, {
        userMessage: 'В артикуле есть символы, которых не может быть в имени файла.',
        userAction: 'Оставьте латиницу, цифры, дефис и точку',
      });
    }
    return join(this.dir, article);
  }

  list(article: string): VersionEntry[] {
    const path = join(this.articleDir(article), INDEX);
    if (!existsSync(path)) return [];
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { versions?: VersionEntry[] };
      return parsed.versions ?? [];
    } catch {
      // Битый индекс равен отсутствующему: подсунуть половину истории хуже,
      // чем честно не найти её.
      return [];
    }
  }

  /** Артикулы, у которых есть хотя бы одна версия. */
  articles(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(this.dir, e.name, INDEX)))
      .map((e) => e.name)
      .sort();
  }

  read(article: string, n: number): StyleSpec {
    const path = join(this.articleDir(article), `v${n}.json`);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      const have = this.list(article).map((v) => `v${v.n}`);
      throw new SeamsterError('SPEC_INVALID', `версия ${n} артикула ${article} не читается`, {
        userMessage: `Версия ${n} не найдена.`,
        userAction: have.length
          ? `Доступны: ${have.join(', ')}`
          : 'У этого артикула версий пока нет',
      });
    }
    return parseStyleSpec(raw);
  }

  latest(article: string): { entry: VersionEntry; spec: StyleSpec } | null {
    const all = this.list(article);
    const last = all[all.length - 1];
    if (!last) return null;
    return { entry: last, spec: this.read(article, last.n) };
  }

  /**
   * Сохранить новую версию.
   *
   * Возвращает `null`, если содержание совпало с последней версией. Версия,
   * которая ничего не меняет, — это шум: она заставляет фабрику перечитывать
   * документ, в котором ничего не тронуто, и обесценивает сам номер версии.
   */
  save(article: string, spec: StyleSpec, reason_ru: string, now = new Date()): VersionEntry | null {
    const dir = this.articleDir(article);
    const all = this.list(article);
    const fingerprint = specFingerprint(spec);
    const last = all[all.length - 1];
    if (last?.fingerprint === fingerprint) return null;

    const entry: VersionEntry = {
      n: (last?.n ?? 0) + 1,
      fingerprint,
      created_at: now.toISOString(),
      reason_ru,
      parent: last?.fingerprint ?? null,
    };

    mkdirSync(dir, { recursive: true });
    writeAtomic(join(dir, `v${entry.n}.json`), JSON.stringify(spec, null, 2) + '\n');
    writeAtomic(
      join(dir, INDEX),
      JSON.stringify({ article, versions: [...all, entry] }, null, 2) + '\n',
    );
    return entry;
  }
}

function writeAtomic(path: string, data: string): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, data);
  renameSync(temp, path);
}

/** Отпечаток файла — для провенанса примерок и бланков. */
export function fileFingerprint(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
