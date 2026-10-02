import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-10-02",
  title: "The game was crashing on phones",
  items: [
    "A lot of you on phones were losing the game partway through a season, usually on **Sim to End of Season** or the first offseason. The page just died, with no error, which is why it took me this long to see it.",
    "The cause was memory. A long sim held a full match report for every game in the world at once, and held most of them more than once. On the current world one season peaked at about **1.4 GB**, and phones close a tab well before that.",
    "On phones and tablets, long sims now run a few matchdays at a time and put each batch's match reports on disk before starting the next. The same season peaks at about **330 MB**. It takes a bit longer on a phone, but it finishes. Desktop sims work exactly as they did, at the same speed.",
    "Jumping ahead several seasons had the same problem and gets the same fix, on every device, without getting any slower.",
    "The results are exactly the same as before, down to the last goal, and a sim still stops before your cup finals like it used to.",
    "Jumping also had a stats bug: if you'd played part of a season and then jumped, that season's team stats on the Stat Leaders page counted those matches as zero goals, shots and ratings for every club. Jumping right after finishing a season zeroed the whole season. That's fixed for new jumps, though seasons already recorded that way stay as they are.",
    "Also fixed: jumping ahead several seasons could crash the game when it showed you the summary, in a watch-only save or after adding a club in God Mode. The Club History page had the same crash.",
  ],
};

export default entry;
