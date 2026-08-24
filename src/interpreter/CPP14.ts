import { Interpreter } from 'unicoen.ts/dist/interpreter/Interpreter';
import { CPP14Mapper } from 'unicoen.ts/dist/interpreter/CPP14/CPP14Mapper';
import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { SyntaxErrorData } from 'unicoen.ts/dist/interpreter/mapper/SyntaxErrorData';
import { SyntaxErrorListener } from 'unicoen.ts/dist/interpreter/mapper/SyntaxErrorListener';
import { UniProgram } from 'unicoen.ts/dist/node/UniProgram';
import { CommonTokenStream } from 'antlr4ts';
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
import {
  LintDiagnostic,
  programDiagnostics,
  teachingDiagnostics,
} from './TeachingLint';
import { linkerDiagnostics } from './LinkerCheck';
import { JscppCheck, JscppWarning, jscppCheck } from './jscpp/JscppSyntax';
import { UnionTable } from './UnionTable';

interface PreparedSource {
  code: string;
  /** The same source, rewritten only as far as the syntax check needs. */
  checkCode: string;
  expansions: Expansion[];
  source: string;
  declarationSpecifiers: DeclarationSpecifiers;
  functionPointers: FunctionPointerTable;
  enumConstants: Enumerator[];
}

/** All source facts produced by one parser activation. */
export interface SourceAnalysis {
  errors: SyntaxErrorData[];
  expansions: Expansion[];
  constructs: Construct[];
  teachingLints: LintDiagnostic[];
  programErrors: SyntaxErrorData[];
  programExpansions: Expansion[];
  programConstructs: Construct[];
  linkerLints: LintDiagnostic[];
}

interface ParsedSource {
  errors: SyntaxErrorData[];
  tree: UniProgram | null;
}

/**
 * unicoen's public methods parse once for errors and again for the UniCOEN
 * tree. Diagnostics need both, so expose the two products of one ANTLR parse.
 */
