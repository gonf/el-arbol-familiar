import type { Layout } from './layout';
import type { FamilyTree, Gender, Person } from './types';

const TOP = 5;

/** One row of a ranking. People rankings list who the row is about, so the names can link to the tree. */
export interface RankRow {
  key: string;
  label: string;
  value: number;
  people?: Person[];
}

export interface Ranking {
  rows: RankRow[];
  /** Rows beyond the top five that tie with the fifth one. */
  moreTied: number;
}

export type GenderKey = Gender | 'unknown';
export type GenderCounts = Record<GenderKey, number>;

export interface TreeStats {
  total: number;
  surnames: Ranking;
  firstNames: Ranking;
  mostChildren: Ranking;
  mostDescendants: Ranking;
  gender: { total: GenderCounts; byGeneration: GenderCounts[] };
}

/** Compare names ignoring accents and case, so "Maria" and "María" count together. */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const accents = (s: string) => s.normalize('NFD').length - s.length;

/** Words that belong to the surname that follows them ("Di Giovanni", "de la Torre"). */
const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'di', 'da', 'dos', 'du', 'van', 'von', 'le']);

/** First surname of a (possibly double) Spanish surname: "Seoane Fernández" → "Seoane". */
export function firstSurname(lastName: string): string {
  const words = lastName.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    out.push(w);
    if (!PARTICLES.has(fold(w))) break;
  }
  return out.join(' ');
}

/** First given name, skipping initials: "María de los Angeles" → "María", "Juan I." → "Juan". */
export function firstGivenName(firstName: string): string {
  return firstName.trim().split(/\s+/).find((w) => w && !w.endsWith('.')) ?? '';
}

/** Counts names by their accent-free form, labelled with the most used spelling (accented on a tie). */
function nameRanking(names: string[]): Ranking {
  const groups = new Map<string, Map<string, number>>();
  for (const name of names) {
    if (!name) continue;
    const spellings = groups.get(fold(name)) ?? new Map<string, number>();
    spellings.set(name, (spellings.get(name) ?? 0) + 1);
    groups.set(fold(name), spellings);
  }
  const rows = [...groups].map(([key, spellings]) => {
    const [label] = [...spellings].sort((a, b) => b[1] - a[1] || accents(b[0]) - accents(a[0]))[0];
    const value = [...spellings.values()].reduce((a, b) => a + b, 0);
    return { key, label, value };
  });
  return rank(rows.filter((r) => r.value > 1));
}

function rank(rows: RankRow[]): Ranking {
  rows.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'es'));
  const shown = rows.slice(0, TOP);
  const last = shown[shown.length - 1];
  const moreTied = last ? rows.slice(TOP).filter((r) => r.value === last.value).length : 0;
  return { rows: shown, moreTied };
}

const displayName = (p: Person) => [p.firstName, p.lastName].filter(Boolean).join(' ');

/**
 * Ranks people by the size of a set (their children, descendants). People who share the exact
 * same set, like a couple sharing their children, become one row.
 */
function peopleRanking(people: Person[], setOf: (id: string) => Set<string>): Ranking {
  const groups = new Map<string, Person[]>();
  for (const p of people) {
    const set = setOf(p.id);
    if (!set.size) continue;
    const key = [...set].sort().join('|');
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const rows = [...groups].map(([key, members]) => ({
    key,
    label: members.map(displayName).join(' y '),
    value: key.split('|').length,
    people: members,
  }));
  return rank(rows);
}

export function computeStats(tree: FamilyTree, layout: Layout): TreeStats {
  const { children } = layout;
  const childrenOf = (id: string) => new Set(children.get(id) ?? []);

  const descendantsOf = (id: string) => {
    const out = new Set<string>();
    const stack = [id];
    while (stack.length)
      for (const c of children.get(stack.pop()!) ?? [])
        if (!out.has(c)) {
          out.add(c);
          stack.push(c);
        }
    return out;
  };

  const empty = (): GenderCounts => ({ female: 0, male: 0, other: 0, unknown: 0 });
  const rows = [...new Set(layout.people.map((p) => p.y))].sort((a, b) => a - b);
  const generationOf = new Map(layout.people.map((p) => [p.person.id, rows.indexOf(p.y)]));
  const total = empty();
  const byGeneration = rows.map(empty);
  for (const p of tree.people) {
    const key: GenderKey = p.gender ?? 'unknown';
    total[key]++;
    byGeneration[generationOf.get(p.id) ?? 0][key]++;
  }

  return {
    total: tree.people.length,
    surnames: nameRanking(tree.people.map((p) => firstSurname(p.lastName))),
    firstNames: nameRanking(tree.people.map((p) => firstGivenName(p.firstName))),
    mostChildren: peopleRanking(tree.people, childrenOf),
    mostDescendants: peopleRanking(tree.people, descendantsOf),
    gender: { total, byGeneration },
  };
}
