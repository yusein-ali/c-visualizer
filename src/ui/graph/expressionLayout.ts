import { ExpressionNodeModel, Point } from '../../core';

export interface ExpressionLayoutOptions {
  nodeWidth: number;
  nodeHeight: number;
  gapX: number;
  gapY: number;
}

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
 * Layout relative to the root's centre at x=0.
 *
 * Ordinary operators remain trees. Assignments are the exception because C
 * reads them left-to-right: target, assignment operator and right expression
 * are three peers. Descendants of either expression can still grow down from
 * their own root.
 */
const localLayout = (
  node: ExpressionNodeModel,
  options: ExpressionLayoutOptions
): LocalLayout => {
  const { nodeWidth, nodeHeight, gapX, gapY } = options;
  const root: ExpressionNodeGeometry = {
    node,
    x: -nodeWidth / 2,
    y: 0,
    width: nodeWidth,
    height: nodeHeight,
  };
  const children = node.children.map((child) => localLayout(child, options));

  if (node.kind === 'assignment' && children.length === 2) {
    return joined(root, [
      moved(children[0], -(nodeWidth + gapX), 0),
      moved(children[1], nodeWidth + gapX, 0),
    ]);
  }

  if (children.length === 0) {
    return joined(root, []);
  }

  const span =
    children.reduce((width, child) => width + (child.maxX - child.minX), 0) +
    gapX * (children.length - 1);
  let cursor = -span / 2;
  const placed = children.map((child) => {
    const result = moved(child, cursor - child.minX, nodeHeight + gapY);
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

const ordinaryLink = (
  parent: ExpressionNodeGeometry,
  child: ExpressionNodeGeometry,
  port: Point
): ExpressionLinkGeometry => {
  const target = { x: child.x + child.width / 2, y: child.y };
  const middleY = port.y + (target.y - port.y) / 2;
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

export const expressionGeometry = (
  root: ExpressionNodeModel,
  origin: Point,
  options: ExpressionLayoutOptions
): ExpressionGeometry => {
  const local = localLayout(root, options);
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
    } else {
      const ports = portsFor(parent, node.children.length);
      node.children.forEach((childNode, index) => {
        const child = byKey.get(childNode.key);
        const port = ports[index];
        if (typeof child !== 'undefined' && typeof port !== 'undefined') {
          links.push(ordinaryLink(parent, child, port));
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
