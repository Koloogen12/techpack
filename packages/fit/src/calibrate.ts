import { roundCm, track } from '@seamster/core';
import { kb as defaultKb, type KnowledgeBase } from '@seamster/kb';
import type { StyleSpec } from '@seamster/stylespec';

/**
 * Калибровка масштаба готового пака одним замером по образцу.
 *
 * Табель по фото — это пропорции, умноженные на ширину по груди из размерной
 * сетки. Сетка врёт, когда полотно узкое (рубчик) или посадка нестандартная,
 * и врёт вся таблица разом — одним множителем. Человек меряет ОДНУ точку на
 * образце, и все величины, которые считались от якоря, пересчитываются
 * этим множителем. Точки от роста (длина рукава по росту) и константы
 * справочника множителя не получают: они с якорем не связаны.
 *
 * Та же логика, что у ручного замера в мастере (assembly/pom.ts calibrate),
 * но поверх собранной спеки — чтобы не пересобирать документ заново и не
 * терять правки, версии и подтверждения.
 */
export interface CalibrateResult {
  spec: StyleSpec;
  factor: number;
  /** Коды пересчитанных точек. */
  rescaled: string[];
  changed_ru: string;
  rejected?: string;
}

export function calibrateSpec(
  spec: StyleSpec,
  code: string,
  valueCm: number,
  base: KnowledgeBase = defaultKb(),
): CalibrateResult {
  const template = base.pomTemplate(spec.style.category, spec.base.fabric_kind);
  const entries = new Map(template.points.map((p) => [p.code, p]));
  const point = spec.measurements.points.find((p) => p.code === code);
  const entry = entries.get(code);
  const fail = (rejected: string): CalibrateResult => ({
    spec,
    factor: 1,
    rescaled: [],
    changed_ru: '',
    rejected,
  });
  if (!point || !entry) return fail(`точки ${code} нет в этом изделии`);
  if (!Number.isFinite(valueCm) || valueCm <= 0 || valueCm > 250)
    return fail('значение вне разумных пределов');
  // От якоря считается то, что пришло отношением с фото (vision:ratio), сам
  // якорь и типовые отношения к ширине изделия. Отношения к росту, слова
  // человека и составные точки множителя не получают.
  type Pt = StyleSpec['measurements']['points'][number];
  const fromAnchor = (p: Pt): boolean => {
    const e = entries.get(p.code);
    if (p.base.source.startsWith('vision:ratio')) return true;
    if (p.base.source.startsWith('engine:pom/anchor')) return true;
    if (p.base.confidence === 'user_input' || p.base.confidence === 'fit_confirmed') return false;
    if (!e) return false;
    if (e.derivation === 'anchor') return true;
    if (e.derivation === 'ratio_to_anchor') return e.anchor_basis !== 'height';
    return false;
  };
  if (entry.derivation === 'composed')
    return fail(`${code} не связана с масштабом напрямую — она считается из других точек`);
  if (!fromAnchor(point) && !point.base.source.startsWith('user:'))
    return fail(`${code} считается от роста, а не от ширины изделия — масштаб по ней не задать`);
  if (
    point.base.source.startsWith('user:') &&
    !fromAnchor({ ...point, base: { ...point.base, confidence: 'estimated_from_photo' } })
  )
    return fail(`${code} считается от роста, а не от ширины изделия — масштаб по ней не задать`);
  if (point.base.value <= 0) return fail(`у ${code} нулевое значение`);

  const factor = valueCm / point.base.value;
  if (Math.abs(factor - 1) < 0.005) return fail('замер совпадает с табелем — пересчитывать нечего');
  const rescaled: string[] = [];
  const scales = (c: string): boolean => {
    const p = spec.measurements.points.find((x) => x.code === c);
    return !!p && fromAnchor(p);
  };
  const note = `пересчитано по замеру ${code} на образце (×${factor.toFixed(3)})`;
  type Val = StyleSpec['measurements']['points'][number]['base'];
  const mul = (v: Val): Val =>
    track(roundCm(v.value * factor), v.confidence, v.source, v.note ? `${v.note}; ${note}` : note);

  const first = spec.measurements.points.map((p) => {
    if (p.code === code) {
      rescaled.push(p.code);
      return {
        ...p,
        base: track(
          roundCm(valueCm),
          'measured_by_scale' as const,
          'user:workspace/calibrate',
          'измерено на образце — задаёт масштаб всего табеля',
        ),
        graded: p.graded.map((g) => ({ ...g, value: mul(g.value) })),
      };
    }
    if (!scales(p.code)) return p;
    rescaled.push(p.code);
    return {
      ...p,
      base: mul(p.base),
      graded: p.graded.map((g) => ({ ...g, value: mul(g.value) })),
    };
  });

  // Составные точки — заново из слагаемых, как их считает сборка.
  const byCode = new Map(first.map((p) => [p.code, p]));
  const points = first.map((p) => {
    const e = entries.get(p.code);
    if (!e || e.derivation !== 'composed' || !e.composed_of?.length) return p;
    const parts = e.composed_of;
    if (!parts.every((part) => byCode.has(part.code))) return p;
    const sum = parts.reduce(
      (acc, part) => acc + byCode.get(part.code)!.base.value * part.factor,
      0,
    );
    if (Math.abs(sum - p.base.value) < 0.05) return p;
    rescaled.push(p.code);
    return {
      ...p,
      base: track(roundCm(sum), p.base.confidence, p.base.source, note),
      graded: p.graded.map((g) => {
        const gsum = parts.reduce((acc, part) => {
          const row = byCode.get(part.code)!.graded.find((x) => x.ru === g.ru);
          return acc + (row?.value.value ?? byCode.get(part.code)!.base.value) * part.factor;
        }, 0);
        return { ...g, value: track(roundCm(gsum), g.value.confidence, g.value.source, note) };
      }),
    };
  });

  return {
    spec: { ...spec, measurements: { ...spec.measurements, points } },
    factor,
    rescaled,
    changed_ru:
      `Масштаб по замеру ${code} = ${roundCm(valueCm)} см: ${rescaled.length} ` +
      `${rescaled.length === 1 ? 'точка' : rescaled.length < 5 ? 'точки' : 'точек'} ` +
      `пересчитаны (×${factor.toFixed(3)})`,
  };
}
