import type { ExpressionNodeModel, Point } from '../../core';

export interface ExpressionLayoutOptions {
  nodeWidth: number;
  nodeHeight: number;
  gapX: number;
  gapY: number;
}

/**
 * The canvas's expression geometry. `c-expression.js` lays its trees out with
 * the same numbers, so a tree on a course page and the same tree on the
 * canvas look alike.
 */
export const EXPRESSION_LAYOUT: Readonly<ExpressionLayoutOptions> = {
  nodeWidth: 138,
  nodeHeight: 54,
  gapX: 18,
  gapY: 30,
};

/** A conversion is a pill: one line for the types, one for the value. */
export const CONVERSION_HEIGHT = 34;
/** Between a conversion and the operand it converts. */
export const CONVERSION_GAP = 12;
/** The types line, in a monospace face. */
export const CONVERSION_FONT_SIZE = 10;
const CONVERSION_CHARACTER_WIDTH = 6.1;
const CONVERSION_PADDING_X = 10;
const CONVERSION_MIN_WIDTH = 90;

/**
 * Wide enough for the types it names, so `unsigned char → unsigned int` is
 * not cut short - a conversion whose target is hidden says nothing. It is a
 * function of the text alone, not of the value, so a tree being revealed one
 * value at a time keeps its shape.
 */
export const conversionWidth = (
  node: ExpressionNodeModel,
  nodeWidth: number
): number =>
  Math.min(
    Math.round(nodeWidth * 1.4),
    Math.max(
      CONVERSION_MIN_WIDTH,
      Math.ceil(node.text.length * CONVERSION_CHARACTER_WIDTH) +
        2 * CONVERSION_PADDING_X
    )
  );

