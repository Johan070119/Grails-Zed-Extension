import * as fs from "fs";
import * as path from "path";

export interface DomainClass {
    name: string;
    filePath: string;
    properties: DomainProperty[];
    hasMany: Record<string, string>;
    belongsTo: Record<string, string>;
}

export interface DomainProperty {
    name: string;
    type: string;
}

export interface GrailsArtifact {
    name: string;
    simpleName: string;
    filePath: string;
    kind: "controller" | "service" | "taglib" | "domain";
}

export interface GrailsProject {
    root: string;
    version: GrailsVersion;
    domains: Map<string, DomainClass>;
    controllers: Map<string, GrailsArtifact>;
    services: Map<string, GrailsArtifact>;
    taglibs: Map<string, GrailsArtifact>;
}

// ─── Version detection ────────────────────────────────────────────────────────

export type GrailsVersion = "2" | "3" | "4" | "5" | "6" | "7+" | "unknown";

/**
 * Detects the Grails major version from project files.
 *
 * Priority order:
 *   1. gradle.properties → grailsVersion=X.Y.Z  (most reliable for 3+)
 *   2. build.gradle / build.gradle.kts           (Kotlin DSL support for 6+)
 *   3. application.properties                    (Grails 2 style)
 *   4. Presence of BuildConfig.groovy            (definitive Grails 2 marker)
 *
 * Structural facts used later for scanning:
 *   Grails 2:  no build.gradle, has BuildConfig.groovy, has web-app/
 *   Grails 3+: has build.gradle, uses gradle.properties, has src/main/groovy/
 *   Grails 6+: may use build.gradle.kts, Jakarta EE (javax→jakarta)
 *   Grails 7+: may use settings.gradle.kts, Groovy 4
 */
/**
 * Extracts the major version number from a version string like "4.0.1", "7.0.0-SNAPSHOT".
 * Returns null if not parseable.
 */
function parseMajorVersion(versionStr: string): GrailsVersion | null {
    const major = parseInt(versionStr);
    if (isNaN(major)) return null;
    if (major >= 7) return "7+";
    if (major === 6) return "6";
    if (major === 5) return "5";
    if (major === 4) return "4";
    if (major === 3) return "3";
    if (major === 2) return "2";
    return null;
}

