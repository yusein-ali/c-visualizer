import { UniNode } from 'unicoen.ts/dist/node/UniNode';
import { UniBreak } from 'unicoen.ts/dist/node/UniBreak';
import { UniBinOp } from 'unicoen.ts/dist/node/UniBinOp';
import { UniCast } from 'unicoen.ts/dist/node/UniCast';
import { UniClassDec } from 'unicoen.ts/dist/node/UniClassDec';
import { UniContinue } from 'unicoen.ts/dist/node/UniContinue';
import { UniDoWhile } from 'unicoen.ts/dist/node/UniDoWhile';
import { UniEnhancedFor } from 'unicoen.ts/dist/node/UniEnhancedFor';
import { UniFor } from 'unicoen.ts/dist/node/UniFor';
import { UniFunctionDec } from 'unicoen.ts/dist/node/UniFunctionDec';
import { UniIf } from 'unicoen.ts/dist/node/UniIf';
import { UniMethodCall } from 'unicoen.ts/dist/node/UniMethodCall';
import { UniReturn } from 'unicoen.ts/dist/node/UniReturn';
import { UniSwitch } from 'unicoen.ts/dist/node/UniSwitch';
import { UniTernaryOp } from 'unicoen.ts/dist/node/UniTernaryOp';
import { UniVariableDec } from 'unicoen.ts/dist/node/UniVariableDec';
import { UniWhile } from 'unicoen.ts/dist/node/UniWhile';
import {
  Construct,
  ConstructClause,
  EnclosingConstruct,
  EnumeratorDetail,
  FunctionDeclarationDetail,
  ParameterDetail,
  RecordFieldDetail,
  TypeDeclarationDetail,
  VariableDeclarationDetail,
} from './Construct';
import { Enumerator } from './EnumTable';
import {
  DeclarationSpecifierInfo,
  DeclarationSpecifiers,
} from './DeclarationSpecifiers';
import {
  columnAt,
  identifierEnd,
  isWholeIdentifier,
  lineAt,
  mask,
  matchBrace,
  skipSpace,
  splitTopLevel,
} from './scan';

/**
 * Walks a parsed program and lists the constructs worth explaining on hover.
 *
 * Only statement-level nodes and calls are listed. Every literal and every
 * operand carries a code range too, and listing those buries the useful marks
 * in noise - the interesting question for a reader is "what is this line
 * doing", not "this is an int literal".
 *
 * Traversal is generic: `UniNode.fields` names each node's children, so this
 * does not have to know the shape of the forty-odd node classes.
 */
/**
 * Matched with instanceof rather than by class name: the production build
 * minifies, and `constructor.name` becomes a mangled letter there - a bug that
 * cannot show up in Node, where the names survive.
 *
 * Subclasses come first: UniDoWhile extends UniWhile, so testing UniWhile
 * first would label every do-while a while.
 */
/** A class to test with `instanceof`, which is all these entries are used for. */
type NodeClass = abstract new (...args: any[]) => object;

const KINDS: Array<[NodeClass, string]> = [
  [UniDoWhile, 'doWhile'],
  [UniWhile, 'while'],
  [UniEnhancedFor, 'for'],
  [UniFor, 'for'],
  [UniIf, 'if'],
  [UniSwitch, 'switch'],
  [UniReturn, 'return'],
  [UniBreak, 'break'],
  [UniContinue, 'continue'],
  [UniFunctionDec, 'functionDec'],
  [UniMethodCall, 'call'],
  [UniTernaryOp, 'ternary'],
  [UniCast, 'cast'],
];

/** C's assignment operators (6.5.16), excluding equality comparisons. */
const ASSIGNMENT_OPERATORS = [
  '=',
  '*=',
  '/=',
  '%=',
  '+=',
  '-=',
  '<<=',
  '>>=',
  '&=',
  '^=',
  '|=',
];

const kindOf = (node: object): string | null => {
  if (
    node instanceof UniBinOp &&
    ASSIGNMENT_OPERATORS.indexOf(node.operator) !== -1
  ) {
    return 'assignment';
  }
  if (node instanceof UniVariableDec) {
    const declaration = node as any;
    if (
      (Array.isArray(declaration.modifiers) &&
        declaration.modifiers.includes('typedef')) ||
      (declaration.type instanceof UniClassDec &&
        Array.isArray(declaration.variables) &&
        declaration.variables.length === 0)
    ) {
      return 'typeDec';
    }
    return 'variableDec';
  }
  for (const [type, kind] of KINDS) {
    if (node instanceof (type as any)) {
      return kind;
    }
  }
  return null;
};

