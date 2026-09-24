# Demostración — 25 de septiembre de 2026

Guion para presentar. Dos mitades: la web, que está lista y verificada; y el teléfono, que se
ensaya en el emulador antes de enseñarlo.

**Lo que se demuestra:** que un estudio se organiza en el producto, que el mismo instrumento se
aplica a varios proyectos, y que una captura de campo sobrevive a quedarse sin señal.

**Lo que no se demuestra, y conviene decirlo antes de que lo pregunten:** las fotografías no llegan
al servidor — el almacenamiento de objetos no está configurado —, y el ensayo en emulador **no
sustituye** a la prueba en un teléfono real.

---

## Antes de empezar

| | |
|---|---|
| Dirección | `https://eia-field-uat.vercel.app` |
| Organización | **Demo 8 Proyectos** (`demo-ocho-proyectos`) |
| Coordinadora | `coordinadora.demo@demo.invalid` |
| Técnico de campo | `tecnico.demo8@demo.invalid` |
| Contraseña | `~/.eia-demo-25sep-password` en el portátil. No está en el repositorio ni en ningún registro |
| APK | build EAS `b49327fb-c77c-44b9-b49a-9e41c0305bd9` · 1.0.0 · versionCode 2 |

El estudio real — *Vía Puente del Amor – Los Hachos* — vive en **otra organización** y no aparece
en esta demostración. Es deliberado: ocho simulaciones junto a un estudio real, distinguibles solo
por una etiqueta, es exactamente la confusión que este producto existe para evitar.

### Contadores de partida — Proyecto 1

Anotar antes de tocar el teléfono. Son el «antes» contra el que se comprueba el «después».

| | |
|---|---|
| Visitas | **0** |
| Respuestas (`SurveyInstance`) | **0** |
| Answers | **0** |
| Correcciones | **0** |
| Asignaciones PENDING | **12** |
| IN_PROGRESS · COMPLETED | **0** · **0** |

Para releerlos en cualquier momento: `pnpm demo:eight-projects` (es idempotente; informa y no
cambia nada que ya exista).

---

## Parte A — La web

**1. Entrar** como la coordinadora. La cabecera dice *Demo 8 Proyectos*: la organización es la
primera cosa visible en toda la pantalla, y en esta demostración es también la que dice que nada de
lo que sigue es un estudio real.

**2. La cartera.** Ocho proyectos, *Proyecto 1* a *Proyecto 8*.

> Decirlo en voz alta: **son identificadores de simulación, no carreteras.** No se ha inventado
> ningún nombre de vía, ningún propietario y ninguna dirección. Un producto que rellena la pantalla
> con carreteras que no existe enseña a confiar en pantallas que no significan nada.

**3. Abrir Proyecto 1.** El Centro de control, con el trabajo de campo de este proyecto.

**4. La campaña.** *Operativo de demostración*, activa, canal **EIA Field** y modo sin conexión
**requerido** — que es lo que autoriza a capturar con el teléfono.

**5. El cuestionario.** *Ficha social — demostración*, versión **v1**, publicada: **7 preguntas** y
**15 opciones**. Una versión publicada no se edita nunca; una corrección es la versión siguiente.

**6. El mismo instrumento en los ocho.** Abrir *Proyecto 2* y enseñar el mismo cuestionario.

> El detalle que vale la pena: no son ocho cuestionarios parecidos. Los ocho tienen la **misma
> huella de definición** (`a243b8e3…`), calculada sobre códigos, tipos, orden, obligatoriedad y
> opciones. Si alguien cambiara una coma en uno, la huella cambiaría y `pnpm demo:eight-projects`
> lo diría.

**7. El trabajo pendiente.** Volver a Proyecto 1: **12 predios asignados**, `DEMO-P001` a
`DEMO-P012`, ninguno capturado todavía.

---

## Parte B — El teléfono

Primero se ensaya en el emulador. Reservar dos predios:

| | |
|---|---|
| `DEMO-P001` | captura **con conexión** |
| `DEMO-P002` | captura **sin conexión** |

### B.1 — Con conexión

1. Instalar el APK en un emulador **limpio** — instalación nueva, sin datos previos.
2. Iniciar sesión como el técnico.
3. Pulsar **Actualizar trabajo asignado**.

> Aquí está lo que se arregló ayer. Una instalación nueva no tenía forma de conseguir su primer
> paquete de trabajo: la aplicación deducía el proyecto del paquete que ya tenía, y en un teléfono
> recién instalado no hay ninguno. Ahora pregunta primero *¿el trabajo de quién vengo a hacer?*, y
> el servidor responde con el único proyecto donde este técnico tiene trabajo.

4. Aparecen los 12 predios.
5. Abrir `DEMO-P001` → **Iniciar visita** → conceder la ubicación → responder → enviar.
6. Sincronizar.
7. En la web: la respuesta está en Proyecto 1. Visitas **1**, respuestas **1**.

### B.2 — Sin conexión

Esta es la parte que justifica que exista una aplicación nativa.

1. Asegurarse de que `DEMO-P002` ya está descargado en el dispositivo.
2. **Cortar la red del emulador.** Comprobar que el host de UAT no responde desde él.
3. Abrir `DEMO-P002` → iniciar visita → responder → **guardar borrador**.
4. **Forzar el cierre de la aplicación**:

```bash
adb shell am force-stop ec.eiastudio.field
```

5. Reabrir **todavía sin conexión**. El borrador sigue ahí, con sus respuestas.

> Esto es lo que se enseña, no el hecho de que la pantalla se pinte: la base local está cifrada con
> SQLCipher y el borrador sobrevive a que el sistema operativo mate el proceso. Es lo que separa a
> una aplicación de campo de una página web guardada en favoritos.

6. Completar y **enviar en local**. La fila dice *enviada en el dispositivo · pendiente de
   sincronización* — dice la verdad sobre las dos cosas a la vez.
7. Restaurar la red. Sincronizar.
8. En la web: la respuesta aparece en Proyecto 1.
9. **Sincronizar otra vez.**

> Y aquí el remate: **no se crea nada**. Ni una visita de más, ni una respuesta de más, ni una
> answer de más. La misma orden enviada dos veces produce un resultado y un conjunto de filas.

### Después: los contadores

| | Antes | Después de B.1 y B.2 |
|---|---|---|
| Visitas | 0 | **2** |
| Respuestas | 0 | **2** |
| PENDING | 12 | **10** |

Y tras la segunda sincronización, exactamente los mismos números.

---

## Si preguntan

**«¿Y las fotografías?»** — La captura local funciona; la subida al servidor no, porque el
almacenamiento de objetos todavía no está configurado. Es una acción pendiente del propietario, no
un defecto de la aplicación. No forma parte de la aceptación de hoy.

**«¿Está probado en un teléfono real?»** — No. Hoy se ve en emulador. La prueba en equipo físico
está escrita paso a paso en `FIELD_MOBILE_OFFLINE_UAT.md` y espera un aparato.

**«¿Estos son los ocho estudios?»** — No. Son ocho identificadores de simulación para enseñar cómo
se organiza el trabajo. Los estudios reales se cargan con *Preparar proyecto*, y el primero real ya
está en el producto, en otra organización.

**«¿Hay inteligencia artificial aquí?»** — No en esta demostración. Ningún modelo está habilitado
en ningún entorno que este repositorio controle.

---

## Volver a dejarlo como estaba

El sembrado es idempotente y no borra nada. Para repetir la demostración desde cero hay que
retirar las capturas hechas durante el ensayo; el sembrado por sí solo no las deshace, porque una
respuesta enviada no se borra — esa es justamente la regla del producto.
