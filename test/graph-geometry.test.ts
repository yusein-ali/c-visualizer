import {
  CELL_HEIGHT,
  FoldState,
  MemoryRegion,
  StepModel,
  cellWidth,
  emptyStepModel,
  foldGroupOf,
} from '../src/core';
import { graphGeometry } from '../src/ui/graph/geometry';

const regions: MemoryRegion[] = [
  'registers',
  'text',
  'readOnly',
  'data',
  'bss',
  'heap',
  'stack',
];

const model = (): StepModel => {
  const result = emptyStepModel();
  result.memory = regions.map((key, index) => ({
    key,
    name: key,
    startAddress: 0x1000 * (index + 1),
    rows: [],
  }));
  const group = foldGroupOf(undefined, 'array');
  result.memory[6].rows = [
    [
      {
        key: 'array-fold',
        text: '',
        kind: 'fold',
        width: cellWidth(' '),
        foldTarget: group,
      },
    ],
    [
      {
        key: 'array-member',
        text: 'member',
        kind: 'value',
        width: cellWidth('member'),
        foldGroup: group,
      },
    ],
  ];
  return result;
};

describe('JointJS graph geometry', () => {
  it('lays out every standard segment, including empty ones', () => {
    const geometry = graphGeometry(model(), new FoldState());
    expect(geometry.stacks).toHaveLength(regions.length);
    expect(geometry.stacks.map((stack) => stack.name)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Registers'),
        expect.stringContaining('Text'),
        expect.stringContaining('BSS'),
      ])
    );
    expect(geometry.stacks.every((stack) => stack.width > 0)).toBe(true);
    expect(geometry.stacks[0].height).toBe(CELL_HEIGHT);
  });

  it('keeps fold state while the model is laid out again', () => {
    const step = model();
    const folds = new FoldState();
    const open = graphGeometry(step, folds);
    folds.toggle(step.memory[6].rows[0][0].foldTarget!);
    const closed = graphGeometry(step, folds);
    const count = (geometry: typeof open) =>
      geometry.stacks.reduce((sum, stack) => sum + stack.rows.length, 0);
    expect(count(closed)).toBe(count(open) - 1);
  });
});
