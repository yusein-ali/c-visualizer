import { Plivet } from './index';

/**
 * The standalone page: one instance, in the one element `index.html` provides.
 *
 * This file used to be `src/index.ts` and constructed a `PlivetApp` - the page
 * and the application were the same thing. Phase 10 separated them: the entry
 * point is a class anyone can construct, and this is a caller of it.
 */
const root = document.getElementById('root');
if (root !== null) {
  new Plivet(root);
}
