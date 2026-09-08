import { useSearchParams } from "react-router-dom";

/**
 * Pieces both database tables share, so the player and club tables can't drift
 * into two different-looking things.
 */

/**
 * Which block of columns is showing, held in the URL rather than in state.
 *
 * Two reasons, in order: a sorted, filtered view is worth being able to link
 * to, and a render test can reach the widest column set — measuring only the
 * narrow default would leave the wide one, which is what a DOM budget is
 * actually for, unguarded. The first entry is the default, and anything
 * unrecognised falls back to it rather than rendering a blank table.
 */
export function useColumnSet<T extends string>(options: readonly T[]): [T, (next: T) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("cols");
  const current = options.includes(raw as T) ? (raw as T) : options[0];
  const set = (next: T) => {
    const updated = new URLSearchParams(params);
    if (next === options[0]) updated.delete("cols");
    else updated.set("cols", next);
    setParams(updated, { replace: true });
  };
  return [current, set];
}

/** The column-set switch, shared by both tables so the two read the same. */
export function ColumnSetPills<T extends string>({
  options, value, onChange,
}: {
  options: readonly { key: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <ul className="nav nav-pills">
      {options.map((c) => (
        <li className="nav-item" key={c.key}>
          <button
            type="button"
            className={`nav-link ${value === c.key ? "active" : ""}`}
            onClick={() => onChange(c.key)}
          >
            {c.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
