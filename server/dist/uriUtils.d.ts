/**
 * Conversión cross-platform entre file-system paths y URIs LSP.
 * Nunca usar uri.replace(/^file:\/\//, "") directamente — rompe en Windows.
 */
export declare function pathToUri(fsPath: string): string;
export declare function uriToPath(uri: string): string;
