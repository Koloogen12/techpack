/**
 * Реферальная программа без регистрации.
 *
 * Публичного входа у нас нет и на бете не будет: инвайт заводит человек.
 * Поэтому «пригласить друга» не может работать как обычно (перешёл по
 * ссылке → создал аккаунт → реферер получил бонус). Здесь цепочка такая:
 *
 *   бренд копирует свою ссылку  →  друг открывает и оставляет контакт
 *   →  заявка падает в админский Телеграм  →  СЕО одобряет одной ссылкой
 *   →  друг получает инвайт, приглашающий получает +1 генерацию.
 *
 * Бонус начисляется в момент ОДОБРЕНИЯ, а не в момент клика по ссылке:
 * иначе один человек накрутил бы себе генерации, открывая свою же ссылку.
 *
 * Код реферала выводится из инвайт-токена хешем, а не хранится отдельно:
 * нечему рассинхронизироваться, и код нельзя подобрать обратно к токену.
 */
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Claim {
  id: string;
  at: string;
  /** Код пригласившего. */
  ref: string;
  name: string;
  contact: string;
  note: string;
  /** Заведённый инвайт-токен — заполняется при одобрении. */
  approved?: string;
}

/** Публичный код приглашающего: 8 символов от хеша токена. */
export function refCode(token: string): string {
  return createHash('sha256').update(`seamsterly-ref:${token}`).digest('hex').slice(0, 8);
}

export class Referrals {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private get path(): string {
    return join(this.dir, 'claims.jsonl');
  }

  all(): Claim[] {
    if (!existsSync(this.path)) return [];
    try {
      return readFileSync(this.path, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Claim);
    } catch {
      return [];
    }
  }

  /** Заявки по коду приглашающего — из них считается «привёл N друзей». */
  byRef(code: string): Claim[] {
    return this.all().filter((c) => c.ref === code);
  }

  add(claim: Omit<Claim, 'id' | 'at'>): Claim {
    const full: Claim = {
      id: randomBytes(4).toString('hex'),
      at: new Date().toISOString(),
      ...claim,
    };
    appendFileSync(this.path, JSON.stringify(full) + '\n');
    return full;
  }

  /** Пометить заявку одобренной. Повторное одобрение не начисляет бонус дважды. */
  approve(id: string, inviteToken: string): Claim | null {
    const items = this.all();
    const found = items.find((c) => c.id === id);
    if (!found || found.approved) return null;
    found.approved = inviteToken;
    writeFileSync(this.path, items.map((c) => JSON.stringify(c)).join('\n') + '\n');
    return found;
  }
}
