import { ExpressionNodeModel } from '../src/core';
import {
  CONVERSION_GAP,
  CONVERSION_HEIGHT,
  conversionWidth,
  expressionGeometry,
} from '../src/ui/graph/expressionLayout';

const options = { nodeWidth: 100, nodeHeight: 60, gapX: 20, gapY: 30 };
let key = 0;
const node = (
  text: string,
  changes: Partial<ExpressionNodeModel> = {}
): ExpressionNodeModel => ({
  key: `node-${key++}`,
  kind: 'operand',
  text,
  range: { begin: { x: 0, y: 1 }, end: { x: 1, y: 1 } },
  value: null,
  children: [],
  ...changes,
});

const layout = (root: ExpressionNodeModel) =>
  expressionGeometry(root, { x: 10, y: 20 }, options);

beforeEach(() => {
  key = 0;
});

describe('assignment expression layout', () => {
  it('places a simple target, equals and right expression beside each other', () => {
    const left = node('result');
    const right = node('+', {
      kind: 'operator',
      children: [node('a'), node('b')],
    });
    const assignment = node('=', {
      kind: 'assignment',
      children: [left, right],
    });
    const geometry = layout(assignment);
    const leftBox = geometry.nodes.find((one) => one.node === left)!;
    const equalsBox = geometry.nodes.find((one) => one.node === assignment)!;
    const rightBox = geometry.nodes.find((one) => one.node === right)!;

    expect(equalsBox.x).toBe(leftBox.x + leftBox.width + options.gapX);
    expect(rightBox.x).toBe(equalsBox.x + equalsBox.width + options.gapX);
    expect([leftBox.y, equalsBox.y, rightBox.y]).toEqual([20, 20, 20]);
    expect(geometry.links.slice(0, 2)).toMatchObject([
      {
        source: { x: equalsBox.x, y: equalsBox.y + 30 },
        target: { x: leftBox.x + leftBox.width, y: leftBox.y + 30 },
        vertices: [],
      },
      {
        source: { x: equalsBox.x + equalsBox.width, y: equalsBox.y + 30 },
        target: { x: rightBox.x, y: rightBox.y + 30 },
        vertices: [],
      },
    ]);
  });

  it('keeps the assignment operator between a computed target and value', () => {
    const left = node('[]', {
      kind: 'operator',
      children: [node('a'), node('i')],
    });
    const right = node('3');
    const assignment = node('=', {
      kind: 'assignment',
      children: [left, right],
    });
    const geometry = layout(assignment);
    const boxes = [left, assignment, right].map(
      (item) => geometry.nodes.find((one) => one.node === item)!
    );

    expect(boxes.map((box) => box.y)).toEqual([20, 20, 20]);
    expect(boxes[0].x).toBeLessThan(boxes[1].x);
    expect(boxes[1].x).toBeLessThan(boxes[2].x);
    expect(
      geometry.links.slice(0, 2).every((link) => link.vertices.length === 0)
    ).toBe(true);
  });
});

describe('operand connector ports', () => {
  it('distributes two operand connectors across the bottom edge', () => {
    const root = node('+', {
      kind: 'operator',
      children: [node('a'), node('b')],
    });
    const geometry = layout(root);
    const parent = geometry.nodes.find((one) => one.node === root)!;

    expect(geometry.links.map((link) => link.source)).toEqual([
      {
        x: parent.x + parent.width / 3,
        y: parent.y + parent.height,
      },
      {
        x: parent.x + (parent.width * 2) / 3,
        y: parent.y + parent.height,
      },
    ]);
  });

  it('gives every child its own bottom port', () => {
    const root = node('call()', {
      kind: 'operator',
      children: ['a', 'b', 'c', 'd', 'e', 'f'].map((text) => node(text)),
    });
    const geometry = layout(root);
    const parent = geometry.nodes.find((one) => one.node === root)!;
    const sources = geometry.links.slice(0, 6).map((link) => link.source);

    expect(
      sources.filter((source) => source.y === parent.y + parent.height)
    ).toHaveLength(6);
    expect(new Set(sources.map((source) => source.x)).size).toBe(6);
  });

  it('centres a wide parent over its middle branch', () => {
    const middle = node('.', { kind: 'operator', children: [node('b')] });
    const root = node('?:', {
      kind: 'operator',
      children: [
        node('>', {
          kind: 'operator',
          children: [node('a'), node('wide')],
        }),
        middle,
        node('c'),
      ],
    });
    const geometry = layout(root);
    const parent = geometry.nodes.find((one) => one.node === root)!;
    const middleBox = geometry.nodes.find((one) => one.node === middle)!;

    expect(parent.x + parent.width / 2).toBe(middleBox.x + middleBox.width / 2);
  });
});

