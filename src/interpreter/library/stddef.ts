import { Scope } from 'unicoen.ts/dist/interpreter/Engine/Scope';
import { LibraryHost } from './host';
import { Memory, cInt } from './memory';

/**
 * `<stddef.h>`'s one macro that needs the engine: `offsetof(type, member)`.
 *
 * The preprocessor rewrites it to `offsetof("type", "member")` (see
 * `PREDEFINED` in `preprocess.ts`), because a type is not a value and the
 * call could not otherwise be made. The offset is the one the canvas draws
 * the member at, padding included, which is what `sizeof` and a real
 * compiler agree on. A member path (`offsetof(struct S, inner.x)`) is
 * followed one member at a time.
 */
export function installStddef(global: Scope, host: LibraryHost): void {
  const memory = new Memory(host);
  const text = (value: unknown, what: string): string =>
    String.fromCharCode(...memory.string(value, 'offsetof', what).bytes);

  global.setTop(
    'offsetof',
    (type: unknown, member: unknown) => {
      const record = text(type, 'its type')
        .replace(/^\s*(struct|union)\s+/, '')
        .trim();
      const path = text(member, 'its member').replace(/\s+/g, '');
      const offset = host.recordOffset(record, path);
      if (offset === null) {
        host.refuse(
          'offsetof-member',
          `offsetof names ${path}, which is not a member of ${record}`
        );
      }
      return cInt(offset);
    },
    'FUNCTION'
  );
}
