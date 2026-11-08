import type { MemoryRegion, SourceFile, ViewSelection } from '../core';
import type { EditableRegion, LineRange, SessionJSON } from '../ui/editor';
import { isLineRange } from '../ui/editor/segments';
import { isSession } from '../ui/editor/session';
import type {
  PlivetControls,
  PlivetFeatures,
  PlivetLayoutMode,
  PlivetOptions,
} from './Plivet';
import type { EditableRegionsOption, FileEditableLines } from './protection';
import { codeMirrorTheme, type CodeMirrorConfig } from './host';
import { codeMirrorCount, codeMirrorFlag } from './host';
import type { Theme } from './theme';

/**
 * What an embedding page says before c-visualizer opens, and how it says it.
 *
 * `new CVisualizer(element, options)` has always taken this; what was missing
 * was a way for a page that only includes the bundle - a course page, a Moodle
 * block, anything that cannot run a line of JavaScript of its own - to reach
 * it. So the page writes the same options as JSON on an element the standalone
 * entry looks for, and `main.ts` hands what it finds to the constructor.
 *
 *     <div id="c-visualizer-config" config='{"theme": "dark"}'></div>
 *
 * The JSON is on the `config` attribute. An element that carries none is read
 * for its own text instead, because that is the other way a page naturally
 * writes a block of JSON into markup, and both mean the same thing here.
 *
 * Nothing in here trusts what it reads. A configuration is written by hand, in
 * a page whose author cannot see a stack trace, so every field is checked and
 * a field that is not what it claims is dropped with a warning rather than
 * carried into the application: a page with one misspelled option opens as
 * PLIVET's default rather than not at all.
 */

/** The element the standalone page looks for. */
export const CONFIG_ELEMENT_ID = 'c-visualizer-config';

/** The attribute the JSON is written on. */
export const CONFIG_ATTRIBUTE = 'config';

/**
 * The regions a configuration may name, as a table rather than a list so that
 * adding one to `MemoryRegion` fails to compile here until it is named.
 */
const REGIONS: Record<MemoryRegion, true> = {
  text: true,
  readOnly: true,
  data: true,
  bss: true,
  heap: true,
  stack: true,
  registers: true,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRegion = (name: string): name is MemoryRegion =>
  Object.prototype.hasOwnProperty.call(REGIONS, name);

/** A field that must be a boolean, and is dropped when it is anything else. */
const boolean = (value: unknown, field: string): boolean | undefined => {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    warn(`${field} must be true or false`);
    return undefined;
  }
  return value;
};

const string = (value: unknown, field: string): string | undefined => {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (typeof value !== 'string') {
    warn(`${field} must be a string`);
    return undefined;
  }
  return value;
};

const warn = (message: string): void => {
  console.warn(`${CONFIG_ELEMENT_ID}: ${message}`);
};

const themeOf = (value: unknown): Theme | undefined => {
  const name = string(value, 'theme');
  if (typeof name === 'undefined') {
    return undefined;
  }
  if (name !== 'light' && name !== 'dark') {
    warn('theme must be "light" or "dark"');
    return undefined;
  }
  return name;
};

/**
 * The features the page has an opinion about. One it does not name is left
 * out of the result rather than defaulted here, so that what "not configured"
 * means stays the application's answer and not this reader's.
 */
const featuresOf = (value: unknown): PlivetFeatures | undefined => {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (!isObject(value)) {
    warn('features must be an object');
    return undefined;
  }
  const features: PlivetFeatures = {};
  const preprocessor = boolean(value.preprocessor, 'features.preprocessor');
  const loadSource = boolean(value.loadSource, 'features.loadSource');
  const loadFile = boolean(value.loadFile, 'features.loadFile');
  const programArgs = boolean(value.programArgs, 'features.programArgs');
  if (typeof preprocessor !== 'undefined') {
    features.preprocessor = preprocessor;
  }
  if (typeof loadFile !== 'undefined') {
    features.loadFile = loadFile;
  }
  if (typeof loadSource !== 'undefined') {
    features.loadSource = loadSource;
  }
  if (typeof programArgs !== 'undefined') {
    features.programArgs = programArgs;
  }
  return features;
};

