import * as fs from "fs";
import * as path from "path";
import {
    TextDocumentPositionParams,
    Location,
    Range,
    Position,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { GrailsProject, DomainClass } from "./grailsProject";
import { uriToPath, pathToUri } from "./uriUtils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toLocation(filePath: string, line = 0, character = 0): Location {
    return {
        uri: pathToUri(filePath),
        range: Range.create(
            Position.create(line, character),
            Position.create(line, character),
        ),
    };
}

function findLine(src: string, pattern: RegExp): number {
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) return i;
    }
    return 0;
}

function readFile(filePath: string): string | null {
    try {
        return fs.readFileSync(filePath, "utf8");
    } catch {
        return null;
    }
}

function wordAtPosition(
    doc: TextDocument,
    params: TextDocumentPositionParams,
): string {
    const lines = doc.getText().split("\n");
    const line = lines[params.position.line] ?? "";
    const col = params.position.character;
    let start = col;
    let end = col;
    while (start > 0 && /\w/.test(line[start - 1])) start--;
    while (end < line.length && /\w/.test(line[end])) end++;
    return line.slice(start, end);
}

function lineAt(doc: TextDocument, params: TextDocumentPositionParams): string {
    return doc.getText().split("\n")[params.position.line] ?? "";
}

// ─── Variable type inference ──────────────────────────────────────────────────

/**
 * Scans the document above the cursor to find the domain type of a variable.
 * Handles:
 *   def area = Area.findByNombre(...)     -> "Area"
 *   def area = Area.get(id)              -> "Area"
 *   def areas = Area.findAllBy*(...)     -> "Area"  (list, but domain is Area)
 *   Area area = ...                      -> "Area"
 */
function inferVariableType(
    varName: string,
    doc: TextDocument,
    cursorLine: number,
    project: GrailsProject,
): DomainClass | undefined {
    const lines = doc.getText().split("\n");
    const domainNames = [...project.domains.keys()];

    // Search upward from cursor, stop at class/method boundary if needed
    for (let i = cursorLine; i >= 0; i--) {
        const l = lines[i];

        // "def varName = DomainClass.something(...)"
        // also handles "def varName = DomainClass?.something(...)"
        const defMatch = new RegExp(
            `\\bdef\\s+${varName}\\s*=\\s*([A-Z]\\w+)\\s*[?.]`,
        ).exec(l);
        if (defMatch) {
            const domain = project.domains.get(defMatch[1]);
            if (domain) return domain;
        }

        // "DomainClass varName = ..." (typed declaration)
        const typedMatch = new RegExp(`\\b([A-Z]\\w+)\\s+${varName}\\b`).exec(
            l,
        );
        if (typedMatch) {
            const domain = project.domains.get(typedMatch[1]);
            if (domain) return domain;
        }
    }
    return undefined;
}

// ─── Resolution strategies ────────────────────────────────────────────────────

/**
 * FIX #5: safe-navigation operator?.
 * Strips "?." so "area?.id" is treated the same as "area.id"
 */
function resolveDomainProperty(
    line: string,
    word: string,
    doc: TextDocument,
    cursorLine: number,
    project: GrailsProject,
    currentFilePath: string,
): Location | null {
    // Match "varName.prop" OR "varName?.prop" before the cursor word
    const lineUpToWord = line.slice(0, line.lastIndexOf(word) + word.length);
    const dotMatch = /\b(\w+)\??\.\s*(\w+)$/.exec(lineUpToWord);
    if (!dotMatch) return null;

    const [, varName, propName] = dotMatch;

    // 1. varName is a known domain class directly (Area.someStaticField)
    let domain =
        project.domains.get(varName) ??
        project.domains.get(varName.charAt(0).toUpperCase() + varName.slice(1));

    // 2. varName matches a domain by lowercase name (area -> Area)
    if (!domain) {
        domain = [...project.domains.values()].find(
            (d) => d.name.toLowerCase() === varName.toLowerCase(),
        );
    }

    // 3. FIX #6: infer from assignment context (def areaPermisos = Area.findAllBy*)
    if (!domain) {
        domain = inferVariableType(varName, doc, cursorLine, project);
    }

    // 4. Controller convention fallback
    if (!domain) {
        const ctrlDomainName = path
            .basename(currentFilePath, ".groovy")
            .replace(/Controller$/, "");
        domain = project.domains.get(ctrlDomainName);
    }

    if (!domain) return null;

    const prop = domain.properties.find((p) => p.name === propName);
    if (!prop) return null;

    const src = readFile(domain.filePath);
    if (!src) return null;

    const lineNum = findLine(
        src,
        new RegExp(`\\b${prop.type}\\s+${prop.name}\\b`),
    );
    return toLocation(domain.filePath, lineNum);
}

