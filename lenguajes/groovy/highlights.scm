; ─────────────────────────────────────────────────────────────
;  Grails/Groovy syntax highlights  (Tree-sitter queries)
;  Nota: requiere la grammar "groovy" en el sistema.
;  Zed usa el grammar de Java como fallback hasta que exista un
;  grammar Tree-sitter oficial de Groovy.
; ─────────────────────────────────────────────────────────────

; Palabras clave del lenguaje
[
  "class"
  "interface"
  "enum"
  "extends"
  "implements"
  "import"
  "package"
  "return"
  "new"
  "instanceof"
  "this"
  "super"
  "throw"
  "throws"
  "try"
  "catch"
  "finally"
  "if"
  "else"
  "for"
  "while"
  "do"
  "switch"
  "case"
  "default"
  "break"
  "continue"
  "static"
  "final"
  "abstract"
  "private"
  "protected"
  "public"
  "void"
  "null"
  "true"
  "false"
  "in"
  "as"
  "def"
  "trait"
] @keyword

; Tipos primitivos y comunes
[
  "int"
  "long"
  "double"
  "float"
  "boolean"
  "byte"
  "char"
  "short"
  "String"
  "Integer"
  "Long"
  "Double"
  "Boolean"
  "List"
  "Map"
  "Set"
  "Object"
  "Date"
  "BigDecimal"
] @type.builtin

; Anotaciones Grails/Groovy
(annotation
  name: (identifier) @attribute)

; Declaraciones de clase
(class_declaration
  name: (identifier) @type)

(interface_declaration
  name: (identifier) @type)

(enum_declaration
  name: (identifier) @type)

; Métodos
(method_declaration
  name: (identifier) @function.method)

(method_invocation
  name: (identifier) @function.method)

; Nombres de campo/propiedad
(field_declaration
  declarator: (variable_declarator
    name: (identifier) @variable.member))

; Literales string
(string_literal) @string
(multiline_string_literal) @string

; Literales numéricos
(integer_literal) @number
(floating_point_literal) @number

; Comentarios
(line_comment) @comment
(block_comment) @comment

; Imports
(import_declaration
  (scoped_identifier) @namespace)

; Package
(package_declaration
  (scoped_identifier) @namespace)

; Closures Groovy { ... }
(closure) @punctuation.bracket

; GString interpolación ${}
(gstring_expression) @embedded

; Operadores
[
  "="
  "=="
  "!="
  "<"
  ">"
  "<="
  ">="
  "&&"
  "||"
  "!"
  "+"
  "-"
  "*"
  "/"
  "%"
  "++"
  "--"
  "+="
  "-="
  "*="
  "/="
  "?."
  "?:"
  "*.'"
  "=~"
  "==~"
  "<=>"
  ".."
  "..<"
] @operator
