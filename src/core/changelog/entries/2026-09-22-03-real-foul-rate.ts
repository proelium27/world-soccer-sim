import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-22",
  title: "Matches have as many fouls and cards as the real thing",
  items: [
    "Matches used to have about 13 fouls and 2 yellow cards. A real top flight has closer to 23 fouls and 4 yellows, so I've brought the engine up to that. Reds land at about one every four or five matches.",
    "Scoring barely moves. Most fouls just stop play, so I cut the chance of any one of them turning into a dangerous free kick or a penalty by the same amount. You get the same number of set pieces as before, spread over more whistles.",
    "A player who's already on a yellow now eases off and commits fewer fouls for the rest of the game, like real players do. Without that, second yellows would have piled up on the same few players.",
    "**Suspensions come up about twice as often**, since five yellows gets a player a one-match ban. Keep an eye on who's close to five, and expect to rotate a little more over a season.",
  ],
};

export default entry;
