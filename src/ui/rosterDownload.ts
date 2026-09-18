/**
 * Where the game sends someone who doesn't have a roster file yet.
 *
 * The game ships 320 fictional clubs on purpose (trademark caution — see
 * `docs/eafc-import.md`), and a roster file carrying real clubs and real
 * players is a local overlay you bring yourself. That leaves a gap: the import
 * flow tells you to write a file or generate one with an AI, which is a lot to
 * ask of someone who just wants to play a season with real squads.
 *
 * **The Leagues page is the placement that matters.** Its "Import" button is a
 * file picker, and `/new-league?roster=1` is only navigated to *after* a file
 * has been picked and parsed — so on that screen `roster` is always set and its
 * empty state is reachable only by typing the URL. Someone who has no file is
 * standing on Leagues, which is why the link lives beside that button. The
 * empty state on the import screen keeps a copy because it is the correct thing
 * to show there, not because anyone arrives on it by accident.
 *
 * So the file is *linked*, never bundled. It lives on a host outside this
 * repo and the URL is a build-time value, which keeps three things true at
 * once:
 *
 *   1. No real club or player name enters git, `dist/`, or any of the store
 *      uploads. The bundles stay exactly as trademark-clean as they are today.
 *   2. The link can be withdrawn by changing one env value and rebuilding —
 *      no emergency patch to three platforms.
 *   3. It is set per build target, which is what keeps it out of the
 *      CrazyGames bundle. Their rules restrict pointing players off-site (the
 *      same rule that makes `crazyGamesHtml()` in vite.config.ts strip the
 *      canonical/og tags), so `.env.crazygames` deliberately leaves it unset.
 *
 * Unset is the default everywhere, and an unset value renders no link at all
 * rather than a dead button. A build that forgets the variable is missing a
 * feature, which is visible; a build that ships a 404 behind "Download" is
 * a bug report.
 */

const raw = import.meta.env.VITE_ROSTER_DOWNLOAD_URL;

/**
 * The download URL, or null when this build wasn't given one.
 *
 * Only http(s) is accepted. The value is inlined from the environment at build
 * time and lands in an `href`, so a `javascript:` or `data:` URL sitting in a
 * mode file would be a script-injection vector wearing a download button.
 * Anything that isn't a parseable http(s) URL is dropped to null, which fails
 * the same safe way an unset value does.
 */
export const ROSTER_DOWNLOAD_URL: string | null = (() => {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value === "") return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.href;
  } catch {
    return null;
  }
})();

/** One downloadable file in the Leagues page's "Roster files" section. */
export interface RosterFileDownload {
  id: keyof typeof ROSTER_FILE_NAMES;
  /** What the section calls it. Plain words, not the file name. */
  title: string;
  /** One short line on what it gives you. */
  description: string;
  /** Rough size, so a phone user knows before tapping. */
  size: string;
  href: string;
}

/**
 * The file names the downloads are published under, in the same release as
 * each other. `real-clubs-and-players.json` is the one `VITE_ROSTER_DOWNLOAD_URL`
 * points at; the other is its SIBLING in that release, found by resolving its
 * name against that URL.
 *
 * A sibling rather than a second environment value, so the whole set still
 * turns on and off with the one setting that already existed (and stays off in
 * the CrazyGames build, which leaves it unset). The cost is that publishing a
 * new release means uploading both under these names, since a missing one is a
 * 404 behind its button.
 *
 * Each file is complete on its own (names, colours and badges for every club,
 * plus squads in the first), so there is nothing to combine and no load order.
 */
export const ROSTER_FILE_NAMES = {
  players: "real-clubs-and-players.json",
  clubs: "real-clubs.json",
} as const;

/** Every download the section offers, or none when this build has no URL. */
export const ROSTER_FILES: RosterFileDownload[] = ROSTER_DOWNLOAD_URL === null
  ? []
  : [
      {
        id: "players",
        title: "Real clubs and players",
        description: "Real names, colours and badges, with real squads in most top flights.",
        size: "13 MB",
        href: ROSTER_DOWNLOAD_URL,
      },
      {
        id: "clubs",
        title: "Real clubs",
        description: "Real names, colours and badges, with made-up players.",
        size: "10 MB",
        href: new URL(ROSTER_FILE_NAMES.clubs, ROSTER_DOWNLOAD_URL).href,
      },
    ];
