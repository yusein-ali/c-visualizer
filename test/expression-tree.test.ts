import { dia } from '@joint/core';
import { EXPRESSION_MODEL_VERSION, ExpressionNodeModel } from '../src/core';
import type {
  CExpressionTreeGlobal,
  CExpressionTreeHandle,
} from '../src/expression.entry';
import { DIMMED_OPACITY } from '../src/ui/graph/ExpressionNode';

/*
 * `c-expression.js` as a host drives it.
 *
 * The paper is stubbed, and only the paper. JointJS turns its vectorizer off
 * when `window.SVGAngle` is missing, which is jsdom - `V.prototype` ends up
 * empty and constructing a `dia.Paper` throws (`instances.test.ts` stubs the
 * whole canvas for the same reason). The graph and the cells are real, so
 * what is checked here is what would be drawn: the boxes, the pills, the
 * outline, the scale and the paper's size. The drawing itself is checked in a
 * browser.
 */
interface FakePaper {
  options: { el: HTMLElement; model: dia.Graph };
  scales: [number, number][];
  dimensions: [number, number][];
  removed: boolean;
}

const mockPapers: FakePaper[] = [];

jest.mock('@joint/core', () => {
  const actual = jest.requireActual('@joint/core');
  class Paper {
    scales: [number, number][] = [];
    dimensions: [number, number][] = [];
    removed = false;
    constructor(public options: FakePaper['options']) {
      mockPapers.push(this);
    }
    scale(sx: number, sy: number): void {
      this.scales.push([sx, sy]);
    }
    setDimensions(width: number, height: number): void {
      this.dimensions.push([width, height]);
    }
    remove(): void {
      this.removed = true;
    }
  }
  return { ...actual, dia: { ...actual.dia, Paper } };
});

const range = { begin: { x: 0, y: 1 }, end: { x: 1, y: 1 } };
const leaf = (
  key: string,
  text: string,
  type: string,
  value: string | null = null
): ExpressionNodeModel => ({
  key,
  kind: 'operand',
  text,
  type,
  range,
  value,
  children: [],
});

/** `i / 2.0` with `int i = 5`, as the playground would hand it over. */
const model = (step: number) => ({
  range,
  root: {
    key: 'div',
    kind: 'operator' as const,
    text: '/',
    type: 'double',
    range,
    value: step >= 3 ? '2.5' : null,
    children: [
      {
        key: 'conv',
        kind: 'conversion' as const,
        text: 'int → double',
        type: 'double',
        range,
        value: step >= 2 ? '5.0' : null,
        children: [leaf('i', 'i', 'int', step >= 1 ? '5' : null)],
      },
      leaf('two', '2.0', 'double', '2.0'),
    ],
  },
});

const published = (): CExpressionTreeGlobal =>
  (window as unknown as { CExpressionTree: CExpressionTreeGlobal })
    .CExpressionTree;

const bodyOf = (element: dia.Element) =>
  (element.get('attrs') as Record<string, Record<string, unknown>>).body;

const labelOf = (element: dia.Element) =>
  (element.get('attrs') as Record<string, Record<string, unknown>>).label.text;

beforeAll(async () => {
  await import('../src/expression.entry');
});

afterEach(() => {
  mockPapers.length = 0;
  document.body.innerHTML = '';
});

describe('the c-expression.js entry', () => {
  it('publishes the API and a promise for it', async () => {
    const api = published();

    expect(api.version).toBe(EXPRESSION_MODEL_VERSION);
    expect(typeof api.mount).toBe('function');
    await expect(
      (window as unknown as { CExpressionTreeReady: Promise<unknown> })
        .CExpressionTreeReady
    ).resolves.toBe(api);
  });
});

