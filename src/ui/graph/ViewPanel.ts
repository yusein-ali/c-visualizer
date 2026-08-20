import { MemoryRegion, ViewOptions } from '../../core';
import strings from '../../strings';
import { MEMORY_REGIONS, memoryRegionName } from './geometry';

/** The panel, and the handle for putting its switches back in step. */
export interface ViewPanelHandle {
  root: HTMLDetailsElement;
  /** Re-reads what the canvas is drawing now, after a step or a click. */
  refresh: () => void;
}

/**
 * The switches that decide what the canvas draws: one per memory region and
 * one for the expression under them.
 *
 * It is a disclosure rather than a row of checkboxes because the toolbar sits
 * over the paper and stays there while the reader scrolls: eight controls
 * along it would cost more of the drawing than they are worth, and the answer
 * they hold is one a reader gives once and then leaves alone. It is painted as
 * the map is - the slate title bar, the pale column header, the grid lines
 * between the rows - because it is a panel over the drawing rather than
 * another button on the page.
 *
 * A box says what the canvas shows at this step rather than what the reader
 * last clicked, because those differ: a region nobody has switched is drawn
 * only while it holds something, so the BSS ticks itself on at the first
 * object that lands in it. `drawn` is what the map settled on, and `refresh` reads it back.
 *
 * It is its own module rather than another method on the graph, because a
 * `dia.Paper` cannot be built outside a browser and this can: the panel is
 * markup over `ViewOptions`, and it is tested as markup.
 */
export function viewPanel(
  view: ViewOptions,
  onChange: () => void,
  drawn: (region: MemoryRegion) => boolean
): ViewPanelHandle {
  const root = document.createElement('details');
  root.className = 'plivet-graph__config';

  const summary = document.createElement('summary');
  summary.className = 'plivet-graph__config-summary';
  summary.textContent = strings.graphViewOptions;
  summary.title = strings.graphViewOptionsTitle;

  const regions = document.createElement('div');
  regions.className = 'plivet-graph__config-group';
  // A `fieldset` would name the group for a screen reader and then fight every
  // rule that paints it; a group with its own name does both.
  regions.setAttribute('role', 'group');
  regions.setAttribute('aria-label', strings.graphViewRegions);

  const title = document.createElement('p');
  title.className = 'plivet-graph__config-title';
  title.textContent = strings.graphViewRegions;

  const boxes = new Map<MemoryRegion, HTMLInputElement>();
  regions.append(
    title,
    ...MEMORY_REGIONS.map((region: MemoryRegion) => {
      const option = checkbox(memoryRegionName(region), (shown) => {
        view.showRegion(region, shown);
        onChange();
      });
      boxes.set(region, option.input);
      return option.label;
    })
  );

  const expression = checkbox(strings.expressionEvaluation, (shown) => {
    view.showExpression(shown);
    onChange();
  });
  expression.label.classList.add('plivet-graph__config-option--apart');

  const body = document.createElement('div');
  body.className = 'plivet-graph__config-body';
  body.append(regions, expression.label);

  root.append(summary, body);

  const refresh = (): void => {
    for (const [region, box] of boxes) {
      box.checked = drawn(region);
    }
    expression.input.checked = view.isExpressionShown();
  };
  refresh();
  return { root, refresh };
}

/** One switch, reporting what it is now rather than that it was clicked. */
function checkbox(
  text: string,
  apply: (shown: boolean) => void
): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement('label');
  label.className = 'plivet-graph__config-option';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.addEventListener('change', () => apply(input.checked));
  label.append(input, document.createTextNode(text));
  return { label, input };
}
