import { forwardRef, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { GenderCounts, GenderKey, Ranking, RankRow, TreeStats } from '../stats';
import type { Person } from '../types';

const GENDERS: { key: GenderKey; label: string; plural: string }[] = [
  { key: 'female', label: 'Mujer', plural: 'Mujeres' },
  { key: 'male', label: 'Hombre', plural: 'Hombres' },
  { key: 'other', label: 'Otro', plural: 'Otros' },
  { key: 'unknown', label: 'Sin dato', plural: 'Sin dato' },
];

const sum = (c: GenderCounts) => c.female + c.male + c.other + c.unknown;
const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

/** Spanish list: "A", "A y B", "A, B y C". */
function joinEs(items: ReactNode[]): ReactNode[] {
  return items.flatMap((item, i) => {
    if (i === 0) return [item];
    return [i === items.length - 1 ? ' y ' : ', ', item];
  });
}

/** The people in a row as links. A surname they all share is written once at the end. */
function PeopleNames({ people, onPick }: { people: Person[]; onPick: (id: string) => void }) {
  const shared = people.length > 1 && people.every((p) => p.lastName && p.lastName === people[0].lastName)
    ? people[0].lastName
    : null;
  const links = people.map((p) => (
    <button key={p.id} type="button" className="stats__person" onClick={() => onPick(p.id)}>
      {shared ? p.firstName : [p.firstName, p.lastName].filter(Boolean).join(' ')}
    </button>
  ));
  return (
    <>
      {joinEs(links)}
      {shared && ` ${shared}`}
    </>
  );
}

function RankingList({ ranking, unit, onPick }: { ranking: Ranking; unit: [string, string]; onPick: (id: string) => void }) {
  const max = Math.max(1, ...ranking.rows.map((r) => r.value));
  if (!ranking.rows.length) return <p className="stats__empty">Todavía no hay datos para esto.</p>;
  return (
    <ol className="bars">
      {ranking.rows.map((row: RankRow, i) => (
        <li key={row.key} className="bars__row" style={{ '--i': i } as CSSProperties}>
          <span className="bars__label">
            {row.people ? <PeopleNames people={row.people} onPick={onPick} /> : row.label}
          </span>
          <span className="bars__track">
            <span className="bars__fill" aria-hidden="true" style={{ '--ratio': row.value / max } as CSSProperties} />
            <span className="bars__value">
              {row.value}
              <span className="visually-hidden"> {row.value === 1 ? unit[0] : unit[1]}</span>
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

interface Tip { text: string; value: string; x: number; y: number }

/** Stacked bar of gender counts; each segment shows its numbers on hover or keyboard focus. */
function GenderBar({ counts, scale, label, onTip }: {
  counts: GenderCounts;
  scale: number;
  label: string;
  onTip: (tip: Tip | null) => void;
}) {
  const total = sum(counts);
  const show = (e: React.SyntheticEvent<HTMLElement>, g: (typeof GENDERS)[number]) => {
    const r = e.currentTarget.getBoundingClientRect();
    const host = e.currentTarget.closest('.gender')!.getBoundingClientRect();
    onTip({
      text: `${label}: ${g.plural.toLowerCase()}`,
      value: `${counts[g.key]} (${pct(counts[g.key], total)}%)`,
      x: r.left + r.width / 2 - host.left,
      y: r.top - host.top,
    });
  };
  return (
    <span className="gbar" style={{ '--ratio': total / scale } as CSSProperties}>
      {GENDERS.filter((g) => counts[g.key] > 0).map((g) => (
        <span
          key={g.key}
          className={`gbar__seg gbar__seg--${g.key}`}
          style={{ flexGrow: counts[g.key] }}
          tabIndex={0}
          role="img"
          aria-label={`${label}: ${counts[g.key]} ${g.plural.toLowerCase()}`}
          onPointerEnter={(e) => show(e, g)}
          onPointerLeave={() => onTip(null)}
          onFocus={(e) => show(e, g)}
          onBlur={() => onTip(null)}
        />
      ))}
    </span>
  );
}

function GenderSection({ stats }: { stats: TreeStats }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const { total, byGeneration } = stats.gender;
  const all = sum(total);
  const present = GENDERS.filter((g) => total[g.key] > 0);
  const maxGen = Math.max(1, ...byGeneration.map(sum));

  return (
    <div className="gender">
      <ul className="gender__legend">
        {present.map((g) => (
          <li key={g.key}>
            <i className={`swatch swatch--${g.key}`} aria-hidden="true" />
            <span className="gender__name">{g.plural}</span>
            <strong>{total[g.key]}</strong>
            <span className="gender__pct">{pct(total[g.key], all)}%</span>
          </li>
        ))}
      </ul>
      <div className="gender__overall">
        <GenderBar counts={total} scale={all} label="Todo el árbol" onTip={setTip} />
      </div>

      <h4 className="stats__subhead">Por generación</h4>
      <ol className="gen">
        {byGeneration.map((counts, i) => (
          <li key={i} className="gen__row" style={{ '--i': i } as CSSProperties}>
            <span className="gen__label">Generación {i + 1}</span>
            <span className="gen__track">
              <GenderBar counts={counts} scale={maxGen} label={`Generación ${i + 1}`} onTip={setTip} />
              <span className="gen__total">{sum(counts)}</span>
            </span>
          </li>
        ))}
      </ol>

      <details className="stats__table">
        <summary>Ver como tabla</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Generación</th>
              {present.map((g) => <th key={g.key} scope="col">{g.plural}</th>)}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {byGeneration.map((counts, i) => (
              <tr key={i}>
                <th scope="row">{i + 1}</th>
                {present.map((g) => <td key={g.key}>{counts[g.key]}</td>)}
                <td>{sum(counts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      {tip && (
        <div className="tooltip" style={{ left: tip.x, top: tip.y }} role="presentation">
          <strong>{tip.value}</strong>
          <span>{tip.text}</span>
        </div>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="stats__section">
      <h3 className="stats__heading">{title}</h3>
      {hint && <p className="stats__hint">{hint}</p>}
      {children}
    </section>
  );
}

interface Props {
  open: boolean;
  stats: TreeStats | null;
  onClose: () => void;
  onPick: (id: string) => void;
}

export const StatsPanel = forwardRef<HTMLElement, Props>(function StatsPanel({ open, stats, onClose, onPick }, ref) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus into the panel when it opens, so keyboard and screen-reader users land in it.
  useEffect(() => {
    if (open) headingRef.current?.focus({ preventScroll: true });
  }, [open]);

  return (
    <aside
      ref={ref}
      id="stats-panel"
      className={open ? 'stats stats--open' : 'stats'}
      aria-labelledby="stats-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="stats__header">
        <div>
          <h2 id="stats-title" ref={headingRef} tabIndex={-1} className="stats__title">Estadísticas</h2>
          {stats && (
            <p className="stats__sub">
              {stats.total} {stats.total === 1 ? 'persona' : 'personas'} en {stats.gender.byGeneration.length}{' '}
              {stats.gender.byGeneration.length === 1 ? 'generación' : 'generaciones'}
            </p>
          )}
        </div>
        <button type="button" className="stats__close" onClick={onClose} aria-label="Cerrar estadísticas">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M4 4 L14 14 M14 4 L4 14" />
          </svg>
        </button>
      </header>

      {stats && (
        <div className="stats__body">
          <Section title="Género">
            <GenderSection stats={stats} />
          </Section>
          <Section title="Apellidos más comunes" hint="Se cuenta el primer apellido de cada persona.">
            <RankingList ranking={stats.surnames} unit={['persona', 'personas']} onPick={onPick} />
          </Section>
          <Section title="Nombres más populares" hint="Se cuenta el primer nombre de cada persona.">
            <RankingList ranking={stats.firstNames} unit={['persona', 'personas']} onPick={onPick} />
          </Section>
          <Section title="Más hijos">
            <RankingList ranking={stats.mostChildren} unit={['hijo', 'hijos']} onPick={onPick} />
          </Section>
          <Section title="Más descendientes" hint="Hijos, nietos, bisnietos y así.">
            <RankingList ranking={stats.mostDescendants} unit={['descendiente', 'descendientes']} onPick={onPick} />
          </Section>
          <p className="stats__foot">Tocá un nombre para verlo en el árbol.</p>
        </div>
      )}
    </aside>
  );
});
