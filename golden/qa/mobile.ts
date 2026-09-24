/**
 * Сторож мобильного слоя (ADR-0014): кабинет и публичная ссылка на ширинах
 * телефона не выходят за экран, не мельчат и не роняют консоль; на десктопе
 * телефонных элементов нет — разметка прототипа остаётся как есть.
 *
 *   pnpm qa:mobile                       локальный кабинет (127.0.0.1:8132)
 *   BASE=https://seamster.pro TOKEN=g-… pnpm qa:mobile   прод гостем
 *
 * Обход: рабочая область → первый пак → каждый раздел по чипам → мастер и
 * Escape → публичная ссылка (если у пака есть share.txt или задан SHARE).
 * Переполнение считается только вне прокручиваемых контейнеров: таблица
 * замеров прокручивается по горизонтали намеренно.
 */
import { existsSync, readFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';

const BASE = (process.env.BASE ?? 'http://127.0.0.1:8132').replace(/\/$/, '');
const TOKEN = process.env.TOKEN ?? 'localdemo1234567890';
const DATA = process.env.DATA ?? 'apps/web/data';
const PHONES = [375, 390];

interface Probe {
  vw: number;
  scrollW: number;
  over: string[];
  small: string[];
  secbar: boolean;
  rail: boolean;
}

let shots = 0;
const problems: string[] = [];
const ok: string[] = [];

// Код замера уходит в страницу строкой: tsx (esbuild) вписывает во вложенные
// функции помощник __name, которого в браузере нет.
const PROBE_SRC = `(() => {
  const vw = innerWidth;
  const els = [...document.querySelectorAll('body *')];
  const scrolls = (e) => {
    for (let p = e.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll|hidden)/.test(s.overflowX) || /(auto|scroll|hidden)/.test(s.overflow)) return true;
    }
    return false;
  };
  const over = els
    .filter((e) => {
      const r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.right > vw + 1)) return false;
      return getComputedStyle(e).position !== 'fixed' && !scrolls(e);
    })
    .slice(0, 5)
    .map((e) => e.tagName.toLowerCase() + ' «' + (e.textContent || '').trim().slice(0, 30) + '»');
  const small = els
    .filter((e) => {
      if (e.children.length || !(e.textContent || '').trim()) return false;
      if (e.closest('.m-keep') || e.closest('svg')) return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && parseFloat(getComputedStyle(e).fontSize) < 10;
    })
    .slice(0, 5)
    .map((e) => '«' + (e.textContent || '').trim().slice(0, 24) + '» ' + getComputedStyle(e).fontSize);
  const rail = document.querySelector('.m-rail');
  return {
    vw,
    scrollW: document.documentElement.scrollWidth,
    over,
    small,
    secbar: !!document.querySelector('.m-secbar'),
    rail: !!rail && getComputedStyle(rail).display !== 'none',
  };
})()`;

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(PROBE_SRC) as Promise<Probe>;
}

// Клик по видимому тексту: прототип держит один и тот же текст в боковой
// панели (скрыта за overflow) и в карточке; locator берёт первый и утыкается
// в перехват событий. Здесь — центр самого широкого элемента, который
// действительно под курсором, и настоящий клик мышью по координатам.
async function clickText(page: Page, text: string): Promise<boolean> {
  const at = (await page.evaluate(`((text) => {
    // Открыта боковая панель (есть скрим) — ищем только внутри неё: тот же
    // текст лежит и в карточке рабочей области под скримом.
    const inPanel = !!document.querySelector('.m-scrim');
    const fixedAncestor = (e) => {
      for (let p = e.parentElement; p; p = p.parentElement)
        if (getComputedStyle(p).position === 'fixed') return p.getBoundingClientRect().width <= 340;
      return false;
    };
    const cands = [...document.querySelectorAll('span,div,a')]
      .filter((e) => e.children.length === 0 && (e.textContent || '').trim().startsWith(text))
      .filter((e) => !inPanel || fixedAncestor(e))
      .map((e) => ({ e, r: e.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0)
      // Точка — у начала текста: длинное имя обрезается многоточием, и его
      // середина может лежать под соседней кнопкой. Перехват клика не
      // проверяется: если пак не откроется, это поймает проверка чипов.
      .sort((a, b) => b.r.width - a.r.width);
    const c = cands[0];
    if (!c) return null;
    // Кандидат может быть ниже сгиба: на телефоне рабочая область длинная.
    c.e.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = c.e.getBoundingClientRect();
    return [r.left + Math.min(40, r.width / 2), r.top + r.height / 2];
  })(${JSON.stringify(text)})`)) as [number, number] | null;
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/pre-${shots + 1}.png` });
  if (!at) return false;
  if (process.env.SHOT)
    console.log(`  · клик «${text.slice(0, 24)}» в (${Math.round(at[0])}, ${Math.round(at[1])})`);
  await page.mouse.click(at[0], at[1]);
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/step-${++shots}.png` });
  return true;
}

function judge(label: string, p: Probe, phone: boolean): void {
  const bad: string[] = [];
  if (p.scrollW > p.vw + 1) bad.push(`страница шире экрана: ${p.scrollW} > ${p.vw}`);
  if (p.over.length) bad.push(`за правым краем: ${p.over.join('; ')}`);
  if (phone && p.small.length) bad.push(`мельче 10 px: ${p.small.join('; ')}`);
  if (bad.length) problems.push(`${label}: ${bad.join(' · ')}`);
  else ok.push(label);
}