export function detectGrailsVersion(root: string): GrailsVersion {
    // ── 1. gradle.properties ────────────────────────────────────────────────
    // Most reliable source for Grails 3+. Examples found in real projects:
    //   grailsVersion=4.0.1
    //   grailsVersion=5.3.2
    //   grailsVersion=6.1.0
    //   grailsVersion=7.0.0-SNAPSHOT
    const gradleProps = path.join(root, "gradle.properties");
    if (fs.existsSync(gradleProps)) {
        const content = readFileSafe(gradleProps);
        // Match "grailsVersion=X" or "grailsVersion = X" — value ends at newline or whitespace
        const match = /grailsVersion\s*=\s*([\d]+)/.exec(content);
        if (match) {
            const v = parseMajorVersion(match[1]);
            if (v) return v;
        }
    }

    // ── 2. build.gradle / build.gradle.kts ──────────────────────────────────
    // Grails 3–7+ use Gradle. Version can appear in multiple forms:
    //
    // Groovy DSL (build.gradle):
    //   grailsVersion = "4.0.1"
    //   id "org.grails.grails-web" version "4.0.1"
    //   implementation "org.grails:grails-core:4.0.1"
    //
    // Kotlin DSL (build.gradle.kts) — used in some Grails 6+/7+ projects:
    //   val grailsVersion by extra("6.1.0")
    //   id("org.grails.grails-web") version "6.1.0"
    //   implementation("org.grails:grails-core:6.1.0")
    for (const buildFile of ["build.gradle", "build.gradle.kts"]) {
        const buildPath = path.join(root, buildFile);
        if (!fs.existsSync(buildPath)) continue;
        const content = readFileSafe(buildPath);

        // Try multiple patterns, most specific first
        const patterns = [
            // Plugin version: id "org.grails.grails-web" version "4.0.1"
            /org\.grails[.\w-]+["\s]+version\s+["']([\d]+)/,
            // Direct variable: grailsVersion = "4.0.1" or grailsVersion: "4.0.1"
            /grailsVersion\s*[=:]\s*["']([\d]+)/,
            // Kotlin extra: val grailsVersion by extra("4.0.1")
            /grailsVersion.*extra.*["']([\d]+)/,
            // Dependency: grails-core:4.0.1
            /grails-core['":\s]+([\d]+)/,
            // Grails BOM: org.grails:grails-bom:4.0.1
            /grails-bom['":\s]+([\d]+)/,
        ];

        for (const pattern of patterns) {
            const m = pattern.exec(content);
            if (m) {
                const v = parseMajorVersion(m[1]);
                if (v) return v;
            }
        }

        // Has a build.gradle but couldn't determine version — assume Grails 3+
        // (any Grails project using Gradle is at minimum version 3)
        return "3";
    }

    // ── 3. Grails 2 markers ──────────────────────────────────────────────────
    // Grails 2 does not use Gradle — it has its own build system
    if (fs.existsSync(path.join(root, "grails-app/conf/BuildConfig.groovy")))
        return "2";
    const appProps = path.join(root, "application.properties");
    if (fs.existsSync(appProps)) {
        const content = readFileSafe(appProps);
        const match = /app\.grails\.version\s*=\s*(\d+)/.exec(content);
        if (match) {
            const v = parseMajorVersion(match[1]);
            return v ?? "2";
        }
        if (content.includes("app.grails.version")) return "2";
    }

    return "unknown";
}

function readFileSafe(filePath: string): string {
    try {
        return fs.readFileSync(filePath, "utf8");
    } catch {
        return "";
    }
}

// ─── Detection ────────────────────────────────────────────────────────────────

export function isGrailsProject(root: string): boolean {
    return fs.existsSync(path.join(root, "grails-app"));
}

export function findGrailsRoot(startPath: string): string | null {
    let current = startPath;
    for (let i = 0; i < 10; i++) {
        if (isGrailsProject(current)) return current;
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return null;
}

// ─── Scan directories by version ─────────────────────────────────────────────

/**
 * Returns candidate directories for each artifact type based on Grails version.
 *
 * Grails 2:
 *   domain      → grails-app/domain
 *   controllers → grails-app/controllers
 *   services    → grails-app/services
 *   taglib      → grails-app/taglib
 *
 * Grails 3+:
 *   Same as above, PLUS src/main/groovy for domain-like classes.
 *   Some projects put POGOs with @Entity or static constraints in src/main/groovy.
 *
 * Grails 4+ (GORM 7+):
 *   Same, but also checks for @MappedEntity annotation in src/main/groovy.
 *
 * Grails 6+ (Jakarta EE):
 *   Same structure, but import paths change (javax → jakarta).
 *   No structural difference for our scanner.
 */
function domainScanDirs(root: string, version: GrailsVersion): string[] {
    const dirs = [path.join(root, "grails-app/domain")];

    // grails-app/utils — common in older projects for shared domain-like classes
    // These are scanned always; looksLikeDomainClass() filters non-domain files
    dirs.push(path.join(root, "grails-app/utils"));

    if (version !== "2") {
        // Grails 3+: domain-annotated classes can live in src/main/groovy
        dirs.push(path.join(root, "src/main/groovy"));
    }
    return dirs;
}

function controllerScanDirs(root: string): string[] {
    return [path.join(root, "grails-app/controllers")];
}

function serviceScanDirs(root: string): string[] {
    return [path.join(root, "grails-app/services")];
}

function taglibScanDirs(root: string): string[] {
    return [path.join(root, "grails-app/taglib")];
}

// ─── File scanning ────────────────────────────────────────────────────────────

function scanGroovyFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const results: string[] = [];
    try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                // Skip build artifacts and generated code
                if (
                    [
                        "build",
                        ".gradle",
                        "out",
                        "target",
                        "node_modules",
                        ".git",
                    ].includes(entry.name)
                )
                    continue;
                results.push(...scanGroovyFiles(full));
            } else if (entry.isFile() && entry.name.endsWith(".groovy")) {
                results.push(full);
            }
        }
    } catch {
        /* permission error — skip */
    }
    return results;
}

// ─── Domain class parsing ─────────────────────────────────────────────────────

/**
 * Property type regex — covers all common types across Grails 2–7+:
 *
 * Primitive wrappers:    String, Integer, Long, Double, Float, Boolean, Byte
 * Primitives:            int, long, double, float, boolean, byte
 * Date/Time (Grails 2+): Date
 * Date/Time (Grails 3+): LocalDate, LocalDateTime, ZonedDateTime, OffsetDateTime, Instant
 * Numeric:               BigDecimal, BigInteger
 * Binary:                byte[], Byte[]
 * Identity (GORM 7+):    UUID  (also used as id type in Grails 3+)
 * Custom domain classes: Any capitalized class name (e.g. "Area padre", "User owner")
 *
 * Excludes method declarations by requiring no '(' after the field name.
 */
const PROPERTY_RE = new RegExp(
    "^\\s+" +
        "(String|Integer|int|Long|long|Double|double|Float|float|" +
        "Boolean|boolean|Byte|byte|Short|short|Character|char|" +
        "Date|LocalDate|LocalDateTime|ZonedDateTime|OffsetDateTime|Instant|" +
        "BigDecimal|BigInteger|UUID|byte\\[\\]|Byte\\[\\]|" +
        "Number|Object|Map|List|Set|Collection|" +
        // Any capitalized type (custom domain class used as property)
        "[A-Z][A-Za-z0-9_]*)\\s+(\\w+)" +
        // Not a method (no opening paren after name)
        "(?!\\s*\\()",
);

const HAS_MANY_RE = /static\s+hasMany\s*=\s*\[([^\]]+)\]/;
const BELONGS_TO_RE = /static\s+belongsTo\s*=\s*\[([^\]]+)\]/;
const RELATION_ENTRY_RE = /(\w+)\s*:\s*(\w+)/g;
const CLASS_NAME_RE = /class\s+(\w+)/;

