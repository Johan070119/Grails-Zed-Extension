import * as fs from "fs";
import * as path from "path";
import {
    CompletionItem,
    CompletionItemKind,
    TextDocumentPositionParams,
    InsertTextFormat,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { GrailsProject, DomainClass } from "./grailsProject";

// ─── Tipos de contexto ────────────────────────────────────────────────────────

type CompletionKind =
    | "import"
    | "string_controller"
    | "string_action"
    | "string_view"
    | "render_redirect_key"
    | "gorm_static"
    | "gorm_static_and"
    | "gorm_instance"
    | "controller_static"
    | "service_injection"
    | "domain_name"
    | "artifact_name"
    | "generic_grails";

interface CompletionContext {
    kind: CompletionKind;
    domainName?: string;
    serviceName?: string;
    controllerName?: string;
    targetController?: string;
    andPrefix?: string;
    instanceType?: string;
    partialName?: string;
}

// ─── Parser de métodos (soporta def, public static, private, typed, etc.) ─────

const methodRe =
    /^\s*(?:(?:private|protected|public)\s+)?(?:static\s+)?(?:def|\w+)\s+(\w+)\s*\(/gm;

const METHOD_SKIP = new Set([
    "class",
    "if",
    "for",
    "while",
    "switch",
    "try",
    "catch",
    "return",
    "static",
    "final",
    "new",
    "else",
    "throw",
    "def",
    "void",
    "import",
    "package",
    "interface",
    "enum",
    "abstract",
    "extends",
    "implements",
]);

function parseMethods(src: string): string[] {
    const methods: string[] = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    methodRe.lastIndex = 0;
    while ((m = methodRe.exec(src)) !== null) {
        const name = m[1];
        if (!METHOD_SKIP.has(name) && !seen.has(name)) {
            seen.add(name);
            methods.push(name);
        }
    }
    return methods;
}

// ─── Detección de contexto ────────────────────────────────────────────────────

function detectContext(
    lineUpTo: string,
    project: GrailsProject | null,
): CompletionContext {
    // 1. Import
    if (/^(\s*import\s+)([\w.]*)$/.test(lineUpTo)) {
        return { kind: "import" };
    }

    // 2. controller: "..."
    if (/controller\s*:\s*['"][^'"]*$/.test(lineUpTo)) {
        return { kind: "string_controller" };
    }

    // 3. action: "..."
    const actionMatch = lineUpTo.match(
        /controller\s*:\s*['"](\w+)['"][^)]*action\s*:\s*['"][^'"]*$/,
    );
    if (actionMatch) {
        return { kind: "string_action", targetController: actionMatch[1] };
    }
    if (/action\s*:\s*['"][^'"]*$/.test(lineUpTo)) {
        return { kind: "string_action" };
    }

    // 4. view: "..."
    if (/view\s*:\s*['"][^'"]*$/.test(lineUpTo)) {
        return { kind: "string_view" };
    }

    // 5. render( / redirect( con argumentos incompletos
    if (
        /\b(render|redirect)\s*\([^)]*$/.test(lineUpTo) &&
        !/view\s*:|action\s*:|controller\s*:|template\s*:/.test(lineUpTo)
    ) {
        return { kind: "render_redirect_key" };
    }

    // 6. PkgDomain.método → detectar camelCase splitting
    const pkgDomainMatch = lineUpTo.match(/([A-Z]\w*)\.(\w*)$/);
    if (pkgDomainMatch && project) {
        const candidate = pkgDomainMatch[1];
        const startIdx = lineUpTo.lastIndexOf(candidate);
        const lastChar = startIdx > 0 ? lineUpTo[startIdx - 1] : "";
        const isCamelCaseSplit = /[a-z]/.test(lastChar);

        if (!isCamelCaseSplit) {
            if (
                project.controllers.has(candidate + "Controller") ||
                project.controllers.has(candidate)
            ) {
                const ctrlName = project.controllers.has(
                    candidate + "Controller",
                )
                    ? candidate + "Controller"
                    : candidate;
                return { kind: "controller_static", controllerName: ctrlName };
            }
            if (
                project.services.has(candidate + "Service") ||
                project.services.has(candidate)
            ) {
                const svcName = project.services.has(candidate + "Service")
                    ? candidate + "Service"
                    : candidate;
                return { kind: "service_injection", serviceName: svcName };
            }
            if (project.domains.has(candidate)) {
                // Detectar findByXAnd...
                const staticAndMatch = lineUpTo.match(
                    /([A-Z]\w*)\.findBy(\w+?)And(\w*)$/,
                );
                if (staticAndMatch) {
                    return {
                        kind: "gorm_static_and",
                        domainName: staticAndMatch[1],
                        andPrefix: staticAndMatch[2],
                    };
                }
                return { kind: "gorm_static", domainName: candidate };
            }
        }
    }

    // 7. Sólo nombre estático (sin punto previo camelCase)
    const staticMatch = lineUpTo.match(/\b([A-Z]\w*)\.(\w*)$/);
    if (staticMatch && project) {
        const candidate = staticMatch[1];
        if (project.domains.has(candidate)) {
            const staticAndMatch = lineUpTo.match(
                /([A-Z]\w*)\.findBy(\w+?)And(\w*)$/,
            );
            if (staticAndMatch) {
                return {
                    kind: "gorm_static_and",
                    domainName: staticAndMatch[1],
                    andPrefix: staticAndMatch[2],
                };
            }
            return { kind: "gorm_static", domainName: candidate };
        }
    }

    // 8. Nombre de artefacto (letra mayúscula, sin punto)
    const bareWordMatch = lineUpTo.match(/(?:^|[\s=(,])([A-Z]\w*)$/);
    if (bareWordMatch && project) {
        const candidate = bareWordMatch[1];
        if (project.domains.has(candidate)) {
            return { kind: "domain_name", domainName: candidate };
        }
        return { kind: "artifact_name", partialName: candidate };
    }

    // 9. Servicio inyectado: miServicio.método
    const serviceMatch = lineUpTo.match(/(\w+[Ss]ervice)\??\.\s*(\w*)$/);
    if (serviceMatch && project) {
        return { kind: "service_injection", serviceName: serviceMatch[1] };
    }

    // 10. Instancia de dominio: variable.propiedad
    const instanceMatch = lineUpTo.match(/([a-z]\w*)\??\.\s*(\w*)$/);
    if (instanceMatch && project) {
        return { kind: "gorm_instance", instanceType: instanceMatch[1] };
    }

    // 11. Fallback
    return { kind: "generic_grails" };
}

// ─── Builders de completions ──────────────────────────────────────────────────

function importCompletions(project: GrailsProject): CompletionItem[] {
    const items: CompletionItem[] = [];
    const add = (artifact: { name: string; filePath: string }) => {
        // Derivar paquete desde el path del archivo
        const fp = artifact.filePath.replace(/\\/g, "/");
        let pkg = "";
        const markers = [
            "grails-app/domain/",
            "grails-app/controllers/",
            "grails-app/services/",
            "src/main/groovy/",
        ];
        for (const marker of markers) {
            const idx = fp.indexOf(marker);
            if (idx !== -1) {
                pkg = fp
                    .slice(idx + marker.length)
                    .replace(/\.groovy$/, "")
                    .replace(/\//g, ".");
                break;
            }
        }
        items.push({
            label: pkg || artifact.name,
            kind: CompletionItemKind.Module,
            detail: artifact.name,
        });
    };

    project.domains.forEach((d) => add(d));
    project.controllers.forEach((c) => add(c));
    project.services.forEach((s) => add(s));
    return items;
}

function controllerNameCompletions(project: GrailsProject): CompletionItem[] {
    const items: CompletionItem[] = [];
    project.controllers.forEach((c) => {
        items.push({
            label: c.simpleName,
            kind: CompletionItemKind.Class,
            detail: c.name,
            insertText: c.simpleName,
        });
    });
    return items;
}

function actionNameCompletions(
    targetController: string | undefined,
    project: GrailsProject,
    currentFilePath: string,
): CompletionItem[] {
    const items: CompletionItem[] = [];

    let filePath: string | undefined;
    if (targetController) {
        const key =
            targetController.charAt(0).toUpperCase() +
            targetController.slice(1) +
            "Controller";
        filePath = project.controllers.get(key)?.filePath;
    }
    if (!filePath) filePath = currentFilePath;
    if (!filePath || !fs.existsSync(filePath)) return items;

    const src = fs.readFileSync(filePath, "utf8");
    for (const method of parseMethods(src)) {
        items.push({
            label: method,
            kind: CompletionItemKind.Method,
            insertText: method,
        });
    }
    return items;
}

function viewPathCompletions(
    project: GrailsProject,
    currentFilePath: string,
): CompletionItem[] {
    const items: CompletionItem[] = [];
    const viewsRoot = path.join(project.root, "grails-app", "views");
    if (!fs.existsSync(viewsRoot)) return items;

    // Inferir nombre del controller desde el path
    const m = currentFilePath.match(/([A-Za-z]+)Controller\.groovy$/);
    const baseDir = m
        ? path.join(viewsRoot, m[1].charAt(0).toLowerCase() + m[1].slice(1))
        : viewsRoot;

    const scanViews = (dir: string, prefix: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                scanViews(full, prefix + entry.name + "/");
            } else if (entry.name.endsWith(".gsp")) {
                const label = prefix + entry.name.replace(/\.gsp$/, "");
                items.push({
                    label,
                    kind: CompletionItemKind.File,
                    insertText: label,
                });
            }
        }
    };
    scanViews(baseDir, "");
    return items;
}

function gormStaticCompletions(
    domainName: string,
    project: GrailsProject,
): CompletionItem[] {
    const domain = project.domains.get(domainName);
    const items: CompletionItem[] = [];

    // Métodos GORM estáticos básicos
    const staticMethods = [
        { label: "list()", insertText: "list()" },
        {
            label: "get(id)",
            insertText: "get(${1:id})",
            format: InsertTextFormat.Snippet,
        },
        { label: "count()", insertText: "count()" },
        {
            label: "exists(id)",
            insertText: "exists(${1:id})",
            format: InsertTextFormat.Snippet,
        },
        {
            label: "find(query)",
            insertText: "find(${1:query})",
            format: InsertTextFormat.Snippet,
        },
        { label: "findAll()", insertText: "findAll()" },
        {
            label: "withCriteria {}",
            insertText: "withCriteria {\n\t$0\n}",
            format: InsertTextFormat.Snippet,
        },
        {
            label: "where {}",
            insertText: "where {\n\t$0\n}",
            format: InsertTextFormat.Snippet,
        },
        {
            label: "executeQuery()",
            insertText: "executeQuery(${1:query})",
            format: InsertTextFormat.Snippet,
        },
        { label: "save()", insertText: "save()" },
        { label: "delete()", insertText: "delete()" },
    ];

    for (const m of staticMethods) {
        items.push({
            label: m.label,
            kind: CompletionItemKind.Method,
            insertText: m.insertText,
            insertTextFormat: m.format ?? InsertTextFormat.PlainText,
        });
    }

    // findBy* / findAllBy* por cada propiedad
    if (domain) {
        for (const prop of domain.properties) {
            const pascal =
                prop.name.charAt(0).toUpperCase() + prop.name.slice(1);
            items.push({
                label: "findBy" + pascal + "(value)",
                kind: CompletionItemKind.Method,
                insertText: "findBy" + pascal + "(${1:value})",
                insertTextFormat: InsertTextFormat.Snippet,
            });
            items.push({
                label: "findAllBy" + pascal + "(value)",
                kind: CompletionItemKind.Method,
                insertText: "findAllBy" + pascal + "(${1:value})",
                insertTextFormat: InsertTextFormat.Snippet,
            });
            items.push({
                label: "countBy" + pascal + "(value)",
                kind: CompletionItemKind.Method,
                insertText: "countBy" + pascal + "(${1:value})",
                insertTextFormat: InsertTextFormat.Snippet,
            });
        }
        // hasMany relations
        for (const [rel] of Object.entries(domain.hasMany)) {
            const pascal = rel.charAt(0).toUpperCase() + rel.slice(1);
            items.push({
                label: "findBy" + pascal + "(value)",
                kind: CompletionItemKind.Method,
                insertText: "findBy" + pascal + "(${1:value})",
                insertTextFormat: InsertTextFormat.Snippet,
            });
        }
    }

    return items;
}

function gormStaticAndCompletions(
    domainName: string,
    andPrefix: string,
    project: GrailsProject,
): CompletionItem[] {
    const domain = project.domains.get(domainName);
    if (!domain) return [];
    const items: CompletionItem[] = [];
    for (const prop of domain.properties) {
        const pascal = prop.name.charAt(0).toUpperCase() + prop.name.slice(1);
        if (pascal !== andPrefix) {
            items.push({
                label: "And" + pascal,
                kind: CompletionItemKind.Method,
                insertText: "And" + pascal,
            });
        }
    }
    return items;
}

function gormInstanceCompletions(
    instanceType: string,
    project: GrailsProject,
    docSrc: string,
): CompletionItem[] {
    const items: CompletionItem[] = [];

    // Intentar inferir el tipo de la variable desde el documento
    const typeRe = new RegExp(
        "(?:def|[A-Z]\\w*)\\s+" + instanceType + "\\s*(?:=|\\()",
    );
    const inferredMatch = docSrc.match(typeRe);
    let domain: DomainClass | undefined;

    if (inferredMatch) {
        // Buscar asignación de tipo: def book = Book.findBy...
        const assignRe = new RegExp(
            instanceType + "\\s*=\\s*([A-Z]\\w*)\\s*\\.",
        );
        const am = docSrc.match(assignRe);
        if (am) domain = project.domains.get(am[1]);
    }

    // Fallback: capitalizar el nombre de variable
    if (!domain) {
        const capitalized =
            instanceType.charAt(0).toUpperCase() + instanceType.slice(1);
        domain = project.domains.get(capitalized);
    }

    if (domain) {
        for (const prop of domain.properties) {
            items.push({
                label: prop.name,
                kind: CompletionItemKind.Field,
                detail: prop.type,
                insertText: prop.name,
            });
        }
        for (const [rel, type] of Object.entries(domain.hasMany)) {
            items.push({
                label: rel,
                kind: CompletionItemKind.Field,
                detail: "List<" + type + ">",
            });
        }
        for (const [rel, type] of Object.entries(domain.belongsTo)) {
            items.push({
                label: rel,
                kind: CompletionItemKind.Field,
                detail: type,
            });
        }
    }

    // Métodos de instancia GORM siempre disponibles
    const instanceMethods = [
        "save()",
        "delete()",
        "validate()",
        "hasErrors()",
        "refresh()",
        "merge()",
    ];
    for (const m of instanceMethods) {
        items.push({
            label: m,
            kind: CompletionItemKind.Method,
            insertText: m.replace("()", "()"),
        });
    }

    return items;
}

function serviceMethodCompletions(
    serviceName: string,
    project: GrailsProject,
): CompletionItem[] {
    // Capitalizar para buscar en el mapa (FusionTokenService)
    const capitalized =
        serviceName.charAt(0).toUpperCase() + serviceName.slice(1);
    const artifact = project.services.get(capitalized);
    if (!artifact) {
        // Fallback case-insensitive
        let found = null;
        for (const [key, val] of project.services) {
            if (key.toLowerCase() === capitalized.toLowerCase()) {
                found = val;
                break;
            }
        }
        if (!found) return [];
        return parseMethods(fs.readFileSync(found.filePath, "utf8")).map(
            (m) => ({
                label: m,
                kind: CompletionItemKind.Method,
                insertText: m,
            }),
        );
    }
    return parseMethods(fs.readFileSync(artifact.filePath, "utf8")).map(
        (m) => ({
            label: m,
            kind: CompletionItemKind.Method,
            insertText: m,
        }),
    );
}

function controllerMethodCompletions(
    controllerName: string,
    project: GrailsProject,
): CompletionItem[] {
    const artifact = project.controllers.get(controllerName);
    if (!artifact) return [];
    return parseMethods(fs.readFileSync(artifact.filePath, "utf8")).map(
        (m) => ({
            label: m,
            kind: CompletionItemKind.Method,
            insertText: m,
        }),
    );
}

function artifactNameCompletions(
    partial: string | undefined,
    project: GrailsProject,
): CompletionItem[] {
    const items: CompletionItem[] = [];
    const lp = (partial ?? "").toLowerCase();

    project.controllers.forEach((c) => {
        if (!lp || c.name.toLowerCase().startsWith(lp)) {
            items.push({
                label: c.name,
                kind: CompletionItemKind.Class,
                detail: "Controller",
                insertText: c.name,
                commitCharacters: ["."],
            });
        }
    });
    project.services.forEach((s) => {
        if (!lp || s.name.toLowerCase().startsWith(lp)) {
            items.push({
                label: s.name,
                kind: CompletionItemKind.Class,
                detail: "Service",
                insertText: s.name,
                commitCharacters: ["."],
            });
        }
    });
    project.domains.forEach((d) => {
        if (!lp || d.name.toLowerCase().startsWith(lp)) {
            items.push({
                label: d.name,
                kind: CompletionItemKind.Class,
                detail: "Domain",
                insertText: d.name,
                commitCharacters: ["."],
            });
        }
    });
    return items;
}

function controllerScopeCompletions(): CompletionItem[] {
    const scope = [
        { label: "params", detail: "Map — request parameters" },
        { label: "request", detail: "HttpServletRequest" },
        { label: "response", detail: "HttpServletResponse" },
        { label: "session", detail: "HttpSession" },
        { label: "flash", detail: "Map — flash scope" },
        { label: "render", detail: "render(view, model, text…)" },
        { label: "redirect", detail: "redirect(action, controller…)" },
        { label: "chain", detail: "chain(action, model…)" },
        { label: "log", detail: "Logger" },
        { label: "grailsApplication", detail: "GrailsApplication" },
    ];
    return scope.map((s) => ({
        label: s.label,
        kind: CompletionItemKind.Variable,
        detail: s.detail,
    }));
}

function renderRedirectKeyCompletions(): CompletionItem[] {
    const keys = [
        { label: "view:", detail: "GSP view name" },
        { label: "model:", detail: "Model map" },
        { label: "action:", detail: "Action name" },
        { label: "controller:", detail: "Controller name" },
        { label: "template:", detail: "GSP template (_partial)" },
        { label: "text:", detail: "Plain text response" },
        { label: "contentType:", detail: "MIME type" },
        { label: "encoding:", detail: "Character encoding" },
        { label: "status:", detail: "HTTP status code" },
        { label: "url:", detail: "Full URL redirect" },
        { label: "uri:", detail: "URI redirect" },
        { label: "permanent:", detail: "301 vs 302" },
    ];
    return keys.map((k) => ({
        label: k.label,
        kind: CompletionItemKind.Keyword,
        detail: k.detail,
        insertText: k.label,
    }));
}

// ─── Punto de entrada principal ───────────────────────────────────────────────

export function getCompletions(
    doc: TextDocument,
    params: TextDocumentPositionParams,
    project: GrailsProject | null,
): CompletionItem[] {
    const text = doc.getText();
    const offset = doc.offsetAt(params.position);
    const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
    const lineUpTo = text.slice(lineStart, offset);

    if (!project) return controllerScopeCompletions();

    const ctx = detectContext(lineUpTo, project);

    switch (ctx.kind) {
        case "import":
            return importCompletions(project);

        case "string_controller":
            return controllerNameCompletions(project);

        case "string_action":
            return actionNameCompletions(
                ctx.targetController,
                project,
                doc.uri.replace(/^file:\/\//, ""),
            );

        case "string_view":
            return viewPathCompletions(
                project,
                doc.uri.replace(/^file:\/\//, ""),
            );

        case "render_redirect_key":
            return renderRedirectKeyCompletions();

        case "gorm_static":
            return ctx.domainName
                ? gormStaticCompletions(ctx.domainName, project)
                : [];

        case "gorm_static_and":
            return ctx.domainName
                ? gormStaticAndCompletions(
                      ctx.domainName,
                      ctx.andPrefix ?? "",
                      project,
                  )
                : [];

        case "gorm_instance":
            return ctx.instanceType
                ? gormInstanceCompletions(ctx.instanceType, project, text)
                : [];

        case "controller_static":
            return ctx.controllerName
                ? controllerMethodCompletions(ctx.controllerName, project)
                : [];

        case "service_injection":
            return ctx.serviceName
                ? serviceMethodCompletions(ctx.serviceName, project)
                : [];

        case "artifact_name":
            return artifactNameCompletions(ctx.partialName, project);

        case "domain_name":
            return ctx.domainName
                ? gormStaticCompletions(ctx.domainName, project)
                : [];

        case "generic_grails":
        default:
            return [
                ...controllerScopeCompletions(),
                ...artifactNameCompletions(undefined, project),
            ];
    }
}
