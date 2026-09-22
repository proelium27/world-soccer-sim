import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-19",
  title: "The league table now shows who goes up and who goes down",
  items: [
    "There's a line across the table where the promotion places end and another where the relegation places start. A solid line means the table settles it; a dashed one means there's still a playoff to play. Underneath, a key names the division you'd go up or down to. It follows each country's own rules, so Spain sends three up from its second tier and four from its third, and nothing goes down into the Dutch or Belgian third division at all, because those are closed.",
    "**Before any games are played, the table stops pretending to have an order.** The position column is blank and no cup places are shaded until there's a result behind them. It no longer stops at \"no matches played yet\" either, so on day one you can at least see who else is in your division.",
    "**Power Rankings opens on your own division** instead of ranking all 884 clubs at once, and whatever you filter to now comes 100 at a time with the full count beside the page buttons. Drawing the whole world in one go made it one of the heaviest pages in the game, for a list most people only read the top of. The intro is shorter too; the explanation of how Power is worked out is still behind the (?) on the column.",
    "The News Feed opens on the most recent season that has anything in it, rather than every season at once. It also stops claiming you can narrow a season down by filtering to it, which was never true: the limit is per season, and what's held back is world news, never yours.",
    "Small one on the same page: a free transfer used to read \"$0\" in the fee column. It says \"Free\" now, and a loan says it's a loan.",
  ],
};

export default entry;