// Auto-injected GORM fields — not real domain properties
const SKIP_FIELD_NAMES = new Set([
    "version",
    "dateCreated",
    "lastUpdated",
    "errors",
    "constraints",
    "mapping",
    "transients",
    "class",
    "metaClass",
    "log",
]);

// Keywords that look like types but aren't properties
const SKIP_TYPE_NAMES = new Set([
    "if",
    "while",
    "for",
    "switch",
    "return",
    "throw",
    "try",
    "catch",
    "def",
    "static",
    "final",
    "abstract",
    "private",
    "protected",
    "public",
    "void",
    "import",
    "package",
    "class",
    "interface",
    "enum",
    "extends",
    "implements",
]);

function parseDomainClass(filePath: string): DomainClass | null {
    const src = readFileSafe(filePath);
    if (!src) return null;

    const classMatch = CLASS_NAME_RE.exec(src);
    if (!classMatch) return null;
    const name = classMatch[1];

    const properties: DomainProperty[] = [];
    for (const line of src.split("\n")) {
        const m = PROPERTY_RE.exec(line);
        if (m) {
            const typeName = m[1];
            const fieldName = m[2];
            if (SKIP_FIELD_NAMES.has(fieldName)) continue;
            if (SKIP_TYPE_NAMES.has(typeName)) continue;
            // Avoid duplicates
            if (!properties.find((p) => p.name === fieldName)) {
                properties.push({ type: typeName, name: fieldName });
            }
        }
    }

    const hasMany: Record<string, string> = {};
    const hasManyMatch = HAS_MANY_RE.exec(src);
    if (hasManyMatch) {
        RELATION_ENTRY_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = RELATION_ENTRY_RE.exec(hasManyMatch[1])) !== null) {
            hasMany[m[1]] = m[2];
        }
    }

    const belongsTo: Record<string, string> = {};
    const belongsToMatch = BELONGS_TO_RE.exec(src);
    if (belongsToMatch) {
        RELATION_ENTRY_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = RELATION_ENTRY_RE.exec(belongsToMatch[1])) !== null) {
            belongsTo[m[1]] = m[2];
        }
    }

    return { name, filePath, properties, hasMany, belongsTo };
}

