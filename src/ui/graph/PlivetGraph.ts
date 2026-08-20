import { dia, shapes } from '@joint/core';
import {
  ArrowGeometry,
  ExpressionNodeModel,
  FoldState,
  Geometry,
  StepModel,
  emptyStepModel,
} from '../../core';
import strings from '../../strings';
import { graphGeometry } from './geometry';
import { StackTable, stackTableOf } from './StackTable';
import './graph.css';

export interface PlivetGraphOptions {
  model?: StepModel;
}

const cellNamespace = {
  ...shapes,
  plivet: { StackTable },
};

/** One isolated JointJS graph and paper for one PLIVET visualization. */
export class PlivetGraph {
  private readonly graph: dia.Graph;
  private readonly paper: dia.Paper;
  private readonly folds = new FoldState();
  private readonly paperHost: HTMLDivElement;
  private readonly resizeObserver: ResizeObserver | null;
  private model: StepModel;
  private scale = 1;
  private contentWidth = 0;

  constructor(
    private readonly container: HTMLElement,
    options: PlivetGraphOptions = {}
  ) {
    this.model = options.model || emptyStepModel();
    this.container.classList.add('plivet-graph');
    this.container.appendChild(this.toolbar());
    this.paperHost = document.createElement('div');
    this.paperHost.className = 'plivet-graph__paper';
    this.container.appendChild(this.paperHost);

    this.graph = new dia.Graph({}, { cellNamespace });
    this.paper = new dia.Paper({
      el: this.paperHost,
      model: this.graph,
      cellViewNamespace: cellNamespace,
      width: '100%',
      height: 900,
      async: true,
      frozen: true,
      sorting: dia.Paper.sorting.EXACT,
      interactive: false,
      background: { color: '#ffffff' },
    });
    this.paper.on('element:pointerclick', (_view, event) => {
      const target = event.target as Element | null;
      const fold =
        target === null ? null : target.closest('[data-fold-target]');
      const group =
        fold === null ? null : fold.getAttribute('data-fold-target');
      if (group !== null) {
        this.folds.toggle(decodeURIComponent(group));
        this.render(this.model);
      }
    });

    this.resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => this.resize());
    if (this.resizeObserver !== null) {
      this.resizeObserver.observe(this.container);
    }
    this.render(this.model);
  }

  render(model: StepModel): void {
    this.model = model;
    const geometry = graphGeometry(model, this.folds);
    const expressionCells = this.expressionCells(model, geometry);
    this.paper.freeze();
    this.graph.resetCells([
      ...geometry.stacks.map(stackTableOf),
      ...geometry.arrows.map((arrow) => this.pointerLink(arrow)),
      ...expressionCells,
    ]);
    this.resize(geometry);
    this.paper.unfreeze();
  }

  setScale(scale: number): void {
    this.scale = Math.max(0.4, Math.min(2, scale));
    this.paper.scale(this.scale, this.scale);
    this.resize();
  }

  destroy(): void {
    if (this.resizeObserver !== null) {
      this.resizeObserver.disconnect();
    }
    this.paper.remove();
    this.graph.clear();
    this.container.replaceChildren();
    this.container.classList.remove('plivet-graph');
  }

  private pointerLink(arrow: ArrowGeometry): shapes.standard.Link {
    const link = new shapes.standard.Link({ z: 2 });
    link.source(arrow.from);
    link.target(arrow.to);
    link.router('manhattan', { step: 10, padding: 8 });
    link.connector('rounded', { radius: 8 });
    link.attr({
      line: {
        stroke: arrow.color,
        strokeWidth: 2,
        targetMarker: {
          type: 'path',
          d: 'M 10 -5 0 0 10 5 z',
          fill: arrow.color,
          stroke: arrow.color,
        },
      },
    });
    return link;
  }

  private expressionCells(model: StepModel, geometry: Geometry): dia.Cell[] {
    if (model.expression === null) {
      this.contentWidth = geometry.stacks.reduce(
        (maximum, stack) => Math.max(maximum, stack.x + stack.width),
        0
      );
      return [];
    }
    const nodeWidth = 152;
    const nodeHeight = 68;
    const gapX = 22;
    const gapY = 36;
    const originX =
      geometry.stacks.reduce(
        (maximum, stack) => Math.max(maximum, stack.x + stack.width),
        0
      ) + 80;
    const originY = 90;
    const widths = new Map<string, number>();
    const measure = (node: ExpressionNodeModel): number => {
      const width =
        node.children.length === 0
          ? 1
          : node.children.reduce((sum, child) => sum + measure(child), 0);
      widths.set(node.key, width);
      return width;
    };
    const totalLeaves = measure(model.expression.root);
    const cells: dia.Cell[] = [];
    const nodes = new Map<string, shapes.standard.Rectangle>();

    const place = (
      node: ExpressionNodeModel,
      leftLeaf: number,
      depth: number
    ): void => {
      const leaves = widths.get(node.key) || 1;
      const x =
        originX + (leftLeaf + leaves / 2) * (nodeWidth + gapX) - nodeWidth / 2;
      const y = originY + depth * (nodeHeight + gapY);
      const element = new shapes.standard.Rectangle({ z: 4 });
      element.position(x, y);
      element.resize(nodeWidth, nodeHeight);
      element.attr({
        body: {
          fill:
            node.kind === 'assignment'
              ? '#fff0c2'
              : node.kind === 'operator'
                ? '#dcecff'
                : '#f4f4f4',
          stroke: '#202020',
          strokeWidth: node.kind === 'operand' ? 1 : 2,
          rx: 5,
          ry: 5,
        },
        label: {
          text: `${
            node.order < 0
              ? '—'
              : `${strings.expressionOrder} ${node.order + 1}`
          } · ${node.text}\n= ${
            node.value === null ? strings.expressionNotEvaluated : node.value
          }`,
          fill: '#111111',
          fontFamily: "Consolas, 'Courier New', monospace",
          fontSize: 12,
          textWrap: { width: -10, height: -8, ellipsis: true },
        },
      });
      nodes.set(node.key, element);
      cells.push(element);

      let childLeft = leftLeaf;
      for (const child of node.children) {
        place(child, childLeft, depth + 1);
        childLeft += widths.get(child.key) || 1;
      }
    };
    place(model.expression.root, 0, 0);

    const connect = (node: ExpressionNodeModel): void => {
      const parent = nodes.get(node.key);
      if (typeof parent === 'undefined') {
        return;
      }
      for (const child of node.children) {
        const childElement = nodes.get(child.key);
        if (typeof childElement !== 'undefined') {
          const link = new shapes.standard.Link({ z: 3 });
          link.source(parent, { anchor: { name: 'bottom' } });
          link.target(childElement, { anchor: { name: 'top' } });
          link.router('orthogonal', { padding: 8 });
          link.connector('rounded', { radius: 5 });
          link.attr({
            line: {
              stroke: '#5c6773',
              strokeWidth: 1.5,
              targetMarker: { type: 'none' },
            },
          });
          cells.push(link);
        }
        connect(child);
      }
    };
    connect(model.expression.root);

    const title = new shapes.standard.Rectangle({ z: 4 });
    title.position(originX, 42);
    title.resize(
      Math.max(nodeWidth, totalLeaves * (nodeWidth + gapX) - gapX),
      30
    );
    title.attr({
      body: { fill: '#26384a', stroke: '#26384a', rx: 4, ry: 4 },
      label: {
        text: strings.expressionEvaluation,
        fill: '#ffffff',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 14,
        fontWeight: 'bold',
      },
    });
    cells.push(title);
    this.contentWidth = originX + totalLeaves * (nodeWidth + gapX) - gapX + 50;
    return cells;
  }

  private toolbar(): HTMLDivElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'plivet-graph__toolbar';
    toolbar.append(
      this.zoomButton('−', strings.graphZoomOut, () =>
        this.setScale(this.scale - 0.1)
      ),
      this.zoomButton('100%', strings.graphZoomReset, () => this.setScale(1)),
      this.zoomButton('+', strings.graphZoomIn, () =>
        this.setScale(this.scale + 0.1)
      )
    );
    return toolbar;
  }

  private zoomButton(
    label: string,
    title: string,
    action: () => void
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plivet-graph__zoom';
    button.textContent = label;
    button.title = title;
    button.addEventListener('click', action);
    return button;
  }

  private resize(geometry?: Geometry): void {
    const current = geometry || graphGeometry(this.model, this.folds);
    const bottom = current.stacks.reduce(
      (maximum, stack) => Math.max(maximum, stack.y + stack.height),
      0
    );
    const bounds = this.graph.getBBox();
    const contentBottom = Math.max(
      bottom,
      bounds === null ? 0 : bounds.y + bounds.height
    );
    const contentRight = Math.max(
      this.contentWidth,
      bounds === null ? 0 : bounds.x + bounds.width
    );
    const height = Math.max(480, (contentBottom + 80) * this.scale);
    const width = Math.max(
      this.container.clientWidth,
      contentRight * this.scale
    );
    this.paper.setDimensions(width, height);
    this.paperHost.style.height = `${height}px`;
  }
}
