"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GrailsIndexer = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const grailsProject_1 = require("./grailsProject");
const DEBOUNCE_MS = 300;
class GrailsIndexer {
    constructor() {
        this.project = null;
        this.watchers = [];
        this.debounceTimer = null;
    }
    /**
     * Encuentra la raíz del proyecto Grails y construye el índice inicial.
     * Se llama desde onInitialize del servidor LSP.
     */
    initialize(workspaceFolders) {
        for (const folder of workspaceFolders) {
            const root = this.findGrailsRoot(folder);
            if (root) {
                process.stderr.write("[Grails] Project found at: " + root + "\n");
                this.index(root);
                this.watchProject(root);
                return;
            }
        }
        process.stderr.write("[Grails] No grails-app/ directory found in workspace.\n");
    }
    /** Devuelve el proyecto indexado o null si aún no hay proyecto. */
    getProject() {
        return this.project;
    }
    /** Fuerza una re-indexación (usable desde tests). */
    reindex() {
        if (this.project) {
            this.index(this.project.root);
        }
    }
    /** Detiene todos los watchers de archivo. */
    dispose() {
        for (const w of this.watchers) {
            try {
                w.close();
            }
            catch {
                /* ignorar */
            }
        }
        this.watchers = [];
        if (this.debounceTimer)
            clearTimeout(this.debounceTimer);
    }
    // ─── Internos ─────────────────────────────────────────────────────────────
    findGrailsRoot(folder) {
        const grailsApp = path.join(folder, "grails-app");
        if (fs.existsSync(grailsApp))
            return folder;
        // Buscar un nivel de profundidad (monorepos)
        if (!fs.existsSync(folder))
            return null;
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                const sub = path.join(folder, entry.name, "grails-app");
                if (fs.existsSync(sub))
                    return path.join(folder, entry.name);
            }
        }
        return null;
    }
    index(root) {
        try {
            this.project = (0, grailsProject_1.buildGrailsProject)(root);
            const p = this.project;
            process.stderr.write("[Grails] Indexed (v" +
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
                " taglibs\n");
        }
        catch (err) {
            process.stderr.write("[Grails] Indexing error: " + String(err) + "\n");
        }
    }
    watchProject(root) {
        const dirsToWatch = [
            path.join(root, "grails-app", "domain"),
            path.join(root, "grails-app", "controllers"),
            path.join(root, "grails-app", "services"),
            path.join(root, "grails-app", "taglib"),
            path.join(root, "src", "main", "groovy"),
        ];
        for (const dir of dirsToWatch) {
            if (!fs.existsSync(dir))
                continue;
            try {
                const w = fs.watch(dir, { recursive: true }, (_, filename) => {
                    if (!filename?.endsWith(".groovy"))
                        return;
                    this.onFileChanged(filename);
                });
                this.watchers.push(w);
            }
            catch {
                /* dir no soporta watch (ej. fs virtual) */
            }
        }
    }
    onFileChanged(changedPath) {
        if (this.debounceTimer)
            clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            process.stderr.write("[Grails] Re-indexing after change: " + changedPath + "\n");
            if (this.project)
                this.index(this.project.root);
        }, DEBOUNCE_MS);
    }
}
exports.GrailsIndexer = GrailsIndexer;
//# sourceMappingURL=indexer.js.map