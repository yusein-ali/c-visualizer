import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { Variable } from 'unicoen.ts/dist/interpreter/Engine/Variable';
import strings, { stringFor } from '../strings';
import { Expansion } from '../interpreter/Expansion';
import {
  Construct,
  constructAt,
  EnumeratorDetail,
  FunctionDeclarationDetail,
  RecordFieldDetail,
  TypeDeclarationDetail,
  VariableDeclarationDetail,
} from '../interpreter/Construct';
import {
  displayAddressOf,
  displayPointerValueOf,
  displayTypeOf,
  functionPointerInfoOf,
} from '../interpreter/RuntimeTypeInfo';
import { libraryHelp } from './libraryHelp';
import { expansionAt, HoverContext } from '../ui/editor';

/**
 * What PLIVET says about a position in the source.
 *
 * This is the editor's hover provider, and nothing in it knows what editor it
 * is answering: it takes a row, a column and a word, and returns plain text.
 * The knowledge is all on this side - what the preprocessor did, what the
 * parser saw, what a variable holds right now - so replacing Ace with
 * CodeMirror did not touch a line of it.
 */

export const formatAddress = (address: number): string =>
  `0x${address.toString(16).toUpperCase()}`;

export const formatVariableDeclaration = (
  declaration: VariableDeclarationDetail
): string =>
  [
    `${strings.declarationType}: ${declaration.type}`,
    `${strings.storageClass}: ${
      declaration.storageClasses.join(', ') || strings.none
    }`,
    `${strings.qualifiers}: ${
      declaration.qualifiers.join(', ') || strings.none
    }`,
    `${strings.identifier}: ${declaration.identifier}`,
    `${strings.value}: ${
      declaration.initialValue === null
        ? strings.uninitialized
        : declaration.initialValue
    }`,
  ].join('\n');

/**
 * A C declaration always names a complete type - storage class and type, with
 * only the qualifiers optional - so the tooltip lists every part and says
 * `none` where the source left one out. The last line takes the standard's
 * own term for the name being introduced: a typedef declarator defines a
 * typedef name, a record or enumeration definition names a tag.
 */
export const formatTypeDeclaration = (
  declaration: TypeDeclarationDetail
): string =>
  [
    `${strings.declarationType}: ${declaration.type}`,
    `${strings.storageClass}: ${
      declaration.storageClasses.join(', ') || strings.none
    }`,
    `${strings.qualifiers}: ${
      declaration.qualifiers.join(', ') || strings.none
    }`,
    `${stringFor(declaration.nameKind)}: ${declaration.name || strings.none}`,
  ].join('\n');

/**
 * What an enumerator declares. The value is the point of it: nothing in
 * `enum Mode { OFF, ON = 4, FAULT }` tells a reader that FAULT is 5.
 */
export const formatEnumerator = (declaration: EnumeratorDetail): string =>
  [
    `${strings.declarationType}: ${declaration.type}`,
    `${strings.enumeration}: ${declaration.enumeration}`,
    `${strings.identifier}: ${declaration.identifier}`,
    `${strings.value}: ${declaration.value}`,
  ].join('\n');

/** A structure or union member, described where its name is declared. */
export const formatRecordField = (declaration: RecordFieldDetail): string =>
  [
    `${strings.declarationType}: ${declaration.type}`,
    `${strings.record}: ${declaration.record}`,
    `${strings.identifier}: ${declaration.identifier}`,
  ].join('\n');

/**
 * What a function declaration says, in the standard's own words: the type it
 * returns, the identifier it declares (6.9.1), and its parameters (3.16) - one
 * per line, each named before the type it has, the way the declaration reads.
 * `void` in a parameter list declares no parameters, so it is reported as
 * none rather than as a parameter called nothing.
 */
export const formatFunctionDeclaration = (
  declaration: FunctionDeclarationDetail
): string =>
  [
    `${strings.returnType}: ${declaration.returnType}`,
    `${strings.identifier}: ${declaration.identifier}`,
    declaration.parameters.length === 0
      ? `${strings.parameters}: ${strings.none}`
      : [`${strings.parameters}:`]
          .concat(
            declaration.parameters.map(
              (parameter) => `  ${parameter.identifier}: ${parameter.type}`
            )
          )
          .join('\n'),
  ].join('\n');

