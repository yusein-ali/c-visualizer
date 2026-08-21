import { Interpreter } from 'unicoen.ts/dist/interpreter/Interpreter';
import { CPP14Mapper } from 'unicoen.ts/dist/interpreter/CPP14/CPP14Mapper';
import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { SyntaxErrorData } from 'unicoen.ts/dist/interpreter/mapper/SyntaxErrorData';
import { PlivetCPP14Engine } from './CPP14Engine';
import { Construct } from './Construct';
import { DeclarationSpecifiers } from './DeclarationSpecifiers';
import { DesignatedInitializers } from './DesignatedInitializers';
import { EnumTable, Enumerator, RuntimeEnumTypes } from './EnumTable';
import {
  FunctionPointerTable,
  RuntimeFunctionPointerTypes,
  signatureOf,
} from './FunctionPointerTable';
import { Expansion } from './Expansion';
import { enumeratorDeclarations, outline, typeDeclarations } from './outline';
import { preprocessSource } from './preprocess';
import { RuntimeRecordTypes } from './RecordTable';
import {
  annotateRuntimeFunctions,
  annotateRuntimeVariables,
} from './RuntimeTypeInfo';
import { RuntimeDiagnostic } from './RuntimeDiagnostic';
import { StructTable } from './StructTable';
import { LintDiagnostic, teachingDiagnostics } from './TeachingLint';
import { linkerDiagnostics } from './LinkerCheck';
import { UnionTable } from './UnionTable';

/**
 * PLIVET's C interpreter: the stock mapper and engine behaviour, with the
 * preprocessor `unicoen.ts` does not have (`preprocess.ts`), a `printf` that
 * can format a string literal, and a `scanf` that fails the way C's does
 * (`CPP14Engine.ts`, `scanf.ts`).
 *
 * It extends `Interpreter` rather than `CPP14Interpreter` because the engine is
 * `protected readonly` and built in that subclass's constructor - passing our
 * own engine in is cleaner than reassigning the field afterwards. The stock
 * `preProcess` is not inherited and never runs.
 *
 * This module is what `server.ts` imports dynamically, so the interpreter and
 * its parser stay in their own chunk.
 */
export class PlivetCPP14Interpreter extends Interpreter {
  private readonly plivetEngine: PlivetCPP14Engine;
  private enumTypes: RuntimeEnumTypes;
  private recordTypes: RuntimeRecordTypes;
  private functionPointerTypes: RuntimeFunctionPointerTypes;

  constructor() {
    const engine = new PlivetCPP14Engine();
    super(engine, new CPP14Mapper());
    this.plivetEngine = engine;
    this.enumTypes = {};
    this.recordTypes = {};
    this.functionPointerTypes = {};
  }

  preProcess(code: string): string {
    return this.prepare(code).code;
  }

  startStepExecution(code: string): ExecState {
    return this.describeState(super.startStepExecution(code));
  }

  stepExecute(): ExecState {
    return this.describeState(super.stepExecute());
  }

  private describeState(state: ExecState): ExecState {
    const annotated = annotateRuntimeVariables(
      this.plivetEngine.expandRecordArrays(state),
      this.enumTypes,
      this.recordTypes,
      (address) => this.plivetEngine.declarationInfoAt(address),
      this.functionPointerTypes,
      (address) => this.plivetEngine.functionNameAt(address),
      this.plivetEngine.stringLiterals()
    );
    return annotateRuntimeFunctions(
      annotated,
      this.plivetEngine.functionLocations()
    );
  }

  /**
   * What the preprocessor replaced, and where in the source the user typed, so
   * the editor can mark those spans and explain them on hover. Computed on the
   * syntax check, which already runs on every edit.
   */
  getExpansions(code: string): Expansion[] {
    return this.prepare(code).expansions;
  }

