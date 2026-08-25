import { assume, fromBase, roundCm, userInput, type Tracked } from '@specform/core';
import {
  kb as defaultKb,
  type Category,
  type KnowledgeBase,
  type PrintTechnique,
} from '@specform/kb';
import type { Artwork, ArtworkCheck, ArtworkPlacement } from '@specform/stylespec';

/**
 * Движок нанесения: где печатать, чем печатать и годится ли присланный файл.
 *
 * Три вещи, на которых спотыкается заказ с принтом, и все три решаются
 * до отправки на фабрику:
 *
 * 1. Положение макета указано словами. «По центру груди» печатник отмерить
 *    не может: он кладёт изделие на плиту и берёт рулетку. Поэтому положение
 *    всегда в сантиметрах от высшей точки плеча и от середины переда
 *    (knowledge-base/02 §3).
 * 2. Техника выбрана не под полотно. Сублимация на хлопке не закрепляется
 *    вообще — это химия, а не предпочтение печатника.
 * 3. Файл приходит без физического размера. Печатник спрашивает «в каких
 *    сантиметрах?», теряется день, и так по кругу.
 *
 * Нанесение выполняет ОТДЕЛЬНЫЙ подрядчик, а не швейный цех
 * (knowledge-base/07 §3), поэтому спецификация уходит ему отдельным листом.
 */

/**
 * Что заказчик сообщил о макете. Всё, кроме зоны, необязательно.
 *
 * Необязательные поля объявлены с явным `| undefined`: тип приходит с границы
 * JSON, где zod выводит именно такую форму, и притворяться, что поля просто
 * нет, значит ловить это несоответствие на каждом вызове.
 */
export interface ArtworkInput {
  zone: string;
  /** Явно выбранная техника. Не указана — подбираем по полотну и тиражу. */
  technique?: PrintTechnique | undefined;
  /** Размер отпечатка, см. Не указан — берём типовой для зоны предположением. */
  width_cm?: number | undefined;
  height_cm?: number | undefined;
  /** Отступ от опорной точки, см. */
  offset_cm?: number | undefined;
  /** Число плашечных цветов, если заказчик его знает. */
  color_count?: number | undefined;
  /** Коды цветов — Pantone или иные. Мы их не выдумываем. */
  color_codes?: readonly string[] | undefined;
  /** Присланный файл макета. */
  file?: ArtworkFile | undefined;
}

export interface ArtworkFile {
  name: string;
  /** Расширение без точки: png, svg, pdf, ai, jpg. */
  format: string;
  /** Размер растра в пикселях. Для вектора не заполняется. */
  pixels?: { width: number; height: number } | undefined;
  /** Есть ли прозрачный фон. Неизвестно — не заполняется. */
  transparent?: boolean | undefined;
}

export interface ArtworkEngineInput {
  category: Category;
  /** Класс полотна — от него зависит, какая техника вообще ляжет. */
  fabric_class?: string;
  /** Тираж. Определяет, какая техника осмысленна по деньгам. */
  quantity?: number;
  /** Цвет полотна светлый. Нужен для сублимации: краситель прозрачен. */
  light_fabric?: boolean;
  placements: readonly ArtworkInput[];
}

export interface ArtworkResult {
  artwork: Artwork;
  notes: string[];
}

/**
 * Минимальное разрешение отпечатка, точек на дюйм.
 *
 * 300 — типографская норма, ниже неё видно растр вблизи. 150 — граница,
 * за которой отпечаток заметно мылит на расстоянии вытянутой руки.
 * Значения отраслевые: печатник назовёт те же.
 */
const DPI_GOOD = 300;
const DPI_WARN = 150;

const CM_PER_INCH = 2.54;

/** Полиэфирные полотна: на них ложится сублимация, на остальных — нет. */
const POLYESTER_CLASSES = new Set(['pique']);

export function buildArtwork(
  input: ArtworkEngineInput,
  base: KnowledgeBase = defaultKb(),
): ArtworkResult | null {
  if (input.placements.length === 0) return null;

  const notes: string[] = [];
  const placements = input.placements.map((p, i) => placement(p, i, input, notes, base));

  return {
    artwork: { placements, subcontracted: true },
    notes: [
      ...notes,
      'Нанесение выполняет отдельный подрядчик, а не швейный цех. Спецификация ' +
        'нанесения выгружается отдельным листом — отправьте её печатнику вместе ' +
        'с файлом макета.',
    ],
  };
}

