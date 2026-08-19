/**
 * A statement or expression the parser recognised, with where it sits in the
 * source, so the editor can say what a line is. This module holds the type and
 * the rule for choosing between overlapping constructs, and nothing else - the
 * walk that produces them lives in `outline.ts`, inside the interpreter chunk.
 *
 * `kind` is a stable key the editor translates; it is not the parser's class
 * name, so the wording can change without touching the AST walk.
 */
export interface Construct {
  kind: string;
  /** The declared type, the called name - whatever makes the kind concrete. */
  detail: string;
  /** Source-level details retained for variable-declaration tooltips. */
  variableDeclarations?: VariableDeclarationDetail[];
  /** The same, for the types a `typeDec` declares - one per name it gives. */
  declaredTypes?: TypeDeclarationDetail[];
  /** The same, for the constant an `enumerator` declares. */
  enumerator?: EnumeratorDetail;
  /** The same, for the function a `functionDec` declares. */
  declaredFunction?: FunctionDeclarationDetail;
  /** 1-based line, 0-based column, as the parser reports them. */
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

/**
 * What a type declaration says, field by field. A C declaration always names a
 * complete type - only the qualifiers may be absent - so a tooltip that shows
 * the type alone hides half of what the compiler read.
 */
export interface TypeDeclarationDetail {
  /** `typedef`, which C counts among the storage-class specifiers. */
  storageClasses: string[];
  qualifiers: string[];
  /** The type being named: `enum Mode`, `struct Sensor`, `int *`. */
  type: string;
  /**
   * What C calls the name this declaration introduces. A typedef declarator
   * defines a typedef name (6.7.8); a record or enumeration definition names
   * a tag (6.7.2.3), which lives in its own name space. Neither is a "type
   * name" - that term is taken, and means a type written without an
   * identifier (6.7.7), which is what `type` above holds.
   */
  nameKind: 'typedefName' | 'tag';
  name: string;
}

/**
 * What an enumerator declares. C calls `RED` in `enum Color { RED }` an
 * enumeration constant (6.4.4.3), and gives it type `int` - not the enumerated
 * type - which is worth saying where a reader meets it.
 */
export interface EnumeratorDetail {
  type: string;
  /** The enumeration it belongs to, named as a reader would recognise it. */
  enumeration: string;
  identifier: string;
  value: number;
}

/**
 * What a function declaration says: the type it returns, the identifier it
 * declares - 6.9.1 calls the name a function definition introduces exactly
 * that - and the parameters it takes.
 */
export interface FunctionDeclarationDetail {
  /** The return type as the source spells it, qualifiers included. */
  returnType: string;
  identifier: string;
  parameters: ParameterDetail[];
}

/**
 * One entry of the parameter type list. C calls these parameters (3.16); it
 * records "formal argument" as a deprecated name for the same thing, and
 * reserves "argument" for the expression a call passes. Each is reported the
 * way a declaration reads - the identifier, then the type that identifier has,
 * qualifiers in the place they were written.
 */
export interface ParameterDetail {
  identifier: string;
  type: string;
}

export interface VariableDeclarationDetail {
  type: string;
  storageClasses: string[];
  qualifiers: string[];
  identifier: string;
  /** The initializer as written, or null when the object is uninitialized. */
  initialValue: string | null;
}

/**
 * The construct to describe at a position, or null.
 *
 * A construct answers only for the line it opens on or the line it closes on.
 * Its range covers everything it contains, so without that rule a hover in the
 * middle of a loop body reports the loop - the reader is asking about the line
 * under the cursor, not the block around it. On a line that opens and closes
 * several, the innermost wins.
 */
export function constructAt(
  constructs: Construct[],
  line: number,
  column: number
): Construct | null {
  const size = (c: Construct) =>
    (c.endLine - c.line) * 1000 + (c.endColumn - c.column);
  let found: Construct | null = null;
  for (const construct of constructs) {
    const opensHere = construct.line === line && construct.column <= column;
    const closesHere =
      construct.endLine === line && column <= construct.endColumn;
    const matches =
      construct.line === construct.endLine
        ? opensHere && closesHere
        : opensHere || closesHere;
    if (matches && (found === null || size(construct) < size(found))) {
      found = construct;
    }
  }
  return found;
}
