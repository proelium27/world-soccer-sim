import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-09",
  title: "Every click was rewriting the whole season's match reports",
  items: [
    "If the game has felt sluggish on your machine, especially deeper into a season, this is why. Every time you changed a lineup, made a signing or nudged the scouting slider, the game wrote every box score of the season so far back to disk, not just the thing you'd changed.",
    "That pile grows every week of a season. By the end of one, on the current world, a single click was writing about **216 MB**, and just getting that ready took my desktop 2.6 seconds before it started saving anything. Phones are five to ten times slower.",
    "Box scores now live in their own place and are written once, when the match is played. The same click writes about **13 MB** and takes a tenth of a second to prepare. The matches and the reports are identical, they just stop being copied over and over.",
    "It had nothing to do with how old your save was, which is part of why it went unspotted for so long. Match reports are wiped every summer and built back up through the season, so a save in its second year hit this exactly as hard as one in its sixtieth. It got worse every week and then cured itself in the offseason, which reads like a slow device rather than a slow save.",
    "Your existing saves sort themselves out the first time you load them. There's nothing you need to do, and nothing is lost.",
  ],
};

export default entry;
