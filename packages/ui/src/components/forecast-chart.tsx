import { formatIsoDateShort } from "../format";
import styles from "./forecast-chart.module.css";

/**
 * Daily completions over the observed window. It is a plain bar series, not a trend model: the
 * highlighted bars are simply the days that enter the moving average (invariant 5). Rendered as
 * inline SVG with a text alternative, so the figure is available without colour or vision.
 */
export function ForecastChart({
  values,
  highlightLast,
  startDate,
  endDate,
  label,
}: {
  values: ReadonlyArray<number>;
  highlightLast: number;
  startDate: string;
  endDate: string;
  label: string;
}) {
  const max = Math.max(1, ...values);
  const width = 100;
  const gap = 1.6;
  const barWidth = values.length > 0 ? (width - gap * (values.length - 1)) / values.length : width;
  const firstHighlighted = Math.max(0, values.length - highlightLast);

  return (
    <figure className={styles.figure}>
      <svg
        className={styles.svg}
        role="img"
        aria-label={`${label}. Serie: ${values.join(", ")}.`}
        viewBox={`0 0 ${width} 40`}
        preserveAspectRatio="none"
      >
        {values.map((value, index) => {
          const height = (value / max) * 40;
          return (
            <rect
              key={index}
              x={index * (barWidth + gap)}
              y={40 - height}
              width={barWidth}
              height={height}
              className={index >= firstHighlighted ? styles.barActive : styles.bar}
            />
          );
        })}
      </svg>
      <figcaption className={styles.caption}>
        <span>{formatIsoDateShort(startDate)}</span>
        <span>{formatIsoDateShort(endDate)}</span>
      </figcaption>
    </figure>
  );
}
