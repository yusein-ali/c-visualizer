import { dia, shapes } from '@joint/core';
import {
  ArrowGeometry,
  MemoryGeometry,
  MemoryRegion,
  ExpressionNodeModel,
  FoldState,
  StepModel,
  ViewOptions,
  emptyStepModel,
} from '../../core';
import strings from '../../strings';
import { IconName, iconFor } from '../controls/icons';
import { graphGeometry, memoryGeometry } from './geometry';
import { ViewPanelHandle, viewPanel } from './ViewPanel';
import { MemoryNode, memoryNodeOf } from './MemoryNode';
import { StackTable, stackTableOf } from './StackTable';
import './graph.css';

export interface PlivetGraphOptions {
  model?: StepModel;
}

/** How many levels of operands and operators the expression expands into. */
const depthOf = (node: ExpressionNodeModel): number =>
  node.children.length === 0 ? 0 : 1 + Math.max(...node.children.map(depthOf));

const cellNamespace = {
  ...shapes,
  plivet: { MemoryNode, StackTable },
};

/** One isolated JointJS graph and paper for one PLIVET visualization. */
export class PlivetGraph {
  private readonly graph: dia.Graph;
  private readonly paper: dia.Paper;
  private readonly folds = new FoldState();
  private readonly view = new ViewOptions();
  private readonly panel: ViewPanelHandle;
  /** The window the drawing scrolls inside, below the bar. */
  private readonly viewport: HTMLDivElement;
  private readonly paperHost: HTMLDivElement;
  /** What the toolbar says the drawing is scaled to. */
  private readonly zoomLabel: HTMLSpanElement;
  private readonly resizeObserver: ResizeObserver | null;
  private model: StepModel;
  /** The map as it is drawn now, so a click can act on what it sees. */
  private memory: MemoryGeometry = {
    segments: [],
    arrows: [],
    width: 0,
    height: 0,
  };
  private scale = 1;
  private contentWidth = 0;
  private contentHeight = 0;

  constructor(
    private readonly container: HTMLElement,
    options: PlivetGraphOptions = {}
  ) {
    this.model = options.model || emptyStepModel();
    // The switches read the map back, so the panel is built before the toolbar
    // that carries it and refreshed by every render.
    this.panel = viewPanel(
      this.view,
      () => this.render(this.model),
      (region: MemoryRegion) =>
        this.memory.segments.some((segment) => segment.key === region)
    );
    // The zoom buttons are three magnifiers, so the percentage they are
    // moving is written beside them. It is a live region for the same reason
    // the step counter is: pressing one of them changes nothing else that a
    // reader who is not watching the drawing would notice.
    this.zoomLabel = document.createElement('span');
    this.zoomLabel.className = 'plivet-graph__status';
    this.zoomLabel.setAttribute('role', 'status');
    this.container.classList.add('plivet-graph');
    this.container.appendChild(this.toolbar());
    // The bar is the frame of the window rather than something floating in
    // it: the paper scrolls inside the box below it, so the bar - and the
    // panel hanging off its right-hand end - is always over the view, at
    // whatever the reader has scrolled the drawing to.
    this.viewport = document.createElement('div');
    this.viewport.className = 'plivet-graph__view';
    this.paperHost = document.createElement('div');
    this.paperHost.className = 'plivet-graph__paper';
    this.viewport.appendChild(this.paperHost);
    this.container.appendChild(this.viewport);

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
      // An aggregate's triangle folds its members away; a segment's title bar
      // folds the whole segment away. Both are clicks on the same paper.
      const hit =
        target === null
          ? null
          : target.closest('[data-fold-target], [data-collapse-target]');
      if (hit === null) {
        return;
      }
      const group = hit.getAttribute('data-fold-target');
      const segment = hit.getAttribute('data-collapse-target');
      if (group !== null) {
        this.folds.toggle(decodeURIComponent(group));
      } else if (segment !== null) {
        // What the click flips is what the user is looking at: a segment
        // nobody has clicked is drawn collapsed when it is empty, and the
        // geometry is where that decision was made.
        const drawn = this.memory.segments.find((one) => one.key === segment);
        this.folds.toggleSegment(
          segment,
          typeof drawn !== 'undefined' && drawn.collapsed
        );
      } else {
        return;
      }
      this.render(this.model);
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
    // A step that knows its memory is drawn as a memory map; a step that only
    // has call frames - the empty model this starts on - keeps the tables.
    const memory = memoryGeometry(model, this.folds, this.view);
    this.memory = memory;
    // Which of the two it is, is a question about the model rather than about
    // the geometry: a reader who switches every region off is looking at an
    // empty memory map, not asking for the tables back.
    const frames =
      model.memory.length === 0
        ? graphGeometry(model, this.folds)
        : { stacks: [], arrows: [] };
    this.contentWidth = frames.stacks.reduce(
      (maximum, stack) => Math.max(maximum, stack.x + stack.width),
      memory.width
    );
    this.contentHeight = frames.stacks.reduce(
      (maximum, stack) => Math.max(maximum, stack.y + stack.height),
      memory.height
    );
    // The expression window sits under the memory map, not beside it: the two
    // are read one after the other, and a step is easier to follow when the
    // memory does not move sideways as the expression grows.
    const expressionCells = this.view.isExpressionShown()
      ? this.expressionCells(model, 24, this.contentHeight + 24)
      : [];
    this.panel.refresh();
    this.paper.freeze();
    this.graph.resetCells([
      ...memory.segments.map(memoryNodeOf),
      ...frames.stacks.map(stackTableOf),
      ...[...memory.arrows, ...frames.arrows].map((arrow) =>
        this.pointerLink(arrow)
      ),
      ...expressionCells,
    ]);
    this.resize();
    this.paper.unfreeze();
  }

