"use client";

import styles from "./portal.module.css";

/**
 * Printing is the browser's, deliberately.
 *
 * The original decision said the client wants something they can take to a council session; a
 * print stylesheet gives them that on any device, today, with no rendering service, no queue and
 * no second copy of the layout to keep in step. A PDF subsystem for one page would be a product.
 */
export function PrintButton() {
  return (
    <button className={styles.printButton} onClick={() => window.print()} type="button">
      Imprimir resumen
    </button>
  );
}
