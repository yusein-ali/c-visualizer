import { dia, shapes } from '@joint/core';
import {
  ArrowGeometry,
  Geometry,
  MemoryGeometry,
  MemoryRegion,
  ExpressionModel,
  ExpressionNodeModel,
  FoldState,
  Point,
  StepModel,
  ViewOptions,
  emptyStepModel,
} from '../../core';
import strings from '../../strings';
import { IconName, iconFor } from '../controls/icons';
import { graphGeometry, memoryGeometry, statementSummary } from './geometry';
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

/**
 * The canvas is two sections read one after the other, each under its own
 * heading: what the program holds, and what the statement under the step
 * marker is doing with it. A heading is the same size wherever it appears and
 * whatever stands under it - it is the name of a section, and a band that grew
 * and shrank with its contents would read as part of them.
 */
const HEADING_WIDTH = 320;
const HEADING_HEIGHT = 26;
/** The room between a heading and the section it names. */
const HEADING_GAP = 10;
/** The room between the memory map and the statement section under it. */
const SECTION_GAP = 36;
/** Where the drawing starts, which is where `layoutMemory` puts the map. */
const ORIGIN_X = 24;
const ORIGIN_Y = 24;
/** What the map has to come down by to leave its own heading room. */
const MEMORY_DROP = HEADING_HEIGHT + HEADING_GAP;

const lowered = (point: Point, dy: number): Point => ({
  x: point.x,
  y: point.y + dy,
});

/**
 * The same drawing, further down the page.
 *
 * `layoutMemory` starts the map at a fixed origin and knows nothing about
 * headings, which is right: where a section's name goes is the canvas's
 * business. Rows and cells are placed against their own node, so only the
 * nodes and the arrows between them have to move.
 */
const loweredArrow = (arrow: ArrowGeometry, dy: number): ArrowGeometry => ({
  ...arrow,
  from: lowered(arrow.from, dy),
  mid: lowered(arrow.mid, dy),
  to: lowered(arrow.to, dy),
  vertices: arrow.vertices?.map((vertex) => lowered(vertex, dy)),
});

const loweredMemory = (memory: MemoryGeometry, dy: number): MemoryGeometry => ({
  ...memory,
  height: memory.height + dy,
  segments: memory.segments.map((segment) => ({
    ...segment,
    y: segment.y + dy,
  })),
  arrows: memory.arrows.map((arrow) => loweredArrow(arrow, dy)),
});

