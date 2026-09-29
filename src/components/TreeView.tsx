import {
  forwardRef, Fragment, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties,
} from 'react';
import type { Highlight, Layout, UnionGeometry } from '../layout';
import { CARD_H, CARD_W, descentPath, highlightOf } from '../layout';
import { fullName } from '../types';
import { PersonCard, Portrait, type CardState } from './PersonCard';

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2.5;
const FOCUS_ZOOM = 0.9; // minimum zoom when centring on a person, so their card is readable
const DRAG_THRESHOLD = 5;
const BAND_BLEED = 40000;
const BAR_CLEARANCE = 12; // space kept between the lowest row and the floating bars
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface View { x: number; y: number; k: number }
interface Point { x: number; y: number }
type ViewUpdate = View | ((v: View) => View);

/** The parts of a union's lines to emphasise for the current highlight. */
function highlightPaths(g: UnionGeometry, { line, related }: Highlight) {
  const lineParents = g.partners.filter((p) => line.has(p));
  const relatedParents = g.partners.filter((p) => related.has(p));
  const lineKids = g.children.filter((c) => line.has(c));
  const relatedKids = g.children.filter((c) => related.has(c));

  // Direct line: from line parents down to line children.
  const strong =
    lineParents.length && lineKids.length
      ? { partner: lineParents.map((p) => g.toDrop[p]).filter(Boolean).join(' '), descent: descentPath(g, lineKids) }
      : null;

  const soft: string[] = [];
  // Current couples where both people are highlighted (unless both are on the line, drawn above).
  if (!g.ended && g.partnerD && lineParents.length + relatedParents.length === 2 && lineParents.length < 2)
    soft.push(g.partnerD);
  // Children of a highlighted relative (a partner's children, a sibling's descendants),
  // or siblings coming down from a parent on the line.
  const softParents = relatedParents.length ? relatedParents : lineParents;
  const softDescent = softParents.length > 0 && relatedKids.length > 0;
  if (softDescent) soft.push(...softParents.map((p) => g.toDrop[p]).filter(Boolean), descentPath(g, relatedKids));

  const hasNode = g.partners.length === 2 && g.children.length > 0;
  const node = !hasNode ? null : strong ? 'strong' : softDescent ? 'soft' : null;
  return { strong, soft: soft.join(' '), node };
}

/** Lets the page (e.g. the stats panel) point the tree at someone. */
export interface TreeViewHandle {
  /** Selects the person and glides the view to them. */
  focusPerson: (id: string) => void;
}

interface TreeViewProps {
  layout: Layout;
  /** Width covered by a side panel on the right; centring and fitting use the space left of it. */
  panelInset?: number;
}

