import {
  Plivet,
  codeMirrorSettings,
  parseConfig,
  readConfig,
} from '../src/index';
import { indentUnit } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
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
    expect(parseConfig('{"features": {"loadSource": true}}')).toEqual({
      features: { loadSource: true },
    });
  });

  it('configures whether the footer is shown', () => {
    expect(parseConfig('{"footer": false}')).toEqual({ footer: false });
    expect(parseConfig('{"footer": "no"}')).toEqual({});
    expect(warnings).toHaveLength(1);
  });

  it('opts into the host-backed Build button with its deployed key', () => {
    expect(parseConfig('{"support-build": true}')).toEqual({
      supportBuild: true,
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
            variables: true,
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
        variables: true,
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

    expect(
      parent.querySelector(`[aria-label="${strings.preprocessedButton}"]`)
    ).toBeNull();
    expect(
      parent.querySelector(`[aria-label="${strings.howToUse}"]`)
    ).not.toBeNull();

    bar.destroy();
  });

  it('keeps the preprocessor button when nothing says otherwise', () => {
    const parent = parentOf();
    const bar = new ControlBar(parent, {});

    expect(
      parent.querySelector(`[aria-label="${strings.preprocessedButton}"]`)
    ).not.toBeNull();

    bar.destroy();
  });

  it('shows included header content in the preprocessed comparison', async () => {
    const parent = parentOf();
    const plivet = new Plivet(parent, {
      files: [
        {
          path: 'main.c',
          text: '#include "values.h"\nint main(void) { return VALUE; }',
        },
        {
          path: 'values.h',
          text: '#define VALUE 7\nint header_declaration;',
        },
      ],
      entry: 'main.c',
    });

    await (plivet as any).showPreprocessed();

    const halves = parent.querySelectorAll<HTMLElement>(
      '.plivet-preprocessed .cm-content'
    );
    expect(halves).toHaveLength(2);
    expect(halves[0].textContent).toContain('#include "values.h"');
    expect(halves[0].textContent).not.toContain('int header_declaration;');
    expect(halves[1].textContent).toContain('int header_declaration;');
    expect(halves[1].textContent).toContain('return 7;');
    expect(halves[1].textContent).not.toContain('#include "values.h"');
    plivet.destroy();
  });

  it('opens without the upload panel, and without the room it took', () => {
    const parent = parentOf();
    const plivet = new Plivet(parent, {
      features: { loadFile: false, loadSource: true },
    });

    expect(parent.querySelector('.plivet-files')).toBeNull();
    expect(parent.querySelector('.plivet__files')).toBeNull();
    expect(
      parent.querySelector<HTMLButtonElement>(
        `[aria-label="${strings.openCode}"]`
      )?.disabled
    ).toBe(false);

    plivet.destroy();
  });

  it('keeps the upload panel when nothing says otherwise', () => {
    const parent = parentOf();
    const plivet = new Plivet(parent);

    expect(parent.querySelector('.plivet-files')).not.toBeNull();
    expect(
      parent.querySelector<HTMLButtonElement>(
        `[aria-label="${strings.openCode}"]`
      )?.disabled
    ).toBe(true);

    plivet.destroy();
  });

  it('leaves the footer out when the constructor disables it', () => {
    const parent = parentOf();
    const plivet = new Plivet(parent, { footer: false });

    expect(parent.querySelector('.plivet__footer')).toBeNull();

    plivet.destroy();
  });

  it('enables source loading independently of the data-file panel', () => {
    const parent = parentOf();
    const plivet = new Plivet(parent, {
      files: [{ path: 'main.c', text: 'int main(void) { return 0; }' }],
      features: { loadSource: true },
    });

    expect(
      parent.querySelector<HTMLButtonElement>(
        `[aria-label="${strings.openCode}"]`
      )?.disabled
    ).toBe(false);
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

/**
 * The editor settings of a host page, which reach the window a reader opens
 * from one of that page's own editors. The two spellings are the point: a
 * course writes `indent_with_tabs` in `conf.py` and the editor takes
 * `indentWithTabs`, and neither side translates for the other.
 */
describe('the CodeMirror configuration a host hands over', () => {
  it('reads the settings a course wrote, under the names the editor takes', () => {
    expect(
      parseConfig(
        JSON.stringify({
          codeMirror: {
            indent_unit: 4,
            indent_with_tabs: true,
            electric_chars: false,
            match_brackets: true,
            line_numbers: false,
            autocomplete: false,
            font_size: 16,
            light_theme: 'default',
            dark_theme: 'one-dark',
          },
        })
      )
    ).toEqual({
      codeMirror: {
        indentUnit: 4,
        indentWithTabs: true,
        electricChars: false,
        matchBrackets: true,
        lineNumbers: false,
        autocomplete: false,
        fontSize: 16,
        lightTheme: 'default',
        darkTheme: 'one-dark',
      },
    });
    expect(warnings).toEqual([]);
  });

  it('takes the page configuration under the key the page calls it', () => {
    expect(parseConfig('{"codemirror_config": {"indent_unit": 8}}')).toEqual({
      codeMirror: { indentUnit: 8 },
    });
    expect(parseConfig('{"codemirror": {"indentUnit": 8}}')).toEqual({
      codeMirror: { indentUnit: 8 },
    });
  });

  it('says nothing about the keys a page configuration carries for itself', () => {
    expect(
      parseConfig(
        JSON.stringify({
          codeMirror: {
            indent_unit: 2,
            language_configs: { python: { indent_with_tabs: false } },
            replace_all_code_blocks: false,
          },
        })
      )
    ).toEqual({ codeMirror: { indentUnit: 2 } });
    expect(warnings).toEqual([]);
  });

  it('drops a setting that is not what it claims and keeps the others', () => {
    const options = parseConfig(
      JSON.stringify({
        codeMirror: {
          indent_unit: 'four',
          font_size: 0,
          line_numbers: 'sometimes',
          light_theme: 'solarized',
          match_brackets: true,
        },
      })
    );

    expect(options).toEqual({ codeMirror: { matchBrackets: true } });
    expect(warnings).toHaveLength(4);
  });

  it('refuses a configuration that is not an object', () => {
    expect(parseConfig('{"codeMirror": "tabs"}')).toEqual({});
    expect(warnings).toHaveLength(1);
  });

  it('reads a setting written as the text of what it says', () => {
    // What the Sphinx extension fills a course's unwritten settings with,
    // and how it arrives here: as the JSON of a page's own configuration.
    expect(
      codeMirrorSettings(
        JSON.parse(
          '{"indent_unit": "4", "indent_with_tabs": "false",' +
            ' "line_numbers": "true", "light_theme": "default",' +
            ' "dark_theme": "one-dark"}'
        )
      )
    ).toEqual({
      indentUnit: 4,
      indentWithTabs: false,
      lineNumbers: true,
      lightTheme: 'default',
      darkTheme: 'one-dark',
    });
  });

  it('leaves out what a host did not name, or named as nothing it can be', () => {
    expect(codeMirrorSettings()).toEqual({});
    expect(
      codeMirrorSettings(
        JSON.parse('{"indent_unit": 2.5, "autocomplete": "yes"}')
      )
    ).toEqual({});
  });

  it('prefers the editor spelling where a host wrote both', () => {
    expect(codeMirrorSettings({ indentUnit: 2, indent_unit: 8 })).toEqual({
      indentUnit: 2,
    });
  });

  it('indents the way the page it was opened from indents', () => {
    const parent = parentOf();
    const plivet = new Plivet(parent, {
      codeMirror: { indent_unit: 4, indent_with_tabs: true },
    });
    const editor = parent.querySelector('.cm-editor');
    const view =
      editor === null ? null : EditorView.findFromDOM(editor as HTMLElement);

    expect(view?.state.facet(indentUnit)).toBe('\t');
    expect(view?.state.tabSize).toBe(4);

    plivet.destroy();
  });

  it('builds the editor without the gutter a page switched off', () => {
    const parent = parentOf();
    const plivet = new Plivet(parent, {
      codeMirror: { line_numbers: false },
    });

    expect(parent.querySelector('.cm-lineNumbers')).toBeNull();

    plivet.destroy();
  });

  it('keeps the gutter where nothing said otherwise', () => {
    const parent = parentOf();
    const plivet = new Plivet(parent);

    expect(parent.querySelector('.cm-lineNumbers')).not.toBeNull();

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
    expect(view.areVariablesShown()).toBe(true);
    expect(view.isMemoryShown()).toBe(true);
    expect(view.areMutationsShown()).toBe(true);
    expect(view.isRegionShown('heap')).toBe(false);
    // A region it did not name keeps the answer the canvas works out itself.
    expect(view.isRegionShown('bss', false)).toBe(false);
    expect(view.isRegionShown('bss', true)).toBe(true);
  });
});