  /**
   * The statements the parser recognised, for the editor to explain on hover.
   * Parsed from the preprocessed source, so the positions match what the parser
   * saw - which is the source the user typed, since the pass keeps line
   * numbers. Returns nothing rather than throwing while the code is half
   * written: this runs on every edit.
   */
  getConstructs(code: string): Construct[] {
    const prepared = this.prepare(code);
    const sourceTypes = typeDeclarations(prepared.source).concat(
      enumeratorDeclarations(prepared.enumConstants)
    );
    try {
      const parsed = outline(
        this.mapper.parseToUniTree(prepared.code),
        prepared.source,
        prepared.declarationSpecifiers
      );
      // Where both readers describe the same type declaration the source one
      // wins: the mapper keeps only the type a typedef renames, so its mark
      // says `Mode` where the source says `ReadOnlyMode = const enum Mode`.
      const described = sourceTypes
        .filter((construct) => construct.kind === 'typeDec')
        .map((construct) => construct.line);
      return sourceTypes.concat(
        this.displaySyntheticTypes(parsed)
          .filter(
            (construct) =>
              construct.kind !== 'typeDec' ||
              described.indexOf(construct.line) === -1
          )
          .map((construct) =>
            sourceColumns(construct, prepared.functionPointers)
          )
      );
    } catch {
      return sourceTypes;
    }
  }

  /**
   * Enums and function pointers execute under collision-free names such as
   * `_e0` and `_fp0`, but those names are an implementation detail. Construct
   * descriptions are shown directly in editor tooltips, so translate every
   * synthetic token back to the spelling students wrote before returning them
   * to the UI.
   */
  private displaySyntheticTypes(constructs: Construct[]): Construct[] {
    const enumTypes = Object.keys(this.enumTypes).filter((type) =>
      /^_e\d+$/.test(type)
    );
    const pointerTypes = Object.keys(this.functionPointerTypes);
    const display = (text: string): string => {
      let shown = text;
      for (const runtimeType of enumTypes) {
        shown = shown.replace(
          new RegExp(`\\b${runtimeType}\\b`, 'g'),
          this.enumTypes[runtimeType].displayType
        );
      }
      for (const runtimeType of pointerTypes) {
        const info = this.functionPointerTypes[runtimeType];
        // The array bounds belong inside the parentheses: an array of function
        // pointers is `int (*ops[2])(int, int)`, never `int (*)(int, int)[2]`.
        shown = shown.replace(
          new RegExp(`\\b${runtimeType}\\b((?:\\[[^\\]]*\\])*)`, 'g'),
          (_whole: string, arraySuffix: string) =>
            signatureOf(
              info.returnType,
              info.parameters,
              '*'.repeat(info.depth),
              arraySuffix
            )
        );
      }
      return shown;
    };
    return constructs.map((construct) => displayedTypes(construct, display));
  }

  /**
   * What the run has been told off for: the refusals and the warnings the
   * engine raised while stepping. Read after each step rather than pushed,
   * because the engine has nobody to push to - and cleared with the session,
   * since a new interpreter is built for every `Start`.
   */
  getRuntimeDiagnostics(): RuntimeDiagnostic[] {
    return this.plivetEngine.diagnostics();
  }

  /**
   * What a compiler would warn about, for the editor to raise as lint.
   *
   * Read from the same parse as the constructs, and from the same prepared
   * source: `const char *s` is not a declaration the mapper can read until the
   * qualifier pass has been over it. A program that does not parse produces
   * nothing rather than throwing - the syntax errors are the diagnostics worth
   * showing while the code is half written.
   */
  getLints(code: string): LintDiagnostic[] {
    const prepared = this.prepare(code);
    try {
      const tree = this.mapper.parseToUniTree(prepared.code);
      // Two passes over one tree: what a compiler would say about the
      // statements, and what a linker would say about the file as a whole.
      // They are separate because they are different questions - one walks
      // with scope, the other asks about the translation unit - and one list
      // because the reader has one editor.
      return teachingDiagnostics(tree, code).concat(linkerDiagnostics(tree));
    } catch {
      return [];
    }
  }

  /**
   * The syntax check goes straight to the mapper, whose own `preProcess` is the
   * identity, so without this it lints the raw directives: a block excluded by
   * #if 0 is reported as a syntax error even though it never reaches the
   * parser. The pass preserves line numbers, so the annotations still land on
   * the right lines.
   */
  checkSyntaxError(code: string): SyntaxErrorData[] {
    return super.checkSyntaxError(this.prepare(code).code);
  }

