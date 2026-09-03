import "server-only";

import type { ClassifierAvailability } from "@eia/domain";

/**
 * What the Social surface says when assisted coding cannot run (IG4-001).
 *
 * Each reason gets its own sentence, because they mean different things to the person reading:
 * one is a project that never had it, one is a deployment that must not use the test classifier,
 * one is an external credential somebody has to supply. All three say the same second thing —
 * deterministic tabulation is unaffected — because that is the part a specialist can act on today.
 *
 * The copy names no variable, no key and no provider account: it is what a specialist sees, and
 * the operator-facing `detail` stays in the logs.
 */
export function aiStatusFor(availability: ClassifierAvailability): {
  readonly available: boolean;
  readonly note: string;
} {
  if (availability.state === "AVAILABLE") return { available: true, note: "" };

  const unaffected =
    " La tabulación determinista no depende de un modelo y sigue disponible en la pestaña " +
    "Tabulación.";

  switch (availability.reason) {
    case "NOT_CONFIGURED":
      return {
        available: false,
        note:
          "La codificación asistida no está configurada en este entorno, así que no se pueden " +
          "crear ejecuciones." +
          unaffected,
      };
    case "FAKE_REFUSED_IN_PERSISTENT_ENVIRONMENT":
      return {
        available: false,
        note:
          "Este entorno tiene configurado el clasificador determinista de pruebas, que no puede " +
          "ejecutarse aquí: sus propuestas serían indistinguibles de las de un modelo real." +
          unaffected,
      };
    case "BLOCKED_EXTERNAL_CONFIG":
      return {
        available: false,
        note:
          "El proveedor de modelos no está disponible: falta configuración externa. No se " +
          "sustituye por un clasificador simulado." +
          unaffected,
      };
  }
}
