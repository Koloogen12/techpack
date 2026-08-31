import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildStyleSpec, type StyleSpecInput } from '@seamster/assembly';
import { diffSpecs, summarise, VersionStore } from '../src/index.js';

const INPUT: StyleSpecInput = {
  id: 'ver',
  name: 'Худи',
  article: 'VER-01',
  category: 'hoodie',
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'oversize',
  fabric_kind: 'knit',
  size_range: [44, 46, 48],
  generated_at: new Date('2026-08-26T00:00:00.000Z'),
};

const fresh = (): VersionStore => new VersionStore(mkdtempSync(join(tmpdir(), 'ver-')));

describe('хранилище версий', () => {
  it('первая версия получает номер 1 и не имеет родителя', () => {
    const store = fresh();
    const entry = store.save('VER-01', buildStyleSpec(INPUT).spec, 'первая сборка')!;
    expect(entry.n).toBe(1);
    expect(entry.parent).toBeNull();
  });

  it('версия, ничего не меняющая, НЕ создаётся', () => {
    // Версия без изменений заставляет фабрику перечитывать документ,
    // в котором ничего не тронуто, и обесценивает сам номер версии.
    const store = fresh();
    const { spec } = buildStyleSpec(INPUT);
    store.save('VER-01', spec, 'первая сборка');
    expect(store.save('VER-01', buildStyleSpec(INPUT).spec, 'повтор')).toBeNull();
    expect(store.list('VER-01')).toHaveLength(1);
  });

  it('дата генерации версией не считается', () => {
    // Отпечаток берётся по СОДЕРЖАНИЮ: пересборка того же изделия завтра —
    // это тот же документ, а не новая версия.
    const store = fresh();
    store.save('VER-01', buildStyleSpec(INPUT).spec, 'первая');
    const later = buildStyleSpec({ ...INPUT, generated_at: new Date('2026-09-01T00:00:00.000Z') });
    expect(store.save('VER-01', later.spec, 'через неделю')).toBeNull();
  });

  it('новая версия ссылается на отпечаток предыдущей', () => {
    const store = fresh();
    const first = store.save('VER-01', buildStyleSpec(INPUT).spec, 'первая')!;
    const changed = buildStyleSpec({ ...INPUT, fit_intent: 'semi_fitted' }).spec;
    const second = store.save('VER-01', changed, 'сменили посадку')!;
    expect(second.n).toBe(2);
    expect(second.parent).toBe(first.fingerprint);
  });

  it('старая версия остаётся нетронутой', () => {
    // Спор с фабрикой разрешается сверкой с тем, что ей прислали. Если тот
    // файл перезаписан, спор не разрешается вовсе.
    const store = fresh();
    const { spec } = buildStyleSpec(INPUT);
    store.save('VER-01', spec, 'первая');
    store.save('VER-01', buildStyleSpec({ ...INPUT, fit_intent: 'semi_fitted' }).spec, 'правка');
    expect(store.read('VER-01', 1).base.fit_intent).toBe('oversize');
    expect(store.read('VER-01', 2).base.fit_intent).toBe('semi_fitted');
  });

  it('несуществующая версия объясняет, какие есть', () => {
    const store = fresh();
    store.save('VER-01', buildStyleSpec(INPUT).spec, 'первая');
    expect(() => store.read('VER-01', 7)).toThrow(/не читается/);
  });
});

describe('дифф версий', () => {
  it('одинаковые спеки не дают изменений', () => {
    const diff = diffSpecs(buildStyleSpec(INPUT).spec, buildStyleSpec(INPUT).spec);
    expect(diff.identical).toBe(true);
    expect(summarise(diff)).toContain('не изменилось');
  });

  it('поднятие статуса — изменение, даже если цифра прежняя', () => {
    // Значение могло не сдвинуться вовсе, но перестало быть догадкой.
    // Для читателя это главный сорт изменений.
    const prev = buildStyleSpec(INPUT).spec;
    const points = prev.measurements.points.map((p, i) =>
      i === 0 ? { ...p, base: { ...p.base, confidence: 'fit_confirmed' as const } } : p,
    );
    const next = { ...prev, measurements: { ...prev.measurements, points } };
    const diff = diffSpecs(prev, next);
    expect(diff.identical).toBe(false);
    expect(diff.points[0]!.confirmed).toBe(true);
    expect(diff.points[0]!.delta_cm).toBe(0);
  });

  it('изменения сортируются по величине сдвига', () => {
    const prev = buildStyleSpec(INPUT).spec;
    const next = buildStyleSpec({ ...INPUT, fit_intent: 'semi_fitted' }).spec;
    const diff = diffSpecs(prev, next);
    const deltas = diff.points.map((p) => Math.abs(p.delta_cm ?? 0));
    expect([...deltas].sort((a, b) => b - a)).toEqual(deltas);
  });
});
