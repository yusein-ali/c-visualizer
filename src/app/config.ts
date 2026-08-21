import type { MemoryRegion, SourceFile, ViewSelection } from '../core';
import type { EditableRegion } from '../ui/editor';
import type { PlivetFeatures, PlivetOptions } from './Plivet';
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
  const loadFile = boolean(value.loadFile, 'features.loadFile');
  if (typeof preprocessor !== 'undefined') {
    features.preprocessor = preprocessor;
  }
  if (typeof loadFile !== 'undefined') {
    features.loadFile = loadFile;
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
    'statement',
    'callStack',
    'expression',
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

/** The spans the reader may type in, as offsets into the program. */
const regionsOf = (value: unknown): EditableRegion[] | undefined => {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (!Array.isArray(value)) {
    warn('editableRegions must be an array');
    return undefined;
  }
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
  const features = featuresOf(parsed.features);
  const views = viewsOf(parsed.views);
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
  if (typeof features !== 'undefined') {
    options.features = features;
  }
  if (typeof views !== 'undefined') {
    options.views = views;
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
