import { dia } from '@joint/core';
import { ExpressionNodeModel } from '../src/core';
import {
  compactExpressionValue,
  expressionCells,
  expressionNodeOf,
  fitExpressionValue,
} from '../src/ui/graph/ExpressionNode';
import {
  EXPRESSION_LAYOUT,
  expressionGeometry,
} from '../src/ui/graph/expressionLayout';

const model = (
  changes: Partial<ExpressionNodeModel> = {}
): ExpressionNodeModel => ({
  key: 'expression-0',
  kind: 'operand',
  text: 'n',
  range: {
    begin: { x: 4, y: 1 },
    end: { x: 5, y: 1 },
  },
  value: '0',
  children: [],
  ...changes,
});

const node = (changes: Partial<ExpressionNodeModel> = {}) =>
  expressionNodeOf({
    node: model(changes),
    x: 24,
    y: 40,
    width: 138,
    height: 54,
  });

const attr = (element: dia.Element, selector: string): Record<string, any> =>
  (element.get('attrs') as Record<string, Record<string, any>>)[selector];

describe('ExpressionNode', () => {
  it('draws the current value in a separate inset region without an equals sign', () => {
    const element = node();

    expect(element.get('type')).toBe('plivet.ExpressionNode');
    expect(element.position()).toEqual({ x: 24, y: 40 });
    expect(attr(element, 'label').text).toBe('n');
    expect(attr(element, 'valueCaption').text).toBe('Current value');
    expect(attr(element, 'valueText').text).toBe('0');
    expect(attr(element, 'valueBody')).toMatchObject({
      fill: expect.stringContaining('--plivet-graph-expression-value'),
      stroke: expect.stringContaining('--plivet-graph-expression-value-border'),
    });
    expect(attr(element, 'label').y).toBeLessThan(attr(element, 'valueText').y);
  });

  it('does not draw an empty value region before a result is available', () => {
    const element = node({ value: null });
    const attrs = element.get('attrs') as Record<string, unknown>;

    expect(Object.keys(attrs)).toEqual(['body', 'label']);
    expect(attr(element, 'label').y).toBe(27);
  });

  it('does not repeat a literal value or show parameter plumbing', () => {
    const element = node({ text: '0', value: '0', parameter: 'n' });
    const attrs = element.get('attrs') as Record<string, unknown>;

    expect(attr(element, 'label').text).toBe('0');
    expect(Object.keys(attrs)).toEqual(['body', 'label']);
  });

  it('keeps assignment operators as a single equals block', () => {
    const element = node({ kind: 'assignment', text: '=', value: '0' });
    const attrs = element.get('attrs') as Record<string, unknown>;

    expect(attr(element, 'label').text).toBe('=');
    expect(attrs.valueBody).toBeUndefined();
  });

  it('shows only the first array member and keeps the full value as its title', () => {
    const element = node({ text: 'arr', value: '[1, 2, 3, 0, 0]' });

    expect(attr(element, 'valueText').text).toBe('[1, …]');
    expect(attr(element, 'valueBody').title).toBe('[1, 2, 3, 0, 0]');
  });

  it('keeps a long array value clear of its caption', () => {
    const full = 'C[0x177765ED, 0x177765F1]';
    const element = node({ text: 'pd_arr', value: full });
    const caption = attr(element, 'valueCaption');
    const value = attr(element, 'valueText');

    expect(value.text).toBe('C[…]');
    expect(value.textWrap).toMatchObject({ ellipsis: true });
    expect(value.x - value.text.length * 7.2).toBeGreaterThan(caption.x + 60);
    expect(attr(element, 'valueBody').title).toBe(full);
  });
});

