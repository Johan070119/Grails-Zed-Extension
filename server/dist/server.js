#!/usr/bin/env node
"use strict";
/**
 * Grails Language Server — punto de entrada LSP.
 *
 * Se comunica con el editor (Zed, VS Code, Neovim, etc.) mediante
 * el protocolo LSP estándar vía stdio.
 *
 * NO importa nada de "vscode" — solo vscode-languageserver (protocolo puro).
 */
Object.defineProperty(exports, "__esModule", { value: true });
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const indexer_1 = require("./indexer");
const completion_1 = require("./completion");
const definition_1 = require("./definition");
// ─── Conexión LSP ─────────────────────────────────────────────────────────────
const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
const documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
const indexer = new indexer_1.GrailsIndexer();
// ─── Inicialización ───────────────────────────────────────────────────────────
connection.onInitialize((params) => {
    const folders = (params.workspaceFolders ?? []).map((f) => decodeURIComponent(f.uri.replace(/^file:\/\//, "")));
    // Indexar el proyecto en background (no bloquea la inicialización)
    setImmediate(() => indexer.initialize(folders));
    return {
        capabilities: {
            textDocumentSync: node_1.TextDocumentSyncKind.Incremental,
            // Autocompletado — caracteres trigger:
            //   "."  → instancias / métodos / propiedades
            //   "("  → parámetros
            //   ":"  → named args (view:, model:, action:)
            //   A–Z  → nombres de clase (artefactos Grails)
            completionProvider: {
                triggerCharacters: [
                    ".",
                    "(",
                    ":",
                    "A",
                    "B",
                    "C",
                    "D",
                    "E",
                    "F",
                    "G",
                    "H",
                    "I",
                    "J",
                    "K",
                    "L",
                    "M",
                    "N",
                    "O",
                    "P",
                    "Q",
                    "R",
                    "S",
                    "T",
                    "U",
                    "V",
                    "W",
                    "X",
                    "Y",
                    "Z",
                ],
                resolveProvider: false,
            },
            // Go-to-Definition (Ctrl+Click en Zed)
            definitionProvider: true,
        },
    };
});
connection.onInitialized(() => {
    process.stderr.write("[Grails] Language server initialized.\n");
});
connection.onShutdown(() => {
    indexer.dispose();
});
// ─── Notificaciones de cambio de archivo ─────────────────────────────────────
connection.onDidChangeWatchedFiles((params) => {
    for (const change of params.changes) {
        const filePath = decodeURIComponent(change.uri.replace(/^file:\/\//, ""));
        if (filePath.endsWith(".groovy")) {
            indexer.onFileChanged(filePath);
        }
    }
});
// ─── Autocompletado ───────────────────────────────────────────────────────────
connection.onCompletion((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc)
        return [];
    return (0, completion_1.getCompletions)(doc, params, indexer.getProject());
});
// ─── Go-to-Definition ─────────────────────────────────────────────────────────
connection.onDefinition((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc)
        return null;
    return (0, definition_1.getDefinition)(doc, params, indexer.getProject());
});
// ─── Arranque ─────────────────────────────────────────────────────────────────
documents.listen(connection);
connection.listen();
//# sourceMappingURL=server.js.map