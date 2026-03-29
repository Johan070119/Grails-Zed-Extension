import * as fs from "fs";
import * as path from "path";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface DomainProperty {
    name: string;
    type: string;
}

export interface DomainClass {
    name: string;
    filePath: string;
    properties: DomainProperty[];
    hasMany: Record<string, string>;
    belongsTo: Record<string, string>;
}

export interface GrailsArtifact {
    name: string; // "BookController"
    simpleName: string; // "book"
    filePath: string;
    kind: "controller" | "service" | "taglib" | "domain";
}

export type GrailsVersion = "2" | "3" | "4" | "5" | "6" | "7+" | "unknown";

export interface GrailsProject {
    root: string;
    version: GrailsVersion;
    domains: Map<string, DomainClass>;
    controllers: Map<string, GrailsArtifact>;
    services: Map<string, GrailsArtifact>;
    taglibs: Map<string, GrailsArtifact>;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const SKIP_FIELD_NAMES = new Set([
    "dateCreated",
    "lastUpdated",
    "version",
    "errors",
    "id",
    "metaClass",
    "class",
    "constraints",
    "mapping",
    "hasMany",
    "belongsTo",
    "hasOne",
    "namedQueries",
]);

const SKIP_TYPE_NAMES = new Set([
    "if",
    "static",
    "def",
    "void",
    "class",
    "interface",
    "enum",
    "return",
    "throw",
    "new",
    "import",
    "package",
    "final",
    "abstract",
    "private",
    "protected",
    "public",
    "try",
    "catch",
    "for",
    "while",
    "switch",
    "case",
    "default",
    "break",
    "continue",
    "else",
    "extends",
    "implements",
]);

// Captura "Tipo nombre" al inicio de línea (sin paréntesis después → no es método)
const PROPERTY_RE = /^\s{0,4}(\w[\w<>,\s]*?)\s+(\w+)\s*(?:=.*)?$/gm;

// ─── Detección de versión ─────────────────────────────────────────────────────

export function detectGrailsVersion(root: string): GrailsVersion {
    // 1. gradle.properties
    const gradleProps = path.join(root, "gradle.properties");
    if (fs.existsSync(gradleProps)) {
        const content = fs.readFileSync(gradleProps, "utf8");
        const m = content.match(/grailsVersion\s*=\s*(\d+)/);
        if (m) return toVersion(m[1]);
    }

    // 2. build.gradle / build.gradle.kts
    for (const buildFile of ["build.gradle", "build.gradle.kts"]) {
        const p = path.join(root, buildFile);
        if (fs.existsSync(p)) {
            const content = fs.readFileSync(p, "utf8");
            const m = content.match(/grails[Vv]ersion\s*[=:]\s*["']?(\d+)/);
            if (m) return toVersion(m[1]);
        }
    }

    // 3. application.properties (Grails 2)
    const appProps = path.join(root, "application.properties");
    if (fs.existsSync(appProps)) {
        const content = fs.readFileSync(appProps, "utf8");
        const m = content.match(/app\.grails\.version\s*=\s*(\d+)/);
        if (m) return toVersion(m[1]);
    }

    // 4. Presencia de BuildConfig.groovy → Grails 2
    if (
        fs.existsSync(
            path.join(root, "grails-app", "conf", "BuildConfig.groovy"),
        )
    ) {
        return "2";
    }

    return "unknown";
}

function toVersion(major: string): GrailsVersion {
    const n = parseInt(major, 10);
    if (n === 2) return "2";
    if (n === 3) return "3";
    if (n === 4) return "4";
    if (n === 5) return "5";
    if (n === 6) return "6";
    if (n >= 7) return "7+";
    return "unknown";
}

// ─── Heurística: ¿parece un domain class? ─────────────────────────────────────

function looksLikeDomainClass(filePath: string, src: string): boolean {
    if (filePath.includes("/domain/")) return true;
    if (/@Entity|@MappedEntity/.test(src)) return true;
    if (/static\s+constraints/.test(src)) return true;
    if (/static\s+mapping/.test(src)) return true;
    return false;
}

// ─── Parser de propiedades ────────────────────────────────────────────────────

function parseProperties(src: string): DomainProperty[] {
    const props: DomainProperty[] = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    PROPERTY_RE.lastIndex = 0;

    while ((m = PROPERTY_RE.exec(src)) !== null) {
        const type = m[1].trim();
        const name = m[2].trim();

        if (SKIP_FIELD_NAMES.has(name)) continue;
        if (SKIP_TYPE_NAMES.has(type)) continue;
        if (type.includes("(")) continue; // es una llamada de método
        if (seen.has(name)) continue;

        seen.add(name);
        props.push({ name, type });
    }

    return props;
}

function parseHasMany(src: string): Record<string, string> {
    const result: Record<string, string> = {};
    const m = src.match(/static\s+hasMany\s*=\s*\[([^\]]+)\]/);
    if (!m) return result;
    const entries = m[1].matchAll(/(\w+)\s*:\s*(\w+)/g);
    for (const e of entries) result[e[1]] = e[2];
    return result;
}

function parseBelongsTo(src: string): Record<string, string> {
    const result: Record<string, string> = {};
    const m = src.match(/static\s+belongsTo\s*=\s*\[([^\]]+)\]/);
    if (!m) return result;
    const entries = m[1].matchAll(/(\w+)\s*:\s*(\w+)/g);
    for (const e of entries) result[e[1]] = e[2];
    return result;
}

// ─── Escaneo de directorios ───────────────────────────────────────────────────

function scanDir(
    dir: string,
    cb: (filePath: string, name: string) => void,
): void {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            scanDir(full, cb);
        } else if (entry.isFile() && entry.name.endsWith(".groovy")) {
            cb(full, entry.name.replace(/\.groovy$/, ""));
        }
    }
}

