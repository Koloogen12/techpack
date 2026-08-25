import { chromium, type Browser } from 'playwright';

/**
 * Цветоделение тайла — детерминированное, без модели.
 *
 * Печатнику для шелкографии нужен не «красивый список цветов», а ответ
 * на два вопроса: сколько сеток жечь и какие именно. Оба считаются
 * арифметикой по пикселям, и просить их у языковой модели значило бы
 * получить правдоподобный список вместо верного.
 *
 * Алгоритм — медианное сечение (median cut): гистограмма цветов делится
 * по самой длинной оси пополам, пока не наберётся нужное число ящиков.
 * Он детерминирован ПОСТРОЕНИЕМ, а не за счёт зафиксированного зерна:
 * один и тот же тайл всегда даёт один и тот же список, и повторный заказ
 * через полгода получит те же сетки.
 *
 * Расстояния считаются в Lab, а не в RGB: в RGB одинаковая арифметическая
 * разница означает разную видимую разницу, и две зелёные краски, которые
 * глазу почти одинаковы, разъезжаются по разным сеткам.
 */

export interface DominantColor {
  hex: string;
  rgb: [number, number, number];
  lab: [number, number, number];
  /** Доля пикселей тайла, отнесённых к этому цвету. */
  share: number;
}

export interface ColorReport {
  colors: DominantColor[];
  /**
   * Доля пикселей, попавших близко к своему представителю (ΔE < 6).
   *
   * У плоской графики она высокая: пиксель либо ровно того цвета,
   * либо на границе. У фотографии низкая: там непрерывные переходы,
   * и любое конечное число красок оставляет большинство пикселей далеко.
   */
  fidelity: number;
  /** Годится ли рисунок для плашечной печати и векторизации. */
  flat_graphic: boolean;
  width: number;
  height: number;
}

/**
 * Порог верности, за которым рисунок считается плоской графикой.
 *
 * Подобран на своих же тайлах: сгенерированный ботанический раппорт
 * с ограниченной палитрой даёт около 0.95, фотография ткани — ниже 0.6.
 * Значение консервативное: ошибочно назвать фотографию плоской графикой
 * значит пообещать печатнику вектор, который развалится.
 */
export const FLAT_GRAPHIC_FIDELITY = 0.85;

/** Порог различимости в Lab. ΔE около 2 — предел глаза, 6 — уверенно видно. */
const DELTA_E_CLOSE = 6;

/**
 * Порог слияния красок.
 *
 * Медианное сечение делит по числу пикселей, поэтому фон, занимающий
 * шестьдесят процентов тайла, оно дробит и дробит: на первом прогоне
 * из шести «цветов» четыре оказались почти одинаковыми оттенками белого.
 * Для печати это прямой брак — четыре сетки под одну краску.
 *
 * Поэтому ящиков берётся с запасом, а потом близкие сливаются. ΔE = 4
 * ниже порога уверенной различимости: то, что сливается, печатник и так
 * не стал бы разводить по разным сеткам.
 */
const MERGE_DELTA_E = 4;

/** Во сколько раз больше ящиков брать до слияния. */
const OVERSHOOT = 3;