/**
 * The name a call goes through. A call through a function pointer arrives as
 * `(*ops[1])(7, 3)`, whose callee is the dereference rather than a name, so
 * naming it means reaching past the operators to the pointer itself.
 */
const calleeName = (node: any): string => {
  const direct = nameOf(node);
  if (direct !== '' || node === null || typeof node !== 'object') {
    return direct;
  }
  for (const field of ['expr', 'left', 'receiver', 'methodName']) {
    const found = calleeName(node[field]);
    if (found !== '') {
      return found;
    }
  }
  return '';
};

const nameOf = (node: any): string =>
  node !== null && typeof node === 'object' && typeof node.name === 'string'
    ? node.name
    : '';

/** What makes the kind concrete: the declared type, the called function. */
function detailOf(
  node: any,
  declarations: VariableDeclarationDetail[] = []
): string {
  if (node instanceof UniClassDec) {
    return nameOf({ name: node.className });
  }
  if (node instanceof UniVariableDec || node instanceof UniCast) {
    if (node instanceof UniVariableDec && declarations.length > 0) {
      return declarations.map(declarationText).join('; ');
    }
    const type: any = (node as any).type;
    if (typeof type === 'string') {
      return type;
    }
    return type instanceof UniClassDec ? type.className || '' : '';
  }
  if (node instanceof UniFunctionDec) {
    return `${
      typeof node.returnType === 'string' ? node.returnType + ' ' : ''
    }${nameOf(node)}`.trim();
  }
  if (node instanceof UniMethodCall) {
    return calleeName(node.methodName);
  }
  return '';
}

const declarationText = (declaration: VariableDeclarationDetail): string =>
  [
    `type: ${declaration.type}`,
    `storage class: ${declaration.storageClasses.join(', ') || 'none'}`,
    `qualifiers: ${declaration.qualifiers.join(', ') || 'none'}`,
    `identifier: ${declaration.identifier}`,
    `value: ${declaration.initialValue || 'uninitialized'}`,
  ].join('\n');

const unique = (values: string[]): string[] =>
  values.filter((value, index) => values.indexOf(value) === index);

function declarationType(
  node: any,
  variable: any,
  info: DeclarationSpecifierInfo | null,
  source: string
): {
  type: string;
  /** The same type written out the way C spells it: `const int * const`. */
  qualifiedType: string;
  storageClasses: string[];
  qualifiers: string[];
  identifier: string;
} {
  const rawName = typeof variable.name === 'string' ? variable.name : '';
  const names = rawName.match(/[A-Za-z_]\w*/g);
  const identifier = names === null ? rawName.trim() : names[names.length - 1];
  const stars = (rawName.match(/\*/g) || []).length;
  let baseType =
    typeof node.type === 'string'
      ? node.type
      : node.type instanceof UniClassDec
        ? node.type.className || ''
        : '';
  const prefix = sourceForRange(source, {
    begin: node.codeRange.begin,
    end: variable.codeRange.begin,
  });
  const record = /\b(struct|union)\s+(?:([A-Za-z_]\w*)\b)?/.exec(prefix);
  if (record !== null && (baseType === '' || baseType === record[2])) {
    baseType =
      typeof record[2] === 'undefined'
        ? `${record[1]} without a tag`
        : `${record[1]} ${record[2]}`;
  }

  const storageClasses = unique(
    (Array.isArray(node.modifiers) ? node.modifiers : [])
      .filter((modifier: string) => modifier !== 'typedef')
      .concat(info === null ? [] : info.storageClasses)
  );
  const pointerQualifiers = info === null ? [] : info.pointerQualifiers || [];
  const baseQualifiers =
    info === null ? [] : info.baseQualifiers || info.qualifiers;
  let type = baseType;
  // Each pointer carries its own qualifiers: `const int *` is a pointer to a
  // const int, `int * const` a const pointer to an int, and reporting one flat
  // list of words cannot tell the two apart.
  let qualifiedType = unique(baseQualifiers)
    .concat(baseType === '' ? [] : [baseType])
    .join(' ');
  for (let level = 0; level < stars; level += 1) {
    type += ' *';
    const own = unique(pointerQualifiers[level] || []);
    qualifiedType += own.length === 0 ? ' *' : ` * ${own.join(' ')}`;
  }
  if (typeof variable.typeSuffix === 'string') {
    type += variable.typeSuffix;
    qualifiedType += variable.typeSuffix;
  }
  return {
    type,
    qualifiedType,
    storageClasses,
    qualifiers: unique(
      info === null ? [] : info.qualifiers.concat(...pointerQualifiers)
    ),
    identifier,
  };
}

