import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listLeagues, deleteLeague, loadLeague } from "../../db/leagueDb.js";
import { exportLeagueJSON, readLeagueFileText } from "../../db/exportImport.js";
import { loadCrests } from "../../db/crestDb.js";
import { useLeague } from "../context/LeagueContext.js";
import { useSportName } from "../sportName.js";
import { TeamIdentityEditor, type EditableTeam } from "../components/TeamIdentityEditor.js";
import { parseRosterFile, isRosterFileFormat } from "../../core/teams/rosterFile.js";
import { parseLogoPack, isLogoPackFormat } from "../../core/teams/logoPack.js";
import { buildLeagueFile, type LeagueFileExportOptions } from "../../core/teams/leagueFile.js";
import { setPendingRoster } from "../pendingRoster.js";
import { ROSTER_FILES } from "../rosterDownload.js";
import { RosterFilesSection } from "../components/RosterFilesSection.js";
import { CopyAiPromptButton } from "../components/CopyAiPromptButton.js";
import { competitionTeamCount, worldCompetitions, worldTeamSlots } from "../../core/competitions.js";

interface LeagueSummary {
  lid: number;
  name: string;
  created: number;
  season: number;
}

interface TeamEditor {
  lid: number;
  leagueName: string;
  userTid: number;
  teams: EditableTeam[];
  competitions: { id: number; name: string }[];
}

/** The shipped world's size, for the intro below. Computed once at load. */
const WORLD_SIZE = (() => {
  const comps = worldCompetitions();
  return {
    leagues: comps.length,
    countries: new Set(comps.map((c) => c.country)).size,
    clubs: comps.reduce((n, c) => n + competitionTeamCount(c), 0),
  };
})();

/**
 * What a first-time visitor sees instead of an empty save list. Doubles as the
 * site's only real homepage copy, so it's plain prose rather than UI chrome.
 */
function FirstRunIntro({ brand }: { brand: string }) {
  return (
    <header className="mb-4">
      <h1 className="h2 mb-3">{brand}</h1>
      <p>
        A free soccer management game that runs right here in your browser. Take
        over a club, pick the lineup, work the transfer market, and see how far
        you can take them. No account and no download, and your saves stay on
        this device.
      </p>
      <ul className="text-muted">
        {/* Counted off the shipped world rather than typed in: this line went
            two world expansions out of date when it was a literal. */}
        <li>
          {WORLD_SIZE.leagues} leagues across {WORLD_SIZE.countries} countries,{" "}
          {WORLD_SIZE.clubs} clubs, promotion and relegation
        </li>
        <li>A transfer market where rival clubs value players the same way you do</li>
        <li>A youth academy, scouting reports, contracts, and a budget that has to balance</li>
        <li>Continental cups in Europe and the Americas, and a World Cup every four years</li>
      </ul>
      <p className="text-muted">
        New to it? The{" "}
        {/* Underlined on purpose: inside muted text the link colour alone
            doesn't carry enough contrast to be distinguishable. */}
        <Link to="/manual" className="text-decoration-underline">
          manual
        </Link>{" "}
        explains how everything works, or just start a league below and find out
        as you go.
      </p>
    </header>
  );
}

