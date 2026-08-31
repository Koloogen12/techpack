import { CATEGORIES } from '@seamster/kb';
/**
 * Кадры спинки для голден-набора.
 *
 * Генерируются ОТ снимка переда, а не с нуля: для проверки ракурсов нужна
 * та же самая вещь с другой стороны, иначе сравнивать нечего. Опорный кадр
 * уходит в модель вместе с описанием — так сохраняются цвет, полотно
 * и пропорции.
 *
 * Запуск: pnpm golden:backviews (нужен ключ сервиса изображений).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { generateImage } from '@seamster/render';

/** Что видно со спинки именно у этой категории. */
const BACK_DETAILS: Record<string, string> = {
  hoodie:
    'The hood lies flat down the back showing its full height and width; no drawcords ' +
    'are visible from behind. Ribbed cuffs and a ribbed waistband.',
  sweatshirt: 'Ribbed cuffs and a ribbed waistband. A plain back with no seams across it.',
  tshirt: 'A plain back with a coverstitched hem and the neckband seam visible along the top.',
  longsleeve: 'A plain back with coverstitched hem and sleeve hems.',
};

/** Пересжатие в PNG тем же браузером, что печатает документы. */
async function toPng(bytes: Uint8Array, mediaType: string): Promise<Buffer> {
  if (mediaType === 'image/png') return Buffer.from(bytes);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const uri = `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`;
    const png = await page.evaluate(async (src: string) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      return canvas.toDataURL('image/png');
    }, uri);
    return Buffer.from(png.slice(png.indexOf(',') + 1), 'base64');
  } finally {
    await browser.close();
  }
}

for (const cat of CATEGORIES) {
  const front = readFileSync(`golden/photos/${cat}-front.png`);
  const prompt = [
    'The reference image shows the FRONT of a garment laid flat, shot from directly above.',
    'Generate the BACK of the exact same garment: identical colour, identical fabric,',
    'identical size and proportions, laid flat on the same surface, shot from directly above,',
    'same lighting, same framing, same distance.',
    BACK_DETAILS[cat] ?? '',
    // Ровно те замечания, которые модель разбора высказала на первом прогоне.
    'The garment is laid perfectly straight with sleeves angled away from the body and',
    'not folded diagonally. The fabric is smoothed flat without stretching.',
    'No text, no logos, no print, no props, no hands. Same neutral background as the reference.',
  ]
    .filter(Boolean)
    .join(' ');

  const image = await generateImage(prompt, {
    references: [{ bytes: front, mediaType: 'image/png' }],
  });
  // Расширение сервис выбирает сам и меняет от вызова к вызову. Голден-набор
  // ходит по путям, собранным строкой, поэтому имя фиксировано, а формат
  // приводится к PNG на месте.
  const out = `golden/photos/${cat}-back.png`;
  writeFileSync(out, await toPng(image.bytes, image.mediaType));
  console.log(`  ✓ ${cat}-back.png  ${(image.bytes.length / 1024).toFixed(0)} КБ · ${image.ms} мс`);
}