describe('compactExpressionValue', () => {
  it('leaves scalars and one-element arrays unchanged', () => {
    expect(compactExpressionValue('42')).toBe('42');
    expect(compactExpressionValue('[42]')).toBe('[42]');
  });

  it('finds the first complete top-level member', () => {
    expect(compactExpressionValue('[[1, 2], [3, 4]]')).toBe('[[1, 2], …]');
    expect(compactExpressionValue("[',' (44), 'x' (120)]")).toBe(
      "[',' (44), …]"
    );
    expect(compactExpressionValue('C[0x1, 0x2]')).toBe('C[0x1, …]');
  });

  it('preserves aggregate notation when the first member is too wide', () => {
    expect(fitExpressionValue('[0x177765ED, …]', 44)).toBe('[…]');
    expect(fitExpressionValue('C[0x177765ED, …]', 44)).toBe('C[…]');
    expect(fitExpressionValue('123456789', 44)).toBe('12345…');
  });
});

describe('a conversion pill', () => {
  const pill = (
    changes: Partial<ExpressionNodeModel> = {},
    highlighted = false
  ) =>
    expressionNodeOf(
      {
        node: model({
          kind: 'conversion',
          text: 'int → double',
          type: 'double',
          value: null,
          children: [model({ text: 'i', type: 'int', value: '5' })],
          ...changes,
        }),
        x: 10,
        y: 20,
        width: 100,
        height: 34,
      },
      highlighted
    );

  it('is a dashed pill naming both types, distinct from a box', () => {
    const element = pill();
    const body = attr(element, 'body');

    expect(body).toMatchObject({
      fill: expect.stringContaining('--plivet-graph-expression-conversion'),
      stroke: expect.stringContaining(
        '--plivet-graph-expression-conversion-border'
      ),
      strokeDasharray: '4 3',
      rx: 9,
    });
    expect(body.title).toBe('Implicit conversion: int → double');
    expect(attr(element, 'label').text).toBe('int → double');
    expect(attr(element, 'label').y).toBe(17);
    expect(Object.keys(element.get('attrs') as object)).toEqual([
      'body',
      'label',
    ]);
  });

  it('shows the converted value under the types once there is one', () => {
    const element = pill({ value: '5.0' });

    expect(attr(element, 'valueText').text).toBe('5.0');
    expect(attr(element, 'label').y).toBeLessThan(attr(element, 'valueText').y);
    expect(attr(element, 'body').title).toBe(
      'Implicit conversion: int → double\nCurrent value: 5.0'
    );
  });

  it('is outlined solid when highlighted', () => {
    const body = attr(pill({}, true), 'body');

    expect(body.stroke).toContain('--plivet-graph-focus-line');
    expect(body.strokeDasharray).toBe('none');
  });
});

describe('highlighting and types on a box', () => {
  it('outlines the highlighted box and names its type on hover', () => {
    const element = expressionNodeOf(
      {
        node: model({ text: '/', kind: 'operator', type: 'double' }),
        x: 0,
        y: 0,
        width: 138,
        height: 54,
      },
      true
    );
    const body = attr(element, 'body');

    expect(body.stroke).toContain('--plivet-graph-focus-line');
    expect(body.strokeWidth).toBe(3);
    expect(body.title).toBe('/\nType: double');
  });

  it('builds every box, pill and link of a laid-out tree', () => {
    const i = model({ key: 'i', text: 'i', type: 'int' });
    const conversion = model({
      key: 'c',
      kind: 'conversion',
      text: 'int → double',
      type: 'double',
      value: null,
      children: [i],
    });
    const root = model({
      key: 'root',
      kind: 'operator',
      text: '/',
      value: null,
      children: [conversion, model({ key: 'two', text: '2.0', value: null })],
    });
    const cells = expressionCells(
      expressionGeometry(root, { x: 0, y: 0 }, EXPRESSION_LAYOUT),
      new Set(['c'])
    );
    const elements = cells.filter((cell) => cell.isElement());
    const links = cells.filter((cell) => cell.isLink());

    expect(elements).toHaveLength(4);
    expect(links).toHaveLength(3);
    const highlighted = elements.filter((element) =>
      String(attr(element as dia.Element, 'body').stroke).includes('focus-line')
    );
    expect(highlighted).toHaveLength(1);
    expect(attr(highlighted[0] as dia.Element, 'label').text).toBe(
      'int → double'
    );
  });
});
