import { RuntimeDeclarationInfo } from '../interpreter/DeclarationSpecifiers';

/**
 * Spells the declaration back the way it was written: storage classes and
 * qualifiers in front of the type, and each pointer level's own qualifiers
 * after its star.
 */
export function qualifiedDisplayType(
  displayType: string,
  declaration: RuntimeDeclarationInfo | null
): string {
  if (declaration === null) {
    return displayType;
  }
  // Only the trailing run counts. A function pointer spells its own star
  // inside the declarator - `int (*)(int, int)` - and appending another would
  // make it a pointer to a function pointer.
  const trailing = /\s*(\*+)\s*$/.exec(displayType);
  const stars = trailing === null ? 0 : trailing[1].length;
  // `declaredType` is the type the reader wrote where the source pass had to
  // reduce it for the mapper: the engine holds a `long` and the declaration
  // said `long long`, and the canvas has no business repeating the
  // compromise. Absent for every type that reached the mapper as written.
  const baseType =
    declaration.declaredType ?? displayType.replace(/\s*\*+\s*$/, '').trim();
  let baseQualifiers =
    declaration.baseQualifiers === undefined
      ? declaration.qualifiers
      : declaration.baseQualifiers;
  if (
    stars === 0 &&
    baseQualifiers.length === 0 &&
    (declaration.pointerQualifiers || []).length > 0
  ) {
    // A qualifier applied to a pointer typedef is spelled before the alias
    // even though semantically it binds the typedef's outer pointer.
    baseQualifiers = declaration.qualifiers;
  }
  let result = [
    ...declaration.storageClasses,
    ...baseQualifiers,
    baseType,
  ].join(' ');
  const pointerQualifiers = declaration.pointerQualifiers || [];
  for (let level = 0; level < stars; level += 1) {
    result += ' *';
    const qualifiers = pointerQualifiers[level] || [];
    if (qualifiers.length > 0) {
      result += ` ${qualifiers.join(' ')}`;
    }
  }
  return result;
}