export const TreeView = forwardRef<TreeViewHandle, TreeViewProps>(function TreeView({ layout, panelInset = 0 }, ref) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [view, setRawView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [animated, setAnimated] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef({ start: { x: 0, y: 0 }, moved: false });
  const pinchDist = useRef<number | null>(null);

  const placed = useMemo(() => new Map(layout.people.map((p) => [p.person.id, p])), [layout]);
  const generationOf = useMemo(() => {
    const rows = [...new Set(layout.people.map((p) => p.y))].sort((a, b) => a - b);
    return new Map(layout.people.map((p) => [p.person.id, rows.indexOf(p.y)]));
  }, [layout]);
  const selected = selectedId ? placed.get(selectedId)?.person ?? null : null;
  const highlight = useMemo(() => (selected ? highlightOf(layout, selected.id) : null), [layout, selected]);

  /**
   * Keeps the tree from being dragged out of sight: when it's larger than the viewport its edges
   * can't pull past the viewport's edges; when it's smaller it stays fully inside.
   */
  /** How much of the viewport's bottom is covered by the floating status and zoom bars. */
  const bottomInset = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return 0;
    const bottom = el.getBoundingClientRect().bottom;
    let covered = 0;
    for (const bar of [statusRef.current, controlsRef.current]) {
      const r = bar?.getBoundingClientRect();
      // A hidden bar (the hint on phones) takes no room.
      if (r && r.height > 0) covered = Math.max(covered, bottom - r.top);
    }
    return covered > 0 ? covered + BAR_CLEARANCE : 0;
  }, []);

  /**
   * Keeps the tree from being dragged out of sight: when it's larger than the viewport its edges
   * can't pull past the viewport's edges; when it's smaller it stays fully inside. Vertically the
   * usable area stops above the floating bars, so the bottom row can always be brought into view.
   */
  const constrain = useCallback(
    (v: View): View => {
      const el = viewportRef.current;
      if (!el) return v;
      const axis = (pos: number, size: number, available: number) =>
        clamp(pos, Math.min(0, available - size), Math.max(0, available - size));
      return {
        k: v.k,
        x: axis(v.x, layout.width * v.k, el.clientWidth),
        y: axis(v.y, layout.height * v.k, el.clientHeight - bottomInset()),
      };
    },
    [layout, bottomInset],
  );

  /** Direct manipulation (drag, wheel, pinch) moves instantly; buttons and keys glide. */
  const setView = useCallback(
    (update: ViewUpdate, animate = false) => {
      setAnimated(animate);
      setRawView((v) => constrain(typeof update === 'function' ? update(v) : update));
    },
    [constrain],
  );

  const fit = useCallback(
    (animate: boolean) => {
      const el = viewportRef.current;
      if (!el) return;
      const w = el.clientWidth - panelInset;
      const h = el.clientHeight - bottomInset();
      const k = clamp(Math.min(1, (w - 32) / layout.width, (h - 32) / layout.height), MIN_ZOOM, MAX_ZOOM);
      setView({ k, x: (w - layout.width * k) / 2, y: (h - layout.height * k) / 2 }, animate);
    },
    [layout, setView, bottomInset, panelInset],
  );

  // Fit once per layout (on load); later panel changes shouldn't re-fit the view.
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useLayoutEffect(() => fitRef.current(false), [layout]);

  // Re-apply the bounds when the viewport changes size (window resize, rotating a phone).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setView((v) => v));
    observer.observe(el);
    // The status bar grows when someone is selected (and wraps long names on phones); glide the
    // tree up if its bottom row would now sit behind it.
    const bars = new ResizeObserver(() => setView((v) => v, true));
    for (const bar of [statusRef.current, controlsRef.current]) if (bar) bars.observe(bar);
    return () => {
      observer.disconnect();
      bars.disconnect();
    };
  }, [setView]);

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number, animate = false) => {
      setView((v) => {
        const k = clamp(v.k * factor, MIN_ZOOM, MAX_ZOOM);
        const r = k / v.k;
        return { k, x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r };
      }, animate);
    },
    [setView],
  );

  const zoomCenter = (factor: number) => {
    const el = viewportRef.current;
    if (el) zoomAt(factor, (el.clientWidth - panelInset) / 2, el.clientHeight / 2, true);
  };

  const centerOn = (id: string, animate = true) => {
    const el = viewportRef.current;
    const p = placed.get(id);
    if (!el || !p) return;
    setView((v) => {
      const k = Math.max(v.k, FOCUS_ZOOM);
      return {
        k,
        x: (el.clientWidth - panelInset) / 2 - (p.x + CARD_W / 2) * k,
        // Centred in the area above the floating bars.
        y: (el.clientHeight - bottomInset()) / 2 - (p.y + CARD_H / 2) * k,
      };
    }, animate);
  };

  useImperativeHandle(ref, () => ({
    focusPerson: (id: string) => {
      setSelectedId(id);
      centerOn(id);
    },
  }));

  // The canvas moves only through `view`. If the browser scrolls the viewport anyway (focusing a
  // card in browsers without `overflow: clip`), undo it so positions stay true.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onScroll = () => {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  /** Tabbing to a card that's out of sight glides the tree to it. */
  const onFocusCard = (e: React.FocusEvent) => {
    const card = (e.target as Element).closest<HTMLElement>('.person');
    const el = viewportRef.current;
    if (!card || !el || !card.matches(':focus-visible')) return;
    const r = card.getBoundingClientRect();
    const v = el.getBoundingClientRect();
    const visible = r.left >= v.left && r.right <= v.right && r.top >= v.top && r.bottom <= v.bottom;
    if (!visible && card.dataset.id) centerOn(card.dataset.id);
  };

  // Native listener: React's wheel handler is passive and can't prevent page scroll.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // A press only becomes a drag after it moves a few pixels, so clicks on cards still register.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) gesture.current = { start: { x: e.clientX, y: e.clientY }, moved: false };
    else gesture.current.moved = true;
    pinchDist.current = null;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    if (!gesture.current.moved) {
      const { start } = gesture.current;
      if (Math.hypot(next.x - start.x, next.y - start.y) < DRAG_THRESHOLD) return;
      gesture.current.moved = true;
    }
    const el = viewportRef.current!;
    if (!el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, next);
    const pts = [...pointers.current.values()];

    if (pts.length === 2) {
      const rect = el.getBoundingClientRect();
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinchDist.current) {
        zoomAt(
          dist / pinchDist.current,
          (pts[0].x + pts[1].x) / 2 - rect.left,
          (pts[0].y + pts[1].y) / 2 - rect.top,
        );
      }
      pinchDist.current = dist;
      return;
    }
    setView((v) => ({ ...v, x: v.x + next.x - prev.x, y: v.y + next.y - prev.y }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    pinchDist.current = null;
  };

  // A click that ends a drag shouldn't change the selection. Keyboard clicks (detail 0) always count.
  const endedDrag = (e: React.MouseEvent) => e.detail > 0 && gesture.current.moved;

  // Refs let the stable click handler use the latest selection and centring logic.
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const centerOnRef = useRef(centerOn);
  centerOnRef.current = centerOn;

  /** Selecting someone also centres them (instantly); clicking them again just clears. */
  const onSelect = useCallback((id: string, e: React.MouseEvent) => {
    if (endedDrag(e)) return;
    if (selectedRef.current === id) {
      setSelectedId(null);
      return;
    }
    setSelectedId(id);
    centerOnRef.current(id, false);
  }, []);

  const onViewportClick = (e: React.MouseEvent) => {
    if (endedDrag(e) || (e.target as Element).closest('.person')) return;
    setSelectedId(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = 80;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step],
    };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }), true);
    } else if (e.key === '+' || e.key === '=') zoomCenter(1.25);
    else if (e.key === '-') zoomCenter(1 / 1.25);
    else if (e.key === '0') fit(true);
  };

  const stateOf = (id: string): CardState => {
    if (!highlight) return undefined;
    if (id === selectedId) return 'selected';
    if (highlight.line.has(id)) return 'lineage';
    return highlight.related.has(id) ? 'related' : 'dimmed';
  };

  const nodeOf = (g: UnionGeometry, className: string) => (
    <circle cx={g.dropX} cy={g.startY} r={4.5} className={`node ${className}`} />
  );

  return (
    // Escape clears the selection from anywhere in the tree area, including the status buttons.
    <div
      className="tree"
      style={{ '--panel-inset': `${panelInset}px` } as CSSProperties}
      onKeyDown={(e) => e.key === 'Escape' && setSelectedId(null)}
    >
      <div
        ref={viewportRef}
        className="tree__viewport"
        tabIndex={0}
        aria-label="Árbol genealógico. Arrastrá o usá las flechas para moverte, más y menos para el zoom, y Escape para quitar la selección."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onViewportClick}
        onKeyDown={onKeyDown}
        onFocus={onFocusCard}
      >
        <div
          className={animated ? 'tree__canvas tree__canvas--glide' : 'tree__canvas'}
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
          }}
        >
          <svg className="tree__lines" width={layout.width} height={layout.height} aria-hidden="true">
            <g className="bands">
              {layout.bands.map((b, i) =>
                // Wider than the tree so the bands run edge to edge however far it's zoomed out.
                i % 2 === 1 ? <rect key={i} x={-BAND_BLEED} y={b.y} width={layout.width + 2 * BAND_BLEED} height={b.height} /> : null,
              )}
            </g>
            <g className={highlight ? 'lines lines--dimmed' : 'lines'}>
              {layout.unions.map((g) => (
                <Fragment key={g.id}>
                  {g.partnerD && <path d={g.partnerD} className={`line line--${g.ended ? 'ended' : 'partner'}`} />}
                  {g.children.length > 0 && <path d={descentPath(g, g.children)} className="line line--descent" />}
                  {g.partners.length === 2 && g.children.length > 0 && nodeOf(g, g.ended ? 'node--ended' : '')}
                </Fragment>
              ))}
            </g>
            {highlight && (
              // Keyed by person so the lines trace in again for every new selection.
              <g key={selectedId}>
                {layout.unions.map((g) => {
                  const { soft, node } = highlightPaths(g, highlight);
                  return (
                    <Fragment key={g.id}>
                      {soft && <path d={soft} pathLength={1} className="line line--related line--trace" />}
                      {node === 'soft' && nodeOf(g, 'node--related')}
                    </Fragment>
                  );
                })}
                {layout.unions.map((g) => {
                  const { strong, node } = highlightPaths(g, highlight);
                  if (!strong) return null;
                  return (
                    <Fragment key={g.id}>
                      {strong.partner && (
                        <path
                          d={strong.partner}
                          pathLength={g.ended ? undefined : 1}
                          className={`line line--highlight ${g.ended ? 'line--highlight-ended' : 'line--trace'}`}
                        />
                      )}
                      <path d={strong.descent} pathLength={1} className="line line--highlight line--trace" />
                      {node === 'strong' && nodeOf(g, 'node--highlight')}
                    </Fragment>
                  );
                })}
              </g>
            )}
          </svg>
          {layout.people.map(({ person, x, y }) => (
            <PersonCard
              key={person.id}
              person={person}
              x={x}
              y={y}
              generation={generationOf.get(person.id) ?? 0}
              state={stateOf(person.id)}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>

      <div ref={statusRef} className={selected ? 'tree__status glass' : 'tree__status tree__status--hint glass'} role="status">
        {selected ? (
          <div key={selected.id} className="status status--selected">
            <Portrait person={selected} className="status__portrait" />
            <span className="status__text">
              <span className="status__label">Línea directa de</span>
              <strong className="status__name">{fullName(selected)}</strong>
            </span>
            <span className="status__key" aria-hidden="true">
              <span><i className="key key--line" />Línea directa</span>
              <span><i className="key key--related" />Familia cercana</span>
            </span>
            <span className="status__actions">
              {/* Text on wide screens; on phones the icon shows and the text stays for screen readers. */}
              <button type="button" className="btn btn--ghost" onClick={() => centerOn(selected.id)} title="Centrar">
                <svg className="btn__icon" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                  <circle cx="10" cy="10" r="7" />
                  <circle cx="10" cy="10" r="3.2" />
                  <circle cx="10" cy="10" r="0.6" className="btn__icon-dot" />
                </svg>
                <span className="btn__text">Centrar</span>
              </button>
              <button type="button" className="btn btn--accent" onClick={() => setSelectedId(null)} title="Limpiar">
                <svg className="btn__icon" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M5.5 5.5 L14.5 14.5 M14.5 5.5 L5.5 14.5" />
                </svg>
                <span className="btn__text">Limpiar</span>
              </button>
            </span>
          </div>
        ) : (
          <div key="hint" className="status status--hint">
            Elegí a una persona para resaltar su línea directa.
          </div>
        )}
      </div>

      <div ref={controlsRef} className="tree__controls glass" role="toolbar" aria-label="Zoom">
        <button type="button" className="control" onClick={() => zoomCenter(1 / 1.25)} aria-label="Alejar">−</button>
        <span className="control__level" aria-hidden="true">{Math.round(view.k * 100)}%</span>
        <button type="button" className="control" onClick={() => zoomCenter(1.25)} aria-label="Acercar">+</button>
        <span className="control__divider" aria-hidden="true" />
        <button type="button" className="control control--text" onClick={() => fit(true)} title="Ver todo el árbol">
          Ajustar
        </button>
      </div>
    </div>
  );
});
