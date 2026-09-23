import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildArtwork, type ArtworkFile, type ArtworkInput } from '@seamster/assembly';
import { kb as defaultKb, type Category, type KnowledgeBase } from '@seamster/kb';
import { parseStyleSpec, type ArtworkPlacement, type StyleSpec } from '@seamster/stylespec';

/**
 * Макеты нанесения пака — то, что задал человек, и файлы, которые он приложил.
 *
 * Спецификация хранит макет уже СОБРАННЫМ: с проверками, предупреждениями и
 * статусами. Собирает его тот же движок, что при генерации (`buildArtwork`),
 * из входа — зоны, техники, сантиметров и файла. Здесь лежит именно вход:
 * правка одного числа пересобирает макет целиком, и проверки разрешения
 * и швов не расходятся с тем, что печатается в документе.
 *
 * Файлы лежат в папке `artwork/` рядом со спекой; размер растра в пикселях
 * читается из заголовка при загрузке — от него считается разрешение на
 * заданный размер отпечатка.
 */
export interface StoredArtwork {
  /** Стабильный идентификатор строки: индексы при удалении плывут. */
  pid: string;
  zone: string;
  technique?: ArtworkInput['technique'];
  width_cm?: number;
  height_cm?: number;
  offset_cm?: number;
  lateral_cm?: number;
  color_count?: number;
  color_codes?: string[];
  file?: ArtworkFile & { path: string; bytes: number };
}

const FILE = 'artwork.json';

export function readArtwork(dir: string): StoredArtwork[] {
  try {
    const raw = JSON.parse(readFileSync(join(dir, FILE), 'utf8')) as { items?: StoredArtwork[] };
    return Array.isArray(raw.items) ? raw.items : [];
  } catch {
    return [];
  }
}

export function writeArtwork(dir: string, items: readonly StoredArtwork[]): void {
  writeFileSync(join(dir, FILE), JSON.stringify({ items }, null, 2));
}

const TECHNIQUES = new Set(['screen', 'dtf', 'dtg', 'sublimation', 'embroidery', 'pigment_roll']);

/**
 * Вход из кабинета → строки хранилища. Файлы берутся из прошлого состояния
 * по идентификатору: кабинет файлами не распоряжается, он их только шлёт.
 */
export function mergeArtworkInput(
  previous: readonly StoredArtwork[],
  incoming: unknown,
  category: Category,
  base: KnowledgeBase = defaultKb(),
): { items: StoredArtwork[]; rejected: string | null } {
  if (!Array.isArray(incoming))
    return { items: [...previous], rejected: 'ожидался список макетов' };
  if (incoming.length > 12)
    return { items: [...previous], rejected: 'не больше 12 макетов на изделие' };
  const zones = new Set(base.printZones(category).map((z) => z.id));
  const num = (v: unknown, min: number, max: number): number | undefined => {
    const n =
      typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v.replace(',', '.')) : NaN;
    if (!Number.isFinite(n)) return undefined;
    return Math.min(max, Math.max(min, Math.round(n * 2) / 2));
  };
  const items: StoredArtwork[] = [];
  for (const raw of incoming as Record<string, unknown>[]) {
    const pid = typeof raw.pid === 'string' && /^[a-z0-9]{4,16}$/.test(raw.pid) ? raw.pid : null;
    const zone = typeof raw.zone === 'string' ? raw.zone : '';
    if (!pid) return { items: [...previous], rejected: 'у макета нет идентификатора' };
    if (!zones.has(zone))
      return { items: [...previous], rejected: `зоны «${zone}» у этой категории нет` };
    const was = previous.find((p) => p.pid === pid);
    const technique =
      typeof raw.technique === 'string' && TECHNIQUES.has(raw.technique)
        ? raw.technique
        : undefined;
    const codes = Array.isArray(raw.color_codes)
      ? raw.color_codes
          .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
          .map((c) => c.trim().slice(0, 30))
          .slice(0, 24)
      : undefined;
    const width = num(raw.width_cm, 1, 120);
    const height = num(raw.height_cm, 1, 120);
    const offset = num(raw.offset_cm, 0, 120);
    const lateral = num(raw.lateral_cm, -60, 60);
    const count = num(raw.color_count, 1, 24);
    const item: StoredArtwork = {
      pid,
      zone,
      ...(technique ? { technique: technique as ArtworkInput['technique'] } : {}),
      ...(width !== undefined ? { width_cm: width } : {}),
      ...(height !== undefined ? { height_cm: height } : {}),
      ...(offset !== undefined ? { offset_cm: offset } : {}),
      ...(lateral !== undefined ? { lateral_cm: lateral } : {}),
      ...(count !== undefined ? { color_count: Math.round(count) } : {}),
      ...(codes?.length ? { color_codes: codes } : {}),
      ...(was?.file ? { file: was.file } : {}),
    };
    items.push(item);
  }
  return { items, rejected: null };
}

/** Строка хранилища → вход движка. */
function toInput(item: StoredArtwork): ArtworkInput {
  return {
    zone: item.zone,
    ...(item.technique ? { technique: item.technique } : {}),
    ...(item.width_cm !== undefined ? { width_cm: item.width_cm } : {}),
    ...(item.height_cm !== undefined ? { height_cm: item.height_cm } : {}),
    ...(item.offset_cm !== undefined ? { offset_cm: item.offset_cm } : {}),
    ...(item.lateral_cm !== undefined ? { lateral_cm: item.lateral_cm } : {}),
    ...(item.color_count !== undefined ? { color_count: item.color_count } : {}),
    ...(item.color_codes ? { color_codes: item.color_codes } : {}),
    ...(item.file
      ? {
          file: {
            name: item.file.name,
            format: item.file.format,
            ...(item.file.pixels ? { pixels: item.file.pixels } : {}),
            ...(item.file.transparent !== undefined ? { transparent: item.file.transparent } : {}),
          },
        }
      : {}),
  };
}

