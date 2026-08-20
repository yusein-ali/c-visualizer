import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { Variable } from 'unicoen.ts/dist/interpreter/Engine/Variable';
import { RuntimeDeclarationInfo } from './DeclarationSpecifiers';
import { RuntimeEnumInfo, RuntimeEnumTypes } from './EnumTable';
import {
  RuntimeFunctionPointerTypes,
  signatureOf,
} from './FunctionPointerTable';
import {
  alignAddress,
  basicSizeof,
  RuntimeRecordInfo,
  RuntimeRecordTypes,
} from './RecordTable';

/** What the visualizer shows for a variable that holds a function. */
export interface FunctionPointerVariableInfo {
  /** The signature: `int (*)(int, int)`. */
  displayType: string;
  /**
   * The function pointed at, or null when the pointer holds no function. The
   * address is not repeated here: it is the value the variable holds, which is
   * what a function pointer is.
   */
  pointee: string | null;
}

/** Display metadata added to a runtime variable without changing its value. */
export interface EnumVariableInfo extends RuntimeEnumInfo {
  /** True only for a scalar enum whose value can name an enumerator. */
  scalar: boolean;
}

interface VariableWithTypeInfo extends Variable {
  plivetEnumInfo?: EnumVariableInfo;
  plivetFunctionPointerInfo?: FunctionPointerVariableInfo;
  plivetRecordInfo?: RuntimeRecordInfo;
  plivetDeclarationInfo?: RuntimeDeclarationInfo;
  plivetAddress?: number;
  plivetPointerValue?: number;
}

export interface RuntimeFunctionLocation {
  name: string;
  address: number;
}

interface ExecStateWithTypeInfo extends ExecState {
  plivetFunctions?: RuntimeFunctionLocation[];
}

export type DeclarationInfoLookup = (
  address: number
) => RuntimeDeclarationInfo | null;

/** The name of the function at a code address, or null when there is none. */
export type FunctionLookup = (address: number) => string | null;

export function annotateRuntimeFunctions(
  state: ExecState,
  functions: RuntimeFunctionLocation[]
): ExecState {
  (state as ExecStateWithTypeInfo).plivetFunctions = functions.map((item) => ({
    name: item.name,
    address: item.address,
  }));
  return state;
}

export function runtimeFunctionsOf(
  state: ExecState
): RuntimeFunctionLocation[] {
  const functions = (state as ExecStateWithTypeInfo).plivetFunctions;
  return typeof functions === 'undefined' ? [] : functions;
}

/**
 * Adds enum display information to every variable in an execution snapshot.
 * The engine still computes with numbers; the canvas gains the source-level
 * type and enumerator names that unicoen.ts otherwise discards.
 */
export function annotateRuntimeVariables(
  state: ExecState,
  enumTypes: RuntimeEnumTypes,
  recordTypes: RuntimeRecordTypes,
  declarationInfoAt: DeclarationInfoLookup = () => null,
  functionPointerTypes: RuntimeFunctionPointerTypes = {},
  functionAt: FunctionLookup = () => null
): ExecState {
  const displayAddresses = new Map<number, number>();
  for (const stack of state.getStacks()) {
    let cursor: number | null = null;
    for (const variable of stack.getVariables()) {
      const shape = displayShapeOf(variable, recordTypes);
      cursor = alignAddress(
        cursor === null ? variable.address : cursor,
        shape.alignment
      );
      annotateVariable(
        variable,
        enumTypes,
        recordTypes,
        declarationInfoAt,
        cursor,
        displayAddresses
      );
      cursor += shape.size;
    }
  }
  for (const stack of state.getStacks()) {
    for (const variable of stack.getVariables()) {
      annotatePointerValues(variable, displayAddresses);
      annotateFunctionPointers(variable, functionPointerTypes, functionAt);
    }
  }
  return state;
}

/**
 * The type to show a reader, which is not always the type the engine runs on.
 * An enum, a record and a function pointer each execute under a name the
 * source never contained, so anything that displays a variable - the canvas
 * cell, the editor's hover tooltip - has to ask rather than read `type`.
 */
export function displayTypeOf(variable: Variable): string {
  const functionInfo = functionPointerInfoOf(variable);
  if (functionInfo !== null) {
    return functionInfo.displayType;
  }
  const enumInfo = enumInfoOf(variable);
  if (enumInfo !== null) {
    return enumInfo.displayType;
  }
  const recordInfo = recordInfoOf(variable);
  return recordInfo === null ? variable.type : recordInfo.displayType;
}

