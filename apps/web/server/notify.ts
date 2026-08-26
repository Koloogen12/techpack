/**
 * Уведомления бренду в кабинете — то, что показывает колокольчик.
 *
 * До этого модуля колокольчик показывал три выдуманных строки из макета.
 * Здесь он получает настоящие события, и из этого следует главное
 * требование: уведомление обязано ПЕРЕЖИТЬ рестарт сервиса. Генерация
 * идёт минуты, человек закрывает вкладку и возвращается к вечеру —
 * «пак готов» в памяти процесса ему бы не досталось.
 *
 * Хранение — jsonl на инвайт, дописыванием. Событий на человека десятки,
 * а не миллионы: читать файл целиком дешевле, чем заводить базу.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Цвет точки в списке — язык статусов хендоффа. */
export type NoteTone = 'ok' | 'alert' | 'muted';

export interface Note {
  id: string;
  at: string;
  title: string;
  sub: string;
  tone: NoteTone;
  /** Куда вести по клику: id пака и раздел документа. */
  job?: string;
  section?: string;
  /** Показать только предположения — сценарий «подтвердите N значений». */
  guesses?: boolean;
  read: boolean;
}

/** Сколько уведомлений держим на человека: панель показывает верхушку. */
const KEEP = 50;

export class Notifications {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private path(token: string): string {
    return join(this.dir, `${token}.jsonl`);
  }

  list(token: string): Note[] {
    const path = this.path(token);
    if (!existsSync(path)) return [];
    try {
      return readFileSync(path, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Note)
        .reverse()
        .slice(0, KEEP);
    } catch {
      return [];
    }
  }

  unread(token: string): number {
    return this.list(token).filter((n) => !n.read).length;
  }

  push(token: string, note: Omit<Note, 'id' | 'at' | 'read'>): Note {
    const full: Note = {
      id: Math.random().toString(36).slice(2, 10),
      at: new Date().toISOString(),
      read: false,
      ...note,
    };
    appendFileSync(this.path(token), JSON.stringify(full) + '\n');
    return full;
  }

  markRead(token: string): void {
    const path = this.path(token);
    if (!existsSync(path)) return;
    const items = this.list(token)
      .reverse()
      .map((n) => ({ ...n, read: true }));
    writeFileSync(path, items.map((n) => JSON.stringify(n)).join('\n') + '\n');
  }
}
