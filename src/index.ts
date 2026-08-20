import { PlivetApp } from './app/PlivetApp';

/**
 * The page. Phase 10 turns this into `new Plivet(element, options)` and makes
 * the bus an instance's own; until then one application mounts into the one
 * element `index.html` provides.
 */
const root = document.getElementById('root');
if (root !== null) {
  new PlivetApp(root);
}
