import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-11",
  title: "Attribute tooltips stop getting cut off",
  items: [
    "Hovering a player's name in the Starting XI table on your national squad opened his attributes and then the substitutes table cut most of it off. Same thing on the Database and anywhere else a table can scroll sideways: hover a name near the bottom of one and you'd see the top inch of the panel and nothing else.",
    "The panel was being drawn inside the table, and a table that can scroll sideways clips anything hanging out of it, top and bottom included. It's drawn over the page now instead, so you get the whole thing wherever the row sits. It flips above the name when there's no room below, and it closes if you scroll.",
    "The **?** help bubbles work the same way and had the same problem in table headers.",
  ],
};

export default entry;
