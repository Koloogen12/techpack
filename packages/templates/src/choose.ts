import type { NodeZone } from '@seamster/kb';
import type { StyleSpec } from '@seamster/stylespec';
import type { VisionReport } from '@seamster/vision';
import {
  MAX_PROPORTION_DRIFT,
  renderLibraryView,
  type LibraryRenderOptions,
  type LibraryRenderResult,
} from './library.js';
import type { SilhouetteDetails } from './zones.js';
import { catalogedEntries, findTemplate, readTemplateSvg } from './load.js';
import { isConfident, matchTemplates, type MatchCandidate, type MatchResult } from './match.js';
import { queryFromSpec } from './query.js';

/**
 * Выбор силуэта: что нарисовать на листе чертежа.
 *
 * Два уровня и порядок между ними. Параметрический мастер строит вид ПО
 * ТАБЕЛЮ: правка замера перестраивает геометрию, выноски указывают на
 * размеченные точки. Библиотечный силуэт этого не умеет — он только
 * масштабируется, — зато знает формы, которых у мастера нет.
 *
 * Отсюда правило: мастер по умолчанию, библиотека — когда её попросили
 * или когда мастер такую форму не строит. Молча подменять точный чертёж
 * иллюстрацией нельзя: с чертежа снимают размеры.
 */

export interface ChooseOptions {
  /** Отчёт зрения — уточняет детали для скоринга. */
  report?: VisionReport;
  /** Пропорция листа нашего собственного чертежа, для разрешения ничьих. */
  aspect?: number;
  /** Явно выбранный шаблон: идентификатор из манифеста. */
  templateId?: string;
  /** Сколько кандидатов показать человеку. */
  top?: number;
}

export interface TemplateChoice {
  /** Кандидаты для микрошага мастера «какой силуэт ближе?». */
  candidates: MatchCandidate[];
  /** Результат скоринга целиком — с отрывом лидера. */
  match: MatchResult;
  /** Уверен ли подбор настолько, чтобы обойтись без вопроса человеку. */
  confident: boolean;
}

/** Кандидат в силуэт в том виде, в каком его показывают человеку. */
export interface CandidateView {
  id: string;
  /** Почему шаблон попал в список: читаемые причины из скоринга. */
  reasons: string[];
  score: number;
  /** Доля совпавших признаков, от нуля до единицы. */
  fit_fraction: number;
  /** Путь к превью — по нему кабинет показывает картинку. */
  preview: string | null;
}

/**
 * Кандидаты, которые действительно можно поставить на чертёж.
 *
 * Предложить силуэт и отказать при клике — хуже, чем не предлагать: человек
 * решает, что сломано, и больше не жмёт. Поэтому список фильтруется теми же
 * правилами, которыми потом происходит замена: отрисовкой под этот табель.
 */
export function candidateViews(
  choice: TemplateChoice,
  options?: RenderChoiceOptions,
): CandidateView[] {
  return choice.candidates
    .filter((c) => !options || renderChosenTemplate(c.entry.id, options) !== null)
    .map((c) => ({
      id: c.entry.id,
      reasons: c.reasons,
      score: c.score,
      fit_fraction: c.fit_fraction,
      preview: c.entry.preview,
    }));
}

/** Подбор без отрисовки: нужен мастеру, чтобы показать варианты. */
export function proposeTemplates(spec: StyleSpec, options: ChooseOptions = {}): TemplateChoice {
  const query = queryFromSpec(spec, {
    ...(options.report ? { report: options.report } : {}),
    ...(options.aspect ? { aspect: options.aspect } : {}),
  });
  const match = matchTemplates(catalogedEntries(), query, options.top ?? 3);
  return { candidates: match.candidates, match, confident: isConfident(match) };
}

export interface RenderChoiceOptions {
  /** Сколько места на листе отведено виду, в сантиметрах изделия. */
  targetWidthCm: number;
  targetHeightCm: number;
  /** Ширина изделия по низу из табеля — по ней задаётся масштаб. */
  bodyWidthCm: number;
  /** Пропорция корпуса по табелю: ширина по низу к длине изделия. */
  bodyRatio: number;
  disclaimer: string;
  /** Зоны, где у изделия есть узлы обработки: на них встают выноски. */
  zones: readonly NodeZone[];
  /** Подпись зоны на языке комплекта. */
  zoneLabel: (zone: NodeZone) => string;
}

