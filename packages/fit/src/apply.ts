import { track, type Confidence } from '@seamsterly/core';
import { kb as defaultKb, type KnowledgeBase } from '@seamsterly/kb';
import { parseStyleSpec, type StyleSpec } from '@seamsterly/stylespec';
import { effectiveValue, METHOD_LABEL_RU, METHOD_TRUST, type MeasuredSet } from './schema.js';

/**
 * Примерка, применённая к спеке.
 *
 * Половина модуля, которой до сих пор не было. Сравнение с рулеткой умело
 * СКАЗАТЬ, где мы промахнулись, — и на этом всё заканчивалось. Верхняя
 * ступень иерархии уверенности, «подтверждено по образцу», стояла в легенде
 * документа и в коде статусов, но её не производил никто: ни одно значение
 * в жизни её не получало.
 *
 * Здесь замер отшитого образца становится ЗНАЧЕНИЕМ спеки. Это и есть
 * замыкание цикла: техпак → отшив → замеры → следующая версия техпака,
 * в которой спорных значений на десяток меньше.
 */

export interface AppliedPoint {
  code: string;
  name_ru: string;
  from_cm: number;
  to_cm: number;
  delta_cm: number;
  from_confidence: Confidence;
}

export interface RejectedPoint {
  code: string;
  measured_cm: number;
  reason: string;
}

export interface AppliedFitting {
  spec: StyleSpec;
  applied: AppliedPoint[];
  rejected: RejectedPoint[];
  /** Что человек обязан прочитать глазами. */
  notes: string[];
}

/**
 * Анатомический предел размаха — тот же, что в сборщике.
 *
 * Но применяется ПРОТИВОПОЛОЖНО. В сборщике он ограничивает оценку по фото:
 * модель могла принять за плечевую линию верх оката, и её догадку надо
 * укоротить. Здесь величина снята рулеткой с реальной вещи, и укорачивать
 * нечего — если сумма неправдоподобна, значит неправдоподобен ЗАМЕР.
 * Поэтому здесь предел не ограничивает, а сообщает.
 */
const MAX_REACH_TO_HEIGHT = 1.1;

