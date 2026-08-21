import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { cpp } from '@codemirror/lang-cpp';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { Construct } from '../src/interpreter/Construct';
import { cSnippets, ProgramCompletions } from '../src/ui/editor';

/**
 * What the editor offers while the reader types.
 *
 * The old source completed any word already in the buffer, so a misspelling
 * typed once was offered back forever and nothing was ever said about what a
 * name meant. What is checked here is that the offer comes from the program:
 * the names in scope at that line, the members of the record a `.` follows,
 * and the library beside them.
 */

const constructsOf = (code: string): Construct[] => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  return interpreter.getConstructs(code);
};

const program = [
  '#include <stdio.h>',
  'struct Sensor {',
  '  int reading;',
  '  double scale;',
  '};',
  'typedef struct Sensor Sensor;',
  'enum Mode { OFF, ON };',
  'int total = 0;',
  'int twice(int value) {',
  '  return value * 2;',
  '}',
  'int main() {',
  '  Sensor sensor;',
  '  int count = 0;',
  '  sensor.reading = 1;',
  '  return count;',
  '}',
].join('\n');

/** The completion list at a position, with `at` marking where the cursor is. */
const offeredAt = (
  completions: ProgramCompletions,
  doc: string,
  pos: number,
  explicit = false
): CompletionResult | null => {
  const state = EditorState.create({ doc, extensions: [cpp()] });
  return completions.source(
    new CompletionContext(state, pos, explicit)
  ) as CompletionResult | null;
};

const labels = (result: CompletionResult | null): string[] =>
  result === null ? [] : result.options.map((option) => String(option.label));

const detailOf = (result: CompletionResult | null, label: string): string => {
  const found = (result === null ? [] : result.options).find(
    (option) => option.label === label
  );
  return typeof found === 'undefined' || typeof found.detail === 'undefined'
    ? ''
    : found.detail;
};

const completionsOf = (code: string, library = []): ProgramCompletions => {
  const completions = new ProgramCompletions(library);
  completions.setConstructs(constructsOf(code));
  return completions;
};

describe('completion from the program', () => {
  it('offers the variables in scope with their types', () => {
    const completions = completionsOf(program);
    const doc = program.replace('  return count;', '  return c;');
    const at = doc.indexOf('return c;') + 'return c'.length;
    const result = offeredAt(completions, doc, at);
    expect(labels(result)).toContain('count');
    expect(detailOf(result, 'count')).toBe('int');
  });

  it('offers a function its own parameters and not another function’s', () => {
    const completions = completionsOf(program);
    const doc = program.replace('  return value * 2;', '  return v;');
    const at = doc.indexOf('return v;') + 'return v'.length;
    const offered = labels(offeredAt(completions, doc, at));
    expect(offered).toContain('value');
    expect(offered).not.toContain('count');
  });

  it('offers globals, functions, type names and enumerators everywhere', () => {
    const completions = completionsOf(program);
    const at = program.indexOf('  return count;') + 2;
    const offered = labels(offeredAt(completions, program, at, true));
    expect(offered).toEqual(
      expect.arrayContaining(['total', 'twice', 'Sensor', 'OFF', 'ON'])
    );
  });

  it('does not offer a name above its declaration', () => {
    const completions = completionsOf(program);
    const at = program.indexOf('int total = 0;');
    const offered = labels(offeredAt(completions, program, at, true));
    expect(offered).not.toContain('count');
  });

  it('offers the members of the record after a dot', () => {
    const completions = completionsOf(program);
    const doc = program.replace('  sensor.reading = 1;', '  sensor.r');
    const at = doc.indexOf('sensor.r') + 'sensor.r'.length;
    const result = offeredAt(completions, doc, at);
    expect(labels(result)).toEqual(['reading', 'scale']);
    expect(detailOf(result, 'scale')).toBe('double');
    // The member replaces what has been typed of it, not the whole access.
    expect(result!.from).toBe(at - 1);
  });

  it('follows a pointer and a typedef to the same members', () => {
    const code = program.replace(
      '  Sensor sensor;',
      '  struct Sensor* sensor;'
    );
    const completions = completionsOf(code);
    const doc = code.replace('  sensor.reading = 1;', '  sensor->');
    const at = doc.indexOf('sensor->') + 'sensor->'.length;
    expect(labels(offeredAt(completions, doc, at))).toEqual([
      'reading',
      'scale',
    ]);
  });

  it('says nothing about a name it cannot resolve', () => {
    const completions = completionsOf(program);
    const doc = program.replace('  sensor.reading = 1;', '  mystery.');
    const at = doc.indexOf('mystery.') + 'mystery.'.length;
    expect(offeredAt(completions, doc, at)).toBeNull();
  });

  it('offers the library with its signature and description', () => {
    const completions = new ProgramCompletions([
      {
        name: 'printf',
        signature: 'int printf(const char* format, ...)',
        description: 'writes formatted text to the output',
      },
    ]);
    completions.setConstructs(constructsOf(program));
    const doc = program.replace('  return count;', '  prin');
    const at = doc.indexOf('  prin') + '  prin'.length;
    const result = offeredAt(completions, doc, at);
    expect(labels(result)).toContain('printf');
    expect(detailOf(result, 'printf')).toBe(
      'int printf(const char* format, ...)'
    );
  });

  it('describes a function of the program as its signature', () => {
    const completions = completionsOf(program);
    const at = program.indexOf('  return count;') + 2;
    const result = offeredAt(completions, program, at, true);
    expect(detailOf(result, 'twice')).toBe('int twice(int value)');
  });

  it('stays quiet inside a comment or a string', () => {
    const completions = completionsOf(program);
    const doc = program.replace(
      '  return count;',
      '  // count is\n  puts("co");'
    );
    const inComment = doc.indexOf('count is') + 'count'.length;
    const inString = doc.indexOf('"co') + 3;
    expect(offeredAt(completions, doc, inComment, true)).toBeNull();
    expect(offeredAt(completions, doc, inString, true)).toBeNull();
  });

  it('offers no name before a program has been checked', () => {
    // The skeletons stand on their own - they are the language, not the
    // program - and there is nothing else to say until a check has run.
    const completions = new ProgramCompletions();
    const result = offeredAt(completions, program, 12, true);
    expect(labels(result)).toEqual([
      'for',
      'while',
      'switch',
      'struct',
      'printf',
      'scanf',
    ]);
  });
});