async function settle(page: Page, ms = 900): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(ms);
}

async function firstJob(): Promise<{ id: string; name: string } | null> {
  const r = await fetch(`${BASE}/app/api/jobs`, { headers: { 'x-invite': TOKEN } });
  if (!r.ok) return null;
  const { jobs } = (await r.json()) as { jobs: { id: string; name: string; stage: string }[] };
  const done = jobs.filter((j) => j.stage === 'done');
  // Для публичной ссылки нужен пак с share.txt; иначе — первый готовый.
  const shared = done.find((j) => shareTokenOf(j.id));
  const pick = shared ?? done[0];
  return pick ? { id: pick.id, name: pick.name } : null;
}

function shareTokenOf(id: string): string | null {
  if (process.env.SHARE) return process.env.SHARE;
  const f = `${DATA}/jobs/${id}/share.txt`;
  return existsSync(f) ? readFileSync(f, 'utf8').trim() : null;
}

const browser = await chromium.launch();
try {
  const job = await firstJob();
  for (const width of PHONES) {
    const ctx = await browser.newContext({
      viewport: { width, height: 812 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 120)));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/409|Failed to load resource/.test(m.text()))
        errors.push(m.text().slice(0, 120));
    });
    const tag = (s: string): string => `${width}px · ${s}`;

    await page.goto(`${BASE}/app/?t=${TOKEN}`);
    await settle(page, 1500);
    judge(tag('рабочая область'), await probe(page), true);

    if (job) {
      // Через список паков: тот же текст в боковой панели лежит под её
      // прокруткой, а в списке — единственная видимая строка.
      await clickText(page, 'Все паки списком');
      await settle(page, 800);
      if (!(await clickText(page, job.name))) problems.push(tag('пак не найден в списке'));
      await page.waitForSelector('.m-secbar', { timeout: 5000 }).catch(() => undefined);
      await settle(page, 1200);
      const p = await probe(page);
      judge(tag('обзор пака'), p, true);
      if (!p.secbar) {
        problems.push(tag('обзор пака: нет строки чипов разделов'));
        if (process.env.SHOT)
          await page.screenshot({ path: `${process.env.SHOT}/guard-${width}.png` });
      }
      if (p.rail) problems.push(tag('обзор пака: рейл виден на телефоне'));
      const chips = page.locator('.m-secchip');
      const n = await chips.count();
      for (let i = 1; i < n; i++) {
        const label = ((await chips.nth(i).textContent()) ?? '').trim().replace(/^\d+\./, '');
        await chips.nth(i).click();
        await settle(page, 700);
        judge(tag(`раздел «${label}»`), await probe(page), true);
      }
    } else {
      problems.push(tag('нет готового пака — обход разделов пропущен'));
    }

    // Мастер: во всю ширину, закрывается Escape.
    await page.goto(`${BASE}/app/?t=${TOKEN}`);
    await settle(page, 1200);
    await clickText(page, 'Создать техпак');
    await settle(page, 600);
    const panel = page.getByText('Загрузите референсы').first();
    if (await panel.isVisible().catch(() => false)) {
      judge(tag('панель мастера'), await probe(page), true);
      const box = await panel
        .locator('xpath=ancestor::div[contains(@style,"position: fixed")][1]')
        .boundingBox();
      if (box && box.width < width - 40)
        problems.push(tag(`панель мастера не во всю ширину: ${Math.round(box.width)} из ${width}`));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      if (await panel.isVisible().catch(() => false))
        problems.push(tag('Escape не закрыл панель мастера'));
      else ok.push(tag('Escape закрывает панель мастера'));
    } else {
      problems.push(tag('панель мастера не открылась'));
    }

    // Публичная ссылка для фабрики.
    const share = job ? shareTokenOf(job.id) : null;
    if (share) {
      await page.goto(`${BASE}/p/${share}`);
      await settle(page, 1200);
      const p = await probe(page);
      judge(tag('публичная ссылка'), p, true);
      const meta = await page.locator('meta[name="viewport"]').count();
      if (!meta) problems.push(tag('публичная ссылка без viewport'));
    } else {
      ok.push(tag('публичная ссылка: токена нет, пропущено'));
    }

    if (errors.length)
      problems.push(tag(`ошибки консоли: ${[...new Set(errors)].slice(0, 3).join(' | ')}`));
    await ctx.close();
  }

  // Десктоп: телефонных элементов нет, рейл на месте.
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await desk.newPage();
  await page.goto(`${BASE}/app/?t=${TOKEN}`);
  await settle(page, 1200);
  if (job) {
    await clickText(page, 'Все паки списком');
    await settle(page, 800);
    await clickText(page, job.name);
    await settle(page, 1200);
    const p = await probe(page);
    if (p.secbar) problems.push('1280px: строка чипов разделов видна на десктопе');
    if (!p.rail) problems.push('1280px: рейл разделов не виден на десктопе');
    if (!p.secbar && p.rail) ok.push('1280px · десктоп без телефонных элементов, рейл на месте');
  }
  await desk.close();
} finally {
  await browser.close();
}

for (const line of ok) console.log(`  ✓ ${line}`);
for (const line of problems) console.log(`  ✗ ${line}`);
console.log(`\nмобильный сторож: проблем ${problems.length}, ок ${ok.length}`);
process.exit(problems.length ? 1 : 0);