function sourceForRange(source: string, range: any): string {
  return source
    .slice(offsetOf(source, range.begin), offsetOf(source, range.end))
    .trim();
}

function offsetOf(source: string, location: any): number {
  let at = 0;
  for (let line = 1; line < location.y; line += 1) {
    const newline = source.indexOf('\n', at);
    at = newline === -1 ? source.length : newline + 1;
  }
  return at + location.x;
}

function initializerFromSource(
  source: string,
  node: any,
  variable: any,
  index: number
): string | null {
  if (variable.value === null) {
    return null;
  }
  const start = offsetOf(source, variable.codeRange.begin);
  const next = node.variables[index + 1];
  const end =
    typeof next === 'undefined'
      ? offsetOf(source, node.codeRange.end)
      : offsetOf(source, next.codeRange.begin);
  const original = source.slice(start, end);
  const masked = mask(original);
  let depth = 0;
  for (let at = 0; at < masked.length; at += 1) {
    const char = masked[at];
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
    } else if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
    } else if (char === '=' && depth === 0) {
      return original
        .slice(at + 1)
        .replace(/[,;]\s*$/, '')
        .trim();
    }
  }
  return sourceForRange(source, variable.value.codeRange);
}

function variableDetails(
  node: any,
  source: string,
  specifiers: DeclarationSpecifiers | undefined,
  automaticStorage: boolean
): VariableDeclarationDetail[] {
  if (!Array.isArray(node.variables) || node.variables.length === 0) {
    return [];
  }
  const first = node.variables[0];
  return node.variables.map((variable: any, index: number) => {
    const info =
      typeof specifiers === 'undefined'
        ? null
        : specifiers.infoForVariable(
            node.codeRange,
            variable.codeRange,
            first.codeRange
          );
    const declared = declarationType(node, variable, info, source);
    return {
      type: declared.type,
      storageClasses:
        automaticStorage && declared.storageClasses.length === 0
          ? ['auto']
          : declared.storageClasses,
      qualifiers: declared.qualifiers,
      identifier: declared.identifier,
      initialValue: initializerFromSource(source, node, variable, index),
    };
  });
}

/** The name a declarator introduces, and whatever it is spelled with. */
const TYPEDEF_DECLARATOR = /^([\s\S]*?)([A-Za-z_]\w*)\s*((?:\[[^\]]*\])*)\s*$/;

const normalizeSpace = (text: string): string =>
  text.replace(/\s+/g, ' ').trim();

/**
 * Specifiers the parser's range leaves behind. Qualifiers are blanked before
 * the parser sees the source, so `const char *label(void)` arrives as a
 * declaration that begins at `char` - and a return type read from there is a
 * `char *` that is not const. Storage classes and `inline` sit in the same
 * place and are dropped the same way by the mapper.
 */
const SPECIFIER_RUN =
  /(?:\b(?:const|volatile|restrict|_Atomic|static|extern|inline|_Noreturn|auto|register|_Thread_local|thread_local)\b\s*)+$/;

/** A declarator's trailing name, and everything written in front of it. */
const DECLARED_NAME = /^([\s\S]*?)([A-Za-z_]\w*)\s*$/;

/**
 * Words that stand in front of a return type without being part of it. A
 * storage-class specifier gives the function linkage, and `inline` and
 * `_Noreturn` describe the function itself (6.7.4): `static const char *f`
 * returns a `const char *`, not a `static const char *`.
 */
const NOT_A_TYPE =
  /\b(?:typedef|static|extern|inline|_Noreturn|auto|register|_Thread_local|thread_local)\b/g;

/** Where the declaration whose parsed range begins here was actually typed. */
function declarationStart(source: string, offset: number): number {
  const lineStart = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const run = SPECIFIER_RUN.exec(source.slice(lineStart, offset));
  return run === null ? offset : lineStart + run.index;
}

/**
 * The parameter type list, one entry per identifier it declares. Parameters
 * are declarations, so the reader that spells out a variable's type spells out
 * theirs too - `const int *values` is reported as a `const int *`, not as an
 * `int *` with a `const` mentioned somewhere else.
 */
function parameterDetails(
  node: any,
  source: string,
  specifiers: DeclarationSpecifiers | undefined
): ParameterDetail[] {
  const parameters: ParameterDetail[] = [];
  for (const parameter of Array.isArray(node.params) ? node.params : []) {
    const variables = Array.isArray(parameter.variables)
      ? parameter.variables
      : [];
    for (const variable of variables) {
      const info =
        typeof specifiers === 'undefined'
          ? null
          : specifiers.infoForVariable(
              parameter.codeRange,
              variable.codeRange,
              variables[0].codeRange
            );
      const declared = declarationType(parameter, variable, info, source);
      parameters.push({
        identifier: declared.identifier,
        type: declared.qualifiedType,
      });
    }
  }
  return parameters;
}

