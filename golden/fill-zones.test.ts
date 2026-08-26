import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { buildStyleSpec, type StyleSpecInput } from '@seamsterly/assembly';
import {
  buildGeometry,
  checkFlatLines,
  flatDefaults,
  measurementsFrom,
  renderFlatsFromSpec,
} from '@seamsterly/flats';
import { CATEGORIES } from '@seamsterly/kb';

/**
 * ЗАЛИВКА ПО ЗОНАМ — снимок, а не намерение.
 *
 * Проверяется то, что попало в пиксели. Две вещи, которые нельзя проверить
 * чтением кода:
 *
 *  1. Внутри силуэта не осталось НЕЗАЛИТЫХ мест. Так у худи полгода зиял
 *     белый клин над горловиной: заливка шла по контуру капюшона, а контур
 *     как область замыкается по хорде. Код при этом читался правильно.
 *  2. Рибаны НЕ печатаются. Пояс и манжеты кроятся из другого полотна —
 *     в спецификации это отдельная позиция, кашкорсе, — и при печати полотна
 *     до раскроя рисунок на них не попадает. Залив их раппортом, превью
 *     обещало бы печатный пояс, а фабрика прислала бы однотонный.
 */

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

/**
 * Сплошной пурпурный тайл и ядовито-зелёная рибана.
 *
 * Цвета выбраны так, чтобы их нельзя было спутать ни между собой, ни с белым
 * фоном: тест различает три состояния пикселя, и различать их должен цвет,
 * а не порог яркости.
 */
const SOLID_TILE =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP4z/D/PwMYAgkAN9YH+VOs9EoAAAAASUVORK5CYII=';
const RIB = '#00FF00';

const input = (category: (typeof CATEGORIES)[number]): StyleSpecInput => ({
  id: `fill-${category}`,
  name: category,
  article: 'FILL-01',
  category,
  gender: 'women',
  base_size_ru: 46,
  base_height_cm: 170,
  fit_intent: 'oversize',
  fabric_kind: 'knit',
  size_range: [46],
  generated_at: new Date('2026-08-26T00:00:00.000Z'),
});

/**
 * Доля пикселей силуэта, оставшихся незалитыми, и доля, занятая рибаной.
 *
 * Маска силуэта и заливка растрируются ПОРОЗНЬ и в одном масштабе, после чего
 * сравниваются попиксельно. Никаких именованных функций внутри evaluate:
 * сборка подставляет в них __name, которого в браузере нет.
 */
async function sample(mask: string, filled: string): Promise<{ holes: number; rib: number }> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ([maskSvg, filledSvg]: [string, string]) => {
        const load = async (svg: string): Promise<ImageData> => {
          const img = new Image();
          img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
          await img.decode();
          const canvas = document.createElement('canvas');
          canvas.width = 600;
          canvas.height = 600;
          const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, 600, 600);
          ctx.drawImage(img, 0, 0, 600, 600);
          return ctx.getImageData(0, 0, 600, 600);
        };

        const m = await load(maskSvg);
        const fdata = await load(filledSvg);

        let inside = 0;
        let holes = 0;
        let rib = 0;
        for (let y = 1; y < 599; y++) {
          for (let x = 1; x < 599; x++) {
            const i = (y * 600 + x) * 4;
            // Учитываем только уверенно внутренние пиксели: у края маски
            // сглаживание даёт полутона, и они не о заливке.
            if (m.data[i]! > 40) continue;
            const up = ((y - 1) * 600 + x) * 4;
            const down = ((y + 1) * 600 + x) * 4;
            if (m.data[up]! > 40 || m.data[down]! > 40) continue;
            if (m.data[i - 4]! > 40 || m.data[i + 4]! > 40) continue;

            inside++;
            const r = fdata.data[i]!;
            const g = fdata.data[i + 1]!;
            const b = fdata.data[i + 2]!;
            if (r > 235 && g > 235 && b > 235) holes++;
            else if (g > 200 && r < 120 && b < 120) rib++;
          }
        }
        return { holes: holes / Math.max(inside, 1), rib: rib / Math.max(inside, 1) };
      },
      [mask, filled] as [string, string],
    );
  } finally {
    await page.close();
  }
}

/**
 * Цвет чертежа в конкретных точках изделия.
 *
 * Долевая проверка говорит «рибана где-то есть». Здесь спрашивается прямо:
 * какого цвета середина пояса и какого — середина груди. Именно это увидит
 * печатник, и именно это было неверно: горошек шёл по поясу.
 */
async function probe(svg: string, points: readonly { x: number; y: number }[]): Promise<string[]> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ([source, pts]: [string, { x: number; y: number }[]]) => {
        const box = /viewBox="([^"]+)"/.exec(source)![1]!.split(/\s+/).map(Number);
        const img = new Image();
        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(source)));
        await img.decode();
        const size = 900;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);

        const out: string[] = [];
        for (const pt of pts) {
          const px = Math.round(((pt.x - box[0]!) / box[2]!) * size);
          const py = Math.round(((pt.y - box[1]!) / box[3]!) * size);
          const d = ctx.getImageData(px, py, 1, 1).data;
          const [r, g, b] = [d[0]!, d[1]!, d[2]!];
          if (r > 235 && g > 235 && b > 235) out.push('white');
          else if (g > 200 && r < 120 && b < 120) out.push('rib');
          else if (r > 200 && b > 200 && g < 120) out.push('tile');
          else out.push(`${r},${g},${b}`);
        }
        return out;
      },
      [svg, [...points]] as [string, { x: number; y: number }[]],
    );
  } finally {
    await page.close();
  }
}

