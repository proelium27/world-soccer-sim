import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-08",
  title: "Watching a match is its own page, with both lineups on it",
  items: [
    "Watching a match no longer opens a window over the top of the game. It's a page like any other now, with its own address, the sidebar still there and the back button working. A player who uses a screen reader asked for this, and it's better either way: a window has to be dismissed before you can read anything else, where a page you just read.",
    "Both team sheets are at the bottom of it. The eleven each side started with, the position every one of them actually played, and the shape that adds up to. Substitutions get added underneath as they're made, so the bench arrives while you're watching rather than all at once at the end. Anyone who stayed on the bench all game isn't listed, because nothing about him is recorded.",
    "The commentary is announced as it arrives, with the club, the player and the score, so you can follow a match without watching the clock.",
    "**Watch it back** from a box score opens that same page at its own address, so you can link to a replay or leave it with the back button.",
    "The matchday still isn't saved until you're finished with it, which is why the game keeps you on that page while a match is running. There's a **Skip the rest** link beside the playback controls if you've seen enough.",
    "One knock-on: the Pos column on a box score is now the position a player actually played rather than the one on his profile. A winger who spent the afternoon at full-back reads as a full-back, which is what his rating was judged on anyway.",
  ],
};

export default entry;
