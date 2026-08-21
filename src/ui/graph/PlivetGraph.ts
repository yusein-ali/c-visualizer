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
  ViewSelection,
  emptyStepModel,
} from '../../core';
import strings from '../../strings';
import { IconName, iconFor } from '../controls/icons';
import { MutationView } from '../views';
import { graphGeometry, memoryGeometry } from './geometry';
import { ViewPanelHandle, viewPanel } from './ViewPanel';
import { callStackRows } from './callStack';
import { emptyStatementExplanation, StatementExplanation } from '../records';
import { MemoryNode, memoryNodeOf } from './MemoryNode';
import { StackTable, stackTableOf } from './StackTable';
import {
  statementCard,
  StatementCardModel,
  StatementCardRow,
} from './statementCard';
import './graph.css';

export interface PlivetGraphOptions {
  model?: StepModel;
  explanation?: StatementExplanation;
  dark?: boolean;
  /**
   * What the canvas opens with drawn, for a caller with an opinion: a page
   * teaching the stack can arrive without the expression tree in the way. It
   * is the state the View panel writes, so the reader can still switch back
   * anything the page switched off.
   */
  views?: ViewSelection;
  /**
   * The object the pointer is over, and null when it leaves. The canvas says
   * which object rather than which cell: a row is what a reader points at,
   * and what the editor can mark the declaration of.
   */
  onFocus?: (object: string | null) => void;
}

/** The class the focused object's boxes are painted through. */
const FOCUS_CLASS = 'plivet-object--focus';

/** How many levels of operands and operators the expression expands into. */
const depthOf = (node: ExpressionNodeModel): number =>
  node.children.length === 0 ? 0 : 1 + Math.max(...node.children.map(depthOf));

/**
 * The canvas is read from cause to state. Statement and Call stack share its
 * first row; Expression expansion spans both columns beneath them, and Memory
 * follows. The write history is the final DOM section under the paper. Each
 * major section has one disclosure heading and one switch in the shared View
 * panel.
 */
const HEADING_HEIGHT = 26;
/** The room between a heading and the section it names. */
const HEADING_GAP = 10;
/** One line of the statement's reading, and the room under the last of them. */
const STATEMENT_LINE_HEIGHT = 20;
const CARD_TITLE_HEIGHT = 38;
const CARD_CONTEXT_HEIGHT = 28;
const CARD_DESCRIPTION_HEIGHT = 58;
const CARD_ROW_HEIGHT = 38;
const CARD_SECTION_HEIGHT = 28;
const CARD_LABEL_WIDTH = 164;
/** The room between the statement and memory sections. */
const SECTION_GAP = 36;
const COLUMN_GAP = 24;
const COLUMN_WIDTH = 480;
const TWO_COLUMN_WIDTH = COLUMN_WIDTH * 2 + COLUMN_GAP;
/** Where the drawing starts, which is where `layoutMemory` puts the map. */
const ORIGIN_X = 24;
const ORIGIN_Y = 24;
/** What the map has to come down by to leave its own heading room. */
const MEMORY_DROP = HEADING_HEIGHT + HEADING_GAP;
const CALL_ROW_GAP = 5;

/** JointJS rectangles center labels unless both axes are overridden. */
export const leftAlignedLabel = (x: number, height: number) => ({
  x,
  y: height / 2,
  textAnchor: 'start' as const,
  textVerticalAnchor: 'middle' as const,
});

