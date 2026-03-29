import * as fs from "fs";
import * as path from "path";
import { buildGrailsProject, GrailsProject } from "./grailsProject";

const DEBOUNCE_MS = 300;

export class GrailsIndexer {
    private project: GrailsProject | null = null;
    private watchers: fs.FSWatcher[] = [];
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * Encuentra la raíz del proyecto Grails y construye el índice inicial.
     * Se llama desde onInitialize del servidor LSP.
     */
    initialize(workspaceFolders: string[]): void {
        for (const folder of workspaceFolders) {
            const root = this.findGrailsRoot(folder);
            if (root) {
                process.stderr.write(
                    "[Grails] Project found at: " + root + "\n",
                );
                this.index(root);
                this.watchProject(root);
                return;
            }
        }
        process.stderr.write(
            "[Grails] No grails-app/ directory found in workspace.\n",
        );
    }

    /** Devuelve el proyecto indexado o null si aún no hay proyecto. */
    getProject(): GrailsProject | null {
        return this.project;
    }

    /** Fuerza una re-indexación (usable desde tests). */
    reindex(): void {
        if (this.project) {
            this.index(this.project.root);
        }
    }

    /** Detiene todos los watchers de archivo. */
    dispose(): void {
        for (const w of this.watchers) {
            try {
                w.close();
            } catch {
                /* ignorar */
            }
        }
        this.watchers = [];
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
    }

    // ─── Internos ─────────────────────────────────────────────────────────────

    private findGrailsRoot(folder: string): string | null {
        const grailsApp = path.join(folder, "grails-app");
        if (fs.existsSync(grailsApp)) return folder;

        // Buscar un nivel de profundidad (monorepos)
        if (!fs.existsSync(folder)) return null;
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                const sub = path.join(folder, entry.name, "grails-app");
                if (fs.existsSync(sub)) return path.join(folder, entry.name);
            }
        }
        return null;
    }

    private index(root: string): void {
        try {
            this.project = buildGrailsProject(root);
            const p = this.project;
            process.stderr.write(
                "[Grails] Indexed (v" +
                    p.version +
                    ")" +
                    " — " +
                    p.domains.size +
                    " domains" +
                    ", " +
                    p.controllers.size +
                    " controllers" +
                    ", " +
                    p.services.size +
                    " services" +
                    ", " +
                    p.taglibs.size +
                    " taglibs\n",
            );
        } catch (err) {
            process.stderr.write(
                "[Grails] Indexing error: " + String(err) + "\n",
            );
        }
    }

    private watchProject(root: string): void {
        const dirsToWatch = [
            path.join(root, "grails-app", "domain"),
            path.join(root, "grails-app", "controllers"),
            path.join(root, "grails-app", "services"),
            path.join(root, "grails-app", "taglib"),
            path.join(root, "src", "main", "groovy"),
        ];

        for (const dir of dirsToWatch) {
            if (!fs.existsSync(dir)) continue;
            try {
                const w = fs.watch(dir, { recursive: true }, (_, filename) => {
                    if (!filename?.endsWith(".groovy")) return;
                    this.onFileChanged(filename);
                });
                this.watchers.push(w);
            } catch {
                /* dir no soporta watch (ej. fs virtual) */
            }
        }
    }

    onFileChanged(changedPath: string): void {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            process.stderr.write(
                "[Grails] Re-indexing after change: " + changedPath + "\n",
            );
            if (this.project) this.index(this.project.root);
        }, DEBOUNCE_MS);
    }
}
