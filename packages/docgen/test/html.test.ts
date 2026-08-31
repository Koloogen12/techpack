import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStyleSpec, type StyleSpec } from '@seamster/stylespec';
import { diffSpecs } from '@seamster/versions';
import {
  DOC_SECTIONS,
  EXPORT_ROLES,
  renderHtml,
  roleProfile,
  type DocSection,
} from '../src/index.js';

const load = (file: string): StyleSpec =>
  parseStyleSpec(
    JSON.parse(readFileSync(new URL(`../../stylespec/examples/${file}`, import.meta.url), 'utf8')),
  );

const SPEC = load('tshirt-women-46.json');
const MIXED = load('tshirt-oversize-mixed-confidence.json');
const PATTERN = load('hoodie-allover-pattern.json');

/** Однопиксельный PNG. Содержимое неважно — важно, что это картинка. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const VISUALS = {
  render: { dataUri: PIXEL },
  photos: [{ dataUri: PIXEL, label: 'Фронт' }],
  patternTile: { dataUri: PIXEL, repeatCm: 24 },
  patternRender: { dataUri: PIXEL },
};

/**
 * Лист изменений условен так же, как «нанесение»: у первой версии его нет,
 * и это правильно. Чтобы состав документа проверялся целиком, диффом
 * снабжаем фикстуру явно.
 */
const CHANGES = {
  from_version: 1,
  to_version: 2,
  diff: diffSpecs(MIXED, SPEC),
};

const html = (spec: StyleSpec = SPEC, options = {}) =>
  renderHtml(spec, { pro: true, visuals: VISUALS, changes: CHANGES, ...options });
const pagesOf = (h: string): string[] => h.split('<section class="page"').slice(1);
const sectionsOf = (h: string): string[] =>
  [...h.matchAll(/data-section="([a-z_]+)"/g)].map((m) => m[1]!);

describe('состав документа', () => {
  it('содержит все разделы минимального комплекта для фабрики', () => {
    // На спеке с раппортом: разделы «внешний вид», «нанесение» и «раппорт
    // на изделии» условные — у вещи без принта их нет, и это правильно.
    const sections = new Set(sectionsOf(html(PATTERN)));
    for (const s of DOC_SECTIONS) expect(sections).toContain(s);
  });

  it('раздел лекал честно говорит, что мы их не строим', () => {
    expect(html()).toContain('Предоставляются конструктором');
  });

  it('легенда статусов есть на первой странице — без неё документ нечитаем', () => {
    const cover = pagesOf(html())[0]!;
    for (const label of ['указано вами', 'оценка по фото', 'типовое значение', 'предположение']) {
      expect(cover).toContain(label);
    }
  });

  it('легенда не дублирует подпись статуса в пояснении', () => {
    // Первая версия печатала «указано вами — указано вами — сообщил заказчик».
    expect(html()).not.toMatch(/(указано вами)[^<]*—[^<]*\1/);
  });
});

