import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-19",
  title: "Continental Cup places now really move between countries",
  items: [
    "Countries are supposed to win and lose Continental Cup places based on how their clubs have done in Europe over the last five seasons. It turns out that never happened in a normal save. The part of the game that hands out the places couldn't see the past cup results, so every country kept its starting number of places forever.",
    "The Standings page was already shading places as if the system worked, so a club could look like it had qualified and then find the place had gone somewhere else. Now the two agree.",
    "Once a country has at least three seasons of European results, its places can change from one season to the next. Existing saves with that much history can see places move at the next offseason.",
    "Saves where rolling coefficients were switched off at the start are unchanged.",
  ],
};

export default entry;
