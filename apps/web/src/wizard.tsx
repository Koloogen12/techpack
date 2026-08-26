import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useStore } from './store.js';

/**
 * Мастер создания — хендофф, экран 4: два шага, прогресс-полоса,
 * блок «Повысить точность» (эталон размера + ручной замер — оба РЕАЛЬНЫЕ:
 * движок умеет масштаб по A4/карте и калибровку одним замером),
 * вкладка «Импорт PDF · Excel» — датчик спроса.
 */

const CATEGORIES = [
  { id: 'tshirt', label: 'Футболка' },
  { id: 'longsleeve', label: 'Лонгслив' },
  { id: 'sweatshirt', label: 'Свитшот' },
  { id: 'hoodie', label: 'Худи' },
] as const;
const FITS = [
  { id: 'fitted', label: 'Прилегающая' },
  { id: 'semi_fitted', label: 'Обычная' },
  { id: 'loose', label: 'Свободная' },
  { id: 'oversize', label: 'Oversize' },
] as const;
const SIZES = [42, 44, 46, 48, 50, 52, 54];
const VIEWS = [
  { id: 'front', label: 'перед' },
  { id: 'back', label: 'спинка' },
  { id: 'side', label: 'бок' },
  { id: 'flat', label: 'разложено' },
] as const;

interface Shot {
  file: File;
  url: string;
  view: string | null;
}