describe('snippets', () => {
  /** Applying a completion the way `acceptCompletion` does, and reading back. */
  const applied = (label: string, doc: string, pos: number): string => {
    const state = EditorState.create({
      doc,
      extensions: [cpp()],
      selection: { anchor: pos },
    });
    const view = new EditorView({ state });
    const option = cSnippets.find((snippet) => snippet.label === label)!;
    const apply = option.apply as (
      view: EditorView,
      completion: unknown,
      from: number,
      to: number
    ) => void;
    apply(view, option, pos, pos);
    const text = view.state.doc.toString();
    view.destroy();
    return text;
  };

  it('offers the six skeletons alongside the program’s own names', () => {
    const completions = completionsOf(program);
    const at = program.indexOf('  return count;') + 2;
    const offered = labels(offeredAt(completions, program, at, true));
    expect(offered).toEqual(
      expect.arrayContaining([
        'for',
        'while',
        'switch',
        'struct',
        'printf',
        'scanf',
      ])
    );
  });

  it('offers one entry where a snippet and a library name are the same word', () => {
    const completions = completionsOf(program, [
      {
        name: 'printf',
        signature: 'int printf(const char* format, ...)',
        description: 'writes formatted text to the output',
      },
    ] as never);
    const at = program.indexOf('  return count;') + 2;
    const result = offeredAt(completions, program, at, true);
    const offered = labels(result);
    expect(offered.filter((label) => label === 'printf')).toHaveLength(1);
    // And it is the template that carries the library's own signature.
    expect(detailOf(result, 'printf')).toBe(
      'int printf(const char* format, ...)'
    );
  });

  it('writes a loop whose counter is one field mentioned three times', () => {
    const written = applied('for', 'int main() {\n  \n}', 15);
    expect(written).toContain('for (int i = 0; i < count; i++) {');
    expect(written).toContain('}');
  });

  it('writes a scanf with the address operator already there', () => {
    expect(applied('scanf', '', 0)).toBe('scanf("%d", &value);');
  });

  it('indents the body with what the editor indents with', () => {
    const written = applied('while', 'int main() {\n  \n}', 15);
    // The line the template writes with one tab lands one indent unit past
    // the line the snippet was written on.
    expect(written.split('\n')[2]).toBe('    ');
  });
});
