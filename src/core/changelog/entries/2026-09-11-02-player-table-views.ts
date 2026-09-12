import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-11",
  title: "Read a player list three ways",
  items: [
    "A player wanted to see attribute numbers where the contracts and wages usually go, and to pick international squads on form first, attributes second, overall third. So Transfers (both tables), Free Agents, the Watchlist and the two national-team squad pages now carry the same switch above their tables: **Overview**, **Attributes**, **Performance**.",
    "Overview is the page you already know. Attributes puts all fourteen ratings beside the name, so you can line ten strikers up on finishing instead of on overall. Performance shows what a player actually did in the league: games, minutes, average match rating, goals, assists, xG, tackles, interceptions and saves, with a dropdown for the last few seasons. During the summer, when you're naming a national squad, it opens on the season that just finished, which is the form you'd be picking on anyway.",
    "Every heading sorts, in every view. Sorting on match rating puts the regulars first: anyone who played under half as many games as the busiest player on the list drops below them, because a 9.0 from one cameo isn't a season. He's still there, just not above a man who did it for nine months.",
    "On the Player Pool the sort now runs over every eligible player in your country before the list gets cut to the top forty. That's the difference between finding the in-form 62 at a mid-table club and reshuffling the same forty players you were already being shown.",
    "The view is part of the page's address, so a sorted attribute sheet is a link you can bookmark or come back to.",
    "One bug turned up while doing it. The Pot column on Transfers and on the Watchlist was sorting on players' **real** potential rather than on what your scouts reckon, so ordering by it quietly answered the question the scouting range exists to keep open. The Database and the youth pages had this fixed a while back; these two were written the same way and got missed. Both rank on the top of the scouting range now, like everywhere else.",
  ],
};

export default entry;
