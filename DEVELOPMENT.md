# Guía de Desarrollo — Grails Support for Zed

## Estructura del repositorio
```
grails-zed-extension/
│
├── extension.toml          ← Manifiesto principal (id, name, version)
├── Cargo.toml              ← Crate Rust compilado a WASM
├── grammars/
│   └── groovy.wasm         ← Grammar Tree-sitter precompilado para Groovy
│
├── src/
│   └── lib.rs              ← Lógica WASM: instala y lanza el servidor LSP
│
├── languages/
│   ├── groovy/
│   │   ├── config.toml     ← Configuración del lenguaje Groovy en Zed
│   │   ├── highlights.scm  ← Reglas Tree-sitter de resaltado
│   │   ├── brackets.scm    ← Resaltado de brackets coincidentes
│   │   ├── indents.scm     ← Reglas de indentación automática
│   │   ├── injections.scm  ← Inyección de lenguajes embebidos
│   │   └── outline.scm     ← Símbolos para el panel de outline
│   └── gsp/
│       ├── config.toml     ← Configuración del lenguaje GSP
│       └── highlights.scm  ← Reglas Tree-sitter de resaltado
│
└── server/                 ← Servidor LSP (Node.js/TypeScript)
    ├── package.json        ← Paquete npm: "grails-language-server"
    ├── tsconfig.json
    └── src/
        ├── server.ts       ← Punto de entrada LSP (stdio)
        ├── completion.ts   ← Autocompletado contextual
        ├── definition.ts   ← Go-to-Definition
        ├── grailsProject.ts← Indexador de artefactos
        ├── indexer.ts      ← Watcher de archivos
        └── uriUtils.ts     ← Conversión path ↔ URI
```

---

## Instalación desde el repositorio (para probar la extensión)

### Requisitos

