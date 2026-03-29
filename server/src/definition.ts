import * as fs from "fs";
import * as path from "path";
import {
    Location,
    Range,
    Position,
    TextDocumentPositionParams,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { GrailsProject } from "./grailsProject";
import { pathToUri } from "./uriUtils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function locationAt(filePath: string, line: number): Location {
    return {
        uri: pathToUri(filePath),
        range: Range.create(Position.create(line, 0), Position.create(line, 0)),
    };
}

function locationAtStart(filePath: string): Location {
    return locationAt(filePath, 0);
}

/** Busca la línea de un método en el archivo destino */
function findMethodLine(filePath: string, methodName: string): number {
    if (!fs.existsSync(filePath)) return 0;
    const src = fs.readFileSync(filePath, "utf8");
    const lines = src.split("\n");
    const re = new RegExp(
        "(?:(?:private|protected|public)\\s+)?(?:static\\s+)?(?:def|\\w+)\\s+" +
            methodName +
            "\\s*\\(",
    );
    for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) return i;
    }
    return 0;
}

/** Busca la línea de una propiedad en el archivo destino */
function findPropertyLine(filePath: string, propName: string): number {
    if (!fs.existsSync(filePath)) return 0;
    const src = fs.readFileSync(filePath, "utf8");
    const lines = src.split("\n");
    // Buscar declaración de propiedad: "Tipo nombre" o "def nombre"
    const re = new RegExp("\\b\\w+\\s+" + propName + "\\b");
    for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i]) && !lines[i].trim().startsWith("//")) return i;
    }
    return 0;
}

/** Intenta inferir el tipo de una variable buscando hacia arriba desde la línea actual */
function inferVariableType(
    word: string,
    lines: string[],
    currentLine: number,
    project: GrailsProject,
): string | null {
    // Buscar "def varName = SomeClass." o "SomeClass varName ="
    for (let i = currentLine; i >= Math.max(0, currentLine - 30); i--) {
        const line = lines[i];

        // def book = Book.findBy...()
        const defAssign = line.match(
            new RegExp("def\\s+" + word + "\\s*=\\s*([A-Z]\\w*)\\s*\\."),
        );
        if (defAssign) return defAssign[1];

        // Book book = ...
        const typedDecl = line.match(
            new RegExp("([A-Z]\\w*)\\s+" + word + "\\s*(?:=|$)"),
        );
        if (typedDecl && project.domains.has(typedDecl[1])) return typedDecl[1];
    }
    return null;
}

// ─── Resolvers individuales ───────────────────────────────────────────────────

function resolveArtifactByName(
    word: string,
    project: GrailsProject,
): Location | null {
    if (project.domains.has(word))
        return locationAtStart(project.domains.get(word)!.filePath);
    if (project.controllers.has(word))
        return locationAtStart(project.controllers.get(word)!.filePath);
    if (project.services.has(word))
        return locationAtStart(project.services.get(word)!.filePath);
    if (project.taglibs.has(word))
        return locationAtStart(project.taglibs.get(word)!.filePath);
    return null;
}

function resolveServiceInjection(
    line: string,
    word: string,
    project: GrailsProject,
): Location | null {
    // "def bookService" o "BookService bookService"
    const m = line.match(/(?:def|[A-Z]\w*)\s+(\w+Service)\b/);
    if (!m || m[1] !== word) return null;
    const className = word.charAt(0).toUpperCase() + word.slice(1);
    const artifact = project.services.get(className);
    if (!artifact) return null;
    return locationAtStart(artifact.filePath);
}

