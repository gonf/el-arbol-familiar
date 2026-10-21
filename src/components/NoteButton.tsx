import { useRef } from 'react';

/** Paragraphs are separated by blank lines; a single line break stays a line break. */
const paragraphs = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

/**
 * The "?" button and the window it opens with the tree's `help` text. That text can be thanks,
 * notes or how to read the tree, so the window has no heading of its own.
 */
export function NoteButton({ text }: { text: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const close = (e: React.MouseEvent<HTMLDialogElement>) => {
    // A click on the backdrop lands on the dialog itself.
    if (e.target === e.currentTarget) e.currentTarget.close();
  };

  return (
    <>
      <button
        type="button"
        className="tool-btn tool-btn--icon"
        aria-haspopup="dialog"
        aria-label="Más información"
        title="Más información"
        onClick={() => dialogRef.current?.showModal()}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <circle cx="9" cy="9" r="7.25" />
          <path d="M6.9 7a2.15 2.15 0 1 1 3 2c-.6.3-.9.7-.9 1.3v.4" />
          <circle cx="9" cy="13.2" r="0.35" className="tool-btn__dot" />
        </svg>
      </button>

      <dialog ref={dialogRef} className="dialog note-dialog" aria-label="Más información" onClick={close}>
        <div className="note-dialog__body">
          <form method="dialog" className="note-dialog__close">
            <button className="stats__close" aria-label="Cerrar">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" /></svg>
            </button>
          </form>
          <div className="note-dialog__text">
            {paragraphs(text).map((p, i) => (
              <p key={i}>
                {p.split('\n').map((line, j) => (
                  <span key={j}>
                    {j > 0 && <br />}
                    {line}
                  </span>
                ))}
              </p>
            ))}
          </div>
        </div>
      </dialog>
    </>
  );
}
