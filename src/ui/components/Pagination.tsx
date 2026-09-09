/**
 * Page controls for a table that is deliberately capped.
 *
 * The database pages rank the whole world — 15,650 players and 626 clubs — and
 * this app's one known performance failure is DOM weight, not JavaScript: the
 * /transfers freeze was 10,684 elements and 2,066 flag images with a 147ms JS
 * render (see CLAUDE.md). So the tables page rather than scroll, and the count
 * beside the buttons is what tells you the rows you can't see still exist.
 */
interface Props {
  page: number;
  pageCount: number;
  /** Total rows across every page, for the "showing X-Y of Z" line. */
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  /** What the rows are, for the count line ("players", "clubs"). */
  noun: string;
}

export function Pagination({ page, pageCount, total, pageSize, onPage, noun }: Props) {
  const first = total === 0 ? 0 : page * pageSize + 1;
  const last = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="d-flex flex-wrap align-items-center gap-2 mt-2">
      <div className="btn-group btn-group-sm">
        <button
          type="button"
          className="btn btn-outline-secondary"
          disabled={page <= 0}
          onClick={() => onPage(0)}
        >
          First
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary"
          disabled={page <= 0}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary"
          disabled={page >= pageCount - 1}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary"
          disabled={page >= pageCount - 1}
          onClick={() => onPage(pageCount - 1)}
        >
          Last
        </button>
      </div>
      <span className="text-muted small">
        {total === 0
          ? `No ${noun} match these filters.`
          : `Showing ${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()} ${noun}`}
        {pageCount > 1 && ` · page ${page + 1} of ${pageCount.toLocaleString()}`}
      </span>
    </div>
  );
}
