import { forwardRef, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Layout, UnionGeometry } from '../layout';
import { CARD_H, CARD_W, descentPath } from '../layout';
import type { Person } from '../types';
import { fullName } from '../types';
import { initials, resolvePhoto } from './PersonCard';

type Mode = 'tree' | 'list';
const PAGE_CHOICES = [1, 2, 3];

const PHOTO_TIMEOUT = 8000; // don't hold the print dialog back forever for a slow photo
const PHOTO_PX = 320; // print resolution of a photo: sharp at any sensible size, small in a PDF

type Photos = Map<string, string>;

/**
 * Loads every photo up front so none is missing from the printout, as small square JPEGs:
 * browsers store images in a PDF uncompressed unless they're JPEGs, which made it huge.
 * A photo that can't be converted (another site's, without permission) is used as is.
 */
function preparePhotos(people: Person[]): Promise<Photos> {
  const photos: Photos = new Map();
  const loads = people
    .filter((p) => p.photo)
    .map(
      (p) =>
        new Promise<void>((resolve) => {
          const src = resolvePhoto(p.photo!);
          photos.set(p.id, src);
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onerror = () => resolve();
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = canvas.height = PHOTO_PX;
              const side = Math.min(img.naturalWidth, img.naturalHeight);
              canvas.getContext('2d')!.drawImage(
                img,
                (img.naturalWidth - side) / 2,
                (img.naturalHeight - side) / 2,
                side,
                side,
                0,
                0,
                PHOTO_PX,
                PHOTO_PX,
              );
              photos.set(p.id, canvas.toDataURL('image/jpeg', 0.85));
            } catch {
              // Keep the original.
            }
            resolve();
          };
          img.src = src;
        }),
    );
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, PHOTO_TIMEOUT));
  return Promise.race([Promise.all(loads), timeout]).then(() => photos);
}

interface Props {
  title: string;
  layout: Layout;
}

