import { Plivet } from './index';
import type { PlivetOptions } from './index';

/**
 * The development page: two PLIVETs, side by side, on one page.
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
 *
 * And the host integration (plan H1 to H3, H5):
 *
 * - A is an exercise over two files: only line 8 of `main.c` and line 2 of
 *   `helper.c` are editable, the rest is shaded with a lock. Switch tabs and
 *   back: the regions stay where they were.
 * - `plivet[0].updateFiles([{ path: 'main.c', text: 'int main;' }])` is
 *   refused with a notice over the editor naming the line, and Restore
 *   default puts `main.c` back. `plivet[0].sourceSnapshot().files[0].protected`
 *   lists the protected spans.
 * - B opens from a version 2 session: a breakpoint on line 6, a watch pinned
 *   on `left`, the cursor on the loop. `plivet[1].session()` writes it back.
 * - `plivet[0].setFontSize(20)` sets A's text size; `plivet[1].onThemeChange`
 *   hears B's theme switch. B has no text-size buttons (`controls`).
 *
 * And the layout against the container (H4):
 *
 * - Narrow the window below 720px: both panes stack, and each instance goes
 *   to one column - editor, console, canvas. Widen it past 768px and they
 *   go back. Mid-session, the step, the editor's scroll position and the
 *   canvas' folds survive the switch, and the floating toolbar goes back
 *   over the editor. `plivet[0].getLayout()` says which; A logs each change.
 */

/** Two different programs, so a stray redraw in the wrong pane is obvious. */
const COUNT_UP = `#include <stdio.h>

int twice(int x);

int main(void) {
  int total = 0;
  for (int i = 1; i <= 5; i++) {
    total += twice(i);
    printf("A: %d\\n", total);
  }
  return 0;
}
`;

const TWICE = `int twice(int x) {
  return 2 * x;
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

const mount = (id: string, options: PlivetOptions) => {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`no element #${id} to mount into`);
  }
  return new Plivet(element, options);
};

const instances = [
  mount('a', {
    theme: 'light',
    files: [
      { path: 'main.c', text: COUNT_UP },
      { path: 'helper.c', text: TWICE },
    ],
    editableRegions: { 'main.c': [[8, 8]], 'helper.c': [[2, 2]] },
    onLoadRefused: (refusal) => console.info('A refused a load', refusal),
  }),
  mount('b', {
    theme: 'dark',
    files: [{ path: 'main.c', text: COUNT_DOWN }],
    controls: { textSize: false },
    session: {
      version: 2,
      files: [
        {
          path: 'main.c',
          selection: {
            anchor: COUNT_DOWN.indexOf('while'),
            head: COUNT_DOWN.indexOf('while'),
          },
          breakpoints: [5],
          watches: [{ name: 'left', pos: COUNT_DOWN.indexOf('left') }],
        },
      ],
    },
  }),
];
instances[1].onThemeChange((theme) => console.info('B is now', theme));
instances[0].onLayoutChange((layout) => console.info('A is now', layout));

// Both are reachable from the console as `plivet[0]` and `plivet[1]`, which is
// how `destroy()` gets exercised: an instance taken down must leave the other
// one running, and must take its own Worker with it.
(window as unknown as { plivet: Plivet[] }).plivet = instances;