  /** Runs every source pass once and gives the engine fresh record metadata. */
  private prepare(code: string): {
    code: string;
    expansions: Expansion[];
    source: string;
    declarationSpecifiers: DeclarationSpecifiers;
    functionPointers: FunctionPointerTable;
    enumConstants: Enumerator[];
  } {
    const preprocessed = preprocessSource(code);
    const declarationSpecifiers = new DeclarationSpecifiers();
    const declarations = declarationSpecifiers.rewrite(preprocessed.code);
    // Read where the qualifiers have been blanked - `int (* const op)(void)`
    // is otherwise a declarator whose name reads as `const` - but before the
    // enum pass, so a function returning `enum Color` still says so.
    const functionPointers = new FunctionPointerTable().read(declarations);
    this.functionPointerTypes = functionPointers.runtimeTypes();
    const enumTable = new EnumTable();
    const enums = enumTable.rewrite(declarations);
    this.enumTypes = enumTable.runtimeTypes();
    const designatedInitializers = new DesignatedInitializers();
    const initializers = designatedInitializers.rewrite(enums.code);
    const structs = new StructTable();
    const unions = new UnionTable();
    structs.link(unions);
    unions.link(structs);
    // Read the source before qualifier words are blanked so record members
    // retain their own const/volatile/restrict placement, but after function
    // pointers become named types, which is the only form a member can have.
    const recordSource = functionPointers.apply(preprocessed.code);
    structs.read(recordSource);
    unions.read(recordSource);
    this.recordTypes = Object.assign(
      {},
      structs.runtimeTypes(),
      unions.runtimeTypes()
    );
    this.plivetEngine.setRecordTables(structs, unions);
    this.plivetEngine.setDeclarationSpecifiers(declarationSpecifiers);
    this.plivetEngine.setDesignatedInitializers(designatedInitializers);
    const recordsForParser = unions.rewriteForParser(
      structs.rewriteForParser(functionPointers.apply(initializers))
    );
    return {
      code: recordsForParser,
      expansions: preprocessed.expansions.concat(enums.expansions),
      source: preprocessed.code,
      declarationSpecifiers,
      functionPointers,
      enumConstants: enumTable.declaredConstants(),
    };
  }
}

/**
 * A construct with every type it names translated. The one-line detail is not
 * the only text a tooltip shows any more: the editor reads the type out of the
 * declaration details, so a synthetic name left there reaches the reader even
 * when the summary line is clean.
 */
function displayedTypes(
  construct: Construct,
  display: (text: string) => string
): Construct {
  const shown: Partial<Construct> = { detail: display(construct.detail) };
  if (typeof construct.variableDeclarations !== 'undefined') {
    shown.variableDeclarations = construct.variableDeclarations.map(
      (declaration) =>
        Object.assign({}, declaration, { type: display(declaration.type) })
    );
  }
  if (typeof construct.declaredTypes !== 'undefined') {
    shown.declaredTypes = construct.declaredTypes.map((declaration) =>
      Object.assign({}, declaration, { type: display(declaration.type) })
    );
  }
  if (typeof construct.recordField !== 'undefined') {
    shown.recordField = Object.assign({}, construct.recordField, {
      type: display(construct.recordField.type),
      record: display(construct.recordField.record),
    });
  }
  if (typeof construct.declaredFunction !== 'undefined') {
    const declared = construct.declaredFunction;
    shown.declaredFunction = Object.assign({}, declared, {
      returnType: display(declared.returnType),
      parameters: declared.parameters.map((parameter) =>
        Object.assign({}, parameter, { type: display(parameter.type) })
      ),
    });
  }
  return Object.assign({}, construct, shown);
}

/**
 * A construct's columns come from the parser, which read a source where an
 * indirect call may have gained a `(*` and a `)`. Every other pass pads in
 * place, so this is the only correction a position needs before it is matched
 * against where the cursor actually is.
 */
function sourceColumns(
  construct: Construct,
  functionPointers: FunctionPointerTable
): Construct {
  const column = functionPointers.columnShift(construct.line, construct.column);
  const endColumn = functionPointers.columnShift(
    construct.endLine,
    construct.endColumn
  );
  return column === construct.column && endColumn === construct.endColumn
    ? construct
    : Object.assign({}, construct, { column, endColumn });
}