class PlivetCPP14Mapper extends CPP14Mapper {
  analyze(code: string): ParsedSource {
    const antlrTree = this.parseToANTLRTree(code);
    const errors = this.parser
      .getErrorListeners()
      .filter((listener) => listener instanceof SyntaxErrorListener)
      .flatMap((listener) =>
        (listener as SyntaxErrorListener<number>).getErrorMessages()
      );
    try {
      return {
        errors,
        tree: this.makeUniTree(
          antlrTree,
          this.parser.inputStream as CommonTokenStream
        ),
      };
    } catch {
      return { errors, tree: null };
    }
  }
}

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
  private readonly plivetMapper: PlivetCPP14Mapper;
  private enumTypes: RuntimeEnumTypes;
  private recordTypes: RuntimeRecordTypes;
  private functionPointerTypes: RuntimeFunctionPointerTypes;
  /** A diagnostics parse that can be consumed by the next matching Start. */
  private analyzedExecution: { code: string; tree: UniProgram } | null = null;

  constructor() {
    const engine = new PlivetCPP14Engine();
    const mapper = new PlivetCPP14Mapper();
    super(engine, mapper);
    this.plivetEngine = engine;
    this.plivetMapper = mapper;
    this.enumTypes = {};
    this.recordTypes = {};
    this.functionPointerTypes = {};
  }

  preProcess(code: string): string {
    return this.prepare(code).code;
  }

  startStepExecution(code: string): ExecState {
    // Direct callers have not necessarily gone through Server.preflight.
    // Analyze once here too so empty declarations are normalized before the
    // execution tree reaches unicoen's exception-swallowing function runner.
    if (this.analyzedExecution?.code !== code) {
      this.analyze(code);
    }
    if (this.analyzedExecution?.code === code) {
      const { tree } = this.analyzedExecution;
      this.analyzedExecution = null;
      return this.describeState(this.plivetEngine.startStepExecution(tree));
    }
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
    try {
      return this.constructsFrom(
        this.mapper.parseToUniTree(prepared.code),
        prepared
      );
    } catch {
      return this.sourceTypes(prepared);
    }
  }

  /**
   * Parse the active file and the executable program without repeating either
   * tree construction for errors, teaching rules, linker rules and tooltips.
   */
  analyze(code: string, linkedCode: string = code): SourceAnalysis {
    const local = this.analyzeSource(code);
    if (linkedCode === code) {
      if (local.parsed.tree !== null) {
        this.analyzedExecution = { code, tree: local.parsed.tree };
      }
      return {
        errors: local.errors,
        expansions: local.prepared.expansions,
        constructs: local.constructs,
        teachingLints: local.teachingLints,
        programErrors: local.errors,
        programExpansions: local.prepared.expansions,
        programConstructs: local.constructs,
        linkerLints:
          local.errors.length === 0 && local.parsed.tree !== null
            ? this.programLints(local.parsed.tree, code)
            : [],
      };
    }

    const program = this.analyzeSource(linkedCode, false);
    if (program.parsed.tree !== null) {
      this.analyzedExecution = { code: linkedCode, tree: program.parsed.tree };
    }
    return {
      errors: local.errors,
      expansions: local.prepared.expansions,
      constructs: local.constructs,
      teachingLints: local.teachingLints,
      programErrors: program.errors,
      programExpansions: program.prepared.expansions,
      programConstructs: program.constructs,
      linkerLints:
        program.errors.length === 0 && program.parsed.tree !== null
          ? this.programLints(program.parsed.tree, linkedCode)
          : [],
    };
  }

  /**
   * The diagnostics whose question spans the whole program rather than one
   * file: what is declared but never defined, and what is used but never
   * declared. Both carry the linked source's coordinates, which `server.ts`
   * maps back to whichever file the reader has open.
   */
  private programLints(tree: UniProgram, source: string): LintDiagnostic[] {
    return linkerDiagnostics(tree).concat(programDiagnostics(tree, source));
  }

  private analyzeSource(
    code: string,
    teaching: boolean = true
  ): {
    prepared: PreparedSource;
    parsed: ParsedSource;
    errors: SyntaxErrorData[];
    constructs: Construct[];
    teachingLints: LintDiagnostic[];
  } {
    const prepared = this.prepare(code);
    const check = jscppCheck(prepared.checkCode, code);
    const parsed = this.plivetMapper.analyze(
      omitEmptyDeclarations(prepared.code, check.warnings)
    );
    const errors = this.syntaxErrors(check, parsed);
    return {
      prepared,
      parsed,
      errors,
      constructs:
        parsed.tree === null
          ? this.sourceTypes(prepared)
          : this.constructsFrom(parsed.tree, prepared),
      teachingLints:
        teaching && errors.length === 0 && parsed.tree !== null
          ? warningLints(check.warnings).concat(
              teachingDiagnostics(parsed.tree, code)
            )
          : [],
    };
  }

  /**
   * Whether the program is C, decided by the PEG grammar in `jscpp/` and not
   * by the parse that just ran.
   *
   * ANTLR is here to build a tree, and it recovers in order to build one from
   * input a compiler would reject - which is the wrong instinct for a check
   * that refuses the run. It stayed silent on `int a` with no semicolon, it
   * answered one unbalanced parenthesis with three errors on two innocent
   * lines, and it rejected `case 1:` falling into `case 2:`, which is C and
   * could therefore not be stepped at all. The grammar gets all three right
   * and reads the whole file in a fiftieth of the time.
   *
   * ANTLR keeps exactly one say. When the grammar accepts a program that the
   * mapper could not turn into a tree, nothing can execute it, and its own
   * account of why is better than reporting no error and crashing at Start.
   */
  private syntaxErrors(
    check: JscppCheck,
    parsed: ParsedSource
  ): SyntaxErrorData[] {
    const error = check.error;
    if (error !== null) {
      return [new SyntaxErrorData(error.line, error.column, error.message)];
    }
    return parsed.tree === null ? parsed.errors : [];
  }

  private sourceTypes(prepared: PreparedSource): Construct[] {
    return typeDeclarations(prepared.source).concat(
      enumeratorDeclarations(prepared.enumConstants)
    );
  }

  private constructsFrom(
    tree: UniProgram,
    prepared: PreparedSource
  ): Construct[] {
    const sourceTypes = this.sourceTypes(prepared);
    const parsed = outline(
      tree,
      prepared.source,
      prepared.declarationSpecifiers
    );
    // Where both readers describe the same type declaration the source one
    // wins: the mapper keeps only the type a typedef renames, so its mark says
    // `Mode` where the source says `ReadOnlyMode = const enum Mode`.
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
        .map((construct) => sourceColumns(construct, prepared.functionPointers))
    );
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
  getLints(code: string, linkedCode: string = code): LintDiagnostic[] {
    return this.getTeachingLints(code).concat(this.getLinkerLints(linkedCode));
  }

  /** Diagnostics whose coordinates belong to this one source file. */
  getTeachingLints(code: string): LintDiagnostic[] {
    const prepared = this.prepare(code);
    // The grammar's own warnings first: they are read from a source the later
    // rewrites have not been over, so they survive where a tree rule could
    // not - unicoen drops `int volatile register;` to a positionless `UniExpr`.
    const warnings = warningLints(
      jscppCheck(prepared.checkCode, code).warnings
    );
    try {
      return warnings.concat(
        teachingDiagnostics(this.mapper.parseToUniTree(prepared.code), code)
      );
    } catch {
      return warnings;
    }
  }

  /** Program-wide diagnostics, whose coordinates are the whole program's. */
  getLinkerLints(code: string): LintDiagnostic[] {
    const prepared = this.prepare(code);
    try {
      return this.programLints(this.mapper.parseToUniTree(prepared.code), code);
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
    const prepared = this.prepare(code);
    // The grammar decides, as it does for `analyze`. ANTLR is only asked for
    // a tree, and only when the grammar has already accepted the program -
    // there is nothing to say about a file that does not parse.
    const check = jscppCheck(prepared.checkCode, code);
    return this.syntaxErrors(check, this.plivetMapper.analyze(prepared.code));
  }

  /** Runs every source pass once and gives the engine fresh record metadata. */
  private prepare(code: string): PreparedSource {
    const preprocessed = preprocessSource(code);
    // What the syntax check reads, in place of the fully rewritten `code`
    // below. The passes after this one exist for ANTLR's C++14 grammar, and
    // two of them erase the evidence a check needs: the qualifier pass blanks
    // `const`, `volatile` and `_Atomic` in place, so `int x volatile;` - which
    // is not a declaration - reached the parser as `int x         ;` and was
    // accepted. The grammar in `jscpp/` reads those itself, and function
    // pointers, and enums; a designated initializer is the one form it has no
    // rule for. Its own instance, so the engine's is left alone.
    const checkCode = new DesignatedInitializers().rewrite(preprocessed.code);
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
      checkCode,
      expansions: preprocessed.expansions.concat(enums.expansions),
      source: preprocessed.code,
      declarationSpecifiers,
      functionPointers,
      enumConstants: enumTable.declaredConstants(),
    };
  }
}

