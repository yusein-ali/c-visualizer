import { EditorState } from '@codemirror/state';
import {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { cSnippets, snippetLabels } from './snippets';
import { Construct, ParameterDetail } from '../../interpreter/Construct';

/**
 * Completion from what the program actually declares.
 *
 * The editor used to complete any word already in the buffer, misspellings
 * included, which is the one kind of completion that teaches nothing: a
 * beginner who typed `lenght` once is offered it forever. What is offered here
 * is what the parser saw - the variables in scope with their types, the
 * members of the structure a `.` or `->` was written after, the functions the
 * program defines, the type names it introduces, its enumeration constants -
 * and the library functions PLIVET provides, with their signatures.
 *
 * The constructs arrive as plain data from the same syntax check that feeds
 * the tooltip, so nothing here parses anything. The syntax tree is asked one
 * question only, and it is a question about text rather than about C: whether
 * the cursor is inside a comment or a string, where a suggestion would be an
 * interruption rather than an offer.
 */

/** A library function as this module wants one: a name and what it says. */
export interface LibraryFunction {
  name: string;
  signature: string;
  description: string;
}

/**
 * Where a name can be completed from. The order is the order the boost below
 * puts them in: what the reader declared nearby beats what the language
 * provides everywhere.
 */
type SymbolKind = 'variable' | 'function' | 'type' | 'constant' | 'property';

interface ProgramSymbol {
  label: string;
  kind: SymbolKind;
  /** The type, or the signature - what stands beside the name in the list. */
  detail: string;
  /** The sentence the side panel shows, where there is one. */
  info?: string;
  /** Where it was declared: a name is not offered above its declaration. */
  line: number;
}

/** How much of the text before the cursor a member access can occupy. */
const MEMBER_LOOKBEHIND = 120;

/** `sensor.` or `p->`, with whatever has been typed of the member so far. */
const MEMBER_ACCESS = /([A-Za-z_]\w*)\s*(\.|->)\s*([A-Za-z_]\w*)?$/;

/** The syntax node names a completion stays out of, whatever the language. */
const QUIET_INSIDE = ['Comment', 'BlockComment', 'LineComment', 'String'];

/** A tag as a record field records it, from the type a declaration spells. */
const recordTagOf = (type: string): string => {
  const found = /\b(struct|union)\s+([A-Za-z_]\w*)/.exec(type);
  return found === null ? '' : `${found[1]} ${found[2]}`;
};

/** The name a typedef or a bare tag was written as, pointers and all removed. */
const plainTypeName = (type: string): string =>
  type
    .replace(/\b(const|volatile|restrict|static|extern|register|auto)\b/g, '')
    .replace(/[*[\]0-9]/g, '')
    .trim();

const boostOf = (kind: SymbolKind): number => {
  switch (kind) {
    case 'property':
      return 3;
    case 'variable':
      return 2;
    case 'constant':
      return 1;
    case 'type':
      return 0;
    default:
      return -1;
  }
};

/** A type as a sentence reads it, with the qualifiers left in place. */
const strip = (type: string): string => type.trim();

const signatureOf = (
  returnType: string,
  identifier: string,
  parameters: ParameterDetail[]
): string =>
  `${returnType} ${identifier}(${
    parameters.length === 0
      ? 'void'
      : parameters
          .map((parameter) => `${parameter.type} ${parameter.identifier}`)
          .join(', ')
  })`;

/**
 * The side panel for one suggestion: what it is on one line, and the sentence
 * under it. `Completion.info` may return DOM, and a signature set in the
 * editor's own monospace reads as the declaration it is.
 */
const infoDom = (symbol: ProgramSymbol) => () => {
  const dom = document.createElement('div');
  dom.className = 'plivet-completion-info';
  const signature = document.createElement('code');
  signature.textContent = symbol.detail;
  dom.appendChild(signature);
  if (typeof symbol.info !== 'undefined' && symbol.info !== '') {
    const description = document.createElement('div');
    description.textContent = symbol.info;
    dom.appendChild(description);
  }
  return { dom };
};

const asCompletion = (symbol: ProgramSymbol): Completion => ({
  label: symbol.label,
  type: symbol.kind,
  detail: symbol.detail,
  boost: boostOf(symbol.kind),
  info: infoDom(symbol),
});

/** Whether the position is somewhere a suggestion would interrupt. */
const inProse = (state: EditorState, pos: number): boolean => {
  const node = syntaxTree(state).resolveInner(pos, -1);
  for (let at: typeof node | null = node; at !== null; at = at.parent) {
    if (QUIET_INSIDE.indexOf(at.name) !== -1) {
      return true;
    }
  }
  return false;
};

export class ProgramCompletions {
  private constructs: Construct[] = [];
  private readonly library: ProgramSymbol[];

  constructor(library: LibraryFunction[] = []) {
    this.library = library.map((entry) => ({
      label: entry.name,
      kind: 'function' as const,
      detail: entry.signature,
      info: entry.description,
      line: 0,
    }));
  }

  /** The constructs of the last syntax check; the program as it stands. */
  setConstructs(constructs: Construct[]): void {
    this.constructs = constructs;
  }

  readonly source: CompletionSource = (
    context: CompletionContext
  ): CompletionResult | null => {
    if (inProse(context.state, context.pos)) {
      return null;
    }
    const members = this.memberResult(context);
    if (members !== null) {
      return members;
    }
    const word = context.matchBefore(/[A-Za-z_]\w*/);
    if (word === null && !context.explicit) {
      return null;
    }
    const line = context.state.doc.lineAt(context.pos).number;
    const symbols = this.inScope(line);
    return {
      from: word === null ? context.pos : word.from,
      options: this.withSnippets(symbols),
      validFor: /^\w*$/,
    };
  };

  /**
   * The names in scope, with the skeletons of C's punctuation in front of
   * them.
   *
   * Where a snippet and a name are the same word - `printf` is both a
   * template and a library function - one entry is offered rather than two,
   * and it is the template carrying the library's own signature and sentence.
   * The description stays in `libraryHelp`, which is the only place that
   * knows what `printf` is; what the snippet adds is the shape.
   */
  private withSnippets(symbols: ProgramSymbol[]): Completion[] {
    const described = new Map(symbols.map((symbol) => [symbol.label, symbol]));
    const snippets = cSnippets.map((snippet) => {
      const symbol = described.get(String(snippet.label));
      return typeof symbol === 'undefined'
        ? snippet
        : { ...snippet, detail: symbol.detail, info: infoDom(symbol) };
    });
    return snippets.concat(
      symbols
        .filter((symbol) => !snippetLabels.has(symbol.label))
        .map(asCompletion)
    );
  }

  /**
   * The members of the record a `.` or `->` was written after.
   *
   * Which record that is comes from the declaration of the name in front of
   * the operator, and a `typedef` in between is followed: a reader who wrote
   * `Sensor s;` never spelled the tag the members are recorded under. Nothing
   * is offered when the name cannot be resolved - a list of every member of
   * every structure would be a guess wearing the clothes of an answer.
   */
  private memberResult(context: CompletionContext): CompletionResult | null {
    const from = Math.max(0, context.pos - MEMBER_LOOKBEHIND);
    const before = context.state.sliceDoc(from, context.pos);
    const access = MEMBER_ACCESS.exec(before);
    if (access === null) {
      return null;
    }
    const typed = typeof access[3] === 'undefined' ? '' : access[3];
    const line = context.state.doc.lineAt(context.pos).number;
    const record = this.recordOf(access[1], line);
    if (record === '') {
      return null;
    }
    const options = this.membersOf(record).map(asCompletion);
    if (options.length === 0) {
      return null;
    }
    return {
      from: context.pos - typed.length,
      options,
      validFor: /^\w*$/,
    };
  }

  /** The record an object belongs to, through however many typedefs. */
  private recordOf(name: string, line: number): string {
    const declared = this.typeOf(name, line);
    if (declared === '') {
      return '';
    }
    const tag = recordTagOf(declared);
    if (tag !== '') {
      return tag;
    }
    return this.recordBehindTypedef(plainTypeName(declared));
  }

  /**
   * The record a typedef name stands for. A chain is followed to its end -
   * `typedef struct Point Point; typedef Point Vertex;` - and a name that
   * leads back to itself stops rather than looping.
   */
  private recordBehindTypedef(name: string): string {
    const seen = new Set<string>();
    let current = name;
    while (current !== '' && !seen.has(current)) {
      seen.add(current);
      const aliased = this.aliasFor(current);
      if (aliased === '') {
        return '';
      }
      const tag = recordTagOf(aliased);
      if (tag !== '') {
        return tag;
      }
      current = plainTypeName(aliased);
    }
    return '';
  }

  private aliasFor(name: string): string {
    for (const construct of this.constructs) {
      for (const declared of construct.declaredTypes ?? []) {
        if (declared.nameKind === 'typedefName' && declared.name === name) {
          return declared.type;
        }
      }
    }
    return '';
  }

  /** The declared type of a name in scope at that line, or the empty string. */
  private typeOf(name: string, line: number): string {
    let found = '';
    let foundLine = -1;
    for (const construct of this.constructs) {
      if (construct.kind !== 'variableDec') {
        continue;
      }
      for (const declaration of construct.variableDeclarations ?? []) {
        if (
          declaration.identifier === name &&
          construct.line <= line &&
          foundLine <= construct.line
        ) {
          found = declaration.type;
          foundLine = construct.line;
        }
      }
    }
    if (found !== '') {
      return found;
    }
    for (const parameter of this.parametersAt(line)) {
      if (parameter.identifier === name) {
        return parameter.type;
      }
    }
    return '';
  }

  private membersOf(record: string): ProgramSymbol[] {
    const members: ProgramSymbol[] = [];
    const seen = new Set<string>();
    for (const construct of this.constructs) {
      const field = construct.recordField;
      if (typeof field === 'undefined' || field.record !== record) {
        continue;
      }
      if (seen.has(field.identifier)) {
        continue;
      }
      seen.add(field.identifier);
      members.push({
        label: field.identifier,
        kind: 'property',
        detail: field.type,
        info: `${strip(field.type)} member of ${field.record}`,
        line: construct.line,
      });
    }
    return members;
  }

  /**
   * Every name that can be written at this line.
   *
   * Scope is taken the way C reads: a name is in scope after its declaration,
   * and a name declared inside a function belongs to that function alone. The
   * block a declaration sits in is deliberately not narrowed further - the
   * constructs record where a declaration is, not where its block ends, and
   * offering a name one block too widely is a smaller wrong answer than
   * hiding one the reader can see on the screen.
   */
  private inScope(line: number): ProgramSymbol[] {
    const enclosing = this.functionAt(line);
    const symbols: ProgramSymbol[] = [];
    const seen = new Set<string>();
    const add = (symbol: ProgramSymbol) => {
      const key = `${symbol.kind}:${symbol.label}`;
      if (symbol.label === '' || seen.has(key)) {
        return;
      }
      seen.add(key);
      symbols.push(symbol);
    };

    if (enclosing !== null) {
      for (const parameter of enclosing.declaredFunction?.parameters ?? []) {
        add({
          label: parameter.identifier,
          kind: 'variable',
          detail: parameter.type,
          info: `parameter of ${enclosing.declaredFunction?.identifier ?? ''}`,
          line: enclosing.line,
        });
      }
    }

    for (const construct of this.constructs) {
      if (construct.kind === 'variableDec' && construct.line <= line) {
        const owner = this.functionAt(construct.line);
        if (owner !== null && owner !== enclosing) {
          continue;
        }
        for (const declaration of construct.variableDeclarations ?? []) {
          add({
            label: declaration.identifier,
            kind: 'variable',
            detail: declaration.type,
            info:
              owner === null
                ? `${strip(declaration.type)} at file scope`
                : `${strip(declaration.type)} in ${
                    owner.declaredFunction?.identifier ?? 'this function'
                  }`,
            line: construct.line,
          });
        }
      }
      const declaredFunction = construct.declaredFunction;
      if (typeof declaredFunction !== 'undefined') {
        add({
          label: declaredFunction.identifier,
          kind: 'function',
          detail: signatureOf(
            declaredFunction.returnType,
            declaredFunction.identifier,
            declaredFunction.parameters
          ),
          info: declaredFunction.isDefinition
            ? 'defined in this program'
            : 'declared in this program',
          line: construct.line,
        });
      }
      for (const declared of construct.declaredTypes ?? []) {
        add({
          label: declared.name,
          kind: 'type',
          detail: declared.type,
          info:
            declared.nameKind === 'tag'
              ? 'a tag this program declares'
              : 'a typedef name this program declares',
          line: construct.line,
        });
      }
      const enumerator = construct.enumerator;
      if (typeof enumerator !== 'undefined') {
        add({
          label: enumerator.identifier,
          kind: 'constant',
          detail: `${enumerator.type} = ${enumerator.value}`,
          info: `enumeration constant of ${enumerator.enumeration}`,
          line: construct.line,
        });
      }
    }

    for (const entry of this.library) {
      add(entry);
    }
    return symbols;
  }

  /** The parameters of the function the line sits in. */
  private parametersAt(line: number): ParameterDetail[] {
    const enclosing = this.functionAt(line);
    return enclosing === null
      ? []
      : (enclosing.declaredFunction?.parameters ?? []);
  }

  /** The innermost function definition covering a line, if any. */
  private functionAt(line: number): Construct | null {
    let found: Construct | null = null;
    for (const construct of this.constructs) {
      if (
        construct.kind !== 'functionDec' ||
        typeof construct.declaredFunction === 'undefined' ||
        !construct.declaredFunction.isDefinition ||
        construct.line > line ||
        construct.endLine < line
      ) {
        continue;
      }
      if (found === null || construct.line > found.line) {
        found = construct;
      }
    }
    return found;
  }
}
