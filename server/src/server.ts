#!/usr/bin/env node
/**
 * Grails Language Server — punto de entrada LSP.
 *
 * Se comunica con el editor (Zed, VS Code, Neovim, etc.) mediante
 * el protocolo LSP estándar vía stdio.
 *
 * NO importa nada de "vscode" — solo vscode-languageserver (protocolo puro).
 */

import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeParams,
    TextDocumentSyncKind,
    InitializeResult,
    CompletionParams,
    DefinitionParams,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";

import { GrailsIndexer } from "./indexer";
import { getCompletions } from "./completion";
import { getDefinition } from "./definition";

// ─── Conexión LSP ─────────────────────────────────────────────────────────────

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const indexer = new GrailsIndexer();

// ─── Inicialización ───────────────────────────────────────────────────────────

connection.onInitialize((params: InitializeParams): InitializeResult => {
    const folders = (params.workspaceFolders ?? []).map((f) =>
        decodeURIComponent(f.uri.replace(/^file:\/\//, "")),
    );

    // Indexar el proyecto en background (no bloquea la inicialización)
    setImmediate(() => indexer.initialize(folders));

    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,

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
        const filePath = decodeURIComponent(
            change.uri.replace(/^file:\/\//, ""),
        );
        if (filePath.endsWith(".groovy")) {
            indexer.onFileChanged(filePath);
        }
    }
});

// ─── Autocompletado ───────────────────────────────────────────────────────────

connection.onCompletion((params: CompletionParams) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    return getCompletions(doc, params, indexer.getProject());
});

// ─── Go-to-Definition ─────────────────────────────────────────────────────────

connection.onDefinition((params: DefinitionParams) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    return getDefinition(doc, params, indexer.getProject());
});

// ─── Arranque ─────────────────────────────────────────────────────────────────

documents.listen(connection);
connection.listen();
