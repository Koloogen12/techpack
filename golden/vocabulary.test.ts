import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildStyleSpec } from '@seamster/assembly';
import { OBSERVATION_KEYS, observationVocabulary, type ObservationKey } from '@seamster/core';
import type { PhotoView } from '@seamster/kb';
import {
  FileVisionCache,
  PROMPT_VERSION,
  VISION_SCHEMA_VERSION,
  VisionReportSchema,
  analyzePhotos,
  type Photo,
  type VisionReport,
} from '@seamster/vision';
import { parseAnswers, specInputFrom } from '@seamster/cli';

/**
 * Золотой набор по словарям: точность разбора в цифрах, а не в спорах по
 * скриншотам.
 *
 * `golden/vocabulary/expectations.json` — ожидания технолога по каждому
 * эталонному снимку: значения словарей и узлы, которые обязаны быть или не
 * быть в собранной спеке. Прогон сравнивает с ними живой ответ модели
 * (SEAMSTER_GOLDEN_LIVE=1, нужен ключ) или последний сохранённый отчёт из
 * `golden/vision-reports/vocab/`, считает точность по каждому словарю,
 * полноту и точность узлов, пишет `golden/reports/vocabulary-latest.json`
 * и строку истории. Ночной прогон — `pnpm golden:vocab`.
 *
 * Без ключа набор проверяет только себя: ожидания валидны, снимки на месте,
 * сохранённые отчёты читаются. Дрейф точности ловится ночью, а не в CI.
 */
const ROOT = new URL('./', import.meta.url).pathname;
const LIVE = process.env.SEAMSTER_GOLDEN_LIVE === '1';
const AT = new Date('2026-09-24T00:00:00.000Z');

interface Entry {
  id: string;
  answers: string;
  photos: { file: string; view: PhotoView }[];
  observations: Record<ObservationKey, string[]>;
  nodes_present: string[];
  nodes_absent: string[];
}
interface Expectations {
  version: number;
  entries: Entry[];
}

const expectations = JSON.parse(
  readFileSync(`${ROOT}vocabulary/expectations.json`, 'utf8'),
) as Expectations;

const reportPath = (id: string): string => `${ROOT}vision-reports/vocab/${id}.json`;