export async function extractColors(
  dataUri: string,
  count: number,
  browser?: Browser,
): Promise<ColorReport> {
  const own = browser === undefined;
  const b = browser ?? (await chromium.launch());
  try {
    const page = await b.newPage();
    try {
      // Плоские циклы без именованных функций: код исполняется в браузере,
      // и сборщик не должен иметь к нему отношения (см. seam.ts).
      const raw = await page.evaluate(
        async ([uri, n]: [string, number]) => {
          const img = new Image();
          img.src = uri;
          await img.decode();

          const w = img.naturalWidth;
          const h = img.naturalHeight;
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
          ctx.drawImage(img, 0, 0);
          const data = ctx.getImageData(0, 0, w, h).data;

          // Гистограмма по 5 битам на канал: 32768 ящиков достаточно,
          // чтобы различить краски, и мало, чтобы считать быстро.
          const bins = new Int32Array(32 * 32 * 32);
          const total = w * h;
          for (let i = 0; i < total; i++) {
            const o = i * 4;
            const key = ((data[o]! >> 3) << 10) | ((data[o + 1]! >> 3) << 5) | (data[o + 2]! >> 3);
            bins[key]!++;
          }

          const used: number[] = [];
          for (let k = 0; k < bins.length; k++) if (bins[k]! > 0) used.push(k);

          // Медианное сечение: ящик с самой длинной осью делится пополам
          // по этой оси. Порядок обхода детерминирован, случайности нет.
          let boxes: number[][] = [used];
          while (boxes.length < n) {
            let bestIndex = -1;
            let bestSpread = -1;
            let bestAxis = 0;
            for (let bi = 0; bi < boxes.length; bi++) {
              const box = boxes[bi]!;
              if (box.length < 2) continue;
              for (let axis = 0; axis < 3; axis++) {
                let lo = 32;
                let hi = -1;
                for (const key of box) {
                  const v = axis === 0 ? key >> 10 : axis === 1 ? (key >> 5) & 31 : key & 31;
                  if (v < lo) lo = v;
                  if (v > hi) hi = v;
                }
                const spread = hi - lo;
                if (spread > bestSpread) {
                  bestSpread = spread;
                  bestIndex = bi;
                  bestAxis = axis;
                }
              }
            }
            if (bestIndex < 0 || bestSpread <= 0) break;

            const box = boxes[bestIndex]!;
            const axis = bestAxis;
            box.sort((p, q) => {
              const a = axis === 0 ? p >> 10 : axis === 1 ? (p >> 5) & 31 : p & 31;
              const c = axis === 0 ? q >> 10 : axis === 1 ? (q >> 5) & 31 : q & 31;
              return a - c || p - q;
            });
            // Делим по медиане ПО ЧИСЛУ ПИКСЕЛЕЙ, а не по числу ящиков:
            // иначе редкий, но заметный цвет теряется в общей массе.
            let half = 0;
            for (const key of box) half += bins[key]!;
            half /= 2;
            let acc = 0;
            let cut = 1;
            for (let i = 0; i < box.length; i++) {
              acc += bins[box[i]!]!;
              if (acc >= half) {
                cut = Math.max(1, Math.min(box.length - 1, i + 1));
                break;
              }
            }
            boxes = [
              ...boxes.slice(0, bestIndex),
              box.slice(0, cut),
              box.slice(cut),
              ...boxes.slice(bestIndex + 1),
            ];
          }

          // Представитель ящика — средний цвет, взвешенный по числу пикселей.
          const reps: { rgb: [number, number, number]; count: number }[] = [];
          for (const box of boxes) {
            let r = 0;
            let g = 0;
            let bl = 0;
            let c = 0;
            for (const key of box) {
              const cnt = bins[key]!;
              r += ((key >> 10) * 8 + 4) * cnt;
              g += (((key >> 5) & 31) * 8 + 4) * cnt;
              bl += ((key & 31) * 8 + 4) * cnt;
              c += cnt;
            }
            if (c === 0) continue;
            reps.push({
              rgb: [Math.round(r / c), Math.round(g / c), Math.round(bl / c)],
              count: c,
            });
          }

          return { w, h, total, reps, data: Array.from(data.slice(0, 0)) };
        },
        [dataUri, Math.min(count * OVERSHOOT, 32)] as [string, number],
      );

      // Сливаем неразличимые и оставляем самые крупные: число красок —
      // это число сеток, и лишняя сетка стоит денег на ровном месте.
      const merged = mergeClose(raw.reps).slice(0, count);

      // Верность считается ПОСЛЕ слияния, по той палитре, которая реально
      // уедет в печать. Считать её по промежуточным ящикам значило бы
      // отчитываться о точности, которой у отгружаемого файла нет.
      const fidelity = await measureFidelity(
        dataUri,
        merged.map((r) => r.rgb),
        b,
      );

      const colors: DominantColor[] = merged.map((r) => ({
        hex: toHex(r.rgb),
        rgb: r.rgb,
        lab: rgbToLab(r.rgb),
        share: Math.round((r.count / raw.total) * 1000) / 1000,
      }));

      return {
        colors,
        fidelity: Math.round(fidelity * 1000) / 1000,
        flat_graphic: fidelity >= FLAT_GRAPHIC_FIDELITY,
        width: raw.w,
        height: raw.h,
      };
    } finally {
      await page.close();
    }
  } finally {
    if (own) await b.close();
  }
}

