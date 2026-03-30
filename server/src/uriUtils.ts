import * as path from "path";

/**
 * Cross-platform URI utilities.
 *
 * The LSP protocol uses RFC-3986 file URIs:
 *   Linux/Mac:  file:///home/user/project/Foo.groovy
 *   Windows:    file:///C:/Users/user/project/Foo.groovy
 *
 * Common bugs:
 *   - Using `file://` (double slash) instead of `file:///` (triple slash)
 *     works on Linux by coincidence but breaks on Mac and Windows.
 *   - `uri.replace(/^file:\/\//, "")` strips 2 slashes, leaving `/path` on
 *     Unix (works) but `C:/path` on Windows after stripping 3 slashes (wrong).
 *
 * These helpers centralise conversion so every file always round-trips correctly.
 */

/**
 * Convert an absolute filesystem path to an LSP file URI.
 * Works on Linux, Mac, and Windows.
 */
export function pathToUri(fsPath: string): string {
    // Normalize separators to forward-slash
    const normalized = fsPath.replace(/\\/g, "/");
    // On Windows "C:/foo" → "file:///C:/foo"
    // On Unix   "/foo"   → "file:///foo"  (three slashes: scheme + empty host + path)
    if (normalized.startsWith("/")) {
        return `file://${normalized}`; // file:// + /path  =  file:///path
    }
    return `file:///${normalized}`; // Windows drive letter
}

/**
 * Convert an LSP file URI back to an absolute filesystem path.
 * Handles both double-slash and triple-slash variants robustly.
 */
export function uriToPath(uri: string): string {
    if (!uri.startsWith("file://")) return uri;

    // Remove the scheme
    let p = uri.slice("file://".length);

    // On Windows the URI is file:///C:/... → after removing "file://" we get "/C:/..."
    // We must strip that leading slash for Windows paths only.
    // Detection: second char is ':' means it's a Windows drive letter (e.g. /C:/foo)
    if (p.length >= 3 && p[0] === "/" && p[2] === ":") {
        p = p.slice(1); // "/C:/foo" → "C:/foo"
    }

    // Decode percent-encoded characters (spaces → %20, etc.)
    try {
        p = decodeURIComponent(p);
    } catch {
        /* keep as-is */
    }

    // Normalize to OS-native separators
    return path.normalize(p);
}

/**
 * Build a Location object using a proper file URI.
 */
export function makeLocation(
    fsPath: string,
    line = 0,
    character = 0,
): {
    uri: string;
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
} {
    return {
        uri: pathToUri(fsPath),
        range: {
            start: { line, character },
            end: { line, character },
        },
    };
}