/**
 * A grammar warning as the editor's lint panel reads it.
 *
 * These are not syntax errors and must not refuse the run: clang reports
 * `int volatile register;` as a warning and compiles the program.
 */
function warningLints(warnings: JscppWarning[]): LintDiagnostic[] {
  return warnings.map((warning) => ({
    rule: warning.rule,
    severity: 'warning' as const,
    message: warning.message,
    line: warning.line,
    column: warning.column,
    endLine: warning.endLine,
    endColumn: warning.endColumn,
  }));
}

/**
 * Remove declarations the C checker has already identified as naming no
 * object before UniCOEN builds its execution tree.
 *
 * They are valid enough for a compiler to continue with a warning, but
 * UniCOEN maps one to a range-less expression followed by a raw `";"`. Its
 * function runner catches the exception raised by that string and silently
 * ends the function. Blanking the exact warning range preserves every source
 * coordinate and makes execution match the compiler behavior.
 */
function omitEmptyDeclarations(code: string, warnings: JscppWarning[]): string {
  const lines = code.split('\n');
  for (const warning of warnings) {
    if (
      warning.rule !== 'empty-declaration' ||
      warning.line !== warning.endLine
    ) {
      continue;
    }
    const line = lines[warning.line - 1];
    if (typeof line === 'undefined') {
      continue;
    }
    const from = Math.max(0, warning.column);
    const to = Math.min(line.length, warning.endColumn);
    lines[warning.line - 1] =
      line.slice(0, from) + ' '.repeat(Math.max(0, to - from)) + line.slice(to);
  }
  return lines.join('\n');
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
