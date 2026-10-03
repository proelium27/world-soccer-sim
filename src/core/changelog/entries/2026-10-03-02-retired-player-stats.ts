import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-10-03",
  title: "Retired players keep their full stats",
  items: [
    "A few of you asked for this one. A retired player's page now has the same stat tables he had while he was playing: every league season with all the columns (goals, assists, xG, tackles, passes, cards, minutes, match rating and the rest), the **Per 90** switch, his cup runs and his national-team campaigns.",
    "It works for players who retire from now on. Until now, retiring threw away each season's stat line and kept only the career totals, so anyone who retired before this update still shows his cup tables, but for each league season only the club, his rating and his appearances.",
    "The stats sit on disk and only get read when you open his page, so the game doesn't use more memory and sims aren't any slower. They do take some space: about 2.4 KB per retired player once packed (6 KB unpacked), which comes to roughly 48 MB on a very long save.",
    "They travel with your save when you export it. And in God Mode, un-retiring a player now brings back his real season stats instead of an empty table.",
  ],
};

export default entry;
