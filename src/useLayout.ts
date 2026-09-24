import { useEffect, useState } from 'react';
import type { FamilyTree } from './types';
import { computeLayout, type Layout } from './layout';

/** Computes the layout off the main thread, falling back to the main thread if workers fail. */
export function useLayout(tree: FamilyTree | null): Layout | null {
  const [layout, setLayout] = useState<Layout | null>(null);

  useEffect(() => {
    setLayout(null);
    if (!tree) return;
    let worker: Worker | null = null;
    const fallback = () => {
      worker?.terminate();
      setLayout(computeLayout(tree));
    };
    try {
      worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      fallback();
      return;
    }
    worker.onmessage = (event: MessageEvent<Layout>) => {
      setLayout(event.data);
      worker?.terminate();
    };
    worker.onerror = fallback;
    worker.postMessage(tree);
    return () => worker?.terminate();
  }, [tree]);

  return layout;
}
