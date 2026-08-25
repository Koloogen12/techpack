import { describe, expect, it } from 'vitest';
import { kb } from '@specform/kb';
import {
  buildBom,
  buildLabels,
  countBomAssumptions,
  countLabelGaps,
  type BomInput,
  type LabelsInput,
} from '../src/index.js';

const base = kb();
const BOM_INPUT: BomInput = { category: 'tshirt' };
const bom = (input: BomInput = BOM_INPUT) => buildBom(input, base);

describe('спецификация материалов', () => {
  const result = bom();

  it('покрывает все группы: полотно, отделка, нитки, прокладки, ярлыки, упаковка', () => {
    const roles = new Set(result.lines.map((l) => l.role));
    for (const role of ['shell', 'rib', 'thread', 'interlining', 'label', 'packaging'] as const) {
      expect(roles).toContain(role);
    }
  });

  it('коды строк идут по группам и не повторяются', () => {
    const codes = result.lines.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes[0]).toBe('F-01');
  });

  it('состав и плотность всегда предположение — с фото они не определяются', () => {
    for (const line of result.lines) {
      expect(line.composition.confidence).toBe('assumption');
      if (line.gsm) expect(line.gsm.confidence).toBe('assumption');
    }
    expect(countBomAssumptions(result.lines)).toBe(result.lines.length);
  });

  it('артикул поставщика не выдумывается — его заполняет бренд или фабрика', () => {
    for (const line of result.lines) expect(line.supplier_article).toBeNull();
  });
});

describe('основное полотно по фактуре с фото', () => {
  it('без опознанного полотна берётся типовое для категории', () => {
    expect(bom().lines[0]!.material_id).toBe('single_jersey');
  });

  it('опознанное и подходящее полотно заменяет типовое', () => {
    const result = bom({ ...BOM_INPUT, fabric_class: 'interlock', fabric_confidence: 'medium' });
    expect(result.lines[0]!.material_id).toBe('interlock');
    expect(result.notes.join(' ')).toContain('по фактуре с фото');
  });

  it('полотно, нетипичное для категории, отклоняется с объяснением', () => {
    // Футер трёхнитка — это худи, а не футболка. Молча ставить его нельзя.
    const result = bom({ ...BOM_INPUT, fabric_class: 'french_terry_3t', fabric_confidence: 'low' });
    expect(result.lines[0]!.material_id).toBe('single_jersey');
    expect(result.notes.join(' ')).toContain('нетипично');
  });

  it('неизвестный справочнику класс не роняет сборку, а откатывается к типовому', () => {
    const result = bom({ ...BOM_INPUT, fabric_class: 'нечто', fabric_confidence: 'low' });
    expect(result.lines[0]!.material_id).toBe('single_jersey');
    expect(result.notes.join(' ')).toContain('нет в справочнике');
  });

  it('«unknown» от vision означает «не смог», а не «замени»', () => {
    expect(bom({ ...BOM_INPUT, fabric_class: 'unknown' }).lines[0]!.material_id).toBe(
      'single_jersey',
    );
  });
});

describe('предварительный расход', () => {
  const result = bom();

  it('больше базовой нормы: заложены раскладка и усадка', () => {
    expect(result.fabric_consumption_m.value).toBeGreaterThan(
      base.consumptionFor('tshirt').consumption_m.default,
    );
  });

  it('всегда объясняет, из чего сложился и кто уточнит', () => {
    expect(result.fabric_consumption_m.note).toContain('раскладке');
    expect(result.notes.join(' ')).toContain('предварительно');
  });

  it('на тираж считается только когда тираж назван', () => {
    expect(result.batch_consumption_m).toBeNull();
    const batch = bom({ ...BOM_INPUT, quantity: 100 }).batch_consumption_m;
    expect(batch).toBeCloseTo(result.fabric_consumption_m.value * 100, 1);
  });
});

describe('колорвеи', () => {
  it('без указания цветов создаётся один основной', () => {
    expect(bom().colorways).toHaveLength(1);
  });

  it('несколько цветов объясняются пользователем', () => {
    const result = bom({
      ...BOM_INPUT,
      colorways: [
        { id: 'black', name_ru: 'Чёрный' },
        { id: 'ecru', name_ru: 'Экрю' },
      ],
    });
    expect(result.colorways).toHaveLength(2);
    expect(result.notes.join(' ')).toContain('на каждый цвет');
  });
});

