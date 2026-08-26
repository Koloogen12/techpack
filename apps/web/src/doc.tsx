import { useRef, useState } from 'react';
import { api } from './api.js';
import { useStore, type Section } from './store.js';
import { Dot, Kicker, Menu, StatusChip, Term, STATUS_RU } from './ui.js';
import { LiveFlat } from './flat.js';

/**
 * Документ техпака — хендофф, экран 6: планка вкладок, шапка, рейл-флайаут,
 * 8 разделов. Правки живут в данных: замер → сервер → пересчёт → чертёж.
 */

const SECTIONS: { id: Section; n: string; label: string; sub: string }[] = [
  { id: 'cover', n: '01', label: 'Обзор', sub: 'стиль и визуал' },
  { id: 'flat', n: '02', label: 'Чертёж', sub: 'виды и слои' },
  { id: 'pom', n: '03', label: 'Замеры', sub: 'таблица и градация' },
  { id: 'bom', n: '04', label: 'Материалы', sub: 'BOM и расход' },
  { id: 'constr', n: '05', label: 'Конструкция', sub: 'узлы и операции' },
  { id: 'labels', n: '06', label: 'Ярлыки', sub: 'маркировка и SKU' },
  { id: 'versions', n: '07', label: 'Версии', sub: 'примерки и дифф' },
  { id: 'export', n: '08', label: 'Экспорт', sub: 'PDF и фабрика' },
];

export function Doc() {
  const s = useStore();
  const [railPin, setRailPin] = useState(false);
  const [railHov, setRailHov] = useState(false);
  const [docMenu, setDocMenu] = useState(false);
  const [onlyGuess, setOnlyGuess] = useState(false);
  const spec = s.spec;

  if (!s.currentJob) return null;

  if (s.docLoading || !spec) {
    return (
      <div style={{ padding: '60px 80px' }}>
        {[420, 720, 680, 700].map((w, i) => (
          <div
            key={i}
            style={{
              height: i === 0 ? 34 : 16,
              width: w,
              borderRadius: 8,
              marginBottom: 18,
              background:
                'linear-gradient(90deg, rgba(14,14,14,.05) 25%, rgba(14,14,14,.1) 50%, rgba(14,14,14,.05) 75%)',
              backgroundSize: '400px 100%',
              animation: 'sfshimmer 1.4s linear infinite',
            }}
          />
        ))}
      </div>
    );
  }

  const railOpen = railPin || railHov;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {/* Чёрная планка вкладок */}
      <div
        style={{
          background: 'var(--ink)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 14px',
          gap: 4,
          height: 38,
          flex: 'none',
        }}
      >
        {s.openTabs.map((id) => {
          const j = s.jobs.find((x) => x.id === id);
          const active = id === s.currentJob;
          return (
            <div
              key={id}
              onClick={() => s.openDoc(id, s.section)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                borderRadius: '8px 8px 0 0',
                cursor: 'pointer',
                fontSize: 12,
                background: active ? 'var(--bg)' : 'rgba(255,255,255,.08)',
                color: active ? 'var(--ink)' : 'rgba(255,255,255,.75)',
                maxWidth: 200,
              }}
            >
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {j?.name ?? id}
              </span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  s.closeTab(id);
                }}
                style={{ opacity: 0.6 }}
              >
                ✕
              </span>
            </div>
          );
        })}
        <div
          onClick={() => s.startWizard()}
          style={{ marginLeft: 6, color: 'rgba(255,255,255,.65)', fontSize: 12, cursor: 'pointer' }}
        >
          + Новый пак
        </div>
      </div>

      {/* Шапка документа */}
      <div
        style={{
          padding: '16px 26px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap',
          position: 'relative',
        }}
      >
        <div style={{ flex: 1, minWidth: 240 }}>
          <Kicker style={{ fontSize: 8.5 }}>Текущий техпак</Kicker>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 3 }}>
            <h1 style={{ fontSize: 16.6, fontWeight: 700, margin: 0 }}>{spec.style.name}</h1>
            <StatusChip stage="done" />
          </div>
          <div className="mono" style={{ fontSize: 9.7, color: 'var(--tertiary)', marginTop: 3 }}>
            {spec.style.article} · схема {spec.spec_version} ·{' '}
            <span style={{ color: 'var(--confirm-green)' }}>сохранено</span>
          </div>
        </div>

        {spec.meta.assumptions_count > 0 ? (
          <button
            onClick={() => {
              setOnlyGuess(!onlyGuess);
              s.setSection('pom');
            }}
            style={{
              border: '1px solid var(--data-red)',
              color: 'var(--data-red)',
              background: onlyGuess ? 'rgba(192,57,43,.08)' : 'none',
              borderRadius: 9,
              padding: '7px 13px',
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            Предположения: {spec.meta.assumptions_count}
          </button>
        ) : (
          <span style={{ color: 'var(--confirm-green)', fontSize: 12.5, fontWeight: 600 }}>
            ✓ всё подтверждено
          </span>
        )}

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12.5,
            cursor: 'pointer',
          }}
        >
          <span
            onClick={() => s.setPro(!s.pro)}
            style={{
              width: 34,
              height: 19,
              borderRadius: 999,
              background: s.pro ? 'var(--ink)' : 'rgba(14,14,14,.14)',
              position: 'relative',
              transition: 'background 160ms',
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: 2,
                left: s.pro ? 17 : 2,
                width: 15,
                height: 15,
                borderRadius: 999,
                background: '#fff',
                transition: 'left 160ms',
              }}
            />
          </span>
          Pro-режим
        </label>

        <button
          className="btn"
          style={{ padding: '10px 20px', fontSize: 13 }}
          onClick={() => s.setSection('export')}
        >
          Экспорт
        </button>
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setDocMenu(!docMenu)}
            style={{
              border: '1px solid var(--hairline)',
              background: '#fff',
              borderRadius: 9,
              width: 34,
              height: 34,
              fontSize: 15,
            }}
          >
            ⋮
          </button>
          {docMenu && (
            <Menu
              onClose={() => setDocMenu(false)}
              items={[
                {
                  label: 'Ссылка для фабрики',
                  onClick: () => {
                    const url = new URL(api.previewUrl(s.currentJob!), location.origin).toString();
                    void navigator.clipboard?.writeText(url);
                    s.showToast('Ссылка скопирована — документ только для чтения');
                    void api.event('factory_link', { jobId: s.currentJob });
                  },
                },
                {
                  label: 'Дублировать пак',
                  onClick: () => void api.duplicate(s.currentJob!).then(() => void s.refreshJobs()),
                },
                { label: 'Взять за основу', onClick: () => s.startWizard(s.currentJob!) },
              ]}
            />
          )}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Рейл */}
        <div
          onMouseEnter={() => setRailHov(true)}
          onMouseLeave={() => setRailHov(false)}
          style={{
            width: railOpen ? 212 : 52,
            flex: 'none',
            transition: 'width 180ms ease',
            padding: '8px 8px 8px 12px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              boxShadow: 'var(--shadow-doc)',
              padding: railOpen ? '12px 8px' : '12px 6px',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {SECTIONS.map((sec) => {
              const active = s.section === sec.id;
              return (
                <div
                  key={sec.id}
                  onClick={() => s.setSection(sec.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: railOpen ? '8px 10px' : '8px 6px',
                    borderRadius: 9,
                    cursor: 'pointer',
                    borderLeft: active ? '2.5px solid var(--ink)' : '2.5px solid transparent',
                    fontWeight: active ? 700 : 400,
                    fontSize: 12.5,
                    background: active ? 'rgba(14,14,14,.05)' : 'transparent',
                  }}
                  onMouseEnter={(e) =>
                    !active && (e.currentTarget.style.background = 'rgba(14,14,14,.03)')
                  }
                  onMouseLeave={(e) =>
                    !active && (e.currentTarget.style.background = 'transparent')
                  }
                >
                  <span
                    style={{
                      width: active ? 18 : 12,
                      height: 2.5,
                      borderRadius: 2,
                      flex: 'none',
                      background: active ? 'var(--ink)' : 'var(--lib-grey)',
                      transition: 'width 160ms',
                    }}
                  />
                  {railOpen && (
                    <span style={{ whiteSpace: 'nowrap' }}>
                      <span
                        className="mono"
                        style={{ fontSize: 9, color: 'var(--tertiary)', marginRight: 6 }}
                      >
                        {sec.n}
                      </span>
                      {sec.label}
                      <span style={{ color: 'var(--lib-grey)', fontSize: 10.5, marginLeft: 6 }}>
                        {sec.sub}
                      </span>
                    </span>
                  )}
                </div>
              );
            })}
            {railOpen && (
              <div
                onClick={() => setRailPin(!railPin)}
                style={{
                  marginTop: 6,
                  padding: '6px 10px',
                  fontSize: 11,
                  color: 'var(--secondary)',
                  cursor: 'pointer',
                }}
              >
                {railPin ? '✕ Открепить' : '📌 Закрепить'}
              </div>
            )}
          </div>
        </div>

        {/* Содержимое раздела */}
        <main style={{ flex: 1, overflow: 'auto', padding: '10px 30px 90px', minWidth: 0 }}>
          <div style={{ maxWidth: 1030 }}>
            {s.section === 'cover' && <Cover onlyGuess={onlyGuess} />}
            {s.section === 'flat' && <FlatSection />}
            {s.section === 'pom' && <Pom onlyGuess={onlyGuess} setOnlyGuess={setOnlyGuess} />}
            {s.section === 'bom' && <Bom />}
            {s.section === 'constr' && <Constr />}
            {s.section === 'labels' && <Labels />}
            {s.section === 'versions' && <Versions />}
            {s.section === 'export' && <ExportSection />}
          </div>
        </main>
      </div>
    </div>
  );
}