function placement(
  input: ArtworkInput,
  index: number,
  ctx: ArtworkEngineInput,
  notes: string[],
  base: KnowledgeBase,
): ArtworkPlacement {
  const zone = base.printZone(input.zone);
  const warnings: string[] = [zone.seam_note_ru];

  if (!zone.applies_to.includes(ctx.category)) {
    // Не бросаем: зона на чужой категории — ошибка ввода, а не сбой движка,
    // и документ полезнее с предупреждением, чем не собранный вовсе.
    warnings.push(
      `Зона «${zone.label_ru}» у этой категории не предусмотрена — проверьте, ` +
        `туда ли ставится макет.`,
    );
  }

  const technique = pickTechnique(input.technique, ctx, notes, base);
  const entry = base.printTechnique(technique.value);

  const width = size(input.width_cm, zone.typical_size_cm.width, `${zone.label_ru}, ширина`);
  const height = size(input.height_cm, zone.typical_size_cm.height, `${zone.label_ru}, высота`);

  const offset =
    input.offset_cm !== undefined
      ? userInput(roundCm(input.offset_cm), 'user:artwork.offset_cm')
      : assume(
          zone.typical_offset_cm,
          `kb:print_zones#${zone.id}.typical_offset_cm`,
          'типовой отступ для зоны — задайте свой, иначе печатник поставит макет по-своему',
        );

  const colors = colorSpec(input, entry, warnings);

  return {
    id: `A${index + 1}`,
    zone: zone.id,
    zone_label_ru: zone.label_ru,
    technique,
    technique_label_ru: entry.label_ru,
    offset_from_anchor_cm: offset,
    anchor_label_ru:
      zone.anchor === 'hps' ? 'от высшей точки плеча вниз' : 'от плечевого шва вниз по рукаву',
    size_cm: { width, height },
    colors,
    file_name: input.file?.name ?? null,
    checks: checkFile(input.file, width.value, height.value, entry, warnings),
    warnings_ru: warnings,
  };
}

/** Размер отпечатка: свой — уважаем, типовой — помечаем предположением. */
function size(given: number | undefined, typical: number, what: string): Tracked<number> {
  return given !== undefined
    ? userInput(roundCm(given), 'user:artwork.size_cm')
    : assume(
        typical,
        'kb:print_zones#typical_size_cm',
        `типовой размер для зоны «${what}» — укажите свой, иначе печатник напечатает этот`,
      );
}

/**
 * Подбор техники.
 *
 * Сначала отсекается то, что не ляжет физически, и только потом выбирается
 * дешёвое. Обратный порядок дал бы сублимацию на хлопке — самый дешёвый
 * и совершенно нерабочий вариант.
 */
function pickTechnique(
  chosen: PrintTechnique | undefined,
  ctx: ArtworkEngineInput,
  notes: string[],
  base: KnowledgeBase,
): Tracked<PrintTechnique> {
  const polyester = ctx.fabric_class !== undefined && POLYESTER_CLASSES.has(ctx.fabric_class);

  const fits = (id: PrintTechnique): boolean => {
    const t = base.printTechnique(id);
    if (t.fabric.fibers.includes('cotton') && t.fabric.fibers.length === 1 && polyester) {
      return false;
    }
    if (t.fabric.fibers.length === 1 && t.fabric.fibers[0] === 'polyester' && !polyester) {
      return false;
    }
    if (t.fabric.light_fabric_only && ctx.light_fabric === false) return false;
    return true;
  };

  if (chosen) {
    if (!fits(chosen)) {
      const t = base.printTechnique(chosen);
      notes.push(
        `Техника «${t.label_ru}» не ложится на выбранное полотно: ${t.not_suitable_ru[0]}. ` +
          `Она оставлена в документе по вашему выбору — подтвердите у печатника ` +
          `до запуска, иначе партия уйдёт в брак.`,
      );
    }
    return userInput(chosen, 'user:artwork.technique');
  }

  const qty = ctx.quantity ?? 1;
  // Из подходящих берём ту, что осмысленна на этом тираже; при равенстве —
  // с меньшим порогом, то есть более щадящую к малой партии.
  const candidates = base
    .printTechniques()
    .filter((t) => fits(t.id))
    .filter((t) => t.economical_from_qty <= qty)
    .sort((a, b) => b.economical_from_qty - a.economical_from_qty);

  const pick = candidates[0] ?? base.printTechnique('dtf');
  return fromBase(
    pick.id,
    `kb:print_techniques#${pick.id}`,
    `подобрано по полотну и тиражу ${qty} шт — согласуйте с печатником, ` +
      `у каждого свой парк и свой прайс`,
  );
}

