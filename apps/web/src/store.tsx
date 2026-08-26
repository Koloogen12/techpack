import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { StyleSpec } from '@seamsterly/stylespec';
import { api, type JobStatus, type SpecPayload } from './api.js';

/**
 * Состояние кабинета — модель из хендоффа («Модель состояния»):
 * screen · section · вкладки открытых паков · pro · units · коллекции ·
 * библиотека · кредиты · уведомления. Данные паков настоящие, с сервера;
 * то, чему сервер не нужен (коллекции, открытые вкладки, режим Pro),
 * живёт в localStorage — прототип держал это в памяти, но у нас страница
 * переживает перезагрузку на созвоне.
 */

export type Screen = 'home' | 'packs' | 'wizard' | 'generating' | 'doc' | 'library' | 'billing';
export type Section =
  'cover' | 'flat' | 'pom' | 'bom' | 'constr' | 'labels' | 'versions' | 'export';

export interface JobRow {
  id: string;
  name: string;
  article: string;
  category: string;
  stage: JobStatus['stage'];
  created_at: string | null;
  assumptions: number | null;
}

export interface Collection {
  name: string;
  packIds: string[];
}

export interface BrandProfile {
  legal?: { company?: string; inn?: string; address?: string };
  materials?: { name: string; spec: string; hex: string; pantone: string }[];
  logo?: boolean;
  sizeGrid?: boolean;
}

interface Store {
  me: { name: string; org: string };
  screen: Screen;
  go: (screen: Screen) => void;
  section: Section;
  setSection: (section: Section) => void;

  jobs: JobRow[];
  refreshJobs: () => Promise<void>;
  openTabs: string[];
  openDoc: (jobId: string, section?: Section) => void;
  closeTab: (jobId: string) => void;
  currentJob: string | null;

  payload: SpecPayload | null;
  setPayload: (payload: SpecPayload) => void;
  spec: StyleSpec | null;
  docLoading: boolean;

  pro: boolean;
  setPro: (pro: boolean) => void;
  units: 'см' | 'in';
  setUnits: (units: 'см' | 'in') => void;

  collections: Collection[];
  setCollections: (c: Collection[]) => void;
  profile: BrandProfile;
  saveProfile: (profile: BrandProfile) => Promise<void>;

  toast: string | null;
  showToast: (text: string) => void;
  pulse: number;
  setPulse: (n: number) => void;

  wizardBase: string | null;
  startWizard: (baseJobId?: string) => void;
  generatingJob: string | null;
  startGenerating: (jobId: string) => void;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('store вне провайдера');
  return s;
}

const LS = {
  read<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  write(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* приватный режим */
    }
  },
};

export function StoreProvider({
  me,
  children,
}: {
  me: { name: string; org: string };
  children: React.ReactNode;
}) {
  const [screen, setScreen] = useState<Screen>('home');
  const [section, setSection] = useState<Section>('cover');
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [openTabs, setOpenTabs] = useState<string[]>(() => LS.read('sf_tabs', []));
  const [currentJob, setCurrentJob] = useState<string | null>(null);
  const [payload, setPayloadRaw] = useState<SpecPayload | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [pro, setProRaw] = useState<boolean>(() => LS.read('sf_pro', false));
  const [units, setUnitsRaw] = useState<'см' | 'in'>(() => LS.read('sf_units', 'см'));
  const [collections, setCollectionsRaw] = useState<Collection[]>(() => LS.read('sf_cols', []));
  const [profile, setProfile] = useState<BrandProfile>({});
  const [toast, setToast] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0);
  const [wizardBase, setWizardBase] = useState<string | null>(null);
  const [generatingJob, setGeneratingJob] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const refreshJobs = useCallback(async () => {
    try {
      const { jobs } = await api.jobs();
      setJobs(jobs);
    } catch {
      /* сеть мигнула — список прежний */
    }
  }, []);

  useEffect(() => {
    void refreshJobs();
    api
      .profile()
      .then((r) => setProfile(r.profile ?? {}))
      .catch(() => null);
  }, [refreshJobs]);

  const showToast = useCallback((text: string) => {
    clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const openDoc = useCallback(
    (jobId: string, target: Section = 'cover') => {
      setCurrentJob(jobId);
      setScreen('doc');
      setSection(target);
      setDocLoading(true);
      setOpenTabs((tabs) => {
        const next = tabs.includes(jobId) ? tabs : [...tabs, jobId].slice(-4);
        LS.write('sf_tabs', next);
        return next;
      });
      void api
        .spec(jobId)
        .then((p) => setPayloadRaw(p))
        .catch(() => showToast('Пак не открылся — обновите список'))
        // Скелетон 550 мс — из прототипа: документ «проявляется».
        .finally(() => setTimeout(() => setDocLoading(false), 550));
      void api.event('open_doc', { jobId });
    },
    [showToast],
  );

  const closeTab = useCallback(
    (jobId: string) => {
      setOpenTabs((tabs) => {
        const next = tabs.filter((t) => t !== jobId);
        LS.write('sf_tabs', next);
        return next;
      });
      if (currentJob === jobId) {
        setCurrentJob(null);
        setScreen('home');
      }
    },
    [currentJob],
  );

  const store: Store = {
    me,
    screen,
    go: (s) => {
      setScreen(s);
      void api.event('screen', { screen: s });
    },
    section,
    setSection: (s) => {
      setSection(s);
      void api.event('section', { section: s });
    },
    jobs,
    refreshJobs,
    openTabs,
    openDoc,
    closeTab,
    currentJob,
    payload,
    setPayload: setPayloadRaw,
    spec: payload?.spec ?? null,
    docLoading,
    pro,
    setPro: (v) => {
      setProRaw(v);
      LS.write('sf_pro', v);
    },
    units,
    setUnits: (v) => {
      setUnitsRaw(v);
      LS.write('sf_units', v);
    },
    collections,
    setCollections: (c) => {
      setCollectionsRaw(c);
      LS.write('sf_cols', c);
    },
    profile,
    saveProfile: async (p) => {
      setProfile(p);
      await api.saveProfile(p);
    },
    toast,
    showToast,
    pulse,
    setPulse,
    wizardBase,
    startWizard: (base) => {
      setWizardBase(base ?? null);
      setScreen('wizard');
    },
    generatingJob,
    startGenerating: (jobId) => {
      setGeneratingJob(jobId);
      setScreen('generating');
    },
  };

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
