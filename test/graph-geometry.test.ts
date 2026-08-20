import {
  CellModel,
  FoldState,
  MemoryRegion,
  MemorySegmentModel,
  MemoryGeometry,
  StepModel,
  ViewOptions,
  cellWidth,
  emptyStepModel,
  foldGroupOf,
} from '../src/core';
import {
  MEMORY_REGIONS,
  graphGeometry,
  memoryGeometry,
} from '../src/ui/graph/geometry';

const cell = (
  text: string,
  key: string,
  kind: CellModel['kind'],
  extra: Partial<CellModel> = {}
): CellModel => ({
  key,
  text,
  kind,
  width: cellWidth(text),
  ...extra,
});

/** A scalar as `extractModel` builds it: type, name, value, address. */
const scalarRow = (
  name: string,
  type: string,
  value: string,
  address: number,
  foldGroup?: string,
  size = 4
): CellModel[] => [
  cell(type, `${name}-type`, 'type', { foldGroup, size }),
  cell(name, `${name}-name`, 'name', { foldGroup }),
  cell(value, `${name}-value`, 'value', { foldGroup }),
  cell(`&${name}(0x${address.toString(16)}) `, `${name}-address`, 'address', {
    address,
    foldGroup,
  }),
];

const group = foldGroupOf(undefined, 'a');

const segment = (
  key: MemoryRegion,
  rows: CellModel[][],
  startAddress: number,
  groups: MemorySegmentModel['groups'] = []
): MemorySegmentModel => ({ key, name: key, startAddress, rows, groups });

const model = (): StepModel => {
  const result = emptyStepModel();
  const array = [
    ...scalarRow('a', 'int[2]', '0x1004', 0x1004),
    cell('', 'a-fold', 'fold', { width: cellWidth(' '), foldTarget: group }),
  ];
  const member = [
    cell('', 'a-indent', 'indent', { foldGroup: group }),
    ...scalarRow('a[0]', 'int', '7', 0x1004, group),
  ];
  result.memory = [
    segment('registers', [], 0),
    segment('text', [], 0x1000),
    segment('readOnly', [], 0x2710),
    segment('data', [], 0x3000),
    segment('bss', [], 0x3800),
    segment('heap', [scalarRow('Heap:0', 'int', '3', 0x4e20)], 0x4e20),
    segment(
      'stack',
      [scalarRow('p', 'int *', '0x1004', 0x1000), array, member],
      0x1000,
      [
        { name: 'main', rows: 1 },
        { name: 'sum', rows: 2 },
      ]
    ),
  ];
  result.pointers = [{ from: 'p-value', to: 'a-address' }];
  return result;
};

/**
 * The map with every region on it. The canvas leaves a region holding nothing
 * off until the reader asks for it, and these tests are about how the regions
 * are drawn rather than about which of them are - the rule itself is tested
 * where the view options are.
 */
const everything = (): ViewOptions => {
  const view = new ViewOptions();
  for (const region of MEMORY_REGIONS) {
    view.showRegion(region, true);
  }
  return view;
};

const mapOf = (
  step: StepModel,
  folds: FoldState,
  view: ViewOptions = everything()
): MemoryGeometry => memoryGeometry(step, folds, view);

