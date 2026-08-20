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
import { formatAddress, VariableModel } from '../core';
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
 *
 * All of it arrives as plain data. Reading a variable off the running engine
 * is `extractVariables` in `src/core`, which runs in the Worker; what is left
 * here is how to say it.
 */

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
  private variables: VariableModel[] = [];

  setExpansions(expansions: Expansion[]): void {
    this.expansions = expansions;
  }

  setConstructs(constructs: Construct[]): void {
    this.constructs = constructs;
  }

  /** The values as they are right now, which is what a reader wants while
   * stepping. Cleared when the session stops, so a stale frame is never read. */
  setVariables(variables: VariableModel[]): void {
    this.variables = variables;
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

  /**
   * The variable of that name in the innermost frame that has one. The frames
   * arrive outermost first, so the last match is the innermost.
   */
  private variableNamed(name: string): VariableModel | null {
    if (name === '') {
      return null;
    }
    for (let i = this.variables.length - 1; 0 <= i; i -= 1) {
      if (this.variables[i].name === name) {
        return this.variables[i];
      }
    }
    return null;
  }

  private variableText(variable: VariableModel): string {
    const { target } = variable;
    const points =
      target === undefined ? '' : ` → ${target.name} = ${target.value}`;
    return (
      `${variable.name} : ${variable.type} = ${variable.value}${points}\n` +
      `${strings.atAddress} ${formatAddress(variable.address)}`
    );
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