describe('разбиение на страницы', () => {
  // Баг, найденный на первом же прогоне PDF: страница имеет фиксированную
  // высоту, длинная таблица не влезала, и следующий раздел печатался поверх
  // хвоста предыдущего. Часть замеров при этом терялась из виду.
  it('табель мер из 18 точек занимает больше одного листа', () => {
    const pages = pagesOf(html()).filter((p) => p.includes('data-section="measurements"'));
    expect(pages.length).toBeGreaterThan(1);
  });

  it('разрезанная таблица нумерует листы', () => {
    expect(html()).toContain('Лист 1 из');
  });

  it('ни одна точка измерения не теряется при разбиении', () => {
    const h = html();
    for (const p of SPEC.measurements.points) expect(h).toContain(`>${p.code}<`);
  });

  it('ни один узел конструкции не теряется при разбиении', () => {
    const h = html();
    for (const n of SPEC.construction!.nodes) expect(h).toContain(n.label_ru);
  });

  it('ни один артикул SKU не теряется', () => {
    const h = html();
    for (const s of SPEC.labels!.sku_matrix) expect(h).toContain(s.sku);
  });

  it('шапка таблицы повторяется на каждом листе с таблицей', () => {
    // Примечания к значениям тоже относятся к табелю мер, но таблицы
    // не содержат — требовать от них шапку бессмысленно.
    const pages = pagesOf(html())
      .filter((p) => p.includes('data-section="measurements"'))
      .filter((p) => p.includes('<table>'));

    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(page).toContain('Точка измерения');
      expect(page).toContain('Как мерить');
      expect(page).toContain('Допуск');
    }
  });

  it('повторяющиеся примечания группируются, а не печатаются у каждой точки', () => {
    // Калибровка по ручному замеру добавляет одну и ту же строку ко всем
    // точкам. Восемнадцать одинаковых строк топят в шуме те примечания,
    // ради которых блок существует, и переполняют лист.
    const calibrated = {
      ...SPEC,
      measurements: {
        ...SPEC.measurements,
        points: SPEC.measurements.points.map((p) => ({
          ...p,
          base: { ...p.base, note: 'масштаб откалиброван по вашему замеру' },
        })),
      },
    };
    const h = html(calibrated);
    const occurrences = h.split('масштаб откалиброван по вашему замеру').length - 1;
    expect(occurrences).toBe(1);
    expect(h).toContain('точек');
  });

  it('каждая страница несёт колонтитул с артикулом', () => {
    for (const page of pagesOf(html())) expect(page).toContain(SPEC.style.article);
  });
});

describe('честность значений в документе', () => {
  it('каждое значение несёт точку статуса', () => {
    const h = html();
    const dots = [...h.matchAll(/class="dot dot-(\w+)"/g)].map((m) => m[1]!);
    expect(dots.length).toBeGreaterThan(SPEC.measurements.points.length);
    for (const d of new Set(dots)) {
      expect([
        'fit_confirmed',
        'user_input',
        'estimated_from_photo',
        'default_from_base',
        'assumption',
      ]).toContain(d);
    }
  });

  it('счётчик предположений на обложке совпадает со спекой', () => {
    expect(pagesOf(html())[0]!).toContain(`>${SPEC.meta.assumptions_count}<`);
  });

  it('документ со смешанными статусами показывает их все', () => {
    const h = html(MIXED);
    expect(h).toContain('dot-user_input');
    expect(h).toContain('dot-default_from_base');
  });

  it('допуск стоит у каждой точки — таблица без допусков бесполезна ОТК', () => {
    const h = html();
    const tolerances = [...h.matchAll(/±[\d.]+/g)];
    expect(tolerances.length).toBeGreaterThanOrEqual(SPEC.measurements.points.length);
  });
});

describe('русский язык интерфейса документа', () => {
  it('категория и посадка переведены — фабрика не читает английские ключи', () => {
    const cover = pagesOf(html())[0]!;
    expect(cover).toContain('футболка');
    expect(cover).not.toContain('tshirt');
    expect(cover).not.toContain('semi_fitted');
  });

  it('тип оборудования назван по-русски', () => {
    const h = html();
    expect(h).toContain('распошивальная');
    expect(h).not.toContain('coverstitch_2n');
  });

  it('зоны изделия названы по-русски', () => {
    expect(html()).toContain('горловина');
  });
});

describe('машинная проверка парка', () => {
  it('узел вне парка помечается флагом и предлагает замену', () => {
    const spec: StyleSpec = {
      ...SPEC,
      construction: {
        ...SPEC.construction!,
        nodes: SPEC.construction!.nodes.map((n, i) =>
          i === 0
            ? {
                ...n,
                requires_special_equipment: true,
                alternative: {
                  node_id: 'hem_coverstitch',
                  label_ru: 'Подгибка низа распошивом',
                  machine: 'coverstitch_2n',
                },
              }
            : n,
        ),
      },
    };
    const h = html(spec);
    expect(h).toContain('спецоборудование');
    expect(h).toContain('Замена под базовый парк цеха');
  });
});

