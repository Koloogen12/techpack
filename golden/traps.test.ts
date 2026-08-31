import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { buildStyleSpec, type StyleSpecInput } from '@seamster/assembly';
import { checkSeam, extractColors, readSwatch, separateColors } from '@seamster/pattern';

/**
 * ПРИМЕРЫ-ЛОВУШКИ.
 *
 * Собрание случаев, где интуиция говорит одно, а измерение — другое.
 * Каждый из них не выдуман: все пять поймали НАС САМИХ, когда мы писали
 * тест к уже правильной метрике. Метрика оказывалась права, а пример —
 * нет, и это повторилось трижды подряд в одном модуле.
 *
 * Зачем это отдельным набором, а не строчками в тестах метрик. Во-первых,
 * такой пример — единственная защита от «улучшения» метрики под неверную
 * интуицию: увидев, что рамка по краю тайла не бракуется, легко решить,
 * что порог занижен, и «починить». Здесь написано, почему не надо.
 * Во-вторых, это учебник: человек, который придёт в код после нас, за пять
 * минут узнает, где здесь тонко, — вместо того чтобы наступить на всё
 * заново.
 *
 * Формат жёсткий: что подсказывает интуиция → что говорит измерение →
 * почему право измерение.
 */

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

const svg = (body: string, size = 256): string =>
  'data:image/svg+xml;base64,' +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${body}</svg>`,
  ).toString('base64');

describe('ловушка: рамка по краю — не шов', () => {
  /**
   * ИНТУИЦИЯ: у тайла по всем четырём сторонам чёрная рамка — край резко
   * обрывается, значит стык будет виден.
   * ИЗМЕРЕНИЕ: стык не виден, тайл бесшовный.
   * ПОЧЕМУ ПРАВО ИЗМЕРЕНИЕ: рамка симметрична. При укладке правый край
   * встречается с ЛЕВЫМ, а они одинаковые — разрыва нет. Такой тайл даёт
   * клетку, и клетка это законный рисунок, а не брак.
   */
  it('симметричная рамка укладывается без разрыва', async () => {
    const r = await checkSeam(
      svg(
        `<rect width="256" height="256" fill="#888"/>` +
          `<rect width="256" height="256" fill="none" stroke="#000" stroke-width="24"/>`,
      ),
      browser,
    );
    expect(r.seamless).toBe(true);
  }, 60_000);

  /** Для сравнения: разрыв даёт НЕсимметричный край — градиент. */
  it('градиент слева направо даёт настоящий разрыв', async () => {
    const r = await checkSeam(
      svg(
        `<defs><linearGradient id="g"><stop offset="0" stop-color="#000"/>` +
          `<stop offset="1" stop-color="#fff"/></linearGradient></defs>` +
          `<rect width="256" height="256" fill="url(#g)"/>`,
      ),
      browser,
    );
    expect(r.seamless).toBe(false);
  }, 60_000);
});

describe('ловушка: градиент — не кайма', () => {
  /**
   * ИНТУИЦИЯ: плавный переход после разложения на краски даст крапчатую
   * кайму — значит проверка сплошности должна его забраковать.
   * ИЗМЕРЕНИЕ: сплошность высокая, каймы нет.
   * ПОЧЕМУ ПРАВО ИЗМЕРЕНИЕ: градиент постеризуется в СПЛОШНЫЕ ПОЛОСЫ.
   * Каждая полоса — крупная связная область, и её пиксели окружены
   * такими же. Кайма — это другое: чередование, у которого сплошных
   * пикселей нет вовсе.
   *
   * Цена ошибки: приняв градиент за кайму, мы стали бы выбрасывать
   * законные краски из цветоделения.
   */
  it('полосы градиента сплошные, каймой не считаются', async () => {
    const uri = svg(
      `<defs><linearGradient id="g"><stop offset="0" stop-color="#000"/>` +
        `<stop offset="1" stop-color="#fff"/></linearGradient></defs>` +
        `<rect width="256" height="256" fill="url(#g)"/>`,
    );
    const report = await extractColors(uri, 4, browser);
    const sep = await separateColors(uri, report, { browser });
    expect(sep.separations.every((s) => !s.is_fringe)).toBe(true);
  }, 60_000);

  it('чередование близких цветов — настоящая кайма', async () => {
    const cells: string[] = [];
    for (let y = 0; y < 256; y += 2) {
      for (let x = 0; x < 256; x += 2) {
        cells.push(
          `<rect x="${x}" y="${y}" width="2" height="2" ` +
            `fill="${(x / 2 + y / 2) % 2 === 0 ? '#DDDDDD' : '#C8C8C8'}"/>`,
        );
      }
    }
    const uri = svg(cells.join(''));
    const report = await extractColors(uri, 2, browser);
    const sep = await separateColors(uri, report, { browser });
    expect(sep.separations.some((s) => s.is_fringe)).toBe(true);
  }, 60_000);
});

describe('ловушка: градиент — не плоская графика', () => {
  /**
   * ИНТУИЦИЯ: градиент разложился на четыре аккуратные полосы, вектор
   * из него построится прекрасно.
   * ИЗМЕРЕНИЕ: рисунок фотографичен, вектора не будет.
   * ПОЧЕМУ ПРАВО ИЗМЕРЕНИЕ: полосы аккуратны только потому, что мы их
   * ПРИДУМАЛИ. В исходнике границ нет — есть непрерывный переход, и место
   * границы выбрал алгоритм, а не дизайнер. Отдать такой вектор значит
   * отдать файл, который выглядит вектором и им не является.
   */
  it('непрерывный переход вектора не получает', async () => {
    const uri = svg(
      `<defs><linearGradient id="g"><stop offset="0" stop-color="#204080"/>` +
        `<stop offset="1" stop-color="#E8D8B0"/></linearGradient></defs>` +
        `<rect width="256" height="256" fill="url(#g)"/>`,
    );
    const report = await extractColors(uri, 4, browser);
    expect(report.flat_graphic).toBe(false);
    expect((await separateColors(uri, report, { browser })).svg).toBeNull();
  }, 60_000);
});

describe('ловушка: плечи шире груди — не оверсайз, а ошибка', () => {
  /**
   * ИНТУИЦИЯ: у оверсайза плечи спущены и очень широки — значит они
   * законно могут оказаться шире изделия по груди.
   * ИЗМЕРЕНИЕ: не могут никогда.
   * ПОЧЕМУ ПРАВО ИЗМЕРЕНИЕ: плечевой шов идёт по верхнему краю той же
   * детали, ширину которой меряет ширина по груди. Панель не бывает уже
   * собственного края. У спущенного плеча величины сходятся вплотную,
   * но не переходят друг друга.
   *
   * Поймано кадром спинки: модель приняла за плечевую линию верх оката
   * рукава и выдала 69.3 при груди 66. Оба числа по отдельности для
   * оверсайза нормальны — неправдоподобна пара.
   */
  const INPUT: StyleSpecInput = {
    id: 'trap-shoulder',
    name: 'Оверсайз худи',
    article: 'TRAP-001',
    category: 'hoodie',
    gender: 'women',
    base_size_ru: 46,
    base_height_cm: 170,
    fit_intent: 'oversize',
    fabric_kind: 'knit',
    size_range: [44, 46, 48],
    generated_at: new Date('2026-08-26T00:00:00.000Z'),
  };

  it('наблюдение «плечи шире груди» ограничивается и объясняется', () => {
    const { spec, notes } = buildStyleSpec({
      ...INPUT,
      // Отношение, при котором плечи выходят шире изделия.
      photo_ratios: { T06: 1.12 },
    });
    const chest = spec.measurements.points.find((p) => p.code === 'T03')!.base.value;
    const shoulder = spec.measurements.points.find((p) => p.code === 'T06')!.base.value;
    expect(shoulder).toBeLessThanOrEqual(chest);
    expect(notes.some((n) => n.includes('плечи шире изделия'))).toBe(true);
  });
});

describe('ловушка: длинный рукав — не стиль, а анатомия', () => {
  /**
   * ИНТУИЦИЯ: рукав 74 см от плеча — это просто очень длинный рукав,
   * бывает у оверсайза.
   * ИЗМЕРЕНИЕ: с такими плечами это размах 198 см при росте 170 —
   * длиннее руки.
   * ПОЧЕМУ ПРАВО ИЗМЕРЕНИЕ: ширина плеч плюс две длины рукава — это
   * размах рук в готовом изделии, а он не превышает роста заметно.
   * Каждое число по отдельности правдоподобно; неправдоподобна сумма,
   * и поточечная проверка её не видит в принципе.
   */
  it('размах ограничивается ростом, и рукав подрезается', () => {
    const { spec, notes } = buildStyleSpec({
      id: 'trap-reach',
      name: 'Свитшот',
      article: 'TRAP-002',
      category: 'sweatshirt',
      gender: 'women',
      base_size_ru: 46,
      base_height_cm: 170,
      fit_intent: 'oversize',
      fabric_kind: 'knit',
      size_range: [44, 46, 48],
      photo_ratios: { T10: 1.15 },
      generated_at: new Date('2026-08-26T00:00:00.000Z'),
    });
    const v = (code: string): number =>
      spec.measurements.points.find((p) => p.code === code)!.base.value;
    expect(v('T06') + 2 * v('T10')).toBeLessThanOrEqual(170 * 1.1 + 0.05);
    expect(notes.some((n) => n.includes('длиннее руки'))).toBe(true);
  });
});

describe('ловушка: фактура переплетения — не складка', () => {
  /**
   * ИНТУИЦИЯ: на снимке ровного выкраса пиксели расходятся на 6 ΔE —
   * значит образец снят неровно, и его надо забраковать.
   * ИЗМЕРЕНИЕ: образец ровный.
   * ПОЧЕМУ ПРАВО ИЗМЕРЕНИЕ: 6 ΔE даёт САМО ПОЛОТНО. У трикотажа блик
   * на петле и тень между петлями — это фактура, а не дефект съёмки.
   * Различие между фактурой и складкой не в амплитуде, а в МАСШТАБЕ:
   * фактура меняется от петли к петле, складка — на четверть кадра.
   * Поэтому кадр сначала усредняется в крупные области: внутри области
   * фактура исчезает сама, а складка остаётся, потому что больше области.
   *
   * Цена ошибки: первая версия метрики брала краски тем же цветоделением,
   * что и рисунок, и браковала ровный выкрас. Соблазн был поднять порог —
   * то есть починить правильную метрику под неверный пример. Порог остался
   * прежним, изменился масштаб измерения.
   */
  it('ровный выкрас с фактурой принимается', async () => {
    const lines: string[] = [];
    for (let y = 0; y < 400; y += 4) {
      lines.push(`<rect y="${y}" width="400" height="2" fill="#3A4460"/>`);
    }
    const r = await readSwatch(
      svg(`<rect width="400" height="400" fill="#222C46"/>${lines.join('')}`, 400),
      browser,
    );
    expect(r.uniform).toBe(true);
  }, 60_000);

  it('складка через кадр — настоящий дефект съёмки', async () => {
    const r = await readSwatch(
      svg(
        `<rect width="400" height="400" fill="#2A3550"/>` +
          `<rect x="230" width="170" height="400" fill="#141B2C"/>`,
        400,
      ),
      browser,
    );
    expect(r.uniform).toBe(false);
  }, 60_000);
});
