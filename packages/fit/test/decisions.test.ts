import { describe, expect, it } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '@seamster/assembly';
import { parseStyleSpec, type StyleSpec } from '@seamster/stylespec';
import { CONFLICT_PREFIXES, applyDecision, openDecisions } from '../src/index.js';

const AT = new Date('2026-09-08T00:00:00.000Z');

const INPUT: StyleSpecInput = {
  id: 'decisions-test',
  name: 'Худи',
  article: 'DEC-001',
  category: 'hoodie',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'oversize',
  fabric_kind: 'knit',
  size_range: [44, 46, 48],
  generated_at: AT,
};

const spec = (over: Partial<StyleSpecInput> = {}): StyleSpec =>
  buildStyleSpec({ ...INPUT, ...over }).spec;

const HOODIE = spec();

/**
 * Спека без фото ставит предположения в узлы и материалы, а табель берёт
 * типовым. Для проверки решений по точкам предположение делается руками:
 * счётчик в meta обязан сойтись, иначе схема не пропустит.
 */
function withPomGuess(s: StyleSpec, code: string): StyleSpec {
  const points = s.measurements.points.map((p) =>
    p.code !== code
      ? p
      : {
          ...p,
          base: {
            ...p.base,
            confidence: 'assumption' as const,
            note: 'поставлено без опоры на фото',
          },
        },
  );
  return parseStyleSpec({
    ...s,
    measurements: { ...s.measurements, points },
    meta: { ...s.meta, assumptions_count: s.meta.assumptions_count + 1 },
  });
}

const GUESSED = withPomGuess(HOODIE, 'T05');

describe('очередь открытых решений — проекция спеки', () => {
  it('каждое предположение табеля становится решением с подтверждением и правкой', () => {
    const guesses = GUESSED.measurements.points.filter((p) => p.base.confidence === 'assumption');
    expect(guesses.length).toBeGreaterThan(0);
    const { decisions } = openDecisions(GUESSED);
    for (const p of guesses) {
      const d = decisions.find((x) => x.id === `pom:${p.code}`);
      expect(d, p.code).toBeDefined();
      expect(d!.kind).toBe('assumption');
      expect(d!.actions).toContain('confirm');
      expect(d!.actions).toContain('edit');
      expect(d!.value?.current).toBe(p.base.value);
    }
  });

  it('счётчик очереди сходится со счётчиком предположений в спеке', () => {
    // Иначе кабинет показывает одно число на обложке и другое в очереди.
    const { summary } = openDecisions(GUESSED);
    expect(summary.by_kind.assumption).toBe(GUESSED.meta.assumptions_count);
  });

  it('расхождение фото и анкеты читается из примечаний сборки и держит экспорт', () => {
    const note =
      'Расхождение по категории: вы указали «худи», а на фото похоже на «свитшот» (уверенность high). Документ собран по вашему ответу.';
    const { decisions, summary } = openDecisions(HOODIE, { notes: [note] });
    const conflict = decisions.find((d) => d.id === 'conflict:category');
    expect(conflict).toBeDefined();
    expect(conflict!.kind).toBe('conflict');
    expect(conflict!.blocking).toBe(true);
    expect(conflict!.detail_ru.startsWith('вы указали')).toBe(true);
    expect(summary.ready).toBe(false);
  });

  it('снятое с повестки расхождение больше не показывается и не держит', () => {
    const note = 'Расхождение по посадке: вы указали «oversize», а на фото читается «свободная».';
    const before = openDecisions(HOODIE, { notes: [note] });
    expect(before.summary.blocking).toBeGreaterThan(0);
    const after = openDecisions(HOODIE, { notes: [note], resolved: ['conflict:fit'] });
    expect(after.decisions.find((d) => d.id === 'conflict:fit')).toBeUndefined();
    expect(after.summary.blocking).toBe(before.summary.blocking - 1);
  });

  it('пустой реквизит маркировки, который заполняет бренд, — решение без действий, ведёт в профиль', () => {
    const { decisions } = openDecisions(HOODIE);
    const inputs = decisions.filter(
      (d) => d.kind === 'needs_input' && d.id.startsWith('input:') && d.section === 'labels',
    );
    // У свежей спеки без профиля бренда такие реквизиты есть всегда.
    expect(inputs.length).toBeGreaterThan(0);
    for (const d of inputs) {
      expect(d.actions).toEqual([]);
      expect(d.blocking).toBe(true);
    }
  });

  it('назначенный масштаб — не держит, но просит лист А4', () => {
    const { decisions } = openDecisions(HOODIE);
    const scale = decisions.find((d) => d.id === 'input:scale');
    expect(scale).toBeDefined();
    expect(scale!.blocking).toBe(false);
    expect(scale!.detail_ru).toContain('А4');
  });

  it('без фото спинки — решение; со спинкой — нет; без фото вообще — молчит', () => {
    expect(
      openDecisions(HOODIE, { photoViews: ['front_flat'] }).decisions.some(
        (d) => d.id === 'input:back_photo',
      ),
    ).toBe(true);
    expect(
      openDecisions(HOODIE, { photoViews: ['front_flat', 'back_flat'] }).decisions.some(
        (d) => d.id === 'input:back_photo',
      ),
    ).toBe(false);
    expect(openDecisions(HOODIE, {}).decisions.some((d) => d.id === 'input:back_photo')).toBe(
      false,
    );
  });

  it('готовность падает от держащих решений сильнее, чем от предположений, и не уходит ниже нуля', () => {
    const clean = openDecisions(HOODIE).summary.score;
    const notes = Object.keys(CONFLICT_PREFIXES).map((p) => `${p} что-то`);
    const loaded = openDecisions(HOODIE, { notes }).summary.score;
    expect(loaded).toBeLessThan(clean);
    expect(loaded).toBeGreaterThanOrEqual(0);
    expect(openDecisions(HOODIE).summary.next_ru).not.toBeNull();
  });
});