describe('выгрузка по ролям', () => {
  it('у каждой роли свой набор страниц', () => {
    for (const role of EXPORT_ROLES) {
      const profile = roleProfile(role);
      const sections = new Set(
        sectionsOf(
          renderHtml(PATTERN, {
            sections: profile.sections,
            pro: profile.pro,
            visuals: VISUALS,
            changes: CHANGES,
          }),
        ),
      );
      for (const s of profile.sections) expect(sections, role).toContain(s);
    }
  });

  it('ОТК получает табель мер и не получает материалы', () => {
    const sections = new Set(
      sectionsOf(renderHtml(SPEC, { sections: roleProfile('qc').sections })),
    );
    expect(sections).toContain('measurements');
    expect(sections).not.toContain('bom');
  });

  it('снабжение получает материалы и маркировку, но не конструкцию', () => {
    const sections = new Set(
      sectionsOf(renderHtml(SPEC, { sections: roleProfile('supply').sections })),
    );
    expect(sections).toContain('bom');
    expect(sections).toContain('labels');
    expect(sections).not.toContain('construction');
  });

  it('каждая выгрузка начинается с обложки — документ без паспорта не опознать', () => {
    for (const role of EXPORT_ROLES) {
      expect(roleProfile(role).sections[0], role).toBe('cover');
    }
  });

  it('подпись роли стоит бейджем в мастхеде, а не в мелком колонтитуле', () => {
    // Лист расходится по цеху отдельно, и адресат должен быть виден сразу,
    // а не найден в шестипунктовой строке внизу.
    const h = renderHtml(SPEC, { roleLabel: 'ОТК' });
    expect(h).toContain('class="role"');
    expect(h).toContain('для ОТК');
  });

  it('мета-полоса и номер листа повторяются на КАЖДОЙ странице', () => {
    // Закройщик держит один лист, ОТК другой. Лист без артикула и версии
    // на нём — это лист неизвестно от чего.
    const pages = pagesOf(html());
    for (const p of pages) {
      expect(p).toContain('class="meta"');
      expect(p).toMatch(/Лист \d+ из \d+/);
    }
  });

  it('в мастхеде бренд заказчика, а мы в футере', () => {
    // Документ принадлежит бренду и показывается фабрике от его имени.
    const h = renderHtml({ ...SPEC, style: { ...SPEC.style, brand: 'ЧУЖОЙ БРЕНД' } });
    const masthead = h.slice(h.indexOf('class="masthead"'), h.indexOf('class="meta"'));
    expect(masthead).toContain('ЧУЖОЙ БРЕНД');
    expect(masthead).not.toContain('Seamster');
    expect(h).toContain('Seamster ·');
  });
});

describe('Pro-режим', () => {
  it('раскрывает коды швов и SPI, не добавляя страниц с новыми данными', () => {
    const plain = renderHtml(SPEC, { pro: false });
    const pro = renderHtml(SPEC, { pro: true });
    expect(pro).toContain('1.01.01/504');
    expect(plain).not.toContain('1.01.01/504');
    expect(new Set(sectionsOf(plain))).toEqual(new Set(sectionsOf(pro)));
  });

  it('скрывает точки для конструктора в обычном режиме', () => {
    expect(renderHtml(SPEC, { pro: false })).not.toContain('>T18<');
    expect(renderHtml(SPEC, { pro: true })).toContain('>T18<');
  });
});

describe('безопасность разметки', () => {
  it('пользовательский текст экранируется', () => {
    const evil: StyleSpec = {
      ...SPEC,
      style: { ...SPEC.style, name: '<script>alert(1)</script>', description: '"><b>x' },
    };
    const h = html(evil);
    expect(h).not.toContain('<script>alert(1)</script>');
    expect(h).toContain('&lt;script&gt;');
  });
});

describe('устойчивость', () => {
  it('спека без конструкции, материалов и маркировки всё равно даёт документ', () => {
    const bare: StyleSpec = { ...SPEC };
    delete (bare as { construction?: unknown }).construction;
    delete (bare as { bom?: unknown }).bom;
    delete (bare as { labels?: unknown }).labels;

    const h = renderHtml(bare, { pro: true });
    expect(h).toContain('<section class="page"');
    expect(sectionsOf(h)).toContain('measurements');
  });

  it('в документ не попадает NaN и undefined', () => {
    for (const spec of [SPEC, MIXED]) {
      const h = html(spec);
      expect(h).not.toContain('NaN');
      expect(h).not.toContain('undefined');
    }
  });

  it('пустой набор разделов не роняет рендер', () => {
    expect(renderHtml(SPEC, { sections: [] as DocSection[] })).toContain('<body>');
  });
});

