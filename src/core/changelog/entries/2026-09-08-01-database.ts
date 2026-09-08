import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-08",
  title: "A database of every player and club, sortable on any column",
  items: [
    "There's a new **Database** page in the sidebar. It's every player in the world in one table, and you can sort it by any column: overall, potential, market value, wage, contract length, age, or any of the fourteen attributes. So if you've ever wanted to know who the fastest player alive is, or the best finisher in the Spanish second division, it's now one click.",
    "Four sets of columns rather than one enormous table. **Overview** is rating, potential, value, wage and contract. **Attributes** puts all fourteen ratings side by side. **Season** gives that season's goals, assists, xG, tackles, cards and match rating, with a dropdown for any season on record. **Career** totals the lot across a whole career.",
    "The filters narrow the whole world before anything is ranked, so what you're looking at really is the top of what you asked for and not the top of some other list. Position, nationality, age, overall, potential, value, wage, contract length, name, and whether he's at a club, in an academy, or a free agent.",
    "The league filter is one dropdown that goes from a single division all the way up to the whole world, with presets for **top divisions only** and the **top 5 leagues**. Top 5 means the five strongest countries in your world, worked out from the leagues themselves, so it still means the right thing if you've added or retuned leagues in World setup. The transfer search got the same dropdown while I was in there.",
    "A **Clubs** tab does the same for all 626 clubs, on three sets: squad rating and average age, the money (budget, wage bill, how close a club is to its savings ceiling, what it's spent and taken in on transfers), and the season (record, goals for and against, shots, xG, possession, average rating). Good for finding the biggest wage bill in Europe, or the second-division side quietly outscoring everyone above it.",
    "One thing worth knowing about the potential column: it's your scouts' estimate, the same one you see everywhere else, and both the sorting and the filtering use that estimate rather than the real number. Otherwise sorting the table would quietly tell you something your scouts haven't worked out yet. Market value is priced off the estimate for the same reason.",
    "Whatever you've filtered and sorted goes into the page's address, so a view is a link you can bookmark or send to someone. It shows 100 rows at a time with the full count next to the page buttons. A page trying to draw fifteen thousand rows at once is how you make a browser hang, and I'd rather it stayed quick.",
  ],
};

export default entry;