function resolveServiceMethod(
    word: string,
    line: string,
    project: GrailsProject,
): Location | null {
    const m = line.match(/(\w+Service)\s*\??\.\s*(\w+)\s*\(/);
    if (!m || m[2] !== word) return null;
    const className = m[1].charAt(0).toUpperCase() + m[1].slice(1);
    const artifact = project.services.get(className);
    if (!artifact) return null;
    const lineNo = findMethodLine(artifact.filePath, word);
    return locationAt(artifact.filePath, lineNo);
}

function resolveControllerStaticCall(
    word: string,
    line: string,
    project: GrailsProject,
): Location | null {
    const m = line.match(/([A-Z]\w*)\s*\.\s*(\w+)\s*\(/);
    if (!m || m[2] !== word) return null;
    const className = m[1];

    const ctrl = project.controllers.get(className);
    if (ctrl) {
        const lineNo = findMethodLine(ctrl.filePath, word);
        return locationAt(ctrl.filePath, lineNo);
    }
    const svc = project.services.get(className);
    if (svc) {
        const lineNo = findMethodLine(svc.filePath, word);
        return locationAt(svc.filePath, lineNo);
    }
    return null;
}

function resolveGormStaticCall(
    word: string,
    line: string,
    project: GrailsProject,
): Location | null {
    const m = line.match(
        /([A-Z]\w*)\s*\.\s*(?:findBy|findAllBy|countBy|get|list)/,
    );
    if (!m) return null;
    const domain = project.domains.get(m[1]);
    if (!domain) return null;
    return locationAtStart(domain.filePath);
}

function resolveDomainProperty(
    word: string,
    line: string,
    lines: string[],
    currentLine: number,
    project: GrailsProject,
): Location | null {
    // variable.propiedad o variable?.propiedad
    const m = line.match(/(\w+)\s*\??\.\s*(\w+)$/);
    if (!m || m[2] !== word) return null;

    const varName = m[1];
    const type = inferVariableType(varName, lines, currentLine, project);
    if (!type) return null;

    const domain = project.domains.get(type);
    if (!domain) return null;

    const hasProp = domain.properties.some((p) => p.name === word);
    if (!hasProp && !domain.hasMany[word] && !domain.belongsTo[word])
        return null;

    const lineNo = findPropertyLine(domain.filePath, word);
    return locationAt(domain.filePath, lineNo);
}

function resolveRenderView(
    line: string,
    currentFilePath: string,
    project: GrailsProject,
): Location | null {
    const m = line.match(/render\s*\(.*?view\s*:\s*['"]([^'"]+)['"]/);
    if (!m) return null;

    let viewPath = m[1];
    const viewsRoot = path.join(project.root, "grails-app", "views");

    if (!viewPath.startsWith("/")) {
        const ctrlMatch = currentFilePath.match(
            /([A-Za-z]+)Controller\.groovy$/,
        );
        if (ctrlMatch) {
            viewPath =
                ctrlMatch[1].charAt(0).toLowerCase() +
                ctrlMatch[1].slice(1) +
                "/" +
                viewPath;
        }
    } else {
        viewPath = viewPath.slice(1);
    }

    const candidates = [
        path.join(viewsRoot, viewPath + ".gsp"),
        path.join(viewsRoot, viewPath),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return locationAtStart(c);
    }
    return null;
}

function resolveRenderTemplate(
    line: string,
    currentFilePath: string,
    project: GrailsProject,
): Location | null {
    const m = line.match(/render\s*\(.*?template\s*:\s*['"]([^'"]+)['"]/);
    if (!m) return null;

    const tmplName = m[1];
    const ctrlMatch = currentFilePath.match(/([A-Za-z]+)Controller\.groovy$/);
    if (!ctrlMatch) return null;

    const viewDir = path.join(
        project.root,
        "grails-app",
        "views",
        ctrlMatch[1].charAt(0).toLowerCase() + ctrlMatch[1].slice(1),
    );
    const candidates = [
        path.join(viewDir, "_" + tmplName + ".gsp"),
        path.join(viewDir, tmplName + ".gsp"),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return locationAtStart(c);
    }
    return null;
}

function resolveRedirect(
    line: string,
    currentFilePath: string,
    project: GrailsProject,
): Location | null {
    const ctrlMatch = line.match(/controller\s*:\s*['"](\w+)['"]/);
    const actionMatch = line.match(/action\s*:\s*['"](\w+)['"]/);

    let filePath: string;
    if (ctrlMatch) {
        const ctrlName =
            ctrlMatch[1].charAt(0).toUpperCase() +
            ctrlMatch[1].slice(1) +
            "Controller";
        const artifact = project.controllers.get(ctrlName);
        if (!artifact) return null;
        filePath = artifact.filePath;
    } else {
        filePath = currentFilePath;
    }

    if (actionMatch) {
        const lineNo = findMethodLine(filePath, actionMatch[1]);
        return locationAt(filePath, lineNo);
    }
    return locationAtStart(filePath);
}

function resolveGspTag(line: string, project: GrailsProject): Location | null {
    // <g:render template="row">
    const tmplM = line.match(/template\s*=\s*['"]([^'"]+)['"]/);
    if (tmplM) {
        // Buscar en todas las carpetas de views
        const viewsRoot = path.join(project.root, "grails-app", "views");
        const tmplName = tmplM[1];
        // Búsqueda simple: recorrer views
        const find = (dir: string): string | null => {
            if (!fs.existsSync(dir)) return null;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    const found = find(full);
                    if (found) return found;
                } else if (
                    entry.name === "_" + tmplName + ".gsp" ||
                    entry.name === tmplName + ".gsp"
                ) {
                    return full;
                }
            }
            return null;
        };
        const found = find(viewsRoot);
        if (found) return locationAtStart(found);
    }

    // controller="book" action="show"
    const ctrlM = line.match(/controller\s*=\s*['"](\w+)['"]/);
    const actM = line.match(/action\s*=\s*['"](\w+)['"]/);
    if (ctrlM) {
        const ctrlName =
            ctrlM[1].charAt(0).toUpperCase() + ctrlM[1].slice(1) + "Controller";
        const artifact = project.controllers.get(ctrlName);
        if (!artifact) return null;
        if (actM) {
            const lineNo = findMethodLine(artifact.filePath, actM[1]);
            return locationAt(artifact.filePath, lineNo);
        }
        return locationAtStart(artifact.filePath);
    }
    return null;
}

function resolveLocalMethod(
    word: string,
    currentFilePath: string,
): Location | null {
    if (!fs.existsSync(currentFilePath)) return null;
    const lineNo = findMethodLine(currentFilePath, word);
    if (lineNo === 0) return null; // 0 podría ser la clase misma
    return locationAt(currentFilePath, lineNo);
}

// ─── Punto de entrada principal ───────────────────────────────────────────────

export function getDefinition(
    doc: TextDocument,
    params: TextDocumentPositionParams,
    project: GrailsProject | null,
): Location | null {
    if (!project) return null;

    const text = doc.getText();
    const lines = text.split("\n");
    const lineNo = params.position.line;
    const line = lines[lineNo] ?? "";
    const offset = doc.offsetAt(params.position);
    const lineStart = text.lastIndexOf("\n", offset - 1) + 1;

    // Extraer la palabra bajo el cursor
    const charIdx = params.position.character;
    const wordMatch =
        line.slice(0, charIdx + 1).match(/(\w+)$/) ??
        line.slice(charIdx).match(/^(\w+)/);
    const word = wordMatch?.[1] ?? "";
    if (!word) return null;

    const filePath = doc.uri.startsWith("file://")
        ? decodeURIComponent(doc.uri.replace(/^file:\/\//, ""))
        : doc.uri;

    // Orden de resolución (mismo que en VS Code)

    // 1. Tags GSP
    if (filePath.endsWith(".gsp")) {
        const loc = resolveGspTag(line, project);
        if (loc) return loc;
    }

    // 2. render view / template
    if (line.includes("render")) {
        const loc =
            resolveRenderView(line, filePath, project) ??
            resolveRenderTemplate(line, filePath, project);
        if (loc) return loc;
    }

    // 3. redirect
    if (line.includes("redirect")) {
        const loc = resolveRedirect(line, filePath, project);
        if (loc) return loc;
    }

    // 4. Método de servicio: miServicio.miMetodo(
    {
        const loc = resolveServiceMethod(word, line, project);
        if (loc) return loc;
    }

    // 5. Inyección de servicio: def miServicio
    {
        const loc = resolveServiceInjection(line, word, project);
        if (loc) return loc;
    }

    // 6. Llamada estática de controller o servicio: MiController.miMetodo(
    {
        const loc = resolveControllerStaticCall(word, line, project);
        if (loc) return loc;
    }

    // 7. GORM estático: Dominio.findBy...
    {
        const loc = resolveGormStaticCall(word, line, project);
        if (loc) return loc;
    }

    // 8. Propiedad de dominio: variable.propiedad
    {
        const loc = resolveDomainProperty(word, line, lines, lineNo, project);
        if (loc) return loc;
    }

    // 9. Artefacto por nombre de clase
    {
        const loc = resolveArtifactByName(word, project);
        if (loc) return loc;
    }

    // 10. Método local en el mismo archivo
    {
        const loc = resolveLocalMethod(word, filePath);
        if (loc) return loc;
    }

    return null;
}