/** The canvas sections and memory regions the page wants drawn, or not. */
const viewsOf = (value: unknown): ViewSelection | undefined => {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (!isObject(value)) {
    warn('views must be an object');
    return undefined;
  }
  const views: ViewSelection = {};
  for (const section of [
    'diagnostics',
    'statement',
    'callStack',
    'expression',
    'variables',
    'memory',
    'mutations',
  ] as const) {
    const shown = boolean(value[section], `views.${section}`);
    if (typeof shown !== 'undefined') {
      views[section] = shown;
    }
  }
  if (typeof value.regions !== 'undefined') {
    if (!isObject(value.regions)) {
      warn('views.regions must be an object');
    } else {
      const regions: Partial<Record<MemoryRegion, boolean>> = {};
      for (const [name, shown] of Object.entries(value.regions)) {
        if (!isRegion(name)) {
          warn(`views.regions.${name} is not a memory region`);
          continue;
        }
        const drawn = boolean(shown, `views.regions.${name}`);
        if (typeof drawn !== 'undefined') {
          regions[name] = drawn;
        }
      }
      views.regions = regions;
    }
  }
  return views;
};

/**
 * The editor settings a page names, in either spelling, under the names the
 * editor takes.
 *
 * The two tables are the fields this reads; a key that is in neither is left
 * alone rather than warned about. A page hands over the configuration it built
 * its own editors with, whole, and most of what is in one - the languages it
 * has editors for, the code blocks it replaces - is about editors this window
 * does not hold.
 */
const CODEMIRROR_COUNTS: Record<string, string> = {
  indentUnit: 'indent_unit',
  fontSize: 'font_size',
};

const CODEMIRROR_FLAGS: Record<string, string> = {
  indentWithTabs: 'indent_with_tabs',
  electricChars: 'electric_chars',
  matchBrackets: 'match_brackets',
  lineNumbers: 'line_numbers',
  autocomplete: 'autocomplete',
};

const CODEMIRROR_THEMES: Record<string, string> = {
  lightTheme: 'light_theme',
  darkTheme: 'dark_theme',
};

const codeMirrorOf = (value: unknown): CodeMirrorConfig | undefined => {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (!isObject(value)) {
    warn('codeMirror must be an object');
    return undefined;
  }
  const config: CodeMirrorConfig = {};
  for (const [name, written] of Object.entries(CODEMIRROR_COUNTS)) {
    const setting = value[name] ?? value[written];
    if (typeof setting === 'undefined') {
      continue;
    }
    const count = codeMirrorCount(setting);
    if (typeof count === 'undefined') {
      warn(`codeMirror.${written} must be a whole number of one or more`);
      continue;
    }
    config[name] = count;
  }
  for (const [name, written] of Object.entries(CODEMIRROR_FLAGS)) {
    const setting = value[name] ?? value[written];
    if (typeof setting === 'undefined') {
      continue;
    }
    const flag = codeMirrorFlag(setting);
    if (typeof flag === 'undefined') {
      warn(`codeMirror.${written} must be true or false`);
      continue;
    }
    config[name] = flag;
  }
  for (const [name, written] of Object.entries(CODEMIRROR_THEMES)) {
    const setting = value[name] ?? value[written];
    if (typeof setting === 'undefined') {
      continue;
    }
    const theme = codeMirrorTheme(setting);
    if (typeof theme === 'undefined') {
      warn(`codeMirror.${written} must be "default" or "one-dark"`);
      continue;
    }
    config[name] = theme;
  }
  return config;
};

/**
 * The tabs the editor opens with. A file missing either half of its name and
 * text is dropped: the tab bar and the interpreter both work in whole files,
 * and half of one is not something to open beside the others.
 */
