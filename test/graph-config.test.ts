import { MemoryRegion, ViewOptions } from '../src/core';
import { MEMORY_REGIONS, memoryRegionName, viewPanel } from '../src/ui/graph';
import strings from '../src/strings';

/** What the map is drawing, as the graph reports it back to the panel. */
const drawing = (regions: MemoryRegion[]) => (region: MemoryRegion) =>
  regions.includes(region);

const boxesOf = (panel: HTMLElement) =>
  Array.from(
    panel.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
  );

const boxFor = (panel: HTMLElement, text: string) =>
  boxesOf(panel).find(
    (box) => (box.parentElement as HTMLLabelElement).textContent === text
  )!;

describe('the canvas view panel', () => {
  it('combines all canvas sections with the memory-region switches', () => {
    const { root } = viewPanel(
      new ViewOptions(),
      () => undefined,
      drawing(MEMORY_REGIONS)
    );

    expect(boxesOf(root)).toHaveLength(MEMORY_REGIONS.length + 6);
    MEMORY_REGIONS.forEach((region: MemoryRegion) => {
      expect(boxFor(root, memoryRegionName(region)).checked).toBe(true);
    });
    expect(boxFor(root, strings.graphViewStatement).checked).toBe(true);
    expect(boxFor(root, strings.viewCallStack).checked).toBe(true);
    expect(boxFor(root, strings.graphExpressionHeading).checked).toBe(true);
    expect(boxFor(root, strings.viewVariables).checked).toBe(true);
    expect(boxFor(root, strings.graphMemoryHeading).checked).toBe(true);
    expect(boxFor(root, strings.viewMutations).checked).toBe(true);
  });

  it('controls memory and value history from the same panel', () => {
    const view = new ViewOptions();
    let redraws = 0;
    const { root } = viewPanel(
      view,
      () => (redraws += 1),
      drawing(MEMORY_REGIONS)
    );
    const memory = boxFor(root, strings.graphMemoryHeading);
    const mutations = boxFor(root, strings.viewMutations);

    memory.checked = false;
    memory.dispatchEvent(new Event('change'));
    mutations.checked = false;
    mutations.dispatchEvent(new Event('change'));

    expect(view.isMemoryShown()).toBe(false);
    expect(view.areMutationsShown()).toBe(false);
    expect(redraws).toBe(2);
  });

  it('takes the statement section off and puts it back', () => {
    const view = new ViewOptions();
    const { root } = viewPanel(view, () => undefined, drawing(MEMORY_REGIONS));
    const box = boxFor(root, strings.graphViewStatement);

    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(view.isStatementShown()).toBe(false);

    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(view.isStatementShown()).toBe(true);
  });

  it('controls the call stack, expression, and variables as separate views', () => {
    const view = new ViewOptions();
    const { root } = viewPanel(view, () => undefined, drawing(MEMORY_REGIONS));
    const callStack = boxFor(root, strings.viewCallStack);
    const expression = boxFor(root, strings.graphExpressionHeading);
    const variables = boxFor(root, strings.viewVariables);

    callStack.checked = false;
    callStack.dispatchEvent(new Event('change'));
    expression.checked = false;
    expression.dispatchEvent(new Event('change'));
    variables.checked = false;
    variables.dispatchEvent(new Event('change'));

    expect(view.isCallStackShown()).toBe(false);
    expect(view.isExpressionShown()).toBe(false);
    expect(view.areVariablesShown()).toBe(false);
  });

  it('ticks the regions the map is actually drawing', () => {
    const shown: MemoryRegion[] = ['stack'];
    const { root, refresh } = viewPanel(
      new ViewOptions(),
      () => undefined,
      drawing(shown)
    );

    expect(boxFor(root, memoryRegionName('stack')).checked).toBe(true);
    expect(boxFor(root, memoryRegionName('heap')).checked).toBe(false);

    // The first allocation lands, and the heap ticks itself on: the box says
    // what the canvas shows, not what was last clicked.
    shown.push('heap');
    refresh();
    expect(boxFor(root, memoryRegionName('heap')).checked).toBe(true);
  });

  it('switches a region off and redraws once', () => {
    const view = new ViewOptions();
    let draws = 0;
    const { root } = viewPanel(
      view,
      () => (draws += 1),
      drawing(MEMORY_REGIONS)
    );
    const heap = boxFor(root, memoryRegionName('heap'));

    heap.checked = false;
    heap.dispatchEvent(new Event('change'));
    expect(view.isRegionShown('heap')).toBe(false);
    expect(view.isRegionShown('stack')).toBe(true);
    expect(draws).toBe(1);

    heap.checked = true;
    heap.dispatchEvent(new Event('change'));
    // Asked for by name, a region stays on the map even while it is empty.
    expect(view.isRegionShown('heap', false)).toBe(true);
    expect(draws).toBe(2);
  });
});
