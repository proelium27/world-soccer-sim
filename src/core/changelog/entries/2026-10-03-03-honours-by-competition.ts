import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-10-03",
  title: "Player trophies say which league they came from",
  items: [
    "A player's Awards & Trophies used to lump every title into **League Champion** and every cup into **Domestic Cup**. Now each one names the competition, like 2x Spanish Division 1 Champion, English Cup or Italian Division 1 Golden Boot. If he's won titles in two countries, you get a pill for each.",
    "Player of the Season, Golden Boot and Team of the Season are split by league the same way. Hover a pill to see the years.",
    "Awards & Trophies moved to the top of the profile and runs the full width, and How he sees clubs runs full width further down with its two lists side by side. Between them, that gets rid of the big empty gap under the value chart. A player with no honours yet just doesn't get the trophies box.",
  ],
};

export default entry;