  setScale(scale: number): void {
    this.scale = Math.max(0.4, Math.min(2, scale));
    this.zoomLabel.textContent = `${Math.round(this.scale * 100)}%`;
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
    if (typeof arrow.vertices !== 'undefined') {
      // The layout has decided where this one goes; routing it again would
      // only send it back through the segments it was drawn around.
      link.vertices(arrow.vertices);
      link.router('normal');
    } else {
      link.router('manhattan', { step: 10, padding: 8 });
    }
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

  private expressionCells(
    model: StepModel,
    originX: number,
    originY: number
  ): dia.Cell[] {
    if (model.expression === null) {
      return [];
    }
    const nodeWidth = 138;
    const nodeHeight = 54;
    const gapX = 18;
    const gapY = 30;
    const titleHeight = 30;
    const treeTop = originY + titleHeight + 16;
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
      const y = treeTop + depth * (nodeHeight + gapY);
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
          // The tree is the expansion: an operator over the operands it takes
          // and what it made of them. Nothing here needs numbering.
          // An operator that has not run yet is worth nothing yet, and an
          // empty line says that better than a sentence about it does.
          text:
            node.value === null ? node.text : `${node.text}\n= ${node.value}`,
          fill: '#111111',
          fontFamily: "Consolas, 'Courier New', monospace",
          fontSize: 13,
          textWrap: { width: -12, height: -8, ellipsis: true },
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

    const treeWidth = Math.max(
      nodeWidth,
      totalLeaves * (nodeWidth + gapX) - gapX
    );
    const title = new shapes.standard.Rectangle({ z: 4 });
    title.position(originX, originY);
    title.resize(treeWidth, titleHeight);
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
    this.contentWidth = Math.max(this.contentWidth, originX + treeWidth + 24);
    this.contentHeight = Math.max(
      this.contentHeight,
      treeTop + (depthOf(model.expression.root) + 1) * (nodeHeight + gapY) + 24
    );
    return cells;
  }

  /**
   * The bar over the drawing: the zoom, what it is at, and the switches for
   * what is drawn at all.
   *
   * It is the editor's control bar again - the same joined group, the same
   * magnifiers, the same buttons - because a reader works between the two
   * panels and there is no reason for the same gesture to look different on
   * each side of the splitter. What it does not share is the stylesheet: the
   * icons are a module, and the paint is `--plivet-button-*`, so the canvas
   * still mounts on a page that has never heard of `controls.css`.
   */
  private toolbar(): HTMLDivElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'plivet-graph__toolbar';

    const zoom = document.createElement('div');
    zoom.className = 'plivet-graph__group';
    zoom.append(
      this.zoomButton('zoomOut', strings.graphZoomOut, () =>
        this.setScale(this.scale - 0.1)
      ),
      this.zoomButton('zoomReset', strings.graphZoomReset, () =>
        this.setScale(1)
      ),
      this.zoomButton('zoomIn', strings.graphZoomIn, () =>
        this.setScale(this.scale + 0.1)
      )
    );

    // The percentage stays with the buttons that move it, and the disclosure
    // keeps the right-hand end: its panel hangs from that edge, and anywhere
    // else on the bar it would open off the side of the canvas.
    toolbar.append(zoom, this.zoomLabel, this.panel.root);
    return toolbar;
  }

  private zoomButton(
    icon: IconName,
    title: string,
    action: () => void
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'plivet-graph__button';
    button.title = title;
    // The picture carries no name, so the button says what it is itself.
    button.setAttribute('aria-label', title);
    button.appendChild(iconFor(icon));
    button.addEventListener('click', action);
    return button;
  }

  private resize(): void {
    const bounds = this.graph.getBBox();
    const contentBottom = Math.max(
      this.contentHeight,
      bounds === null ? 0 : bounds.y + bounds.height
    );
    const contentRight = Math.max(
      this.contentWidth,
      bounds === null ? 0 : bounds.x + bounds.width
    );
    const height = Math.max(480, (contentBottom + 80) * this.scale);
    const width = Math.max(
      this.viewport.clientWidth,
      contentRight * this.scale
    );
    this.paper.setDimensions(width, height);
    this.paperHost.style.height = `${height}px`;
  }
}