export function functionPointerInfoOf(
  variable: Variable
): FunctionPointerVariableInfo | null {
  const info = (variable as VariableWithTypeInfo).plivetFunctionPointerInfo;
  return typeof info === 'undefined' ? null : info;
}

export function enumInfoOf(variable: Variable): EnumVariableInfo | null {
  const info = (variable as VariableWithTypeInfo).plivetEnumInfo;
  return typeof info === 'undefined' ? null : info;
}

export function recordInfoOf(variable: Variable): RuntimeRecordInfo | null {
  const info = (variable as VariableWithTypeInfo).plivetRecordInfo;
  return typeof info === 'undefined' ? null : info;
}

export function declarationInfoOf(
  variable: Variable
): RuntimeDeclarationInfo | null {
  const info = (variable as VariableWithTypeInfo).plivetDeclarationInfo;
  return typeof info === 'undefined' ? null : info;
}

export function displayAddressOf(variable: Variable): number {
  const address = (variable as VariableWithTypeInfo).plivetAddress;
  return typeof address === 'undefined' ? variable.address : address;
}

export function displayPointerValueOf(variable: Variable): number | null {
  const value = (variable as VariableWithTypeInfo).plivetPointerValue;
  return typeof value === 'undefined' ? null : value;
}

function annotateVariable(
  variable: Variable,
  enumTypes: RuntimeEnumTypes,
  recordTypes: RuntimeRecordTypes,
  declarationInfoAt: DeclarationInfoLookup,
  displayAddress: number = variable.address,
  displayAddresses: Map<number, number> = new Map(),
  engineAddress: number = variable.address
): void {
  const annotated = variable as VariableWithTypeInfo;
  annotated.plivetAddress = displayAddress;
  displayAddresses.set(engineAddress, displayAddress);
  if (annotated.plivetDeclarationInfo === undefined) {
    const declarationInfo = declarationInfoAt(variable.address);
    if (declarationInfo !== null) {
      annotated.plivetDeclarationInfo = declarationInfo;
    }
  }
  const match = /^([^[*]+)([\s\S]*)$/.exec(variable.type);
  const baseType = match === null ? variable.type : match[1].trim();
  const suffix = match === null ? '' : match[2];
  const enumInfo = enumTypes[baseType];
  if (typeof enumInfo !== 'undefined') {
    annotated.plivetEnumInfo = {
      displayType: enumInfo.displayType + suffix,
      namesByValue: enumInfo.namesByValue,
      scalar: suffix === '',
    };
  }
  const recordInfo = recordTypes[baseType];
  if (typeof recordInfo !== 'undefined') {
    annotated.plivetRecordInfo = {
      ...recordInfo,
      displayType: recordInfo.displayType + suffix,
    };
  }
  const value = variable.getValue();
  if (Array.isArray(value)) {
    let childCursor = displayAddress;
    let engineChildCursor = engineAddress + 4;
    for (const child of value) {
      const field =
        typeof recordInfo === 'undefined' || suffix !== ''
          ? undefined
          : recordInfo.fields[child.name];
      const childShape = displayShapeOf(child, recordTypes);
      const childAddress =
        typeof field === 'undefined'
          ? alignAddress(childCursor, childShape.alignment)
          : displayAddress + field.offset;
      const childEngineAddress =
        typeof field === 'undefined'
          ? variable.type.indexOf('[') !== -1
            ? child.address
            : engineChildCursor
          : engineAddress + 4 + field.engineOffset;
      if (typeof field === 'undefined') {
        childCursor = childAddress + childShape.size;
        if (
          variable.type.indexOf('[') !== -1 &&
          annotated.plivetDeclarationInfo !== undefined
        ) {
          (child as VariableWithTypeInfo).plivetDeclarationInfo = {
            ...annotated.plivetDeclarationInfo,
            storageClasses: [],
          };
        }
      } else if (
        field.baseQualifiers.length > 0 ||
        field.pointerQualifiers.some((items) => items.length > 0) ||
        annotated.plivetDeclarationInfo !== undefined
      ) {
        const parentQualifiers =
          annotated.plivetDeclarationInfo === undefined
            ? []
            : annotated.plivetDeclarationInfo.baseQualifiers ||
              annotated.plivetDeclarationInfo.qualifiers;
        const baseQualifiers = uniqueQualifiers(
          field.baseQualifiers.concat(parentQualifiers)
        );
        (child as VariableWithTypeInfo).plivetDeclarationInfo = {
          storageClasses: [],
          qualifiers: uniqueQualifiers(
            baseQualifiers.concat(...field.pointerQualifiers)
          ),
          baseQualifiers,
          pointerQualifiers: field.pointerQualifiers,
          region:
            annotated.plivetDeclarationInfo === undefined
              ? 'stack'
              : annotated.plivetDeclarationInfo.region,
          initialized:
            annotated.plivetDeclarationInfo === undefined
              ? true
              : annotated.plivetDeclarationInfo.initialized,
          readOnly:
            annotated.plivetDeclarationInfo === undefined
              ? baseQualifiers.indexOf('const') !== -1
              : annotated.plivetDeclarationInfo.readOnly ||
                baseQualifiers.indexOf('const') !== -1,
        };
      }
      annotateVariable(
        child,
        enumTypes,
        recordTypes,
        declarationInfoAt,
        childAddress,
        displayAddresses,
        childEngineAddress
      );
      if (typeof field === 'undefined' && variable.type.indexOf('[') === -1) {
        engineChildCursor += Math.max(1, basicSizeof(child.type));
      }
    }
  }
}

/**
 * Names the function a pointer holds, and where that function sits.
 *
 * Its own walk rather than a branch inside `annotateVariable`, for the same
 * reason pointer values get one: the value is only meaningful once, at the end,
 * and the type is a synthetic `_fpN` that says nothing on its own.
 */
function annotateFunctionPointers(
  variable: Variable,
  functionPointerTypes: RuntimeFunctionPointerTypes,
  functionAt: FunctionLookup
): void {
  const value = variable.getValue();
  if (Array.isArray(value)) {
    for (const child of value) {
      annotateFunctionPointers(child, functionPointerTypes, functionAt);
    }
  }
  const match = /^([^[*]+)([\s\S]*)$/.exec(variable.type);
  const baseType = match === null ? variable.type : match[1].trim();
  const suffix = match === null ? '' : match[2];
  const info = functionPointerTypes[baseType];
  if (typeof info === 'undefined') {
    return;
  }
  const address =
    value === null || typeof value === 'undefined' || Array.isArray(value)
      ? null
      : Number(value.valueOf());
  (variable as VariableWithTypeInfo).plivetFunctionPointerInfo = {
    displayType: signatureOf(
      info.returnType,
      info.parameters,
      '*'.repeat(info.depth),
      suffix
    ),
    pointee: address === null ? null : functionAt(address),
  };
}

function uniqueQualifiers<T>(values: T[]): T[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function annotatePointerValues(
  variable: Variable,
  displayAddresses: Map<number, number>
): void {
  const value = variable.getValue();
  if (
    variable.type.indexOf('*') !== -1 &&
    value !== null &&
    typeof value !== 'undefined' &&
    !Array.isArray(value)
  ) {
    const numeric = Number(value.valueOf());
    const display = displayAddresses.get(numeric);
    (variable as VariableWithTypeInfo).plivetPointerValue =
      typeof display === 'undefined' ? numeric : display;
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      annotatePointerValues(child, displayAddresses);
    }
  }
}

function displayShapeOf(
  variable: Variable,
  recordTypes: RuntimeRecordTypes
): { size: number; alignment: number } {
  const match = /^([^[*]+)([\s\S]*)$/.exec(variable.type);
  const baseType = match === null ? variable.type : match[1].trim();
  const suffix = match === null ? '' : match[2];
  const record = recordTypes[baseType];
  if (typeof record !== 'undefined' && suffix === '') {
    return { size: record.size, alignment: record.alignment };
  }
  if (suffix.indexOf('*') !== -1 || variable.type.indexOf('*') !== -1) {
    return { size: 4, alignment: 4 };
  }
  const dimensions: number[] = [];
  const dimensionPattern = /\[(\d+)\]/g;
  let dimension = dimensionPattern.exec(variable.type);
  while (dimension !== null) {
    dimensions.push(Number(dimension[1]));
    dimension = dimensionPattern.exec(variable.type);
  }
  if (dimensions.length > 0) {
    const elementSize =
      typeof record === 'undefined' ? basicSizeof(baseType) : record.size;
    const alignment =
      typeof record === 'undefined'
        ? Math.max(1, Math.min(elementSize, 8))
        : record.alignment;
    return {
      size: dimensions.reduce((total, length) => total * length, elementSize),
      alignment,
    };
  }
  const value = variable.getValue();
  if (Array.isArray(value) && value.length > 0) {
    let size = 0;
    let alignment = 1;
    for (const child of value) {
      const childShape = displayShapeOf(child, recordTypes);
      size = alignAddress(size, childShape.alignment) + childShape.size;
      alignment = Math.max(alignment, childShape.alignment);
    }
    return { size: alignAddress(size, alignment), alignment };
  }
  const size = basicSizeof(baseType);
  return { size, alignment: Math.max(1, Math.min(size, 8)) };
}
