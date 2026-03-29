# Grails Support for Zed

[![License](https://img.shields.io/badge/License-GPL%20v3-red)](LICENSE)
![Grails](https://img.shields.io/badge/Grails-2.x%20–%207%2B-green)
![Zed](https://img.shields.io/badge/Zed-0.140+-blue)

Soporte avanzado para el desarrollo de aplicaciones **Grails/Groovy** en el editor [Zed](https://zed.dev). Compatible con Grails 2.x hasta 7+.

---

## Características

### Autocompletado inteligente (LSP)

- **Domain Classes y GORM** — propiedades, `findBy*`, `findAllBy*`, chaining `findByXAnd...`, métodos estáticos (`list`, `get`, `count`) y métodos de instancia (`save`, `delete`, `validate`)
- **Servicios** — métodos parseados en tiempo real al escribir `miServicio.` o `MiService.`
- **Controllers** — acciones al escribir `MiController.`, y `render`/`redirect` con sus named arguments
- **Vistas GSP** — al escribir `view: "` muestra las vistas disponibles del controller
- **Imports** — al escribir `import com.mipaquete.` autocompleta con artefactos del proyecto
- Soporte de métodos con modificadores: `def`, `public static`, `private`, `protected`, con tipo de retorno

### Go-to-Definition (Ctrl+Click / Cmd+Click)

| Cursor sobre | Navega a |
|---|---|
| Nombre de Domain Class | Archivo del dominio |
| `book.title` | Línea exacta de `String title` en el dominio |
| `render(view: 'show')` | `views/book/show.gsp` |
| `render(template: 'row')` | `views/book/_row.gsp` |
| `redirect(action: 'logIn')` | `def logIn()` en el mismo controller |
| `redirect(controller: 'book', action: 'show')` | `def show()` en `BookController` |
| `securityService.registerMember(` | Línea exacta del método en `SecurityService` |
| `SwaggerController.oauth2Redirect(` | Línea exacta del método en `SwaggerController` |
| `def bookService` | `BookService.groovy` |
| Tag GSP `<g:render template="row">` | `_row.gsp` |

### Resaltado de sintaxis

- **Groovy** — keywords, tipos, anotaciones, closures, operadores GDK (`?.`, `?:`, `*.`, `=~`, `<=>`)
- **GSP** — tags `<g:...>`, scriptlets `<% %>`, expresiones `${}`, atributos

---

## Instalación

### Desde el registro de extensiones de Zed

1. Abre Zed
2. `Cmd+Shift+X` (Mac) / `Ctrl+Shift+X` (Linux) → Extensions
3. Busca **"Grails Support"**
4. Instalar

### Como dev extension (desarrollo local)

```bash
git clone https://github.com/Johan070119/Grails-Zed-Extension
cd Grails-Zed-Extension

# Compilar el servidor LSP
cd server && npm install && npm run compile && cd ..
```

En Zed: `Extensions → Install Dev Extension` → seleccionar la carpeta del repositorio.

---

## Arquitectura

```
Zed
 └── grails (WASM — Rust compilado)
      └── lanza: node server/dist/server.js --stdio
               ├── grailsProject.ts  — indexa dominios, controllers, services
               ├── completion.ts     — autocompletado contextual
               ├── definition.ts     — go-to-definition
               └── indexer.ts        — watcher con debounce 300ms
```

La extensión está dividida en dos capas:

- **Capa WASM** (`src/lib.rs`): código Rust compilado a WebAssembly que corre dentro de Zed. Solo tiene una responsabilidad: instalar el servidor LSP desde npm y lanzarlo.
- **Servidor LSP** (`server/`): proceso Node.js independiente que analiza el proyecto Grails y responde peticiones de autocompletado y navegación. Este código es esencialmente el mismo servidor que usa la [extensión para VS Code](https://github.com/Johan070119/Grails-VsCode-Extension).

---

## Requisitos

- Zed 0.140.0 o superior
- Node.js 18+ (para el servidor LSP)
- Un proyecto que contenga `grails-app/`

El servidor LSP se instala automáticamente desde npm la primera vez que abres un proyecto Grails.

---

## Contribuir

1. Fork el repositorio
2. `git checkout -b feature/mi-mejora`
3. Para compilar el servidor: `cd server && npm run compile`
4. Para probar como dev extension: Extensions → Install Dev Extension en Zed
5. Ver logs del servidor: `zed --foreground` en la terminal
6. Pull Request

---

## Licencia

GPL v3 — ver [LICENSE](LICENSE) para los términos completos.