const filesOf = (value: unknown): SourceFile[] | undefined => {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (!Array.isArray(value)) {
    warn('files must be an array');
    return undefined;
  }
  const files: SourceFile[] = [];
  for (const [index, file] of value.entries()) {
    const path = isObject(file)
      ? string(file.path, `files[${index}].path`)
      : undefined;
    const text = isObject(file)
      ? string(file.text, `files[${index}].text`)
      : undefined;
    if (typeof path === 'undefined' || typeof text === 'undefined') {
      warn(`files[${index}] needs a path and a text`);
      continue;
    }
    files.push({ path, text });
  }
  return files;
};

/**
 * The spans the reader may type in: offsets into the entry file, or line
 * ranges per file. A range that is not one is dropped on its own, and the
 * lines it would have opened stay protected - the rule the Sphinx build
 * applies to a part of `:editable-lines:` it cannot read.
 */
const regionsOf = (value: unknown): EditableRegionsOption | undefined => {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (Array.isArray(value)) {
    const regions: EditableRegion[] = [];
    for (const [index, region] of value.entries()) {
      const from = isObject(region) ? region.from : undefined;
      const to = isObject(region) ? region.to : undefined;
      if (typeof from !== 'number' || typeof to !== 'number') {
        warn(`editableRegions[${index}] needs a numeric from and to`);
        continue;
      }
      regions.push({ from, to });
    }
    return regions;
  }
  if (!isObject(value)) {
    warn(
      'editableRegions must be an array of offsets or an object of line ranges per file'
    );
    return undefined;
  }
  const byFile: Record<string, LineRange[] | FileEditableLines> = {};
  for (const [path, entry] of Object.entries(value)) {
    const field = `editableRegions.${path}`;
    const lines = Array.isArray(entry)
      ? entry
      : isObject(entry)
        ? entry.lines
        : undefined;
    if (!Array.isArray(lines)) {
      warn(`${field} must be [start, end] line ranges, or { lines, text }`);
      continue;
    }
    const ranges: LineRange[] = [];
    for (const [index, range] of lines.entries()) {
      if (!isLineRange(range)) {
        warn(
          `${field}[${index}] must be [start, end], counted from 1, start not after end`
        );
        continue;
      }
      ranges.push([range[0], range[1]]);
    }
    const text = isObject(entry)
      ? string(entry.text, `${field}.text`)
      : undefined;
    byFile[path] =
      typeof text === 'undefined' ? ranges : { lines: ranges, text };
  }
  return byFile;
};

/**
 * A session to open with. It is checked whole, as `restoreSession` checks
 * one: a session with one malformed file is no session.
 */
const sessionOf = (value: unknown): SessionJSON | undefined => {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (!isSession(value)) {
    warn('session must be a version 1 or version 2 session');
    return undefined;
  }
  return value;
};

/** Side by side, one above the other, or whichever the width suits. */
const layoutOf = (value: unknown): PlivetLayoutMode | undefined => {
  const name = string(value, 'layout');
  if (typeof name === 'undefined') {
    return undefined;
  }
  if (name !== 'auto' && name !== 'columns' && name !== 'stacked') {
    warn('layout must be "auto", "columns" or "stacked"');
    return undefined;
  }
  return name;
};

/** The width, in pixels, below which `auto` stacks the boxes. */
const stackedBelowOf = (value: unknown): number | undefined => {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    warn('stackedBelow must be a number of pixels, 0 or more');
    return undefined;
  }
  return value;
};

/**
 * The program's arguments: an array of strings, or one string written as a
 * command line, kept as written so the control bar's field shows the page's
 * own quoting. The application splits it.
 */
const argsOf = (value: unknown): string[] | string | undefined => {
  if (typeof value === 'undefined' || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && value.every((arg) => typeof arg === 'string')) {
    return [...value];
  }
  warn('args must be an array of strings or one string of arguments');
  return undefined;
};