function Head({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="kicker"
      style={{
        background: 'rgba(14,14,14,.04)',
        borderRadius: 8,
        padding: '8px 14px',
        margin: '8px 0 16px',
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- 01 Обзор

function Cover({ onlyGuess }: { onlyGuess: boolean }) {
  const s = useStore();
  const spec = s.spec!;
  const [galTab, setGalTab] = useState<'flat' | 'photo'>('flat');
  const shell = spec.bom?.lines.find((l) => l.role === 'shell');
  void onlyGuess;

  const counts = new Map<string, number>();
  for (const p of spec.measurements.points)
    counts.set(p.base.confidence, (counts.get(p.base.confidence) ?? 0) + 1);

  const readiness: { label: string; ok: boolean; warn?: boolean; go: Section }[] = [
    { label: 'Замеры с допусками', ok: true, go: 'pom' },
    { label: 'Градация по ряду', ok: true, go: 'pom' },
    { label: 'Чертёж построен', ok: true, go: 'flat' },
    { label: 'Материалы и расход', ok: Boolean(spec.bom), go: 'bom' },
    {
      label: 'Предположения подтверждены',
      ok: spec.meta.assumptions_count === 0,
      warn: spec.meta.assumptions_count > 0,
      go: 'pom',
    },
    {
      label: 'Реквизиты маркировки',
      ok: !(spec.labels?.requisites ?? []).some((r) => r.required && r.value === null),
      warn: (spec.labels?.requisites ?? []).some((r) => r.required && r.value === null),
      go: 'labels',
    },
  ];
  const pct = Math.round((readiness.filter((r) => r.ok).length / readiness.length) * 100);

  return (
    <div className="sfup">
      <Head>Обзор · паспорт изделия</Head>

      <div className="card" style={{ padding: '22px 26px', marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px 20px' }}>
          <Field k="Бренд" v={spec.style.brand ?? '— профиль бренда'} />
          <Field k="Артикул" v={spec.style.article} mono />
          <Field k="Ткань" v={shell?.name_ru ?? '—'} />
          <Field k="Сезон" v={spec.style.season ?? '—'} />
          <Field k="Размер" v={`RU ${spec.base.base_size_ru} · рост ${spec.base.base_height_cm}`} />
          <Field k="Ряд" v={spec.base.size_range.join(' · ')} />
          <Field k="Состав" v={shell?.composition.value ?? '—'} />
          <Field k="Тираж" v={spec.bom?.batch_qty ? `${spec.bom.batch_qty} шт` : '—'} />
        </div>
        {spec.style.description && (
          <div style={{ marginTop: 16, fontSize: 13, color: 'var(--secondary)', lineHeight: 1.6 }}>
            {spec.style.description}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
        {/* Галерея */}
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button
              className={`chip ${galTab === 'flat' ? 'on' : ''}`}
              onClick={() => setGalTab('flat')}
            >
              Чертёж
            </button>
            <button
              className={`chip ${galTab === 'photo' ? 'on' : ''}`}
              onClick={() => setGalTab('photo')}
            >
              Фото
            </button>
          </div>
          {galTab === 'flat' ? (
            <div style={{ height: 380 }}>
              <LiveFlat spec={spec} defaults={s.payload!.flat_defaults} pulse={0} compact />
            </div>
          ) : (
            <div
              style={{
                height: 380,
                display: 'grid',
                placeItems: 'center',
                color: 'var(--secondary)',
                fontSize: 13,
              }}
            >
              Снимки заказчика хранятся в задании генерации и уходят в PDF.
            </div>
          )}
        </div>

        {/* Готовность к производству */}
        <div>
          <div className="card" style={{ padding: '18px 20px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
              <b style={{ fontSize: 15.5 }}>Готовность к производству</b>
              <span
                className="mono"
                style={{ fontSize: 13, color: pct === 100 ? 'var(--confirm-green)' : 'var(--ink)' }}
              >
                {pct}%
              </span>
            </div>
            {readiness.map((r) => (
              <div
                key={r.label}
                onClick={() => s.setSection(r.go)}
                style={{
                  display: 'flex',
                  gap: 9,
                  alignItems: 'center',
                  padding: '6px 0',
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    color: r.ok
                      ? 'var(--confirm-green)'
                      : r.warn
                        ? 'var(--data-red)'
                        : 'var(--lib-grey)',
                  }}
                >
                  {r.ok ? '✓' : r.warn ? '⚠' : '—'}
                </span>
                <span style={{ borderBottom: '1px dashed transparent' }}>{r.label}</span>
              </div>
            ))}
          </div>

          <div className="panel" style={{ padding: '14px 18px' }}>
            <b style={{ fontSize: 13 }}>Откуда взяты значения</b>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 10 }}>
              {[...counts.entries()].map(([c, n]) => (
                <span
                  key={c}
                  style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}
                >
                  <Dot status={c} /> {STATUS_RU[c]}: <b>{n}</b>
                </span>
              ))}
            </div>
          </div>

          {spec.meta.assumptions_count > 0 ? (
            <div
              onClick={() => s.setSection('pom')}
              style={{
                marginTop: 14,
                border: '1px solid var(--data-red)',
                borderRadius: 10,
                padding: '12px 15px',
                fontSize: 12.5,
                color: 'var(--data-red)',
                cursor: 'pointer',
                lineHeight: 1.5,
              }}
            >
              <b>{spec.meta.assumptions_count} предположений.</b> Типовая подстановка там, где
              увидеть правду было нельзя. Подтвердите по образцу до запуска партии →
            </div>
          ) : (
            <div
              style={{
                marginTop: 14,
                border: '1px solid var(--confirm-green)',
                borderRadius: 10,
                padding: '12px 15px',
                fontSize: 12.5,
                color: 'var(--confirm-green)',
              }}
            >
              ✓ Все значения подтверждены.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <Kicker style={{ fontSize: 8.3 }}>{k}</Kicker>
      <div
        className={mono ? 'mono' : 'data-value'}
        style={{ fontSize: mono ? 11.5 : 12.5, marginTop: 4, fontWeight: mono ? 500 : 300 }}
      >
        {v}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 02 Чертёж

function FlatSection() {
  const s = useStore();
  return (
    <div className="sfup">
      <Head>Технический чертёж · виды и слои</Head>
      <LiveFlat
        spec={s.spec!}
        defaults={s.payload!.flat_defaults}
        pulse={s.pulse}
        onCallout={() => s.setSection('constr')}
      />
    </div>
  );
}

// ---------------------------------------------------------------- 03 Замеры

const CM_IN = 2.54;

function Pom({
  onlyGuess,
  setOnlyGuess,
}: {
  onlyGuess: boolean;
  setOnlyGuess: (v: boolean) => void;
}) {
  const s = useStore();
  const spec = s.spec!;
  const jobId = s.currentJob!;
  const graded = spec.base.size_range.filter((ru) => ru !== spec.base.base_size_ru);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, string[]>>({});
  const inputs = useRef<Map<number, HTMLInputElement>>(new Map());

  const fmt = (cm: number): string => (s.units === 'см' ? String(cm) : (cm / CM_IN).toFixed(1));
  const unitLabel = s.units === 'см' ? 'см' : 'in';

  const points = spec.measurements.points.filter(
    (p) => (s.pro || !p.pro_only) && (!onlyGuess || p.base.confidence === 'assumption'),
  );

  const commit = async (code: string) => {
    const raw = drafts[code];
    if (raw === undefined) return;
    let value = Number(raw.replace(',', '.'));
    if (s.units === 'in') value = Math.round(value * CM_IN * 10) / 10;
    const current = spec.measurements.points.find((p) => p.code === code)!.base.value;
    if (!Number.isFinite(value) || value === current) {
      setDrafts((d) => {
        const next = { ...d };
        delete next[code];
        return next;
      });
      return;
    }
    setBusy(code);
    try {
      const next = await api.edit(jobId, code, value);
      s.setPayload(next);
      s.setPulse(Date.now());
      setHistory((h) => ({
        ...h,
        [code]: [...(h[code] ?? []), `вы · ${current} → ${value} см`],
        ...Object.fromEntries(
          next.changed
            .filter((c) => c.code !== code)
            .map((c) => [
              c.code,
              [...(history[c.code] ?? []), `пересчёт · ${c.from_cm} → ${c.to_cm} см`],
            ]),
        ),
      }));
      s.showToast(
        next.changed.length > 1
          ? `Чертёж обновлён · пересчитано: ${next.changed.map((c) => c.code).join(', ')}`
          : 'Чертёж обновлён',
      );
      setDrafts({});
    } catch (e) {
      s.showToast(e instanceof Error ? e.message : 'правка не прошла');
      setDrafts((d) => {
        const next = { ...d };
        delete next[code];
        return next;
      });
    } finally {
      setBusy(null);
    }
  };

  const selPoint = sel ? spec.measurements.points.find((p) => p.code === sel) : null;

  return (
    <div className="sfup">
      <Head>Замеры · табель мер, база RU {spec.base.base_size_ru}</Head>

      <div
        style={{
          display: 'flex',
          gap: 10,
          marginBottom: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <button
          className={`chip ${onlyGuess ? 'on' : ''}`}
          onClick={() => setOnlyGuess(!onlyGuess)}
        >
          Только предположения
        </button>
        <span style={{ flex: 1 }} />
        <div
          style={{
            display: 'flex',
            border: '1px solid var(--hairline)',
            borderRadius: 9,
            overflow: 'hidden',
          }}
        >
          {(['см', 'in'] as const).map((u) => (
            <button
              key={u}
              onClick={() => s.setUnits(u)}
              style={{
                border: 0,
                padding: '7px 14px',
                fontSize: 12.5,
                background: s.units === u ? 'var(--ink)' : '#fff',
                color: s.units === u ? '#fff' : 'var(--ink)',
              }}
            >
              {u}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 11.5, color: 'var(--secondary)' }}>
          ввод в in пишется в см · PDF всегда в см
        </span>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div className="card" style={{ overflow: 'auto', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {[
                  'Код',
                  'Точка измерения',
                  `База · ${unitLabel}`,
                  <Term
                    key="t"
                    text="Допуск"
                    tip="± отклонение, в котором изделие проходит приёмку ОТК. По каждой точке своё."
                  />,
                  ...graded.map(String),
                  ...(s.pro ? ['Δ град.'] : []),
                  'Статус',
                ].map((h, i) => (
                  <th
                    key={i}
                    className="kicker"
                    style={{
                      textAlign: i >= 2 ? 'right' : 'left',
                      padding: '10px 13px',
                      borderBottom: '1px solid var(--hairline)',
                      fontSize: 8.3,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((p, idx) => {
                const byRu = new Map(p.graded.map((g) => [g.ru, g.value.value]));
                const draft = drafts[p.code];
                const edited =
                  p.base.confidence === 'user_input' || p.base.confidence === 'fit_confirmed';
                const step =
                  p.graded.length > 1
                    ? Math.round((p.graded[1]!.value.value - p.graded[0]!.value.value) * 100) / 100
                    : null;
                return (
                  <tr
                    key={p.code}
                    onClick={() => setSel(sel === p.code ? null : p.code)}
                    style={{
                      borderBottom: '1px solid var(--hairline-row)',
                      cursor: 'pointer',
                      background: sel === p.code ? 'rgba(14,14,14,.03)' : 'transparent',
                    }}
                  >
                    <td
                      className="mono"
                      style={{ padding: '8px 13px', fontSize: 10, color: 'var(--tertiary)' }}
                    >
                      {p.code}
                    </td>
                    <td style={{ padding: '8px 13px' }}>
                      {p.name_ru}
                      <div
                        className="mono"
                        style={{ color: 'var(--lib-grey)', fontSize: 9.3, marginTop: 2 }}
                      >
                        {p.how_to_measure_ru.slice(0, 60)}
                        {p.how_to_measure_ru.length > 60 ? '…' : ''}
                      </div>
                    </td>
                    <td
                      style={{ padding: '5px 13px', textAlign: 'right' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        ref={(el) => el && inputs.current.set(idx, el)}
                        className={edited ? 'edited' : ''}
                        style={{ width: 72, textAlign: 'right', padding: '6px 9px', fontSize: 12 }}
                        value={draft ?? fmt(p.base.value)}
                        disabled={busy !== null}
                        onChange={(e) => setDrafts((d) => ({ ...d, [p.code]: e.target.value }))}
                        onBlur={() => void commit(p.code)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === 'ArrowDown') {
                            (e.target as HTMLInputElement).blur();
                            inputs.current.get(idx + 1)?.focus();
                          }
                          if (e.key === 'ArrowUp') {
                            (e.target as HTMLInputElement).blur();
                            inputs.current.get(idx - 1)?.focus();
                          }
                          if (e.key === 'Escape')
                            setDrafts((d) => {
                              const next = { ...d };
                              delete next[p.code];
                              return next;
                            });
                        }}
                      />
                    </td>
                    <td
                      className="mono"
                      style={{ padding: '8px 13px', textAlign: 'right', fontSize: 10.5 }}
                    >
                      ±{fmt(p.tolerance.value)}
                    </td>
                    {graded.map((ru) => (
                      <td
                        key={ru}
                        className="mono data-value"
                        style={{ padding: '8px 13px', textAlign: 'right', fontSize: 11 }}
                      >
                        {byRu.has(ru) ? fmt(byRu.get(ru)!) : '—'}
                      </td>
                    ))}
                    {s.pro && (
                      <td
                        className="mono"
                        style={{
                          padding: '8px 13px',
                          textAlign: 'right',
                          fontSize: 10.5,
                          color: 'var(--secondary)',
                        }}
                      >
                        {step !== null ? `+${fmt(step)}` : '—'}
                      </td>
                    )}
                    <td style={{ padding: '8px 13px', whiteSpace: 'nowrap' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          gap: 7,
                          alignItems: 'center',
                          fontSize: 11,
                        }}
                      >
                        <Dot status={p.base.confidence} />
                        {STATUS_RU[p.base.confidence]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Панель деталей строки */}
        {selPoint && (
          <div className="card sfup" style={{ width: 300, flex: 'none', padding: '20px 22px' }}>
            <Kicker style={{ fontSize: 8.5 }}>
              {selPoint.code} · {selPoint.name_ru}
            </Kicker>
            <div className="data-value" style={{ fontSize: 34, margin: '8px 0 2px' }}>
              {fmt(selPoint.base.value)} <span style={{ fontSize: 15 }}>{unitLabel}</span>
            </div>
            <div
              style={{
                display: 'flex',
                gap: 7,
                alignItems: 'center',
                fontSize: 11.5,
                marginBottom: 14,
              }}
            >
              <Dot status={selPoint.base.confidence} /> {STATUS_RU[selPoint.base.confidence]}
            </div>

            <b style={{ fontSize: 12.5 }}>Откуда это число</b>
            <div
              className="mono"
              style={{
                fontSize: 10,
                color: 'var(--tertiary)',
                margin: '5px 0 13px',
                lineHeight: 1.5,
                wordBreak: 'break-all',
              }}
            >
              {selPoint.base.source}
            </div>

            <b style={{ fontSize: 12.5 }}>Как мерить</b>
            <div
              style={{
                fontSize: 12,
                color: 'var(--secondary)',
                margin: '5px 0 13px',
                lineHeight: 1.55,
              }}
            >
              {selPoint.how_to_measure_ru}
            </div>

            <b style={{ fontSize: 12.5 }}>История</b>
            <div
              style={{
                fontSize: 11.5,
                color: 'var(--secondary)',
                margin: '5px 0 0',
                lineHeight: 1.6,
              }}
            >
              <div>
                ИИ · {STATUS_RU[selPoint.base.confidence]} → {selPoint.base.value} см
              </div>
              {(history[selPoint.code] ?? []).map((h, i) => (
                <div key={i}>{h}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 18,
          marginTop: 12,
          flexWrap: 'wrap',
          fontSize: 11.5,
          color: 'var(--secondary)',
        }}
      >
        {Object.entries(STATUS_RU)
          .filter(([k]) =>
            ['user_input', 'estimated_from_photo', 'default_from_base', 'assumption'].includes(k),
          )
          .map(([k, v]) => (
            <span key={k} style={{ display: 'inline-flex', gap: 7, alignItems: 'center' }}>
              <Dot status={k} /> {v}
            </span>
          ))}
        <span style={{ flex: 1 }} />
        <span>Составные точки правятся через свои части — документ не противоречит сам себе.</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 04 Материалы

function Bom() {
  const s = useStore();
  const spec = s.spec!;
  const bom = spec.bom;
  const [cw, setCw] = useState(0);
  if (!bom) return <Head>Материалы — нет данных</Head>;

  const groups = new Map<string, typeof bom.lines>();
  const groupLabel: Record<string, string> = {
    shell: 'Полотно',
    rib: 'Полотно',
    thread: 'Нитки и прокладки',
    interlining: 'Нитки и прокладки',
    label: 'Ярлыки',
    packaging: 'Упаковка',
  };
  for (const l of bom.lines) {
    const g = groupLabel[l.role] ?? 'Прочее';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(l);
  }
  const colorway = bom.colorways[cw];

  return (
    <div className="sfup">
      <Head>Спецификация материалов · BOM</Head>

      {bom.colorways.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {bom.colorways.map((c, i) => (
            <button key={c.id} className={`chip ${cw === i ? 'on' : ''}`} onClick={() => setCw(i)}>
              {c.hex_approx && (
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: c.hex_approx,
                    border: '1px solid rgba(0,0,0,.15)',
                  }}
                />
              )}
              {c.name_ru}
            </button>
          ))}
        </div>
      )}

      {[...groups.entries()].map(([g, lines]) => (
        <div key={g} style={{ marginBottom: 18 }}>
          <Kicker style={{ marginBottom: 8 }}>{g}</Kicker>
          <div className="card" style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {['Код', 'Позиция', 'Состав', 'Цвет', 'Расход', 'Статус'].map((h, i) => (
                    <th
                      key={i}
                      className="kicker"
                      style={{
                        textAlign: 'left',
                        padding: '9px 13px',
                        borderBottom: '1px solid var(--hairline)',
                        fontSize: 8.3,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.code} style={{ borderBottom: '1px solid var(--hairline-row)' }}>
                    <td
                      className="mono"
                      style={{ padding: '8px 13px', fontSize: 10, color: 'var(--tertiary)' }}
                    >
                      {l.code}
                    </td>
                    <td style={{ padding: '8px 13px' }}>
                      {l.name_ru}
                      <div style={{ fontSize: 10.5, color: 'var(--lib-grey)' }}>
                        {l.placement_ru}
                      </div>
                    </td>
                    <td className="data-value" style={{ padding: '8px 13px', fontSize: 11.5 }}>
                      {l.composition.value}
                    </td>
                    <td style={{ padding: '8px 13px' }}>
                      {(l.role === 'shell' || l.role === 'rib') && colorway?.hex_approx ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            gap: 7,
                            alignItems: 'center',
                            fontSize: 11.5,
                          }}
                        >
                          <span
                            style={{
                              width: 13,
                              height: 13,
                              borderRadius: 4,
                              background: colorway.hex_approx,
                              border: '1px solid rgba(0,0,0,.15)',
                            }}
                          />
                          {colorway.book_code ?? colorway.name_ru}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--lib-grey)', fontSize: 11 }}>—</span>
                      )}
                    </td>
                    <td className="mono data-value" style={{ padding: '8px 13px', fontSize: 11 }}>
                      {l.consumption ? `${l.consumption.value} ${l.consumption_unit}` : '—'}
                    </td>
                    <td style={{ padding: '8px 13px' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          gap: 6,
                          alignItems: 'center',
                          fontSize: 10.5,
                        }}
                      >
                        <Dot status={l.composition.confidence} />{' '}
                        {STATUS_RU[l.composition.confidence]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="panel" style={{ padding: '13px 17px', fontSize: 13 }}>
        Расход основного полотна:{' '}
        <b className="data-value" style={{ fontSize: 14 }}>
          {bom.fabric_consumption_m.value} м
        </b>{' '}
        на изделие
        {bom.batch_qty && bom.batch_consumption_m && (
          <>
            {' '}
            · на тираж {bom.batch_qty} шт:{' '}
            <b className="data-value" style={{ fontSize: 14 }}>
              {bom.batch_consumption_m} м
            </b>
          </>
        )}
        <span style={{ color: 'var(--secondary)' }}>
          {' '}
          — предварительно, точную раскладку считает фабрика.
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 05 Конструкция

function Constr() {
  const s = useStore();
  const spec = s.spec!;
  const nodes = spec.construction?.nodes ?? [];
  const [selNode, setSelNode] = useState<string | null>(null);

  return (
    <div className="sfup">
      <Head>Конструкция · узлы обработки</Head>
      <div style={{ display: 'grid', gap: 10 }}>
        {nodes.map((n, i) => (
          <div
            key={n.node_id}
            onClick={() => setSelNode(selNode === n.node_id ? null : n.node_id)}
            className="panel"
            style={{
              padding: '14px 18px',
              display: 'flex',
              gap: 16,
              cursor: 'pointer',
              borderColor: selNode === n.node_id ? 'var(--ink)' : 'var(--hairline)',
            }}
          >
            <span
              className="mono"
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                flex: 'none',
                display: 'grid',
                placeItems: 'center',
                fontSize: 12,
                background: selNode === n.node_id ? 'var(--ink)' : 'rgba(14,14,14,.06)',
                color: selNode === n.node_id ? '#fff' : 'var(--ink)',
              }}
            >
              {i + 1}
            </span>
            <div style={{ flex: 1 }}>
              <Kicker style={{ fontSize: 8 }}>{n.zone}</Kicker>
              <div style={{ fontWeight: 600, fontSize: 14, margin: '2px 0 4px' }}>
                {n.label_ru}
                {n.requires_special_equipment && (
                  <span
                    style={{
                      marginLeft: 10,
                      fontSize: 10,
                      color: 'var(--data-red)',
                      border: '1px solid var(--data-red)',
                      borderRadius: 6,
                      padding: '2px 7px',
                      verticalAlign: 'middle',
                    }}
                  >
                    спецоборудование
                  </span>
                )}
              </div>
              <div style={{ color: 'var(--secondary)', fontSize: 12.5, lineHeight: 1.5 }}>
                {n.plain_ru}
              </div>
              {s.pro && (
                <div style={{ display: 'flex', gap: 8, marginTop: 9, flexWrap: 'wrap' }}>
                  <span className="chip" style={{ padding: '4px 10px', fontSize: 11 }}>
                    шов {n.seam_code}
                  </span>
                  <span className="chip" style={{ padding: '4px 10px', fontSize: 11 }}>
                    стежок {n.stitch_code}
                  </span>
                  <span className="chip" style={{ padding: '4px 10px', fontSize: 11 }}>
                    <Term
                      text={`SPI ${n.spi}`}
                      tip="Стежков на дюйм. Плотность строчки: больше — прочнее и медленнее."
                    />
                  </span>
                  <span className="chip" style={{ padding: '4px 10px', fontSize: 11 }}>
                    {n.machine}
                  </span>
                </div>
              )}
              {n.alternative && (
                <div style={{ marginTop: 9, fontSize: 12, color: 'var(--data-red)' }}>
                  Замена под базовый цех: {n.alternative.label_ru}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {s.pro && spec.construction?.sequence && (
        <>
          <Head>Технологическая последовательность</Head>
          <div className="card" style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {['№', 'Неделимая операция', 'Спец.', 'Оборудование'].map((h, i) => (
                    <th
                      key={i}
                      className="kicker"
                      style={{
                        textAlign: 'left',
                        padding: '9px 13px',
                        borderBottom: '1px solid var(--hairline)',
                        fontSize: 8.3,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {spec.construction.sequence.map((op, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--hairline-row)' }}>
                    <td className="mono" style={{ padding: '7px 13px', fontSize: 10 }}>
                      {i + 1}
                    </td>
                    <td style={{ padding: '7px 13px' }}>{op.label_ru}</td>
                    <td className="mono" style={{ padding: '7px 13px', fontSize: 10.5 }}>
                      {op.specialty}
                    </td>
                    <td style={{ padding: '7px 13px', color: 'var(--secondary)' }}>{op.machine}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 06 Ярлыки

function Labels() {
  const s = useStore();
  const spec = s.spec!;
  const l = spec.labels;
  if (!l) return <Head>Ярлыки — нет данных</Head>;
  const missing = l.requisites.filter((r) => r.required && r.value === null);

  return (
    <div className="sfup">
      <Head>Маркировка и артикулы</Head>

      {missing.length > 0 && (
        <div
          onClick={() => s.go('library')}
          style={{
            border: '1px solid var(--data-red)',
            borderRadius: 10,
            padding: '12px 16px',
            marginBottom: 16,
            fontSize: 12.5,
            color: 'var(--data-red)',
            cursor: 'pointer',
          }}
        >
          Не заполнено: {missing.map((r) => r.label_ru).join(', ')}. Продажа в ЕАЭС невозможна —
          заполните профиль бренда в Библиотеке →
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
        <div className="card" style={{ padding: '18px 20px' }}>
          <b style={{ fontSize: 14 }}>Составник</b>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 10 }}>
            <tbody>
              {l.requisites.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--hairline-row)' }}>
                  <td style={{ padding: '6px 0', color: 'var(--secondary)', width: '46%' }}>
                    {r.label_ru}
                  </td>
                  <td className="data-value" style={{ padding: '6px 0', fontSize: 11.5 }}>
                    {r.value ? (
                      r.value.value
                    ) : (
                      <span style={{ color: 'var(--data-red)' }}>
                        — {r.action_ru ?? 'не заполнено'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {l.care_symbols.map((c) => (
              <span key={c.id} className="chip" style={{ padding: '4px 10px', fontSize: 11 }}>
                {c.label_ru}
              </span>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: '18px 20px' }}>
          <b style={{ fontSize: 14 }}>Навесной ярлык</b>
          <div
            style={{
              width: 130,
              height: 200,
              border: '1px solid var(--hairline)',
              borderRadius: 8,
              margin: '14px auto',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: 14,
              textAlign: 'center',
            }}
          >
            <b style={{ fontSize: 13 }}>{spec.style.brand ?? '[БРЕНД]'}</b>
            <div style={{ fontSize: 10.5, color: 'var(--secondary)' }}>{spec.style.name}</div>
            <div className="mono" style={{ fontSize: 9 }}>
              {spec.style.article}
            </div>
            <div className="mono" style={{ fontSize: 9 }}>
              RU {spec.base.base_size_ru}
            </div>
          </div>
          {!spec.style.brand && (
            <div style={{ fontSize: 11.5, color: 'var(--data-red)', textAlign: 'center' }}>
              Имя бренда придёт из Библиотеки
            </div>
          )}
        </div>
      </div>

      <b style={{ fontSize: 14 }}>
        Матрица артикулов ·{' '}
        <Term
          text="GTIN"
          tip="Глобальный номер товара для «Честного знака». Получает бренд в Нацкаталоге — мы оставляем плейсхолдеры."
        />
      </b>
      <div className="card" style={{ overflow: 'auto', marginTop: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['SKU', 'Цвет', 'Размер', 'GTIN'].map((h, i) => (
                <th
                  key={i}
                  className="kicker"
                  style={{
                    textAlign: 'left',
                    padding: '9px 13px',
                    borderBottom: '1px solid var(--hairline)',
                    fontSize: 8.3,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {l.sku_matrix.map((row) => (
              <tr key={row.sku} style={{ borderBottom: '1px solid var(--hairline-row)' }}>
                <td className="mono" style={{ padding: '7px 13px', fontSize: 10.5 }}>
                  {row.sku}
                </td>
                <td style={{ padding: '7px 13px' }}>{row.colorway_ru}</td>
                <td style={{ padding: '7px 13px' }}>RU {row.size_ru}</td>
                <td
                  className="mono"
                  style={{ padding: '7px 13px', fontSize: 10.5, color: 'var(--lib-grey)' }}
                >
                  {row.gtin ?? 'плейсхолдер'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 07 Версии

function Versions() {
  const s = useStore();
  const spec = s.spec!;
  const [facts, setFacts] = useState<Record<string, string>>({});

  const rows = spec.measurements.points.slice(0, 12);

  return (
    <div className="sfup">
      <Head>Версии и примерки</Head>
      <div
        style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 18, fontSize: 12.5 }}
      >
        <span className="chip on">v1 · текущая</span>
        <span style={{ color: 'var(--secondary)' }}>→</span>
        <span className="chip">Примерка №1 — заполните факты ниже</span>
      </div>

      <div
        style={{
          color: 'var(--secondary)',
          fontSize: 13,
          lineHeight: 1.6,
          maxWidth: 640,
          marginBottom: 16,
        }}
      >
        Отшили образец — впишите фактические замеры. Дельта и попадание в допуск считаются сразу;
        полный протокол примерки с подтверждением статусов ведёт наша команда по бланку замеров.
      </div>

      <div className="card" style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['Код', 'Точка', 'По спеке', 'Факт, см', 'Δ', 'В допуске'].map((h, i) => (
                <th
                  key={i}
                  className="kicker"
                  style={{
                    textAlign: i >= 2 ? 'right' : 'left',
                    padding: '9px 13px',
                    borderBottom: '1px solid var(--hairline)',
                    fontSize: 8.3,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const fact = Number((facts[p.code] ?? '').replace(',', '.'));
              const has = Number.isFinite(fact) && facts[p.code];
              const delta = has ? Math.round((fact - p.base.value) * 10) / 10 : null;
              const inTol = delta !== null && Math.abs(delta) <= p.tolerance.value;
              return (
                <tr key={p.code} style={{ borderBottom: '1px solid var(--hairline-row)' }}>
                  <td
                    className="mono"
                    style={{ padding: '7px 13px', fontSize: 10, color: 'var(--tertiary)' }}
                  >
                    {p.code}
                  </td>
                  <td style={{ padding: '7px 13px' }}>{p.name_ru}</td>
                  <td
                    className="mono data-value"
                    style={{ padding: '7px 13px', textAlign: 'right', fontSize: 11 }}
                  >
                    {p.base.value}
                  </td>
                  <td style={{ padding: '5px 13px', textAlign: 'right' }}>
                    <input
                      style={{ width: 68, textAlign: 'right', padding: '5px 8px', fontSize: 11.5 }}
                      value={facts[p.code] ?? ''}
                      onChange={(e) => setFacts({ ...facts, [p.code]: e.target.value })}
                    />
                  </td>
                  <td
                    className="mono"
                    style={{
                      padding: '7px 13px',
                      textAlign: 'right',
                      fontSize: 11,
                      color:
                        delta === null
                          ? 'var(--lib-grey)'
                          : inTol
                            ? 'var(--confirm-green)'
                            : 'var(--data-red)',
                    }}
                  >
                    {delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta}`}
                  </td>
                  <td style={{ padding: '7px 13px', textAlign: 'right' }}>
                    {delta === null ? (
                      <span style={{ color: 'var(--lib-grey)', fontSize: 11 }}>—</span>
                    ) : (
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 600,
                          padding: '2px 9px',
                          borderRadius: 999,
                          color: inTol ? 'var(--confirm-green)' : 'var(--data-red)',
                          background: inTol ? 'rgba(47,124,90,.1)' : 'rgba(192,57,43,.08)',
                        }}
                      >
                        {inTol ? 'да' : 'нет'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--secondary)' }}>
        Факты примерки применяются в новую версию нашей командой: значения получают статус
        «подтверждено по образцу», документ выпускается со страницей «Что изменилось».
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 08 Экспорт

function ExportSection() {
  const s = useStore();
  const jobId = s.currentJob!;
  const [lang, setLang] = useState<'ru' | 'en' | 'zh'>('ru');
  const [historyRows, setHistoryRows] = useState<string[]>([]);
  const [previewKey, setPreviewKey] = useState(0);

  const langs = [
    { id: 'ru', label: 'Русский' },
    { id: 'en', label: 'English' },
    { id: 'zh', label: '中文' },
  ] as const;

  return (
    <div className="sfup">
      <Head>Экспорт</Head>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {langs.map((l) => (
          <button
            key={l.id}
            className={`chip ${lang === l.id ? 'on' : ''}`}
            onClick={() => {
              setLang(l.id);
              setPreviewKey((k) => k + 1);
            }}
          >
            {l.label}
          </button>
        ))}
        {lang !== 'ru' && (
          <span style={{ fontSize: 11.5, color: 'var(--secondary)', alignSelf: 'center' }}>
            фабричный комплект: переведённые целиком разделы + оговорка о переводе
          </span>
        )}
      </div>

      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}
      >
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="card" style={{ padding: '20px 22px' }}>
            <b style={{ fontSize: 15 }}>PDF · полный комплект</b>
            <div
              style={{
                color: 'var(--secondary)',
                fontSize: 12.5,
                lineHeight: 1.55,
                margin: '6px 0 14px',
              }}
            >
              Все листы. Если вы правили замеры — пересоберётся из новых данных.
            </div>
            <a
              className="btn"
              style={{
                display: 'inline-block',
                textDecoration: 'none',
                padding: '11px 22px',
                fontSize: 13.5,
              }}
              href={`${api.pdfUrl(jobId)}${lang !== 'ru' ? `&locale=${lang}` : ''}`}
              download
              onClick={() => {
                setHistoryRows((h) => [
                  `${new Date().toLocaleTimeString().slice(0, 5)} · PDF ${lang.toUpperCase()} · полный`,
                  ...h,
                ]);
                void api.event('pdf_click', { jobId, lang });
              }}
            >
              Скачать PDF
            </a>
          </div>

          <div className="card" style={{ padding: '20px 22px' }}>
            <b style={{ fontSize: 15 }}>Ссылка для фабрики</b>
            <div
              style={{
                color: 'var(--secondary)',
                fontSize: 12.5,
                lineHeight: 1.55,
                margin: '6px 0 14px',
              }}
            >
              Документ только для чтения, открывается без входа — фабрика читает, вы правите.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn white"
                style={{ padding: '10px 18px', fontSize: 13 }}
                onClick={() => {
                  const url = new URL(api.previewUrl(jobId, lang), location.origin).toString();
                  void navigator.clipboard?.writeText(url);
                  s.showToast('Ссылка скопирована');
                  void api.event('factory_link', { jobId, lang });
                }}
              >
                Скопировать
              </button>
              <a
                className="btn white"
                style={{ padding: '10px 18px', fontSize: 13, textDecoration: 'none' }}
                href={api.previewUrl(jobId, lang)}
                target="_blank"
                rel="noreferrer"
              >
                Открыть как фабрика
              </a>
            </div>
          </div>

          <div
            className="card"
            style={{ padding: '20px 22px', border: '1px solid var(--confirm-green)' }}
          >
            <b style={{ fontSize: 15, color: 'var(--confirm-green)' }}>Отправить на просчёт</b>
            <div
              style={{
                color: 'var(--secondary)',
                fontSize: 12.5,
                lineHeight: 1.55,
                margin: '6px 0 14px',
              }}
            >
              Пак уходит проверенным фабрикам с листом RFQ — они возвращают цену, минимальную партию
              и срок.
            </div>
            <button
              className="btn"
              style={{ background: 'var(--confirm-green)', padding: '11px 22px', fontSize: 13.5 }}
              onClick={() => {
                s.showToast('Заявка на просчёт записана — вернёмся с ценами фабрик');
                void api.event('rfq_click', { jobId });
              }}
            >
              Выбрать фабрики
            </button>
          </div>

          {historyRows.length > 0 && (
            <div className="panel" style={{ padding: '13px 17px', fontSize: 12 }}>
              <b>История выгрузок</b>
              {historyRows.map((h, i) => (
                <div key={i} style={{ color: 'var(--secondary)', marginTop: 6 }}>
                  {h}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Живое превью документа */}
        <div className="card" style={{ padding: 14 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 10,
            }}
          >
            <Kicker>Превью документа · {lang.toUpperCase()}</Kicker>
            <button
              className="chip"
              style={{ padding: '4px 10px', fontSize: 11 }}
              onClick={() => setPreviewKey((k) => k + 1)}
            >
              Обновить
            </button>
          </div>
          <iframe
            key={previewKey}
            src={api.previewUrl(jobId, lang)}
            title="Превью PDF"
            style={{
              width: '100%',
              height: 520,
              border: '1px solid var(--hairline)',
              borderRadius: 8,
              background: '#fff',
            }}
          />
        </div>
      </div>
    </div>
  );
}