type CanvasSection = 'statement' | 'callStack' | 'expression' | 'memory';

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
  private readonly mutations: MutationView;
  private readonly collapsed = new Set<CanvasSection>();
  /** The window the drawing scrolls inside, below the bar. */
  private readonly viewport: HTMLDivElement;
  private readonly paperHost: HTMLDivElement;
  /** What the toolbar says the drawing is scaled to. */
  private readonly zoomLabel: HTMLSpanElement;
  private readonly resizeObserver: ResizeObserver | null;
  private model: StepModel;
  /**
   * What the statement under the marker is doing, in the records the tooltip
   * reads. It is kept beside the model for the same reason the model is: a
   * fold or a switch redraws the scene without a new step.
   */
  private explanation: StatementExplanation;
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
  /**
   * The object lit up at the moment, if any. It is kept rather than only
   * painted, because every step rebuilds the scene: a reader holding the
   * pointer over a row while the program steps is still pointing at it.
   */
  private focused: string | null = null;
  /** The last object reported out, so one hover is one call. */
  private reported: string | null = null;
  private readonly onFocus?: (object: string | null) => void;

  constructor(
    private readonly container: HTMLElement,
    options: PlivetGraphOptions = {}
  ) {
    this.model = options.model || emptyStepModel();
    this.explanation = options.explanation ?? emptyStatementExplanation();
    this.onFocus = options.onFocus;
    if (typeof options.views !== 'undefined') {
      this.view.apply(options.views);
    }
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
    // The history belongs to the same workspace and View panel, but remains
    // ordinary DOM: a bounded table is clearer and cheaper than hundreds of
    // SVG cells. It follows the paper, so it is literally under the canvas.
    this.mutations = new MutationView(this.container);

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
      // Aggregate rows, memory segments and whole canvas sections all fold in
      // the place where the reader sees them.
      const hit =
        target === null
          ? null
          : target.closest(
              '[data-section-target], [data-fold-target], [data-collapse-target]'
            );
      if (hit === null) {
        return;
      }
      const group = hit.getAttribute('data-fold-target');
      const segment = hit.getAttribute('data-collapse-target');
      const section = hit.getAttribute('data-section-target');
      if (
        section === 'statement' ||
        section === 'callStack' ||
        section === 'expression' ||
        section === 'memory'
      ) {
        this.toggleSection(section);
      } else if (group !== null) {
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

    // Hover is read off the DOM rather than through the paper's own element
    // events: what the reader is pointing at is one row of a segment node,
    // and the paper would report the node.
    this.paperHost.addEventListener('mouseover', (event: MouseEvent) =>
      this.pointedAt(event)
    );
    this.paperHost.addEventListener('mouseleave', () => this.report(null));

    this.resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => this.resize());
    if (this.resizeObserver !== null) {
      this.resizeObserver.observe(this.container);
    }
    this.render(this.model);
  }

  render(model: StepModel, explanation?: StatementExplanation): void {
    this.model = model;
    if (typeof explanation !== 'undefined') {
      this.explanation = explanation;
    }
    this.contentWidth = 0;
    this.contentHeight = 0;
    const cells: dia.Cell[] = [];
    let nextY = ORIGIN_Y;

    // Statement and Call stack are peers: the first names the operation and
    // the second the activation whose state that operation is changing.
    let hasTopRow = false;
    if (this.view.isStatementShown()) {
      cells.push(...this.statementCells(model, ORIGIN_X, nextY));
      hasTopRow = true;
    }
    if (this.view.isCallStackShown()) {
      cells.push(
        ...this.callStackCells(
          model,
          this.view.isStatementShown()
            ? ORIGIN_X + COLUMN_WIDTH + COLUMN_GAP
            : ORIGIN_X,
          nextY
        )
      );
      hasTopRow = true;
    }
    if (hasTopRow) {
      nextY =
        Math.max(this.contentHeight, nextY + HEADING_HEIGHT) + SECTION_GAP;
    }

    // The tree is a view of its own and gets the whole width below the two
    // textual state views, so wider expressions do not squeeze either one.
    if (this.view.isExpressionShown()) {
      cells.push(...this.expressionSectionCells(model, ORIGIN_X, nextY));
      nextY =
        Math.max(this.contentHeight, nextY + HEADING_HEIGHT) + SECTION_GAP;
    }

    const baseMemory = memoryGeometry(model, this.folds, this.view);
    if (this.view.isMemoryShown()) {
      const memoryDrop = nextY + MEMORY_DROP - ORIGIN_Y;
      const memory = loweredMemory(baseMemory, memoryDrop);
      this.memory = memory;
      cells.push(
        this.sectionHeading(
          strings.graphMemoryHeading,
          ORIGIN_X,
          nextY,
          'memory',
          TWO_COLUMN_WIDTH
        )
      );
      if (!this.collapsed.has('memory')) {
        // A hand-built model with stacks and no process segments keeps the
        // old frame tables; ordinary execution uses the memory map.
        const frames =
          model.memory.length === 0
            ? loweredFrames(graphGeometry(model, this.folds), memoryDrop)
            : { stacks: [], arrows: [] };
        this.contentWidth = frames.stacks.reduce(
          (maximum, stack) => Math.max(maximum, stack.x + stack.width),
          Math.max(this.contentWidth, memory.width)
        );
        this.contentHeight = frames.stacks.reduce(
          (maximum, stack) => Math.max(maximum, stack.y + stack.height),
          Math.max(this.contentHeight, memory.height)
        );
        cells.push(
          ...memory.segments.map(memoryNodeOf),
          ...frames.stacks.map(stackTableOf),
          ...[...memory.arrows, ...frames.arrows].map((arrow) =>
            this.pointerLink(arrow)
          )
        );
      }
    } else {
      // Region switches still report their configured/dynamic state while the
      // enclosing memory section is switched off.
      this.memory = baseMemory;
    }

    this.mutations.setShown(this.view.areMutationsShown());
    this.mutations.setMutations(
      this.view.areMutationsShown() ? model.mutations : []
    );
    this.panel.refresh();
    this.paper.freeze();
    this.graph.resetCells(cells);
    this.resize();
    this.paper.unfreeze();
    // The scene was rebuilt under whatever the reader was pointing at, so the
    // mark goes back on. `async` paper draws after this returns, which is why
    // it is put back on the next frame rather than now.
    this.repaintFocus();
  }

  /**
   * Light up one object, or none. This is the other half of the editor's
   * tooltip: the two panels stop being separate pictures of the same program
   * at the moment that pointing at one of them marks the other.
   */
  setFocus(object: string | null): void {
    if (object === this.focused) {
      return;
    }
    this.focused = object;
    this.repaintFocus();
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
    this.mutations.destroy();
    this.container.replaceChildren();
    this.container.classList.remove('plivet-graph');
  }

  /** Which object the pointer is over, from the row it is inside. */
  private pointedAt(event: MouseEvent): void {
    const target = event.target as Element | null;
    const hit = target === null ? null : target.closest('[data-object-key]');
    const object = hit === null ? null : hit.getAttribute('data-object-key');
    this.report(object === null ? null : decodeURIComponent(object));
  }

  private report(object: string | null): void {
    if (object === this.reported) {
      return;
    }
    this.reported = object;
    if (typeof this.onFocus !== 'undefined') {
      this.onFocus(object);
    }
  }

  private toggleSection(section: CanvasSection): void {
    if (this.collapsed.has(section)) {
      this.collapsed.delete(section);
    } else {
      this.collapsed.add(section);
    }
    this.render(this.model);
  }

  /**
   * Puts the mark on every box of the focused object and takes it off the
   * rest. The paint is a class rather than an attribute: JointJS writes fill
   * and stroke as presentation attributes, which a stylesheet outranks, so
   * the highlight needs no second copy of the palette.
   */
  private repaintFocus(): void {
    const marked = this.paperHost.querySelectorAll(`.${FOCUS_CLASS}`);
    marked.forEach((element: Element) => element.classList.remove(FOCUS_CLASS));
    if (this.focused === null) {
      return;
    }
    const key = encodeURIComponent(this.focused);
    const boxes = this.paperHost.querySelectorAll(`[data-object-key="${key}"]`);
    boxes.forEach((element: Element) => element.classList.add(FOCUS_CLASS));
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
   * A section's name, in the same slate disclosure band wherever it stands.
   *
   * A one-column section takes one column and a spanning section takes two;
   * neither changes width with the content at the current step.
   */
  private sectionHeading(
    text: string,
    x: number,
    y: number,
    section: CanvasSection,
    width: number
  ): dia.Element {
    const collapsed = this.collapsed.has(section);
    const heading = new shapes.standard.Rectangle({ z: 4 });
    heading.position(x, y);
    heading.resize(width, HEADING_HEIGHT);
    heading.attr({
      body: {
        fill: '#26384a',
        stroke: '#26384a',
        rx: 4,
        ry: 4,
        class: 'plivet-section-heading',
        'data-section-target': section,
      },
      label: {
        text: `${collapsed ? '▶' : '▼'}  ${text}`,
        fill: '#ffffff',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 14,
        fontWeight: 'bold',
        pointerEvents: 'none',
      },
    });
    this.contentWidth = Math.max(this.contentWidth, x + width + ORIGIN_X);
    this.contentHeight = Math.max(this.contentHeight, y + HEADING_HEIGHT);
    return heading;
  }

  /**
   * The first section: what the statement under the step marker is doing.
   *
   * Its heading is always drawn, whatever the step is. A section that appeared
   * and vanished as the program moved from one kind of statement to the next
   * moved the call stack and memory map with it, and a reader following a run
   * cannot read a page that will not hold still.
   *
   * What goes under the heading names the construct the step is inside and
   * what it is doing - the same records the tooltip reads, so the two never
   * disagree. Its expression is the full-width section below the top row.
   */
  private statementCells(
    model: StepModel,
    originX: number,
    originY: number
  ): dia.Cell[] {
    // Statement visibility is independent of the expansion below it.
    if (!this.view.isStatementShown()) {
      return [];
    }
    const cells: dia.Cell[] = [
      this.sectionHeading(
        strings.graphStatementHeading,
        originX,
        originY,
        'statement',
        COLUMN_WIDTH
      ),
    ];
    if (this.collapsed.has('statement')) {
      return cells;
    }
    const headingBottom = originY + HEADING_HEIGHT + HEADING_GAP;
    this.contentWidth = Math.max(
      this.contentWidth,
      originX + COLUMN_WIDTH + ORIGIN_X
    );
    this.contentHeight = Math.max(this.contentHeight, headingBottom);
    // Preserve the explanation's title/fact structure. Flattening these into
    // one string made a clause, a runtime result and a language note look like
    // equally important fragments of prose.
    const includeValues =
      model.expression === null ||
      !this.view.isExpressionShown() ||
      this.collapsed.has('expression');
    cells.push(
      ...this.statementCardCells(
        statementCard(model, this.explanation, includeValues),
        originX,
        headingBottom
      )
    );
    return cells;
  }

  /** The active calls beside the statement whose state they define. */
  private callStackCells(
    model: StepModel,
    originX: number,
    originY: number
  ): dia.Cell[] {
    const cells: dia.Cell[] = [
      this.sectionHeading(
        strings.viewCallStack,
        originX,
        originY,
        'callStack',
        COLUMN_WIDTH
      ),
    ];
    if (this.collapsed.has('callStack')) {
      return cells;
    }

    const rows = callStackRows(model.frames);
    const shown =
      rows.length === 0
        ? [
            {
              name: strings.viewNothingRunning,
              where: '',
              arguments: '',
              timesEntered: '',
              current: false,
            },
          ]
        : rows;
    let y = originY + HEADING_HEIGHT + HEADING_GAP;
    for (const row of shown) {
      const details = [row.where, row.arguments, row.timesEntered].filter(
        (part) => part !== ''
      );
      const text = [row.name, details.join(' · ')].filter(Boolean).join('\n');
      const height = details.length === 0 ? 34 : 48;
      const cell = new shapes.standard.Rectangle({ z: 4 });
      cell.position(originX, y);
      cell.resize(COLUMN_WIDTH, height);
      cell.attr({
        body: {
          fill: row.current ? '#e8f2ff' : '#ffffff',
          stroke: row.current ? '#4f81bd' : '#cfd8e1',
          strokeWidth: row.current ? 2 : 1,
          rx: 3,
          ry: 3,
        },
        label: {
          text,
          fill: '#26384a',
          fontFamily: "Consolas, 'Courier New', monospace",
          fontSize: 13,
          ...leftAlignedLabel(10, height),
        },
      });
      cells.push(cell);
      y += height + CALL_ROW_GAP;
    }
    this.contentWidth = Math.max(
      this.contentWidth,
      originX + COLUMN_WIDTH + ORIGIN_X
    );
    this.contentHeight = Math.max(this.contentHeight, y + ORIGIN_X);
    return cells;
  }

  /** The expression tree below, spanning both top-row columns. */
  private expressionSectionCells(
    model: StepModel,
    originX: number,
    originY: number
  ): dia.Cell[] {
    const cells: dia.Cell[] = [
      this.sectionHeading(
        strings.graphExpressionHeading,
        originX,
        originY,
        'expression',
        TWO_COLUMN_WIDTH
      ),
    ];
    if (this.collapsed.has('expression')) {
      return cells;
    }
    const bodyY = originY + HEADING_HEIGHT + HEADING_GAP;
    if (model.expression === null) {
      cells.push(
        this.messageLine(
          [strings.expressionNotAvailable],
          originX,
          bodyY,
          TWO_COLUMN_WIDTH
        )
      );
    } else {
      cells.push(...this.expressionCells(model.expression, originX, bodyY));
    }
    return cells;
  }

  /** A teaching card: title, context, one explanation, then produced values. */
  private statementCardCells(
    card: StatementCardModel,
    originX: number,
    originY: number
  ): dia.Cell[] {
    const cells: dia.Cell[] = [];
    let y = originY;

    cells.push(
      this.cardCell(card.title, originX, y, COLUMN_WIDTH, CARD_TITLE_HEIGHT, {
        fill: '#e8f2ff',
        stroke: '#9fbfe5',
        color: '#234b73',
        bold: true,
        fontSize: 15,
      })
    );
    y += CARD_TITLE_HEIGHT;

    if (card.context !== '') {
      const contextHeight = this.cardTextHeight(
        card.context,
        COLUMN_WIDTH,
        CARD_CONTEXT_HEIGHT
      );
      cells.push(
        this.cardCell(card.context, originX, y, COLUMN_WIDTH, contextHeight, {
          fill: '#f7f9fb',
          stroke: '#cfd8e1',
          color: '#5d6b78',
          fontSize: 12,
        })
      );
      y += contextHeight;
    }

    if (card.description !== '') {
      const descriptionHeight = this.cardTextHeight(
        card.description,
        COLUMN_WIDTH,
        CARD_DESCRIPTION_HEIGHT
      );
      cells.push(
        this.cardCell(
          card.description,
          originX,
          y,
          COLUMN_WIDTH,
          descriptionHeight,
          {
            fill: '#ffffff',
            stroke: '#cfd8e1',
            color: '#26384a',
            fontSize: 13,
          }
        )
      );
      y += descriptionHeight;
    }

    if (card.values.length !== 0) {
      cells.push(
        this.cardCell(
          strings.statementValuesHeading,
          originX,
          y,
          COLUMN_WIDTH,
          CARD_SECTION_HEIGHT,
          {
            fill: '#eef2f6',
            stroke: '#cfd8e1',
            color: '#4a5b6c',
            bold: true,
            fontSize: 12,
          }
        )
      );
      y += CARD_SECTION_HEIGHT;
      for (const row of card.values) {
        const rendered = this.cardRow(row, originX, y);
        cells.push(...rendered.cells);
        y = rendered.bottom;
      }
    }

    this.contentWidth = Math.max(
      this.contentWidth,
      originX + COLUMN_WIDTH + ORIGIN_X
    );
    this.contentHeight = Math.max(this.contentHeight, y + ORIGIN_X);
    return cells;
  }

  private cardRow(
    row: StatementCardRow,
    originX: number,
    originY: number
  ): { cells: dia.Cell[]; bottom: number } {
    if (row.value === '') {
      const height = this.cardRowHeight(row.label, COLUMN_WIDTH);
      return {
        cells: [
          this.cardCell(row.label, originX, originY, COLUMN_WIDTH, height, {
            fill: '#fff8e1',
            stroke: '#e2d3a4',
            color: '#5c5130',
            code: row.labelCode,
            fontSize: 13,
          }),
        ],
        bottom: originY + height,
      };
    }

    const valueWidth = COLUMN_WIDTH - CARD_LABEL_WIDTH;
    const height = Math.max(
      this.cardRowHeight(row.label, CARD_LABEL_WIDTH),
      this.cardRowHeight(row.value, valueWidth)
    );
    return {
      cells: [
        this.cardCell(row.label, originX, originY, CARD_LABEL_WIDTH, height, {
          fill: '#eef2f6',
          stroke: '#cfd8e1',
          color: '#4a5b6c',
          bold: !row.labelCode,
          code: row.labelCode,
          fontSize: 12,
        }),
        this.cardCell(
          row.value,
          originX + CARD_LABEL_WIDTH,
          originY,
          valueWidth,
          height,
          {
            fill: '#ffffff',
            stroke: '#cfd8e1',
            color: '#26384a',
            code: row.valueCode,
            fontSize: 13,
          }
        ),
      ],
      bottom: originY + height,
    };
  }

  private cardRowHeight(text: string, width: number): number {
    return this.cardTextHeight(text, width, CARD_ROW_HEIGHT);
  }

  private cardTextHeight(text: string, width: number, minimum: number): number {
    const characters = Math.max(1, Math.floor((width - 20) / 7.2));
    return Math.max(minimum, Math.ceil(text.length / characters) * 18 + 12);
  }

  private cardCell(
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    style: {
      fill: string;
      stroke: string;
      color: string;
      bold?: boolean;
      code?: boolean;
      fontSize: number;
    }
  ): dia.Element {
    const cell = new shapes.standard.Rectangle({ z: 4 });
    cell.position(x, y);
    cell.resize(width, height);
    cell.attr({
      body: { fill: style.fill, stroke: style.stroke },
      label: {
        text,
        fill: style.color,
        fontFamily:
          style.code === true
            ? "Consolas, 'Courier New', monospace"
            : 'system-ui, sans-serif',
        fontSize: style.fontSize,
        fontWeight: style.bold === true ? 'bold' : 'normal',
        ...leftAlignedLabel(10, height),
        textWrap: { width: -20, height: -8 },
      },
    });
    return cell;
  }

  /** A plain full-width message, used when a visual section has no model. */
  private messageLine(
    lines: string[],
    x: number,
    y: number,
    width: number
  ): dia.Element {
    const text = lines.join('\n');
    const charactersPerLine = Math.max(1, Math.floor((width - 24) / 7.4));
    const renderedLines = lines.reduce(
      (count, line) =>
        count + Math.max(1, Math.ceil(line.length / charactersPerLine)),
      0
    );
    const height = Math.max(32, renderedLines * STATEMENT_LINE_HEIGHT);
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
        ...leftAlignedLabel(2, height),
        textWrap: { width: -12, height: -6 },
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