export function applyFitting(
  spec: StyleSpec,
  measured: MeasuredSet,
  base: KnowledgeBase = defaultKb(),
): AppliedFitting {
  const applied: AppliedPoint[] = [];
  const rejected: RejectedPoint[] = [];
  const notes: string[] = [];

  const template = base.pomTemplate(spec.style.category);
  const byCode = new Map(template.points.map((p) => [p.code, p]));
  const measuredBy = new Map(measured.values.map((v) => [v.code, effectiveValue(v)]));

  const trust = METHOD_TRUST[measured.method];
  const source =
    `fitting:${measured.id}/${measured.method}/${measured.measured_at}` +
    ` (${measured.measured_by})`;
  const note = `Снято с отшитого образца ${measured.measured_at}, ${METHOD_LABEL_RU[measured.method].toLowerCase()}`;

  // --- Слабый метод не даёт подтверждения ------------------------------------
  // Замер на манекене не тот замер, который описан в табеле: табель мер
  // задаёт изделие РАЗЛОЖЕННЫМ, а на манекене вещь натянута. Принять такие
  // числа за подтверждённые значило бы поднять статус, не подняв точность.
  if (trust === 'weak') {
    for (const [code, value] of measuredBy) {
      rejected.push({
        code,
        measured_cm: value,
        reason:
          `метод «${METHOD_LABEL_RU[measured.method].toLowerCase()}» не подтверждает табель: ` +
          `он описывает изделие разложенным, а на манекене вещь натянута`,
      });
    }
    notes.push(
      `Примерка ${measured.id} снята методом «${METHOD_LABEL_RU[measured.method].toLowerCase()}» ` +
        `и в спеку НЕ вошла: табель мер описывает изделие разложенным. ` +
        `Разложите образец и перемерьте рулеткой — тогда значения станут подтверждёнными.`,
    );
    return { spec, applied, rejected, notes };
  }

  // --- Простые точки: замер становится значением -----------------------------
  const points = spec.measurements.points.map((p) => {
    const entry = byCode.get(p.code);
    const value = measuredBy.get(p.code);
    if (value === undefined || entry === undefined) return p;

    // Составная точка не берётся из примерки НАПРЯМУЮ: она тождественно
    // равна комбинации своих частей, и подставить в неё независимый замер
    // значило бы разрешить документу противоречить самому себе.
    if (entry.derivation === 'composed') return p;

    applied.push({
      code: p.code,
      name_ru: p.name_ru,
      from_cm: p.base.value,
      to_cm: value,
      delta_cm: Math.round((value - p.base.value) * 10) / 10,
      from_confidence: p.base.confidence,
    });

    const shift = value - p.base.value;
    return {
      ...p,
      base: track(value, 'fit_confirmed' as const, source, note),
      // Градация СДВИГАЕТСЯ вместе с базой, а не пересчитывается заново:
      // правило градации не изменилось, изменился якорь. Пересчёт с нуля
      // стёр бы всё, что уже было подтверждено по этой точке раньше.
      graded: p.graded.map((g) => ({
        ...g,
        value: { ...g.value, value: Math.round((g.value.value + shift) * 10) / 10 },
      })),
    };
  });

  // --- Составные точки: пересчёт из частей -----------------------------------
  const valueOf = (code: string): number | undefined =>
    points.find((p) => p.code === code)?.base.value;

  const recomputed = points.map((p) => {
    const entry = byCode.get(p.code);
    if (entry?.derivation !== 'composed') return p;
    const parts = entry.composed_of ?? [];
    if (!parts.length) return p;
    // Пересчитываем только если хотя бы одна часть подтверждена примеркой.
    if (!parts.some((part) => applied.some((a) => a.code === part.code))) return p;

    let sum = 0;
    for (const part of parts) {
      const v = valueOf(part.code);
      if (v === undefined) return p;
      sum += v * part.factor;
    }
    const value = Math.round(sum * 10) / 10;

    // Если точку ещё и померили, расхождение с тождеством — это сообщение
    // об измерении, а не повод переписать тождество.
    const direct = measuredBy.get(p.code);
    if (direct !== undefined && Math.abs(direct - value) > p.tolerance.value) {
      notes.push(
        `Точка ${p.code} (${p.name_ru}): замер ${direct.toFixed(1)} см расходится ` +
          `с суммой своих частей ${value.toFixed(1)} см на ` +
          `${Math.abs(direct - value).toFixed(1)} см при допуске ±${p.tolerance.value} см. ` +
          `Взята сумма: ${p.code} равна ей тождественно, а не приблизительно. ` +
          `Расхождение такого размера означает, что одну из точек мерили не оттуда.`,
      );
    }

    const shift = value - p.base.value;
    applied.push({
      code: p.code,
      name_ru: p.name_ru,
      from_cm: p.base.value,
      to_cm: value,
      delta_cm: Math.round(shift * 10) / 10,
      from_confidence: p.base.confidence,
    });

    return {
      ...p,
      base: track(
        value,
        'fit_confirmed' as const,
        `${source}/composed(${parts.map((x) => `${x.factor}×${x.code}`).join('+')})`,
        `${note}; пересчитано из подтверждённых частей`,
      ),
      graded: p.graded.map((g) => ({
        ...g,
        value: { ...g.value, value: Math.round((g.value.value + shift) * 10) / 10 },
      })),
    };
  });

  // --- Правдоподобие: сообщаем, а НЕ ограничиваем ----------------------------
  const shoulder = recomputed.find((p) => p.code === 'T06')?.base.value;
  const sleeve = recomputed.find((p) => p.code === 'T10')?.base.value;
  const chest = recomputed.find((p) => p.code === 'T03')?.base.value;
  const height = spec.base.base_height_cm;

  if (shoulder !== undefined && sleeve !== undefined) {
    const reach = shoulder + 2 * sleeve;
    if (reach > height * MAX_REACH_TO_HEIGHT) {
      notes.push(
        `Замеры дают размах ${reach.toFixed(0)} см при росте ${height} см — длиннее руки. ` +
          `Значения ОСТАВЛЕНЫ как измерены: это замер реальной вещи, и обрезать его нечем. ` +
          `Но одну из точек — ширину плеч или длину рукава — почти наверняка мерили ` +
          `не оттуда, перепроверьте по протоколу.`,
      );
    }
  }
  if (shoulder !== undefined && chest !== undefined && shoulder > chest) {
    notes.push(
      `Замеры дают плечи ${shoulder} см шире изделия по груди ${chest} см. ` +
        `Значения оставлены как измерены, но так не бывает: плечевой шов идёт ` +
        `по верхнему краю той же детали, ширину которой меряет ширина по груди.`,
    );
  }

  if (applied.length === 0) {
    notes.push(`Примерка ${measured.id} не изменила ни одного значения.`);
  } else {
    notes.push(
      `Примерка ${measured.id}: ${applied.length} ${plural(applied.length, 'значение', 'значения', 'значений')} ` +
        `подтверждено по образцу и больше не требует проверки.`,
    );
  }

  const draft = {
    ...spec,
    measurements: { ...spec.measurements, points: recomputed },
    meta: {
      ...spec.meta,
      // Счётчик — проекция ВСЕХ данных, а не одного табеля мер. Пересчитать
      // его по одним замерам значило бы потерять предположения конструкции
      // и спецификации, и схема поймала бы это на выходе.
      assumptions_count:
        recomputed.filter(
          (p) => p.base.confidence === 'assumption' || p.tolerance.confidence === 'assumption',
        ).length +
        (spec.construction?.nodes.filter((n) => n.presence.confidence === 'assumption').length ??
          0) +
        (spec.bom?.lines.filter(
          (l) => l.composition.confidence === 'assumption' || l.gsm?.confidence === 'assumption',
        ).length ?? 0),
    },
  };

  return { spec: parseStyleSpec(draft), applied, rejected, notes };
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
