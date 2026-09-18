import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-18",
  title: "Real club names and badges on the Leagues page",
  items: [
    "The Leagues page has a new **Roster files** section. It has three downloads where there used to be one \"Download Real Rosters\" button:",
    "- **Real clubs and players** is the file that button gave you. It has real clubs in the top two divisions of every country, with real squads in most top flights.\n- **Real club names** gives every club in the game its real name and colours, third divisions included, and keeps the made-up players.\n- **Real club badges** puts real badges on close to 900 clubs.",
    "You can pick all three in Import at once. Before, badges only loaded from the New League screen.",
    "If you load a names-only file together with one that has real squads, the real squads stay whichever order you pick them in. The names file only fills in the clubs the other one leaves out, like the third divisions.",
  ],
};

export default entry;