/** The "Imprimir" button, the dialog to pick a format, and the page that actually gets printed. */
export function PrintMenu({ title, layout }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [photos, setPhotos] = useState<Photos | null>(null);
  const [pages, setPages] = useState(1);
  const preparing = mode === 'tree' && !photos;

  // Photos first for the tree, then the chosen version goes on the page and the print dialog
  // opens. The printout is taken down again when the dialog closes.
  useEffect(() => {
    if (mode !== 'tree') return;
    let cancelled = false;
    preparePhotos(layout.people.map((p) => p.person)).then((ready) => !cancelled && setPhotos(ready));
    return () => {
      cancelled = true;
    };
  }, [mode, layout]);

  const showing = mode === 'list' || (mode === 'tree' && photos);
  useEffect(() => {
    if (!showing) return;
    let cancelled = false;
    const done = () => {
      setMode(null);
      setPhotos(null);
    };
    window.addEventListener('afterprint', done);
    // Wait for the page to lay out the printout (and for its fonts) before printing.
    document.fonts.ready.then(() => requestAnimationFrame(() => !cancelled && window.print()));
    return () => {
      cancelled = true;
      window.removeEventListener('afterprint', done);
    };
  }, [showing]);

  const choose = (next: Mode) => {
    dialogRef.current?.close();
    setMode(next);
  };

  return (
    <>
      <button
        type="button"
        className="tool-btn"
        aria-haspopup="dialog"
        disabled={preparing}
        onClick={() => dialogRef.current?.showModal()}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path d="M5 6.5V2.5h8v4 M5 13H3.5A1.5 1.5 0 0 1 2 11.5v-3A2 2 0 0 1 4 6.5h10a2 2 0 0 1 2 2v3a1.5 1.5 0 0 1-1.5 1.5H13 M5 10.5h8v5H5z" />
        </svg>
        <span className="tool-btn__text">{preparing ? 'Preparando…' : 'Imprimir'}</span>
      </button>

      <PrintDialog ref={dialogRef} onChoose={choose} pages={pages} onPages={setPages} />

      {showing &&
        createPortal(
          <div className="print-sheet" aria-hidden="true">
            <style>{mode === 'tree' ? '@page { size: landscape; margin: 10mm; }' : '@page { size: portrait; margin: 16mm 14mm; }'}</style>
            {mode === 'tree' ? (
              <PrintTree title={title} layout={layout} photos={photos!} pages={pages} />
            ) : (
              <PrintList title={title} layout={layout} />
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

interface DialogProps {
  onChoose: (mode: Mode) => void;
  /** How many pages wide the tree with photos prints. */
  pages: number;
  onPages: (pages: number) => void;
}

const PrintDialog = forwardRef<HTMLDialogElement, DialogProps>(function PrintDialog({ onChoose, pages, onPages }, ref) {
  const close = (e: React.MouseEvent<HTMLDialogElement>) => {
    // A click on the backdrop lands on the dialog itself.
    if (e.target === e.currentTarget) e.currentTarget.close();
  };
  return (
    <dialog ref={ref} className="dialog print-dialog" aria-labelledby="print-dialog-title" onClick={close}>
      <div className="print-dialog__body">
        <div className="print-dialog__header">
          <div>
            <h2 id="print-dialog-title" className="print-dialog__title">Imprimir el árbol</h2>
            <p className="print-dialog__sub">Se abre el diálogo de impresión, donde también podés guardarlo como PDF.</p>
          </div>
          <form method="dialog">
            <button className="stats__close" aria-label="Cerrar">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" /></svg>
            </button>
          </form>
        </div>
        <div className="print-dialog__options">
          <div className="print-choice">
            <button type="button" className="print-option" onClick={() => onChoose('tree')}>
              <svg className="print-option__art" viewBox="0 0 120 72" aria-hidden="true">
                <path d="M54 21 H66 M60 21 V36 M36 42 V36 H84 V42" className="print-option__line" />
                <rect x="36" y="10" width="18" height="22" rx="3.5" className="print-option__card" />
                <rect x="66" y="10" width="18" height="22" rx="3.5" className="print-option__card" />
                <rect x="27" y="42" width="18" height="22" rx="3.5" className="print-option__card" />
                <rect x="75" y="42" width="18" height="22" rx="3.5" className="print-option__card" />
                <rect x="39" y="13" width="12" height="10" rx="2" className="print-option__photo" />
                <rect x="69" y="13" width="12" height="10" rx="2" className="print-option__photo" />
                <rect x="30" y="45" width="12" height="10" rx="2" className="print-option__photo" />
                <rect x="78" y="45" width="12" height="10" rx="2" className="print-option__photo" />
              </svg>
              <span className="print-option__name">Árbol con fotos</span>
              <span className="print-option__text">Como en pantalla, sobre fondo blanco para ahorrar tinta.</span>
            </button>
            <div className="print-pages" role="radiogroup" aria-label="Ancho del árbol con fotos">
              <span className="print-pages__label">Ancho</span>
              {PAGE_CHOICES.map((n) => (
                <label key={n} className="print-pages__choice">
                  <input
                    type="radio"
                    name="print-pages"
                    value={n}
                    checked={pages === n}
                    onChange={() => onPages(n)}
                  />
                  <span>{n === 1 ? '1 página' : `${n} páginas`}</span>
                </label>
              ))}
            </div>
          </div>
          <button type="button" className="print-option" onClick={() => onChoose('list')}>
            <svg className="print-option__art" viewBox="0 0 120 72" aria-hidden="true">
              <path d="M30 18 V58 M30 34 H42 M30 58 H42 M52 42 V50 H62" className="print-option__line" />
              <path d="M42 31 L46 34 L42 37z M42 55 L46 58 L42 61z M62 47 L66 50 L62 53z" className="print-option__arrow" />
              <rect x="24" y="8" width="56" height="7" rx="3.5" className="print-option__text-bar" />
              <rect x="50" y="30" width="44" height="7" rx="3.5" className="print-option__text-bar" />
              <rect x="70" y="46" width="30" height="7" rx="3.5" className="print-option__text-bar" />
              <rect x="50" y="54" width="38" height="7" rx="3.5" className="print-option__text-bar" />
            </svg>
            <span className="print-option__name">Lista de nombres</span>
            <span className="print-option__text">Un esquema vertical con flechas, solo con los nombres.</span>
          </button>
        </div>
      </div>
    </dialog>
  );
});

// Min space between a page edge and the nearest card: more than half the gap between partners,
// so a couple is never split across pages.
const CUT_CLEARANCE = 28;

/** One page's share of the tree: per generation row, the x range it covers. */
interface Slice {
  left: number[];
  right: number[];
}

/**
 * Splits the tree into pages side by side, near equal widths. Each row is cut in the gap between
 * cards closest to the even split, so nobody is cut in half; the page edge steps from row to row.
 */
function pageSlices(layout: Layout, pages: number): Slice[] {
  const rowOf = (y: number) => layout.bands.findIndex((b) => y >= b.y && y < b.y + b.height);
  const spans = layout.bands.map(() => [] as [number, number][]);
  for (const p of layout.people) spans[rowOf(p.y)]?.push([p.x - CUT_CLEARANCE, p.x + CARD_W + CUT_CLEARANCE]);
  const cutRow = (row: [number, number][], target: number) => {
    if (!row.some(([a, b]) => target > a && target < b)) return target;
    const sorted = [...row].sort((p, q) => p[0] - q[0]);
    const options = [sorted[0][0], sorted[sorted.length - 1][1]];
    for (let i = 1; i < sorted.length; i++)
      if (sorted[i][0] > sorted[i - 1][1]) options.push((sorted[i - 1][1] + sorted[i][0]) / 2);
    return options.reduce((best, x) => (Math.abs(x - target) < Math.abs(best - target) ? x : best));
  };
  const edges = [layout.bands.map(() => 0)];
  for (let k = 1; k < pages; k++) edges.push(spans.map((row) => cutRow(row, (layout.width * k) / pages)));
  edges.push(layout.bands.map(() => layout.width));
  return edges.slice(1).map((right, i) => ({ left: edges[i], right }));
}

/**
 * The tree as on screen, on plain white, drawn as a picture that scales to fit the page; or
 * spread over several pages side by side, all at the same scale so they can be put together.
 */
function PrintTree({ title, layout, photos, pages }: Props & { photos: Photos; pages: number }) {
  const slices = pageSlices(layout, pages);
  const extent = (s: Slice) => [Math.min(...s.left), Math.max(...s.right)];
  const sliceW = Math.max(...slices.map((s) => extent(s)[1] - extent(s)[0]));
  return (
    <>
      {slices.map((slice, i) => (
        <div key={i} className="print-tree">
          <h1 className="print-sheet__title">
            {title}
            {pages > 1 && <span className="print-sheet__page"> · {i + 1} de {pages}</span>}
          </h1>
          <svg
            className="print-tree__svg"
            viewBox={`${extent(slice)[0]} 0 ${sliceW} ${layout.height}`}
            preserveAspectRatio={pages > 1 ? 'xMinYMin meet' : 'xMidYMin meet'}
          >
            <TreeDrawing layout={layout} photos={photos} id={`print-page-${i}`} slice={slice} />
          </svg>
        </div>
      ))}
    </>
  );
}

/** The lines and cards in one page's share of the tree, clipped to its stepped outline. */
function TreeDrawing({ layout, photos, id, slice }: { layout: Layout; photos: Photos; id: string; slice: Slice }) {
  const photo = CARD_W - 16;
  // Each row's band runs from its own top to the next one's; the first and last reach the edges.
  const bandTop = (i: number) => (i === 0 ? 0 : layout.bands[i].y);
  const bandBottom = (i: number) => (i === layout.bands.length - 1 ? layout.height : layout.bands[i + 1].y);
  const outline = [
    ...layout.bands.flatMap((_, i) => [`${slice.right[i]},${bandTop(i)}`, `${slice.right[i]},${bandBottom(i)}`]),
    ...layout.bands.flatMap((_, i) => [`${slice.left[i]},${bandTop(i)}`, `${slice.left[i]},${bandBottom(i)}`]).reverse(),
  ].join(' ');
  const rowOf = (y: number) => layout.bands.findIndex((b) => y >= b.y && y < b.y + b.height);
  const onPage = (x: number, y: number) => {
    const row = rowOf(y);
    return x >= slice.left[row] && x < slice.right[row];
  };
  return (
    <>
      <defs>
        <clipPath id={`${id}-photo`} clipPathUnits="objectBoundingBox">
          <rect width="1" height="1" rx="0.1" />
        </clipPath>
        <clipPath id={`${id}-slice`}>
          <polygon points={outline} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-slice)`}>
        {layout.unions.map((g) => (
          <Fragment key={g.id}>
            {g.partnerD && <path d={g.partnerD} className={g.ended ? 'pt-line pt-line--ended' : 'pt-line pt-line--partner'} />}
            {g.children.length > 0 && <path d={descentPath(g, g.children)} className="pt-line" />}
            {g.partners.length === 2 && g.children.length > 0 && (
              <circle cx={g.dropX} cy={g.startY} r={4.5} className="pt-node" />
            )}
          </Fragment>
        ))}
        {/* Only this page's cards, so each photo goes into the PDF once. */}
        {layout.people.filter(({ x, y }) => onPage(x + CARD_W / 2, y)).map(({ person, x, y }) => {
          return (
            <g key={person.id} transform={`translate(${x} ${y})`}>
              <rect width={CARD_W} height={CARD_H} rx={22} className="pt-card" />
              {photos.has(person.id) ? (
                <image
                  href={photos.get(person.id)}
                  x={8}
                  y={8}
                  width={photo}
                  height={photo}
                  preserveAspectRatio="xMidYMid slice"
                  clipPath={`url(#${id}-photo)`}
                />
              ) : (
                <>
                  <rect x={8} y={8} width={photo} height={photo} rx={15} className="pt-blank" />
                  <text x={CARD_W / 2} y={8 + photo / 2} className="pt-initials">{initials(person)}</text>
                </>
              )}
              <foreignObject x={8} y={photo + 12} width={photo} height={CARD_H - photo - 16}>
                <div className="pt-name">{fullName(person)}</div>
              </foreignObject>
            </g>
          );
        })}
      </g>
    </>
  );
}