export function Wizard() {
  const s = useStore();
  const [tab, setTab] = useState<'photo' | 'import'>('photo');
  const [step, setStep] = useState<1 | 2>(1);
  const [shots, setShots] = useState<Shot[]>([]);
  const [precOpen, setPrecOpen] = useState(false);
  const [manual, setManual] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [gender, setGender] = useState<'women' | 'men' | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [height, setHeight] = useState('170');
  const [fit, setFit] = useState<string | null>(null);
  const [fabric, setFabric] = useState('knit');
  const [range, setRange] = useState<number[]>([]);
  const [qty, setQty] = useState('100');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [baseName, setBaseName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // «Взять за основу»: предзаполнение из существующего пака.
  useEffect(() => {
    if (!s.wizardBase) return;
    const j = s.jobs.find((x) => x.id === s.wizardBase);
    if (j) setBaseName(j.name);
    void api
      .spec(s.wizardBase)
      .then((p) => {
        const b = p.spec.base;
        setCategory(p.spec.style.category);
        setGender(b.gender as 'women' | 'men');
        setSize(b.base_size_ru);
        setHeight(String(b.base_height_cm));
        setFit(b.fit_intent);
        setFabric(b.fabric_kind);
        setRange(b.size_range);
        setStep(2);
      })
      .catch(() => null);
  }, [s.wizardBase, s.jobs]);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const next = [...shots];
    for (const f of Array.from(files)) {
      if (next.length >= 6 || !f.type.startsWith('image/')) continue;
      next.push({ file: f, url: URL.createObjectURL(f), view: next.length === 0 ? 'front' : null });
    }
    setShots(next);
    void api.event('photos_added', { count: next.length });
  };

  const ready = category && gender && size && fit && range.length > 0;

  const launch = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const sizes = [...new Set([...range, size!])].sort((a, b) => a - b);
      const manualCm = Number(manual.replace(',', '.'));
      const { id } = await api.createJob({
        id: `demo-${Date.now()}`,
        name: CATEGORIES.find((c) => c.id === category)!.label,
        article: `DEMO-${String(Date.now()).slice(-6)}`,
        category,
        gender,
        base_size_ru: size,
        base_height_cm: Number(height) || 170,
        fit_intent: fit,
        fabric_kind: fabric,
        size_range: sizes,
        quantity: Number(qty) || undefined,
        // Ручной замер калибрует весь масштаб — реальная механика движка.
        ...(Number.isFinite(manualCm) && manualCm > 30
          ? { manual: { code: 'T01', value_cm: manualCm } }
          : {}),
      });
      for (const shot of shots) await api.uploadPhoto(id, shot.file, shot.view);
      await api.start(id);
      await s.refreshJobs();
      s.startGenerating(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'не получилось запустить');
      setBusy(false);
    }
  };

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <div
        style={{
          height: 3,
          background: 'rgba(14,14,14,.08)',
          position: 'sticky',
          top: 0,
          zIndex: 5,
        }}
      >
        <div
          style={{
            height: '100%',
            background: 'var(--ink)',
            width: step === 1 ? '33%' : '66%',
            transition: 'width 300ms ease',
          }}
        />
      </div>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '40px 32px 90px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 26,
            position: 'relative',
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={`chip ${tab === 'photo' ? 'on' : ''}`}
              onClick={() => setTab('photo')}
            >
              Фото или эскиз
            </button>
            <button
              className={`chip ${tab === 'import' ? 'on' : ''}`}
              onClick={() => {
                setTab('import');
                void api.event('import_tab', null);
              }}
            >
              Импорт PDF · Excel
            </button>
          </div>
          <button
            onClick={() => (step >= 2 ? setCloseConfirm(true) : s.go('home'))}
            style={{
              border: 0,
              background: 'none',
              fontSize: 14,
              color: 'var(--secondary)',
              cursor: 'pointer',
            }}
          >
            ✕ Закрыть
          </button>
          {closeConfirm && (
            <div
              className="sfup"
              style={{
                position: 'absolute',
                right: 0,
                top: '100%',
                background: '#fff',
                borderRadius: 12,
                boxShadow: 'var(--shadow-menu)',
                padding: 16,
                zIndex: 30,
                width: 260,
              }}
            >
              <div style={{ fontSize: 13.5, marginBottom: 12 }}>Ответы не сохранятся — выйти?</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn"
                  style={{ padding: '8px 14px', fontSize: 12.5 }}
                  onClick={() => s.go('home')}
                >
                  Выйти
                </button>
                <button
                  className="btn white"
                  style={{ padding: '8px 14px', fontSize: 12.5 }}
                  onClick={() => setCloseConfirm(false)}
                >
                  Остаться
                </button>
              </div>
            </div>
          )}
        </div>

        {baseName && (
          <div
            style={{
              display: 'inline-block',
              marginBottom: 14,
              padding: '5px 12px',
              borderRadius: 999,
              background: 'rgba(47,124,90,.1)',
              color: 'var(--confirm-green)',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            На основе: {baseName}
          </div>
        )}

        {tab === 'import' && (
          <div className="sfup">
            <h1 style={{ fontSize: 30, letterSpacing: '-1px', margin: '0 0 8px' }}>
              Импорт готового техпака
            </h1>
            <div
              style={{
                color: 'var(--secondary)',
                maxWidth: 560,
                lineHeight: 1.6,
                marginBottom: 22,
              }}
            >
              У вас уже есть техпак в PDF или таблице — мы разберём его в живой документ с чертежом
              и градацией.
            </div>
            <div
              onClick={() => {
                s.showToast('Импорт в раннем доступе — записали ваш интерес');
                void api.event('import_interest', null);
              }}
              style={{
                border: '1.5px dashed var(--lib-grey)',
                borderRadius: 14,
                padding: '48px 24px',
                textAlign: 'center',
                cursor: 'pointer',
                background: '#fff',
                maxWidth: 560,
              }}
            >
              <b>Перетащите PDF или Excel</b>
              <div style={{ color: 'var(--secondary)', fontSize: 13, marginTop: 6 }}>
                Ранний доступ: разбор выполняет наш технолог, файл вернётся живым паком. Лимит
                генераций не списывается.
              </div>
            </div>
          </div>
        )}

        {tab === 'photo' && step === 1 && (
          <div className="sfup">
            <h1 style={{ fontSize: 30, letterSpacing: '-1px', margin: '0 0 8px' }}>
              Фото или эскиз
            </h1>
            <div
              style={{
                color: 'var(--secondary)',
                marginBottom: 24,
                maxWidth: 560,
                lineHeight: 1.6,
              }}
            >
              Достаточно одного снимка спереди. Каждый следующий ракурс открывает новые точки
              замера.
            </div>

            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
              style={{
                border: '1.5px dashed var(--lib-grey)',
                borderRadius: 14,
                padding: '40px 24px',
                textAlign: 'center',
                cursor: 'pointer',
                background: '#fff',
              }}
            >
              <b style={{ fontSize: 15 }}>Перетащите фото сюда или нажмите</b>
              <div style={{ color: 'var(--secondary)', fontSize: 13, marginTop: 6 }}>
                {shots.length} из 6 · JPG, PNG, WebP
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => addFiles(e.target.files)}
              />
            </div>

            {shots.length > 0 && (
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 16 }}>
                {shots.map((shot, i) => (
                  <div key={i} className="panel" style={{ padding: 10, width: 146 }}>
                    <div style={{ position: 'relative' }}>
                      <img
                        src={shot.url}
                        alt=""
                        style={{ width: '100%', height: 104, objectFit: 'cover', borderRadius: 7 }}
                      />
                      <button
                        onClick={() => setShots(shots.filter((_, j) => j !== i))}
                        style={{
                          position: 'absolute',
                          top: 5,
                          right: 5,
                          width: 22,
                          height: 22,
                          borderRadius: 11,
                          border: 0,
                          background: 'rgba(14,14,14,.75)',
                          color: '#fff',
                          fontSize: 12,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                    <select
                      value={shot.view ?? ''}
                      onChange={(e) =>
                        setShots(
                          shots.map((x, j) =>
                            j === i ? { ...x, view: e.target.value || null } : x,
                          ),
                        )
                      }
                      style={{ width: '100%', marginTop: 8, fontSize: 12, padding: '6px 8px' }}
                    >
                      <option value="">ракурс не указан</option>
                      {VIEWS.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}

            {/* Повысить точность */}
            <div className="panel" style={{ marginTop: 18, padding: '14px 18px' }}>
              <div
                onClick={() => setPrecOpen(!precOpen)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                }}
              >
                <b style={{ fontSize: 14 }}>Повысить точность</b>
                <span
                  style={{
                    fontSize: 11.5,
                    padding: '4px 11px',
                    borderRadius: 999,
                    background: manual ? 'rgba(47,124,90,.12)' : 'rgba(14,14,14,.05)',
                    color: manual ? 'var(--confirm-green)' : 'var(--secondary)',
                    fontWeight: 600,
                  }}
                >
                  {manual ? '±1 см активно' : 'сейчас ±2 см'}
                </span>
              </div>
              {precOpen && (
                <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
                  <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--secondary)' }}>
                    <b style={{ color: 'var(--ink)' }}>Фото с эталоном размера.</b> Положите лист А4
                    или банковскую карту на изделие и снимите строго сверху — движок узнает эталон и
                    превратит пропорции в сантиметры. Просто добавьте такой снимок выше с ракурсом
                    «разложено».
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
                    <b>Один ручной замер:</b>
                    <span style={{ color: 'var(--secondary)' }}>длина по спинке, см</span>
                    <input
                      value={manual}
                      onChange={(e) => setManual(e.target.value)}
                      placeholder="66"
                      style={{ width: 80 }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 26, alignItems: 'center' }}>
              <button className="btn" onClick={() => setStep(2)}>
                Дальше — пять вопросов
              </button>
              {!shots.length && (
                <span style={{ color: 'var(--secondary)', fontSize: 13 }}>
                  Можно и без фото — соберём по типовым пропорциям категории
                </span>
              )}
            </div>
          </div>
        )}

        {tab === 'photo' && step === 2 && (
          <div className="sfup">
            <h1 style={{ fontSize: 30, letterSpacing: '-1px', margin: '0 0 8px' }}>
              Пять вопросов
            </h1>
            <div
              style={{
                color: 'var(--secondary)',
                marginBottom: 24,
                maxWidth: 560,
                lineHeight: 1.6,
              }}
            >
              Масштаб изделия приходит отсюда, а не с фотографии: абсолютные сантиметры по снимку
              недостижимы — это свойство оптики.
            </div>

            <Q
              n="01"
              title="Что за изделие"
              hint={shots.length ? 'определим и по фото — ответ сверит' : undefined}
            >
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  className={`chip ${category === c.id ? 'on' : ''}`}
                  onClick={() => setCategory(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </Q>
            <Q n="02" title="Для кого">
              <button
                className={`chip ${gender === 'women' ? 'on' : ''}`}
                onClick={() => setGender('women')}
              >
                Женское
              </button>
              <button
                className={`chip ${gender === 'men' ? 'on' : ''}`}
                onClick={() => setGender('men')}
              >
                Мужское
              </button>
            </Q>
            <Q n="03" title="Базовый размер и рост">
              {SIZES.map((x) => (
                <button
                  key={x}
                  className={`chip ${size === x ? 'on' : ''}`}
                  onClick={() => setSize(x)}
                >
                  RU {x}
                </button>
              ))}
              <span style={{ marginLeft: 8, color: 'var(--secondary)', fontSize: 13 }}>рост</span>
              <input
                type="number"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                style={{ width: 80 }}
              />
            </Q>
            <Q n="04" title="Посадка">
              {FITS.map((f) => (
                <button
                  key={f.id}
                  className={`chip ${fit === f.id ? 'on' : ''}`}
                  onClick={() => setFit(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </Q>
            <Q n="05" title="Полотно, размерный ряд и тираж">
              <button
                className={`chip ${fabric === 'knit' ? 'on' : ''}`}
                onClick={() => setFabric('knit')}
              >
                Трикотаж
              </button>
              <button
                className={`chip ${fabric === 'woven' ? 'on' : ''}`}
                onClick={() => setFabric('woven')}
              >
                Ткань
              </button>
              <span style={{ width: 14 }} />
              {SIZES.map((x) => (
                <button
                  key={x}
                  className={`chip ${range.includes(x) ? 'on' : ''}`}
                  onClick={() =>
                    setRange(range.includes(x) ? range.filter((y) => y !== x) : [...range, x])
                  }
                >
                  {x}
                </button>
              ))}
              <span style={{ marginLeft: 8, color: 'var(--secondary)', fontSize: 13 }}>
                тираж, шт
              </span>
              <input
                type="number"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                style={{ width: 90 }}
              />
              {Number(qty) > 0 && (
                <span style={{ fontSize: 12, color: 'var(--secondary)' }}>
                  — расход полотна пересчитается на {qty} шт
                </span>
              )}
            </Q>

            {error && (
              <div style={{ color: 'var(--data-red)', margin: '14px 0', fontSize: 13.5 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 26, alignItems: 'center' }}>
              <button className="btn white" onClick={() => setStep(1)}>
                ← Назад
              </button>
              <button className="btn" disabled={!ready || busy} onClick={launch}>
                {busy ? 'Запускаем…' : 'Запустить генерацию'}
              </button>
              {!ready && (
                <span style={{ color: 'var(--secondary)', fontSize: 13 }}>
                  Не хватает:{' '}
                  {[
                    !category && 'категория',
                    !gender && 'для кого',
                    !size && 'размер',
                    !fit && 'посадка',
                    !range.length && 'размерный ряд',
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Q({
  n,
  title,
  hint,
  children,
}: {
  n: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel" style={{ padding: '16px 20px', marginBottom: 13 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 11 }}>
        <span className="mono" style={{ color: 'var(--tertiary)', fontSize: 10.5 }}>
          {n}
        </span>
        <b style={{ fontSize: 14.5 }}>{title}</b>
        {hint && (
          <span
            style={{
              fontSize: 11,
              color: 'var(--confirm-green)',
              background: 'rgba(47,124,90,.1)',
              padding: '2px 9px',
              borderRadius: 999,
            }}
          >
            {hint}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {children}
      </div>
    </div>
  );
}