describe('воспроизводимость', () => {
  it('одинаковая спека даёт побайтово одинаковый HTML', () => {
    expect(html()).toBe(html());
  });
});

describe('страница внешнего вида', () => {
  it('без картинок раздела нет — пустой лист хуже отсутствующего', () => {
    expect(sectionsOf(renderHtml(SPEC, { pro: true }))).not.toContain('preview');
  });

  it('появляется, как только есть что показать', () => {
    expect(sectionsOf(html())).toContain('preview');
  });

  it('одних снимков заказчика достаточно — визуализация не обязательна', () => {
    const h = renderHtml(SPEC, { visuals: { photos: [{ dataUri: PIXEL }] } });
    expect(sectionsOf(h)).toContain('preview');
    expect(h).toContain('Снимок заказчика 1');
  });

  it('визуализация помечена «не для замеров»', () => {
    // Без этой пометки кто-нибудь однажды снимет размер с картинки.
    expect(html()).toContain('не для замеров');
  });

  it('говорит, что построена из данных документа, а не из фотографии', () => {
    expect(html()).toContain('а не из присланного снимка');
  });

  it('чужая схема в src не попадает в документ', () => {
    const h = renderHtml(SPEC, {
      visuals: { render: { dataUri: 'javascript:alert(1)' }, photos: [{ dataUri: 'http://x/y' }] },
    });
    expect(h).not.toContain('javascript:');
    expect(h).not.toContain('http://x/y');
    expect(sectionsOf(h)).not.toContain('preview');
  });

  it('больше трёх снимков на лист не берётся', () => {
    const h = renderHtml(SPEC, {
      visuals: { photos: Array.from({ length: 6 }, () => ({ dataUri: PIXEL })) },
    });
    expect([...h.matchAll(/Снимок заказчика/g)]).toHaveLength(3);
  });

  it('у первой версии идёт сразу после обложки — это первое, что открывают', () => {
    const sections = sectionsOf(renderHtml(SPEC, { pro: true, visuals: VISUALS }));
    expect(sections[0]).toBe('cover');
    expect(sections[1]).toBe('preview');
  });

  it('у повторной версии его опережает лист изменений', () => {
    // Читатель второй версии уже видел вещь. Ему нужна дельта, а не
    // повторное знакомство: без листа изменений «версия 2» означает
    // «читайте сорок страниц заново», и её просто не читают.
    const sections = sectionsOf(html());
    const preview = sections.indexOf('preview');
    // Изменений может быть на несколько листов — важно, что ДО внешнего вида
    // идёт только обложка и они.
    expect(new Set(sections.slice(0, preview))).toEqual(new Set(['cover', 'changes']));
    expect(sections[0]).toBe('cover');
    expect(sections[1]).toBe('changes');
  });
});

describe('градация и приёмка', () => {
  /** Раздел режется на листы, поэтому проверяем его целиком. */
  const gradingHtml = (): string =>
    pagesOf(html())
      .filter((p) => p.includes('data-section="grading"'))
      .join('');

  it('не дублирует таблицу размеров, а даёт правило', () => {
    // У эталона страница «Grading» повторяет колонки размеров из табеля мер,
    // и читать её незачем. Здесь — шаг на размер, по которому градацию можно
    // проверить и продлить ряд.
    const page = gradingHtml();
    expect(page).toContain('На размер, см');
    expect(page).toContain('Не градуируются');
  });

  it('несёт нормы приёмки, которых поточечный допуск не выражает', () => {
    // Норма ГОСТ о парных деталях ловит несимметричность, при которой каждый
    // рукав по отдельности в допуске, а изделие — брак. До сих пор этой нормы
    // в документе не было ни строчки.
    const page = gradingHtml();
    expect(page).toContain('парных деталей');
    expect(page).toContain('ГОСТ 23193-78');
  });

  it('шаг берётся из НАПЕЧАТАННОЙ таблицы, а не из справочника', () => {
    // Лист описывает тот документ, который держит читатель. Разойдись они —
    // лист обязан показать расхождение, а не скрыть его.
    const spec = SPEC;
    const t03 = spec.measurements.points.find((p) => p.code === 'T03')!;
    const sorted = [...spec.base.size_range].sort((a, b) => a - b);
    const byRu = new Map(t03.graded.map((g) => [g.ru, g.value.value]));
    byRu.set(spec.base.base_size_ru, t03.base.value);
    const step = byRu.get(sorted[1]!)! - byRu.get(sorted[0]!)!;
    expect(gradingHtml()).toContain(`+${String(Math.round(step * 10) / 10)}`);
  });
});

