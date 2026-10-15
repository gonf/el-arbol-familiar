import type { FamilyTree, Person, Union } from './types';
import { isEnded } from './types';

export const CARD_W = 160;
export const CARD_H = 236;
const PARTNER_GAP = 48;
const CLUSTER_GAP = 72;
const ROW_GAP = 144;
const PAD = 72;
const PARTNER_LINE_Y = 80; // offset from card top, level with the middle of the photo
const BRIDGE_RISE = 22; // how far above the cards a non-adjacent partner line runs
const CORNER = 14; // radius of the rounded turns in connectors
const DROP_CLEARANCE = 8; // min space between a line coming down between partners and their cards
const BUS_SPACING = 12; // vertical distance between stacked children lines in one gap
const BUS_CLEARANCE = 16; // min horizontal space between children lines sharing a lane
const ITERATIONS = 8;
const MIDDLE_WEIGHT = 4; // how much more a straight line to an only or middle child counts
const PIN_WEIGHT = 100; // how much more a straight line to an only or middle child counts
const SEARCH_PASSES = 6;

export interface PlacedPerson {
  person: Person;
  /** Top-left corner. */
  x: number;
  y: number;
}

/** Drawing data for one union, enough to draw it whole or just the part along a lineage. */
export interface UnionGeometry {
  id: string;
  ended: boolean;
  partners: string[];
  children: string[];
  /** Line joining the two partners, or null for a single parent. */
  partnerD: string | null;
  /** Per partner: path from that partner to (dropX, startY). Empty for a single parent. */
  toDrop: Record<string, string>;
  dropX: number;
  startY: number;
  busY: number;
  childX: Record<string, number>;
  childTop: Record<string, number>;
}

/** A horizontal band behind one generation's row. */
export interface Band {
  y: number;
  height: number;
}

export interface Layout {
  people: PlacedPerson[];
  /** One per generation, top to bottom. */
  bands: Band[];
  unions: UnionGeometry[];
  width: number;
  height: number;
  /** child id → parent ids */
  parents: Map<string, string[]>;
  /** person id → child ids across all their unions */
  children: Map<string, string[]>;
  /** Remaining line crossings after optimisation (useful when tuning data). */
  crossings: number;
}

/** People joined by partnerships on the same row, drawn side by side (e.g. ex — person — current). */
interface Cluster {
  gen: number;
  members: string[];
  left: number;
}

const clusterWidth = (c: Cluster) => c.members.length * CARD_W + (c.members.length - 1) * PARTNER_GAP;

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Orders people linked by partnerships on one row.
 * Simple chains (ex — person — partner) keep their natural order. When someone has
 * 3+ partners, they go in the middle with the partners who share children placed
 * next to them; anyone who can't be adjacent is bridged over in the connectors.
 */
function orderPartners(
  component: string[],
  adj: Map<string, string[]>,
  unionsOf: Map<string, Union[]>,
): string[] {
  const degree = (id: string) => adj.get(id)?.length ?? 0;
  const walkFrom = (start: string, into: string[]) => {
    const visit = (id: string) => {
      if (into.includes(id)) return;
      into.push(id);
      (adj.get(id) ?? []).forEach(visit);
    };
    visit(start);
    return into;
  };

  if (component.every((id) => degree(id) <= 2)) {
    const start = component.find((id) => degree(id) <= 1) ?? component[0];
    return walkFrom(start, []);
  }

  const hub = component.reduce((best, id) => (degree(id) > degree(best) ? id : best));
  const kidsWith = (other: string) =>
    (unionsOf.get(hub) ?? [])
      .filter((u) => u.partners.includes(other))
      .reduce((n, u) => n + u.children.length, 0);
  const partners = [...adj.get(hub)!].sort((a, b) => kidsWith(b) - kidsWith(a));

  const left: string[] = [];
  const right: string[] = [];
  partners.forEach((id, i) => (i % 2 === 0 ? right : left).push(id));
  const ordered = [...left.reverse(), hub, ...right];
  // Anyone further out (a partner's other partner) joins at the end of the row.
  for (const id of component) if (!ordered.includes(id)) walkFrom(id, ordered);
  return ordered;
}

