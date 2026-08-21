import { Plivet, parseConfig, readConfig } from '../src/index';
import { ViewOptions } from '../src/core';
import { ControlBar } from '../src/ui/controls';
import strings from '../src/strings';

/* The canvas needs a browser; what this file checks above it does not. */
jest.mock('../src/ui/graph', () => ({
  PlivetGraph: class {
    constructor(
      private readonly container: HTMLElement,
      readonly options: { views?: unknown } = {}
    ) {
      this.container.classList.add('plivet-graph');
      (globalThis as unknown as { graphViews: unknown }).graphViews =
        options.views;
    }
    render(): void {}
    setScale(): void {}
    setDark(): void {}
    destroy(): void {
      this.container.classList.remove('plivet-graph');
    }
  },
}));

/**
 * The configuration an embedding page writes, from the markup it writes it in
 * to the widgets it decides.
 *
 * A page that cannot run JavaScript of its own is the whole reason this
 * exists, so the tests start where such a page starts: an element with an
 * attribute on it. What matters about the reader is that it is not a
 * `JSON.parse` - a course author writing `"theme": "drak"` by hand must get
 * PLIVET, not a blank pane - so every wrong field here is checked to be
 * dropped on its own, leaving the rest of the configuration standing.
 */

const configElement = (json: string, id = 'c-visualizer-config') => {
  const element = document.createElement('div');
  element.id = id;
  element.setAttribute('config', json);
  document.body.appendChild(element);
  return element;
};

const parentOf = () => {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return parent;
};

let warnings: string[] = [];

beforeEach(() => {
  warnings = [];
  jest.spyOn(console, 'warn').mockImplementation((message: unknown) => {
    warnings.push(String(message));
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('reading the page configuration', () => {
  it('is nothing at all when the page has no configuration element', () => {
    expect(readConfig(document)).toEqual({});
    expect(warnings).toEqual([]);
  });

  it('reads the JSON off the config attribute of the named element', () => {
    configElement('{"theme": "dark", "entry": "main.c"}');

    expect(readConfig(document)).toEqual({ theme: 'dark', entry: 'main.c' });
  });

  it('reads an element that carries its JSON as its own text', () => {
    const element = configElement('');
    element.removeAttribute('config');
    element.textContent = '{"theme": "dark"}';

    expect(readConfig(document)).toEqual({ theme: 'dark' });
  });

  it('leaves another element alone', () => {
    configElement('{"theme": "dark"}', 'something-else');

    expect(readConfig(document)).toEqual({});
  });

  it('opens as it comes when the configuration is not JSON', () => {
    configElement('{ theme: dark');

    expect(readConfig(document)).toEqual({});
    expect(warnings).toHaveLength(1);
  });
});

describe('what a configuration may say', () => {
  it('carries the program, its files and the spans a reader may type in', () => {
    expect(
      parseConfig(
        JSON.stringify({
          sourceCode: 'int main(void) { return 0; }',
          files: [{ path: 'main.c', text: 'int main(void) { return 0; }' }],
          entry: 'main.c',
          editableRegions: [{ from: 4, to: 8 }],
        })
      )
    ).toEqual({
      sourceCode: 'int main(void) { return 0; }',
      files: [{ path: 'main.c', text: 'int main(void) { return 0; }' }],
      entry: 'main.c',
      editableRegions: [{ from: 4, to: 8 }],
    });
  });

  it('switches features off by name and says nothing about the rest', () => {
    expect(parseConfig('{"features": {"preprocessor": false}}')).toEqual({
      features: { preprocessor: false },
    });
    expect(parseConfig('{"features": {"loadFile": false}}')).toEqual({
      features: { loadFile: false },
    });
  });

  it('carries the canvas sections and the memory regions', () => {
    expect(
      parseConfig(
        JSON.stringify({
          views: {
            statement: false,
            callStack: true,
            expression: false,
            memory: true,
            mutations: false,
            regions: { heap: false, registers: true },
          },
        })
      )
    ).toEqual({
      views: {
        statement: false,
        callStack: true,
        expression: false,
        memory: true,
        mutations: false,
        regions: { heap: false, registers: true },
      },
    });
  });

  it('drops a field that is not what it claims and keeps the others', () => {
    const options = parseConfig(
      JSON.stringify({
        theme: 'drak',
        entry: 7,
        features: { preprocessor: 'no', loadFile: false },
        views: { statement: 'off', mutations: false, regions: { moon: true } },
      })
    );

    expect(options).toEqual({
      features: { loadFile: false },
      views: { mutations: false, regions: {} },
    });
    expect(warnings).toHaveLength(5);
  });

  it('refuses a configuration that is not an object', () => {
    expect(parseConfig('["dark"]')).toEqual({});
    expect(warnings).toHaveLength(1);
  });
});

describe('what the configuration decides', () => {
  it('leaves the preprocessor button off the control bar', () => {
    const parent = parentOf();
    const bar = new ControlBar(parent, { preprocessor: false });

    expect(parent.textContent).not.toContain(strings.preprocessedButton);
    expect(parent.textContent).toContain(strings.howToUse);

    bar.destroy();
  });

  it('keeps the preprocessor button when nothing says otherwise', () => {
    const parent = parentOf();
    const bar = new ControlBar(parent, {});

    expect(parent.textContent).toContain(strings.preprocessedButton);

    bar.destroy();
  });

  it('opens without the upload panel, and without the room it took', () => {
    const parent = parentOf();
    const plivet = new Plivet(parent, { features: { loadFile: false } });

    expect(parent.querySelector('.plivet-files')).toBeNull();
    expect(parent.querySelector('.plivet__files')).toBeNull();

    plivet.destroy();
  });

  it('keeps the upload panel when nothing says otherwise', () => {
    const parent = parentOf();
    const plivet = new Plivet(parent);

    expect(parent.querySelector('.plivet-files')).not.toBeNull();

    plivet.destroy();
  });

  it('hands the canvas the sections the page asked for', () => {
    const parent = parentOf();
    const plivet = new Plivet(parent, { views: { expression: false } });

    expect(
      (globalThis as unknown as { graphViews: unknown }).graphViews
    ).toEqual({ expression: false });

    plivet.destroy();
  });
});

describe('a view selection applied to the canvas state', () => {
  it('sets what it names and leaves the rest as the canvas had it', () => {
    const view = new ViewOptions();

    view.apply({ expression: false, regions: { heap: false } });

    expect(view.isExpressionShown()).toBe(false);
    expect(view.isStatementShown()).toBe(true);
    expect(view.isCallStackShown()).toBe(true);
    expect(view.isMemoryShown()).toBe(true);
    expect(view.areMutationsShown()).toBe(true);
    expect(view.isRegionShown('heap')).toBe(false);
    // A region it did not name keeps the answer the canvas works out itself.
    expect(view.isRegionShown('bss', false)).toBe(false);
    expect(view.isRegionShown('bss', true)).toBe(true);
  });
});