const loweredFrames = (frames: Geometry, dy: number): Geometry => ({
  stacks: frames.stacks.map((stack) => ({ ...stack, y: stack.y + dy })),
  arrows: frames.arrows.map((arrow) => loweredArrow(arrow, dy)),
});

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
    // Both sections come down by the height of the memory heading: the map
    // now stands under its own name rather than at the top of the paper.
    const memory = loweredMemory(
      memoryGeometry(model, this.folds, this.view),
      MEMORY_DROP
    );
    this.memory = memory;
    // Which of the two it is, is a question about the model rather than about
    // the geometry: a reader who switches every region off is looking at an
    // empty memory map, not asking for the tables back.
    const frames =
      model.memory.length === 0
        ? loweredFrames(graphGeometry(model, this.folds), MEMORY_DROP)
        : { stacks: [], arrows: [] };
    this.contentWidth = frames.stacks.reduce(
      (maximum, stack) => Math.max(maximum, stack.x + stack.width),
      memory.width
    );
    this.contentHeight = frames.stacks.reduce(
      (maximum, stack) => Math.max(maximum, stack.y + stack.height),
      memory.height
    );
    // The statement sits under the memory map, not beside it: the two are read
    // one after the other, and a step is easier to follow when the memory does
    // not move sideways as the expression under it grows.
    const statementCells = this.statementCells(
      model,
      ORIGIN_X,
      this.contentHeight + SECTION_GAP
    );
    this.panel.refresh();
    this.paper.freeze();
    this.graph.resetCells([
      this.sectionHeading(strings.graphMemoryHeading, ORIGIN_X, ORIGIN_Y),
      ...memory.segments.map(memoryNodeOf),
      ...frames.stacks.map(stackTableOf),
      ...[...memory.arrows, ...frames.arrows].map((arrow) =>
        this.pointerLink(arrow)
      ),
      ...statementCells,
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

  /**
   * A section's name, in a band the same size wherever it stands.
   *
   * The heading used to be as wide as the tree under it, so it changed size at
   * every step and read as the top of the drawing rather than as the name of a
   * section. A name is not a measurement of what it names.
   */
  private sectionHeading(text: string, x: number, y: number): dia.Element {
    const heading = new shapes.standard.Rectangle({ z: 4 });
    heading.position(x, y);
    heading.resize(HEADING_WIDTH, HEADING_HEIGHT);
    heading.attr({
      body: { fill: '#26384a', stroke: '#26384a', rx: 4, ry: 4 },
      label: {
        text,
        fill: '#ffffff',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 14,
        fontWeight: 'bold',
      },
    });
    return heading;
  }

  /**
   * The second section: what the statement under the step marker is doing.
   *
   * Its heading is always drawn, whatever the step is. A section that appeared
   * and vanished as the program moved from one kind of statement to the next
   * moved the memory map up and down with it, and a reader following a run
   * cannot read a page that will not hold still.
   *
   * What goes under the heading is the expansion where the statement has one,
   * and otherwise a line naming the construct the step is inside and what it
   * is doing - the same records the tooltip reads, so the two never disagree.
   */
  private statementCells(
    model: StepModel,
    originX: number,
    originY: number
  ): dia.Cell[] {
    const cells: dia.Cell[] = [
      this.sectionHeading(strings.graphStatementHeading, originX, originY),
    ];
    const bodyY = originY + HEADING_HEIGHT + HEADING_GAP;
    this.contentWidth = Math.max(
      this.contentWidth,
      originX + HEADING_WIDTH + ORIGIN_X
    );
    this.contentHeight = Math.max(this.contentHeight, bodyY);
    if (model.expression !== null) {
      return cells.concat(
        this.expressionCells(model.expression, originX, bodyY)
      );
    }
    return cells.concat(
      this.statementLine(statementSummary(model), originX, bodyY)
    );
  }

  /** One line of prose where there is no tree to draw. */
  private statementLine(text: string, x: number, y: number): dia.Element {
    const height = 32;
    const width = Math.max(HEADING_WIDTH, text.length * 7.4 + 24);
    const line = new shapes.standard.Rectangle({ z: 4 });
    line.position(x, y);
    line.resize(width, height);
    line.attr({
      body: { fill: 'none', stroke: 'none' },
      label: {
        text,
        fill: '#3c4a58',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 14,
        textAnchor: 'start',
        refX: 2,
        refX2: 0,
      },
    });
    this.contentWidth = Math.max(this.contentWidth, x + width + ORIGIN_X);
    this.contentHeight = Math.max(this.contentHeight, y + height + ORIGIN_X);
    return line;
  }

  private expressionCells(
    expression: ExpressionModel,
    originX: number,
    originY: number
  ): dia.Cell[] {
    const nodeWidth = 138;
    const nodeHeight = 54;
    const gapX = 18;
    const gapY = 30;
    const treeTop = originY;
    const widths = new Map<string, number>();
    const measure = (node: ExpressionNodeModel): number => {
      const width =
        node.children.length === 0
          ? 1
          : node.children.reduce((sum, child) => sum + measure(child), 0);
      widths.set(node.key, width);
      return width;
    };
    const totalLeaves = measure(expression.root);
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
    place(expression.root, 0, 0);

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
    connect(expression.root);

    const treeWidth = Math.max(
      nodeWidth,
      totalLeaves * (nodeWidth + gapX) - gapX
    );
    this.contentWidth = Math.max(
      this.contentWidth,
      originX + treeWidth + ORIGIN_X
    );
    this.contentHeight = Math.max(
      this.contentHeight,
      treeTop + (depthOf(expression.root) + 1) * (nodeHeight + gapY) + ORIGIN_X
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