/** An orthogonal line through the given points, with softly rounded turns. */
function softPath(points: [number, number][]): string {
  const pts = points.filter(([x, y], i) => i === 0 || x !== points[i - 1][0] || y !== points[i - 1][1]);
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    const straight = (px === x && x === nx) || (py === y && y === ny);
    // Each turn may use at most half of either neighbouring segment, so turns never overlap.
    const r = Math.min(CORNER, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
    if (straight || r < 0.5) {
      d += ` L ${x} ${y}`;
      continue;
    }
    const ax = x - Math.sign(x - px) * r;
    const ay = y - Math.sign(y - py) * r;
    const bx = x + Math.sign(nx - x) * r;
    const by = y + Math.sign(ny - y) * r;
    d += ` L ${ax} ${ay} Q ${x} ${y} ${bx} ${by}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return `${d} L ${lx} ${ly}`;
}

/** Path from a union's drop point down to the given children. */
export function descentPath(g: UnionGeometry, childIds: string[]): string {
  return childIds
    .map((c) =>
      softPath([
        [g.dropX, g.startY],
        [g.dropX, g.busY],
        [g.childX[c], g.busY],
        [g.childX[c], g.childTop[c]],
      ]),
    )
    .join(' ');
}

/** The person plus all direct ancestors and descendants. */
export function lineageOf(layout: Layout, id: string): Set<string> {
  const set = new Set([id]);
  const walk = (links: Map<string, string[]>) => {
    const stack = [id];
    while (stack.length) {
      for (const next of links.get(stack.pop()!) ?? []) {
        if (set.has(next)) continue;
        set.add(next);
        stack.push(next);
      }
    }
  };
  walk(layout.parents);
  walk(layout.children);
  return set;
}

export interface Highlight {
  /** The selected person with their direct ancestors and descendants. */
  line: Set<string>;
  /**
   * Close family, in a lighter shade: children that the selected person's or their parents'
   * current partners had with someone else; the selected person's siblings (including
   * half-siblings) and all their descendants; and the current partner of anyone highlighted.
   */
  related: Set<string>;
}

export function highlightOf(layout: Layout, id: string): Highlight {
  const line = lineageOf(layout, id);
  const related = new Set<string>();
  const currentPartnersOf = (person: string) =>
    layout.unions
      .filter((g) => !g.ended && g.partners.length === 2 && g.partners.includes(person))
      .map((g) => g.partners.find((p) => p !== person)!);
  const add = (person: string) => {
    if (!line.has(person)) related.add(person);
  };

  // Children that the selected person's or their parents' current partners had with someone else
  // (step-siblings, step-children). Not for grandparents or anyone further along the line.
  for (const person of [id, ...(layout.parents.get(id) ?? [])])
    for (const partner of currentPartnersOf(person))
      if (!line.has(partner)) (layout.children.get(partner) ?? []).forEach(add);

  // The selected person's siblings (including half-siblings) and all their descendants.
  for (const parent of layout.parents.get(id) ?? [])
    for (const sibling of layout.children.get(parent) ?? []) {
      if (line.has(sibling)) continue;
      add(sibling);
      const seen = new Set([sibling]);
      const stack = [sibling];
      while (stack.length) {
        for (const c of layout.children.get(stack.pop()!) ?? []) {
          if (seen.has(c)) continue;
          seen.add(c);
          add(c);
          stack.push(c);
        }
      }
    }

  // Anyone highlighted brings their current partner along (one step, no further cascade).
  for (const person of [...line, ...related]) currentPartnersOf(person).forEach(add);

  return { line, related };
}

interface Segment { owner: number; x1: number; y1: number; x2: number; y2: number }

function countCrossings(segments: Segment[]): { count: number; owners: Set<number> } {
  const e = 0.5;
  const hs = segments.filter((s) => s.y1 === s.y2 && s.x2 - s.x1 > e);
  const vs = segments.filter((s) => s.x1 === s.x2 && s.y2 - s.y1 > e);
  let count = 0;
  const owners = new Set<number>();
  for (const h of hs)
    for (const v of vs)
      if (h.owner !== v.owner && v.x1 > h.x1 + e && v.x1 < h.x2 - e && h.y1 > v.y1 + e && h.y1 < v.y2 - e) {
        count++;
        owners.add(h.owner).add(v.owner);
      }
  return { count, owners };
}

const hSeg = (owner: number, xa: number, xb: number, y: number): Segment =>
  ({ owner, x1: Math.min(xa, xb), x2: Math.max(xa, xb), y1: y, y2: y });
const vSeg = (owner: number, x: number, ya: number, yb: number): Segment =>
  ({ owner, x1: x, x2: x, y1: Math.min(ya, yb), y2: Math.max(ya, yb) });

export function computeLayout(tree: FamilyTree, searchPasses = SEARCH_PASSES): Layout {
  const byId = new Map(tree.people.map((p) => [p.id, p]));
  const unions: Union[] = tree.unions
    .map((u) => ({
      ...u,
      partners: u.partners.filter((id) => byId.has(id)),
      children: u.children.filter((id) => byId.has(id)),
    }))
    .filter((u) => u.partners.length > 0);
  const unionsOf = new Map<string, Union[]>();
  const parentUnion = new Map<string, Union>();
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const u of unions) {
    for (const p of u.partners) {
      pushTo(unionsOf, p, u);
      u.children.forEach((c) => pushTo(children, p, c));
    }
    for (const c of u.children) {
      parentUnion.set(c, u);
      parents.set(c, [...u.partners]);
    }
  }

  // 1. Generations: partners share a row, children go one row down, parents one row up.
  const gen = new Map<string, number>();
  for (const start of tree.people) {
    if (gen.has(start.id)) continue;
    gen.set(start.id, 0);
    const queue = [start.id];
    while (queue.length) {
      const id = queue.shift()!;
      const g = gen.get(id)!;
      const visit = (other: string, og: number) => {
        if (!gen.has(other)) {
          gen.set(other, og);
          queue.push(other);
        }
      };
      for (const u of unionsOf.get(id) ?? []) {
        u.partners.forEach((p) => visit(p, g));
        u.children.forEach((c) => visit(c, g + 1));
      }
      const pu = parentUnion.get(id);
      if (pu) {
        pu.partners.forEach((p) => visit(p, g - 1));
        pu.children.forEach((c) => visit(c, g));
      }
    }
  }
  const minGen = Math.min(...gen.values());
  for (const [id, g] of gen) gen.set(id, g - minGen);
  const maxGen = Math.max(0, ...gen.values());

  // 2. Clusters: people linked by partnerships on the same row sit side by side.
  const partnerAdj = new Map<string, string[]>();
  for (const u of unions) {
    if (u.partners.length !== 2) continue;
    const [a, b] = u.partners;
    if (gen.get(a) !== gen.get(b)) continue;
    pushTo(partnerAdj, a, b);
    pushTo(partnerAdj, b, a);
  }
  const clusters: Cluster[] = [];
  const clusterOf = new Map<string, Cluster>();
  for (const p of tree.people) {
    if (clusterOf.has(p.id)) continue;
    const component = new Set<string>();
    const stack = [p.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (component.has(id)) continue;
      component.add(id);
      stack.push(...(partnerAdj.get(id) ?? []));
    }
    const members = orderPartners([...component], partnerAdj, unionsOf);
    const cluster: Cluster = { gen: gen.get(p.id)!, members, left: 0 };
    clusters.push(cluster);
    members.forEach((id) => clusterOf.set(id, cluster));
  }

  const rows: Cluster[][] = Array.from({ length: maxGen + 1 }, () => []);
  clusters.forEach((c) => rows[c.gen].push(c));

  // Index of each person within their cluster; refreshed whenever positions are recomputed.
  const memberIndex = new Map<string, number>();
  const reindex = () => clusters.forEach((c) => c.members.forEach((id, i) => memberIndex.set(id, i)));
  const centerX = (id: string) =>
    clusterOf.get(id)!.left + memberIndex.get(id)! * (CARD_W + PARTNER_GAP) + CARD_W / 2;
  const unionMid = (u: Union) =>
    u.partners.reduce((sum, id) => sum + centerX(id), 0) / u.partners.length;
  const clusterCenter = (c: Cluster) => c.left + clusterWidth(c) / 2;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const topOf = (id: string) => PAD + gen.get(id)! * (CARD_H + ROW_GAP);

  /**
   * Where a union's line comes down to its children, with its partners left to right.
   * `slack` is how far the line may slide sideways (between the partners, or under a single
   * parent's card) to come straight down to an only or middle child.
   */
  const dropOf = (union: Union) => {
    if (union.partners.length === 1) {
      const a = union.partners[0];
      return { a, b: null, hub: null, dropX: centerX(a), slack: CARD_W / 2 - 2 * CORNER };
    }
    const [a, b] = centerX(union.partners[0]) <= centerX(union.partners[1])
      ? union.partners
      : [union.partners[1], union.partners[0]];
    const adjacent =
      clusterOf.get(a) === clusterOf.get(b) && Math.abs(memberIndex.get(a)! - memberIndex.get(b)!) === 1;
    if (adjacent || gen.get(a) !== gen.get(b)) {
      const slack = adjacent ? PARTNER_GAP / 2 - DROP_CLEARANCE : 0;
      return { a, b, hub: null, dropX: (centerX(a) + centerX(b)) / 2, slack };
    }
    // Someone sits between these partners: the line bridges over the cards instead of behind them,
    // and drops to the children through the gap beside the outer partner.
    const degree = (id: string) => partnerAdj.get(id)?.length ?? 0;
    const hub = degree(a) >= degree(b) ? a : b;
    const other = hub === a ? b : a;
    const inward = centerX(hub) > centerX(other) ? 1 : -1;
    const dropX = centerX(other) + (inward * (CARD_W + PARTNER_GAP)) / 2;
    return { a, b, hub, dropX, slack: PARTNER_GAP / 2 - DROP_CLEARANCE };
  };

  const kidGroups = new Map(unions.map((u) => [u, [...new Set(u.children.map((id) => clusterOf.get(id)!))]]));
  const siblingOffsets = (u: Union) => {
    const group = kidGroups.get(u)!.sort((a, b) => a.left - b.left);
    const packed = new Map<Cluster, number>();
    let cursor = 0;
    for (const c of group) {
      packed.set(c, cursor);
      cursor += clusterWidth(c) + CLUSTER_GAP;
    }
    const xs = u.children
      .map((id) => packed.get(clusterOf.get(id)!)! + memberIndex.get(id)! * (CARD_W + PARTNER_GAP) + CARD_W / 2)
      .sort((a, b) => a - b);
    const anchor = (xs[(xs.length - 1) >> 1] + xs[xs.length >> 1]) / 2;
    const offsets = new Map<Cluster, number>();
    for (const c of group) offsets.set(c, packed.get(c)! + clusterWidth(c) / 2 - anchor);
    return offsets;
  };

  /**
   * Per union: the child whose line should come straight down from the parents (the only or
   * middle one), and the sibling offsets. Both only depend on the order within rows, so they're
   * refreshed when that might have changed.
   */
  const middles = new Map<Union, string | null>();
  const offsets = new Map<Union, Map<Cluster, number>>();
  const refreshOrder = () => {
    for (const u of unions) {
      const n = u.children.length;
      middles.set(u, n % 2 ? [...u.children].sort((a, b) => centerX(a) - centerX(b))[(n - 1) / 2] : null);
      if (n) offsets.set(u, siblingOffsets(u));
    }
  };
  const middleChild = (u: Union) => middles.get(u) ?? null;

  /**
   * Where each child's cluster sits relative to the parents' drop line when the siblings, side by
   * side in their current order, are centred under it: the middle child straight below for an
   * odd number, the two middle ones either side of it for an even number.
   */
  /**
   * Moves one row to where its families want it: each cluster sits in its slot under its parents,
   * and above the centre of its own children. That's a least-squares problem per row with
   * order and spacing constraints, solved exactly by pooling adjacent clusters that collide.
   * With `reorder`, clusters are first sorted by where they want to be. With `pin`, a line to an
   * only or middle child coming straight down outweighs everything else.
   */
  const settleRow = (row: Cluster[], reorder: boolean, pin = false) => {
    const sum = new Map<Cluster, number>();
    const weight = new Map<Cluster, number>();
    const want = (c: Cluster, center: number, w = 1) => {
      sum.set(c, (sum.get(c) ?? 0) + center * w);
      weight.set(c, (weight.get(c) ?? 0) + w);
    };
    // Nothing moves until the row is solved, so drop lines can be shared within one call.
    const dropXOf = new Map<Union, number>();
    const dropX = (u: Union) => {
      if (!dropXOf.has(u)) dropXOf.set(u, dropOf(u).dropX);
      return dropXOf.get(u)!;
    };
    for (const c of row) {
      const seen = new Set<Union>();
      for (const id of c.members) {
        const pu = parentUnion.get(id);
        if (pu && middleChild(pu) === id)
          want(c, dropX(pu) + clusterCenter(c) - centerX(id), pin ? PIN_WEIGHT : MIDDLE_WEIGHT);
        else if (pu) want(c, dropX(pu) + offsets.get(pu)!.get(c)!);
        for (const u of unionsOf.get(id) ?? []) {
          if (seen.has(u) || !u.children.length) continue;
          seen.add(u);
          const fromDrop = clusterCenter(c) - dropX(u);
          for (const [k, off] of offsets.get(u)!) want(c, clusterCenter(k) - off + fromDrop);
          const m = middleChild(u);
          if (m) want(c, centerX(m) + fromDrop, MIDDLE_WEIGHT);
        }
      }
    }
    const desired = (c: Cluster) => (weight.has(c) ? sum.get(c)! / weight.get(c)! : clusterCenter(c));
    const list = reorder ? [...row].sort((a, b) => desired(a) - desired(b)) : row;

    // Shift each cluster by the room the ones before it take up, so the constraints become
    // "never left of the previous one"; then merge neighbours that break it into one block.
    const blocks: { start: number; w: number; mean: number }[] = [];
    let shift = 0;
    const shifts = list.map((c) => {
      const s = shift;
      shift += clusterWidth(c) + CLUSTER_GAP;
      return s;
    });
    list.forEach((c, i) => {
      const w = weight.get(c) ?? 1e-3;
      let block = { start: i, w, mean: desired(c) - clusterWidth(c) / 2 - shifts[i] };
      while (blocks.length && blocks[blocks.length - 1].mean >= block.mean) {
        const prev = blocks.pop()!;
        const total = prev.w + block.w;
        block = { start: prev.start, w: total, mean: (prev.mean * prev.w + block.mean * block.w) / total };
      }
      blocks.push(block);
    });
    blocks.forEach((b, j) => {
      const end = j + 1 < blocks.length ? blocks[j + 1].start : list.length;
      for (let i = b.start; i < end; i++) list[i].left = b.mean + shifts[i];
    });
    if (reorder) row.sort((a, b) => a.left - b.left);
  };

  const pack = (row: Cluster[]) => {
    let cursor = 0;
    for (const c of row) {
      c.left = cursor;
      cursor += clusterWidth(c) + CLUSTER_GAP;
    }
  };

  const isStraight = (u: Union) => {
    const m = middleChild(u);
    if (!m) return true;
    const { dropX, slack } = dropOf(u);
    return Math.abs(centerX(m) - dropX) <= slack + 0.5;
  };
  /** Unions whose lines move when a cluster moves: to its parents and to its children. */
  const linesOf = (c: Cluster) => [
    ...new Set(c.members.flatMap((id) => [parentUnion.get(id), ...(unionsOf.get(id) ?? [])]).filter((u) => !!u)),
  ] as Union[];

  /**
   * Moves a cluster within the room its row neighbours leave, to wherever `target` wants it,
   * as long as no line that's already straight gets bent. Returns whether it moved.
   */
  const nudge = (row: Cluster[], i: number, target: (c: Cluster) => number | null) => {
    const c = row[i];
    const ideal = target(c);
    if (ideal === null) return false;
    const lo = i > 0 ? row[i - 1].left + clusterWidth(row[i - 1]) + CLUSTER_GAP : -Infinity;
    const hi = i + 1 < row.length ? row[i + 1].left - CLUSTER_GAP - clusterWidth(c) : Infinity;
    if (ideal < lo - 0.5 || ideal > hi + 0.5) return false;
    const lines = linesOf(c);
    const straight = lines.filter(isStraight);
    const before = c.left;
    c.left = ideal;
    if (straight.every(isStraight) && lines.filter(isStraight).length > straight.length) return true;
    c.left = before;
    return false;
  };

  /**
   * Slides families the last bit so the line to an only or middle child comes straight down,
   * wherever the neighbours leave room: children under their parents (top-down, so a moved
   * family's children follow next), then parents over their children (bottom-up).
   */
  const straighten = () => {
    const sorted = (g: number) => [...rows[g]].sort((a, b) => a.left - b.left);
    const underParents = (c: Cluster) => {
      for (const id of c.members) {
        const u = parentUnion.get(id);
        if (u && middleChild(u) === id && !isStraight(u)) return c.left + dropOf(u).dropX - centerX(id);
      }
      return null;
    };
    const overChildren = (c: Cluster) => {
      for (const id of c.members)
        for (const u of unionsOf.get(id) ?? []) {
          const m = middleChild(u);
          if (m && !isStraight(u)) return c.left + centerX(m) - dropOf(u).dropX;
        }
      return null;
    };
    for (let round = 0; round < 2; round++) {
      for (let g = 1; g <= maxGen; g++) {
        const row = sorted(g);
        row.forEach((_, i) => nudge(row, i, underParents));
      }
      for (let g = maxGen - 1; g >= 0; g--) {
        const row = sorted(g);
        row.forEach((_, i) => nudge(row, i, overChildren));
      }
    }
  };

  /** Computes x positions, keeping each row's order unless `reorder` is set. */
  const relax = (reorder: boolean) => {
    reindex();
    rows.forEach(pack);
    // Without `reorder` rows keep their order, so what depends on it only needs working out once.
    refreshOrder();
    const settle = (g: number) => {
      settleRow(rows[g], reorder);
      if (reorder) refreshOrder();
    };
    for (let i = 0; i < ITERATIONS; i++) {
      for (let g = 0; g <= maxGen; g++) settle(g);
      for (let g = maxGen; g >= 0; g--) settle(g);
    }
    for (let g = 1; g <= maxGen; g++) settleRow(rows[g], reorder, true);
    straighten();
  };

  interface Plan {
    union: Union;
    top: number;
    /** Partners left to right, or a single parent. */
    a: string;
    b: string | null;
    /** Set when the partners aren't adjacent and the line bridges over the cards. */
    hub: string | null;
    dropX: number;
    startY: number;
    busY: number;
  }

  /** Works out where every connector goes (numbers only) and scores the result. */
  const planConnectors = () => {
    const plans: Plan[] = unions.map((union) => {
      const top = topOf(union.partners[0]);
      const { a, b, hub, dropX: midX, slack } = dropOf(union);
      const m = middleChild(union);
      const off = m ? centerX(m) - midX : 0;
      const dropX = Math.abs(off) <= slack + 0.5 ? midX + off : midX;
      const startY = !b ? top + CARD_H : hub ? top - BRIDGE_RISE : top + PARTNER_LINE_Y;
      return { union, top, a, b, hub, dropX, startY, busY: 0 };
    });

    // Children lines in the same gap get separate lanes wherever they would overlap.
    for (let g = 0; g <= maxGen; g++) {
      const inRow = plans
        .filter((pl) => gen.get(pl.a) === g && pl.union.children.length)
        .map((pl) => {
          const xs = pl.union.children.map(centerX);
          return { pl, lo: Math.min(pl.dropX, ...xs), hi: Math.max(pl.dropX, ...xs) };
        })
        .sort((p, q) => p.lo - q.lo);
      const laneEnds: number[] = [];
      const lanes = inRow.map(({ lo, hi }) => {
        let lane = laneEnds.findIndex((end) => end + BUS_CLEARANCE < lo);
        if (lane < 0) lane = laneEnds.push(hi) - 1;
        else laneEnds[lane] = hi;
        return lane;
      });
      const spacing = Math.min(BUS_SPACING, (ROW_GAP - 48) / Math.max(1, laneEnds.length - 1));
      inRow.forEach(({ pl }, i) => {
        pl.busY = pl.top + CARD_H + ROW_GAP / 2 + (lanes[i] - (laneEnds.length - 1) / 2) * spacing;
      });
    }

    const segments: Segment[] = [];
    let span = 0;
    plans.forEach((pl, i) => {
      if (pl.b) {
        const ax = centerX(pl.a);
        const bx = centerX(pl.b);
        if (pl.hub) segments.push(vSeg(i, ax, pl.top, pl.startY), vSeg(i, bx, pl.top, pl.startY));
        segments.push(hSeg(i, ax, bx, pl.startY));
      }
      if (!pl.union.children.length) return;
      segments.push(vSeg(i, pl.dropX, pl.startY, pl.busY));
      for (const c of pl.union.children) {
        const cx = centerX(c);
        segments.push(hSeg(i, pl.dropX, cx, pl.busY), vSeg(i, cx, pl.busY, topOf(c)));
        span += Math.abs(cx - pl.dropX);
      }
    });
    const { count, owners } = countCrossings(segments);
    return { plans, crossings: count, crossingUnions: owners, span };
  };

  /** Turns plans into drawable paths. */
  const draw = (plans: Plan[]): UnionGeometry[] =>
    plans.map(({ union, top, a, b, hub, dropX, startY, busY }) => {
      const toDrop: Record<string, string> = {};
      let partnerD: string | null = null;
      if (!b) {
        toDrop[a] = '';
      } else if (hub) {
        const other = hub === a ? b : a;
        const hx = centerX(hub);
        const ox = centerX(other);
        partnerD = softPath([[hx, top], [hx, startY], [ox, startY], [ox, top]]);
        toDrop[hub] = softPath([[hx, top], [hx, startY], [dropX, startY]]);
        toDrop[other] = softPath([[ox, top], [ox, startY], [dropX, startY]]);
      } else {
        const ax = centerX(a) + CARD_W / 2;
        const bx = centerX(b) - CARD_W / 2;
        partnerD = `M ${ax} ${startY} H ${bx}`;
        toDrop[a] = `M ${ax} ${startY} H ${dropX}`;
        toDrop[b] = `M ${bx} ${startY} H ${dropX}`;
      }
      const childX: Record<string, number> = {};
      const childTop: Record<string, number> = {};
      for (const c of union.children) {
        childX[c] = centerX(c);
        childTop[c] = topOf(c);
      }
      return {
        id: union.id, ended: isEnded(union), partners: union.partners, children: union.children,
        partnerD, toDrop, dropX, startY, busY, childX, childTop,
      };
    });

  const score = () => {
    relax(false);
    const { crossings, span } = planConnectors();
    return crossings * 1e6 + span;
  };

  /** Re-sorts every row below `g` under its parents, so a moved family takes its descendants along. */
  const reflowBelow = (g: number) => {
    reindex();
    rows.forEach(pack);
    for (let h = g + 1; h <= maxGen; h++) {
      const key = new Map<Cluster, number>();
      for (const c of rows[h]) {
        const xs = c.members.filter((id) => parentUnion.has(id)).map((id) => unionMid(parentUnion.get(id)!));
        key.set(c, xs.length ? avg(xs) : clusterCenter(c));
      }
      rows[h].sort((a, b) => key.get(a)! - key.get(b)!);
      pack(rows[h]);
    }
  };

  // 3. Rough order from barycenters, then a local search that swaps neighbours and flips
  //    couples whenever that removes crossings (or, at equal crossings, shortens lines).
  relax(true);
  rows.forEach((row) => row.sort((a, b) => a.left - b.left));
  let best = score();

  /** Applies a move; keeps it if the layout improves, otherwise restores the previous order. */
  const attempt = (g: number, move: () => void, reflow: boolean) => {
    const snapshot = rows.map((row) => row.map((c): [Cluster, string[]] => [c, [...c.members]]));
    move();
    if (reflow) reflowBelow(g);
    const s = score();
    if (s < best - 0.5) {
      best = s;
      return true;
    }
    snapshot.forEach((row, h) => {
      rows[h] = row.map(([c, members]) => {
        c.members = members;
        return c;
      });
    });
    return false;
  };

  // Reflowing the rows below only matters when a moved cluster has descendants.
  const hasKids = (c: Cluster) => c.members.some((id) => children.has(id));

  for (let pass = 0; pass < searchPasses; pass++) {
    let improved = false;
    rows.forEach((_, g) => {
      for (let i = 0; i < rows[g].length; i++) {
        const c = rows[g][i];
        if (c.members.length > 1) {
          const flip = () => c.members.reverse();
          improved = attempt(g, flip, false) || (hasKids(c) && attempt(g, flip, true)) || improved;
        }
        if (i + 1 < rows[g].length) {
          const next = rows[g][i + 1];
          const swap = () => {
            const row = rows[g];
            [row[i], row[i + 1]] = [row[i + 1], row[i]];
          };
          improved =
            attempt(g, swap, false) || ((hasKids(c) || hasKids(next)) && attempt(g, swap, true)) || improved;
        }
      }
    });
    if (!improved) break;
  }

  // 4. Knots that need a family to jump several places: for clusters involved in a remaining
  //    crossing, try every position in their row (with and without reflowing descendants).
  for (let round = 0; round < searchPasses * 2; round++) {
    relax(false);
    const { crossingUnions } = planConnectors();
    if (!crossingUnions.size) break;
    const candidates = new Set<Cluster>();
    crossingUnions.forEach((i) =>
      [...unions[i].partners, ...unions[i].children].forEach((id) => candidates.add(clusterOf.get(id)!)),
    );
    let improved = false;
    for (const c of candidates) {
      const g = c.gen;
      for (let j = 0; j < rows[g].length && !improved; j++) {
        if (rows[g].indexOf(c) === j) continue;
        const move = () => {
          const row = rows[g];
          row.splice(row.indexOf(c), 1);
          row.splice(j, 0, c);
        };
        improved = attempt(g, move, false) || (hasKids(c) && attempt(g, move, true));
      }
      if (improved) break;
    }
    if (!improved) break;
  }
  relax(false);

  // 5. Normalize to positive coordinates and build the final geometry.
  const minLeft = Math.min(...clusters.map((c) => c.left));
  clusters.forEach((c) => (c.left += PAD - minLeft));
  const { plans, crossings } = planConnectors();
  const geoms = draw(plans);
  const width = Math.max(...clusters.map((c) => c.left + clusterWidth(c))) + PAD;
  const height = PAD * 2 + (maxGen + 1) * CARD_H + maxGen * ROW_GAP;

  const people: PlacedPerson[] = tree.people.map((person) => ({
    person,
    x: centerX(person.id) - CARD_W / 2,
    y: topOf(person.id),
  }));
  const bands: Band[] = rows.map((_, g) => ({
    y: PAD + g * (CARD_H + ROW_GAP) - ROW_GAP / 2,
    height: CARD_H + ROW_GAP,
  }));

  return { people, bands, unions: geoms, width, height, parents, children, crossings };
}
