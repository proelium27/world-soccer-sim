import { POSITIONS, SKILL_KEYS } from "../players/types.js";
import { ROSTER_FILE_FORMAT, ROSTER_FILE_VERSION, type RosterSlotWorld } from "./rosterFile.js";

/**
 * Build a ready-to-paste instruction block that teaches an AI assistant the
 * exact roster-file format, tailored to one world. The importer maps clubs to
 * competitions *by name*, so the prompt must list that world's real competition
 * names and slot counts — a generic prompt would produce a file whose
 * competitions don't match and silently apply nothing.
 *
 * It takes a RosterSlotWorld rather than a LeagueStore, which is the same shape
 * resolveRosterSlots aims a file with. A save satisfies it structurally, so the
 * in-league TopBar button is unchanged; what it buys is the two screens where a
 * roster file is actually imported — /leagues and /new-league, both of which sit
 * outside Layout and so have no TopBar — being able to hand out the prompt for a
 * world that does not exist yet (worldTeamSlots, competitions.ts). Before that,
 * the only copy of the prompt lived in a loaded save's top bar while importing
 * was creation-only, so anyone starting a fresh save with real rosters had to
 * either already have a save open or write the file without the spec. Files
 * built without it turned up in the wild breaking several of the rules below at
 * once (2026-09-02: no country/tier, real-world division sizes rather than this
 * world's, invented competitions, reconstructed rather than copied names).
 *
 * **Both ways that goes wrong fail SILENTLY, which is why the prompt spends so
 * many words on them.** resolveRosterSlots pushes a warning and carries on: an
 * unrecognised `match` drops that whole competition, and a club list longer
 * than the competition truncates from the end. Neither throws, so a file can
 * look complete, import cleanly and change nothing.
 *
 * Both were hit for real (2026-08-29). Three hand-authored files named their
 * competitions "Scotland/Greece/Serbia Division 1" — the `<country> Division N`
 * form, which is what a league you ADD in World setup is called, but not what
 * the shipped countries are called ("Scottish Division 1") — so all three
 * resolved to zero clubs. The same files carried 20 clubs per division, from
 * before the world moved to real division sizes (Scotland 12, Greece 14). Hence
 * the three numbered rules: copy the name rather than building one from the
 * country, never overshoot the slot count, and don't invent a competition that
 * isn't listed.
 *
 * The first of those three is much less sharp than it was, because a file can
 * now state `country` and `tier` and be found by them (resolveRosterSlots) —
 * and that exact failure would not happen today, since "Scotland Division 1"
 * reads back as Scotland's top flight. The prompt still asks for the name to be
 * copied, and now asks for the country and tier beside it, because a file that
 * carries all three cannot be aimed wrongly by either route.
 *
 * The prompt also spends words on `colors`, which is the one FATAL mistake it
 * has seen in the wild rather than a quiet one. parseRosterFile requires
 * exactly two hex strings and throws on anything else, and a throw rejects the
 * whole file — so a single club is enough to cost an author every other one.
 * Reported 2026-09-02: a 232-club, 5,873-player all-time-teams file failed
 * outright because two Brazilian clubs (Fluminense, Bahia) listed their real
 * three colours. That is the trap worth naming explicitly — the author was not
 * being careless, they were being ACCURATE, and accuracy is what produced the
 * broken file. Hence both a rule and a checklist line, and hence the note that
 * the three rules above fail quietly while the field shapes below do not: an AI
 * told everything degrades gracefully will not re-read a field shape.
 *
 * It also spends a line telling the AI not to write a `logo`, which is the one
 * thing here written to head off a mistake rather than in response to one.
 * `colors` sits in the club shape as the club's visual identity, so a badge is
 * the natural next key for an AI to invent. A club CAN carry a `logo` (a league
 * file exported from a save writes one), but only as an image data URL, and
 * anything else in that key, like the web link an AI would write, is DROPPED IN
 * SILENCE. That is this
 * game's custom-badge failure arriving from a new direction: the author would
 * believe the badges were in the file, get none, and have nothing to tell them
 * why. The line is deliberately a "don't" plus a pointer at the real route
 * (image files, same screen) rather than an instruction to produce anything —
 * asking a language model for a picture gets hallucinated base64, which WOULD
 * be fatal, since the pack parser rejects a data URL it cannot read.
 */