/**
 * What a function declaration says: what it returns, what it is called, and
 * what it takes. The AST keeps only a bare return type - `char*` for a
 * `const char *`, the tag dropped from a `struct Point` - so the type and the
 * name are read back from the declarator as it was written, up to the
 * parenthesis that opens the parameter list.
 *
 * Returns null for a declarator this reader cannot spell out, so the caller
 * can fall back to the one-line detail rather than report a name it guessed.
 */
function functionDetail(
  node: any,
  source: string,
  specifiers: DeclarationSpecifiers | undefined
): FunctionDeclarationDetail | null {
  const start = declarationStart(
    source,
    offsetOf(source, node.codeRange.begin)
  );
  const open = source.indexOf('(', start);
  if (open === -1) {
    return null;
  }
  const declarator = DECLARED_NAME.exec(source.slice(start, open));
  if (declarator === null) {
    return null;
  }
  const [, returnType, identifier] = declarator;
  const parsedName = nameOf(node);
  if (parsedName !== '' && parsedName !== identifier) {
    return null;
  }
  return {
    // Pointer stars bind to the declarator in the source, `char *label`, but
    // the type they belong to is the return type, and the tooltip names types
    // the way the variable one does.
    returnType: normalizeSpace(returnType.replace(NOT_A_TYPE, ''))
      .replace(/\s*\*/g, ' *')
      .trim(),
    identifier,
    parameters: parameterDetails(node, source, specifiers),
    // A body is what makes a declaration a definition (6.9.1), and the brace
    // that settles it can be a screen below the name being hovered.
    isDefinition: node.block !== null && typeof node.block !== 'undefined',
    // The same words `returnType` had to drop, kept where they belong: they
    // describe the function, not the type it returns.
    storageClasses: unique(returnType.match(NOT_A_TYPE) ?? []),
  };
}

/**
 * A spelled type split into the type itself and the qualifiers on it, the way
 * the variable tooltip already reports them: `int * const` is an `int *` that
 * is const, and saying so names both halves of what was written.
 */
function typeDetail(
  spelled: string,
  name: string,
  nameKind: TypeDeclarationDetail['nameKind']
): TypeDeclarationDetail {
  const qualifiers: string[] = [];
  // `_Atomic(int)` qualifies the type it wraps; the parentheses belong to the
  // qualifier's spelling, not to the type's name.
  const type = spelled
    .replace(/\b_Atomic\s*\(([^)]*)\)/g, '_Atomic $1')
    .replace(/\b(const|volatile|restrict|_Atomic)\b/g, (word: string) => {
      qualifiers.push(word);
      return '';
    });
  return {
    qualifiers: unique(qualifiers),
    type: normalizeSpace(type),
    nameKind,
    name,
  };
}

/**
 * What a typedef declares, one entry per name it introduces. Saying only
 * `enum Mode` for `typedef const enum Mode ReadOnly` is two things short of
 * the truth: the alias being declared, and the `const` the alias carries - and
 * the AST has dropped both by the time the walk runs.
 *
 * `base` is the type the declarators share when the caller already knows it,
 * as it does for a record body; passing null reads it from the first
 * declarator, where `typedef int * const P, Q` leaves `int` for `Q`.
 *
 * Returns null for a declarator this reader cannot spell out - a function
 * pointer, say - so the caller can fall back rather than invent a name.
 */
function typedefDetails(
  base: string | null,
  declarators: string
): TypeDeclarationDetail[] | null {
  let root = base;
  const declared: TypeDeclarationDetail[] = [];
  for (const part of splitTopLevel(declarators, ',')) {
    const declarator = TYPEDEF_DECLARATOR.exec(part);
    if (declarator === null) {
      return null;
    }
    const [, prefix, alias, arrays] = declarator;
    if (root === null) {
      const star = prefix.indexOf('*');
      root = normalizeSpace(star === -1 ? prefix : prefix.slice(0, star));
      declared.push(
        typeDetail(`${normalizeSpace(prefix)}${arrays}`, alias, 'typedefName')
      );
      continue;
    }
    const spelled = normalizeSpace(`${root} ${prefix}`);
    declared.push(typeDetail(`${spelled}${arrays}`, alias, 'typedefName'));
  }
  return declared.length === 0 ? null : declared;
}

