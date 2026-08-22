import type { SourceFile } from '../core';

/**
 * One immutable view of the program a host can compile, save or submit.
 *
 * `revision` changes whenever a file, the entry file or the set of open files
 * changes. A remote compiler can return it with its answer so a slow result is
 * never painted over newer source.
 */
export interface SourceSnapshot {
  files: SourceFile[];
  entry: string;
  active: string;
  revision: number;
}

/** A zero-based position in one source file; `to` positions are exclusive. */
export interface SourcePosition {
  line: number;
  column: number;
}

/**
 * A compiler finding after the host has translated its service's JSON.
 *
 * This deliberately does not expose GCC's wire format. A+ owns that endpoint
 * and maps any temporary compiler path back to the `SourceFile.path` it sent;
 * PLIVET only needs the stable fact that can be drawn in an editor.
 */
export interface ExternalDiagnostic {
  path: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  /** The compiler option or diagnostic id, for example `-Wunused-variable`. */
  code?: string;
  from: SourcePosition;
  to: SourcePosition;
}

/** Correlates a remote answer with the source it compiled. */
export interface DiagnosticOptions {
  revision?: number;
}

/** A host service that compiles one complete source snapshot. */
export type DiagnosticProvider = (
  snapshot: SourceSnapshot
) => ExternalDiagnostic[] | Promise<ExternalDiagnostic[]>;

/** Stops a callback registered on one visualizer instance. */
export type Unsubscribe = () => void;
