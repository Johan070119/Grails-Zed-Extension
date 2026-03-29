/**
 * Conversión cross-platform entre file-system paths y URIs LSP.
 * Nunca usar uri.replace(/^file:\/\//, "") directamente — rompe en Windows.
 */

export function pathToUri(fsPath: string): string {
    if (process.platform === "win32") {
        // Normalizar barras y añadir barra extra para drive letters
        const normalized = fsPath.replace(/\\/g, "/");
        return "file:///" + normalized;
    }
    return "file://" + fsPath;
}

export function uriToPath(uri: string): string {
    if (uri.startsWith("file:///") && process.platform === "win32") {
        // file:///C:/foo → C:/foo
        return decodeURIComponent(uri.slice(8));
    }
    if (uri.startsWith("file://")) {
        return decodeURIComponent(uri.slice(7));
    }
    return uri;
}