interface ListUnion {
  partner: string | null;
  ended: boolean;
  children: ListEntry[];
  /** When the children are already listed under the other partner. */
  listedUnder: string | null;
  /** The partner's own family (parents, siblings, other children), when it isn't listed elsewhere. */
  origins: ListEntry[];
}
interface ListEntry {
  id: string;
  unions: ListUnion[];
  /** Starts one of the family's branches: an oldest couple, with nobody above them in the tree. */
  branch?: boolean;
}

/**
 * Turns the tree into an outline: the biggest family starts from its oldest couple, and everyone
 * is listed once, under their parents. Someone who married in brings their own family along,
 * listed right below where they first appear. A couple's children are listed under the first of
 * the two to come up; under the other one there's a pointer instead.
 */
function buildOutline(layout: Layout): ListEntry[] {
  const pos = new Map(layout.people.map((p) => [p.person.id, p]));
  const byPlace = (a: string, b: string) => pos.get(a)!.y - pos.get(b)!.y || pos.get(a)!.x - pos.get(b)!.x;
  const unionsOf = new Map<string, UnionGeometry[]>();
  for (const g of layout.unions) for (const p of g.partners) unionsOf.set(p, [...(unionsOf.get(p) ?? []), g]);
  const hasParents = (id: string) => layout.parents.has(id);
  const partnerOf = (g: UnionGeometry, id: string) => g.partners.find((p) => p !== id) ?? null;
  const isRoot = (id: string) =>
    !hasParents(id) && (unionsOf.get(id) ?? []).every((g) => g.partners.every((p) => !hasParents(p)));

  const shown = new Set<string>(); // listed, on their own line or as someone's partner
  const entered = new Set<string>(); // listed on their own line
  const expandedUnder = new Map<string, string>();

  // Of an oldest couple, the one whose surname the children carry heads the family.
  const lastName = (id: string) => pos.get(id)!.person.lastName;
  const carriedBy = (id: string) =>
    (unionsOf.get(id) ?? []).reduce((n, g) => n + g.children.filter((c) => lastName(c) === lastName(id)).length, 0);
  const head = (id: string) => {
    const partners = (unionsOf.get(id) ?? []).map((g) => partnerOf(g, id)).filter((p): p is string => !!p);
    return partners.find((p) => !shown.has(p) && carriedBy(p) > carriedBy(id)) ?? id;
  };

  const entry = (id: string, skipUnion?: string): ListEntry => {
    shown.add(id);
    entered.add(id);
    const unions = (unionsOf.get(id) ?? [])
      .filter((g) => g.id !== skipUnion)
      .sort((a, b) => {
        const pa = partnerOf(a, id);
        const pb = partnerOf(b, id);
        return pa && pb ? byPlace(pa, pb) : 0;
      });
    unions.forEach((g) => g.partners.forEach((p) => shown.add(p)));
    const list: ListUnion[] = unions.map((g) => {
      const listedUnder = expandedUnder.get(g.id) ?? null;
      if (!listedUnder) expandedUnder.set(g.id, id);
      return {
        partner: partnerOf(g, id),
        ended: g.ended,
        listedUnder: g.children.length ? listedUnder : null,
        children: listedUnder ? [] : [...g.children].sort(byPlace).map((c) => entry(c)),
        origins: [],
      };
    });
    // After the children, so a shared couple's children stay listed on this side.
    list.forEach((u, i) => {
      if (u.partner) u.origins = originsOf(u.partner, unions[i].id);
    });
    return { id, unions: list };
  };

  /** Where someone who married in comes from: their oldest ancestors down, or their other partners. */
  const originsOf = (id: string, via: string): ListEntry[] => {
    if (entered.has(id)) return [];
    if (!hasParents(id)) {
      const others = (unionsOf.get(id) ?? []).filter((g) => g.id !== via);
      return others.length ? [entry(id, via)] : [];
    }
    const ancestors = new Set<string>();
    const stack = [id];
    while (stack.length)
      for (const parent of layout.parents.get(stack.pop()!) ?? [])
        if (!ancestors.has(parent)) {
          ancestors.add(parent);
          stack.push(parent);
        }
    return [...ancestors]
      .filter(isRoot)
      .sort(byPlace)
      .flatMap((a) => (shown.has(a) ? [] : [{ ...entry(head(a)), branch: true }]));
  };

  // The biggest family goes first.
  const descendants = (id: string, seen = new Set<string>()) => {
    const stack = [id];
    while (stack.length)
      for (const c of layout.children.get(stack.pop()!) ?? [])
        if (!seen.has(c)) {
          seen.add(c);
          stack.push(c);
        }
    return seen.size;
  };
  const everyone = layout.people.map((p) => p.person.id).sort(byPlace);
  const size = new Map(everyone.filter(isRoot).map((id) => [id, descendants(id)]));
  const roots: ListEntry[] = [];
  for (const id of [...size.keys()].sort((a, b) => size.get(b)! - size.get(a)!))
    if (!shown.has(id)) roots.push({ ...entry(head(id)), branch: true });
  // Anyone the walk above didn't reach (unusual shapes in the data) still gets listed.
  for (const id of everyone) if (!shown.has(id)) roots.push({ ...entry(id), branch: true });
  return roots;
}

