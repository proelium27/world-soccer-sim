import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-06",
  title: "Ratings now read on the scale you're used to",
  items: [
    "Every rating in the game went up by 11. A top-flight squad used to run from about 50 to 81, which meant your best player was a 74 and read as mediocre to anyone who's played the big licensed football games. That same squad now runs from the low 60s to the low 90s, an average starter is a 76 rather than a 65, and a real star is in the high 80s.",
    "This is a relabel, not a rebalance. Every rule that reads a rating moved up by the same 11 at the same moment: wages, transfer fees, the Division 2 ceiling, who counts as a protected star, all of it. A player worth £40M is still worth £40M, a season that finished on 82 points still finishes on 82 points, and your squad is exactly as good relative to everyone else as it was yesterday. I checked that rather than assuming it. Wages and fees come out identical to the pound, and match results don't move.",
    "Your existing saves come along on their own. Everything in them gets lifted the first time you load: living players, retirees, past award winners, all their history. A save carries on where it left off with bigger numbers on the cards, you don't need to do anything, and there's no way to end up with a half-converted one.",
    "The very top of the scale did change, because ratings stop at 99 and the ceiling was already 95, so there was no room to move it up by another 11. A once-in-thirty-seasons **generational talent** now peaks in the mid-to-high 90s against a world topping out around 91, where before he reached about 95 against a world topping out around 80. He's still comfortably the best player alive, just not by as silly a margin.",
    "The lower divisions came up by the same 11 as everything else, so a third division sits in the 30s and 40s. That's still well below anything the licensed games put a number on, but they don't have twelve countries running three divisions each, so there was never a number there to match in the first place.",
    "If you import a real-world roster file, the ratings in it land much closer to what you'd expect now that the two scales line up, at least for a division the file covers properly. A division it only half covers can still read low.",
  ],
};

export default entry;