export function buildImportPromptText(world: RosterSlotWorld): string {
  const slotsOf = (id: number) => world.teams.filter((t) => t.compId === id).length;
  const comps = world.competitions.map(
    (c) =>
      `  - "${c.name}" — country "${c.country}", tier ${c.tier} — ${slotsOf(c.id)} club slots`,
  );

  // A concrete example beats an abstract warning, and taking it from this world
  // keeps it true for a custom one. A name "follows" its country when it starts
  // with it, which is exactly the construction an AI reaches for; the shipped
  // names are adjectival ("English Division 1" in England) and so never do.
  const follows = (c: { name: string; country: string }) =>
    c.name.toLowerCase().startsWith(c.country.toLowerCase());
  const odd =
    world.competitions.find((c) => c.tier === 1 && !follows(c)) ??
    world.competitions.find((c) => !follows(c));
  const nameWarning = odd
    ? `Most of them are NOT their country's name with "Division" after it: this world calls ${odd.country}'s top division "${odd.name}".`
    : `Take the whole string from the list, including any wording you would not have guessed.`;

  const sizeNote =
    new Set(world.competitions.map((c) => slotsOf(c.id))).size > 1
      ? " The divisions are deliberately different sizes — they follow the real leagues — so read each one's number instead of assuming they all hold 20."
      : "";

  const example = {
    format: ROSTER_FILE_FORMAT,
    formatVersion: ROSTER_FILE_VERSION,
    competitions: [
      {
        match: world.competitions[0]?.name ?? "English Division 1",
        country: world.competitions[0]?.country ?? "England",
        tier: world.competitions[0]?.tier ?? 1,
        clubs: [
          {
            name: "Example City",
            abbrev: "EXC",
            colors: ["#6cabdd", "#ffffff"],
            players: [
              { name: "Star Striker", pos: "ST", age: 24, overall: 88, nationality: "Norway" },
              {
                name: "Playmaker",
                pos: "AM",
                age: 29,
                ratings: Object.fromEntries(SKILL_KEYS.map((k) => [k, 80])),
              },
            ],
          },
          { name: "Rivals United", abbrev: "RVU", colors: ["#c0392b", "#ffffff"] },
        ],
      },
    ],
  };

  return [
    "I want you to create a roster file for the soccer management game soccer-gm.",
    "It overlays club names and (optionally) whole squads onto my save. The clubs and players can be anything I ask for: real present-day leagues, a historical season, all-time XIs, a made-up world, a themed or fictional league, whatever. Output ONE valid JSON file in exactly the format described below — no prose, no markdown fences, just the JSON.",
    "",
    "== My world's competitions ==",
    "These are the only competitions my save has. Give each one its `match` name EXACTLY as written here, plus the `country` and `tier` shown beside it.",
    ...comps,
    "",
    "Three rules about that list. They are in the order people get them wrong, and getting any of THESE THREE wrong fails QUIETLY — the file still imports, it just doesn't do what you meant. (Mistakes in the field shapes further down are the opposite: they are fatal and they take the whole file with them. Both kinds are worth avoiding, for different reasons.)",
    `1. COPY each name from the list; never build one out of the country's name. ${nameWarning} ALWAYS include \`country\` and \`tier\` as well: that pair is what actually finds the league, and it keeps working if I rename my divisions later, whereas a \`match\` name that matches nothing and has no country beside it is skipped with no error — that whole competition is dropped and not one of its clubs is applied.`,
    `2. NEVER list more clubs than a competition's slot count.${sizeNote} Anything past the count is thrown away from the END of your list, so you would silently lose whichever clubs you happened to put last. If the real league you are copying is bigger than the slot count, you decide which clubs to leave out — drop the weakest — and list only the ones that fit.`,
    "3. Don't invent a competition. If I ask for a league that isn't on the list, do the ones that are and then TELL me the rest aren't in this world, so I can add them before importing. A plausible-looking name for a league I don't have is worse than no entry at all, because it looks like it worked.",
    "",
    "Listing FEWER clubs than the slots is always fine — the ones you leave out keep the names they already have. The clubs you do list fill the slots in order, first entry into the first slot, so put them in a sensible order (strongest first is the usual one).",
    "If I ask for more leagues than you can fit in one answer, do as many as you can fit properly and tell me which ones are left, rather than thinning out the squads to cram them all in. The game loads several roster files into one league, so I can come back for the rest and import them together.",
    "",
    "== File shape ==",
    "Every field below has to have exactly the shape described. Unlike the three rules above, a field of the wrong shape is a HARD error: the game refuses the file outright and not one club of the hundreds you wrote is imported. It is worth a moment re-reading this section before you answer.",
    "{",
    `  "format": "${ROSTER_FILE_FORMAT}",`,
    `  "formatVersion": ${ROSTER_FILE_VERSION},`,
    '  "competitions": [ { "match": "<competition name>", "country": "<country>", "tier": 1 | 2 | 3, "clubs": [ <club>, ... ] }, ... ],',
    '  "nationalities"?: { "<nation>": number, ..., "__REST__": number }',
    "}",
    "",
    "A <club> is:",
    '  { "name": string, "abbrev": string (2-4 letters), "colors": [primaryHex, secondaryHex], "players"?: [ <player>, ... ] }',
    "- `colors` is EXACTLY TWO hex strings, a primary and a secondary — never one, never three. Plenty of real clubs wear three — Fluminense and Bahia both do — so pick the two that identify them best and drop the rest. This is the single most common way a roster file is rejected, precisely because listing all three feels more accurate.",
    "- Don't add a logo, crest or badge field. A badge is a picture, and pictures aren't something you can write into a JSON file — I load those myself, as image files, on the same screen I got this prompt from. A web link or anything else you put in a `logo` key is thrown away without an error, so adding one wouldn't fail, it would just quietly do nothing.",
    "- Omit `players` to change only the club's name/abbrev/colors and keep its existing squad.",
    "- Include `players` to give it a squad of your own. That REPLACES the club's current players, so do this on a fresh save.",
    "- You don't have to list a full squad — whatever positions you leave short are auto-filled with lower-rated reserves so the team is always playable. A first XI plus a few subs is plenty.",
    "",
    "A <player> is:",
    '  { "name": string, "pos": <position>, "age": number 15-45, ...ability, "nationality"?: string, "heightCm"?: number, "potential"?: number }',
    `- <position> is one of: ${POSITIONS.join(", ")} (GK=keeper, CB=centre-back, FB=full-back, DM=defensive mid, CM=central mid, AM=attacking mid, W=winger, ST=striker).`,
    "- ability: give EITHER an `overall` (a single 1-99 rating; the game builds sensible position-appropriate ratings to match it) OR an exact `ratings` object with all of these keys, each 1-99:",
    `    ${SKILL_KEYS.join(", ")}.`,
    "  Prefer `overall` unless you specifically want to hand-tune every attribute.",
    "- `potential` (optional, 1-99) is the player's ceiling; if omitted the game estimates it. `heightCm` and `nationality` are optional flavor.",
    "",
    "The optional top-level `nationalities` sets where this LEAGUE's players come from — not the ones you list (those carry their own `nationality`), but the reserves that fill out short squads and every youth prospect it produces from then on. Leave it out and the league keeps whatever it already had.",
    '- Numbers are relative, so percentages are the easy choice: { "Netherlands": 55, "Belgium": 8, "Brazil": 5, "__REST__": 32 }.',
    '- `__REST__` is the combined "rest of the world" share. Note it leans English, so name the nations you actually want rather than relying on it.',
    "- Use the nation names the game already knows (the same ones you'd put on a player's `nationality`); anything it doesn't recognize is dropped.",
    "",
    "== Example ==",
    JSON.stringify(example, null, 2),
    "",
    "== Check these before you answer ==",
    "- Every `match` string appears, character for character, in the competition list above.",
    "- No competition lists more clubs than its slot count.",
    "- Every club's `colors` is an array of exactly two hex strings.",
    "- No club has a `logo`, `crest` or `badge` field.",
    "- The answer is one JSON object and nothing else — no markdown fences, no commentary around it.",
    "",
    "== What I want ==",
    "Below this line I'll tell you which competition(s) to fill and what to fill them with. Follow that description, whatever it is — real clubs, a past season, invented clubs, a crossover of teams from something else. Only fall back to real present-day clubs if I haven't said. If what I asked for is unclear, ask me before writing the file; otherwise output only the JSON.",
  ].join("\n");
}
