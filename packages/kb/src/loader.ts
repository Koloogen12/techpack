import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SpecFormError } from '@specform/core';
import type { z } from 'zod';
import {
  EaseFileSchema,
  GradingFileSchema,
  PomTemplateFileSchema,
  SizeChartsFileSchema,
  ToleranceClassesFileSchema,
  type Category,
  type EaseEntry,
  type EaseFile,
  type FabricKind,
  type FitIntent,
  type Gender,
  type GradingFile,
  type GradingRule,
  type PomTemplateFile,
  type SizeChart,
  type SizeChartsFile,
  type ToleranceClass,
  type ToleranceClassEntry,
  type ToleranceClassesFile,
} from './schemas/index.js';

const DATA_DIR = new URL('../data/', import.meta.url).pathname;

/** Посадки от прилегающей к свободной. Порядок задаёт направление отката. */
const FIT_ORDER: readonly FitIntent[] = ['fitted', 'semi_fitted', 'loose', 'oversize'];

function loadFile<T>(relativePath: string, schema: z.ZodType<T>): T {
  const path = join(DATA_DIR, relativePath);

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new SpecFormError('KB_MISSING', `справочник не найден: ${relativePath}`, {
      userMessage: 'Внутренняя ошибка: не удалось загрузить справочник.',
      userAction: 'Повторить генерацию. Если повторяется — напишите нам, это на нашей стороне.',
      details: { path: relativePath },
      cause,
    });
  }

  const parsed = schema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    // Справочник с ошибкой не грузится молча: битые данные дороже упавшего процесса.
    throw new SpecFormError('KB_INVALID', `справочник ${relativePath} не прошёл валидацию`, {
      userMessage: 'Внутренняя ошибка: справочник повреждён.',
      userAction: 'Повторить генерацию. Если повторяется — напишите нам, это на нашей стороне.',
      details: { path: relativePath, issues: JSON.stringify(parsed.error.issues, null, 2) },
    });
  }
  return parsed.data;
}

export interface EaseLookup {
  readonly entry: EaseEntry;
  /**
   * Заполнено, если для запрошенной посадки данных нет и движок откатился
   * к соседней. Вызывающий обязан объяснить это пользователю, а не молчать.
   */
  readonly fallbackFrom?: FitIntent;
}

/**
 * Справочники в памяти.
 *
 * Грузятся один раз на процесс: файлов немного, объём мал, а перечитывание
 * на каждый запрос дало бы разные данные внутри одной генерации.
 */
export class KnowledgeBase {
  private constructor(
    private readonly tolerances: ToleranceClassesFile,
    private readonly sizes: SizeChartsFile,
    private readonly ease: EaseFile,
    private readonly grading: GradingFile,
    private readonly pomTemplates: ReadonlyMap<Category, PomTemplateFile>,
  ) {}

  static load(): KnowledgeBase {
    const pom = new Map<Category, PomTemplateFile>();
    // Категории добавляются по мере готовности шаблонов; гейт вне MVP —
    // в мастере, а не здесь: отсутствующий шаблон обязан падать явно.
    for (const category of ['tshirt'] as const) {
      pom.set(category, loadFile(`pom_templates/${category}.json`, PomTemplateFileSchema));
    }

    return new KnowledgeBase(
      loadFile('tolerance_classes.json', ToleranceClassesFileSchema),
      loadFile('size_charts_ru.json', SizeChartsFileSchema),
      loadFile('ease_defaults.json', EaseFileSchema),
      loadFile('grading_increments.json', GradingFileSchema),
      pom,
    );
  }

  /** Категории, для которых есть шаблон точек измерения. */
  supportedCategories(): readonly Category[] {
    return [...this.pomTemplates.keys()];
  }

  toleranceClass(name: ToleranceClass): ToleranceClassEntry {
    const found = this.tolerances.classes.find((c) => c.class === name);
    if (!found) throw new Error(`неизвестный класс допуска: ${name}`);
    return found;
  }

  /** Допуск по умолчанию для класса точки, ±см. */
  toleranceFor(name: ToleranceClass, fabric: FabricKind): number {
    const cls = this.toleranceClass(name);
    return fabric === 'knit' ? cls.knit.default : cls.woven.default;
  }

