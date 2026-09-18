import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-18",
  title: "Build your own MLS in World setup",
  items: [
    "The things that make the American leagues different were only ever on the leagues I shipped. Now you can give them to any league in World setup, whether it's one you added or one that came with the game:",
    "- **Two halves.** Any division can be played as one table or split into two halves with their own schedules. You name the halves, and you can add a few games against the other half if there's room in the calendar.\n- **Bigger divisions.** One table still tops out at 20 clubs, but a split division can go up to 40.\n- **Each division sized on its own**, so a 30-club top flight can sit over an 18-club second tier.\n- **Closed divisions.** Set promotion to None and nobody goes up or down, like Liga MX and MLS.\n- **How the title is won**: top of the table, a top-8 playoff (single games or home and away), or playoffs within each half like MLS and Argentina.\n- **A continent**, so a league you add can play for the Americas Cup instead of the Continental Cup and Shield.",
    "If you set something the calendar can't fit, like turning a 30-club division back into one table, the panel pulls it back to the nearest thing that works rather than letting you start a save that won't run.",
  ],
};

export default entry;
