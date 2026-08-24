import { dia } from '@joint/core';
import { MemorySegmentGeometry } from '../src/core';
import { memoryNodeOf } from '../src/ui/graph/MemoryNode';
import { stackTableOf } from '../src/ui/graph/StackTable';

const segment = (): MemorySegmentGeometry => ({
  key: 'stack',
  name: 'Stack',
  addressLabel: '0x1000 – 0x1004',
  x: 24,
  y: 24,
  width: 300,
  height: 98,
  titleHeight: 32,
  columnHeaderHeight: 24,
  collapsed: false,
  columns: [
    { key: 'address', x: 0, width: 100 },
    { key: 'name', x: 100, width: 100 },
    { key: 'value', x: 200, width: 100 },
  ],
  rows: [
    {
      kind: 'entry',
      key: 'stack-row-0',
      y: 56,
      height: 42,
      bandY: 17,
      bandHeight: 25,
      indent: 0,
      caption: { text: 'int · 4 B', x: 100, width: 200, height: 17 },
      cells: [
        {
          key: 'x-address',
          text: '0x1000',
          kind: 'address',
          x: 24,
          y: 97,
          width: 100,
          height: 25,
          colors: [],
        },
        {
          key: 'x-name',
          text: 'x',
          kind: 'name',
          x: 124,
          y: 97,
          width: 100,
          height: 25,
          colors: [],
        },
        {
          key: 'x-value',
          text: '3',
          tooltip: 'the complete value',
          kind: 'value',
          x: 224,
          y: 97,
          width: 100,
          height: 25,
          colors: ['#ff0000'],
        },
      ],
      fold: { key: 'x-fold', target: 'group', text: '▼', x: 108, width: 16 },
    },
  ],
});

/** One drawn part of the node, by the selector the renderer gave it. */
const attr = (node: dia.Element, selector: string): Record<string, any> =>
  (node.get('attrs') as Record<string, Record<string, any>>)[selector];

describe('MemoryNode', () => {
  it('draws the segment as one element the size the layout gave it', () => {
    const node = memoryNodeOf(segment());

    expect(node.get('type')).toBe('plivet.MemoryNode');
    expect(node.position()).toEqual({ x: 24, y: 24 });
    expect(node.size()).toEqual({ width: 300, height: 98 });
  });

  it('puts the type above the object and the value at the row end', () => {
    const node = memoryNodeOf(segment());
    const caption = attr(node, 'caption-0-text');
    const value = attr(node, 'cell-0-2-text');
    const name = attr(node, 'cell-0-1-text');

    expect(caption.text).toBe('int · 4 B');
    expect(caption.y).toBeLessThan(name.y);
    // The identifier reads in the interface font; the machine's text does not.
    expect(name.fontFamily).toContain('system-ui');
    expect(value.fontFamily).toContain('Consolas');
    expect(value.textAnchor).toBe('end');
    expect(value.x).toBe(300 - 8);
    expect(attr(node, 'cell-0-2-body').title).toBe('the complete value');
    expect(name.fill).toContain('--plivet-graph-ink');
    expect(attr(node, 'body').fill).toContain('--plivet-graph-surface');
  });

  it('spans the address across both bands and marks the pointer cell', () => {
    const node = memoryNodeOf(segment());

    expect(attr(node, 'cell-0-0-body').height).toBe(42);
    expect(attr(node, 'cell-0-1-body').height).toBe(25);
    expect(attr(node, 'cell-0-2-body').fill).toMatchObject({
      type: 'linearGradient',
    });
  });

  it('makes the aggregate name band and fold triangle expandable', () => {
    const node = memoryNodeOf(segment());
    const markup = node.get('markup') as {
      selector: string;
      attributes?: Record<string, string>;
    }[];
    const clickable = markup.filter(
      (item) => typeof item.attributes?.['data-fold-target'] === 'string'
    );

    expect(clickable.map((item) => item.selector)).toEqual([
      'cell-0-1-body',
      'cell-0-1-text',
      'fold-0-body',
      'fold-0-text',
    ]);
    expect(clickable[0].attributes!['data-fold-target']).toBe('group');
  });

  it("makes the whole title bar the segment's own fold", () => {
    const node = memoryNodeOf(segment());
    const markup = node.get('markup') as {
      selector: string;
      attributes?: Record<string, string>;
    }[];
    const clickable = markup.filter(
      (item) => typeof item.attributes?.['data-collapse-target'] === 'string'
    );

    expect(clickable.map((item) => item.selector)).toEqual([
      'titleBody',
      'titleFoot',
    ]);
    expect(clickable[0].attributes!['data-collapse-target']).toBe('stack');
    // The name and the addresses let the click through to the bar under them.
    expect(attr(node, 'titleText').pointerEvents).toBe('none');
    expect(attr(node, 'titleToggle').text).toBe('\u25bc');
  });

  it('can embed the table without repeating its surrounding section title', () => {
    const node = memoryNodeOf(segment(), {
      collapsible: false,
      title: false,
    });
    const attrs = node.get('attrs') as Record<string, unknown>;

    expect(node.position()).toEqual({ x: 24, y: 24 });
    expect(node.size()).toEqual({ width: 300, height: 66 });
    expect(Object.keys(attrs)).not.toContain('titleText');
    expect(attr(node, 'headerBody').y).toBe(0);
    expect(attr(node, 'cell-0-0-body').y).toBe(24);
  });

  it('draws a collapsed segment as the title bar and nothing else', () => {
    const node = memoryNodeOf({
      ...segment(),
      height: 32,
      columnHeaderHeight: 0,
      collapsed: true,
      rows: [],
    });
    const attrs = node.get('attrs') as Record<string, unknown>;

    expect(node.size()).toEqual({ width: 300, height: 32 });
    // No column header, no rows - and the bar keeps all four corners, so the
    // rect that squares off its foot is gone with them.
    expect(Object.keys(attrs)).toEqual([
      'body',
      'titleBody',
      'titleToggle',
      'titleText',
      'titleAddress',
    ]);
    expect(attr(node, 'titleToggle').text).toBe('\u25b2');
  });
});

describe('StackTable', () => {
  it('uses the JointJS element defaults without calling them as a function', () => {
    const table = stackTableOf({
      key: 'stack:main',
      name: 'main',
      x: 10,
      y: 20,
      width: 180,
      height: 48,
      rows: [],
    });

    expect(table.get('type')).toBe('plivet.StackTable');
    expect(table.position()).toEqual({ x: 10, y: 20 });
    expect(table.size()).toEqual({ width: 180, height: 48 });
  });
});
