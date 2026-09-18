import type { RosterFileDownload } from "../rosterDownload.js";

/**
 * The Leagues page's "Roster files" section: every ready-made file the game
 * offers, in one place, with a line on what each one is for.
 *
 * These are downloads rather than something built in, for the reason
 * `rosterDownload.ts` gives (no real club, player or badge enters the repo or a
 * build). Each file is complete on its own, so the section only has to say
 * which one to pick and where to load it.
 *
 * Renders nothing when the build has no files to offer, rather than an empty
 * heading: a missing section is a missing feature, a section of dead buttons is
 * a bug report.
 */
export function RosterFilesSection({
  files,
  onImport,
}: {
  files: RosterFileDownload[];
  onImport: () => void;
}) {
  if (files.length === 0) return null;
  return (
    <section className="mt-4" aria-labelledby="roster-files-heading">
      <h2 id="roster-files-heading" className="h5 mb-1">
        Roster files
      </h2>
      <p className="text-muted small mb-2">
        Download one, then load it with{" "}
        <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={onImport}>
          Import
        </button>
        .
      </p>
      <ul className="list-group">
        {files.map((f) => (
          <li
            key={f.id}
            className="list-group-item d-flex flex-wrap gap-2 align-items-center justify-content-between"
          >
            <div style={{ flex: "1 1 20rem", minWidth: 0 }}>
              <div className="fw-semibold">{f.title}</div>
              <div className="text-muted small">{f.description}</div>
            </div>
            <a
              className="btn btn-outline-secondary btn-sm"
              href={f.href}
              target="_blank"
              rel="noopener noreferrer"
              download
            >
              Download <span className="text-muted">({f.size})</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