export interface ExpressionNodeGeometry {
  node: ExpressionNodeModel;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExpressionLinkGeometry {
  parent: string;
  child: string;
  source: Point;
  target: Point;
  vertices: Point[];
}

export interface ExpressionGeometry {
  nodes: ExpressionNodeGeometry[];
  links: ExpressionLinkGeometry[];
  width: number;
  height: number;
}

interface LocalLayout {
  nodes: ExpressionNodeGeometry[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const isConversion = (node: ExpressionNodeModel): boolean =>
  node.kind === 'conversion' && node.children.length === 1;

const moved = (layout: LocalLayout, dx: number, dy: number): LocalLayout => ({
  nodes: layout.nodes.map((geometry) => ({
    ...geometry,
    x: geometry.x + dx,
    y: geometry.y + dy,
  })),
  minX: layout.minX + dx,
  minY: layout.minY + dy,
  maxX: layout.maxX + dx,
  maxY: layout.maxY + dy,
});

const joined = (
  root: ExpressionNodeGeometry,
  children: LocalLayout[]
): LocalLayout => ({
  nodes: [root, ...children.flatMap((child) => child.nodes)],
  minX: Math.min(root.x, ...children.map((child) => child.minX)),
  minY: Math.min(root.y, ...children.map((child) => child.minY)),
  maxX: Math.max(root.x + root.width, ...children.map((child) => child.maxX)),
  maxY: Math.max(root.y + root.height, ...children.map((child) => child.maxY)),
});

/**
 * How far a layout reaches left and right along the row its root is on. An
 * assignment's operands are placed beside it by this rather than by their
 * roots, so a row that is itself several boxes wide - `b = c` on the right of
 * `a = b = c`, or a conversion with its operand - never runs into the `=`.
 */
const rowExtent = (
  layout: LocalLayout,
  rowHeight: number
): { minX: number; maxX: number } => {
  const row = layout.nodes.filter(
    (geometry) => geometry.y < rowHeight && 0 < geometry.y + geometry.height
  );
  return {
    minX: Math.min(...row.map((geometry) => geometry.x)),
    maxX: Math.max(...row.map((geometry) => geometry.x + geometry.width)),
  };
};

/** How many conversions stand over an operand, one above the other. */
const conversionDepth = (node: ExpressionNodeModel): number =>
  isConversion(node) ? 1 + conversionDepth(node.children[0]) : 0;

/**
 * Keys of the conversions drawn along an assignment's row rather than above
 * their operand, which the links need to know to leave them by the side.
 */
type Horizontal = Set<string>;

/**
 * Layout relative to the root's centre at x=0.
 *
 * Ordinary operators remain trees. Assignments are the exception because C
 * reads them left-to-right: target, assignment operator and right expression
 * are three peers. Descendants of either expression can still grow down from
 * their own root.
 *
 * A conversion is drawn on the edge it belongs to: a pill between the
 * operator and the operand it converts. Under an operator it sits above the
 * operand, and every operand of that operator is lowered to the same row, so
 * `i / 2.0` still reads as two operands side by side with `int → double` over
 * the first. Beside an assignment it sits on the row, between the `=` and the
 * value.
 */
const localLayout = (
  node: ExpressionNodeModel,
  options: ExpressionLayoutOptions,
  horizontal: Horizontal
): LocalLayout => {
  const { nodeWidth, nodeHeight, gapX, gapY } = options;

  if (isConversion(node)) {
    const width = conversionWidth(node, nodeWidth);
    const pill: ExpressionNodeGeometry = {
      node,
      x: -width / 2,
      y: 0,
      width,
      height: CONVERSION_HEIGHT,
    };
    const operand = localLayout(node.children[0], options, horizontal);
    const operandRoot = operand.nodes[0];
    return joined(pill, [
      moved(
        operand,
        -(operandRoot.x + operandRoot.width / 2),
        CONVERSION_HEIGHT + CONVERSION_GAP
      ),
    ]);
  }

  const root: ExpressionNodeGeometry = {
    node,
    x: -nodeWidth / 2,
    y: 0,
    width: nodeWidth,
    height: nodeHeight,
  };

  if (node.kind === 'assignment' && node.children.length === 2) {
    const left = localLayout(node.children[0], options, horizontal);
    const right = rowLayout(node.children[1], options, horizontal);
    return joined(root, [
      moved(left, root.x - gapX - rowExtent(left, nodeHeight).maxX, 0),
      moved(
        right,
        root.x + root.width + gapX - rowExtent(right, nodeHeight).minX,
        0
      ),
    ]);
  }

  if (node.children.length === 0) {
    return joined(root, []);
  }

  const children = node.children.map((child) =>
    localLayout(child, options, horizontal)
  );
  const depths = node.children.map(conversionDepth);
  const deepest = Math.max(...depths);
  const span =
    children.reduce((width, child) => width + (child.maxX - child.minX), 0) +
    gapX * (children.length - 1);
  let cursor = -span / 2;
  const placed = children.map((child, index) => {
    const lowered =
      (deepest - depths[index]) * (CONVERSION_HEIGHT + CONVERSION_GAP);
    const result = moved(
      child,
      cursor - child.minX,
      nodeHeight + gapY + lowered
    );
    cursor += child.maxX - child.minX + gapX;
    return result;
  });
  if (placed.length > 2) {
    // A wide first branch otherwise pulls the parent left. Anchor the parent
    // over the middle branch, which keeps the second leaf under its operator
    // and leaves the branch spacing unchanged.
    const middle = placed[Math.floor(placed.length / 2)];
    const middleCenter = (middle.minX + middle.maxX) / 2;
    return joined({ ...root, x: middleCenter - root.width / 2 }, placed);
  }
  return joined(root, placed);
};

/**
 * An assignment's value, with any conversions over it laid out along the
 * row: `=`, then each conversion, then the value, left to right.
 */
const rowLayout = (
  node: ExpressionNodeModel,
  options: ExpressionLayoutOptions,
  horizontal: Horizontal
): LocalLayout => {
  if (!isConversion(node)) {
    return localLayout(node, options, horizontal);
  }
  horizontal.add(node.key);
  const width = conversionWidth(node, options.nodeWidth);
  const pill: ExpressionNodeGeometry = {
    node,
    x: 0,
    y: (options.nodeHeight - CONVERSION_HEIGHT) / 2,
    width,
    height: CONVERSION_HEIGHT,
  };
  const operand = rowLayout(node.children[0], options, horizontal);
  return joined(pill, [
    moved(
      operand,
      width + options.gapX - rowExtent(operand, options.nodeHeight).minX,
      0
    ),
  ]);
};

/**
 * Distinct bottom ports for an operator's children, in their source order.
 *
 * The vertical sides are reserved for the horizontal assignment relationship.
 * Otherwise an assignment value such as an initializer list would have both
 * its incoming assignment link and its first child link sharing the same side,
 * making two different relationships look like one connector.
 */
const portsFor = (parent: ExpressionNodeGeometry, count: number): Point[] =>
  Array.from({ length: count }, (_, index) => ({
    x: parent.x + (parent.width * (index + 1)) / (count + 1),
    y: parent.y + parent.height,
  }));

/**
 * From a port down to the top of a child, turning at one height for every
 * child of the parent - half a gap below it - so operands lowered under a
 * sibling's conversion still branch off together.
 */
const ordinaryLink = (
  parent: ExpressionNodeGeometry,
  child: ExpressionNodeGeometry,
  port: Point,
  gapY: number
): ExpressionLinkGeometry => {
  const target = { x: child.x + child.width / 2, y: child.y };
  const middleY = port.y + gapY / 2;
  return {
    parent: parent.node.key,
    child: child.node.key,
    source: port,
    target,
    vertices:
      port.x === target.x
        ? []
        : [
            { x: port.x, y: middleY },
            { x: target.x, y: middleY },
          ],
  };
};

const horizontalLink = (
  parent: ExpressionNodeGeometry,
  child: ExpressionNodeGeometry,
  side: 'left' | 'right'
): ExpressionLinkGeometry => ({
  parent: parent.node.key,
  child: child.node.key,
  source: {
    x: side === 'left' ? parent.x : parent.x + parent.width,
    y: parent.y + parent.height / 2,
  },
  target: {
    x: side === 'left' ? child.x + child.width : child.x,
    y: child.y + child.height / 2,
  },
  vertices: [],
});

/** From the bottom of a conversion straight down into its operand. */
const verticalLink = (
  parent: ExpressionNodeGeometry,
  child: ExpressionNodeGeometry
): ExpressionLinkGeometry => {
  const x = child.x + child.width / 2;
  return {
    parent: parent.node.key,
    child: child.node.key,
    source: { x, y: parent.y + parent.height },
    target: { x, y: child.y },
    vertices: [],
  };
};

export const expressionGeometry = (
  root: ExpressionNodeModel,
  origin: Point,
  options: ExpressionLayoutOptions
): ExpressionGeometry => {
  const horizontal: Horizontal = new Set();
  const local = localLayout(root, options, horizontal);
  const shifted = moved(local, origin.x - local.minX, origin.y - local.minY);
  const byKey = new Map(
    shifted.nodes.map((geometry) => [geometry.node.key, geometry])
  );
  const links: ExpressionLinkGeometry[] = [];

  const connect = (node: ExpressionNodeModel): void => {
    const parent = byKey.get(node.key);
    if (typeof parent === 'undefined') {
      return;
    }
    if (node.kind === 'assignment' && node.children.length === 2) {
      const left = byKey.get(node.children[0].key);
      const right = byKey.get(node.children[1].key);
      if (typeof left !== 'undefined') {
        links.push(horizontalLink(parent, left, 'left'));
      }
      if (typeof right !== 'undefined') {
        links.push(horizontalLink(parent, right, 'right'));
      }
    } else if (isConversion(node)) {
      const operand = byKey.get(node.children[0].key);
      if (typeof operand !== 'undefined') {
        links.push(
          horizontal.has(node.key)
            ? horizontalLink(parent, operand, 'right')
            : verticalLink(parent, operand)
        );
      }
    } else {
      const ports = portsFor(parent, node.children.length);
      node.children.forEach((childNode, index) => {
        const child = byKey.get(childNode.key);
        const port = ports[index];
        if (typeof child !== 'undefined' && typeof port !== 'undefined') {
          links.push(ordinaryLink(parent, child, port, options.gapY));
        }
      });
    }
    node.children.forEach(connect);
  };
  connect(root);

  return {
    nodes: shifted.nodes,
    links,
    width: shifted.maxX - shifted.minX,
    height: shifted.maxY - shifted.minY,
  };
};
