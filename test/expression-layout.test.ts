import { ExpressionNodeModel } from '../src/core';
import { expressionGeometry } from '../src/ui/graph/expressionLayout';

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
});
