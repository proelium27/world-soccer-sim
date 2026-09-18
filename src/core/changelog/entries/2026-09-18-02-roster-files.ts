import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-18",
  title: "Real club badges and a real-clubs-only file",
  items: [
    "The \"Download Real Rosters\" button on the Leagues page is now a **Roster files** section with two downloads. Both give every club in the game its real name and colours, third divisions included, and most of them their real badge too.",
    "- **Real clubs and players** also has real squads in most top flights. It's the old file with badges added and the rest of the clubs filled in.\n- **Real clubs** keeps the made-up players, if you want real clubs without real squads.",
    "Pick one and load it with Import. It's all in the one file, so there's nothing to combine.",
    "Import also takes a badge pack along with your roster files now, so you can load both in one go.",
    "If you combine your own names-only file with one that has real squads, the real squads now stay whichever order you pick them in.",
  ],
};

export default entry;