describe.each(CATEGORIES)('заливка чертежа: %s', (category) => {
  const { spec } = buildStyleSpec(input(category));
  const defaults = flatDefaults(spec);

  /**
   * Маска силуэта строится из КОНТУРА, а не из заливочной геометрии.
   *
   * Иначе тест сравнивал бы заливку с самой собой: сломав заливочный контур
   * капюшона, мы сломали бы и маску, разница осталась бы нулевой, и белый
   * клин снова прошёл бы незамеченным. Маска обязана приходить из другого
   * источника — из тех линий, которыми чертёж нарисован.
   */
  const silhouette = (svg: string): string =>
    svg
      .replace(/fill="none"/g, 'fill="#000000"')
      .replace(/stroke="currentColor"/g, 'stroke="none"');

  const masks = renderFlatsFromSpec(spec, { ...defaults, layers: ['outline'] });
  const filled = renderFlatsFromSpec(spec, {
    ...defaults,
    layers: ['pattern'],
    patternFill: { dataUri: SOLID_TILE, repeatCm: 6 },
    ribFill: RIB,
  });

  it('внутри силуэта не осталось незалитых мест', async () => {
    const front = await sample(silhouette(masks.front.svg), filled.front.svg);
    const back = await sample(silhouette(masks.back.svg), filled.back.svg);
    expect(front.holes).toBeLessThan(0.005);
    expect(back.holes).toBeLessThan(0.005);
  }, 60_000);

  it('рибаны не печатаются, основное полотно печатается', async () => {
    const m = measurementsFrom(spec);
    const g = buildGeometry(m, 'front', defaults.minSleeveAngleDeg);

    // Точка на рукаве строится ОТ САМОГО РУКАВА, а не от его габарита:
    // середина низа рукава, отступя назад вдоль верхнего сгиба. Так она
    // остаётся внутри детали при любом угле отведения. Прежняя точка брала
    // абсциссу вдоль сгиба, а ординату — от половины высоты конца рукава,
    // и держалась внутри только пока рукав лежал полого: стоило опустить его
    // вдоль корпуса, как она уехала на белый фон. Тест ловил не заливку,
    // а укладку рукава.
    const dir = { x: Math.cos(g.sleeveAngle), y: Math.sin(g.sleeveAngle) };
    const cuffMid = {
      x: (g.sleeveTopEnd.x + g.sleeveBottomEnd.x) / 2,
      y: (g.sleeveTopEnd.y + g.sleeveBottomEnd.y) / 2,
    };
    const back = m.sleeveLength * 0.3;

    // Точки, каждая из которых лежит на конкретной детали изделия.
    // Долевая проверка говорит «где-то не залито»; эти точки говорят ГДЕ.
    const points = [
      { x: g.underarm.x * 0.5, y: g.underarm.y + 4 },
      { x: g.shoulderPoint.x * 0.6, y: g.shoulderPoint.y * 0.6 },
      { x: cuffMid.x - dir.x * back, y: cuffMid.y - dir.y * back },
    ];
    const labels = ['грудь', 'плечо', 'рукав'];

    if (m.hoodHeight !== undefined) {
      // Две точки капюшона, и вторая — та самая, где полгода зиял белый клин:
      // у самого шва втачивания, там, где контур как область замыкается
      // по хорде и не догоняет линию горловины.
      points.push({ x: 0.6, y: -m.hoodHeight * 0.5 }, { x: 0.6, y: -0.6 });
      labels.push('капюшон', 'капюшон у горловины');
    }

    if (m.waistRibHeight !== undefined) {
      points.push({ x: g.hem.x * 0.4, y: g.hem.y - m.waistRibHeight / 2 });
      labels.push('пояс');
    }
    if (m.neckRibHeight !== undefined) {
      points.push({ x: 0.6, y: m.frontNeckDrop + m.neckRibHeight / 2 });
      labels.push('бейка');
    }

    const colors = await probe(filled.front.svg, points);
    const seen = Object.fromEntries(labels.map((l, i) => [l, colors[i]!]));

    for (const label of ['грудь', 'плечо', 'рукав', 'капюшон', 'капюшон у горловины']) {
      if (label in seen) expect(seen[label], label).toBe('tile');
    }
    if ('пояс' in seen) expect(seen['пояс']).toBe('rib');
    if ('бейка' in seen) expect(seen['бейка']).toBe('rib');
  }, 60_000);
});

describe('узел обработки и линия на чертеже', () => {
  /**
   * Связь проверяется В ОБЕ СТОРОНЫ. Узел без линии оставляет технолога
   * с вопросом «где шов»; линия без узла обещает обработку, которой
   * в спецификации нет.
   */
  it.each(CATEGORIES)('%s: каждому узлу — своя линия', (category) => {
    const { spec } = buildStyleSpec(input(category));
    const flats = renderFlatsFromSpec(spec, flatDefaults(spec));
    const svgs = [flats.front.svg, flats.back.svg, ...(flats.side ? [flats.side.svg] : [])];
    const report = checkFlatLines(spec, svgs);
    expect(report.missing.map((m) => `${m.node_id} → ${m.expected}`)).toEqual([]);
    expect(report.orphan).toEqual([]);
  });
});