const typeDeclarationText = (declaration: TypeDeclarationDetail): string =>
  [
    `type: ${declaration.type}`,
    `qualifiers: ${declaration.qualifiers.join(', ') || 'none'}`,
    `${declaration.nameKind === 'tag' ? 'tag' : 'typedef name'}: ${
      declaration.name || 'none'
    }`,
  ].join('\n');

const functionText = (declaration: FunctionDeclarationDetail): string =>
  [
    `return type: ${declaration.returnType}`,
    `identifier: ${declaration.identifier}`,
    declaration.parameters.length === 0
      ? 'parameters: none'
      : ['parameters:']
          .concat(
            declaration.parameters.map(
              (parameter) => `  ${parameter.identifier}: ${parameter.type}`
            )
          )
          .join('\n'),
  ].join('\n');

const enumeratorText = (declaration: EnumeratorDetail): string =>
  [
    `type: ${declaration.type}`,
    `enumeration: ${declaration.enumeration}`,
    `identifier: ${declaration.identifier}`,
    `value: ${declaration.value}`,
  ].join('\n');

const recordFieldText = (declaration: RecordFieldDetail): string =>
  [
    `type: ${declaration.type}`,
    `structure or union: ${declaration.record}`,
    `identifier: ${declaration.identifier}`,
  ].join('\n');

/** The source-level name of a `UniClassDec`, which represents both records. */
function recordTypeOf(node: any, source: string): string {
  const spelling = sourceForRange(source, node.codeRange);
  const definition = /\b(struct|union)\s*(?:([A-Za-z_]\w*)\s*)?\{/.exec(
    spelling
  );
  if (definition !== null) {
    return typeof definition[2] === 'undefined'
      ? `${definition[1]} without a tag`
      : `${definition[1]} ${definition[2]}`;
  }
  const name = typeof node.className === 'string' ? node.className : '';
  return name === '' ? 'structure or union without a tag' : name;
}

/**
 * Record members use declaration syntax, but they are not objects in scope.
 * Keep the complete qualified type and the containing record, and deliberately
 * omit the storage class and initial value that belong to variable tooltips.
 */
function recordFieldDetails(
  node: any,
  source: string,
  specifiers: DeclarationSpecifiers | undefined,
  record: string
): RecordFieldDetail[] {
  if (!Array.isArray(node.variables) || node.variables.length === 0) {
    return [];
  }
  const first = node.variables[0];
  return node.variables.map((variable: any) => {
    const info =
      typeof specifiers === 'undefined'
        ? null
        : specifiers.infoForVariable(
            node.codeRange,
            variable.codeRange,
            first.codeRange
          );
    const declared = declarationType(node, variable, info, source);
    // RecordTable blanks array suffixes before parsing because unicoen.ts
    // otherwise drops the rest of the translation unit. Recover the suffix
    // from the untouched source for the declaration tooltip.
    const declarationEnd = offsetOf(source, node.codeRange.end) + 1;
    const declarator = source.slice(
      offsetOf(source, variable.codeRange.begin),
      declarationEnd
    );
    const identifierAt = declarator.indexOf(declared.identifier);
    const suffix =
      identifierAt === -1
        ? null
        : /^\s*((?:\[[^\]]*\]\s*)+)/.exec(
            declarator.slice(identifierAt + declared.identifier.length)
          );
    const arrays = suffix === null ? '' : suffix[1].replace(/\s+/g, '');
    return {
      type:
        arrays === '' || declared.qualifiedType.endsWith(arrays)
          ? declared.qualifiedType
          : declared.qualifiedType + arrays,
      record,
      identifier: declared.identifier,
    };
  });
}

/**
 * The enumeration constants an enum body declares, marked where they are
 * declared. The value is the interesting part: a reader looking at
 * `enum Mode { OFF, ON = 4, FAULT }` cannot see that FAULT is 5, and the
 * declaration is the one place the editor has nothing else to say - a use of
 * the name is already marked as the constant it was replaced with.
 */
export function enumeratorDeclarations(enumerators: Enumerator[]): Construct[] {
  return enumerators.map((enumerator) => {
    const declaration: EnumeratorDetail = {
      // 6.4.4.3: an identifier declared as an enumeration constant has type
      // int, whatever type the enumeration itself is compatible with.
      type: 'int',
      enumeration: enumerator.enumeration,
      identifier: enumerator.name,
      value: enumerator.value,
    };
    return {
      kind: 'enumerator',
      detail: enumeratorText(declaration),
      enumerator: declaration,
      line: enumerator.line,
      column: enumerator.column,
      endLine: enumerator.line,
      endColumn: enumerator.column + enumerator.name.length,
    };
  });
}