function simpleName(artifactName: string, suffix: string): string {
    return artifactName.endsWith(suffix)
        ? artifactName.slice(0, -suffix.length).toLowerCase()
        : artifactName.toLowerCase();
}

// ─── Constructor principal ────────────────────────────────────────────────────

export function buildGrailsProject(root: string): GrailsProject {
    const version = detectGrailsVersion(root);

    const project: GrailsProject = {
        root,
        version,
        domains: new Map(),
        controllers: new Map(),
        services: new Map(),
        taglibs: new Map(),
    };

    // Dominios
    const domainDirs = [
        path.join(root, "grails-app", "domain"),
        path.join(root, "grails-app", "utils"),
    ];
    if (version !== "2") {
        domainDirs.push(path.join(root, "src", "main", "groovy"));
    }

    for (const dir of domainDirs) {
        scanDir(dir, (filePath, name) => {
            try {
                const src = fs.readFileSync(filePath, "utf8");
                if (
                    dir.endsWith("main/groovy") &&
                    !looksLikeDomainClass(filePath, src)
                )
                    return;
                project.domains.set(name, {
                    name,
                    filePath,
                    properties: parseProperties(src),
                    hasMany: parseHasMany(src),
                    belongsTo: parseBelongsTo(src),
                });
            } catch {
                /* ignorar archivos ilegibles */
            }
        });
    }

    // Controllers
    scanDir(path.join(root, "grails-app", "controllers"), (filePath, name) => {
        project.controllers.set(name, {
            name,
            simpleName: simpleName(name, "Controller"),
            filePath,
            kind: "controller",
        });
    });

    // Services
    scanDir(path.join(root, "grails-app", "services"), (filePath, name) => {
        project.services.set(name, {
            name,
            simpleName: simpleName(name, "Service"),
            filePath,
            kind: "service",
        });
    });

    // TagLibs
    const taglibDir = path.join(root, "grails-app", "taglib");
    if (fs.existsSync(taglibDir)) {
        scanDir(taglibDir, (filePath, name) => {
            project.taglibs.set(name, {
                name,
                simpleName: simpleName(name, "TagLib"),
                filePath,
                kind: "taglib",
            });
        });
    }

    return project;
}