describe('memory geometry', () => {
  it('puts the registers over the stack, and the rest beside them', () => {
    const geometry = mapOf(model(), new FoldState());
    const at = (key: string) =>
      geometry.segments.find((one) => one.key === key)!;
    const left = [at('registers'), at('stack')];
    const right = [
      at('heap'),
      at('bss'),
      at('data'),
      at('readOnly'),
      at('text'),
    ];

    expect(geometry.segments).toHaveLength(7);
    // Two columns, each node the same width as every other.
    expect(new Set(geometry.segments.map((one) => one.width)).size).toBe(1);
    expect(new Set(left.map((one) => one.x)).size).toBe(1);
    expect(new Set(right.map((one) => one.x)).size).toBe(1);
    expect(right[0].x).toBeGreaterThanOrEqual(left[0].x + left[0].width);
    // Registers first on the left; the rest descend the right in address order.
    expect(left[1].y).toBeGreaterThanOrEqual(left[0].y + left[0].height);
    right.slice(1).forEach((one, index) => {
      expect(one.y).toBeGreaterThanOrEqual(
        right[index].y + right[index].height
      );
    });
  });

  it('names the segments and the addresses they cover', () => {
    const geometry = mapOf(model(), new FoldState());
    const stack = geometry.segments.find((one) => one.key === 'stack');
    const bss = geometry.segments.find((one) => one.key === 'bss');

    expect(stack!.name).toBe('Stack');
    expect(stack!.addressLabel).toBe('0x1000 – 0x1004');
    // An empty segment still says where it would begin.
    expect(bss!.addressLabel).toBe('0x3800 –');
  });

  it('lines the columns up across every segment', () => {
    const geometry = mapOf(model(), new FoldState());
    const columns = geometry.segments.map((one) =>
      one.columns.map((column) => [column.key, column.x, column.width])
    );

    expect(
      columns.every((one) => JSON.stringify(one) === JSON.stringify(columns[0]))
    ).toBe(true);
    expect(geometry.segments[0].columns.map((column) => column.key)).toEqual([
      'address',
      'name',
      'value',
    ]);
  });

  it('writes the address as an address and the type above the object', () => {
    const geometry = mapOf(model(), new FoldState());
    const heap = geometry.segments.find((one) => one.key === 'heap');
    const row = heap!.rows[0];

    expect(row.kind).toBe('entry');
    // An address is written to the width it occupies, not the width of the
    // number that happens to be in it.
    expect(row.cells.map((one) => one.text)).toEqual([
      '0x00004E20',
      'Heap:0',
      '3',
    ]);
    // The type and how much room it takes sit in their own band on top.
    expect(row.caption?.text).toBe('int · 4 B');
    expect(row.caption!.height).toBeGreaterThan(0);
    expect(row.bandY).toBe(row.caption!.height);
  });

  it('leaves the value at the end of the row', () => {
    const geometry = mapOf(model(), new FoldState());
    const stack = geometry.segments.find((one) => one.key === 'stack');
    const row = stack!.rows.filter((one) => one.kind === 'entry')[0];
    const value = row.cells[row.cells.length - 1];

    expect(value.key).toBe('p-value');
    expect(value.x + value.width).toBe(stack!.x + stack!.width);
  });

  it('starts a segment holding nothing as its title bar alone', () => {
    const geometry = mapOf(model(), new FoldState());
    const at = (key: string) =>
      geometry.segments.find((one) => one.key === key)!;

    // Every empty segment is put away, and the ones with objects in them are
    // left open.
    for (const key of ['registers', 'text', 'readOnly', 'data', 'bss']) {
      expect(at(key).collapsed).toBe(true);
      expect(at(key).rows).toHaveLength(0);
      expect(at(key).height).toBe(at(key).titleHeight);
      // Put away is not gone: the bar still says where the segment begins.
      expect(at(key).addressLabel).not.toBe('');
    }
    expect(at('stack').collapsed).toBe(false);
    expect(at('heap').collapsed).toBe(false);
  });

  it('shows an empty segment it is asked to open as one line', () => {
    const step = model();
    const folds = new FoldState();
    folds.toggleSegment('text', true);
    const geometry = mapOf(step, folds);
    const text = geometry.segments.find((one) => one.key === 'text');

    expect(text!.collapsed).toBe(false);
    expect(text!.rows).toHaveLength(1);
    expect(text!.rows[0].kind).toBe('empty');
    expect(text!.height).toBeGreaterThan(text!.titleHeight);
  });

  it('starts the code and the constants on the map and put away', () => {
    const step = model();
    const literal = scalarRow('"hi"', 'const char[3]', '0x2710', 0x2710);
    step.memory = step.memory.map((segment) =>
      segment.key === 'readOnly' || segment.key === 'text'
        ? { ...segment, rows: [literal] }
        : segment
    );
    const drawn = (folds: FoldState) =>
      memoryGeometry(step, folds, new ViewOptions());
    const at = (geometry: MemoryGeometry, key: string) =>
      geometry.segments.find((one) => one.key === key)!;
    const geometry = drawn(new FoldState());

    // Neither is put away for being empty here, and neither is opened for
    // holding something: what is in them does not change as the program runs,
    // so they start as their title bars - on the map, and not read.
    for (const key of ['readOnly', 'text']) {
      expect(at(geometry, key)).toBeDefined();
      expect(at(geometry, key).collapsed).toBe(true);
      expect(at(geometry, key).height).toBe(at(geometry, key).titleHeight);
      expect(at(geometry, key).addressLabel).not.toBe('');
    }
    // The heap holds something too, and is open: this is these two bands.
    expect(at(geometry, 'heap').collapsed).toBe(false);

    // And a click opens one, as it does any other segment.
    const folds = new FoldState();
    folds.toggleSegment('readOnly', true);
    expect(at(drawn(folds), 'readOnly').collapsed).toBe(false);
    expect(at(drawn(folds), 'text').collapsed).toBe(true);
  });

  it('leaves an opened segment open once objects arrive in it', () => {
    const folds = new FoldState();
    folds.toggleSegment('heap', true);
    const filled = model();

    // The heap the user opened while it was empty is the same heap once the
    // first allocation lands in it.
    expect(
      mapOf(filled, folds).segments.find((one) => one.key === 'heap')!.collapsed
    ).toBe(false);
  });

  it('names the frame each run of stack rows belongs to', () => {
    const geometry = mapOf(model(), new FoldState());
    const stack = geometry.segments.find((one) => one.key === 'stack');

    expect(
      stack!.rows.filter((row) => row.kind === 'group').map((row) => row.label)
    ).toEqual(['main', 'sum']);
    // Rows are placed under the heading that announces them.
    stack!.rows.slice(1).forEach((row, index) => {
      expect(row.y).toBe(stack!.rows[index].y + stack!.rows[index].height);
    });
  });

  it('folds an aggregate away and keeps the columns still', () => {
    const step = model();
    const folds = new FoldState();
    const open = mapOf(step, folds);
    folds.toggle(group);
    const closed = mapOf(step, folds);
    const entries = (geometry: typeof open) =>
      geometry.segments
        .flatMap((one) => one.rows)
        .filter((row) => row.kind === 'entry').length;

    expect(entries(closed)).toBe(entries(open) - 1);
    expect(closed.segments[0].width).toBe(open.segments[0].width);
  });

  it('collapses a segment to its title bar', () => {
    const step = model();
    const folds = new FoldState();
    const open = mapOf(step, folds);
    folds.toggleSegment('stack');
    const closed = mapOf(step, folds);
    const at = (geometry: typeof open, key: string) =>
      geometry.segments.find((one) => one.key === key)!;
    const stack = at(closed, 'stack');

    expect(stack.collapsed).toBe(true);
    expect(stack.rows).toHaveLength(0);
    // Nothing but the bar: no column header, and no line saying it is empty.
    expect(stack.height).toBe(stack.titleHeight);
    expect(stack.columnHeaderHeight).toBe(0);
    // The columns are the map's, not the segment's, so they do not move.
    expect(stack.columns).toEqual(at(open, 'stack').columns);
    expect(stack.width).toBe(at(open, 'stack').width);
    // Its own column is shorter for it, and the column beside it stays where
    // it was: collapsing the stack is not a reason to redraw the heap.
    const wasOpen = at(open, 'stack');
    expect(stack.y + stack.height).toBeLessThan(wasOpen.y + wasOpen.height);
    expect(at(closed, 'heap').y).toBe(at(open, 'heap').y);
    // A pointer with an end inside it goes away with the rows it joined.
    expect(closed.arrows).toHaveLength(0);
  });

  it('moves the segments under a collapsed one up to meet it', () => {
    const step = model();
    const folds = new FoldState();
    const open = mapOf(step, folds);
    folds.toggleSegment('heap');
    const closed = mapOf(step, folds);
    const below = ['bss', 'data', 'readOnly', 'text'];
    const at = (geometry: typeof open, key: string) =>
      geometry.segments.find((one) => one.key === key)!;

    for (const key of below) {
      expect(at(closed, key).y).toBeLessThan(at(open, key).y);
    }
    expect(closed.height).toBeLessThan(open.height);
  });

  it('reopens a collapsed segment on a second click', () => {
    const step = model();
    const folds = new FoldState();
    const open = mapOf(step, folds);
    folds.toggleSegment('stack');
    folds.toggleSegment('stack');

    expect(mapOf(step, folds)).toEqual(open);
  });

  it('indents a member under the aggregate that holds it', () => {
    const geometry = mapOf(model(), new FoldState());
    const stack = geometry.segments.find((one) => one.key === 'stack');
    const rows = stack!.rows.filter((row) => row.kind === 'entry');

    expect(rows[1].fold?.target).toBe(group);
    expect(rows[2].indent).toBeGreaterThan(rows[1].indent);
  });

  it('routes a pointer from the value that holds the address to the address', () => {
    const geometry = mapOf(model(), new FoldState());

    expect(geometry.arrows).toHaveLength(1);
    const stack = geometry.segments.find((one) => one.key === 'stack');
    const value = stack!.rows[1].cells.find((one) => one.key === 'p-value');
    expect(value!.colors).toHaveLength(1);
    expect(geometry.arrows[0].color).toBe(value!.colors[0]);
  });

  it('runs an arrow within one column down the gutter beside it', () => {
    const geometry = mapOf(model(), new FoldState());
    const stack = geometry.segments.find((one) => one.key === 'stack')!;
    const cells = stack.rows.flatMap((row) => row.cells);
    const value = cells.find((one) => one.key === 'p-value')!;
    const address = cells.find((one) => one.key === 'a-address')!;
    const [arrow] = geometry.arrows;

    // Both ends are in the left column, so the line leaves and arrives on
    // that column's left-hand edge and is held out beyond it in between,
    // rather than crossing back over the segments it connects.
    expect(arrow.from.x).toBeLessThanOrEqual(stack.x);
    expect(arrow.to.x).toBeLessThanOrEqual(stack.x);
    // Out of the row, straight down the gutter, and back in at the row it
    // names: both turns are on the same line, clear of the column.
    expect(arrow.vertices).toHaveLength(2);
    expect(arrow.vertices![0].x).toBeLessThan(arrow.to.x);
    expect(arrow.vertices![0].x).toBe(arrow.vertices![1].x);
    expect(arrow.vertices![0].y).toBe(arrow.from.y);
    expect(arrow.vertices![1].y).toBe(arrow.to.y);
    // And it stays on the map.
    expect(arrow.vertices![0].x).toBeGreaterThan(0);
    // It is the rows it joins, not the address column inside them.
    expect(arrow.from.y).toBe(value.y + value.height / 2);
    expect(arrow.to.y).toBe(address.y + address.height / 2);
  });

  it('turns an arrow between the columns towards the side it is going', () => {
    const step = model();
    // The stack's pointer names the heap block instead: left column to right.
    step.pointers = [{ from: 'p-value', to: 'Heap:0-address' }];
    const geometry = mapOf(step, new FoldState());
    const stack = geometry.segments.find((one) => one.key === 'stack')!;
    const heap = geometry.segments.find((one) => one.key === 'heap')!;
    const [arrow] = geometry.arrows;

    expect(arrow.from.x).toBeGreaterThanOrEqual(stack.x + stack.width);
    expect(arrow.to.x).toBeLessThanOrEqual(heap.x);
    // Out of the stack, down the space between the columns, into the heap.
    expect(arrow.vertices).toHaveLength(2);
    arrow.vertices!.forEach((vertex) => {
      expect(vertex.x).toBeGreaterThan(stack.x + stack.width);
      expect(vertex.x).toBeLessThan(heap.x);
    });
    expect(arrow.vertices![0].y).toBe(arrow.from.y);
    expect(arrow.vertices![1].y).toBe(arrow.to.y);
  });

  it('brings an arrow from the right column back down the same gap', () => {
    const step = model();
    // The heap block names the array on the stack: right column to left.
    step.pointers = [{ from: 'Heap:0-value', to: 'a-address' }];
    const geometry = mapOf(step, new FoldState());
    const stack = geometry.segments.find((one) => one.key === 'stack')!;
    const heap = geometry.segments.find((one) => one.key === 'heap')!;
    const [arrow] = geometry.arrows;

    // It leaves by the side that faces where it is going, not by the far one,
    // and never crosses the node it came from.
    expect(arrow.from.x).toBeLessThanOrEqual(heap.x);
    expect(arrow.to.x).toBeGreaterThanOrEqual(stack.x + stack.width);
    expect(arrow.vertices).toHaveLength(2);
    arrow.vertices!.forEach((vertex) => {
      expect(vertex.x).toBeGreaterThan(stack.x + stack.width);
      expect(vertex.x).toBeLessThan(heap.x);
    });
  });

  it('gives each crossing a lane of its own between the columns', () => {
    const step = model();
    step.pointers = [
      { from: 'p-value', to: 'Heap:0-address' },
      { from: 'Heap:0-value', to: 'a-address' },
    ];
    const geometry = mapOf(step, new FoldState());
    const stack = geometry.segments.find((one) => one.key === 'stack')!;
    const heap = geometry.segments.find((one) => one.key === 'heap')!;
    const lanes = geometry.arrows.map((arrow) => arrow.vertices![0].x);

    expect(new Set(lanes).size).toBe(2);
    // The gap widened to hold them both, so neither runs over a node.
    lanes.forEach((lane) => {
      expect(lane).toBeGreaterThan(stack.x + stack.width);
      expect(lane).toBeLessThan(heap.x);
    });
  });

  it('holds the arrows sharing a gutter apart, and all of them on the map', () => {
    const step = model();
    step.pointers = [
      { from: 'p-value', to: 'a-address' },
      { from: 'a-value', to: 'a[0]-address' },
    ];
    const geometry = mapOf(step, new FoldState());
    const stack = geometry.segments.find((one) => one.key === 'stack')!;
    const [first, second] = geometry.arrows;

    // Each arrow takes the next lane out, and the map has moved right far
    // enough that the outermost one is still on it.
    expect(second.vertices![0].x).toBeLessThan(first.vertices![0].x);
    expect(second.vertices![0].x).toBeGreaterThan(0);
    expect(first.vertices![0].x).toBeLessThan(stack.x);
  });

  it("runs the right-hand column's own arrow down its right-hand side", () => {
    const step = model();
    // A heap block naming itself: both ends are in the right column, whose
    // outside is the right of the map, away from the crossing pointers.
    step.pointers = [{ from: 'Heap:0-value', to: 'Heap:0-address' }];
    const geometry = mapOf(step, new FoldState());
    const heap = geometry.segments.find((one) => one.key === 'heap')!;
    const [arrow] = geometry.arrows;

    expect(arrow.from.x).toBeGreaterThanOrEqual(heap.x + heap.width);
    expect(arrow.vertices![0].x).toBeGreaterThan(arrow.from.x);
    expect(arrow.vertices![0].x).toBeLessThan(geometry.width);
  });

  it('drops an arrow whose target is folded away', () => {
    const step = model();
    const folds = new FoldState();
    folds.toggle(group);

    expect(mapOf(step, folds).arrows).toHaveLength(1);
    // The aggregate's own row survives a fold; its members do not.
    step.pointers = [{ from: 'p-value', to: 'a[0]-address' }];
    expect(mapOf(step, folds).arrows).toHaveLength(0);
  });

  it('leaves a region holding nothing off the map until it is asked for', () => {
    const view = new ViewOptions();
    const step = model();
    const drawn = () =>
      memoryGeometry(step, new FoldState(), view).segments.map(
        (one) => one.key
      );

    // The two segments this step has anything in, and the two static bands,
    // which are on the map whatever they hold.
    expect(drawn()).toEqual(['stack', 'heap', 'readOnly', 'text']);

    view.showRegion('bss', true);
    expect(drawn()).toEqual(['stack', 'heap', 'bss', 'readOnly', 'text']);
  });

  it('names the stack and the heap before the program fills them', () => {
    const step = model();
    // The step before the first call and the first allocation: neither band
    // holds anything, and both are still on the map, as their title bar alone.
    for (const segment of step.memory) {
      if (segment.key === 'stack' || segment.key === 'heap') {
        segment.rows = [];
        segment.groups = [];
      }
    }
    step.pointers = [];
    const map = memoryGeometry(step, new FoldState(), new ViewOptions());
    const at = (key: string) => map.segments.find((one) => one.key === key)!;

    expect(map.segments.map((one) => one.key)).toEqual([
      'stack',
      'heap',
      'readOnly',
      'text',
    ]);
    expect(at('stack').collapsed).toBe(true);
    expect(at('heap').collapsed).toBe(true);
    // Put away is not gone: each still says where its first object will land.
    expect(at('heap').rows).toHaveLength(0);
    expect(at('heap').addressLabel).toBe('0x4E20 –');
  });

  it('takes a region off the map when the reader switches it off', () => {
    const view = everything();
    view.showRegion('bss', false);
    const step = model();
    const open = mapOf(step, new FoldState());
    const closed = mapOf(step, new FoldState(), view);
    const at = (geometry: typeof open, key: string) =>
      geometry.segments.find((one) => one.key === key);

    expect(at(closed, 'bss')).toBeUndefined();
    expect(closed.segments).toHaveLength(open.segments.length - 1);
    // Unlike a collapse, the map closes up over it: what was under the BSS
    // takes the place it left.
    expect(at(closed, 'data')!.y).toBeLessThan(at(open, 'data')!.y);
  });

  it('keeps a region the reader asked for once it fills up', () => {
    const view = new ViewOptions();
    view.showRegion('heap', false);
    const step = model();

    // The heap holds an object at this step, and is off because they said so.
    expect(
      memoryGeometry(step, new FoldState(), view).segments.map((one) => one.key)
    ).toEqual(['stack', 'readOnly', 'text']);
  });

  it('drops a pointer into a region that is switched off', () => {
    const view = everything();
    const step = model();
    step.pointers = [{ from: 'p-value', to: 'Heap:0-address' }];

    expect(mapOf(step, new FoldState(), view).arrows).toHaveLength(1);
    view.showRegion('heap', false);
    expect(mapOf(step, new FoldState(), view).arrows).toHaveLength(0);
  });

  it('draws an empty map rather than the tables when every region is off', () => {
    const view = everything();
    for (const region of MEMORY_REGIONS) {
      view.showRegion(region, false);
    }

    expect(memoryGeometry(model(), new FoldState(), view).segments).toEqual([]);
    // The model still has its memory, which is what decides that this step is
    // drawn as a map at all.
    expect(model().memory).not.toHaveLength(0);
  });

  it('keeps the call-frame tables for a step that carries no segments', () => {
    const step = emptyStepModel();
    step.stacks = [
      { key: 'main', name: 'main', rows: [scalarRow('x', 'int', '1', 0x20)] },
    ];

    expect(mapOf(step, new FoldState()).segments).toHaveLength(0);
    expect(graphGeometry(step, new FoldState()).stacks).toHaveLength(1);
  });
});
