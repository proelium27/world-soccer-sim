import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-10-02",
  title: "The game was crashing on phones",
  items: [
    "A lot of you on phones were losing the game partway through a season, usually on **Sim to End of Season** or the first offseason. The page just died, with no error, which is why it took me this long to see it.",
    "The cause was memory. A long sim held a full match report for every game in the world at once, and held most of them more than once. On the current world one season peaked at about **1.4 GB**, and phones close a tab well before that.",
    "Long sims now run a few matchdays at a time and put each batch's match reports on disk before starting the next. The same season peaks at about **330 MB**. The results are exactly the same as before, down to the last goal, and a sim still stops before your cup finals like it used to.",
    "A full season takes a little longer on desktop because of this, roughly 73 seconds instead of 53 on my machine.",
    "Also fixed: jumping ahead several seasons could crash the game when it showed you the summary, in a watch-only save or after adding a club in God Mode. The Club History page had the same crash.",
  ],
};

export default entry;
