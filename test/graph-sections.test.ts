import { leftAlignedLabel } from '../src/ui/graph/PlivetGraph';

describe('the textual canvas sections', () => {
  it('overrides both centered JointJS coordinates', () => {
    expect(leftAlignedLabel(10, 38)).toEqual({
      x: 10,
      y: 19,
      textAnchor: 'start',
      textVerticalAnchor: 'middle',
    });
  });
});
