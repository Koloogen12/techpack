import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RENDER_PROMPT_VERSION } from './prompt.js';

/**
 * Контент-адресуемый кэш визуализаций — тот же механизм, что у vision (ADR-0003),
 * и по той же причине: генерация изображения недетерминирована, поэтому её
 * результат фиксируется один раз на уникальный вход.
 *
 * Ключ считается ОТ ПРОМПТА, а не от отпечатка спеки. Промпт — это и есть
 * детерминированная проекция спеки на картинку, и он уже отбросил всё, что
 * на внешний вид не влияет. Артикул, дата генерации и раскладка размеров
 * меняют отпечаток спеки, но не меняют вид вещи: платить за одинаковую
 * картинку дважды не за что.
 */

export interface RenderKeyInput {
  prompt: string;
  model: string;
  /**
   * Опорные изображения — например тайл раппорта.
   *
   * Входят в ключ ОТДЕЛЬНО: промпт от смены тайла не меняется (в нём только
   * шаг раппорта), и без этого другой рисунок вернул бы из кэша картинку
   * с прежним узором.
   */
  references?: readonly Uint8Array[];
}

export function renderKey(input: RenderKeyInput): string {
  const refs = (input.references ?? [])
    .map((r) => createHash('sha256').update(r).digest('hex'))
    .sort();
  return createHash('sha256')
    .update([input.prompt, ...refs, input.model, RENDER_PROMPT_VERSION].join(' '))
    .digest('hex');
}

export interface CachedRender {
  bytes: Uint8Array;
  mediaType: string;
  model: string;
}

export interface RenderCache {
  get(key: string): CachedRender | undefined;
  set(key: string, value: CachedRender): void;
}

export class MemoryRenderCache implements RenderCache {
  private readonly store = new Map<string, CachedRender>();

  get(key: string): CachedRender | undefined {
    return this.store.get(key);
  }

  set(key: string, value: CachedRender): void {
    this.store.set(key, value);
  }
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/**
 * Файловый кэш.
 *
 * Байты лежат отдельным файлом, а не base64 внутри JSON: картинка весит
 * мегабайты, а base64 добавляет к ним треть и делает содержимое нечитаемым
 * для любого инструмента, кроме нашего.
 *
 * Рядом — спутник с промптом и моделью. Это провенанс: через полгода нужно
 * уметь ответить, чем и по какому описанию сделана конкретная картинка,
 * иначе спор с фабрикой не разрешить.
 */
export class FileRenderCache implements RenderCache {
  constructor(private readonly dir: string) {}

  private base(key: string): string {
    return join(this.dir, key.slice(0, 2), key);
  }

  get(key: string): CachedRender | undefined {
    let meta: { media_type?: unknown; model?: unknown; ext?: unknown };
    try {
      meta = JSON.parse(readFileSync(`${this.base(key)}.json`, 'utf8')) as typeof meta;
    } catch {
      return undefined;
    }
    if (typeof meta.media_type !== 'string' || typeof meta.model !== 'string') return undefined;
    if (typeof meta.ext !== 'string') return undefined;

    try {
      return {
        bytes: readFileSync(`${this.base(key)}.${meta.ext}`),
        mediaType: meta.media_type,
        model: meta.model,
      };
    } catch {
      // Спутник есть, картинки нет — запись битая, считаем отсутствующей.
      return undefined;
    }
  }

  set(key: string, value: CachedRender): void {
    const base = this.base(key);
    mkdirSync(dirname(base), { recursive: true });
    const ext = EXT[value.mediaType] ?? 'bin';

    // Сначала картинка, потом спутник: читатель заходит через спутник,
    // поэтому обратный порядок оставил бы окно, в котором запись выглядит
    // готовой, а байтов ещё нет.
    writeAtomic(`${base}.${ext}`, Buffer.from(value.bytes));
    writeAtomic(
      `${base}.json`,
      Buffer.from(
        JSON.stringify(
          {
            media_type: value.mediaType,
            model: value.model,
            ext,
            prompt_version: RENDER_PROMPT_VERSION,
          },
          null,
          2,
        ) + '\n',
      ),
    );
  }
}

function writeAtomic(path: string, data: Buffer): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, data);
  renameSync(temp, path);
}
