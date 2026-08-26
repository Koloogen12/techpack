/**
 * Пересборка эталонных примеров StyleSpec из движка.
 *
 * Примеры служат двум целям: документируют схему и ловят её дрейф —
 * если движок начнёт выдавать другое, диff в PR это покажет.
 * Запуск: pnpm stylespec:examples
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildStyleSpec, type StyleSpecInput } from '@specform/assembly';

const DIR = new URL('../examples/', import.meta.url).pathname;

// Время фиксировано: примеры — фикстуры, они не должны меняться от прогона к прогону.
const AT = new Date('2026-08-25T00:00:00.000Z');

const cases: { file: string; input: StyleSpecInput }[] = [
  {
    file: 'tshirt-women-46.json',
    input: {
      id: 'example-tshirt-women-46',
      name: 'Базовая футболка',
      article: 'TSH-W46-001',
      brand: 'Пример',
      season: 'SS26',
      description: 'Прямая футболка из кулирки, круглая горловина с бейкой',
      category: 'tshirt',
      gender: 'women',
      base_size_ru: 46,
      base_height_cm: 170,
      fit_intent: 'semi_fitted',
      fabric_kind: 'knit',
      size_range: [42, 44, 46, 48, 50, 52],
      generated_at: AT,
    },
  },
  {
    file: 'tshirt-oversize-mixed-confidence.json',
    input: {
      id: 'example-tshirt-oversize',
      name: 'Oversize футболка по фото',
      article: 'TSH-OS-002',
      category: 'tshirt',
      gender: 'women',
      base_size_ru: 46,
      base_height_cm: 176,
      fit_intent: 'oversize',
      fabric_kind: 'knit',
      size_range: [44, 46, 48, 50],
      // Смесь статусов в одном документе: что-то видно с фото, что-то нет,
      // а T06 намеренно выходит за правдоподобный диапазон и будет ограничен.
      photo_ratios: { T01: 1.28, T05: 1.05, T10: 0.52, T14: 0.4, T06: 2.4 },
      manual: { code: 'T01', value_cm: 72 },
      quantity: 100,
      // Нанесение с намеренно разными статусами: размер задан заказчиком,
      // отступ взят типовым, файл прислан растровым и мелким — светофор
      // обязан это показать, а не промолчать.
      artwork: [
        {
          zone: 'chest_center',
          width_cm: 24,
          height_cm: 30,
          color_codes: ['Pantone 186 C'],
          file: {
            name: 'logo-front.png',
            format: 'png',
            pixels: { width: 1200, height: 1500 },
            transparent: true,
          },
        },
      ],
      vision_cache_key: 'a'.repeat(64),
      generated_at: AT,
    },
  },
  {
    // Третий пример существует ради сплошного раппорта: у него другой набор
    // производственных данных, другой путь реализации и своя страница
    // в документе — на локальном макете это не проверить.
    file: 'hoodie-allover-pattern.json',
    input: {
      id: 'example-hoodie-pattern',
      name: 'Худи с раппортом',
      article: 'HOO-PAT-003',
      category: 'hoodie',
      gender: 'women',
      base_size_ru: 46,
      base_height_cm: 170,
      fit_intent: 'oversize',
      fabric_kind: 'knit',
      size_range: [44, 46, 48, 50],
      quantity: 100,
      // Два колорвея с разным происхождением цвета — так выглядит вся шкала
      // достоверности по цвету в одном документе: один снят с образца полотна
      // и несёт координаты Lab, второй вписан брендом вместе с его же
      // фирменным номером.
      colorways: [
        {
          id: 'navy',
          name_ru: 'Тёмно-синий',
          hex_approx: '#2A3550',
          swatch: {
            file_name: 'swatch-navy.jpg',
            key: 'c'.repeat(64),
            hex: '#2A3550',
            lab: { l: 22.8, a: 5.1, b: -16.4 },
            spread_delta_e: 2.1,
            uniform: true,
            verdict_ru:
              'Снимок однороден: цвет занимает 91% кадра, расхождение остальных 2.1 ΔE — ' +
              'по нашему же правилу цветоделения это один цвет. Взят #2A3550.',
          },
          book_code: null,
          book_source: null,
        },
        {
          id: 'sand',
          name_ru: 'Песочный',
          hex_approx: '#D8C7A6',
          swatch: null,
          book_code: '7501 C',
          book_source: 'brand',
        },
      ],
      patterns: [
        {
          tile: {
            file_name: 'tile-botanical.png',
            pixels: { width: 2048, height: 2048 },
            key: 'b'.repeat(64),
            seam_ratio: 0,
            seamless: true,
            mirrored: true,
          },
          repeat_cm: 24,
        },
      ],
      generated_at: AT,
    },
  },
];

for (const { file, input } of cases) {
  const { spec } = buildStyleSpec(input);
  writeFileSync(join(DIR, file), JSON.stringify(spec, null, 2) + '\n');
  console.log(`✓ ${file}: ${spec.measurements.points.length} точек`);
}
