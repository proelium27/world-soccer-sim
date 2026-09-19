import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-19",
  title: "A round of fixes to what the pages tell you",
  items: [
    "I went through every page checking what it says against what the game actually does, and a lot of it had fallen behind. The Leagues screen still said 36 leagues and 626 clubs. It now counts them itself, so it can't go out of date again.",
    "The Manager page said the board judges you against what your squad is worth, and then two boxes down said it doesn't. The second one was right: it's where they expect a club like yours to finish.",
    "If you end up in debt, the Finance page no longer tells you to take on trialists (they're gone). It now says what you can actually do under an embargo: sell, take players on loan and promote from your academy. The Dashboard and Loans pages also agree now that your overdraft covers buying and signing, but a loan needs money in the bank.",
    "Smaller fixes: a third-division title no longer shows as \"Div 2 Champions\", World Cup qualifying groups are described correctly (everyone plays everyone three times, one round a summer), the Promotion Playoffs page explains the French playoff, the cup pages mention every division and the Americas Cup, and a few money labels that showed £ now show $.",
    "The blue-green notices on the Dashboard, Roster and Academy now use the game's own teal instead of Bootstrap's cyan, a few empty pages get a proper box that says when they'll fill up, and I cleared the dashes out of the help text and the Manual.",
  ],
};

export default entry;
