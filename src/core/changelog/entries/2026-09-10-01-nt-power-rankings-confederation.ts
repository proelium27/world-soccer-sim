import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-10",
  title: "Power Rankings, one confederation at a time",
  items: [
    "A player asked for this. The national-team Power Rankings list every eligible nation in one long run, strongest first, and if you're managing a country outside Europe most of that list is nations you will never play. The ones you have to get past to qualify are all in your own confederation.",
    "So there's a dropdown for it now. Pick **North America** and you get the North American nations, numbered from 1. It only offers confederations your world has eligible nations in, so you can't land on one with nothing in it.",
    "Once you've narrowed it, the rank *and* the movement arrows are both against that confederation. If a nation above you slips and your world rank hasn't moved an inch, you'll still see the place you gained on them.",
    "A **World** column sits alongside, because a confederation table on its own won't tell you whether 1st in yours is 4th in the world or 40th.",
    "Nothing about the ratings themselves has changed, and every past year's rankings can be narrowed the same way.",
  ],
};

export default entry;