function colorSpec(
  input: ArtworkInput,
  entry: { colors: { model: 'spot' | 'full'; max_spot_colors: number | null }; label_ru: string },
  warnings: string[],
): ArtworkPlacement['colors'] {
  const codes = [...(input.color_codes ?? [])];

  if (entry.colors.model === 'full') {
    if (input.color_count !== undefined) {
      warnings.push(
        `Число цветов для «${entry.label_ru}» значения не имеет: техника полноцветная. ` +
          `Ограничение по цветам появляется только у плашечной печати.`,
      );
    }
    return { model: 'full', count: null, codes };
  }

  const max = entry.colors.max_spot_colors ?? 1;
  if (input.color_count === undefined) {
    return {
      model: 'spot',
      count: assume(
        1,
        'engine:artwork/colors',
        'число цветов не указано — принято за один. Каждый цвет плашечной печати ' +
          'это отдельная сетка и отдельные деньги, уточните до просчёта',
      ),
      codes,
    };
  }

  if (input.color_count > max) {
    warnings.push(
      `Цветов ${input.color_count} при пределе ${max} для «${entry.label_ru}». ` +
        `Либо сокращайте палитру, либо переходите на полноцветную технику.`,
    );
  }

  return {
    model: 'spot',
    count: userInput(input.color_count, 'user:artwork.color_count'),
    codes,
  };
}

/**
 * Светофор по файлу макета.
 *
 * Ровно те вопросы, которые печатник задаёт в ответном письме. Каждый возврат
 * файла стоит дня переписки, а вопросы всегда одни и те же.
 */
function checkFile(
  file: ArtworkFile | undefined,
  widthCm: number,
  heightCm: number,
  entry: { id: PrintTechnique; label_ru: string },
  warnings: string[],
): ArtworkCheck[] {
  if (!file) {
    return [
      {
        id: 'file_present',
        label_ru: 'Файл макета',
        status: 'fail',
        detail_ru:
          'Макет не приложен. Без файла печатник не начнёт — спецификация ниже ' +
          'описывает, каким он должен быть.',
      },
    ];
  }

  const checks: ArtworkCheck[] = [
    {
      id: 'file_present',
      label_ru: 'Файл макета',
      status: 'ok',
      detail_ru: `${file.name} — приложен к пакету.`,
    },
  ];

  const vector = ['svg', 'ai', 'eps', 'pdf'].includes(file.format.toLowerCase());
  checks.push({
    id: 'vector',
    label_ru: 'Вектор или растр',
    status: vector ? 'ok' : 'warn',
    detail_ru: vector
      ? `${file.format.toUpperCase()} — вектор: масштабируется без потерь, ` +
        `размер отпечатка можно менять свободно.`
      : `${file.format.toUpperCase()} — растр: качество зависит от размера отпечатка, ` +
        `увеличить без потерь нельзя.`,
  });

  // Физический размер — главный вопрос печатника. Он у нас есть всегда:
  // либо от заказчика, либо типовым для зоны, и в таблице видно, откуда.
  checks.push({
    id: 'physical_size',
    label_ru: 'Размер отпечатка',
    status: 'ok',
    detail_ru: `${widthCm} × ${heightCm} см — задан в спецификации, спрашивать не нужно.`,
  });

  if (file.pixels && !vector) {
    // Эффективное разрешение считается НА ЗАДАННЫЙ размер отпечатка:
    // «файл 300 dpi» само по себе ничего не значит, пока не сказано,
    // до каких сантиметров его растягивают.
    const dpi = Math.round(file.pixels.width / (widthCm / CM_PER_INCH));
    const status = dpi >= DPI_GOOD ? 'ok' : dpi >= DPI_WARN ? 'warn' : 'fail';
    checks.push({
      id: 'dpi',
      label_ru: 'Разрешение на этот размер',
      status,
      detail_ru:
        `${file.pixels.width} px на ширину ${widthCm} см — это ${dpi} dpi. ` +
        (status === 'ok'
          ? 'Достаточно для печати.'
          : status === 'warn'
            ? `Ниже типографских ${DPI_GOOD} dpi: вблизи будет видно растр. ` +
              `Либо уменьшите отпечаток, либо пришлите файл крупнее.`
            : `Ниже ${DPI_WARN} dpi: отпечаток выйдет мыльным. Нужен файл крупнее ` +
              `или вектор.`),
    });
    if (status === 'fail') {
      warnings.push(
        `Разрешение макета не годится для отпечатка ${widthCm} × ${heightCm} см — ` +
          `печать в таком виде даст брак.`,
      );
    }
  }

  if (file.transparent !== undefined) {
    checks.push({
      id: 'transparency',
      label_ru: 'Фон',
      status: file.transparent ? 'ok' : 'warn',
      detail_ru: file.transparent
        ? 'Фон прозрачный — печатается только рисунок.'
        : 'Фон непрозрачный: он напечатается прямоугольником вокруг рисунка. ' +
          'Если это не задумано, пришлите файл с прозрачностью.',
    });
  }

  if (entry.id === 'embroidery') {
    checks.push({
      id: 'embroidery_program',
      label_ru: 'Программа вышивки',
      status: 'warn',
      detail_ru:
        'Вышивка печатается не с картинки: под макет готовится программа (пробивка), ' +
        'и это отдельная работа вышивального участка. Заложите её в срок и в цену.',
    });
  }

  return checks;
}