  sizeChart(gender: Gender): SizeChart {
    const found = this.sizes.charts.find((c) => c.gender === gender);
    if (!found) throw new Error(`нет размерной сетки для: ${gender}`);
    return found;
  }

  /** Обхваты тела по российскому размеру. */
  bodyMeasurements(gender: Gender, ru: number) {
    const chart = this.sizeChart(gender);
    const row = chart.rows.find((r) => r.ru === ru);
    if (!row) {
      const available = chart.rows.map((r) => r.ru).join(', ');
      throw new SpecFormError('SPEC_INVALID', `размер ${ru} отсутствует в сетке ${gender}`, {
        userMessage: `Размера ${ru} нет в нашей размерной сетке.`,
        userAction: `Выберите размер из доступных: ${available}`,
        details: { gender, ru, available },
      });
    }
    return row;
  }

  /**
   * Прибавка на свободу облегания.
   *
   * Если для запрошенной посадки данных нет (например, прилегающее худи —
   * в базе знаний помечено как нетиповое), откатывается к ближайшей более
   * свободной и сообщает об этом через fallbackFrom.
   */
  easeFor(category: Category, fit: FitIntent, fabric: FabricKind): EaseLookup {
    const exact = this.ease.entries.find(
      (e) => e.category === category && e.fit === fit && e.fabric === fabric,
    );
    if (exact) return { entry: exact };

    const startIndex = FIT_ORDER.indexOf(fit);
    for (const candidate of FIT_ORDER.slice(startIndex + 1)) {
      const looser = this.ease.entries.find(
        (e) => e.category === category && e.fit === candidate && e.fabric === fabric,
      );
      if (looser) return { entry: looser, fallbackFrom: fit };
    }

    throw new SpecFormError('KB_MISSING', `нет прибавки для ${category}/${fit}/${fabric}`, {
      userMessage: 'Для этого сочетания категории и посадки у нас пока нет типовых значений.',
      userAction: 'Выберите другую посадку или напишите нам — добавим.',
      details: { category, fit, fabric },
    });
  }

  gradingRule(key: string): GradingRule {
    const found = this.grading.rules.find((r) => r.key === key);
    if (!found) throw new Error(`неизвестное правило градации: ${key}`);
    return found;
  }

  /** Межразмерный шаг по обхвату груди, см. */
  chestStep(): number {
    return this.grading.chest_step;
  }

  pomTemplate(category: Category): PomTemplateFile {
    const found = this.pomTemplates.get(category);
    if (!found) {
      throw new SpecFormError('CATEGORY_UNSUPPORTED', `нет шаблона POM для ${category}`, {
        userMessage: 'Для этой категории мы пока не делаем техпаки.',
        userAction: 'Выберите категорию из доступных или запишитесь в лист ожидания',
        details: { category, supported: this.supportedCategories().join(', ') },
      });
    }
    return found;
  }

  /**
   * Все непроверенные записи справочников.
   *
   * Список — рабочий бэклог верификации (CTO-SPEC.md §5): приоритет по частоте
   * использования значения. Он же не даёт забыть, что часть базы — экспертная оценка.
   */
  unverified(): { book: string; key: string; gap: string }[] {
    const out: { book: string; key: string; gap: string }[] = [];
    const push = (book: string, key: string, gap: string | undefined) => {
      if (gap) out.push({ book, key, gap });
    };

    for (const c of this.tolerances.classes)
      if (!c.verified) push('tolerance_classes', c.class, c.gap);
    for (const chart of this.sizes.charts) {
      for (const r of chart.rows) {
        if (!r.verified) push('size_charts_ru', `${chart.gender}/${r.ru}`, r.gap);
      }
    }
    for (const e of this.ease.entries) {
      if (!e.verified) push('ease_defaults', `${e.category}/${e.fit}/${e.fabric}`, e.gap);
    }
    for (const r of this.grading.rules) if (!r.verified) push('grading_increments', r.key, r.gap);
    for (const [category, tpl] of this.pomTemplates) {
      for (const p of tpl.points) {
        if (!p.verified) push(`pom_templates/${category}`, p.code, p.gap);
      }
    }
    return out;
  }
}

let cached: KnowledgeBase | undefined;

/** Справочники процесса. Загружаются лениво и переиспользуются. */
export function kb(): KnowledgeBase {
  cached ??= KnowledgeBase.load();
  return cached;
}