/**
 * Пересобрать раздел нанесения спеки из строк хранилища.
 *
 * Сплошные раппорты (kind: allover) приходят из анкеты при генерации и здесь
 * не трогаются: они остаются в конце списка под следующими номерами.
 */
export function applyArtwork(
  spec: StyleSpec,
  items: readonly StoredArtwork[],
  base: KnowledgeBase = defaultKb(),
): { spec: StyleSpec; placements: ArtworkPlacement[]; notes: string[] } {
  const category = spec.style.category as Category;
  const shell = spec.bom?.lines.find((l) => l.role === 'shell');
  const allover = (spec.artwork?.placements ?? []).filter((a) => a.kind === 'allover');
  const built =
    items.length > 0
      ? buildArtwork(
          {
            category,
            placements: items.map(toInput),
            ...(shell ? { fabric_class: shell.material_id } : {}),
            ...(spec.bom?.batch_qty ? { quantity: spec.bom.batch_qty } : {}),
            ...(spec.bom?.batch_consumption_m
              ? { batch_consumption_m: spec.bom.batch_consumption_m }
              : {}),
          },
          base,
        )
      : null;
  const placements = [
    ...(built?.artwork.placements ?? []),
    ...allover.map((a, i) => ({ ...a, id: `A${items.length + i + 1}` })),
  ];
  const next: StyleSpec = parseStyleSpec({
    ...spec,
    ...(placements.length
      ? {
          artwork: {
            placements,
            subcontracted: spec.artwork?.subcontracted ?? built?.artwork.subcontracted ?? true,
          },
        }
      : { artwork: undefined }),
  });
  return { spec: next, placements, notes: built?.notes ?? [] };
}

// ------------------------------------------------------------- файлы

export interface ImageInfo {
  format: string;
  pixels?: { width: number; height: number };
  transparent?: boolean;
}

/**
 * Формат и размер растра — из заголовка файла, без декодирования.
 *
 * PNG: IHDR несёт ширину, высоту и тип цвета (4 и 6 — с альфой). JPEG:
 * первый маркер SOF. SVG — вектор: пикселей нет, и это хорошо. Остальное
 * не принимается: печатнику нужен файл, который он сможет открыть.
 */
export function imageInfo(bytes: Buffer, name: string): ImageInfo | null {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    const colorType = bytes.length > 25 ? bytes[25]! : 0;
    return {
      format: 'png',
      pixels: { width, height },
      transparent: colorType === 4 || colorType === 6,
    };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = bytes.readUInt16BE(i + 2);
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        return {
          format: 'jpg',
          pixels: { width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5) },
          transparent: false,
        };
      }
      i += 2 + len;
    }
    return { format: 'jpg', transparent: false };
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { format: 'webp' };
  }
  const head = bytes.subarray(0, 512).toString('utf8');
  if (ext === 'svg' || /<svg[\s>]/i.test(head)) return { format: 'svg' };
  if (ext === 'pdf' && head.startsWith('%PDF')) return { format: 'pdf' };
  return null;
}

/** Безопасное имя файла на диске: латиница, цифры, точка и дефис. */
function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'artwork';
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || 'artwork';
}

export function saveArtworkFile(
  dir: string,
  items: StoredArtwork[],
  pid: string,
  bytes: Buffer,
  originalName: string,
): { items: StoredArtwork[]; rejected: string | null } {
  const item = items.find((p) => p.pid === pid);
  if (!item) return { items, rejected: 'такого макета нет' };
  const info = imageInfo(bytes, originalName);
  if (!info)
    return {
      items,
      rejected: 'Формат не разобран: нужен PNG, JPG, WebP, SVG или PDF.',
    };
  mkdirSync(join(dir, 'artwork'), { recursive: true });
  if (item.file?.path) rmSync(join(dir, item.file.path), { force: true });
  const path = join('artwork', `${pid}-${safeName(originalName)}`);
  writeFileSync(join(dir, path), bytes);
  item.file = {
    name: originalName.split(/[\\/]/).pop()?.slice(0, 120) || 'artwork',
    format: info.format,
    ...(info.pixels ? { pixels: info.pixels } : {}),
    ...(info.transparent !== undefined ? { transparent: info.transparent } : {}),
    path,
    bytes: bytes.length,
  };
  return { items, rejected: null };
}

export function removeArtworkFiles(dir: string, item: StoredArtwork | undefined): void {
  if (item?.file?.path) rmSync(join(dir, item.file.path), { force: true });
}

/** Файл макета — как data URI для документа; null, если файла нет или он не картинка. */
export function artworkFileDataUri(dir: string, item: StoredArtwork): string | null {
  if (!item.file?.path) return null;
  const full = join(dir, item.file.path);
  if (!existsSync(full)) return null;
  const mime: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  };
  const type = mime[item.file.format];
  if (!type) return null;
  return `data:${type};base64,${readFileSync(full).toString('base64')}`;
}
