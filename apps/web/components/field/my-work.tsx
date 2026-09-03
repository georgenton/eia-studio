import type { MyAssignment } from "@eia/application";
import { ASSIGNMENT_STATUS_PRESENTATION, formatChainage, INSTANCE_STATUS_LABEL } from "@eia/domain";
import { formatCount } from "@eia/ui";

import styles from "./my-work.module.css";

/**
 * The technician's list — the one screen this slice designs for a phone first.
 *
 * It is deliberately **not** the coordinator dashboard at a narrow width. A technician standing at
 * a gate needs the parcel code, where it is, what state the work is in, and one obvious thing to
 * press. Campaign totals, workload tables and progress percentages are somebody else's question and
 * would be noise here.
 *
 * Every assignment shown is the technician's own: `loadMyWork` filters on the caller's user id and
 * the RLS policy denies another technician's row underneath. This list is a *view* of that, never
 * the thing enforcing it.
 */
export function MyWork({
  assignments,
  assignmentPath,
}: {
  assignments: ReadonlyArray<MyAssignment>;
  assignmentPath: (assignmentId: string) => string;
}) {
  if (assignments.length === 0) {
    return (
      <div className={styles.empty} data-system-state="empty">
        <h1 className={styles.title}>Mi trabajo</h1>
        <p className={styles.emptyNote}>
          No tienes asignaciones en campañas activas. Cuando el coordinador te asigne predios,
          aparecerán aquí.
        </p>
      </div>
    );
  }

  const pending = assignments.filter((a) => a.status !== "COMPLETED").length;

  return (
    <div className={styles.surface}>
      <header className={styles.header}>
        <h1 className={styles.title}>Mi trabajo</h1>
        <p className={styles.summary}>
          {formatCount(assignments.length)} asignaciones · {formatCount(pending)} por completar
        </p>
      </header>

      <ul className={styles.list}>
        {assignments.map((assignment) => {
          const status = ASSIGNMENT_STATUS_PRESENTATION[assignment.status];
          const action =
            assignment.status === "COMPLETED"
              ? "Ver ficha enviada"
              : assignment.instanceId
                ? "Continuar ficha"
                : assignment.openVisitId && assignment.visitStatus === "IN_PROGRESS"
                  ? "Continuar visita"
                  : "Iniciar visita";
          return (
            <li key={assignment.id}>
              {/* The whole card is the target: a 44 px minimum is not enough on a phone held in
                  one hand, in the sun, wearing gloves. */}
              <a className={styles.card} href={assignmentPath(assignment.id)}>
                <div className={styles.cardHead}>
                  <span className={styles.code}>{assignment.parcelCode}</span>
                  <span className={`${styles.state} ${styles[assignment.status]}`}>
                    <span aria-hidden="true">{status.glyph}</span> {status.label}
                  </span>
                </div>
                <p className={styles.context}>
                  {assignment.sectorLabel ?? "Sin sector"}
                  {assignment.chainageM === null
                    ? ""
                    : ` · ABS ${formatChainage(assignment.chainageM)}`}
                </p>
                {assignment.instanceStatus ? (
                  <p className={styles.instance}>
                    Ficha: {INSTANCE_STATUS_LABEL[assignment.instanceStatus]}
                  </p>
                ) : null}
                <span className={styles.action}>{action}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
