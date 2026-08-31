#!/usr/bin/env tsx
/**
 * Каталогизация библиотеки: модель смотрит на превью и говорит, что это.
 *
 *   pnpm templates:catalog            — разобрать всё, чего ещё нет в кэше
 *   pnpm templates:catalog --limit 20 — пробный прогон на двадцати
 *
 * Из файлов датасета видно только геометрию: сколько видов, каков габарит.
 * Категория, посадка, капюшон, застёжка и карман видны лишь глазом — и это
 * ровно та работа, которую делает vision. Разбор идёт ПАЧКАМИ: один запрос
 * на несколько превью дешевле и быстрее, чем запрос на каждое, а качество
 * не страдает — изделия независимы, и путать их модели незачем.
 *
 * Кэш по отпечатку превью: повторный запуск не платит за уже разобранное,
 * а изменённая картинка разбирается заново.
 */
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { TemplateTraitsSchema, type TemplateEntry, type TemplateTraits } from '../src/manifest.js';

const MANIFEST = 'packages/kb/data/templates/template_manifest.json';
const CACHE_DIR = '.cache/templates';
/** Превью в пачке. Больше — дешевле, но длиннее ответ и выше риск сбоя разбора. */
const BATCH = 6;

const BatchSchema = z.object({
  items: z.array(z.object({ index: z.number().int(), traits: TemplateTraitsSchema })),
});

function client(): Anthropic {
  const baseURL = process.env.SEAMSTER_VISION_BASE_URL;
  const apiKey = baseURL
    ? (process.env.SEAMSTER_VISION_KEY ?? process.env.COMETAPI_KEY)
    : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('нет ключа: задайте COMETAPI_KEY или ANTHROPIC_API_KEY');
  return new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

const PROMPT = [
  'Ты — технолог швейного производства. На каждом изображении — технический рисунок',
  'изделия (флэт) из библиотеки шаблонов: контур или залитый силуэт, иногда перед и',
  'спинка на одном листе.',
  '',
  'Для КАЖДОГО изображения определи, что это за изделие. Отвечай строго по схеме,',
  'единственным JSON-объектом, без пояснений и без markdown-ограждений.',
  '',
  'Правила:',
  '— category: одна из наших категорий, если изделие ей соответствует; иначе null,',
  '  а в category_other — что это на самом деле («брюки», «куртка», «кепка»).',
  '  Наши категории: tshirt (футболка), longsleeve (лонгслив), sweatshirt (свитшот',
  '  без капюшона), hoodie (худи-пуловер), zip_hoodie (худи на сквозной молнии),',
  '  polo (поло с воротником и планкой), tank_top (майка без рукавов).',
  '— hoodie против zip_hoodie решает застёжка: сквозная молния спереди — zip_hoodie.',
  '— fit: oversize, если плечи спущены и силуэт объёмный; fitted — если приталенный;',
  '  loose и semi_fitted — промежуточные. Не уверен — ставь null.',
  '— features: короткие пометки на русском («кроп», «реглан», «капюшон на подкладке»,',
  '  «двухцветный», «вид только спинки»). Пусто — пустой массив.',
  '— confidence: high, если изделие узнаётся однозначно.',
].join('\n');

interface Task {
  entry: TemplateEntry;
  key: string;
  media: 'image/png';
  data: string;
}

function cachePath(key: string): string {
  return join(CACHE_DIR, `${key.slice(0, 2)}/${key}.json`);
}

function readCache(key: string): TemplateTraits | null {
  const path = cachePath(key);
  if (!existsSync(path)) return null;
  try {
    return TemplateTraitsSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return null;
  }
}

function writeCache(key: string, traits: TemplateTraits): void {
  const path = cachePath(key);
  mkdirSync(join(CACHE_DIR, key.slice(0, 2)), { recursive: true });
  writeFileSync(path, JSON.stringify(traits, null, 2));
}

async function askBatch(api: Anthropic, model: string, tasks: Task[]): Promise<TemplateTraits[]> {
  const schema = JSON.stringify(z.toJSONSchema(BatchSchema));
  const content: Anthropic.MessageParam['content'] = [];
  tasks.forEach((t, i) => {
    content.push({ type: 'text', text: `Изображение ${i}:` });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: t.media, data: t.data },
    });
  });
  content.push({
    type: 'text',
    text:
      `${PROMPT}\n\nВерни объект по схеме, по одному элементу на каждое изображение, ` +
      `index — номер изображения:\n${schema}`,
  });

  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await api.messages.create({
      model,
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: lastError
            ? [
                ...content,
                { type: 'text' as const, text: `Прошлый ответ не прошёл проверку: ${lastError}` },
              ]
            : content,
        },
      ],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) {
      lastError = 'в ответе нет JSON';
      continue;
    }
    try {
      const parsed = BatchSchema.parse(JSON.parse(text.slice(start, end + 1)));
      const byIndex = new Map(parsed.items.map((i) => [i.index, i.traits]));
      return tasks.map((_, i) => {
        const traits = byIndex.get(i);
        if (!traits) throw new Error(`нет ответа для изображения ${i}`);
        return traits;
      });
    } catch (error) {
      lastError = String(error).slice(0, 300);
    }
  }
  throw new Error(`пачка не разобралась: ${lastError}`);
}

async function main(): Promise<void> {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
    entries: TemplateEntry[];
    [k: string]: unknown;
  };

  const tasks: Task[] = [];
  let cached = 0;
  // Сначала группы, из которых мы уже собираем техпаки: если прогон прервётся
  // или упрётся в бюджет, разобранным окажется то, что нужно продукту сегодня,
  // а не брюки, для которых у нас ещё нет ни шаблона замеров, ни узлов.
  const PRIORITY = ['hoodie_family', 'tshirt_family', 'top_family', 'outerwear_family'];
  const ordered = [...manifest.entries].sort((a, b) => {
    const ai = PRIORITY.indexOf(a.group);
    const bi = PRIORITY.indexOf(b.group);
    return (ai < 0 ? PRIORITY.length : ai) - (bi < 0 ? PRIORITY.length : bi);
  });
  for (const entry of ordered) {
    if (!entry.preview || !existsSync(entry.preview)) continue;
    const bytes = readFileSync(entry.preview);
    const key = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
    const hit = readCache(key);
    if (hit) {
      entry.traits = hit;
      cached++;
      continue;
    }
    if (tasks.length >= limit) continue;
    tasks.push({ entry, key, media: 'image/png', data: bytes.toString('base64') });
  }

  console.log(`из кэша ${cached} · к разбору ${tasks.length}`);
  if (tasks.length === 0) {
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    return;
  }

  const api = client();
  const model = process.env.SEAMSTER_VISION_MODEL ?? 'claude-opus-5';
  let done = 0;
  let failed = 0;
  for (let i = 0; i < tasks.length; i += BATCH) {
    const batch = tasks.slice(i, i + BATCH);
    try {
      const traits = await askBatch(api, model, batch);
      batch.forEach((t, j) => {
        t.entry.traits = traits[j]!;
        writeCache(t.key, traits[j]!);
      });
      done += batch.length;
    } catch (error) {
      failed += batch.length;
      console.log(`пачка ${i / BATCH + 1}: ${String(error).slice(0, 120)}`);
    }
    if ((i / BATCH) % 5 === 0) {
      console.log(`  разобрано ${done} из ${tasks.length}${failed ? `, сбоев ${failed}` : ''}`);
      writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    }
  }

  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  const withTraits = manifest.entries.filter((e) => e.traits).length;
  console.log(`готово: разобрано ${done}, сбоев ${failed}, всего с признаками ${withTraits}`);
}

void main();