export function Leagues() {
  const [leagues, setLeagues] = useState<LeagueSummary[] | null>(null);
  const [editor, setEditor] = useState<TeamEditor | null>(null);
  const [saving, setSaving] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  // Which save's "Export League File" options are open, if any. One at a time:
  // the panel opens under its own row, and two open at once reads as one
  // export covering both.
  const [shareFor, setShareFor] = useState<number | null>(null);
  const [shareOptions, setShareOptions] = useState<LeagueFileExportOptions>({ squads: true, logos: true });
  const [sharing, setSharing] = useState(false);
  // Built once: it is a pure constant, and worldTeamSlots walks all 626 slots.
  const defaultWorld = useMemo(() => {
    const competitions = worldCompetitions();
    return { competitions, teams: worldTeamSlots(competitions) };
  }, []);
  const { loadLeagueAction, customizeTeamsAction, importJSON } = useLeague();
  const navigate = useNavigate();
  const { brand } = useSportName();

  // Nobody has a save here yet, so this is somebody's first look at the game
  // (and it's the page search engines land on). Lead with what the game is
  // instead of an empty list. Once there's a save it goes back to being the
  // plain picker.
  const firstRun = leagues !== null && leagues.length === 0;

  useEffect(() => {
    refresh();
  }, []);

  function refresh() {
    listLeagues().then(setLeagues);
  }

  async function handleEnter(lid: number) {
    await loadLeagueAction(lid);
    navigate("/dashboard");
  }

  async function handleDelete(lid: number) {
    if (!confirm("Delete this league? This cannot be undone.")) return;
    await deleteLeague(lid);
    refresh();
  }

  async function handleCustomize(lid: number) {
    const league = await loadLeague(lid);
    if (!league) return;
    setEditor({
      lid,
      leagueName: league.meta.name,
      userTid: league.meta.userTid,
      teams: league.teams.map((t) => ({
        tid: t.tid,
        compId: t.compId,
        name: t.name,
        abbrev: t.abbrev,
        colors: [...t.colors] as [string, string],
      })),
      competitions: league.competitions,
    });
  }

  /** Download the whole save (the same file the in-game "Export Save" writes). */
  async function handleExportSave(lid: number) {
    const league = await loadLeague(lid);
    if (!league) return;
    // Read for this lid rather than taken from the context: this button exports
    // ANY save on the page, not the active one, so the badges in memory belong
    // to a different league as often as not.
    await exportLeagueJSON(league, await loadCrests(lid));
  }

  /**
   * Download a save's clubs as a league file: names, colors and, if ticked,
   * squads and custom badges, in the same format Import reads. Unlike Export
   * Save this is a file to share or edit, not a backup: it starts a NEW league
   * with these clubs, carrying none of the save's history.
   *
   * Written as plain JSON rather than gzipped like a save, because the point of
   * the format is that a person (or an AI) can open it and edit it. Import
   * reads either.
   */
  async function handleExportLeagueFile(lid: number) {
    setSharing(true);
    try {
      const league = await loadLeague(lid);
      if (!league) return;
      const crests = shareOptions.logos ? await loadCrests(lid) : new Map<number, string>();
      const file = buildLeagueFile(league, crests, shareOptions);
      const blob = new Blob([JSON.stringify(file)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const slug = league.meta.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      a.download = `${slug || `league-${lid}`}-league-file.json`;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setShareFor(null);
    } finally {
      setSharing(false);
    }
  }

  /**
   * One Import button for both kinds of file the game reads, because two
   * similarly-named import buttons is what made this confusing in the first
   * place. Which one it is is unambiguous from the contents: a roster file
   * declares a `format` the game recognizes (isRosterFileFormat, which also
   * accepts the pre-rename string), an exported save has no such field.
   *
   * They do quite different things — a roster file *starts* a league and hands
   * off to the club picker, a save file restores one — so the button routes
   * rather than tries to unify them.
   *
   * Roster files come in batches (a world is normally authored a league at a
   * time, so twelve files is a normal selection); a save is one whole league, so
   * several at once has no meaning and is refused rather than half-honoured.
   */
  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same file after an error
    if (picked.length === 0) return;
    setImportError(null);

    const texts: { file: File; text: string }[] = [];
    for (const file of picked) {
      // readLeagueFileText, not file.text(): an exported save is gzipped, and
      // reading its bytes as text would fail the JSON.parse below and report a
      // perfectly good save as corrupt.
      let text: string;
      try {
        text = await readLeagueFileText(file);
        JSON.parse(text);
      } catch {
        setImportError(`"${file.name}" isn't a valid JSON file.`);
        return;
      }
      texts.push({ file, text });
    }

    const formatOf = ({ text }: { text: string }) =>
      (JSON.parse(text) as { format?: unknown })?.format;
    const rosters = texts.filter((t) => isRosterFileFormat(formatOf(t)));
    // A badge pack is accepted here too, so the three Roster files downloads
    // can be picked in one go. It rides along to the New League screen, which
    // is where it gets applied (it matches clubs by name, so they must exist).
    const badgePacks = texts.filter((t) => isLogoPackFormat(formatOf(t)));

    if (rosters.length + badgePacks.length > 0 && rosters.length + badgePacks.length < texts.length) {
      setImportError(
        "That selection mixes roster or badge files with a save file. Import the save on its own.",
      );
      return;
    }

    if (rosters.length + badgePacks.length > 0) {
      const logos = [];
      for (const { file, text } of badgePacks) {
        try {
          logos.push({ name: file.name, pack: parseLogoPack(text) });
        } catch (err) {
          setImportError(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
          return;
        }
      }
      // Re-read through the real parser so a malformed roster file reports
      // exactly which field is wrong, the same as it would on /new-league.
      // A bad file stops the whole batch here rather than being skipped: this
      // screen is left behind on the way to the picker, so an error it raised
      // would go with it. Nothing has been created yet, so re-picking is cheap.
      const files = [];
      for (const { file, text } of rosters) {
        try {
          files.push({ name: file.name, file: parseRosterFile(text) });
        } catch (err) {
          setImportError(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
          return;
        }
      }
      setPendingRoster({ files, logos });
      // Badges alone start an ordinary league (the shipped clubs, badged by
      // whatever names match); the roster screen is for when clubs came too.
      navigate(files.length > 0 ? "/new-league?roster=1" : "/new-league");
      return;
    }

    if (texts.length > 1) {
      setImportError("Import one save file at a time.");
      return;
    }
    try {
      await importJSON(texts[0].file);
      navigate("/dashboard");
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSaveTeams(teams: EditableTeam[]) {
    if (!editor) return;
    setSaving(true);
    try {
      await customizeTeamsAction(editor.lid, teams);
      setEditor(null);
      refresh();
    } finally {
      setSaving(false);
    }
  }

  if (editor) {
    return (
      <div className="container py-4" style={{ maxWidth: 700 }}>
        <h2 className="mb-1">Customize Teams</h2>
        <p className="text-muted mb-3">
          {editor.leagueName}: rename any club, change its abbreviation or colors.
        </p>
        <TeamIdentityEditor
          initialTeams={editor.teams}
          competitions={editor.competitions}
          userTid={editor.userTid}
          saveLabel="Save"
          savingLabel="Saving..."
          saving={saving}
          onSave={handleSaveTeams}
          onCancel={() => setEditor(null)}
        />
      </div>
    );
  }

  return (
    <div className="container py-4" style={{ maxWidth: 720 }}>
      {firstRun ? <FirstRunIntro brand={brand} /> : <h1 className="h2 mb-3">Your Leagues</h1>}

      {importError && (
        <div className="alert alert-danger py-2" role="alert">
          {importError}
        </div>
      )}

      {leagues === null && <p className="text-muted">Loading...</p>}

      {leagues !== null && leagues.length > 0 && (
        <div className="list-group mb-3">
          {leagues.map((l) => (
            <div
              key={l.lid}
              className="list-group-item d-flex flex-wrap align-items-center justify-content-between"
            >
              <div>
                <div>{l.name}</div>
                {/* Season first, and the created time rather than just the date:
                    saves are named after the club, so two of the same club are
                    otherwise indistinguishable here. How far each one has got is
                    what actually tells you which is the one you've been playing. */}
                <small className="text-muted">
                  Season {l.season} · started {new Date(l.created).toLocaleString()}
                </small>
              </div>
              <div className="d-flex gap-2 flex-wrap justify-content-end">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => handleEnter(l.lid)}
                >
                  Enter
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => handleCustomize(l.lid)}
                >
                  Customize Teams
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => handleExportSave(l.lid)}
                  title="Download this whole save as a file you can back up or move to another device"
                >
                  Export Save
                </button>
                <button
                  type="button"
                  className={`btn btn-outline-secondary btn-sm${shareFor === l.lid ? " active" : ""}`}
                  aria-expanded={shareFor === l.lid}
                  onClick={() => setShareFor(shareFor === l.lid ? null : l.lid)}
                  title="Download this save's clubs as a file someone can start a new league from"
                >
                  Export League File
                </button>
                <button
                  type="button"
                  className="btn btn-outline-danger btn-sm"
                  onClick={() => handleDelete(l.lid)}
                >
                  Delete
                </button>
              </div>
              {shareFor === l.lid && (
                <div className="w-100 border-top mt-2 pt-2">
                  <p className="small text-muted mb-2">
                    A file of this save's clubs that anyone can load with Import to start a new
                    league with them. Club names and colors always go in. None of the save's
                    history does.
                  </p>
                  <div className="form-check">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id={`share-squads-${l.lid}`}
                      checked={shareOptions.squads}
                      onChange={(e) => setShareOptions({ ...shareOptions, squads: e.target.checked })}
                    />
                    <label className="form-check-label small" htmlFor={`share-squads-${l.lid}`}>
                      Squads, as they stand now (makes the file much bigger)
                    </label>
                  </div>
                  <div className="form-check mb-2">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id={`share-logos-${l.lid}`}
                      checked={shareOptions.logos}
                      onChange={(e) => setShareOptions({ ...shareOptions, logos: e.target.checked })}
                    />
                    <label className="form-check-label small" htmlFor={`share-logos-${l.lid}`}>
                      Badges you loaded yourself
                    </label>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={sharing}
                    onClick={() => handleExportLeagueFile(l.lid)}
                  >
                    {sharing ? "Preparing..." : "Download"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="d-flex gap-2 flex-wrap">
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={() => navigate("/new-league")}
        >
          Start New League
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={() => navigate("/new-league?customize=1")}
        >
          Start Customized League
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={() => importInputRef.current?.click()}
          title="Load roster files and badges to start a league with real clubs, or a save file to restore a backup"
        >
          Import
        </button>
        {/* This screen has no world of its own — a roster file imported from
            here lands on a league that does not exist yet — so the prompt
            describes the DEFAULT world, which is the one most saves are. Anyone
            who then reshapes the world in World setup gets a prompt matching
            what they actually built from the same button on /new-league. */}
        <CopyAiPromptButton
          world={defaultWorld}
          className="btn btn-outline-secondary"
          title="Copy a paste-ready prompt that teaches an AI the roster-file format, so you can have it write one"
        />
        <input
          ref={importInputRef}
          type="file"
          accept=".json,.gz,application/json,application/gzip"
          multiple
          className="d-none"
          onChange={handleImport}
        />
      </div>


      <RosterFilesSection
        files={ROSTER_FILES}
        onImport={() => importInputRef.current?.click()}
      />
    </div>
  );
}