describe('a mounted expression tree', () => {
  let parent: HTMLElement;
  let tree: CExpressionTreeHandle;

  beforeEach(() => {
    parent = document.createElement('div');
    document.body.appendChild(parent);
    tree = published().mount(parent, { theme: 'light' });
  });

  const paper = () => mockPapers[mockPapers.length - 1];
  const elements = () => paper().options.model.getElements();

  it('builds its own element and an empty paper', () => {
    const root = parent.querySelector('.plivet-expression-tree');

    expect(root).not.toBeNull();
    expect(root!.classList.contains('plivet-expression-tree--empty')).toBe(
      true
    );
    expect(paper().options.el.parentElement).toBe(root);
    expect(elements()).toHaveLength(0);
  });

  it('draws boxes, the conversion pill and links, and outlines one node', () => {
    tree.render(model(2), { highlight: 'conv' });

    expect(elements().map(labelOf)).toEqual(['/', 'int → double', 'i', '2.0']);
    expect(paper().options.model.getLinks()).toHaveLength(3);
    const outlined = elements().filter((element) =>
      String(bodyOf(element).stroke).includes('focus-line')
    );
    expect(outlined.map(labelOf)).toEqual(['int → double']);
    expect(bodyOf(elements()[1]).strokeDasharray).toBe('none');
    expect(
      parent
        .querySelector('.plivet-expression-tree')!
        .classList.contains('plivet-expression-tree--empty')
    ).toBe(false);
  });

  it('keeps one size while a tree is revealed step by step', () => {
    const sizes = [0, 1, 2, 3].map((step) => {
      tree.render(model(step), { highlight: ['div', 'i', 'conv'][step] });
      return paper().dimensions[paper().dimensions.length - 1];
    });

    expect(new Set(sizes.map(String)).size).toBe(1);
    expect(sizes[0][0]).toBeGreaterThan(0);
    expect(sizes[0][1]).toBeGreaterThan(0);
  });

  it('scales with the font size and leaves the geometry alone', () => {
    tree.render(model(0));
    const [width, height] = paper().dimensions[paper().dimensions.length - 1];
    const positions = elements().map((element) => element.position());

    tree.setFontSize(26);

    expect(paper().scales[paper().scales.length - 1]).toEqual([2, 2]);
    expect(paper().dimensions[paper().dimensions.length - 1]).toEqual([
      width * 2,
      height * 2,
    ]);
    expect(elements().map((element) => element.position())).toEqual(positions);
    tree.setFontSize(Number.NaN);
    expect(paper().scales[paper().scales.length - 1]).toEqual([2, 2]);
  });

  it('switches theme on its own element only', () => {
    const root = parent.querySelector('.plivet-expression-tree')!;

    tree.setTheme('dark');
    expect(root.classList.contains('plivet-expression-tree--dark')).toBe(true);
    tree.setTheme('light');
    expect(root.classList.contains('plivet-expression-tree--dark')).toBe(false);
  });

  it('takes a bare root node as well as a model, and null to clear', () => {
    tree.render(model(1).root);
    expect(elements()).toHaveLength(4);
    tree.render(null);
    expect(elements()).toHaveLength(0);
  });

  it('dims the subtree an operator skips, and the links into it', () => {
    // `a && b > 1` with `a` false: the right operand is never evaluated.
    const skipped: ExpressionNodeModel = {
      key: 'and',
      kind: 'operator',
      text: '&&',
      type: 'int',
      range,
      value: '0',
      children: [
        leaf('a', 'a', 'int', '0'),
        {
          key: 'gt',
          kind: 'operator',
          text: '>',
          type: 'int',
          range,
          value: null,
          children: [leaf('b', 'b', 'int'), leaf('one', '1', 'int', '1')],
        },
      ],
    };
    const opacity = (cell: dia.Cell) => cell.attr('root/opacity');
    tree.render(skipped, { highlight: 'and' });
    const positions = elements().map((element) => element.position());
    expect(elements().map(opacity)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);

    tree.render(skipped, { highlight: 'and', dim: 'gt' });

    const dimmed = elements()
      .filter((element) => opacity(element) !== undefined)
      .map(labelOf);
    expect(dimmed).toEqual(['>', 'b', '1']);
    expect(new Set(elements().map(opacity))).toEqual(
      new Set([undefined, DIMMED_OPACITY])
    );
    const links = paper().options.model.getLinks();
    expect(links.map(opacity)).toEqual([
      undefined,
      DIMMED_OPACITY,
      DIMMED_OPACITY,
      DIMMED_OPACITY,
    ]);
    // The outline is still drawn, and nothing moves.
    expect(
      elements()
        .filter((element) =>
          String(bodyOf(element).stroke).includes('focus-line')
        )
        .map(labelOf)
    ).toEqual(['&&']);
    expect(elements().map((element) => element.position())).toEqual(positions);

    tree.render(skipped, { dim: ['a', 'one'] });
    expect(
      elements()
        .filter((element) => opacity(element) !== undefined)
        .map(labelOf)
    ).toEqual(['a', '1']);
  });

  it('removes everything it built when destroyed', () => {
    tree.render(model(3));
    const drawn = paper();

    tree.destroy();

    expect(drawn.removed).toBe(true);
    expect(drawn.options.model.getCells()).toHaveLength(0);
    expect(parent.children).toHaveLength(0);
  });

  it('keeps two trees on one page apart', () => {
    const other = document.createElement('div');
    document.body.appendChild(other);
    const second = published().mount(other, {
      theme: 'dark',
      fontSize: 19.5,
      model: model(0),
    });
    const [first, last] = [mockPapers[0], paper()];

    expect(first).not.toBe(last);
    expect(last.options.model.getElements()).toHaveLength(4);
    expect(first.options.model.getElements()).toHaveLength(0);
    expect(last.scales[last.scales.length - 1]).toEqual([1.5, 1.5]);
    expect(
      parent
        .querySelector('.plivet-expression-tree')!
        .classList.contains('plivet-expression-tree--dark')
    ).toBe(false);
    second.destroy();
  });
});
