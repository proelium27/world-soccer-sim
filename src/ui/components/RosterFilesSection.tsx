import type { RosterFileDownload } from "../rosterDownload.js";

/**
 * The Leagues page's "Roster files" section: every ready-made file the game
 * offers, in one place, with a line on what each one is for.
 *
 * These are downloads rather than something built in, for the reason
 * `rosterDownload.ts` gives (no real club, player or badge enters the repo or a
 * build). The section's job is to make that one extra step obvious: download
 * what you want, then pick all of it in Import together. Import sorts roster
 * files from badge packs by their contents, and the combine step keeps real
 * squads whichever order the files arrive in, so there is no load order to
 * explain here.
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
        Free downloads that swap the game's made-up clubs for real ones. Download the ones
        you want, press{" "}
        <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={onImport}>
          Import
        </button>
        , and pick them all at once. You'll choose your club on the next screen.
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
