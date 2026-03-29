import { Location, TextDocumentPositionParams } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { GrailsProject } from "./grailsProject";
export declare function getDefinition(doc: TextDocument, params: TextDocumentPositionParams, project: GrailsProject | null): Location | null;