/**
 * Typedefs that rename an existing type: `typedef const enum Mode ReadOnly`.
 * A typedef whose type has a body is left to the record scan, which knows
 * where that body ends - here the declaration is everything up to the first
 * semicolon.
 */
function typedefAliases(code: string, masked: string): Construct[] {
  const declarations: Construct[] = [];
  const keyword = 'typedef';
  let from = 0;
  while (from < masked.length) {
    const start = masked.indexOf(keyword, from);
    if (start === -1) {
      break;
    }
    from = start + keyword.length;
    if (!isWholeIdentifier(masked, start, keyword.length)) {
      continue;
    }
    const semicolon = masked.indexOf(';', from);
    if (semicolon === -1) {
      break;
    }
    const body = masked.indexOf('{', from);
    if (body !== -1 && body < semicolon) {
      continue;
    }
    const declared = typedefDetails(null, masked.slice(from, semicolon));
    if (declared === null) {
      continue;
    }
    declarations.push({
      kind: 'typeDec',
      detail: declared.map(typeDeclarationText).join('\n\n'),
      declaredTypes: declared,
      line: lineAt(code, start),
      column: columnAt(code, start),
      endLine: lineAt(code, semicolon + 1),
      endColumn: columnAt(code, semicolon + 1),
    });
  }
  return declarations;
}

/**
 * Aggregate definitions as they appear in the source, before the execution
 * passes erase enum definitions and before the mapper wraps records in a
 * variable declaration. A record followed by an object declarator ends at its
 * closing brace, leaving that trailing declarator to the AST's variable mark.
 *
 * Typedefs are read here too, bodies and aliases alike: the parser keeps only
 * the type a typedef renames, so the qualifiers and the new name have to be
 * read from the source or not shown at all.
 */
export function typeDeclarations(code: string): Construct[] {
  const masked = mask(code);
  const declarations: Construct[] = typedefAliases(code, masked);
  for (const keyword of ['struct', 'union', 'enum']) {
    let from = 0;
    while (from < masked.length) {
      const keywordAt = masked.indexOf(keyword, from);
      if (keywordAt === -1) {
        break;
      }
      from = keywordAt + keyword.length;
      if (!isWholeIdentifier(masked, keywordAt, keyword.length)) {
        continue;
      }
      let cursor = skipSpace(masked, from);
      let tag = '';
      if (/[A-Za-z_]/.test(masked[cursor] || '')) {
        const tagEnd = identifierEnd(masked, cursor);
        tag = masked.slice(cursor, tagEnd);
        cursor = skipSpace(masked, tagEnd);
      }
      if (masked[cursor] !== '{') {
        continue;
      }
      const close = matchBrace(masked, cursor);
      if (close === -1) {
        continue;
      }

      const boundary = Math.max(
        masked.lastIndexOf(';', keywordAt - 1),
        masked.lastIndexOf('{', keywordAt - 1),
        masked.lastIndexOf('}', keywordAt - 1)
      );
      const prefix = masked.slice(boundary + 1, keywordAt);
      const typedef = /\btypedef\b[\sA-Za-z_]*$/.exec(prefix);
      const start = typedef === null ? keywordAt : boundary + 1 + typedef.index;
      const semicolon = masked.indexOf(';', close + 1);
      const end = typedef !== null && semicolon !== -1 ? semicolon + 1 : close;
      const record =
        tag === '' ? `${keyword} without a tag` : `${keyword} ${tag}`;
      let declared: TypeDeclarationDetail[] = [typeDetail(record, tag, 'tag')];
      if (typedef !== null && semicolon !== -1) {
        // Qualifiers sit between `typedef` and the keyword: `typedef const
        // struct S { ... } A` makes A a const S, not a plain one.
        const qualified = normalizeSpace(
          `${prefix.slice(typedef.index).replace(/^typedef\b/, '')} ${record}`
        );
        declared = typedefDetails(
          qualified,
          masked.slice(close + 1, semicolon)
        ) || [typeDetail(qualified, '', 'typedefName')];
      }
      declarations.push({
        kind: 'typeDec',
        detail: declared.map(typeDeclarationText).join('\n\n'),
        declaredTypes: declared,
        line: lineAt(code, start),
        column: columnAt(code, start),
        endLine: lineAt(code, end),
        endColumn: columnAt(code, end),
      });
    }
  }
  return declarations;
}

/**
 * The clauses of a construct, named the way the standard names them.
 *
 * The text is the source itself rather than the tree printed back: a reader
 * hovering `for (i = 0; i < n; i++)` is asking about what they wrote, and the
 * mapper's own spelling of an expression is not always that.
 */