const LABELS_INPUT: LabelsInput = {
  category: 'tshirt',
  gender: 'women',
  article: 'TSH-001',
  size_range: [44, 46, 48],
  colorways: [{ id: 'black', name_ru: 'Чёрный' }],
  composition: '95% хлопок, 5% эластан',
  care_profile_id: 'cotton_knit',
};
const labels = (input: LabelsInput = LABELS_INPUT) => buildLabels(input, base);

describe('обязательная маркировка', () => {
  const result = labels();

  it('символы ухода идут в порядке ГОСТ и не теряют регистр', () => {
    expect(result.care_symbols[0]!.group).toBe('wash');
    expect(result.care_symbols.map((s) => s.label_ru).join(' ')).toContain('°C');
  });

  it('без профиля бренда обязательные реквизиты остаются пробелами', () => {
    expect(countLabelGaps(result.requisites)).toBeGreaterThan(0);
    expect(result.notes.join(' ')).toContain('продажа в ЕАЭС невозможна');
  });

  it('каждый пробел говорит, как его закрыть — иначе он бесполезен', () => {
    for (const r of result.requisites) {
      if (r.value === null) expect(r.action_ru).toBeTruthy();
    }
  });

  it('заполненный профиль бренда закрывает пробелы', () => {
    const filled = labels({
      ...LABELS_INPUT,
      brand: {
        company_name: 'ООО «Пример»',
        address: '101000, Москва, ул. Примерная, 1',
        trademark: 'ПРИМЕР',
        country: 'Россия',
      },
    });
    const remaining = filled.requisites.filter((r) => r.required && r.value === null);
    // Остаётся только дата изготовления: её проставляет фабрика при выпуске партии.
    expect(remaining.map((r) => r.id)).toEqual(['production_date']);
  });

  it('состав помечен предположением с требованием точных процентов', () => {
    const composition = result.requisites.find((r) => r.id === 'composition')!;
    expect(composition.value!.confidence).toBe('assumption');
    expect(composition.value!.note).toContain('точные проценты');
  });

  it('наименование продукции собирается по формату ТР ТС', () => {
    expect(result.requisites.find((r) => r.id === 'product_name')!.value!.value).toBe(
      'Футболка женская',
    );
    const men = labels({ ...LABELS_INPUT, gender: 'men' });
    expect(men.requisites.find((r) => r.id === 'product_name')!.value!.value).toBe(
      'Футболка мужская',
    );
  });
});

describe('матрица SKU', () => {
  it('перемножает цвета на размеры', () => {
    const result = labels({
      ...LABELS_INPUT,
      colorways: [
        { id: 'black', name_ru: 'Чёрный' },
        { id: 'ecru', name_ru: 'Экрю' },
      ],
    });
    expect(result.sku_matrix).toHaveLength(2 * LABELS_INPUT.size_range.length);
  });

  it('коды уникальны и читаются человеком', () => {
    const skus = labels().sku_matrix.map((s) => s.sku);
    expect(new Set(skus).size).toBe(skus.length);
    expect(skus[0]).toBe('TSH-001-BLACK-44');
  });

  it('GTIN не выдумывается — его выдаёт Нацкаталог', () => {
    for (const row of labels().sku_matrix) expect(row.gtin).toBeNull();
    expect(labels().notes.join(' ')).toContain('Нацкаталоге');
  });
});

describe('воспроизводимость', () => {
  it('спецификация и маркировка не зависят от прогона', () => {
    expect(JSON.stringify(bom())).toBe(JSON.stringify(bom()));
    expect(JSON.stringify(labels())).toBe(JSON.stringify(labels()));
  });
});

describe('защита от мусорного входа', () => {
  it('дубли идентификаторов цветов отвергаются', () => {
    // Два цвета под одним идентификатором дают одинаковые артикулы —
    // на складе и в «Честном знаке» это два разных товара с одним кодом.
    expect(() =>
      bom({
        ...BOM_INPUT,
        colorways: [
          { id: 'black', name_ru: 'Чёрный' },
          { id: 'black', name_ru: 'Угольный' },
        ],
      }),
    ).toThrow(/идентификатор/);
  });

  it('разные цвета с разными идентификаторами проходят', () => {
    expect(() =>
      bom({
        ...BOM_INPUT,
        colorways: [
          { id: 'black', name_ru: 'Чёрный' },
          { id: 'coal', name_ru: 'Угольный' },
        ],
      }),
    ).not.toThrow();
  });
});