/**
 * Зоны, которых на виде не бывает.
 *
 * Карман кенгуру и застёжку со спинки не видно, боковой шов на переде
 * закрыт рукавом. Выноска на невидимую зону указывала бы в пустоту.
 */
const HIDDEN: Record<'front' | 'back', readonly NodeZone[]> = {
  front: ['sides'],
  back: ['pockets', 'closure'],
};

export interface RenderedTemplate {
  templateId: string;
  front: LibraryRenderResult;
  back: LibraryRenderResult | null;
  /** Расхождение пропорций корпуса с табелем; ноль, если замерить не вышло. */
  drift: number;
  /** Удалось ли замерить пропорцию — по незамеренной не отказывают. */
  driftMeasured: boolean;
  /**
   * Зоны, которых на силуэте не нашлось ни на переде, ни на спинке.
   *
   * Считается по ОБОИМ видам: карман не виден со спинки по построению, и
   * называть его непоказанным из-за этого было бы неправдой.
   */
  missing: NodeZone[];
}

/**
 * Отрисовка выбранного шаблона в масштабе изделия.
 *
 * Возвращает null, когда шаблон не годится: файла нет или его пропорции
 * расходятся с табелем сильнее допустимого. Отказ здесь дешевле, чем
 * иллюстрация, выдающая укороченное изделие за обычное.
 */
export function renderChosenTemplate(
  templateId: string,
  options: RenderChoiceOptions,
): RenderedTemplate | null {
  const entry = findTemplate(templateId);
  if (!entry) return null;

  const frontSvg = readTemplateSvg(entry, 'front');
  if (!frontSvg) return null;

  // Что силуэт рисует на самом деле — из его разметки. Зона детали, которой
  // на нём нет, выноски не получит: указывать не на что.
  const t = entry.traits;
  const details: SilhouetteDetails = {
    hood: t?.hood ?? false,
    closure: (t?.closure ?? 'none') !== 'none',
    pocket: (t?.pocket ?? 'none') !== 'none',
    sleeves: (t?.sleeve ?? 'none') !== 'none',
    ribbedWaist: t?.ribbed ?? false,
  };
  const shown = (view: 'front' | 'back'): NodeZone[] =>
    options.zones.filter((z) => !HIDDEN[view].includes(z));

  // Пустой список зон означает эскиз без выносок: так силуэт идёт на лист
  // просчёта. Передавать пустые выноски всё равно нельзя — под них
  // отводятся поля, и рисунок ужимается ради пустого места.
  const callouts = (view: 'front' | 'back'): LibraryRenderOptions['callouts'] => {
    const zones = shown(view);
    return zones.length ? { zones, label: options.zoneLabel, details } : undefined;
  };

  const front = renderLibraryView(frontSvg, {
    targetWidthCm: options.targetWidthCm,
    targetHeightCm: options.targetHeightCm,
    bodyWidthCm: options.bodyWidthCm,
    bodyRatio: options.bodyRatio,
    disclaimer: options.disclaimer,
    ...(callouts('front') ? { callouts: callouts('front')! } : {}),
  });
  // Отказ только по ИЗМЕРЕННОМУ расхождению: если торс не отделился от
  // рукавов, мерить было нечем, и отсутствие улики уликой не считается.
  if (front.proportionMeasured && front.proportionDrift > MAX_PROPORTION_DRIFT) return null;

  const backSvg = readTemplateSvg(entry, 'back');
  const back = backSvg
    ? renderLibraryView(backSvg, {
        targetWidthCm: options.targetWidthCm,
        targetHeightCm: options.targetHeightCm,
        bodyWidthCm: options.bodyWidthCm,
        bodyRatio: options.bodyRatio,
        disclaimer: options.disclaimer,
        ...(callouts('back') ? { callouts: callouts('back')! } : {}),
      })
    : null;

  const drawn = new Set([...front.zones, ...(back?.zones ?? [])]);
  return {
    templateId: entry.id,
    front,
    back,
    drift: front.proportionDrift,
    driftMeasured: front.proportionMeasured,
    missing: options.zones.filter((z) => !drawn.has(z)),
  };
}