async function reportFor(entry: Entry): Promise<VisionReport | null> {
  const answers = parseAnswers(JSON.parse(readFileSync(`${ROOT}answers/${entry.answers}`, 'utf8')));
  if (LIVE) {
    const photos: Photo[] = entry.photos.map((p) => ({
      bytes: new Uint8Array(readFileSync(`${ROOT}${p.file}`)),
      format: p.file.endsWith('.png') ? 'png' : 'jpeg',
      view: p.view,
      label: p.file,
    }));
    const { report } = await analyzePhotos({
      photos,
      category: answers.category,
      fabric: answers.fabric_kind,
      answersFingerprint: `golden-vocab-${entry.id}`,
      cache: new FileVisionCache(`${ROOT}../.cache/vision`),
    });
    mkdirSync(`${ROOT}vision-reports/vocab`, { recursive: true });
    writeFileSync(reportPath(entry.id), JSON.stringify(report, null, 2));
    return report;
  }
  const path = reportPath(entry.id);
  if (!existsSync(path)) return null;
  return VisionReportSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

interface Score {
  id: string;
  observations: Record<string, { expected: string[]; got: string | null; hit: boolean }>;
  observation_accuracy: number | null;
  node_recall: number;
  node_precision_absent: number;
  missing: string[];
  extra: string[];
}

function score(entry: Entry, report: VisionReport): Score {
  const observations: Score['observations'] = {};
  let hits = 0;
  let asked = 0;
  for (const key of OBSERVATION_KEYS) {
    const expected = entry.observations[key];
    const got = report.observations?.[key]?.value ?? null;
    const hit = got !== null && expected.includes(got);
    observations[key] = { expected, got, hit };
    if (report.observations) {
      asked++;
      if (hit) hits++;
    }
  }
  const answers = parseAnswers(JSON.parse(readFileSync(`${ROOT}answers/${entry.answers}`, 'utf8')));
  const spec = buildStyleSpec(specInputFrom(answers, report, { now: AT })).spec;
  const ids = new Set(spec.construction!.nodes.map((n) => n.node_id));
  const missing = entry.nodes_present.filter((id) => !ids.has(id));
  const extra = entry.nodes_absent.filter((id) => ids.has(id));
  return {
    id: entry.id,
    observations,
    observation_accuracy: asked ? hits / asked : null,
    node_recall: 1 - missing.length / Math.max(1, entry.nodes_present.length),
    node_precision_absent: 1 - extra.length / Math.max(1, entry.nodes_absent.length),
    missing,
    extra,
  };
}

describe('золотой набор по словарям', () => {
  it('ожидания валидны: ключи и значения из словарей, снимки и анкеты на месте', () => {
    expect(expectations.entries.length).toBeGreaterThanOrEqual(5);
    for (const e of expectations.entries) {
      expect(existsSync(`${ROOT}answers/${e.answers}`), e.answers).toBe(true);
      for (const p of e.photos) expect(existsSync(`${ROOT}${p.file}`), p.file).toBe(true);
      for (const key of OBSERVATION_KEYS) {
        const { values } = observationVocabulary(key);
        expect(e.observations[key]?.length, `${e.id}.${key}`).toBeGreaterThan(0);
        for (const v of e.observations[key]!) expect(values).toContain(v);
      }
    }
  });

  it('прогон: точность словарей и узлов — в отчёт и в историю', async () => {
    const scores: Score[] = [];
    const skipped: string[] = [];
    for (const e of expectations.entries) {
      const report = await reportFor(e);
      if (!report) {
        skipped.push(e.id);
        continue;
      }
      scores.push(score(e, report));
    }
    const withObs = scores.filter((s) => s.observation_accuracy !== null);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const summary = {
      at: new Date().toISOString(),
      live: LIVE,
      prompt_version: PROMPT_VERSION,
      schema_version: VISION_SCHEMA_VERSION,
      entries: scores.length,
      skipped,
      observation_accuracy: mean(withObs.map((s) => s.observation_accuracy!)),
      node_recall: mean(scores.map((s) => s.node_recall)),
      node_precision_absent: mean(scores.map((s) => s.node_precision_absent)),
      by_key: Object.fromEntries(
        OBSERVATION_KEYS.map((key) => [
          key,
          mean(withObs.map((s) => (s.observations[key]!.hit ? 1 : 0))),
        ]),
      ),
    };
    mkdirSync(`${ROOT}reports`, { recursive: true });
    writeFileSync(
      `${ROOT}reports/vocabulary-latest.json`,
      JSON.stringify({ summary, scores }, null, 2),
    );
    appendFileSync(`${ROOT}reports/vocabulary-history.jsonl`, JSON.stringify(summary) + '\n');
    console.log(
      `словари: точность ${fmt(summary.observation_accuracy)}, узлы: полнота ${fmt(summary.node_recall)}, ` +
        `лишних нет ${fmt(summary.node_precision_absent)}; прогнано ${scores.length}, пропущено ${skipped.length}`,
    );
    if (!LIVE) return;
    // Живой прогон — планка. Ниже неё промпт или правила сломались.
    expect(scores.length).toBe(expectations.entries.length);
    expect(summary.observation_accuracy ?? 0).toBeGreaterThanOrEqual(0.7);
    expect(summary.node_recall ?? 0).toBeGreaterThanOrEqual(0.8);
    expect(summary.node_precision_absent ?? 0).toBeGreaterThanOrEqual(0.8);
  }, 900_000);
});

const fmt = (x: number | null): string => (x === null ? '—' : `${Math.round(x * 100)}%`);
