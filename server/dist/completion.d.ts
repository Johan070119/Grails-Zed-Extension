import { CompletionItem, TextDocumentPositionParams } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { GrailsProject } from "./grailsProject";
export declare function getCompletions(doc: TextDocument, params: TextDocumentPositionParams, project: GrailsProject | null): CompletionItem[];