/** The control-bar items the page takes off the bar. */
const controlsOf = (value: unknown): PlivetControls | undefined => {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (!isObject(value)) {
    warn('controls must be an object');
    return undefined;
  }
  const controls: PlivetControls = {};
  for (const [name, shown] of Object.entries(value)) {
    if (name !== 'theme' && name !== 'textSize') {
      warn(`controls.${name} is not a control that can be hidden`);
      continue;
    }
    const flag = boolean(shown, `controls.${name}`);
    if (typeof flag !== 'undefined') {
      controls[name] = flag;
    }
  }
  return controls;
};

/**
 * A configuration out of the JSON a page wrote, with every field it got wrong
 * left out. Text that is not JSON at all, or is JSON that is not an object, is
 * no configuration: the caller opens as it would have with none.
 */
export function parseConfig(text: string): PlivetOptions {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    warn('the configuration is not valid JSON and was ignored');
    return {};
  }
  if (!isObject(parsed)) {
    warn('the configuration must be a JSON object');
    return {};
  }
  const options: PlivetOptions = {};
  const sourceCode = string(parsed.sourceCode, 'sourceCode');
  const entry = string(parsed.entry, 'entry');
  const theme = themeOf(parsed.theme);
  const files = filesOf(parsed.files);
  const editableRegions = regionsOf(parsed.editableRegions);
  const session = sessionOf(parsed.session);
  const controls = controlsOf(parsed.controls);
  const layout = layoutOf(parsed.layout);
  const stackedBelow = stackedBelowOf(parsed.stackedBelow);
  const features = featuresOf(parsed.features);
  const args = argsOf(parsed.args);
  const footer = boolean(parsed.footer, 'footer');
  const licenses = string(parsed.licenses, 'licenses');
  const codeMirror = codeMirrorOf(
    parsed.codeMirror ?? parsed.codemirror ?? parsed.codemirror_config
  );
  const views = viewsOf(parsed.views);
  const supportBuild = boolean(
    parsed['support-build'] ?? parsed.supportBuild,
    'support-build'
  );
  if (typeof sourceCode !== 'undefined') {
    options.sourceCode = sourceCode;
  }
  if (typeof entry !== 'undefined') {
    options.entry = entry;
  }
  if (typeof theme !== 'undefined') {
    options.theme = theme;
  }
  if (typeof files !== 'undefined') {
    options.files = files;
  }
  if (typeof editableRegions !== 'undefined') {
    options.editableRegions = editableRegions;
  }
  if (typeof session !== 'undefined') {
    options.session = session;
  }
  if (typeof controls !== 'undefined') {
    options.controls = controls;
  }
  if (typeof layout !== 'undefined') {
    options.layout = layout;
  }
  if (typeof stackedBelow !== 'undefined') {
    options.stackedBelow = stackedBelow;
  }
  if (typeof features !== 'undefined') {
    options.features = features;
  }
  if (typeof args !== 'undefined') {
    options.args = args;
  }
  if (typeof footer !== 'undefined') {
    options.footer = footer;
  }
  if (typeof codeMirror !== 'undefined') {
    options.codeMirror = codeMirror;
  }
  if (typeof views !== 'undefined') {
    options.views = views;
  }
  if (typeof licenses !== 'undefined') {
    options.licenses = licenses;
  }
  if (typeof supportBuild !== 'undefined') {
    options.supportBuild = supportBuild;
  }
  return options;
}

/**
 * What the page configured, or nothing at all.
 *
 * No element, or one carrying neither the attribute nor any text of its own,
 * is not an error: a page that wants c-visualizer as it comes writes no
 * configuration, and this is what it gets.
 */
export function readConfig(
  doc: Document = document,
  id: string = CONFIG_ELEMENT_ID
): PlivetOptions {
  const element = doc.getElementById(id);
  if (element === null) {
    return {};
  }
  const written = element.getAttribute(CONFIG_ATTRIBUTE) ?? element.textContent;
  if (written === null || written.trim() === '') {
    return {};
  }
  return parseConfig(written);
}