describe('страница нанесения', () => {
  const art = () => html(MIXED);

  it('у вещи без принта раздела нет', () => {
    expect(sectionsOf(html(SPEC))).not.toContain('artwork');
  });

  it('положение указано в сантиметрах от названной точки, а не словами', () => {
    // «По центру груди» печатник отмерить не может: он кладёт изделие
    // на плиту и берёт рулетку.
    expect(art()).toContain('от высшей точки плеча вниз');
    expect(art()).not.toContain('по центру груди');
  });

  it('светофор проверок макета попадает в документ', () => {
    const h = art();
    expect(h).toContain('Проверка макета');
    expect(h).toContain('dpi');
  });

  it('говорит, что макет на чертеже не рисуется', () => {
    expect(art()).toContain('на чертеже он не рисуется');
  });

  it('нанесение в спецификации стоит отдельно от материалов', () => {
    const h = art();
    expect(h).toContain('Нанесение — операция отдельного подрядчика');
  });

  it('печатник получает нанесение и чертёж, но не узлы и не расход', () => {
    const sections = new Set(
      sectionsOf(renderHtml(MIXED, { sections: roleProfile('printer').sections, pro: true })),
    );
    expect(sections).toContain('artwork');
    expect(sections).toContain('flats');
    expect(sections).not.toContain('construction');
    expect(sections).not.toContain('bom');
  });

  it('зона нанесения нарисована на чертеже пунктиром с размерами', () => {
    const h = art();
    expect(h).toContain('data-artwork="A1"');
    expect(h).toContain('data-layer="artwork"');
  });
});

describe('фотореалистичный раппорт на изделии', () => {
  const page = () => html(PATTERN);

  it('идёт отдельным разделом, а не третьим листом нанесения', () => {
    expect(sectionsOf(page())).toContain('pattern_preview');
  });

  it('в цеховые выгрузки не попадает — ни печатнику, ни печатнику полотна', () => {
    // Схема нанесения им нужна, красивая картинка отвлекает от неё.
    for (const role of ['printer', 'fabric_printer', 'technologist', 'cutter'] as const) {
      const sections = sectionsOf(
        renderHtml(PATTERN, { sections: roleProfile(role).sections, visuals: VISUALS }),
      );
      expect(sections, role).not.toContain('pattern_preview');
    }
    expect(
      sectionsOf(renderHtml(PATTERN, { sections: roleProfile('full').sections, visuals: VISUALS })),
    ).toContain('pattern_preview');
  });

  it('несёт плашку «не для замеров» и отсылает к размерной раскладке', () => {
    const h = page();
    expect(h).toContain('не для замеров');
    expect(h).toContain('Размерно точная раскладка');
  });

  it('без картинки раздела нет — пустой лист хуже отсутствующего', () => {
    const h = renderHtml(PATTERN, { visuals: { patternTile: VISUALS.patternTile } });
    expect(sectionsOf(h)).not.toContain('pattern_preview');
    // При этом размерно точная раскладка на месте: она не зависит от рендера.
    expect(sectionsOf(h)).toContain('artwork');
  });

  it('шаг раппорта в подписи совпадает с паспортом печати', () => {
    expect(page()).toContain('шаг 24 см');
  });
});
