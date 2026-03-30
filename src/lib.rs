use zed_extension_api::{self as zed, LanguageServerId, Result, Worktree};

// Nombre del paquete npm que se publicará con el servidor LSP.
// Mientras no esté publicado en npm, el binario se busca en el PATH del usuario.
const SERVER_PACKAGE: &str = "grails-language-server";
const SERVER_PATH: &str = "node_modules/.bin/grails-language-server";

struct GrailsExtension {
    cached_server_path: Option<String>,
}

impl GrailsExtension {
    /// Devuelve la ruta al ejecutable del servidor LSP.
    ///
    /// Estrategia de resolución (en orden de prioridad):
    ///
    /// 1. Binario global en el PATH del sistema (`grails-language-server`).
    ///    → El usuario puede instalar el paquete con `npm install -g grails-language-server`.
    ///
    /// 2. Instalación local vía npm gestionada por Zed (dentro del directorio de la extensión).
    ///    → Se descarga automáticamente si no existe o si hay una versión nueva disponible.
    ///
    /// Este patrón es idéntico al que usa la extensión oficial de PHP (Intelephense) en Zed.
    fn server_script_path(&mut self, worktree: &Worktree) -> Result<String> {
        // 1. Preferir binario global instalado por el usuario
        if let Some(path) = worktree.which("grails-language-server") {
            return Ok(path);
        }

        // 2. Instalación npm local gestionada por la extensión
        let installed_version = zed::npm_package_installed_version(SERVER_PACKAGE)?;
        let latest_version = zed::npm_package_latest_version(SERVER_PACKAGE)?;

        let needs_install = match &installed_version {
            Some(v) => v != &latest_version,
            None => true,
        };

        if needs_install {
            eprintln!(
                "[Grails LSP] Installing {} v{} ...",
                SERVER_PACKAGE, latest_version
            );
            zed::npm_install_package(SERVER_PACKAGE, &latest_version)?;
            eprintln!("[Grails LSP] Installation complete.");
        }

        Ok(SERVER_PATH.to_string())
    }
}

impl zed::Extension for GrailsExtension {
    fn new() -> Self {
        GrailsExtension {
            cached_server_path: None,
        }
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &LanguageServerId,
        worktree: &Worktree,
    ) -> Result<zed::Command> {
        // Resolver la ruta del servidor (con caché para evitar consultas npm repetidas)
        let server_path = if let Some(ref cached) = self.cached_server_path {
            cached.clone()
        } else {
            let path = self.server_script_path(worktree)?;
            self.cached_server_path = Some(path.clone());
            path
        };

        // El servidor LSP se ejecuta con Node.js en modo --stdio (estándar LSP)
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![server_path, "--stdio".to_string()],
            env: vec![],
        })
    }

    /// Opciones de inicialización que Zed envía al servidor LSP en el handshake.
    /// En nuestro caso el servidor no necesita opciones especiales, pero dejamos
    /// el hook para poder añadir configuración futura (e.g. versión de Grails forzada).
    fn language_server_initialization_options(
        &mut self,
        _language_server_id: &LanguageServerId,
        _worktree: &Worktree,
    ) -> Result<Option<zed::serde_json::Value>> {
        Ok(Some(zed::serde_json::json!({
            "trace": "off"
        })))
    }

    /// Formatea los ítems de autocompletado con resaltado de sintaxis.
    /// Añade el sufijo de tipo (domain, controller, service, method…) como
    /// texto secundario para que el usuario identifique el origen del símbolo.
    fn label_for_completion(
        &self,
        _language_server_id: &LanguageServerId,
        completion: zed::lsp::Completion,
    ) -> Option<zed::CodeLabel> {
        // Usamos el detail del ítem (p.ej. "BookService", "String", "Domain") como
        // texto del label principal seguido del kind LSP como anotación.
        let label = completion.label.clone();
        let detail = completion.detail.clone().unwrap_or_default();

        // Devolvemos None para que Zed use el comportamiento por defecto si
        // no hay información extra. Con detail lo enriquecemos.
        if detail.is_empty() {
            return None;
        }

        Some(zed::CodeLabel {
            code: format!("{} {}", label, detail),
            spans: vec![zed::CodeLabelSpan::code_range(0..label.len())],
            filter_range: (0..label.len()).into(),
        })
    }
}

zed::register_extension!(GrailsExtension);
