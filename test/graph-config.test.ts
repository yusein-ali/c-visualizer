import { MemoryRegion, ViewOptions } from '../src/core';
import { MEMORY_REGIONS, memoryRegionName, viewPanel } from '../src/ui/graph';

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
  it('offers a switch per memory region and one for the expression', () => {
    const { root } = viewPanel(
      new ViewOptions(),
      () => undefined,
      drawing(MEMORY_REGIONS)
    );

    expect(boxesOf(root)).toHaveLength(MEMORY_REGIONS.length + 1);
    MEMORY_REGIONS.forEach((region: MemoryRegion) => {
      expect(boxFor(root, memoryRegionName(region)).checked).toBe(true);
    });
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

  it('puts the expression expansion away', () => {
    const view = new ViewOptions();
    const { root } = viewPanel(view, () => undefined, drawing([]));
    const expression = boxFor(root, 'Expression evaluation');

    expect(expression.checked).toBe(true);
    expression.checked = false;
    expression.dispatchEvent(new Event('change'));
    expect(view.isExpressionShown()).toBe(false);
  });
});