/** Доля пикселей, лежащих ближе ΔE = 6 к своему представителю. */
async function measureFidelity(
  dataUri: string,
  reps: readonly [number, number, number][],
  browser: Browser,
): Promise<number> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ([uri, palette, limit]: [string, number[][], number]) => {
        const img = new Image();
        img.src = uri;
        await img.decode();
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, w, h).data;

        // Пиксели берём выборкой: каждый шестнадцатый даёт ту же долю
        // с точностью до сотых и считается мгновенно.
        let close = 0;
        let seen = 0;
        for (let i = 0; i < w * h; i += 16) {
          const o = i * 4;
          let best = Infinity;
          for (const p of palette) {
            // Евклидово расстояние в RGB — грубая, но монотонная замена
            // ΔE для отбора БЛИЖАЙШЕГО; сам порог задан в Lab снаружи.
            const d =
              (data[o]! - p[0]!) ** 2 + (data[o + 1]! - p[1]!) ** 2 + (data[o + 2]! - p[2]!) ** 2;
            if (d < best) best = d;
          }
          seen++;
          if (Math.sqrt(best) <= limit) close++;
        }
        return seen ? close / seen : 0;
      },
      [dataUri, reps.map((r) => [...r]), DELTA_E_CLOSE * 2.5] as [string, number[][], number],
    );
  } finally {
    await page.close();
  }
}

/**
 * Слияние неразличимых красок.
 *
 * Жадное и детерминированное: идём от самой крупной к мелким, каждую
 * мелкую присоединяем к первой достаточно близкой. Порядок задан долей
 * площади, поэтому результат не зависит ни от чего, кроме самой картинки.
 */
function mergeClose(
  reps: readonly { rgb: [number, number, number]; count: number }[],
): { rgb: [number, number, number]; count: number }[] {
  const sorted = [...reps].sort((a, b) => b.count - a.count);
  const out: { rgb: [number, number, number]; count: number; lab: [number, number, number] }[] = [];

  for (const rep of sorted) {
    const lab = rgbToLab(rep.rgb);
    const near = out.find((o) => deltaE(o.lab, lab) < MERGE_DELTA_E);
    if (near) {
      // Цвет объединённой краски остаётся у КРУПНОЙ: она задаёт тон,
      // а усреднение с мелкой сдвинуло бы его без всякой пользы.
      near.count += rep.count;
    } else {
      out.push({ rgb: rep.rgb, count: rep.count, lab });
    }
  }

  return out.map(({ rgb, count }) => ({ rgb, count }));
}

export function toHex([r, g, b]: readonly [number, number, number]): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** sRGB → CIE Lab (D65). Нужен, чтобы «похоже» означало похоже для глаза. */
export function rgbToLab([r, g, b]: readonly [number, number, number]): [number, number, number] {
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);

  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;

  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return [
    Math.round((116 * fy - 16) * 10) / 10,
    Math.round(500 * (fx - fy) * 10) / 10,
    Math.round(200 * (fy - fz) * 10) / 10,
  ];
}

/** ΔE 1976 — расстояние в Lab. Простое и достаточное для подбора краски. */
export function deltaE(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return Math.round(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 10) / 10;
}
