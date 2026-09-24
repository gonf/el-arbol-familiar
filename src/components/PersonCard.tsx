import { memo, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Person } from '../types';
import { fullName } from '../types';
import { CARD_H, CARD_W } from '../layout';

const resolvePhoto = (src: string) =>
  /^(https?:|data:|\/)/.test(src) ? src : `${import.meta.env.BASE_URL}${src}`;

const initials = (p: Person) => `${p.firstName[0] ?? ''}${p.lastName[0] ?? ''}`.toUpperCase();

/** Muted warm tones for people without a photo; each person always gets the same one. */
const TONES = ['rosewood', 'clay', 'sage', 'dusk', 'sand', 'lagoon'] as const;
const toneFor = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
};

/** Photo, or the person's initials on a soft tonal background when there is none. */
export function Portrait({ person, className }: { person: Person; className: string }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const showPhoto = person.photo && status !== 'failed';

  return (
    <span className={`${className} portrait portrait--${toneFor(person.id)}`}>
      {showPhoto ? (
        <img
          src={resolvePhoto(person.photo!)}
          alt=""
          // Photos load only as their card nears the visible area of the tree.
          loading="lazy"
          decoding="async"
          draggable={false}
          className={status === 'loaded' ? 'portrait__img portrait__img--loaded' : 'portrait__img'}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('failed')}
        />
      ) : (
        <span className="portrait__initials" aria-hidden="true">{initials(person)}</span>
      )}
    </span>
  );
}

/** Font sizes (rem) tried in order until the full name fits; names are never truncated. */
const NAME_SIZES = [0.92, 0.86, 0.8, 0.74];

/** Picks the largest size at which the text fits its box. Re-runs once web fonts finish loading. */
function useFitText(text: string) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const fit = () => {
      const box = boxRef.current;
      const el = textRef.current;
      if (!box || !el) return;
      for (const size of NAME_SIZES) {
        el.style.fontSize = `${size}rem`;
        if (el.offsetHeight <= box.clientHeight && el.scrollWidth <= box.clientWidth) break;
      }
    };
    fit();
    let active = true;
    document.fonts?.ready.then(() => active && fit());
    return () => {
      active = false;
    };
  }, [text]);

  return { boxRef, textRef };
}

export type CardState = 'selected' | 'lineage' | 'related' | 'dimmed' | undefined;

interface Props {
  person: Person;
  x: number;
  y: number;
  /** Generation row, used to stagger the entrance animation. */
  generation: number;
  state: CardState;
  onSelect: (id: string, event: React.MouseEvent) => void;
}

export const PersonCard = memo(function PersonCard({ person, x, y, generation, state, onSelect }: Props) {
  const name = fullName(person);
  const { boxRef, textRef } = useFitText(name);
  const style = { left: x, top: y, width: CARD_W, height: CARD_H, '--gen': generation } as CSSProperties;

  return (
    <button
      type="button"
      className={state ? `person person--${state}` : 'person'}
      data-id={person.id}
      style={style}
      aria-pressed={state === 'selected'}
      onClick={(e) => onSelect(person.id, e)}
    >
      <Portrait person={person} className="person__photo" />
      <span ref={boxRef} className="person__name">
        <span ref={textRef} className="person__name-text">{name}</span>
      </span>
    </button>
  );
});
