import { Plivet } from './index';

/**
 * The development page for Phase 10: two PLIVETs, side by side, on one page.
 *
 * Nothing here is shipped - `dev.html` is added by `webpack.config.dev.js`
 * only, so `npm run build` produces the single-instance `index.html` and
 * nothing else. It exists to be looked at: `npm start`, open /dev.html, and
 * check that the two do not touch each other.
 *
 * What to try, and what each one is checking:
 *
 * - Step A a few times. B's step counter, canvas and highlight must not move:
 *   separate buses, and separate Workers behind them.
 * - Run A to EOF while stepping B. The two interpreters hold their own
 *   history, so B's step-back must still walk B's run.
 * - Switch A's theme. B stays as it opened, which is why they open in
 *   different ones.
 * - Type input into one console while the other program is blocked in scanf.
 *   The line must be read by the program that asked for it.
 * - Upload a file in A and `fopen` it from B: B must not find it.
 */

/** Two different programs, so a stray redraw in the wrong pane is obvious. */
const COUNT_UP = `#include <stdio.h>

int main(void) {
  int total = 0;
  for (int i = 1; i <= 5; i++) {
    total += i;
    printf("A: %d\\n", total);
  }
  return 0;
}
`;

const COUNT_DOWN = `#include <stdio.h>

int main(void) {
  int left = 15;
  while (0 < left) {
    left -= 3;
    printf("B: %d\\n", left);
  }
  return 0;
}
`;

const mount = (id: string, sourceCode: string, theme: 'light' | 'dark') => {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`no element #${id} to mount into`);
  }
  return new Plivet(element, { sourceCode, theme });
};

const instances = [
  mount('a', COUNT_UP, 'light'),
  mount('b', COUNT_DOWN, 'dark'),
];

// Both are reachable from the console as `plivet[0]` and `plivet[1]`, which is
// how `destroy()` gets exercised: an instance taken down must leave the other
// one running, and must take its own Worker with it.
(window as unknown as { plivet: Plivet[] }).plivet = instances;
