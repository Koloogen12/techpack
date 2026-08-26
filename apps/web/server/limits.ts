/**
 * Лимит генераций на инвайт.
 *
 * Генерация ходит в платные API и жжёт CPU браузером. До этого модуля
 * счётчик «2 из 3» был нарисован в интерфейсе, а на сервере не существовало
 * ничего: утёкшая инвайт-ссылка означала открытый кран.
 *
 * Три решения, которые здесь зафиксированы:
 *
 *  - СПИСЫВАЕМ ТОЛЬКО УСПЕХ. Сбой разбора фотографий — наша проблема, а не
 *    пользователя, и платить за неё лимитом он не должен. Обещание
 *    «ошибки и повторы бесплатны» напечатано в интерфейсе, значит оно
 *    обязано быть правдой в коде.
 *  - Месячная квота отдельно от подаренных генераций. Квота обнуляется
 *    первого числа, подарки (реферальная программа) — разовые и не сгорают.
 *    Иначе один приглашённый друг давал бы +1 генерацию каждый месяц вечно.
 *  - Помимо квоты есть частотный предел. Квота защищает деньги за месяц,
 *    но не мешает за минуту запустить всё, что осталось, — а перебор
 *    ссылки скриптом выглядит именно так.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Бесплатных генераций в месяц. Цену и тарифы решает СЕО — здесь только бета. */
export const FREE_PER_MONTH = 3;

/** Одновременно активных генераций на инвайт. Очередь и так одна на сервер. */
export const MAX_ACTIVE = 1;

/** Запусков в час на инвайт — потолок против перебора ссылки скриптом. */
export const MAX_PER_HOUR = 6;

export interface LimitState {
  /** Календарный месяц квоты, YYYY-MM. */
  month: string;
  /** Списано в этом месяце. */
  used: number;
  /** Подаренные генерации: не сгорают, тратятся после месячной квоты. */
  credits: number;
  /** Времена успешных запусков, ISO. Хвост старше часа отбрасывается. */
  starts: string[];
}

export interface LimitView {
  used: number;
  limit: number;
  credits: number;
  left: number;
  /** Первое число следующего месяца — «обновится 1 сентября» в интерфейсе. */
  resets_at: string;
}

function monthKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export class Limits {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private path(token: string): string {
    return join(this.dir, `${token}.json`);
  }

  private read(token: string, now = new Date()): LimitState {
    const path = this.path(token);
    const empty: LimitState = { month: monthKey(now), used: 0, credits: 0, starts: [] };
    if (!existsSync(path)) return empty;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<LimitState>;
      const state: LimitState = {
        month: raw.month ?? empty.month,
        used: Number(raw.used) || 0,
        credits: Number(raw.credits) || 0,
        starts: Array.isArray(raw.starts) ? raw.starts : [],
      };
      // Месяц сменился: квота обнуляется, подарки остаются.
      if (state.month !== monthKey(now)) {
        state.month = monthKey(now);
        state.used = 0;
      }
      return state;
    } catch {
      // Битый файл не должен запирать человека: считаем, что месяц чист.
      return empty;
    }
  }

  private write(token: string, state: LimitState): void {
    writeFileSync(this.path(token), JSON.stringify(state, null, 2));
  }

  /** Сколько осталось и когда обновится — для интерфейса. */
  view(token: string, monthly = FREE_PER_MONTH, now = new Date()): LimitView {
    const state = this.read(token, now);
    const left = Math.max(0, monthly - state.used) + state.credits;
    // Дата собирается по локальному календарю: toISOString увёл бы первое
    // число на предыдущий день для любого часового пояса восточнее UTC.
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const resets = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
    return {
      used: Math.min(state.used, monthly),
      limit: monthly,
      credits: state.credits,
      left,
      resets_at: resets,
    };
  }

  /**
   * Можно ли запускать генерацию.
   *
   * Возвращает причину отказа человеческим языком — она уезжает прямо
   * в интерфейс, поэтому написана для основателя бренда, а не для лога.
   */
  check(
    token: string,
    active: number,
    monthly = FREE_PER_MONTH,
    now = new Date(),
  ): { ok: true } | { ok: false; error: string; action: string } {
    const state = this.read(token, now);
    if (Math.max(0, monthly - state.used) + state.credits <= 0) {
      const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const when = next.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
      return {
        ok: false,
        error: `Бесплатные генерации на этот месяц закончились (${monthly} из ${monthly}).`,
        action: `Лимит обновится ${when}. Правки замеров, экспорт и чертежи остаются доступны.`,
      };
    }
    if (active >= MAX_ACTIVE) {
      return {
        ok: false,
        error: 'Одна генерация уже идёт.',
        action: 'Дождитесь её окончания — обычно это 1–3 минуты.',
      };
    }
    const hourAgo = now.getTime() - 3600_000;
    const recent = state.starts.filter((at) => Date.parse(at) > hourAgo);
    if (recent.length >= MAX_PER_HOUR) {
      return {
        ok: false,
        error: 'Слишком много запусков за час.',
        action: 'Подождите немного и повторите — это защита от случайных повторов.',
      };
    }
    return { ok: true };
  }

  /** Отметить факт запуска — для частотного предела. Квоту не трогает. */
  noteStart(token: string, now = new Date()): void {
    const state = this.read(token, now);
    const hourAgo = now.getTime() - 3600_000;
    state.starts = state.starts.filter((at) => Date.parse(at) > hourAgo).concat(now.toISOString());
    this.write(token, state);
  }

  /**
   * Списать одну генерацию. Вызывается ТОЛЬКО после успешной сборки пака.
   * Сначала тратится месячная квота, потом подаренные.
   */
  charge(token: string, monthly = FREE_PER_MONTH, now = new Date()): LimitView {
    const state = this.read(token, now);
    if (state.used < monthly) state.used += 1;
    else if (state.credits > 0) state.credits -= 1;
    this.write(token, state);
    return this.view(token, monthly, now);
  }

  /** Начислить подаренные генерации (реферальная программа). */
  grant(token: string, count: number, now = new Date()): LimitView {
    const state = this.read(token, now);
    state.credits += count;
    this.write(token, state);
    return this.view(token, FREE_PER_MONTH, now);
  }
}