export class HoverTextSource {
  private expansions: Expansion[] = [];
  private constructs: Construct[] = [];
  private execState?: ExecState;

  setExpansions(expansions: Expansion[]): void {
    this.expansions = expansions;
  }

  setConstructs(constructs: Construct[]): void {
    this.constructs = constructs;
  }

  /** The values as they are right now, which is what a reader wants while
   * stepping. Cleared when the session stops, so a stale frame is never read. */
  setExecState(execState?: ExecState): void {
    this.execState = execState;
  }

  /**
   * What to say about the position under the cursor, most specific first: the
   * value a variable holds right now, then what the preprocessor did there,
   * then the library function being called, then the construct the parser saw.
   */
  text = (context: HoverContext): string | null => {
    const { row, column, word } = context;

    const variable = this.variableNamed(word);
    if (variable !== null) {
      return this.variableText(variable);
    }

    const expansion = expansionAt(this.expansions, row + 1, column);
    if (expansion !== null) {
      return this.expansionText(expansion);
    }

    const help = libraryHelp(word);
    if (help !== null) {
      return `${help.signature}\n${help.description}`;
    }

    const construct = constructAt(this.constructs, row + 1, column);
    if (construct !== null) {
      return this.constructText(construct);
    }
    return null;
  };

  private constructText(construct: Construct): string {
    const name = stringFor(
      `construct${construct.kind.charAt(0).toUpperCase()}${construct.kind.slice(
        1
      )}`
    );
    if (
      construct.kind === 'variableDec' &&
      typeof construct.variableDeclarations !== 'undefined'
    ) {
      const declarations = construct.variableDeclarations.map((declaration) =>
        formatVariableDeclaration(declaration)
      );
      return `${name}\n${declarations.join('\n\n')}`;
    }
    if (
      construct.kind === 'enumerator' &&
      typeof construct.enumerator !== 'undefined'
    ) {
      return `${name}\n${formatEnumerator(construct.enumerator)}`;
    }
    if (
      construct.kind === 'recordField' &&
      typeof construct.recordField !== 'undefined'
    ) {
      return `${name}\n${formatRecordField(construct.recordField)}`;
    }
    if (
      construct.kind === 'functionDec' &&
      typeof construct.declaredFunction !== 'undefined'
    ) {
      return `${name}\n${formatFunctionDeclaration(
        construct.declaredFunction
      )}`;
    }
    if (
      construct.kind === 'typeDec' &&
      typeof construct.declaredTypes !== 'undefined'
    ) {
      const declared = construct.declaredTypes.map((declaration) =>
        formatTypeDeclaration(declaration)
      );
      return `${name}\n${declared.join('\n\n')}`;
    }
    return construct.detail === '' ? name : `${name} — ${construct.detail}`;
  }

  /** The variable of that name in the innermost frame that has one. */
  private variableNamed(name: string): Variable | null {
    if (typeof this.execState === 'undefined' || name === '') {
      return null;
    }
    const stacks = this.execState.getStacks();
    for (let i = stacks.length - 1; 0 <= i; i -= 1) {
      for (const variable of stacks[i].getVariables()) {
        // A bare word never refers to a struct member: those are recorded
        // under the member name with the struct as their parent.
        if (
          variable.getName() === name &&
          typeof variable.parentName === 'undefined'
        ) {
          return variable;
        }
      }
    }
    return null;
  }

  /**
   * Everything shown here goes through the display layer rather than the
   * runtime one. An enum, a record and a function pointer all execute under a
   * synthetic type the source never contained, and addresses are laid out for
   * the reader before the canvas draws them - so reading `type` and `address`
   * off the variable would both leak `_fp0` into the tooltip and put a
   * different address in it than the box beside it shows.
   */
  private variableText(variable: Variable): string {
    const type = displayTypeOf(variable);
    const value = this.variableValue(variable, type);
    const target = this.pointerTarget(variable);
    return (
      `${variable.name} : ${type} = ${value}${target}\n` +
      `${strings.atAddress} ${formatAddress(displayAddressOf(variable))}`
    );
  }