describe('conversion layout', () => {
  const conversion = (
    text: string,
    child: ExpressionNodeModel
  ): ExpressionNodeModel =>
    node(text, { kind: 'conversion', children: [child] });

  it('puts a conversion on the edge, above the operand it converts', () => {
    const i = node('i');
    const converted = conversion('int → double', i);
    const two = node('2.0');
    const root = node('/', { kind: 'operator', children: [converted, two] });
    const geometry = layout(root);
    const box = (item: ExpressionNodeModel) =>
      geometry.nodes.find((one) => one.node === item)!;
    const [parent, pill, operand, sibling] = [root, converted, i, two].map(box);

    expect(pill.height).toBe(CONVERSION_HEIGHT);
    expect(pill.width).toBe(conversionWidth(converted, options.nodeWidth));
    // Between the operator and the operand, centred over the operand.
    expect(pill.y).toBe(parent.y + parent.height + options.gapY);
    expect(operand.y).toBe(pill.y + pill.height + CONVERSION_GAP);
    expect(pill.x + pill.width / 2).toBe(operand.x + operand.width / 2);
    // The other operand is lowered to the same row.
    expect(sibling.y).toBe(operand.y);
    expect(sibling.x).toBeGreaterThan(operand.x + operand.width);
    expect(geometry.height).toBe(operand.y + operand.height - parent.y);

    const linkTo = (child: ExpressionNodeModel) =>
      geometry.links.find((link) => link.child === child.key)!;
    // The operator reaches the pill and the sibling, turning at one height.
    expect(linkTo(converted).target).toEqual({
      x: pill.x + pill.width / 2,
      y: pill.y,
    });
    expect(linkTo(converted).vertices[0].y).toBe(linkTo(two).vertices[0].y);
    // The pill drops straight into its operand.
    expect(linkTo(i)).toMatchObject({
      parent: converted.key,
      source: { x: operand.x + operand.width / 2, y: pill.y + pill.height },
      target: { x: operand.x + operand.width / 2, y: operand.y },
      vertices: [],
    });
  });

  it('puts an assignment conversion on the row, between = and the value', () => {
    const target = node('c');
    const value = node('300');
    const converted = conversion('int → char', value);
    const root = node('=', {
      kind: 'assignment',
      children: [target, converted],
    });
    const geometry = layout(root);
    const [left, equals, pill, right] = [target, root, converted, value].map(
      (item) => geometry.nodes.find((one) => one.node === item)!
    );

    expect(equals.x).toBe(left.x + left.width + options.gapX);
    expect(pill.x).toBe(equals.x + equals.width + options.gapX);
    expect(right.x).toBe(pill.x + pill.width + options.gapX);
    const middle = (box: { y: number; height: number }) =>
      box.y + box.height / 2;
    expect([left, equals, pill, right].map(middle)).toEqual(
      Array(4).fill(middle(equals))
    );
    expect(geometry.links).toHaveLength(3);
    expect(geometry.links.every((link) => link.vertices.length === 0)).toBe(
      true
    );
    expect(geometry.links.map((link) => [link.parent, link.child])).toEqual([
      [root.key, target.key],
      [root.key, converted.key],
      [converted.key, value.key],
    ]);
  });

  it('never overlaps the boxes of a chained assignment', () => {
    const inner = node('=', {
      kind: 'assignment',
      children: [node('b'), node('4')],
    });
    const root = node('=', {
      kind: 'assignment',
      children: [node('a'), conversion('int → double', inner)],
    });
    const boxes = layout(root).nodes;
    for (const one of boxes) {
      for (const other of boxes) {
        if (one === other) continue;
        const apart =
          one.x + one.width <= other.x ||
          other.x + other.width <= one.x ||
          one.y + one.height <= other.y ||
          other.y + other.height <= one.y;
        expect(apart).toBe(true);
      }
    }
  });

  it('keeps its shape while values are filled in', () => {
    const tree = (value: string | null) =>
      node('<', {
        kind: 'operator',
        children: [conversion('int → unsigned int', node('-1')), node('0u')],
        value,
      });
    key = 0;
    const before = layout(tree(null));
    key = 0;
    const after = layout(tree('0'));
    key = 0;
    const pillValue = tree(null);
    pillValue.children[0].value = '4294967295';
    const strip = (geometry: ReturnType<typeof layout>) =>
      geometry.nodes.map(({ x, y, width, height }) => [x, y, width, height]);
    expect(strip(after)).toEqual(strip(before));
    expect(strip(layout(pillValue))).toEqual(strip(before));
  });
});
