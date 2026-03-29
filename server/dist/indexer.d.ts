import { GrailsProject } from "./grailsProject";
export declare class GrailsIndexer {
    private project;
    private watchers;
    private debounceTimer;
    /**
     * Encuentra la raíz del proyecto Grails y construye el índice inicial.
     * Se llama desde onInitialize del servidor LSP.
     */
    initialize(workspaceFolders: string[]): void;
    /** Devuelve el proyecto indexado o null si aún no hay proyecto. */
    getProject(): GrailsProject | null;
    /** Fuerza una re-indexación (usable desde tests). */
    reindex(): void;
    /** Detiene todos los watchers de archivo. */
    dispose(): void;
    private findGrailsRoot;
    private index;
    private watchProject;
    onFileChanged(changedPath: string): void;
}
