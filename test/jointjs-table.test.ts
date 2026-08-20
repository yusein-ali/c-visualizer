import { stackTableOf } from '../src/ui/graph/StackTable';

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
