import { useEffect, useState } from 'react';
import type { StyleSpec } from '@seamsterly/stylespec';
import { api, type SpecPayload } from './api';
import { LiveFlat } from './flat';

/**
 * Рабочий документ: рейл разделов + содержимое. Хендофф, экран 6.
 *
 * Правка — ТОЛЬКО замеров: это демо киллер-фичи, а не редактор всего.
 * Остальные разделы рид-онли и заполнены данными движка — того же
 * пайплайна, который построил документ. Ничего выдуманного на лету:
 * рид-онли страница обязана совпадать с PDF до цифры.
 */

const SECTIONS = [
  { id: 'overview', n: '01', label: 'Обзор' },
  { id: 'flat', n: '02', label: 'Чертёж' },
  { id: 'measurements', n: '03', label: 'Замеры' },
  { id: 'bom', n: '04', label: 'Материалы' },
  { id: 'construction', n: '05', label: 'Конструкция' },
  { id: 'labels', n: '06', label: 'Ярлыки' },
  { id: 'export', n: '07', label: 'Экспорт' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

const STATUS_RU: Record<string, string> = {
  fit_confirmed: 'подтверждено по образцу',
  user_input: 'указано вами',
  measured_by_scale: 'снято по масштабу',
  estimated_from_photo: 'оценка по фото',
  default_from_base: 'типовое значение',
  assumption: 'предположение',
};

export function Workspace({ jobId, onNew }: { jobId: string; onNew: () => void }) {
  const [payload, setPayload] = useState<SpecPayload | null>(null);
  const [section, setSection] = useState<SectionId>('overview');
  const [toast, setToast] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    void api.spec(jobId).then(setPayload);
  }, [jobId]);

  useEffect(() => {
    void api.event('section', { section });
  }, [section]);

  if (!payload) {
    return (
      <div
        style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'var(--secondary)' }}
      >
        Открываем документ…
      </div>
    );
  }

  const spec = payload.spec;
  const showToast = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 2200);
  };

  const onEdited = (next: SpecPayload, changedCodes: string[]) => {
    setPayload(next);
    setPulse(Date.now());
    showToast(
      changedCodes.length > 1
        ? `Чертёж обновлён · пересчитано: ${changedCodes.join(', ')}`
        : 'Чертёж обновлён',
    );
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '236px 1fr', height: '100%' }}>
      {/* Рейл */}
      <aside
        style={{
          background: 'rgba(255,255,255,.48)',
          borderRight: '1px solid rgba(14,14,14,.08)',
          padding: '22px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          backdropFilter: 'blur(6px)',
        }}
      >
        <div style={{ padding: '0 10px 16px' }}>
          <div className="kicker">Текущий техпак</div>
          <div style={{ fontWeight: 700, fontSize: 15.5, marginTop: 4 }}>{spec.style.name}</div>
          <div className="mono" style={{ color: 'var(--tertiary)', fontSize: 10.5, marginTop: 3 }}>
            {spec.style.article} · v{spec.spec_version}
          </div>
          {spec.meta.assumptions_count > 0 ? (
            <div
              style={{
                marginTop: 10,
                display: 'inline-block',
                border: '1px solid var(--data-red)',
                color: 'var(--data-red)',
                borderRadius: 8,
                padding: '4px 9px',
                fontSize: 11.5,
              }}
            >
              Предположения: {spec.meta.assumptions_count}
            </div>
          ) : (
            <div style={{ marginTop: 10, color: 'var(--confirm-green)', fontSize: 11.5 }}>
              ✓ всё подтверждено
            </div>
          )}
        </div>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'baseline',
              textAlign: 'left',
              border: 0,
              background: section === s.id ? 'rgba(14,14,14,.06)' : 'transparent',
              borderRadius: 9,
              padding: '9px 10px',
              fontWeight: section === s.id ? 700 : 400,
              fontSize: 13.5,
              borderLeft: section === s.id ? '2.5px solid var(--ink)' : '2.5px solid transparent',
            }}
          >
            <span className="mono" style={{ fontSize: 10, color: 'var(--tertiary)' }}>
              {s.n}
            </span>
            {s.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          className="btn white"
          style={{ padding: '10px 14px', fontSize: 13 }}
          onClick={onNew}
        >
          + Новый техпак
        </button>
      </aside>

      {/* Содержимое */}
      <main style={{ overflow: 'auto', padding: '30px 38px 80px' }}>
        {section === 'overview' && <Overview spec={spec} go={setSection} />}
        {section === 'flat' && (
          <Section title="Технический чертёж">
            <LiveFlat spec={spec} defaults={payload.flat_defaults} pulse={pulse} />
          </Section>
        )}
        {section === 'measurements' && (
          <Measurements jobId={jobId} payload={payload} onEdited={onEdited} onError={showToast} />
        )}
        {section === 'bom' && <Bom spec={spec} />}
        {section === 'construction' && <Construction spec={spec} />}
        {section === 'labels' && <Labels spec={spec} />}
        {section === 'export' && <ExportSection jobId={jobId} />}
      </main>

      {toast && (
        <div className="toast">
          <span className="dot" /> {toast}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="sfup" style={{ maxWidth: 1030 }}>
      <div
        className="kicker"
        style={{
          background: 'rgba(14,14,14,.04)',
          borderRadius: 8,
          padding: '8px 14px',
          marginBottom: 18,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- обзор

function Overview({ spec, go }: { spec: StyleSpec; go: (s: SectionId) => void }) {
  const shell = spec.bom?.lines.find((l) => l.role === 'shell');
  const counts = new Map<string, number>();
  for (const p of spec.measurements.points) {
    counts.set(p.base.confidence, (counts.get(p.base.confidence) ?? 0) + 1);
  }
  return (
    <Section title="Обзор · паспорт изделия">
      <div className="card" style={{ padding: '26px 30px', marginBottom: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18 }}>
          <Field k="Модель" v={spec.style.name} />
          <Field k="Артикул" v={spec.style.article} mono />
          <Field
            k="Базовый размер"
            v={`RU ${spec.base.base_size_ru} · рост ${spec.base.base_height_cm}`}
          />
          <Field k="Размерный ряд" v={spec.base.size_range.join(' · ')} />
          <Field k="Полотно" v={shell ? shell.name_ru : '—'} />
          <Field k="Состав" v={shell?.composition.value ?? '—'} />
          <Field k="Замеров" v={String(spec.measurements.points.length)} />
          <Field k="Узлов обработки" v={String(spec.construction?.nodes.length ?? 0)} />
        </div>
      </div>

      <div className="panel" style={{ padding: '18px 20px', marginBottom: 18 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Откуда взяты значения</div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          {[...counts.entries()].map(([c, n]) => (
            <span
              key={c}
              style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13 }}
            >
              <span className={`dot ${c}`} /> {STATUS_RU[c] ?? c}: <b>{n}</b>
            </span>
          ))}
        </div>
        {spec.meta.assumptions_count > 0 && (
          <div
            style={{
              marginTop: 14,
              border: '1px solid var(--data-red)',
              borderRadius: 9,
              padding: '11px 14px',
              fontSize: 13,
              color: 'var(--data-red)',
            }}
          >
            {spec.meta.assumptions_count} значений — предположения: типовая подстановка там, где
            увидеть правду было нельзя.{' '}
            <a
              style={{ cursor: 'pointer', textDecoration: 'underline' }}
              onClick={() => go('measurements')}
            >
              Посмотреть в замерах →
            </a>
          </div>
        )}
      </div>

      <div style={{ color: 'var(--secondary)', fontSize: 13, lineHeight: 1.6, maxWidth: 640 }}>
        Документ построен из данных: чертёж, таблицы и PDF — проекции одной спеки. Исправьте замер в
        разделе «Замеры» — чертёж перестроится, и следующий PDF выйдет уже с новой геометрией.
      </div>
    </Section>
  );
}

function Field({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <div className="kicker" style={{ fontSize: 8.5 }}>
        {k}
      </div>
      <div
        className={mono ? 'mono' : 'data-value'}
        style={{ fontSize: mono ? 12 : 13.5, marginTop: 4 }}
      >
        {v}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- замеры

function Measurements({
  jobId,
  payload,
  onEdited,
  onError,
}: {
  jobId: string;
  payload: SpecPayload;
  onEdited: (next: SpecPayload, changed: string[]) => void;
  onError: (text: string) => void;
}) {
  const spec = payload.spec;
  const graded = spec.base.size_range.filter((ru) => ru !== spec.base.base_size_ru);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const commit = async (code: string) => {
    const raw = drafts[code];
    if (raw === undefined) return;
    const value = Number(raw.replace(',', '.'));
    const current = spec.measurements.points.find((p) => p.code === code)!.base.value;
    if (!Number.isFinite(value) || value === current) {
      setDrafts((d) => ({ ...d, [code]: undefined as never }));
      return;
    }
    setBusy(code);
    try {
      const next = await api.edit(jobId, code, value);
      onEdited(
        next,
        next.changed.map((c) => c.code),
      );
      setDrafts({});
    } catch (e) {
      onError(e instanceof Error ? e.message : 'правка не прошла');
      setDrafts((d) => ({ ...d, [code]: undefined as never }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title="Замеры · табель мер">
      <div className="card" style={{ padding: '6px 0', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              {[
                'Код',
                'Точка',
                `База RU ${spec.base.base_size_ru}`,
                'Допуск',
                ...graded.map(String),
                'Статус',
              ].map((h, i) => (
                <th
                  key={i}
                  className="kicker"
                  style={{
                    textAlign: i >= 2 && i < 4 + graded.length ? 'right' : 'left',
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--hairline)',
                    fontSize: 8.5,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.measurements.points.map((p) => {
              const byRu = new Map(p.graded.map((g) => [g.ru, g.value.value]));
              const draft = drafts[p.code];
              const edited = p.base.confidence === 'user_input';
              return (
                <tr key={p.code} style={{ borderBottom: '1px solid var(--hairline-row)' }}>
                  <td
                    className="mono"
                    style={{ padding: '9px 14px', fontSize: 10.5, color: 'var(--tertiary)' }}
                  >
                    {p.code}
                  </td>
                  <td style={{ padding: '9px 14px' }}>
                    {p.name_ru}
                    <div style={{ color: 'var(--lib-grey)', fontSize: 10.5, marginTop: 2 }}>
                      {p.how_to_measure_ru}
                    </div>
                  </td>
                  <td style={{ padding: '6px 14px', textAlign: 'right' }}>
                    <input
                      className={edited ? 'edited' : ''}
                      style={{ width: 74, textAlign: 'right', padding: '6px 9px', fontSize: 12.5 }}
                      value={draft ?? String(p.base.value)}
                      disabled={busy !== null}
                      onChange={(e) => setDrafts((d) => ({ ...d, [p.code]: e.target.value }))}
                      onBlur={() => void commit(p.code)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape')
                          setDrafts((d) => ({ ...d, [p.code]: undefined as never }));
                      }}
                    />
                  </td>
                  <td
                    className="mono"
                    style={{ padding: '9px 14px', textAlign: 'right', fontSize: 11 }}
                  >
                    ±{p.tolerance.value}
                  </td>
                  {graded.map((ru) => (
                    <td
                      key={ru}
                      className="mono data-value"
                      style={{ padding: '9px 14px', textAlign: 'right', fontSize: 11.5 }}
                    >
                      {byRu.has(ru) ? byRu.get(ru) : '—'}
                    </td>
                  ))}
                  <td style={{ padding: '9px 14px', whiteSpace: 'nowrap' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        gap: 7,
                        alignItems: 'center',
                        fontSize: 11.5,
                      }}
                    >
                      <span className={`dot ${p.base.confidence}`} />
                      {STATUS_RU[p.base.confidence]}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ color: 'var(--secondary)', fontSize: 12.5, marginTop: 12, lineHeight: 1.6 }}>
        Правка значения перестраивает чертёж и пересчитывает связанные точки: длина по центру спинки
        следует за длиной от плеча тождественно. Составные точки правятся через свои части —
        документ не может противоречить сам себе.
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- рид-онли разделы

function Bom({ spec }: { spec: StyleSpec }) {
  const bom = spec.bom;
  if (!bom) return <Section title="Материалы">Нет данных</Section>;
  return (
    <Section title="Спецификация материалов · BOM">
      <ReadonlyTable
        head={['Код', 'Позиция', 'Назначение', 'Состав', 'г/м²', 'Расход']}
        rows={bom.lines.map((l) => [
          l.code,
          l.name_ru,
          l.placement_ru,
          l.composition.value,
          l.gsm ? String(l.gsm.value) : '—',
          l.consumption ? `${l.consumption.value} ${l.consumption_unit}` : '—',
        ])}
      />
      <div style={{ color: 'var(--secondary)', fontSize: 12.5, marginTop: 12 }}>
        Расход основного полотна: <b className="data-value">{bom.fabric_consumption_m.value} м</b>{' '}
        на изделие — предварительно, точно считает фабрика по раскладке.
      </div>
    </Section>
  );
}

function Construction({ spec }: { spec: StyleSpec }) {
  const nodes = spec.construction?.nodes ?? [];
  return (
    <Section title="Конструкция · узлы обработки">
      <div style={{ display: 'grid', gap: 10 }}>
        {nodes.map((n, i) => (
          <div
            key={n.node_id}
            className="panel"
            style={{ padding: '14px 18px', display: 'flex', gap: 16 }}
          >
            <span
              className="mono"
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                background: 'var(--ink)',
                color: '#fff',
                display: 'grid',
                placeItems: 'center',
                fontSize: 12,
                flex: 'none',
              }}
            >
              {i + 1}
            </span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{n.label_ru}</div>
              <div style={{ color: 'var(--secondary)', fontSize: 12.5, margin: '4px 0 8px' }}>
                {n.plain_ru}
              </div>
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--tertiary)' }}>
                шов {n.seam_code} · стежок {n.stitch_code} · SPI {n.spi} · {n.machine}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Labels({ spec }: { spec: StyleSpec }) {
  const l = spec.labels;
  if (!l) return <Section title="Ярлыки">Нет данных</Section>;
  return (
    <Section title="Маркировка и артикулы">
      <ReadonlyTable
        head={['Реквизит', 'Значение']}
        rows={l.requisites.map((r) => [
          r.label_ru,
          r.value ? r.value.value : `— ${r.action_ru ?? 'не заполнено'}`,
        ])}
      />
      <div style={{ height: 18 }} />
      <ReadonlyTable
        head={['SKU', 'Цвет', 'Размер', 'GTIN']}
        rows={l.sku_matrix
          .slice(0, 8)
          .map((s) => [s.sku, s.colorway_ru, `RU ${s.size_ru}`, s.gtin ?? 'плейсхолдер'])}
      />
      {l.sku_matrix.length > 8 && (
        <div style={{ color: 'var(--secondary)', fontSize: 12.5, marginTop: 10 }}>
          … и ещё {l.sku_matrix.length - 8} позиций — целиком в PDF.
        </div>
      )}
    </Section>
  );
}

function ReadonlyTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="card" style={{ overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                className="kicker"
                style={{
                  textAlign: 'left',
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--hairline)',
                  fontSize: 8.5,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--hairline-row)' }}>
              {r.map((c, j) => (
                <td
                  key={j}
                  className={j === 0 ? 'mono' : undefined}
                  style={{
                    padding: '9px 14px',
                    fontSize: j === 0 ? 10.5 : 12.5,
                    color: j === 0 ? 'var(--tertiary)' : undefined,
                  }}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- экспорт

function ExportSection({ jobId }: { jobId: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Section title="Экспорт">
      <div className="card" style={{ padding: '26px 30px', maxWidth: 480 }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>PDF · полный комплект</div>
        <div style={{ color: 'var(--secondary)', fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
          Все листы: обложка, чертёж, табель мер с допусками и градацией, спецификация, конструкция,
          маркировка. Если вы правили замеры — PDF пересоберётся из новых данных.
        </div>
        <a
          className="btn"
          style={{ display: 'inline-block', textDecoration: 'none', opacity: busy ? 0.5 : 1 }}
          href={api.pdfUrl(jobId)}
          download
          onClick={() => {
            setBusy(true);
            void api.event('pdf_click', { jobId });
            setTimeout(() => setBusy(false), 4000);
          }}
        >
          {busy ? 'Собираем PDF…' : 'Скачать PDF'}
        </a>
      </div>
    </Section>
  );
}
