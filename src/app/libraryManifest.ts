import { REFUSED_CONSTRUCTS } from '../interpreter/refused';
import type { RefusedConstructId } from '../interpreter/refused';
import { libraryHelp, libraryNames } from './libraryHelp';

/**
 * `library.json`: what a C program in the visualizer may use and may not
 * write, for a host that never runs the interpreter.
 *
 * The course build's lint reads it (course-lint rules 8 and 9 of the Sphinx
 * extensions): a visualized block may call only what `functions` and the
 * function-like `macros` list, besides the functions its own files define,
 * and may contain none of the `refused` constructs. A bundle rebuild is what
 * moves a new library function from "exists in the visualizer" to "allowed
 * in a visualized block".
 *
 * Generated, never edited: from the library table (`libraryHelp.ts`) and the
 * refused-construct list (`interpreter/refused.ts`). `npm run deploy` and
 * `npm run deploy:debug` write it beside the loader through
 * `scripts/library-manifest.js`, which runs this module in Node.
 *
 * Every list is sorted by name (by `id` for `refused`) in code-point order,
 * so a rebuild that adds nothing writes the same file byte for byte.
 */

/**
 * Changes only when a field changes meaning or is removed. Adding an entry,
 * a list or a field keeps it; a consumer reads the fields it knows and
 * ignores the rest.
 */
export const LIBRARY_MANIFEST_VERSION = 1;

/** A function the library defines. */
export interface ManifestFunction {
  name: string;
  /** The header that declares it, `stdio.h`. */
  header: string;
  /** Its prototype as C writes it. */
  signature: string;
}

/** A macro: `EOF`, or one called like a function, `assert(x)`. */
export interface ManifestMacro {
  name: string;
  header: string;
  /** `#define EOF (-1)` for an object-like macro; a prototype-like form for a function-like one. */
  signature: string;
  /** Whether it is written with arguments, as a call. */
  functionLike: boolean;
}

/** An object the library declares: `stdin`, `errno`. */
export interface ManifestObject {
  name: string;
  header: string;
  /** Its declaration, `FILE* stdin`. */
  signature: string;
}

/** A type the library declares: `size_t`, `FILE`. */
export interface ManifestType {
  name: string;
  header: string;
  /** Its definition, `typedef unsigned long size_t`. */
  signature: string;
}

/** A construct the interpreter refuses; see `interpreter/refused.ts`. */
export interface ManifestRefused {
  id: RefusedConstructId;
  construct: string;
  /** A regular expression valid in JavaScript and Python alike, no flags. */
  pattern: string;
  message: string;
}

export interface LibraryManifest {
  version: number;
  functions: ManifestFunction[];
  macros: ManifestMacro[];
  objects: ManifestObject[];
  types: ManifestType[];
  refused: ManifestRefused[];
}

/** Code-point order, the same in every locale and in Python's `sorted`. */
const byKey =
  <T>(key: (item: T) => string) =>
  (left: T, right: T): number => {
    const a = key(left);
    const b = key(right);
    return a < b ? -1 : a > b ? 1 : 0;
  };

const byName = byKey((item: { name: string }) => item.name);

/** The manifest, from the library table and the refused-construct list. */
export function libraryManifest(): LibraryManifest {
  const manifest: LibraryManifest = {
    version: LIBRARY_MANIFEST_VERSION,
    functions: [],
    macros: [],
    objects: [],
    types: [],
    refused: [],
  };
  for (const name of libraryNames()) {
    const entry = libraryHelp(name)!;
    if (entry.kind === 'operator') {
      continue;
    }
    if (typeof entry.header === 'undefined') {
      throw new Error(`the library entry ${name} names no header`);
    }
    const listed = { name, header: entry.header, signature: entry.signature };
    switch (entry.kind) {
      case 'macro':
        manifest.macros.push({
          ...listed,
          functionLike: entry.functionLike === true,
        });
        break;
      case 'object':
        manifest.objects.push(listed);
        break;
      case 'type':
        manifest.types.push(listed);
        break;
      default:
        manifest.functions.push(listed);
    }
  }
  manifest.functions.sort(byName);
  manifest.macros.sort(byName);
  manifest.objects.sort(byName);
  manifest.types.sort(byName);
  manifest.refused = REFUSED_CONSTRUCTS.map(
    ({ id, construct, pattern, message }) => ({
      id,
      construct,
      pattern,
      message,
    })
  ).sort(byKey((item) => item.id));
  return manifest;
}

/** The file as the deploy writes it: two-space JSON and a final newline. */
export function libraryManifestText(): string {
  return `${JSON.stringify(libraryManifest(), null, 2)}\n`;
}