  /**
   * What a variable holds. A pointer is an address whichever kind it is, so it
   * is always shown as one; a function pointer is named as well, because the
   * address on its own says nothing about which function was chosen.
   */
  private variableValue(variable: Variable, type: string): string {
    const held = variable.getValue();
    const functionInfo = functionPointerInfoOf(variable);
    if (functionInfo !== null && held != null && !Array.isArray(held)) {
      // The engine stores an `int` as a boxed number, so a null callback would
      // print as a bare `0` if this went through the generic path.
      const address = formatAddress(Number(held.valueOf()));
      return functionInfo.pointee === null
        ? address
        : `${functionInfo.pointee} (${address})`;
    }
    const pointerValue = displayPointerValueOf(variable);
    if (pointerValue !== null) {
      return formatAddress(pointerValue);
    }
    return this.formatValue(held, type);
  }

  /** For a pointer, the variable it points at - the arrow the canvas draws. */
  private pointerTarget(variable: Variable): string {
    const value = variable.getValue();
    if (
      typeof this.execState === 'undefined' ||
      variable.type.indexOf('*') === -1 ||
      typeof value !== 'number'
    ) {
      return '';
    }
    for (const stack of this.execState.getStacks()) {
      const found = this.variableAt(stack.getVariables(), value);
      if (found !== null) {
        return ` → ${found.getName()} = ${this.formatValue(
          found.getValue(),
          found.type
        )}`;
      }
    }
    return '';
  }

  /**
   * The variable living at an address. Array elements are Variables held in
   * their array's value rather than in the frame, so a pointer into an array -
   * the common case the canvas draws an arrow for - is only found by looking
   * inside.
   */
  private variableAt(variables: Variable[], address: number): Variable | null {
    for (const variable of variables) {
      if (variable.address === address) {
        return variable;
      }
      const value = variable.getValue();
      if (Array.isArray(value)) {
        const elements = value.filter(
          (element: any) =>
            element !== null &&
            typeof element === 'object' &&
            typeof element.getValue === 'function'
        );
        const found = this.variableAt(elements, address);
        if (found !== null) {
          return found;
        }
      }
    }
    return null;
  }

  private formatValue(value: any, type: string): string {
    if (value === null || typeof value === 'undefined') {
      return '?';
    }
    if (Array.isArray(value)) {
      // Array elements are Variables, not raw values.
      const shown = value
        .slice(0, 8)
        .map((element: any) =>
          element !== null &&
          typeof element === 'object' &&
          typeof element.getValue === 'function'
            ? this.variableValue(element, displayTypeOf(element))
            : this.formatValue(element, '')
        );
      return `[${shown.join(', ')}${value.length > 8 ? ', …' : ''}]`;
    }
    if (typeof value === 'number' && type.indexOf('*') !== -1) {
      return formatAddress(value);
    }
    if (typeof value === 'number' && type.indexOf('char') !== -1) {
      return `'${String.fromCharCode(value)}' (${value})`;
    }
    return String(value);
  }

  /** One line of what happened, and one of why. */
  private expansionText(expansion: Expansion): string {
    if (expansion.kind === 'excluded') {
      return `${expansion.name}: ${strings.excludedLine}`;
    }
    if (expansion.kind === 'directive') {
      const head = `${expansion.name} ${expansion.text}`.trim();
      if (typeof expansion.taken === 'undefined') {
        return head;
      }
      return `${head}\n${
        expansion.taken ? strings.branchCompiled : strings.branchSkipped
      }`;
    }
    const head = `${expansion.name} → ${expansion.text}`;
    return typeof expansion.definedAt === 'undefined'
      ? head
      : `${head}\n${strings.definedOnLine} ${expansion.definedAt}`;
  }
}
