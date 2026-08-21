import { Completion, snippetCompletion } from '@codemirror/autocomplete';

/**
 * The skeletons of C's punctuation, as tab-through templates.
 *
 * Beginners spend a disproportionate share of their time on semicolons,
 * parentheses and braces, and the time is spent on syntax rather than on what
 * the program is doing. A snippet writes the shape and leaves the reader the
 * parts that are theirs to choose - which is the difference between this and a
 * block editor: the punctuation is on the screen, in the right places, where
 * it can be read and edited, rather than hidden behind a shape that cannot be
 * typed.
 *
 * Two things the templates lean on. A field written twice under the same name
 * is one field - the counter of a `for` is declared, tested and incremented by
 * one tab stop, because those three mentions are one decision. And a tab at
 * the start of a template line is one level of indentation, expanded to
 * whatever the editor is configured to indent with, so the result matches the
 * file it lands in rather than the file this was written in.
 */

/** `${0}` is where the cursor ends up: inside the body, ready to type. */
const templates: { label: string; detail: string; template: string }[] = [
  {
    label: 'for',
    detail: 'a loop with a counter',
    template: [
      'for (int ${i} = 0; ${i} < ${count}; ${i}++) {',
      '\t${0}',
      '}',
    ].join('\n'),
  },
  {
    label: 'while',
    detail: 'a loop that tests before the body',
    template: ['while (${condition}) {', '\t${0}', '}'].join('\n'),
  },
  {
    label: 'switch',
    detail: 'a selection with a default and a break',
    template: [
      'switch (${expression}) {',
      '\tcase ${constant}:',
      '\t\t${0}',
      '\t\tbreak;',
      '\tdefault:',
      '\t\tbreak;',
      '}',
    ].join('\n'),
  },
  {
    label: 'struct',
    detail: 'a structure definition, semicolon included',
    template: ['struct ${Name} {', '\t${int} ${member};', '};${0}'].join('\n'),
  },
  {
    label: 'printf',
    detail: 'a formatted write',
    template: 'printf("${%d}\\n", ${value});${0}',
  },
  {
    // The `&` is the point of offering this one at all: a `scanf` without it
    // is the mistake the teaching linter spends a rule on.
    label: 'scanf',
    detail: 'a formatted read, into the address of a variable',
    template: 'scanf("${%d}", &${value});${0}',
  },
];

/** The type shown beside each label, which is what colours the icon. */
const iconFor = (label: string): string =>
  label === 'printf' || label === 'scanf' ? 'function' : 'keyword';

/**
 * The snippets, as completions. They sort above the names in scope: a reader
 * who has typed `for` wants the loop, not a variable that happens to begin
 * with those letters.
 */
export const cSnippets: readonly Completion[] = templates.map((snippet) =>
  snippetCompletion(snippet.template, {
    label: snippet.label,
    detail: snippet.detail,
    type: iconFor(snippet.label),
    boost: 4,
  })
);

/** The labels a snippet answers for, so a name is not offered twice. */
export const snippetLabels: ReadonlySet<string> = new Set(
  templates.map((snippet) => snippet.label)
);
