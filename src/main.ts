import { CVisualizer, readConfig } from './index';

/**
 * The standalone page: one instance, in the one element `index.html` provides.
 *
 * This file used to be `src/index.ts` and constructed a `PlivetApp` - the page
 * and the application were the same thing. Phase 10 separated them: the entry
 * point is a class anyone can construct, and this is a caller of it.
 */
const root = document.getElementById('root');
if (root !== null) {
  // What the page asked for, before anything is built: the theme it opens in,
  // the features it leaves out and the canvas sections it starts with are all
  // decided here rather than switched afterwards, so a reader never sees a
  // panel appear and then go again. A page with no configuration element gets
  // an empty one, which is c-visualizer as it comes.
  new CVisualizer(root, readConfig());
}
