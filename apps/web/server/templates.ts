import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { kb, ZONE_LABEL_EN, ZONE_LABEL_RU, ZONE_LABEL_ZH, type NodeZone } from '@seamsterly/kb';
import { flatDefaults, renderFlatsFromSpec } from '@seamsterly/flats';
import { messages, type Locale } from '@seamsterly/i18n';

/** Подписи зон по языкам комплекта. */
const ZONE_LABEL: Record<Locale, Record<NodeZone, string>> = {
  ru: ZONE_LABEL_RU,
  en: ZONE_LABEL_EN,
  zh: ZONE_LABEL_ZH,
};
import {
  candidateViews,
  notePromotion,
  proposeTemplates,
  renderChosenTemplate,
  type CandidateView,
} from '@seamsterly/templates';
import type { StyleSpec } from '@seamsterly/stylespec';

/**
 * Силуэт джобы: чем нарисован её чертёж и чем его можно заменить.
 *
 * Хранится файлом рядом со спекой — как и всё остальное в этом сервере.
 * Файл можно открыть глазами, и по нему видно, откуда взялся чертёж:
 * вопрос «почему тут другой карман» задают чаще всего именно про него.
 */
export interface JobTemplate {
  /** Идентификатор силуэта. Пусто — чертёж построен параметрически. */
  id: string | null;
  /** Чем можно заменить: топ подбора на момент генерации. */
  candidates: CandidateView[];
  /** Выбрал ли силуэт человек. Ложь — подобрано автоматически. */
  chosen_by_user: boolean;
}

const FILE = 'template.json';

export function readJobTemplate(dir: string): JobTemplate {
  const path = join(dir, FILE);
  if (!existsSync(path)) return { id: null, candidates: [], chosen_by_user: false };
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as JobTemplate;
  } catch {
    return { id: null, candidates: [], chosen_by_user: false };
  }
}

export function writeJobTemplate(dir: string, value: JobTemplate): void {
  writeFileSync(join(dir, FILE), JSON.stringify(value, null, 2));
}

/**
 * Зоны, где у изделия есть работа.
 *
 * Выноска стоит там, где есть узел обработки. Узел без линии шва
 * (вшить ярлык) геометрии на чертеже не имеет и зону не запрашивает.
 */
export function zonesOfSpec(spec: StyleSpec): NodeZone[] {
  const base = kb();
  return [
    ...new Set(
      (spec.construction?.nodes ?? [])
        .filter((n) => base.node(n.node_id).flat_line !== null)
        .map((n) => n.zone as NodeZone)
        .filter((z) => z !== 'labels'),
    ),
  ];
}

/**
 * Отрисовка силуэта джобы под её табель мер.
 *
 * Чистая геометрия: браузер не нужен, поэтому её можно звать и при выдаче
 * PDF, и при показе экрана чертежа, не платя за запуск playwright.
 */
export function renderJobTemplate(
  spec: StyleSpec,
  templateId: string,
  locale: Locale = 'ru',
): ReturnType<typeof renderChosenTemplate> {
  return renderChosenTemplate(templateId, renderOptions(spec, locale));
}

/** Настройки отрисовки силуэта под конкретный табель мер. */
function renderOptions(spec: StyleSpec, locale: Locale = 'ru'): Parameters<typeof renderChosenTemplate>[1] {
  const master = renderFlatsFromSpec(spec, flatDefaults(spec));
  const at = (code: string): number | undefined =>
    spec.measurements.points.find((p) => p.code === code)?.base.value;
  const bodyWidthCm = at('T03') ?? at('T05') ?? 51;
  const bodyLengthCm = at('T01') ?? 70;
  return {
    targetWidthCm: master.front.viewBox.width,
    targetHeightCm: master.front.viewBox.height,
    bodyWidthCm,
    bodyRatio: bodyWidthCm / bodyLengthCm,
    disclaimer: messages(locale).flats_library_disclaimer,
    zones: zonesOfSpec(spec),
    zoneLabel: (z) => ZONE_LABEL[locale][z],
  };
}

/**
 * Кандидаты на замену, пересчитанные по текущей спеке.
 *
 * Только те, которые действительно встанут: предложить силуэт и отказать
 * при клике хуже, чем не предлагать.
 */
export function candidatesFor(spec: StyleSpec): CandidateView[] {
  const master = renderFlatsFromSpec(spec, flatDefaults(spec));
  return candidateViews(
    proposeTemplates(spec, {
      aspect: master.front.viewBox.width / master.front.viewBox.height,
      top: 6,
    }),
    renderOptions(spec),
  ).slice(0, 3);
}

/**
 * Замена силуэта по выбору человека.
 *
 * Возвращает null, если названный силуэт не годится под этот табель — тогда
 * лучше оставить прежний чертёж, чем подменить его непохожим.
 */
export function replaceJobTemplate(
  dir: string,
  spec: StyleSpec,
  templateId: string,
): JobTemplate | null {
  if (!renderJobTemplate(spec, templateId)) return null;
  const current = readJobTemplate(dir);
  const next: JobTemplate = {
    id: templateId,
    candidates: current.candidates.length ? current.candidates : candidatesFor(spec),
    chosen_by_user: true,
  };
  writeJobTemplate(dir, next);
  // Счётчик выборов — очередь на разметку контрольных точек: силуэт,
  // который выбирают руками чаще прочих, заслуживает переезда в мастера.
  notePromotion(templateId);
  return next;
}
