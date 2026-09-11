import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { clubIdentitiesFor } from "../../core/teams/clubs.js";
import { createLeagueState, type LeagueStore } from "../../core/leagueState.js";
import { applyTeamIdentities } from "../../core/teams/customize.js";
import { mulberry32 } from "../../engine/rng.js";
import { useLeague } from "../context/LeagueContext.js";
import { readLeagueFileText } from "../../db/exportImport.js";
import {
  DIFFICULTIES, DIFFICULTY_ORDER, DEFAULT_DIFFICULTY, INTL_MIN_POOL, type Difficulty,
  type ProgressionModel, DEFAULT_WORLD_CUP_SIZE, type WorldCupSize,
} from "../../core/constants.js";
import { WorldCupSizeSelect, worldCupSizeBlurb } from "../components/WorldCupSizeSelect.js";
import { confederationOf, isEligibleNation } from "../../core/international/index.js";
import { PICKABLE_NATIONALITIES } from "../components/NationalityEditor.js";
import {
  buildCompetitions,
  competitionAbbrev,
  countryClubRanges,
  countriesOf,
  worldTeamSlots,
} from "../../core/competitions.js";
import {
  WorldSetup, defaultWorldEntries, includedSpecs, leagueRosterFiles, type WorldEntry,
} from "../components/WorldSetup.js";
import {
  parseRosterFile,
  resolveRosterSlots,
  combineRosterFiles,
  type NamedRosterFile,
  type RosterFile,
  type RosterFileClub,
} from "../../core/teams/rosterFile.js";
import { applyRosterFileToNewLeague } from "../../core/teams/rosterImport.js";
import {
  combineLogoPacks,
  resolveLogoPack,
  type LogoTargetClub,
  type NamedLogoPack,
} from "../../core/teams/logoPack.js";
import { loadLogoFiles } from "../logoImages.js";
import { LogoSetup } from "../components/LogoSetup.js";
import { takePendingRoster } from "../pendingRoster.js";
import { TeamIdentityEditor, type EditableTeam } from "../components/TeamIdentityEditor.js";
import { ClubCrest, CrestArtProvider, CustomCrestProvider } from "../components/ClubCrest.js";
import { CountryFlag } from "../components/CountryFlag.js";
import { HelpHint } from "../components/HelpHint.js";
import { trackEvent } from "../analytics.js";
import {
  SEASON_START_YEAR, MIN_START_YEAR, MAX_START_YEAR, normalizeStartYear,
} from "../format.js";
import { ROSTER_DOWNLOAD_URL } from "../rosterDownload.js";
import { createGate, yieldToPaint } from "../singleFlight.js";
import { CopyAiPromptButton } from "../components/CopyAiPromptButton.js";
import { SPECTATOR_TID, isSpectatorTid } from "../../core/spectator.js";

/**
 * Everything the picker needs to describe a world that doesn't exist yet: the
 * competitions table, the countries in it, each country's block of club slots,
 * and the tid→competition layout a roster file resolves against.
 *
 * Derived from the chosen leagues rather than fixed at module scope, because the
 * world is now the player's to shape — switching a country off or adding one
 * changes every one of these, and a stale COUNTRY_RANGES would point the picker
 * at the wrong clubs.
 */
function describeWorld(specs: ReturnType<typeof includedSpecs>) {
  const competitions = buildCompetitions(specs);
  return {
    competitions,
    countries: countriesOf(competitions),
    ranges: countryClubRanges(competitions),
    slotWorld: {
      competitions,
      teams: worldTeamSlots(competitions),
    },
  };
}

/**
 * The empty badge map, shared. A fresh Map per render would hand every
 * ClubCrest on the picker a new context value on every keystroke.
 */
const NO_CRESTS: ReadonlyMap<number, string> = new Map();

interface LoadedRoster {
  /** Every file loaded so far, in load order, so more can be added to them. */
  sources: NamedRosterFile[];
  /** The sources folded into the one file the importer applies. */
  file: RosterFile;
  /** Which club each slot becomes, so the picker can show real names. */
  byTid: Map<number, RosterFileClub>;
  clubs: number;
  squads: number;
  warnings: string[];
}

/**
 * Fold the loaded files into one world and work out what it will look like.
 * Files are combined rather than replacing each other because a world is
 * normally authored a league at a time, so loading england.json and spain.json
 * has to mean both leagues, not whichever was picked last.
 */
function describeRoster(
  sources: NamedRosterFile[],
  slotWorld: ReturnType<typeof describeWorld>["slotWorld"],
): LoadedRoster {
  const { file, warnings: combineWarnings } = combineRosterFiles(sources);
  const { slots, warnings } = resolveRosterSlots(slotWorld, file);
  return {
    sources,
    file,
    byTid: new Map(slots.map((s) => [s.tid, s.club])),
    clubs: slots.length,
    squads: slots.filter((s) => s.club.players && s.club.players.length > 0).length,
    warnings: [...combineWarnings, ...warnings],
  };
}

