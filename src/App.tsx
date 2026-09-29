import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FamilyData, FamilyTree } from './types';
import { validateData, validateTree } from './validate';
import { TreeView, type TreeViewHandle } from './components/TreeView';
import { StatsPanel } from './components/StatsPanel';
import { computeStats } from './stats';
import { useLayout } from './useLayout';

const DATA_URL = `${import.meta.env.BASE_URL}data/family.json`;
const APP_NAME = 'Arbol genealógico';

/** The URL variable that picks which tree to show: `/?arbol=<uid>`. */
export const TREE_PARAM = 'arbol';
const readTreeUid = () => new URLSearchParams(window.location.search).get(TREE_PARAM)?.trim() || null;

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'missing' }
  | { status: 'ready'; tree: FamilyTree; problems: string[] };

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function App() {
  const [uid] = useState(readTreeUid);
  return uid ? <TreePage uid={uid} /> : <Home />;
}

/** A calm, centred page for when there's no tree to show. */
function Gate({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="gate">
      <div className="gate__card">
        <img className="gate__mark" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={56} height={56} />
        <h1 className="gate__title">{title}</h1>
        <p className="gate__text">{children}</p>
      </div>
    </main>
  );
}

function Home() {
  useEffect(() => {
    document.title = APP_NAME;
  }, []);
  return (
    <Gate title={APP_NAME}>Para ver un árbol necesitás el enlace que te compartieron.</Gate>
  );
}

function TreePage({ uid }: { uid: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch(DATA_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`No se pudo cargar ${DATA_URL} (HTTP ${res.status}).`);
        return res.json() as Promise<FamilyData>;
      })
      .then((data) => {
        if (cancelled) return;
        const fileProblems = validateData(data);
        const tree = Array.isArray(data.trees) ? data.trees.find((t) => t.uid === uid) : undefined;
        if (!tree) {
          fileProblems.forEach((p) => console.warn('[family.json]', p));
          setState({ status: 'missing' });
          return;
        }
        const problems = [...fileProblems, ...validateTree(tree)];
        problems.forEach((p) => console.warn('[family.json]', p));
        setState({ status: 'ready', tree, problems });
      })
      .catch((err: Error) => !cancelled && setState({ status: 'error', message: err.message }));
    return () => { cancelled = true; };
  }, [uid]);

  useEffect(() => {
    if (state.status === 'ready') document.title = `${state.tree.name} – ${APP_NAME}`;
  }, [state]);

  const layout = useLayout(state.status === 'ready' ? state.tree : null);
  const stats = useMemo(
    () => (state.status === 'ready' && layout ? computeStats(state.tree, layout) : null),
    [state, layout],
  );

  const treeRef = useRef<TreeViewHandle>(null);
  const panelRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [panelInset, setPanelInset] = useState(0);

  // On wide screens the panel sits beside the tree, so the tree centres in the space left of it.
  // On phones it covers the tree instead.
  const isWide = () => window.matchMedia('(min-width: 721px)').matches;
  useEffect(() => {
    const measure = () => {
      const panel = panelRef.current;
      setPanelInset(statsOpen && panel && isWide() ? panel.offsetWidth + 24 : 0);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [statsOpen]);

  const closeStats = useCallback(() => {
    setStatsOpen(false);
    if (panelRef.current?.contains(document.activeElement)) toggleRef.current?.focus();
  }, []);

  const pickPerson = (id: string) => {
    if (!isWide()) setStatsOpen(false);
    treeRef.current?.focusPerson(id);
  };

  if (state.status === 'missing') {
    return (
      <Gate title="No encontramos este árbol">
        Revisá que el enlace esté completo, o pedile uno nuevo a quien te lo compartió.
      </Gate>
    );
  }

  const isEmpty = state.status === 'ready' && state.tree.people.length === 0;
  const isArranging = (state.status === 'loading' || state.status === 'ready') && !isEmpty && !layout;

  return (
    <main className="app">
      <header className="app__header">
        <div className="app__titles">
          <h1 className="app__title">{state.status === 'ready' ? state.tree.name : APP_NAME}</h1>
          <p className="app__summary">
            {layout
              ? `${count(layout.people.length, 'persona', 'personas')} en ${count(layout.bands.length, 'generación', 'generaciones')}`
              : ' '}
          </p>
        </div>
        <div className="app__tools">
          <ul className="legend" aria-label="Tipos de línea">
            <li>
              <svg width="30" height="10" aria-hidden="true"><path d="M2 5 H28" className="line line--partner" /></svg>
              Juntos
            </li>
            <li>
              <svg width="30" height="10" aria-hidden="true"><path d="M2 5 H28" className="line line--ended" /></svg>
              Separados
            </li>
          </ul>
          {layout && layout.people.length > 0 && (
            <button
              ref={toggleRef}
              type="button"
              className={statsOpen ? 'stats-toggle stats-toggle--active' : 'stats-toggle'}
              aria-expanded={statsOpen}
              aria-controls="stats-panel"
              onClick={() => (statsOpen ? closeStats() : setStatsOpen(true))}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path d="M3 15V9 M9 15V3 M15 15V7" />
              </svg>
              <span className="stats-toggle__text">Estadísticas</span>
            </button>
          )}
        </div>
      </header>

      {state.status === 'error' && (
        <p className="notice notice--error">
          {state.message} Revisá que el archivo exista en <code>public/data/</code> y que sea un JSON válido.
        </p>
      )}
      {state.status === 'ready' && state.problems.length > 0 && (
        <p className="notice notice--warn">
          {state.problems.length === 1 ? 'Hay 1 problema' : `Hay ${state.problems.length} problemas`} en family.json. Revisá la consola.
        </p>
      )}

      {isEmpty && (
        <div className="stage stage--empty">
          <p>Este árbol todavía no tiene personas. Agregalas en <code>public/data/family.json</code>.</p>
        </div>
      )}
      {isArranging && (
        <div className="stage stage--loading" aria-live="polite">
          <p>{state.status === 'loading' ? 'Cargando los datos de la familia…' : 'Armando el árbol…'}</p>
        </div>
      )}
      {layout && layout.people.length > 0 && (
        <div className="workspace">
          <TreeView ref={treeRef} layout={layout} panelInset={panelInset} />
          <StatsPanel ref={panelRef} open={statsOpen} stats={stats} onClose={closeStats} onPick={pickPerson} />
        </div>
      )}
    </main>
  );
}