describe('применение решения', () => {
  const firstGuess = GUESSED.measurements.points.find((p) => p.base.confidence === 'assumption')!;

  it('подтверждение поднимает точку до «указано вами» и убирает её из очереди', () => {
    const r = applyDecision(GUESSED, `pom:${firstGuess.code}`, 'confirm');
    expect(r.rejected).toBeNull();
    const p = r.spec.measurements.points.find((x) => x.code === firstGuess.code)!;
    expect(p.base.confidence).toBe('user_input');
    expect(p.base.value).toBe(firstGuess.base.value);
    expect(openDecisions(r.spec).decisions.some((d) => d.id === `pom:${firstGuess.code}`)).toBe(
      false,
    );
    // Счётчик в спеке пересчитан — иначе схема не пропустит.
    expect(r.spec.meta.assumptions_count).toBe(GUESSED.meta.assumptions_count - 1);
  });

  it('правка идёт тем же путём, что правка в таблице: значение меняется, статус «указано вами»', () => {
    const r = applyDecision(GUESSED, `pom:${firstGuess.code}`, 'edit', firstGuess.base.value + 1);
    expect(r.rejected).toBeNull();
    const p = r.spec.measurements.points.find((x) => x.code === firstGuess.code)!;
    expect(p.base.value).toBe(Math.round((firstGuess.base.value + 1) * 10) / 10);
    expect(p.base.confidence).toBe('user_input');
    expect(r.changed_ru).toContain(firstGuess.code);
  });

  it('точку табеля убрать нельзя — очередь отказывает словами', () => {
    const r = applyDecision(GUESSED, `pom:${firstGuess.code}`, 'dismiss');
    expect(r.rejected).toBeTruthy();
    expect(r.spec).toBe(GUESSED);
  });

  it('узел-предположение можно подтвердить или убрать вместе с его операциями', () => {
    const node = HOODIE.construction!.nodes.find((n) => n.presence.confidence === 'assumption')!;
    expect(node).toBeDefined();
    const confirmed = applyDecision(HOODIE, `node:${node.node_id}`, 'confirm');
    expect(confirmed.rejected).toBeNull();
    expect(
      confirmed.spec.construction!.nodes.find((n) => n.node_id === node.node_id)!.presence
        .confidence,
    ).toBe('user_input');

    const removed = applyDecision(HOODIE, `node:${node.node_id}`, 'dismiss');
    expect(removed.rejected).toBeNull();
    expect(removed.spec.construction!.nodes.some((n) => n.node_id === node.node_id)).toBe(false);
    expect(removed.spec.construction!.sequence.some((s) => s.node_id === node.node_id)).toBe(false);
    // Нумерация операций без дыр: фабрика читает её как список.
    expect(removed.spec.construction!.sequence.map((s) => s.step)).toEqual(
      removed.spec.construction!.sequence.map((_, i) => i + 1),
    );
  });

  it('состав материала правится текстом и становится «указано вами»', () => {
    const line = HOODIE.bom!.lines.find((l) => l.composition.confidence === 'assumption')!;
    expect(line).toBeDefined();
    const r = applyDecision(HOODIE, `bom:${line.code}`, 'edit', '100% хлопок, футер 320 г/м²');
    expect(r.rejected).toBeNull();
    const l = r.spec.bom!.lines.find((x) => x.code === line.code)!;
    expect(l.composition.value).toBe('100% хлопок, футер 320 г/м²');
    expect(l.composition.confidence).toBe('user_input');
  });

  it('расхождение и масштаб снимаются с повестки без правки спеки', () => {
    const r = applyDecision(HOODIE, 'conflict:category', 'confirm');
    expect(r.resolved).toBe('conflict:category');
    expect(r.spec).toBe(HOODIE);
    const s = applyDecision(HOODIE, 'input:scale', 'dismiss');
    expect(s.resolved).toBe('input:scale');
  });

  it('реквизит бренда из очереди не закрывается — только профилем', () => {
    const r = applyDecision(HOODIE, 'input:country', 'confirm');
    expect(r.rejected).toContain('профилем');
  });

  it('результат применения — валидная спека', () => {
    const r = applyDecision(GUESSED, `pom:${firstGuess.code}`, 'confirm');
    expect(() => parseStyleSpec(r.spec)).not.toThrow();
  });
});
