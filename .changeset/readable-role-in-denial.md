---
"@eia/web": patch
---

El aviso de acceso denegado deja de imprimir el nombre interno del rol

Decía «Tu rol PROJECT_DATA_MANAGER no incluye las respuestas individuales de campo»: inglés, en
mayúsculas, sobre una pantalla que lee un consultor, y exactamente lo que ADR-025 prohíbe —un
valor almacenado no se muestra; se muestra su etiqueta—. Observado en staging el 19 de noviembre
de 2026 con la cuenta de Gestión de información.

Ahora se traduce con el catálogo que ya existía, en los dos idiomas: *Gestor de información*,
*Coordinación de proyecto*, *Cartografía / SIG*. El rol de proyecto tiene preferencia, porque es
el que corresponde a una pantalla de proyecto, y el de organización se usa donde no hay uno —un
administrador sin asignación lee «Tu rol Administración». Un valor desconocido no se imprime: el
lector recibe la frase genérica en vez de un identificador.

La prueba recorre todos los roles del modelo en los dos catálogos, así que un rol añadido más
adelante no puede colarse con su nombre interno a la vista.