/**
 * Checks whether a .groovy file in src/main/groovy looks like a GORM domain class.
 * Used for Grails 3+ projects that put some domain classes outside grails-app/domain.
 *
 * Heuristics (any one is sufficient):
 *   - Has @Entity or @grails.persistence.Entity annotation
 *   - Has @MappedEntity (GORM 7+ / Grails 4+)
 *   - Has static constraints = { ... } block
 *   - Has static mapping = { ... } block
 *   - Lives inside a sub-path containing "domain"
 */
function looksLikeDomainClass(filePath: string, src: string): boolean {
    if (/@Entity\b|@grails\.persistence\.Entity|@MappedEntity\b/.test(src))
        return true;
    if (/static\s+constraints\s*[={]/.test(src)) return true;
    if (/static\s+mapping\s*[={]/.test(src)) return true;
    const normalizedPath = filePath.replace(/\\/g, "/");
    if (/\/domain\//.test(normalizedPath)) return true;
    return false;
}

// ─── Artifact parsing ─────────────────────────────────────────────────────────

function parseArtifact(
    filePath: string,
    kind: GrailsArtifact["kind"],
): GrailsArtifact | null {
    const fileName = path.basename(filePath, ".groovy");
    const src = readFileSafe(filePath);
    const classMatch = CLASS_NAME_RE.exec(src);
    const name = classMatch ? classMatch[1] : fileName;

    const suffix =
        kind === "controller"
            ? "Controller"
            : kind === "service"
              ? "Service"
              : kind === "taglib"
                ? "TagLib"
                : "";

    const simpleName = name.endsWith(suffix)
        ? name.slice(0, -suffix.length).toLowerCase()
        : name.toLowerCase();

    return { name, simpleName, filePath, kind };
}

// ─── Project builder ──────────────────────────────────────────────────────────

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

    // Domains
    for (const dir of domainScanDirs(root, version)) {
        const isExtraDir =
            dir.includes("src/main/groovy") ||
            dir.includes("src\\main\\groovy") ||
            dir.includes("grails-app/utils") ||
            dir.includes("grails-app\\utils");
        for (const f of scanGroovyFiles(dir)) {
            if (isExtraDir) {
                const src = readFileSafe(f);
                if (!looksLikeDomainClass(f, src)) continue;
            }
            const d = parseDomainClass(f);
            // Don't overwrite a domain already found in grails-app/domain
            if (d && !project.domains.has(d.name)) {
                project.domains.set(d.name, d);
            }
        }
    }

    // Controllers
    for (const dir of controllerScanDirs(root)) {
        for (const f of scanGroovyFiles(dir)) {
            const a = parseArtifact(f, "controller");
            if (a) project.controllers.set(a.name, a);
        }
    }

    // Services
    for (const dir of serviceScanDirs(root)) {
        for (const f of scanGroovyFiles(dir)) {
            const a = parseArtifact(f, "service");
            if (a) project.services.set(a.name, a);
        }
    }

    // TagLibs
    for (const dir of taglibScanDirs(root)) {
        for (const f of scanGroovyFiles(dir)) {
            const a = parseArtifact(f, "taglib");
            if (a) project.taglibs.set(a.name, a);
        }
    }

    return project;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function controllerToDomain(controllerName: string): string {
    return controllerName.replace(/Controller$/, "");
}

export function inferDomainFromController(
    filePath: string,
    project: GrailsProject,
): DomainClass | null {
    const ctrlName = path.basename(filePath, ".groovy");
    const domainName = controllerToDomain(ctrlName);
    return project.domains.get(domainName) ?? null;
}