export function NewLeague() {
  // The shape of the world, chosen before it is generated — in every mode,
  // roster import included. A roster file names the competitions it fills and
  // its clubs are mapped onto them again from scratch whenever the world moves
  // (see activeRoster below), so reshaping the world under a loaded file re-aims
  // it rather than misaiming it. Adding the league your file was written for is
  // the whole point: without it, the file's competition is simply "not in this
  // world" and everything in it is skipped.
  const [worldEntries, setWorldEntries] = useState<WorldEntry[]>(defaultWorldEntries);
  const world = useMemo(() => describeWorld(includedSpecs(worldEntries)), [worldEntries]);

  /** Competition name for a country's given tier (e.g. "English Division 1"). */
  function divisionName(countryName: string, tier: number): string {
    return (
      world.competitions.find((c) => c.country === countryName && c.tier === tier)?.name ??
      `Division ${tier}`
    );
  }

  const [country, setCountry] = useState<string>(() => countriesOf(buildCompetitions(includedSpecs(defaultWorldEntries())))[0]);
  const [selectedTid, setSelectedTid] = useState<number | null>(null);
  /**
   * Whether this save has a manager at all. Fixed for its lifetime, like the
   * difficulty — there is no route from one to the other, which is what keeps
   * the club handover `switchClub` exists to manage out of the picture
   * entirely (see core/spectator.ts).
   *
   * The club pick is deliberately *kept* while spectating rather than cleared,
   * so toggling back doesn't lose it — the same reason changing division
   * doesn't discard a selection.
   */
  const [spectate, setSpectate] = useState(false);
  // Which division's clubs the picker is showing. A view, not part of the save:
  // picking a club is what matters, and the tier it plays in is read off its tid
  // (tierForTid) rather than from here.
  const [tier, setTier] = useState(1);
  // Fixed for the save's lifetime once it's created, so it is chosen here and
  // nowhere else (see the DIFFICULTIES block in core/constants.ts).
  const [difficulty, setDifficulty] = useState<Difficulty>(DEFAULT_DIFFICULTY);
  // What the save is called on /leagues. Empty means "no name of my own", and
  // the save keeps naming itself after your club (see buildLeague) — the same
  // absent-means-default rule the division names follow, so leaving it alone
  // reproduces exactly what the page did before this field existed.
  const [leagueName, setLeagueName] = useState("");
  // The country you'll manage alongside your club, or null for club football
  // only — which is the default, and not a lesser save. Can be changed later by
  // taking a federation's offer, so this is a starting point rather than a
  // decision for the save's lifetime the way difficulty is.
  const [userNation, setUserNation] = useState<string | null>(null);
  // A chosen country the generated world turned out not to be able to field a
  // squad for. Reported rather than silently dropped — see handleStart.
  const [nationError, setNationError] = useState<string | null>(null);
  // Filter box for the country list. 211 countries is far too many to scroll
  // for a specific one, and still too few to be worth paginating.
  const [nationFilter, setNationFilter] = useState("");
  // The world's generation seed, drawn once and reused — see buildLeague.
  const seedRef = useRef<number | null>(null);
  // Which year season 1 gets labelled as. Purely cosmetic (the sim counts
  // seasons from 1 either way), so it's held as raw text and only turned into a
  // number once it reads as a usable year, letting the field go empty mid-edit.
  const [startYear, setStartYear] = useState(String(SEASON_START_YEAR));
  // Name and colour every club before the save is written. The editor itself
  // already existed behind the Leagues page's Customize Teams button; this just
  // offers the same step from the ordinary flow, which is where someone who has
  // just invented a league actually is.
  const [nameClubs, setNameClubs] = useState(false);
  // Whether Continental Cup places are re-earned each season on a rolling
  // country coefficient, or stay as the world was built. Fixed for the save's
  // lifetime like the difficulty above, because turning it off mid-dynasty
  // would freeze an allocation the league had already earned its way into.
  const [rollingCoefficients, setRollingCoefficients] = useState(true);
  // Whether careers follow a predictable arc or are re-rolled every summer.
  // Offered here because it shapes what the whole save feels like, but unlike
  // the two settings above it is NOT fixed for the save's lifetime — it scales
  // rng draws without changing their count, so God Mode can flip it later.
  const [progressionModel, setProgressionModel] = useState<ProgressionModel>("random");
  // How many nations the World Cup takes. Changeable later from the Qualifying
  // page, since a campaign records the size it was drawn at.
  const [worldCupSize, setWorldCupSize] = useState<WorldCupSize>(DEFAULT_WORLD_CUP_SIZE);
  const [pending, setPending] = useState<LeagueStore | null>(null);
  const [saving, setSaving] = useState(false);
  // Every path on this page that writes a save goes through one gate. Building a
  // world is ~3 seconds of blocking work with no way to interrupt it, so the page
  // freezes; the browser queues the clicks that land on it and delivers them all
  // once it thaws, and each one used to create another league. That's where the
  // duplicate saves came from: four impatient clicks, four identical leagues.
  const gate = useRef(createGate()).current;
  // A file handed over by the Leagues page's Import button is picked up on the
  // first render, so arriving here skips straight to the club picker. useState's
  // initializer (not an effect) because takePendingRoster clears as it reads,
  // and an effect would run twice under StrictMode and lose it.
  //
  // Only the FILES are kept, never the slots they resolved to. The world can be
  // reshaped after they are loaded, and a stored resolution would go stale the
  // moment it was — which is precisely why the world editor used to be hidden
  // on this path.
  const [rosterSources, setRosterSources] = useState<NamedRosterFile[]>(
    () => takePendingRoster()?.files ?? [],
  );
  const [rosterError, setRosterError] = useState<string | null>(null);
  // Held beside the roster sources rather than inside a component, for the same
  // reason those are: the club picker previews them, the Start handlers apply
  // them, and a second copy of "what has the user loaded" is how those two end
  // up disagreeing about what the save will look like.
  const [logoSources, setLogoSources] = useState<NamedLogoPack[]>([]);
  const [logoError, setLogoError] = useState<string | null>(null);
  // Failures from "Import League" (a whole exported save), kept separate from
  // rosterError: they surface on different screens and mean different things.
  const [importError, setImportError] = useState<string | null>(null);
  const { setLeague, importJSON } = useLeague();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const customize = searchParams.get("customize") === "1";
  // Roster mode is reachable only from the Leagues page's "Import Custom
  // League" button. A roster file can *only* be applied here, at creation:
  // importing real squads into a save in progress would delete the careers,
  // stats and transfer history of everyone it replaced.
  const rosterMode = searchParams.get("roster") === "1";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rosterInputRef = useRef<HTMLInputElement>(null);

  /**
   * The world-wide files on their own, resolved against the world as it stands.
   * Drives the "Loaded x, y, z" panel, which speaks about those files and must
   * not fold in per-league ones the world editor already lists beside their own
   * league.
   */
  const worldRoster = useMemo(
    () => (rosterSources.length > 0 ? describeRoster(rosterSources, world.slotWorld) : null),
    [rosterSources, world],
  );

  /**
   * The roster actually applied: the world-wide files plus the ones attached to
   * individual added leagues, folded together and resolved as one. Both kinds
   * used to be mutually exclusive because the world editor vanished as soon as a
   * world-wide file was loaded; now that it doesn't, they are combined. Per-league
   * files come last, so a league carrying its own file wins the competition it
   * names — it is the more specific of the two.
   */
  const activeRoster = useMemo((): LoadedRoster | null => {
    const { files, warnings } = leagueRosterFiles(worldEntries, world.competitions);
    const sources = [...rosterSources, ...files];
    if (sources.length === 0) return null;
    const described = describeRoster(sources, world.slotWorld);
    return { ...described, warnings: [...warnings, ...described.warnings] };
  }, [rosterSources, worldEntries, world]);

  /** Every pack and picture batch loaded so far, folded into the one that gets applied. */
  const logoPack = useMemo(
    () => (logoSources.length > 0 ? combineLogoPacks(logoSources) : null),
    [logoSources],
  );

  /**
   * Every club this world is about to contain, by the name it will actually
   * carry — the imported one where a roster file replaced the slot, the
   * fictional one everywhere else.
   *
   * Needed because a logo pack matches on NAME and the names only exist once
   * the world is generated, which is several seconds of work the picker must
   * not do. This is the same reconstruction the club picker already performs
   * for one country (`countryClubs`), widened to all of them, and it is exact
   * for the same reason: `clubIdentitiesFor` is what generation itself uses.
   */
  const prospectiveClubs = useMemo((): LogoTargetClub[] => {
    const out: LogoTargetClub[] = [];
    for (const r of world.ranges) {
      const ids = clubIdentitiesFor(r.country, r.end - r.start);
      ids.forEach((club, i) => {
        const tid = r.start + i;
        const imported = activeRoster?.byTid.get(tid);
        out.push({
          tid,
          name: imported?.name ?? club.name,
          abbrev: imported?.abbrev ?? club.abbrev,
        });
      });
    }
    return out;
  }, [world, activeRoster]);

  /**
   * Which clubs the loaded packs will badge, resolved against the world as it
   * currently stands. Recomputed as the world and the roster move under it, so
   * the picker never shows a badge the save wouldn't.
   */
  const logoMatch = useMemo(
    () => (logoPack ? resolveLogoPack(prospectiveClubs, logoPack.pack) : null),
    [logoPack, prospectiveClubs],
  );

  /** The matched badges with the club names they landed on, for the card's preview strip. */
  const logoPreview = useMemo(() => {
    if (!logoMatch) return [];
    const nameByTid = new Map(prospectiveClubs.map((c) => [c.tid, c.name]));
    return [...logoMatch.byTid].map(([tid, image]) => ({
      tid,
      name: nameByTid.get(tid) ?? `Club ${tid}`,
      image,
    }));
  }, [logoMatch, prospectiveClubs]);

  /**
   * Reshaping the world can move, remove or re-letter the slot the chosen club
   * sits in, so a selection only survives a change that leaves the slot layout
   * alone — renaming a country, or retuning one, rather than adding or dropping
   * clubs. Without this you could pick a club in the picker and start a save as
   * a different one.
   */
  function changeWorld(next: WorldEntry[]) {
    const after = worldTeamSlots(buildCompetitions(includedSpecs(next)));
    const before = world.slotWorld.teams;
    const sameLayout =
      before.length === after.length && before.every((t, i) => t.compId === after[i].compId);
    setWorldEntries(next);
    if (!sameLayout) setSelectedTid(null);
  }

  const parsedStartYear = normalizeStartYear(startYear);

  // Countries that can be managed: anything the game ships names for that also
  // belongs to a confederation, since no confederation means no competition to
  // enter. One flat alphabetical list, deliberately — whether a country happens
  // to host one of this world's leagues is not the question being asked here,
  // and splitting on it implied a distinction the player has no use for. What
  // actually decides eligibility is how many of its players get generated, which
  // no grouping can promise and the check at Start reports honestly.
  const manageableNations = useMemo(
    () => PICKABLE_NATIONALITIES.filter((n) => confederationOf(n) !== null),
    [],
  );
  const shownNations = useMemo(() => {
    const q = nationFilter.trim().toLowerCase();
    return q ? manageableNations.filter((n) => n.toLowerCase().includes(q)) : manageableNations;
  }, [manageableNations, nationFilter]);

  // Keep the chosen country on screen. The list is 211 rows in a 260px box, so
  // typing a filter and then clearing it leaves the selection scrolled far out
  // of view and the list looks like nothing is picked.
  //
  // Scrolls the list box itself rather than calling `scrollIntoView`, which
  // scrolls EVERY scrollable ancestor including the window. This picker sits
  // below the fold, so on mount the row genuinely is not visible in the page
  // and "nearest" dutifully scrolled the whole screen down to it — the page
  // opened at its own bottom. Moving `scrollTop` by hand cannot reach past the
  // one element it is given, and it still leaves an already-visible row alone,
  // so it can't fight a scroll the user is in the middle of either.
  const nationListRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const list = nationListRef.current;
    const row = list?.querySelector<HTMLElement>(".active");
    if (!list || !row) return;
    const listBox = list.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    if (rowBox.top < listBox.top) list.scrollTop -= listBox.top - rowBox.top;
    else if (rowBox.bottom > listBox.bottom) list.scrollTop += rowBox.bottom - listBox.bottom;
  }, [shownNations, userNation]);

  /** The country's code, for the flag stand-in on its tab. */
  function abbrevForCountry(countryName: string): string {
    const comp = world.competitions.find((c) => c.country === countryName);
    return comp ? competitionAbbrev(comp) : "";
  }

  // Which tier the chosen club plays in. Read off the slot layout rather than
  // assumed from position in the country's block, because divisions can be
  // different sizes and a country can have only one of them.
  function tierForTid(tid: number): number {
    const compId = world.slotWorld.teams.find((t) => t.tid === tid)?.compId;
    return world.competitions.find((c) => c.id === compId)?.tier ?? 1;
  }

  function buildLeague(tid: number): LeagueStore {
    // Fixed for the life of the page, not re-rolled per attempt. If a chosen
    // country turns out not to be able to field a squad, the advice is "pick
    // another one" — which is only true if pressing Start again builds the same
    // world. A fresh Date.now() would answer a different question each time, so
    // the same country could fail and then succeed.
    const seed = (seedRef.current ??= Date.now());
    const rng = mulberry32(seed);
    const generated = createLeagueState(
      tid, rng, seed, difficulty, world.competitions, rollingCoefficients, userNation,
      progressionModel, worldCupSize,
    );
    // A roster import is orthogonal to who manages: it replaces squads, and a
    // spectator watching real clubs is exactly as sensible as managing one.
    // `applyRosterFileToNewLeague` takes the user's tid only to leave that
    // club's own slot alone where it matters, and a tid nobody owns is a tid it
    // never matches — the same way every other consumer treats it.
    const league = activeRoster
      ? applyRosterFileToNewLeague(generated, activeRoster.file, tid).league
      : generated;
    return {
      ...league,
      meta: {
        ...league.meta,
        // A name the player typed wins; otherwise the save is named after
        // whatever the user's club ended up being called — the imported name
        // when a roster replaced it, else the fictional one. A spectator has no
        // club to be named after, so it falls back to the world instead. Every
        // tid in the world has a team, so the last fallback is only a guard.
        name:
          leagueName.trim() ||
          (isSpectatorTid(tid)
            ? (world.countries.length === 1
                ? world.countries[0]
                : `${world.countries.length} countries`)
            : league.teams.find((t) => t.tid === tid)?.name) ||
          `Club ${tid}`,
        // Display only: seasons stay a 1-based counter, this just decides which
        // year the UI calls season 1. The Start button is disabled while the
        // field is unusable, so the fallback only keeps the type honest.
        startYear: parsedStartYear ?? SEASON_START_YEAR,
      },
    };
  }

  /**
   * The badges to store with a save, resolved against its FINAL club names.
   *
   * Deliberately not `logoMatch.byTid`, which is resolved against the picker's
   * reconstruction of what the clubs will be called. That reconstruction is
   * right at the moment it is made and can still be overtaken: the Customize
   * Teams editor sits between the Start button and the save and exists to
   * rename clubs. Resolving once more against the league actually being written
   * costs one pass and means a club renamed on that screen keeps the badge you
   * gave the name you gave it.
   */
  function crestsFor(league: LeagueStore): ReadonlyMap<number, string> | undefined {
    if (!logoPack) return undefined;
    return resolveLogoPack(league.teams, logoPack.pack).byTid;
  }

  /**
   * The tid this save will be built with, or null when it isn't ready to build.
   *
   * A spectator save needs no pick and can't have one, so it is always ready;
   * a managed one is not until a club is chosen. Both Start handlers and the
   * Start button's disabled state read this, so the button can never be live
   * for a state the handler would refuse.
   */
  const buildTid: number | null = spectate ? SPECTATOR_TID : selectedTid;
  // Analytics only. A spectator picked no club, so there is no tier to report;
  // `tierForTid` would happily answer 1 for a tid it can't find, which would
  // quietly overstate top-flight starts.
  const startTier = spectate || selectedTid === null ? null : tierForTid(selectedTid);

  async function handleStart() {
    if (buildTid === null) return;
    await gate.run(async () => {
      setSaving(true);
      // Let the button repaint as disabled before the world generation locks the
      // thread, so the wait looks like the game working rather than a dead page.
      await yieldToPaint();
      try {
        const league = buildLeague(buildTid);
        // Whether a country can enter international football at all depends on
        // the world that just got generated (INTL_MIN_POOL players and a
        // keeper), and there is no way to know before building it. A pick that
        // doesn't clear the bar is reported rather than silently dropped — a
        // save that quietly ignored the country you chose is worse than being
        // told to choose again.
        if (userNation && !isEligibleNation(userNation, league.players.filter((p) => p.nationality === userNation))) {
          setNationError(userNation);
          return;
        }
        setNationError(null);
        if (customize || nameClubs) {
          // Hold the generated league in memory and let the user edit team
          // identities before anything is persisted.
          setPending(league);
          return;
        }
        trackEvent("league_created", { country, tier: startTier, spectate, roster: !!activeRoster, difficulty, rollingCoefficients, progressionModel });
        await setLeague(league, crestsFor(league));
        navigate("/dashboard");
      } finally {
        setSaving(false);
      }
    });
  }

  async function handleSaveCustomized(teams: EditableTeam[]) {
    if (!pending || buildTid === null) return;
    await gate.run(async () => {
      setSaving(true);
      try {
        trackEvent("league_created", { country, tier: startTier, spectate, roster: !!activeRoster, difficulty, rollingCoefficients, progressionModel });
        const customized = applyTeamIdentities(pending, teams);
        // Resolved after the rename, not before: this screen is where a club
        // gets the name a badge was picked for.
        await setLeague(customized, crestsFor(customized));
        navigate("/dashboard");
      } finally {
        setSaving(false);
      }
    });
  }

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  /**
   * Load one or more roster files, adding them to any already loaded so a world
   * can be built up a league at a time (either by selecting every file at once
   * or by coming back for the next one).
   *
   * A file that won't parse takes only itself out: the rest still load and the
   * error names the offending file, because re-picking eleven good files to fix
   * a twelfth is the exact tedium this is meant to remove.
   */
  async function handleRosterFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same file after an error
    if (picked.length === 0) return;
    setRosterError(null);

    const loaded: NamedRosterFile[] = [];
    const errors: string[] = [];
    for (const file of picked) {
      try {
        // Roster files are hand-written or AI-authored and so never compressed,
        // but every picked file goes through one reader so a gzipped one can't
        // read as garbage on this screen alone.
        loaded.push({
          name: file.name,
          file: parseRosterFile(await readLeagueFileText(file)),
        });
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (loaded.length > 0) {
      setRosterSources((prev) => [...prev, ...loaded]);
      setSelectedTid(null);
    }
    setRosterError(errors.length > 0 ? errors.join(" ") : null);
  }

  /**
   * Load club badges — a pack file, loose picture files, or both at once.
   *
   * Added to what is already loaded rather than replacing it, the same rule the
   * roster picker follows and for the same reason: a world's badges arrive a
   * league at a time. Unlike a roster file this never clears the club
   * selection, because a badge cannot move a club between slots — it is
   * matched by name to whatever is already there.
   */
  async function handleLogoFiles(picked: File[]) {
    setLogoError(null);
    const { packs, errors } = await loadLogoFiles(picked);
    if (packs.length > 0) setLogoSources((prev) => [...prev, ...packs]);
    setLogoError(errors.length > 0 ? errors.join(" ") : null);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so the same file can be picked again after a fix
    if (!file) return;
    setImportError(null);
    // Through the same gate as creation: an import also lands as a brand new
    // save, so a second one arriving while the first is still writing would be
    // a second copy of it.
    await gate.run(async () => {
      try {
        await importJSON(file);
      } catch (err) {
        // Without this the whole import was a silent no-op: the error went to the
        // browser console, the navigate below never ran, and the page just sat
        // there looking like the button did nothing.
        setImportError(err instanceof Error ? err.message : String(err));
        return;
      }
      trackEvent("league_imported");
      navigate("/dashboard");
    });
  }

  if (pending) {
    return (
      <div className="container py-4" style={{ maxWidth: 900 }}>
        <h2 className="mb-1">Customize Teams</h2>
        <p className="text-muted mb-3">
          Rename any club, change its abbreviation or colors, then start your league.
        </p>
        <TeamIdentityEditor
          initialTeams={pending.teams.map((t) => ({
            tid: t.tid,
            compId: t.compId,
            name: t.name,
            abbrev: t.abbrev,
            colors: [...t.colors] as [string, string],
          }))}
          competitions={pending.competitions}
          userTid={pending.meta.userTid}
          saveLabel="Start League"
          savingLabel="Starting..."
          saving={saving}
          onSave={handleSaveCustomized}
          onCancel={() => setPending(null)}
        />
      </div>
    );
  }

  if (rosterMode && !worldRoster) {
    return (
      <div className="container py-4" style={{ maxWidth: 600 }}>
        <h2 className="mb-3">Import Custom League</h2>
        <p>
          Load a roster file to start a league with real clubs and squads in place of the
          fictional ones. You'll pick your club from the imported teams on the next step.
        </p>

        {ROSTER_DOWNLOAD_URL && (
          <div className="border rounded p-3 mb-3">
            <div className="d-flex align-items-center gap-2 mb-1">
              <span className="fw-semibold">Don't have one yet?</span>
              <span className="badge bg-success">Updated for EA FC 27</span>
            </div>
            <p className="text-muted small mb-2">
              A ready-made file covering every league in the game. Save it, then load
              it below. It was rebuilt from the EA FC 27 ratings on 30 August 2026.
            </p>
            <a
              className="btn btn-outline-primary btn-sm"
              href={ROSTER_DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              download
            >
              Download roster file
            </a>
          </div>
        )}

        {/* The detail matters to anyone writing their own file and to nobody
            else, so it folds away rather than standing between the reader and
            the button they came here to press. */}
        <details className="mb-3">
          <summary className="text-muted small" style={{ cursor: "pointer" }}>
            What's a roster file?
          </summary>
          <p className="text-muted small mt-2 mb-0">
            A plain text (JSON) file listing clubs by league, each one optionally
            carrying a squad. Write one yourself, or press "Copy AI Prompt to Customize"
            below and paste that into ChatGPT or Claude — it describes the file format
            and, importantly, the exact leagues and squad sizes of the world you're
            building here, which an AI can't guess. Load as many files as you like — one
            per league is a far easier ask than a whole world at once. They only load
            while a league is being created: replacing squads in a save already going
            would wipe out the careers of everyone they replaced.
          </p>
        </details>

        {rosterError && (
          <div className="alert alert-danger py-2" role="alert">
            {rosterError}
          </div>
        )}

        <div className="d-flex gap-2 flex-wrap">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => rosterInputRef.current?.click()}
          >
            Choose Roster Files
          </button>
          {/* Built from the world as currently configured, not the shipped one,
              so the competition names and slot counts it quotes are the ones a
              file will actually be resolved against. */}
          <CopyAiPromptButton world={world.slotWorld} className="btn btn-outline-secondary" />
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => navigate("/leagues")}
          >
            Cancel
          </button>
          <input
            ref={rosterInputRef}
            type="file"
            accept=".json,application/json"
            multiple
            className="d-none"
            onChange={handleRosterFiles}
          />
        </div>
      </div>
    );
  }

  // Switching a country off can leave the picker pointing at one the world no
  // longer has, so fall back rather than crash on the missing range.
  const activeCountry = world.countries.includes(country) ? country : world.countries[0];
  const range = world.ranges.find((r) => r.country === activeCountry);
  const countryClubs = (range ? clubIdentitiesFor(activeCountry, range.end - range.start) : []).map((club, i) => {
    const tid = range!.start + i;
    const imported = activeRoster?.byTid.get(tid);
    // An imported club takes over the slot's identity outright, so the picker
    // shows what the club will actually be called once the save exists.
    return {
      tid,
      name: imported?.name ?? club.name,
      colors: (imported?.colors ?? club.colors) as [string, string],
      squad: imported?.players?.length ?? 0,
    };
  });
  // Grouped by the tier each slot actually belongs to. Derived from the clubs
  // present rather than from a fixed pair: a country runs anywhere from one to
  // MAX_DIVISIONS divisions, and they need not be the same size. A hardcoded
  // d1/d2 split silently filtered every third-division club out of the picker.
  const clubsByTier = new Map<number, typeof countryClubs>();
  for (const c of countryClubs) {
    const t = tierForTid(c.tid);
    const list = clubsByTier.get(t);
    if (list) list.push(c);
    else clubsByTier.set(t, [c]);
  }
  const tiers = [...clubsByTier.keys()].sort((a, b) => a - b);
  // Shown as the League name placeholder, so the default the save would take is
  // visible rather than merely described. Safe to look up in the active
  // country's clubs alone: selecting a country clears the club (selectCountry),
  // so a selection is always one of these.
  const selectedClubName =
    selectedTid === null ? null : (countryClubs.find((c) => c.tid === selectedTid)?.name ?? null);
  // A country need not have the division the picker is currently on — it can be
  // switched to a shallower pyramid, or switched off, underneath the tab — so
  // the shown tier falls back rather than showing an empty list, the same shape
  // as activeCountry falling back when a country is switched off.
  const shownTier = clubsByTier.has(tier) ? tier : (tiers[0] ?? 1);
  const shownClubs = clubsByTier.get(shownTier) ?? [];

  function selectCountry(c: string) {
    setCountry(c);
    setSelectedTid(null);
  }

  return (
    // The picker previews the world the import will produce, so it has to hide
    // the same crests the league itself will — otherwise a club shows a badge
    // here and a colour swatch the moment the save opens.
    // Same two providers, in the same order, as the in-league shell: the picker
    // is a preview of the save, so anything it shows a badge for has to be
    // something the save will too — including a custom badge outranking the
    // suppression an import turns on.
    <CustomCrestProvider crests={logoMatch?.byTid ?? NO_CRESTS}>
    <CrestArtProvider tids={activeRoster ? [...activeRoster.byTid.keys()] : []}>
    {/* Wider than the prose screens either side of it: this one is a stack of
        controls and a club list, not something you read left to right, and at
        600 a desktop window was mostly empty either side of it. `.container`
        still goes full width below its own breakpoints, so this only widens
        the page on a screen that has the room. */}
    <div className="container py-4 new-league-page" style={{ maxWidth: 900 }}>
      <h2 className="mb-3">{rosterMode ? "Import Custom League" : "New League"}</h2>
      {/*
        The country is deliberately not named here. It used to read "choose your
        England club", which is clumsy on its own and ambiguous now that this
        page also asks which *country* you want to manage — and the adjectival
        form ("your English club") is not available, since a league the player
        added has whatever name they typed and no demonym to derive.
      */}
      {/* The club list below is self-explanatory, so this says nothing at all
          in the ordinary case and appears only when there is something the
          page cannot show: what an import left alone, or that an editor is
          coming after this screen. */}
      {(worldRoster || customize) && (
        <p className="text-muted">
          {worldRoster
            ? "Every club the file didn't cover keeps its original name and squad."
            : "You'll get to customize every club before the save starts."}
        </p>
      )}

      {worldRoster && (
        <div className="alert alert-secondary py-2">
          <div>
            Loaded <strong>{worldRoster.sources.map((s) => s.name).join(", ")}</strong> —{" "}
            {worldRoster.clubs} {worldRoster.clubs === 1 ? "club" : "clubs"},{" "}
            {worldRoster.squads} with a full squad.
          </div>
          {worldRoster.warnings.map((w) => (
            <div key={w} className="small text-muted mt-1">
              {w}
            </div>
          ))}
          {rosterError && (
            <div className="small text-danger mt-1">{rosterError}</div>
          )}
          {/* The commonest reason a file lands nowhere is that the world hasn't
              got the league it was written for, which the editor below can fix —
              so say so next to the warning that reports it, and only then. A
              clean import needs no cure and shouldn't be handed one. */}
          {worldRoster.warnings.length > 0 && (
            <div className="small text-muted mt-1">
              Rename a league to match, or add one, in World setup below.
            </div>
          )}
          <div className="d-flex gap-3 mt-1">
            <button
              type="button"
              className="btn btn-link btn-sm p-0"
              onClick={() => rosterInputRef.current?.click()}
            >
              Add another file
            </button>
            <button
              type="button"
              className="btn btn-link btn-sm p-0"
              onClick={() => {
                setRosterSources([]);
                setRosterError(null);
                setSelectedTid(null);
              }}
            >
              Start over
            </button>
          </div>
        </div>
      )}

      {/* Loading roster files is offered on the ordinary New League screen too,
          so the two ways in differ only in where they start you: the world
          editor and the file loader are the same on both. */}
      {!worldRoster && !rosterMode && (
        <div className="mb-3">
          <div className="d-flex gap-2 flex-wrap">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => rosterInputRef.current?.click()}
            >
              Load roster files
            </button>
            {/* Offered next to the loader rather than only on the roster screen,
                because the prompt is what you need BEFORE you have a file. */}
            <CopyAiPromptButton world={world.slotWorld} className="btn btn-outline-secondary btn-sm" />
          </div>
          <p className="text-muted small mt-2 mb-0">
            Optional. Real or invented clubs and squads, in place of the fictional ones.
            No file yet? "Copy AI Prompt to Customize" gives you one to paste into an AI,
            describing this world's leagues and squad sizes.
          </p>
          {rosterError && <div className="small text-danger mt-1">{rosterError}</div>}
        </div>
      )}

      {/* One input for both entry points above. */}
      <input
        ref={rosterInputRef}
        type="file"
        accept=".json,application/json"
        multiple
        className="d-none"
        onChange={handleRosterFiles}
      />

      {/* Under the roster loader, in both modes, because that is the order the
          two are used in: a pack matches clubs by name, so the names a roster
          file installs have to be in place before it can find them. */}
      <LogoSetup
        sources={logoSources.map((s) => s.name)}
        matched={logoMatch?.byTid.size ?? 0}
        unmatched={logoMatch?.unmatched ?? []}
        preview={logoPreview}
        error={logoError}
        onPick={handleLogoFiles}
        onClear={() => {
          setLogoSources([]);
          setLogoError(null);
        }}
      />

      {/*
        Shown in roster mode too. Slots are resolved from the loaded files
        against the world as it currently stands (see activeRoster), so a file
        follows the world when it moves — and adding the league a file was
        written for is the only way to make that file apply at all.
      */}
      {/*
        What kind of save this is — the three things true of the whole league
        rather than of any one club — gathered above the world and the club so
        the page reads in one direction: what game, then what world, then who
        you are in it. Difficulty and the start year used to sit below the club
        list, which put two save-wide decisions after the most specific one on
        the page.
      */}
      {/* Capped rather than left to fill the page: a field's width is a hint at
          how much to type into it, and a club name in an 800px box reads as
          the wrong control. */}
      <div className="d-flex gap-2 mb-2 flex-wrap align-items-end" style={{ maxWidth: 560 }}>
        <div className="flex-grow-1" style={{ minWidth: 190 }}>
          <label
            htmlFor="league-name"
            className="text-muted text-uppercase small fw-semibold mb-2 d-block"
          >
            League name
          </label>
          <input
            type="text"
            id="league-name"
            className="form-control"
            maxLength={60}
            placeholder={selectedClubName ?? "Named after your club"}
            value={leagueName}
            onChange={(e) => setLeagueName(e.target.value)}
          />
        </div>
        <div style={{ width: 130 }}>
          <label
            htmlFor="start-year"
            className="text-muted text-uppercase small fw-semibold mb-2 d-block"
          >
            Start year{" "}
            <HelpHint label="What does the start year do?">
              Cosmetic. The game counts seasons from 1 whatever you pick, so this only
              decides what year they're labelled with.
            </HelpHint>
          </label>
          <input
            type="number"
            id="start-year"
            className={`form-control${parsedStartYear === null ? " is-invalid" : ""}`}
            value={startYear}
            min={MIN_START_YEAR}
            max={MAX_START_YEAR}
            onChange={(e) => setStartYear(e.target.value)}
          />
        </div>
      </div>
      <p className="text-muted small mb-3">
        {parsedStartYear === null
          ? `Pick a year between ${MIN_START_YEAR} and ${MAX_START_YEAR}.`
          : `Your first season is ${parsedStartYear}-${String((parsedStartYear + 1) % 100).padStart(2, "0")}.`}
      </p>

      <div className="mb-3">
        <h6 className="text-muted text-uppercase small fw-semibold mb-2">
          Difficulty{" "}
          <HelpHint label="What does difficulty change?">
            It only changes things for your club: the money you get, what your academy
            turns out, what you pay for players and who'll sell to you. Every other club
            plays by the same rules whichever setting you pick.
          </HelpHint>
        </h6>
        <div className="btn-group segmented" role="group" aria-label="Choose a difficulty">
          {DIFFICULTY_ORDER.map((d) => (
            <button
              key={d}
              type="button"
              className={`btn btn-outline-secondary${d === difficulty ? " active" : ""}`}
              // The picked segment is otherwise a CSS class and nothing more, so
              // a screen reader announces four identical buttons with no way to
              // tell which one is the current choice.
              aria-pressed={d === difficulty}
              onClick={() => setDifficulty(d)}
            >
              {DIFFICULTIES[d].label}
            </button>
          ))}
        </div>
        <p className="text-muted small mt-2 mb-0">
          {/* The per-setting blurb stays on screen because it changes as you
              click, so it is feedback on the choice rather than an explanation
              of it. Only the permanence is worth keeping beside it; what the
              lever actually touches moved to the hint on the heading. */}
          {DIFFICULTIES[difficulty].blurb} You can't change it later.
        </p>
      </div>

      <WorldSetup
        entries={worldEntries}
        onChange={changeWorld}
        // A loaded file that names a league this world hasn't got is skipped,
        // and adding or renaming one in here is the only thing that fixes it —
        // so the editor opens itself for an import rather than hiding the cure
        // behind a collapsed card the warning above merely points at.
        defaultOpen={!!worldRoster}
      />

      {/*
        Who you are in this world. Sits directly above the club picker because
        it decides whether that picker is a choice you need to make at all, and
        it is fixed for the save's lifetime like the difficulty above it.
      */}
      <div className="mb-3">
        {/*
          One switch rather than a "Manage a club / Spectate" pair. Managing is
          what the whole page is already for, so the second option was naming the
          default back at you; the only thing worth a control is the departure
          from it.

          Named by its own label rather than by a section heading above it, the
          same shape "Name the clubs yourself" uses further down — a heading
          reading SPECTATOR MODE over a switch reading "spectator mode" is the
          same words twice.
        */}
        <div className="form-check form-switch">
          <input
            type="checkbox"
            className="form-check-input"
            id="spectator-mode"
            checked={spectate}
            onChange={(e) => setSpectate(e.target.checked)}
          />
          <label className="form-check-label" htmlFor="spectator-mode">
            Spectator mode
            <span className="text-muted small d-block">
              Watch the world instead of managing clubs.
            </span>
          </label>
        </div>
        {/*
          The one thing worth saying twice, and only while it is switched on:
          this cannot be undone in ordinary play, and it is the choice a player
          would most regret making without knowing that.
        */}
        {spectate && (
          <p className="text-muted small mt-2 mb-0">
            Every club is run by the AI. You can't switch to managing later, so start a new
            save if you change your mind.
          </p>
        )}
      </div>

      {!spectate && (
      <div className="btn-group segmented mb-3" role="group" aria-label="Choose a league">
        {world.countries.map((c) => (
          <button
            key={c}
            type="button"
            className={`btn btn-outline-secondary d-inline-flex align-items-center gap-2${
              c === activeCountry ? " active" : ""
            }`}
            aria-pressed={c === activeCountry}
            onClick={() => selectCountry(c)}
          >
            <CountryFlag country={c} fallback={abbrevForCountry(c)} />
            {c}
          </button>
        ))}
      </div>
      )}

      {/*
        One division at a time. Both stacked is forty club rows for a big
        country, which buried everything below the picker — and the two are
        alternatives, not a list to read end to end. Tabs rather than a heading
        per division, so this reads as the same kind of choice as the country
        tabs directly above it.
      */}
      {!spectate && (
      <div className="mb-3">
        {tiers.length > 1 ? (
          <div className="btn-group segmented mb-2" role="group" aria-label="Choose a division">
            {tiers.map((t) => (
              <button
                key={t}
                type="button"
                className={`btn btn-outline-secondary${t === shownTier ? " active" : ""}`}
                aria-pressed={t === shownTier}
                onClick={() => setTier(t)}
              >
                {divisionName(activeCountry, t)}
              </button>
            ))}
          </div>
        ) : (
          <h6 className="text-muted text-uppercase small fw-semibold mb-2">
            {divisionName(activeCountry, shownTier)}
          </h6>
        )}
        <div className="list-group picker-columns">
          {shownClubs.map(({ tid, name, colors, squad }) => (
            <button
              key={tid}
              type="button"
              className={`list-group-item list-group-item-action d-flex align-items-center${
                selectedTid === tid ? " active" : ""
              }`}
              onClick={() => setSelectedTid(tid)}
            >
              <ClubCrest tid={tid} colors={colors} size={28} />
              {name}
              {squad > 0 && (
                <small className="ms-auto opacity-75">{squad} players</small>
              )}
            </button>
          ))}
        </div>
        {/*
          Switching divisions doesn't discard your pick — only switching country
          does, and that one has to, since the clubs change. But a pick you can
          no longer see reads as no pick at all with the Start button live at the
          bottom, so it says where the club you chose actually is.
        */}
        {selectedTid !== null && !shownClubs.some((c) => c.tid === selectedTid) && (
          <p className="text-muted small mt-2 mb-0">
            You've picked {selectedClubName}, over in{" "}
            {divisionName(activeCountry, tierForTid(selectedTid))}.
          </p>
        )}
      </div>
      )}

      {/* Managing a country is a job too, and a spectator holds none —
          createLeagueState forces it null for them, so offering it here would
          be offering something the save will discard. */}
      {!spectate && (
      <div className="mb-3">
        <h6 className="text-muted text-uppercase small fw-semibold mb-2">
          National team{" "}
          <HelpHint label="What does managing a country involve?">
            You pick the squad and the eleven for qualifying, the World Cup and their
            continental championship, on top of your club job, and the federation judges
            you every campaign. A country needs enough players born into your world to
            field a squad at all, so you'll be told if the one you pick can't.
          </HelpHint>
        </h6>
        {/* The squad-eligibility rule used to be spelled out here as well, which
            was explaining an error before it happened: the nationError alert
            below already says it in full, and only in the case where it's true. */}
        <p className="text-muted small mb-2">
          {userNation
            ? `You'll pick ${userNation}'s squad and their eleven, on top of your club job.`
            : "Optional. You can always take the job later if one comes in."}
        </p>
        <input
          type="search"
          className="form-control form-control-sm mb-2"
          style={{ maxWidth: 340 }}
          placeholder="Search countries"
          aria-label="Search countries"
          value={nationFilter}
          onChange={(e) => setNationFilter(e.target.value)}
        />
        {/*
          A list rather than a <select>, because an <option> cannot hold the
          flag SVG. Same list-group the club picker above uses, so the two
          choices on this page look like the same kind of choice.
        */}
        {/* Two columns like the club picker above it. At 340 wide this was a
            narrow rail with most of the page empty beside it, and the country
            list is the one place on the page where more rows in view is worth
            real money: there are over a hundred of them. */}
        <div
          className="list-group picker-columns"
          ref={nationListRef}
          style={{ maxHeight: 260, overflowY: "auto" }}
        >
          <button
            type="button"
            className={`list-group-item list-group-item-action py-1${userNation === null ? " active" : ""}`}
            onClick={() => { setUserNation(null); setNationError(null); }}
          >
            None &mdash; club football only
          </button>
          {shownNations.map((n) => (
            <button
              type="button"
              key={n}
              className={`list-group-item list-group-item-action py-1 d-flex align-items-center gap-2${userNation === n ? " active" : ""}`}
              onClick={() => { setUserNation(n); setNationError(null); }}
            >
              <CountryFlag country={n} fallback={n.slice(0, 2).toUpperCase()} />
              {n}
            </button>
          ))}
          {shownNations.length === 0 && (
            <div className="list-group-item picker-columns-full text-muted small">
              No country by that name.
            </div>
          )}
        </div>
        {nationError && (
          <div className="alert alert-warning py-2 mt-2 mb-0" role="alert">
            {nationError} can't field a squad in this world — there aren't {INTL_MIN_POOL} of
            their players in it, or no goalkeeper among them. Pick another country, or start
            with none and wait for an offer.
          </div>
        )}
      </div>
      )}

      <div className="mb-3">
        <h6 className="text-muted text-uppercase small fw-semibold mb-2">
          Continental Cup places{" "}
          <HelpHint label="How do Cup places move?">
            Each country's places are re-earned on how its clubs have done in Europe over
            the last few seasons: go deep and your league sends more, go out early for
            years and it sends fewer. The Shield gives every league the same two either
            way. Turn it off and the places stay exactly as the world was built.
          </HelpHint>
        </h6>
        <div className="form-check form-switch">
          <input
            type="checkbox"
            className="form-check-input"
            id="rolling-coefficients"
            checked={rollingCoefficients}
            onChange={(e) => setRollingCoefficients(e.target.checked)}
          />
          <label className="form-check-label" htmlFor="rolling-coefficients">
            Cup places can move between countries
          </label>
        </div>
        {/* One line either way, saying which of the two you're getting. How the
            mechanic works is on the heading's hint, next to the label that
            names it. */}
        <p className="text-muted small mt-2 mb-0">
          {rollingCoefficients
            ? "Your league sends more clubs when they do well in Europe, fewer when they don't."
            : "Every country keeps the same number of places forever."}{" "}
          Fixed once you start.
        </p>
      </div>

      <div className="mb-3">
        <h6 className="text-muted text-uppercase small fw-semibold mb-2">
          <label htmlFor="world-cup-size" className="mb-0">World Cup size</label>{" "}
          <HelpHint label="How big can it be?">
            Qualifying hands out the places by confederation, and every qualifying group
            plays for at least its winner's place. Bigger fields let more of the world's
            smaller nations in; smaller ones make qualifying tougher. If your world can't
            fill the size you pick, the World Cup drops to the biggest one it can.
          </HelpHint>
        </h6>
        <WorldCupSizeSelect id="world-cup-size" value={worldCupSize} onChange={setWorldCupSize} />
        <p className="text-muted small mt-2 mb-0">
          {worldCupSizeBlurb(worldCupSize)} You can change this later on the Qualifying page.
        </p>
      </div>

      <div className="mb-3">
        <h6 className="text-muted text-uppercase small fw-semibold mb-2">
          How players develop{" "}
          <HelpHint label="What changes?">
            Normally a player's summer is a roll of the dice: a squad player can add
            eight points out of nowhere, and a prospect can go backwards for no reason
            you'll ever see. Steady careers take the dice out. Everyone still improves
            through their early twenties, holds through their peak, and falls away from
            thirty — faster every year after that — but a player follows his own arc
            instead of lurching about. How much he plays still speeds it up or slows it
            down, and players still turn out differently from each other; the difference
            is that who a player becomes is settled in his talent rather than re-rolled
            every summer, so your scouting reports are worth a lot more.
          </HelpHint>
        </h6>
        <div className="form-check form-switch">
          <input
            type="checkbox"
            className="form-check-input"
            id="steady-progression"
            checked={progressionModel === "steady"}
            onChange={(e) => setProgressionModel(e.target.checked ? "steady" : "random")}
          />
          <label className="form-check-label" htmlFor="steady-progression">
            Steady careers, no random growth
          </label>
        </div>
        {/* Unlike the two settings above, this one really can be changed later, so
            the line says so rather than repeating "fixed once you start". */}
        <p className="text-muted small mt-2 mb-0">
          {progressionModel === "steady"
            ? "Players follow their own arc. No more nobody-to-superstar summers."
            : "Players can break out or fall apart in a single summer."}{" "}
          You can change this later in God Mode.
        </p>
      </div>

      {importError && (
        <div className="alert alert-danger py-2" role="alert">
          <div>Couldn't import that file.</div>
          <div className="small">{importError}</div>
        </div>
      )}

      {/* Redundant when you arrived through Customize Teams, which always
          opens the editor. */}
      {!customize && (
        <div className="form-check form-switch mb-3">
          <input
            type="checkbox"
            className="form-check-input"
            id="name-clubs"
            checked={nameClubs}
            onChange={(e) => setNameClubs(e.target.checked)}
          />
          <label className="form-check-label" htmlFor="name-clubs">
            Name the clubs yourself
            <span className="text-muted small d-block">
              Rename any club and set its colours, on the next screen.
            </span>
          </label>
        </div>
      )}

      <div className="d-flex gap-2 align-items-center">
        <button
          className="btn btn-primary"
          disabled={buildTid === null || saving || parsedStartYear === null}
          onClick={handleStart}
        >
          {saving
            ? "Building your world..."
            : customize || nameClubs
              ? "Next: Name Your Clubs"
              : spectate
                ? "Start Watching"
                : "Start League"}
        </button>

        {/* Loading a previously exported save, which has nothing to do with the
            roster file already loaded — hidden once one is, to keep the two
            kinds of "import" from sitting side by side. */}
        {!worldRoster && (
          <button
            className="btn btn-outline-secondary"
            onClick={handleImportClick}
            title="Load a saved game you downloaded with Export"
          >
            Import League
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="d-none"
          onChange={handleFileChange}
        />
      </div>

      {/* Generating 240 clubs and their squads blocks the browser for a few
          seconds, and a frozen page with no explanation reads as a broken one.
          Extra clicks are dropped either way (see the gate above), so this is
          about the wait making sense, not about preventing anything. */}
      {saving && (
        <p className="text-muted small mt-2 mb-0">
          Filling 240 clubs with players. The page will sit still for a few seconds.
        </p>
      )}
    </div>
    </CrestArtProvider>
    </CustomCrestProvider>
  );
}