function clausesOf(
  node: any,
  kind: string,
  source: string,
  functions: Map<string, ParameterDetail[]>
): ConstructClause[] {
  const written = (child: any): string =>
    child !== null &&
    typeof child === 'object' &&
    child.codeRange &&
    child.codeRange.begin &&
    child.codeRange.end
      ? // A `for` initialization's range takes in the semicolon that ends it,
        // which is punctuation between the clauses rather than part of one.
        normalizeSpace(sourceForRange(source, child.codeRange)).replace(
          /\s*;$/,
          ''
        )
      : '';
  const clause = (label: string, child: any): ConstructClause[] => {
    const text = written(child);
    if (text === '') {
      return [];
    }
    const range = child.codeRange;
    return [
      {
        label,
        text,
        range: {
          begin: { x: range.begin.x, y: range.begin.y },
          end: { x: range.end.x, y: range.end.y },
        },
      },
    ];
  };
  switch (kind) {
    case 'if':
    case 'while':
    case 'doWhile':
    case 'switch':
      return clause('clauseCondition', node.cond);
    case 'for':
      return [
        ...clause('clauseInitialization', node.init),
        ...clause('clauseCondition', node.cond),
        ...clause('clauseIteration', node.step),
      ];
    case 'return':
      return clause('clauseExpression', node.value);
    case 'ternary':
      return [
        ...clause('clauseCondition', node.cond),
        ...clause('clauseWhenTrue', node.trueExpr),
        ...clause('clauseWhenFalse', node.falseExpr),
      ];
    case 'cast':
      return [
        ...(typeof node.type === 'string' && node.type !== ''
          ? [{ label: 'clauseTargetType', text: node.type }]
          : []),
        ...clause('clauseExpression', node.value),
      ];
    case 'assignment':
      return [
        ...clause('clauseTarget', node.left),
        ...clause('clauseAssignedValue', node.right),
      ];
    case 'call':
      return callClauses(node, written, functions);
    default:
      return [];
  }
}

/**
 * What a call passes, paired with what it initialises.
 *
 * C passes by value, and nothing on screen says so: `swap(a, b)` looks exactly
 * like a call that could change `a`. Writing the parameter beside the argument
 * it is initialised from is the shortest way to say what actually happens.
 */
function callClauses(
  node: any,
  written: (child: any) => string,
  functions: Map<string, ParameterDetail[]>
): ConstructClause[] {
  const name = calleeName(node.methodName);
  const parameters = functions.get(name);
  const args: any[] = Array.isArray(node.args) ? node.args : [];
  if (typeof parameters === 'undefined') {
    // A library function, or one declared after this call: the arguments are
    // still worth naming, and nothing is invented about what they initialise.
    return args
      .map((argument) => written(argument))
      .filter((text) => text !== '')
      .map((text) => ({ label: 'clauseArgument', text }));
  }
  return args.map((argument, index) => {
    const parameter = parameters[index];
    const text = written(argument);
    return {
      label: 'clauseArgument',
      text:
        typeof parameter === 'undefined'
          ? text
          : `${parameter.type} ${parameter.identifier} = ${text}`,
    };
  });
}

/** The parameters of every function the program defines, by name. */
function functionParameters(
  root: UniNode,
  source: string,
  specifiers?: DeclarationSpecifiers
): Map<string, ParameterDetail[]> {
  const found = new Map<string, ParameterDetail[]>();
  const visit = (node: any): void => {
    if (node === null || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node.fields === 'undefined') {
      return;
    }
    if (node instanceof UniFunctionDec && nameOf(node) !== '') {
      found.set(nameOf(node), parameterDetails(node, source, specifiers));
    }
    for (const field of Array.from(node.fields.keys()) as string[]) {
      if (field !== 'comments' && field !== 'codeRange') {
        visit(node[field]);
      }
    }
  };
  visit(root);
  return found;
}

/**
 * What is true of a construct however it runs.
 *
 * A `do`-`while` runs its body before its first test, which is the whole
 * difference between it and a `while` and is spelled nowhere in the source: a
 * reader has to know the language to see it.
 */
const notesOf = (kind: string): string[] =>
  kind === 'doWhile' ? ['noteBodyBeforeTest'] : [];

/**
 * The construct a jump leaves. `break` and `continue` differ: a `break` inside
 * a `switch` inside a loop leaves the switch, while a `continue` there ignores
 * the switch entirely and restarts the loop.
 */
