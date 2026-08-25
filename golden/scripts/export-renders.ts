/**
 * Выгрузка живых визуализаций из кэша в референсы голден-набора.
 *
 * Картинки получены настоящим вызовом модели по промпту, собранному из спеки.
 * В репозиторий кладутся ужатые копии: в тестах они не участвуют, их дело —
 * показывать, что именно выдаёт сервис сегодня, и служить точкой сравнения,
 * когда промпт визуализации поменяется.
 *
 * Оригиналы (по полтора мегабайта) остаются в кэше и в репозиторий не едут.
 *
 * Запуск: pnpm golden:renders (нужен прогретый кэш — сначала прогон с --render).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { buildStyleSpec } from '@specform/assembly';
import { VisionReportSchema } from '@specform/vision';
import { FileRenderCache, visualize } from '@specform/render';
import { fitImage } from '@specform/docgen';
import { parseAnswers, specInputFrom } from '@specform/cli';

/** Дата фиксирована: она не влияет на промпт, но влияет на отпечаток спеки. */
const AT = new Date('2026-08-25T00:00:00.000Z');

/** Длинная сторона референса. Достаточно, чтобы судить о вещи, и не мегабайты. */
const REFERENCE_PX = 1000;

const cache = new FileRenderCache('.cache/render');
const browser = await chromium.launch();
mkdirSync('golden/renders', { recursive: true });

try {
  for (const cat of ['tshirt', 'longsleeve', 'sweatshirt', 'hoodie'] as const) {
    const answers = parseAnswers(
      JSON.parse(readFileSync(`golden/answers/${cat}-women-46.json`, 'utf8')),
    );
    const report = VisionReportSchema.parse(
      JSON.parse(readFileSync(`golden/vision-reports/${cat}.json`, 'utf8')),
    );

    // Спека собирается ТЕМ ЖЕ кодом, что и в пайплайне: иначе промпт выйдет
    // другим и кэш промахнётся, а причину придётся искать в двух местах.
    const { spec } = buildStyleSpec(specInputFrom(answers, report, { now: AT }));

    // Строго офлайн: скрипт выгружает то, что уже сгенерировано,
    // и не может незаметно потратить деньги на новый вызов.
    const result = await visualize(spec, { cache, offline: true });
    if (!result.ok) {
      console.log(`  ✗ ${cat}: визуализации нет в кэше (${result.reason})`);
      continue;
    }

    const small = await fitImage(browser, result.image.dataUri, REFERENCE_PX);
    const bytes = Buffer.from(small.slice(small.indexOf(',') + 1), 'base64');
    const ext = small.startsWith('data:image/png') ? 'png' : 'jpg';
    writeFileSync(`golden/renders/${cat}.${ext}`, bytes);
    console.log(`  ✓ ${cat.padEnd(12)} ${(bytes.length / 1024).toFixed(0)} КБ · ${ext}`);
  }
} finally {
  await browser.close();
}
