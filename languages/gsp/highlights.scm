; ─────────────────────────────────────────────────────────────
;  GSP (Grails Server Pages) syntax highlights
;  Hereda del grammar HTML. Añade reglas para tags g: y bloques <% %>
; ─────────────────────────────────────────────────────────────

; Tags Grails (<g:if>, <g:each>, <g:render>, etc.)
(tag_name) @tag

; Atributos HTML/GSP
(attribute_name) @attribute

; Valores de atributos
(attribute_value) @string

; Comentarios HTML <!-- -->
(comment) @comment

; Texto normal
(text) @text

; Entidades HTML &amp; &lt; etc.
(entity) @constant

; Scriptlet GSP <% ... %>  →  tratado como embedded
(raw_text) @embedded

; Expresión GSP ${...}
; Aunque el grammar HTML lo ve como texto, lo marcamos como embedded
; para indicar código Groovy embebido.