/**
 * FIX #3 + redirect FIX #2:
 * redirect(action: 'logIn') without controller: → same controller
 * redirect(action: 'logIn', controller: 'other') → other controller
 */
function resolveRedirect(
    line: string,
    project: GrailsProject,
    currentFilePath: string,
): Location | null {
    const ctrlMatch = /controller\s*:\s*['"](\w+)['"]/.exec(line);
    const actionMatch = /action\s*:\s*['"](\w+)['"]/.exec(line);

    let targetFilePath: string;

    if (ctrlMatch) {
        // Explicit controller specified
        const ctrlName =
            ctrlMatch[1].charAt(0).toUpperCase() +
            ctrlMatch[1].slice(1) +
            "Controller";
        const artifact = project.controllers.get(ctrlName);
        if (!artifact) return null;
        targetFilePath = artifact.filePath;
    } else {
        // FIX #2: no controller → same file
        targetFilePath = currentFilePath;
    }

    if (!actionMatch) return toLocation(targetFilePath);

    const src = readFile(targetFilePath);
    if (!src) return toLocation(targetFilePath);

    const actionLine = findLine(src, new RegExp(`def\\s+${actionMatch[1]}\\b`));
    return toLocation(targetFilePath, actionLine);
}

/**
 * FIX #3: local method call inside the same controller
 * renderResponse(...), someMethod(), etc.
 * Triggered when word is followed by "(" and no dot before it.
 */
function resolveLocalMethod(
    word: string,
    line: string,
    currentFilePath: string,
): Location | null {
    // Must look like a method call: word followed by ( on the line
    if (!/\b\w+\s*\(/.test(line)) return null;
    // Must NOT have a dot before it (that would be a method on an object)
    const beforeWord = line.slice(0, line.indexOf(word));
    if (/[\w?]\s*\.\s*$/.test(beforeWord)) return null;

    const src = readFile(currentFilePath);
    if (!src) return null;

    const methodLine = findLine(src, new RegExp(`def\\s+${word}\\b`));
    // findLine returns 0 if not found — only return if we actually found it
    const lines = src.split("\n");
    if (new RegExp(`def\\s+${word}\\b`).test(lines[methodLine])) {
        return toLocation(currentFilePath, methodLine);
    }
    return null;
}

/**
 * FIX #1: render(view: '/layouts/main') → grails-app/views/layouts/main.gsp
 * Absolute path (starts with /) resolves from views root.
 * Relative path resolves from controller's view folder.
 */
function resolveRenderView(
    line: string,
    project: GrailsProject,
    currentFilePath: string,
): Location | null {
    const viewMatch =
        /render\s*\(\s*(?:view\s*:\s*)?['"]([^'"]+)['"]/.exec(line) ??
        /render\s+['"]([^'"]+)['"]/.exec(line);
    if (!viewMatch) return null;

    const viewValue = viewMatch[1];
    const viewsRoot = path.join(project.root, "grails-app/views");
    const ctrlName = path
        .basename(currentFilePath, ".groovy")
        .replace(/Controller$/, "")
        .toLowerCase();

    let candidates: string[];

    if (viewValue.startsWith("/")) {
        // FIX #1: absolute path from views root
        const stripped = viewValue.replace(/^\//, "");
        candidates = [
            path.join(viewsRoot, stripped + ".gsp"),
            path.join(viewsRoot, stripped), // already has .gsp
        ];
    } else {
        // relative: look in controller's folder first
        candidates = [
            path.join(viewsRoot, ctrlName, viewValue + ".gsp"),
            path.join(viewsRoot, viewValue + ".gsp"),
            path.join(viewsRoot, ctrlName, `_${viewValue}.gsp`),
        ];
    }

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return toLocation(candidate);
    }
    return null;
}

function resolveRenderTemplate(
    line: string,
    project: GrailsProject,
    currentFilePath: string,
): Location | null {
    const tmplMatch = /template\s*:\s*['"]([^'"]+)['"]/.exec(line);
    if (!tmplMatch) return null;

    const logicalName = tmplMatch[1].replace(/^_/, "");
    const ctrlName = path
        .basename(currentFilePath, ".groovy")
        .replace(/Controller$/, "")
        .toLowerCase();

    const candidates = [
        path.join(
            project.root,
            "grails-app/views",
            ctrlName,
            `_${logicalName}.gsp`,
        ),
        path.join(project.root, "grails-app/views", `_${logicalName}.gsp`),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return toLocation(candidate);
    }
    return null;
}

/**
 * Cursor on a method name called on a service variable.
 * securityService.registerMember(...) → SecurityService.groovy, exact line of method.
 * Handles: def, private def, typed methods, safe navigation ?.
 */
function resolveServiceMethod(
    word: string,
    line: string,
    project: GrailsProject,
): Location | null {
    const serviceCallMatch = /\b(\w+Service)\s*\??\.\s*(\w+)\s*\(/.exec(line);
    if (!serviceCallMatch) return null;

    const [, serviceVar, methodName] = serviceCallMatch;
    if (word !== methodName) return null;

    const capitalizedService =
        serviceVar.charAt(0).toUpperCase() + serviceVar.slice(1);
    const artifact = project.services.get(capitalizedService);
    if (!artifact) return null;

    const src = readFile(artifact.filePath);
    if (!src) return null;

    const srcLines = src.split("\n");
    for (let i = 0; i < srcLines.length; i++) {
        const l = srcLines[i];
        // Match: [private|protected|public] [def|Type] methodName(
        // e.g. "def foo(", "private def foo(", "String foo(", "void foo ("
        if (
            new RegExp(
                `(?:(?:private|protected|public)\\s+)?(?:static\\s+)?(?:def|\\w+)\\s+${methodName}\\s*\\(`,
            ).test(l)
        ) {
            return toLocation(artifact.filePath, i);
        }
    }
    // Method not found but service exists → jump to file top
    return toLocation(artifact.filePath);
}

function resolveServiceInjection(
    word: string,
    line: string,
    project: GrailsProject,
): Location | null {
    // "BookService bookService" typed declaration
    const declMatch = /\b([A-Z]\w+Service)\s+\w+/.exec(line);
    if (declMatch) {
        const art = project.services.get(declMatch[1]);
        if (art) return toLocation(art.filePath);
    }
    // cursor on "bookService" variable (not a method call)
    if (/[a-z]\w*Service$/.test(word)) {
        const capitalized = word.charAt(0).toUpperCase() + word.slice(1);
        const art = project.services.get(capitalized);
        if (art) return toLocation(art.filePath);
    }
    return null;
}

/**
 * Controller static method call: SwaggerController.oauth2Redirect()
 * Resolves to the exact method line in the controller file.
 * Handles imported controllers (e.g. import com.example.SwaggerController)
 */
function resolveControllerStaticCall(
    word: string,
    line: string,
    project: GrailsProject,
): Location | null {
    // Match ClassName.methodName( — checks controllers and services
    const staticMatch = /\b([A-Z]\w+)\s*\.\s*(\w+)\s*\(/.exec(line);
    if (!staticMatch) return null;

    const [, className, methodName] = staticMatch;
    if (word !== methodName) return null;

    // Check controllers first, then services (handles TestService.method() calls)
    const artifact =
        project.controllers.get(className) ?? project.services.get(className);
    if (!artifact) return null;

    const src = readFile(artifact.filePath);
    if (!src) return toLocation(artifact.filePath);

    const srcLines = src.split("\n");
    for (let i = 0; i < srcLines.length; i++) {
        if (
            new RegExp(
                `(?:(?:private|protected|public)\\s+)?(?:static\\s+)?(?:def|\\w+)\\s+${methodName}\\s*\\(`,
            ).test(srcLines[i])
        ) {
            return toLocation(artifact.filePath, i);
        }
    }
    return toLocation(artifact.filePath);
}

/**
 * GORM static calls: findByX, findAllByX, get, list, count, etc.
 *
 * Dynamic finders → extracts the property name and jumps to its declaration:
 *   Area.findByNombre(x)    → Area.groovy line "String nombre"
 *   Area.findAllByPadre(x)  → Area.groovy line "String padre" (or whatever type)
 *
 * Non-dynamic (get, list, count, save, etc.) → jumps to domain file.
 */
function resolveGormStaticCall(
    word: string,
    line: string,
    project: GrailsProject,
): Location | null {
    const staticMatch = /\b([A-Z]\w+)\s*\??\.\s*(\w+)\s*\(/.exec(line);
    if (!staticMatch) return null;

    const [, domainName, methodName] = staticMatch;
    if (word !== methodName) return null;

    const domain = project.domains.get(domainName);
    if (!domain) return null;

    // Parse dynamic finder property name:
    // findByNombre          → "nombre"
    // findAllByPadre        → "padre"
    // findByNombreAndTipo   → "nombre" (first property)
    // countByActivo         → "activo"
    const dynamicRe =
        /^(?:findAll?By|listBy|countBy|existsBy|getBy)([A-Z][a-zA-Z]*)/.exec(
            methodName,
        );
    if (dynamicRe) {
        let rawProp = dynamicRe[1];
        // Strip trailing compound: "NombreAndTipo" → "Nombre"
        rawProp = rawProp.replace(/(?:And|Or)[A-Z].*$/, "");
        const propName = rawProp.charAt(0).toLowerCase() + rawProp.slice(1);

        const prop = domain.properties.find((p) => p.name === propName);
        if (prop) {
            const src = readFile(domain.filePath);
            if (src) {
                const lineNum = findLine(
                    src,
                    new RegExp(`\\b${prop.type}\\s+${prop.name}\\b`),
                );
                return toLocation(domain.filePath, lineNum);
            }
        }
    }

    // Fallback: non-dynamic call or property not in index
    return toLocation(domain.filePath);
}

function resolveArtifactByName(
    word: string,
    project: GrailsProject,
): Location | null {
    if (word.endsWith("Controller")) {
        const art = project.controllers.get(word);
        if (art) return toLocation(art.filePath);
    }
    if (word.endsWith("Service")) {
        const art = project.services.get(word);
        if (art) return toLocation(art.filePath);
    }
    const domain = project.domains.get(word);
    if (domain) return toLocation(domain.filePath);
    return null;
}

function resolveGspTag(
    line: string,
    project: GrailsProject,
    currentFilePath: string,
): Location | null {
    const tmplMatch = /template=['"]([^'"]+)['"]/.exec(line);
    if (tmplMatch) {
        const dir = path.dirname(currentFilePath);
        const logicalName = tmplMatch[1].replace(/^_/, "");
        const candidate = path.join(dir, `_${logicalName}.gsp`);
        if (fs.existsSync(candidate)) return toLocation(candidate);
    }

    const ctrlMatch = /controller=['"](\w+)['"]/.exec(line);
    const actionMatch = /action=['"](\w+)['"]/.exec(line);
    if (ctrlMatch) {
        const ctrlName =
            ctrlMatch[1].charAt(0).toUpperCase() +
            ctrlMatch[1].slice(1) +
            "Controller";
        const art = project.controllers.get(ctrlName);
        if (!art) return null;
        if (!actionMatch) return toLocation(art.filePath);
        const src = readFile(art.filePath);
        if (!src) return toLocation(art.filePath);
        const actionLine = findLine(
            src,
            new RegExp(`def\\s+${actionMatch[1]}\\b`),
        );
        return toLocation(art.filePath, actionLine);
    }

    return null;
}

// ─── Public entry point ───────────────────────────────────────────────────────

export function getDefinition(
    doc: TextDocument,
    params: TextDocumentPositionParams,
    project: GrailsProject | null,
): Location | null {
    if (!project) return null;

    const filePath = uriToPath(doc.uri);
    const word = wordAtPosition(doc, params);
    const line = lineAt(doc, params);
    const cursorLine = params.position.line;
    const isGsp = filePath.endsWith(".gsp");

    if (!word) return null;

    // 1. GSP-specific tag resolution
    if (isGsp) {
        return resolveGspTag(line, project, filePath) ?? null;
    }

    // 2. render(view/template)
    if (/\brender\b/.test(line)) {
        return (
            resolveRenderView(line, project, filePath) ??
            resolveRenderTemplate(line, project, filePath) ??
            null
        );
    }

    // 3. redirect — FIX: now handles same-controller redirect
    if (/\bredirect\b/.test(line)) {
        return resolveRedirect(line, project, filePath) ?? null;
    }

    // 4. Service method call (securityService.registerMember)
    const serviceMethodLoc = resolveServiceMethod(word, line, project);
    if (serviceMethodLoc) return serviceMethodLoc;

    // 5. Service injection/variable
    const serviceLoc = resolveServiceInjection(word, line, project);
    if (serviceLoc) return serviceLoc;

    // 6a. Controller static method call (SwaggerController.oauth2Redirect)
    const ctrlStaticLoc = resolveControllerStaticCall(word, line, project);
    if (ctrlStaticLoc) return ctrlStaticLoc;

    // 6b. GORM static call (Area.findAllByPadre, Area.get)
    const gormLoc = resolveGormStaticCall(word, line, project);
    if (gormLoc) return gormLoc;

    // 7. Domain property with safe-nav support (area?.id, area.id)
    const propLoc = resolveDomainProperty(
        line,
        word,
        doc,
        cursorLine,
        project,
        filePath,
    );
    if (propLoc) return propLoc;

    // 8. Named artifact (BookController, BookService, Book)
    const artifactLoc = resolveArtifactByName(word, project);
    if (artifactLoc) return artifactLoc;

    // 9. FIX #3: local method in same controller (renderResponse, any def)
    return resolveLocalMethod(word, line, filePath) ?? null;
}
