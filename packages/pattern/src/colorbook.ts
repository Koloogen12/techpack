import { deltaE, rgbToLab, type DominantColor } from './colors.js';

/**
 * Подбор ближайшего цвета по каталогу красок.
 *
 * ВАЖНО ПРО PANTONE. Каталоги Pantone — лицензируемые данные, а не открытый
 * справочник: и сами номера, и их координаты защищены, и поставлять таблицу
 * «номер → цвет» в составе продукта нельзя. Крупные редакторы убирали
 * поддержку Pantone именно по этой причине.
 *
 * Поэтому здесь механизм, а не данные. Каталог подключается извне: бренд
 * или печатник загружает тот, на который у него есть право, и подбор
 * работает по нему. Без каталога документ показывает то, что мы измерили
 * САМИ и вправе показывать — hex, координаты Lab и долю площади.
 *
 * Ходящие по сети «таблицы Pantone в RGB» брать нельзя по двум причинам
 * сразу, и они указывают в одну сторону: у них нет прослеживаемого
 * происхождения, и они неточны. Подставить их значило бы нарушить и право,
 * и собственное правило — не выдавать непроверенное за проверенное.
 */

export interface ColorBookEntry {
  /** Код краски в каталоге: «19-4052 TCX», «186 C». */
  code: string;
  name?: string | undefined;
  /** sRGB-координаты записи каталога. */
  rgb: [number, number, number];
}

export interface ColorBook {
  id: string;
  label_ru: string;
  /** Кто владелец каталога и на каком основании он здесь. */
  license_note_ru: string;
  entries: readonly ColorBookEntry[];
}

export interface ColorMatch {
  /** Измеренный нами цвет. Есть всегда. */
  measured: DominantColor;
  /** Ближайшая краска каталога. null — каталог не подключён. */
  book: { code: string; name?: string | undefined; delta_e: number } | null;
}

/**
 * Насколько далеко подбор считается попаданием.
 *
 * ΔE около 2 — предел различимости глазом, 5 — заметная, но приемлемая
 * для текстиля разница. Дальше подбор перестаёт быть подбором: печатник
 * увидит другой цвет и справедливо спросит, зачем ему этот номер.
 */
export const MATCH_LIMIT_DELTA_E = 5;

export function matchColors(
  colors: readonly DominantColor[],
  book?: ColorBook,
): { matches: ColorMatch[]; notes: string[] } {
  if (!book || book.entries.length === 0) {
    return {
      matches: colors.map((measured) => ({ measured, book: null })),
      notes: [
        'Каталог красок не подключён, поэтому в документе указаны измеренные ' +
          'координаты цвета (hex и Lab), а не номера по каталогу. Номера Pantone ' +
          'мы не подставляем: это лицензируемые данные, и таблица «номер → цвет» ' +
          'не может поставляться в составе продукта. Печатник подберёт номер ' +
          'по этим координатам за минуту — либо подключите каталог, на который ' +
          'у вас есть право.',
      ],
    };
  }

  const notes: string[] = [];
  const matches = colors.map((measured) => {
    let best: ColorBookEntry | null = null;
    let bestDelta = Infinity;
    for (const entry of book.entries) {
      const d = deltaE(measured.lab, rgbToLab(entry.rgb));
      if (d < bestDelta) {
        bestDelta = d;
        best = entry;
      }
    }
    if (!best) return { measured, book: null };
    return {
      measured,
      book: { code: best.code, name: best.name, delta_e: bestDelta },
    };
  });

  const far = matches.filter((m) => m.book && m.book.delta_e > MATCH_LIMIT_DELTA_E);
  if (far.length) {
    // Молча показать далёкий номер значит отправить печатника красить
    // не тем. Расхождение обязано быть видно рядом с номером.
    notes.push(
      `У ${far.length} из ${matches.length} цветов ближайшая краска каталога ` +
        `«${book.label_ru}» отличается заметно (ΔE больше ${MATCH_LIMIT_DELTA_E}): ` +
        `${far.map((m) => `${m.measured.hex} → ${m.book!.code} (ΔE ${m.book!.delta_e})`).join(', ')}. ` +
        `Либо каталог не содержит нужного оттенка, либо цвет придётся смешивать — ` +
        `решать печатнику, а не нам.`,
    );
  }

  return { matches, notes };
}