/** The tree as an indented outline of names, with lines and arrows from parents to children. */
interface Branch {
  entry: ListEntry;
  /** How it joins the rest: through someone who married into the family. */
  via: { inLaw: string; spouse: string } | null;
}

/** The branches in the order they come up in the list, which is how they're numbered. */
function branchesOf(roots: ListEntry[]): Branch[] {
  const found: Branch[] = [];
  const walk = (entry: ListEntry, via: Branch['via']) => {
    if (entry.branch) found.push({ entry, via });
    for (const u of entry.unions) {
      for (const o of u.origins) walk(o, u.partner ? { inLaw: u.partner, spouse: entry.id } : null);
      for (const c of u.children) walk(c, null);
    }
  };
  roots.forEach((r) => walk(r, null));
  return found;
}

function PrintList({ title, layout }: Props) {
  const roots = useMemo(() => buildOutline(layout), [layout]);
  const branches = useMemo(() => branchesOf(roots), [roots]);
  const number = new Map(branches.map((b, i) => [b.entry, i + 1]));
  const people = useMemo(() => new Map(layout.people.map((p) => [p.person.id, p.person])), [layout]);
  const name = (id: string) => fullName(people.get(id)!);
  const badge = (entry: ListEntry) =>
    branches.length > 1 && number.has(entry) && <span className="pl-branch">{number.get(entry)}</span>;
  /** "A y B" for a branch's oldest couple, or just A. */
  const couple = (entry: ListEntry) => {
    const partner = entry.unions.length === 1 ? entry.unions[0].partner : null;
    return partner ? `${name(entry.id)} y ${name(partner)}` : name(entry.id);
  };

  const partnerText = (u: ListUnion) =>
    u.partner && (
      <span className="pl-partner">
        {' '}con {name(u.partner)}
        {u.ended && <span className="pl-ended"> (separados)</span>}
      </span>
    );
  const origins = (u: ListUnion) =>
    u.origins.length > 0 && (
      <div className="pl-origin">
        <div className="pl-origin__label">Familia de {name(u.partner!)}</div>
        <ul className="pl-roots">
          {u.origins.map((r) => <Item key={r.id} entry={r} />)}
        </ul>
      </div>
    );
  const pointer = (u: ListUnion) =>
    u.listedUnder && <div className="pl-note">Sus hijos figuran con {name(u.listedUnder)}.</div>;
  const children = (u: ListUnion) =>
    u.children.length > 0 && (
      <ul className="pl-children">
        {u.children.map((c) => <Item key={c.id} entry={c} />)}
      </ul>
    );

  function Item({ entry }: { entry: ListEntry }) {
    const [only] = entry.unions;
    const single = entry.unions.length === 1;
    return (
      <li className="pl-item">
        <div className="pl-row">
          {badge(entry)}
          <strong className="pl-name">{name(entry.id)}</strong>
          {single && partnerText(only)}
        </div>
        {single ? (
          <>
            {origins(only)}
            {pointer(only)}
            {children(only)}
          </>
        ) : (
          entry.unions.map((u, i) => (
            <div key={i} className="pl-union">
              <div className="pl-row pl-row--union">{u.partner ? partnerText(u) : ' Sin pareja registrada'}</div>
              {origins(u)}
              {pointer(u)}
              {children(u)}
            </div>
          ))
        )}
      </li>
    );
  }

  return (
    <div className="print-list">
      <h1 className="print-sheet__title">{title}</h1>
      {branches.length > 1 && (
        <section className="pl-overview">
          <h2 className="pl-overview__title">Ramas de la familia</h2>
          <ol className="pl-overview__list">
            {branches.map((b, i) => (
              <li key={i}>
                <span className="pl-branch">{i + 1}</span>
                <span>
                  <strong>{couple(b.entry)}</strong>
                  <span className="pl-overview__via">
                    {b.via ? ` — por ${name(b.via.inLaw)}, pareja de ${name(b.via.spouse)}` : ' — rama principal'}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
      <ul className="pl-roots">
        {roots.map((r) => <Item key={r.id} entry={r} />)}
      </ul>
    </div>
  );
}
