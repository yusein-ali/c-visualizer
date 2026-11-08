import { dia, shapes } from '@joint/core';
import type { ExpressionModel, ExpressionNodeModel } from '../../core';
import strings from '../../strings';
import { EXPRESSION_LAYOUT, expressionGeometry } from './expressionLayout';
import { ExpressionNode, expressionCells } from './ExpressionNode';
import './expressionTree.css';

export type ExpressionTreeTheme = 'light' | 'dark';

export interface ExpressionTreeRenderOptions {
  /** The key of the node to outline, or several. Nothing is outlined by default. */
  highlight?: string | readonly string[] | null;
  /**
   * The key of a node, or several, whose whole subtree is drawn dimmed, with
   * the links into it: the operand `&&`, `||` or `?:` skips. Nothing is
   * dimmed by default. The layout does not change.
   */
  dim?: string | readonly string[] | null;
}

export interface ExpressionTreeOptions extends ExpressionTreeRenderOptions {
  /** The tree to draw first. */
  model?: ExpressionModel | ExpressionNodeModel | null;
  theme?: ExpressionTreeTheme;
  /** The size of the boxes' labels in pixels; the drawing scales with it. */
  fontSize?: number;
  /** The accessible name of the drawing. */
  label?: string;
}

/** The size the canvas draws expression labels at, which is scale 1. */
export const EXPRESSION_FONT_SIZE = 13;

/** Room around the tree, in drawing units, so outlines are not clipped. */
const PADDING = 6;

/** The narrowest and widest a host may scale the drawing to. */
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

const cellNamespace = {
  standard: shapes.standard,
  plivet: { ExpressionNode },
};

const rootOf = (
  model: ExpressionModel | ExpressionNodeModel | null | undefined
): ExpressionNodeModel | null => {
  if (model === null || typeof model !== 'object') {
    return null;
  }
  return 'root' in model ? model.root : model;
};

const keysOf = (
  highlight: ExpressionTreeRenderOptions['highlight']
): Set<string> =>
  new Set(
    typeof highlight === 'string'
      ? [highlight]
      : Array.isArray(highlight)
        ? highlight
        : []
  );

/** The named nodes and every node under them. */
const subtreesOf = (
  root: ExpressionNodeModel,
  keys: ReadonlySet<string>
): Set<string> => {
  const found = new Set<string>();
  const visit = (node: ExpressionNodeModel, inside: boolean): void => {
    const dimmed = inside || keys.has(node.key);
    if (dimmed) {
      found.add(node.key);
    }
    node.children.forEach((child) => visit(child, dimmed));
  };
  if (keys.size !== 0) {
    visit(root, false);
  }
  return found;
};

/**
 * The canvas's expression tree on its own: what `c-expression.js` mounts.
 *
 * It draws a model a host built - the expression playground evaluates C
 * expressions itself and hands over one tree per step - with the canvas's
 * layout, boxes and pills, so a tree on a course page looks like the one in
 * the visualizer. It has no interpreter and no worker, and it never reads the
 * model's ranges.
 *
 * The paper is sized to the tree and scaled with the font size, so the host
 * decides where it scrolls.
 */
export class ExpressionTree {
  private readonly root: HTMLDivElement;
  private readonly graph: dia.Graph;
  private readonly paper: dia.Paper;
  private model: ExpressionNodeModel | null = null;
  private highlight = new Set<string>();
  private scale = 1;
  private size = { width: 0, height: 0 };

  constructor(parent: HTMLElement, options: ExpressionTreeOptions = {}) {
    this.root = document.createElement('div');
    this.root.className = 'plivet-expression-tree';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute(
      'aria-label',
      options.label ?? strings.graphExpressionHeading
    );
    const host = document.createElement('div');
    host.className = 'plivet-expression-tree__paper';
    this.root.appendChild(host);
    parent.appendChild(this.root);

    this.graph = new dia.Graph({}, { cellNamespace });
    this.paper = new dia.Paper({
      el: host,
      model: this.graph,
      cellViewNamespace: cellNamespace,
      width: 0,
      height: 0,
      interactive: false,
      background: { color: 'transparent' },
    });
    this.setTheme(options.theme ?? 'light');
    if (typeof options.fontSize === 'number') {
      this.scale = scaleFor(options.fontSize, this.scale);
    }
    this.render(options.model ?? null, options);
  }

  /**
   * Draw a tree, replacing the one before, with the given nodes outlined and
   * the given subtrees dimmed.
   */
  render(
    model: ExpressionModel | ExpressionNodeModel | null,
    options: ExpressionTreeRenderOptions = {}
  ): void {
    this.model = rootOf(model);
    this.highlight = keysOf(options.highlight);
    if (this.model === null) {
      this.graph.resetCells([]);
      this.size = { width: 0, height: 0 };
    } else {
      const geometry = expressionGeometry(
        this.model,
        { x: PADDING, y: PADDING },
        EXPRESSION_LAYOUT
      );
      this.graph.resetCells(
        expressionCells(
          geometry,
          this.highlight,
          subtreesOf(this.model, keysOf(options.dim))
        )
      );
      this.size = {
        width: geometry.width + 2 * PADDING,
        height: geometry.height + 2 * PADDING,
      };
    }
    this.root.classList.toggle(
      'plivet-expression-tree--empty',
      this.model === null
    );
    this.fit();
  }

  setTheme(theme: ExpressionTreeTheme): void {
    this.root.classList.toggle(
      'plivet-expression-tree--dark',
      theme === 'dark'
    );
  }

  /**
   * Scale the drawing so its labels are `px` pixels, as a page's code-size
   * preference asks. The geometry stays the canvas's; only the zoom changes.
   */
  setFontSize(px: number): void {
    this.scale = scaleFor(px, this.scale);
    this.fit();
  }

  destroy(): void {
    this.paper.remove();
    this.graph.clear();
    this.root.remove();
  }

  private fit(): void {
    this.paper.scale(this.scale, this.scale);
    this.paper.setDimensions(
      Math.ceil(this.size.width * this.scale),
      Math.ceil(this.size.height * this.scale)
    );
  }
}

const scaleFor = (px: number, fallback: number): number =>
  Number.isFinite(px) && 0 < px
    ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, px / EXPRESSION_FONT_SIZE))
    : fallback;