function enclosingOf(
  kind: string,
  enclosure: EnclosingConstruct[]
): EnclosingConstruct | undefined {
  if (kind === 'return') {
    for (let i = enclosure.length - 1; 0 <= i; i -= 1) {
      if (enclosure[i].kind === 'functionDec') {
        return enclosure[i];
      }
    }
    return undefined;
  }
  if (kind !== 'break' && kind !== 'continue') {
    return undefined;
  }
  for (let i = enclosure.length - 1; 0 <= i; i -= 1) {
    const { kind: enclosingKind } = enclosure[i];
    if (enclosingKind === 'functionDec') {
      return undefined;
    }
    if (
      enclosingKind === 'for' ||
      enclosingKind === 'while' ||
      enclosingKind === 'doWhile' ||
      (kind === 'break' && enclosingKind === 'switch')
    ) {
      return enclosure[i];
    }
  }
  return undefined;
}

/** The kinds a jump statement can be talking about. */
const ENCLOSING_KINDS = ['for', 'while', 'doWhile', 'switch', 'functionDec'];

export function outline(
  root: UniNode,
  source: string = '',
  specifiers?: DeclarationSpecifiers
): Construct[] {
  const constructs: Construct[] = [];
  const functions = functionParameters(root, source, specifiers);
  const visit = (
    node: any,
    automaticStorage: boolean = false,
    containingRecord: string | null = null,
    enclosure: EnclosingConstruct[] = []
  ) => {
    if (node === null || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child) =>
        visit(child, automaticStorage, containingRecord, enclosure)
      );
      return;
    }
    if (typeof node.fields === 'undefined') {
      return;
    }
    const isRecordField =
      containingRecord !== null && node instanceof UniVariableDec;
    const kind = isRecordField ? 'recordField' : kindOf(node);
    const range = node.codeRange;
    if (kind !== null && range && range.begin && range.end) {
      const declarations =
        kind === 'variableDec'
          ? variableDetails(node, source, specifiers, automaticStorage)
          : [];
      const fields = isRecordField
        ? recordFieldDetails(node, source, specifiers, containingRecord!)
        : [];
      const declaredFunction =
        kind === 'functionDec'
          ? functionDetail(node, source, specifiers)
          : null;
      if (kind === 'recordField') {
        node.variables.forEach((variable: any, index: number) => {
          const variableRange = variable.codeRange;
          if (variableRange && variableRange.begin && variableRange.end) {
            constructs.push({
              kind,
              detail: recordFieldText(fields[index]),
              recordField: fields[index],
              line: variableRange.begin.y,
              column: variableRange.begin.x,
              endLine: variableRange.end.y,
              endColumn: variableRange.end.x + 1,
            });
          }
        });
      } else {
        const clauses = clausesOf(node, kind, source, functions);
        const enclosing = enclosingOf(kind, enclosure);
        const notes = notesOf(kind);
        constructs.push({
          kind,
          detail:
            declaredFunction === null
              ? detailOf(node, declarations)
              : functionText(declaredFunction),
          clauses: clauses.length === 0 ? undefined : clauses,
          enclosing,
          notes: notes.length === 0 ? undefined : notes,
          variableDeclarations:
            declarations.length === 0 ? undefined : declarations,
          declaredFunction:
            declaredFunction === null ? undefined : declaredFunction,
          line: range.begin.y,
          column: range.begin.x,
          endLine: range.end.y,
          endColumn: range.end.x + 1,
        });
      }
      if (kind === 'variableDec') {
        node.variables.forEach((variable: any, index: number) => {
          const variableRange = variable.codeRange;
          if (variableRange && variableRange.begin && variableRange.end) {
            constructs.push({
              kind,
              detail: declarationText(declarations[index]),
              variableDeclarations: [declarations[index]],
              line: variableRange.begin.y,
              column: variableRange.begin.x,
              endLine: variableRange.end.y,
              endColumn: variableRange.end.x + 1,
            });
          }
        });
      }
    }
    const childAutomaticStorage =
      node instanceof UniClassDec
        ? false
        : automaticStorage || node instanceof UniFunctionDec;
    const childRecord =
      node instanceof UniClassDec
        ? recordTypeOf(node, source)
        : node instanceof UniFunctionDec
          ? null
          : containingRecord;
    // What a `break` or a `return` inside this node would be leaving.
    const childEnclosure =
      kind !== null && ENCLOSING_KINDS.indexOf(kind) !== -1 && range
        ? enclosure.concat({
            kind,
            line: range.begin.y,
            ...(nameOf(node) === '' ? {} : { name: nameOf(node) }),
          })
        : enclosure;
    for (const field of Array.from(node.fields.keys()) as string[]) {
      if (field !== 'comments' && field !== 'codeRange') {
        visit(node[field], childAutomaticStorage, childRecord, childEnclosure);
      }
    }
  };
  visit(root);
  return constructs;
}
