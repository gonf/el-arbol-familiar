import { computeLayout } from './layout';
import type { FamilyTree } from './types';

// Layout search can take a few hundred ms on big trees; running it here keeps the page responsive.
const scope = self as unknown as { postMessage: (message: unknown) => void };

self.onmessage = (event: MessageEvent<FamilyTree>) => {
  scope.postMessage(computeLayout(event.data));
};
