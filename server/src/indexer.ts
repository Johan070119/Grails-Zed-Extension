import * as fs from "fs";
import * as path from "path";
import { Connection } from "vscode-languageserver/node";
import {
    GrailsProject,
    GrailsVersion,
    buildGrailsProject,
    findGrailsRoot,
    isGrailsProject,
} from "./grailsProject";

export class GrailsIndexer {
    private project: GrailsProject | null = null;
    private watchers: fs.FSWatcher[] = [];
    private connection: Connection;
    private rebuildTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(connection: Connection) {
        this.connection = connection;
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    initialize(workspaceFolders: string[]): void {
        for (const folder of workspaceFolders) {
            const root = isGrailsProject(folder)
                ? folder
                : findGrailsRoot(folder);
            if (root) {
                this.connection.console.log(
                    `[Grails] Project found at: ${root}`,
                );
                this.index(root);
                this.watchProject(root);
                return;
            }
        }
        this.connection.console.log(
            "[Grails] No Grails project found in workspace.",
        );
    }

    onFileChanged(changedPath: string): void {
        if (!this.project) return;
        if (!changedPath.endsWith(".groovy")) return;

        if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
        this.rebuildTimer = setTimeout(() => {
            this.connection.console.log(
                `[Grails] Re-indexing after change: ${path.basename(changedPath)}`,
            );
            this.index(this.project!.root);
        }, 300);
    }

    getProject(): GrailsProject | null {
        return this.project;
    }

    dispose(): void {
        for (const w of this.watchers) {
            try {
                w.close();
            } catch {}
        }
        this.watchers = [];
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    private index(root: string): void {
        try {
            this.project = buildGrailsProject(root);
            this.logStats();
        } catch (e) {
            this.connection.console.error(`[Grails] Indexing error: ${e}`);
        }
    }

    private logStats(): void {
        if (!this.project) return;
        const { domains, controllers, services, taglibs, version } =
            this.project;
        this.connection.console.log(
            `[Grails] Indexed (v${version}) — ` +
                `${domains.size} domains, ${controllers.size} controllers, ` +
                `${services.size} services, ${taglibs.size} taglibs`,
        );
    }

    /**
     * Watch directories for .groovy changes.
     * Grails 2:  only grails-app subdirs
     * Grails 3+: also src/main/groovy (may contain domain classes)
     */
    private watchProject(root: string): void {
        const version: GrailsVersion = this.project?.version ?? "unknown";

        const dirsToWatch = [
            "grails-app/domain",
            "grails-app/controllers",
            "grails-app/services",
            "grails-app/taglib",
        ];

        // Grails 3+ additional source dirs
        if (version !== "2") {
            dirsToWatch.push("src/main/groovy");
        }

        for (const rel of dirsToWatch) {
            const dir = path.join(root, rel);
            if (!fs.existsSync(dir)) continue;
            try {
                const watcher = fs.watch(
                    dir,
                    { recursive: true },
                    (_event, filename) => {
                        if (filename?.endsWith(".groovy")) {
                            this.onFileChanged(path.join(dir, filename));
                        }
                    },
                );
                this.watchers.push(watcher);
            } catch {
                // fs.watch with recursive:true not supported on all platforms
                // (notably Linux requires inotify). Fail silently.
            }
        }
    }
}
