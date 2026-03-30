import {
    createConnection,
    ProposedFeatures,
    TextDocuments,
    TextDocumentSyncKind,
    InitializeParams,
    InitializeResult,
    CompletionItem,
    TextDocumentPositionParams,
    DidChangeWatchedFilesParams,
    FileChangeType,
    Location,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { GrailsIndexer } from "./indexer";
import { getCompletions } from "./completion";
import { getDefinition } from "./definition";
import { uriToPath } from "./uriUtils";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const indexer = new GrailsIndexer(connection);

// ─── Initialize ───────────────────────────────────────────────────────────────

connection.onInitialize((params: InitializeParams): InitializeResult => {
    const folders = params.workspaceFolders?.map((f) => uriToPath(f.uri)) ?? [];

    if (folders.length > 0) {
        indexer.initialize(folders);
    } else if (params.rootUri) {
        indexer.initialize([uriToPath(params.rootUri)]);
    } else if (params.rootPath) {
        indexer.initialize([params.rootPath]);
    }

    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: {
                resolveProvider: false,
                // Trigger on structural chars + uppercase letters (for domain/class names)
                // Uppercase letters trigger completion for "def x = Fu" → Fusion, etc.
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
            },
            definitionProvider: true,
            workspace: {
                workspaceFolders: { supported: true },
            },
        },
        serverInfo: {
            name: "Grails Language Server",
            version: "1.0.0",
        },
    };
});

// ─── Completions ──────────────────────────────────────────────────────────────

connection.onCompletion(
    (params: TextDocumentPositionParams): CompletionItem[] => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return [];

        const project = indexer.getProject();
        return getCompletions(doc, params, project);
    },
);

// ─── Go to Definition ─────────────────────────────────────────────────────────

connection.onDefinition(
    (params: TextDocumentPositionParams): Location | null => {
        const doc = documents.get(params.textDocument.uri);
        if (!doc) return null;
        return getDefinition(doc, params, indexer.getProject());
    },
);

// ─── File watching ────────────────────────────────────────────────────────────

connection.onDidChangeWatchedFiles((params: DidChangeWatchedFilesParams) => {
    for (const change of params.changes) {
        if (change.type !== FileChangeType.Deleted) {
            indexer.onFileChanged(uriToPath(change.uri));
        }
    }
});

// ─── Lifecycle ────────────────────────────────────────────────────────────────

connection.onShutdown(() => {
    indexer.dispose();
});

documents.listen(connection);
connection.listen();