- [Zed](https://zed.dev) 0.140.0 o superior
- [Rust](https://rustup.rs) (via rustup)
- Node.js 18+

### Pasos
```bash
# 1. Clonar el repositorio
git clone https://github.com/Johan070119/Grails-Zed-Extension
cd Grails-Zed-Extension

# 2. Instalar dependencias del servidor LSP
cd server && npm install && cd ..
```

El servidor LSP (`grails-language-server`) está publicado en npm y Zed lo
descargará automáticamente la primera vez que abras un proyecto Grails.
No es necesario compilarlo ni instalarlo manualmente.
```bash
# 3. Instalar como dev extension en Zed
#    Zed compilará el WASM automáticamente
```

En Zed: `Extensions → Install Dev Extension` → seleccionar la carpeta del repositorio.

### Verificar que funciona

Abre un proyecto Grails en Zed y revisa los logs:
```bash
cat ~/.local/share/zed/logs/Zed.log | grep -i "grails" | tail -15
```

Deberías ver:
```
[Grails] Project found at: /tu/proyecto
[Grails] Indexed (v2) — 80 domains, 3 controllers, 22 services, 0 taglibs
```

### Notas importantes sobre el resaltado de sintaxis

El grammar de Groovy (`grammars/groovy.wasm`) está incluido en el repositorio
precompilado. Zed lo usa directamente sin necesidad de descargarlo.

El grammar proviene de [murtaza64/tree-sitter-groovy](https://github.com/murtaza64/tree-sitter-groovy)
y tiene algunas limitaciones conocidas:

- Los comentarios de bloque `/* */` con el formato `* */` (espacio antes del cierre)
  pueden interrumpir el resaltado. Usa siempre `*/` sin espacio.
- El código comentado entre bloques `catch` puede causar pérdida de resaltado.
  Elimina el código comentado o muévelo fuera del bloque try/catch.

---

## Ciclo de desarrollo

### Cambios en el servidor LSP (TypeScript — lo más frecuente)
```bash
cd server

# Una sola vez
npm run compile

# O en modo watch
npm run watch
```

Después de recompilar, recargar la extensión en Zed:
`Cmd+Shift+P → zed: reload extensions`

### Cambios en el WASM (Rust — poco frecuente)

Zed recompila automáticamente el WASM al instalar la dev extension.
Para forzar una recompilación:
```bash
# Instalar el target WASM si no está
rustup target add wasm32-wasip1

# Compilar manualmente
cargo build --target wasm32-wasip1 --release
```

### Ver logs del servidor LSP
```bash
# Ver logs en tiempo real
cat ~/.local/share/zed/logs/Zed.log | grep -i "grails" | tail -20

# O arrancar Zed en foreground para ver todos los logs
zed --foreground
```

---

## Agregar logging temporal para debug

En cualquier archivo `.ts` del servidor, usar **`connection.console.log`**:
```typescript
// ✅ Correcto — usa el canal de logging del LSP
connection.console.log("[DEBUG] kind=" + ctx.kind);

// ❌ Evitar console.log — puede interferir con el protocolo LSP en stdio
```

---

## Cómo agregar un nuevo tipo de autocompletado

1. Agregar el nuevo `kind` al type `CompletionKind` en `completion.ts`
2. Agregar campos opcionales al interface `CompletionContext` si es necesario
3. Agregar la detección en `detectContext()` en el orden correcto (más específico primero)
4. Crear la función builder `miNuevoContextCompletions()`
5. Agregar el `case` en el `switch` de `getCompletions()`
6. Verificar que no rompe los casos de camelCase existentes

### Trampa crítica: regexes en template literals
```typescript
// ✅ Correcto en template literal (doble backslash)
new RegExp(`(?:def|\\w+)\\s+${methodName}\\s*\\(`)

// ❌ NUNCA usar \b en template literals — se convierte en \x08 (backspace)
new RegExp(`\\b${methodName}\\s*\\(`)  // BUG silencioso
```

---

## Cómo publicar una nueva versión

1. Actualizar `version` en `extension.toml`
2. Actualizar `version` en `server/package.json`
3. Agregar el shebang al servidor compilado y publicar en npm:
```bash
cd server
npm run compile
echo '#!/usr/bin/env node' | cat - dist/server.js > /tmp/server_tmp.js && mv /tmp/server_tmp.js dist/server.js
chmod +x dist/server.js
npm publish
```

4. Abrir PR en [zed-industries/extensions](https://github.com/zed-industries/extensions) actualizando el submodule y la versión en `extensions.toml`

---

## Diferencias con la extensión de VS Code

| Feature | VS Code | Zed |
|---|---|---|
| Autocompletado LSP | ✅ | ✅ |
| Go-to-Definition | ✅ | ✅ |
| Indexado automático | ✅ | ✅ |
| Resaltado de sintaxis | ✅ | ✅ |
| Árbol de proyecto | ✅ | ❌ (no hay API en Zed aún) |
| CodeLens en controllers | ✅ | ❌ (no hay API en Zed aún) |
| Comandos CLI integrados | ✅ | ❌ (usar Tasks de Zed) |
| Status bar con versión | ✅ | ❌ (no hay API en Zed aún) |
| Creación de artefactos | ✅ | ❌ |

Las features marcadas ❌ no tienen API pública en Zed Extensions actualmente.
El árbol de proyecto y los comandos se pueden configurar en Zed via `tasks.json`.

---

## Tasks de Zed (equivalente a los comandos CLI de VS Code)

Añadir en `.zed/tasks.json` dentro del proyecto Grails:
```json
[
  {
    "label": "Grails: Run App",
    "command": "grails run-app",
    "cwd": "$ZED_WORKTREE_ROOT"
  },
  {
    "label": "Grails: Run Tests",
    "command": "grails test-app",
    "cwd": "$ZED_WORKTREE_ROOT"
  },
  {
    "label": "Grails: Clean",
    "command": "grails clean",
    "cwd": "$ZED_WORKTREE_ROOT"
  },
  {
    "label": "Grails: Compile",
    "command": "grails compile",
    "cwd": "$ZED_WORKTREE_ROOT"
  }
]
```

Ejecutar con `Cmd+Shift+P → task: spawn` o asignando keybindings.
