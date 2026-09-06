import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-06",
  title: "You can take players on loan now",
  items: [
    "Loans only ever went one way. You could send players out, and AI clubs traded loans among themselves, but there was no way to borrow anyone. The Loans page now has a **Loan a Player In** panel that searches the whole world, with the same filters as the transfer search. You can agree two a window.",
    "The rules are the ones the AI already played by. A club will lend you someone 23 or under who isn't in its starting eleven, whose contract covers the loan, and who it can spare at his position, and only to a club he'd be worth more to than he is to them.",
    "That last condition turns out to matter more than I expected. Near the top of the pyramid there's very little worth borrowing, because almost nobody another club would lend would actually improve your side. Drop a division or two and the same screen fills up with players who'd walk into your first eleven. I didn't tune that in. It falls out of what a player is worth to each club, and it's the right way round, because loans are how a small club punches above itself.",
    "He shows up on your roster with an **On loan** badge and plays like anyone else, but he isn't yours. You can't sell him, release him, or re-sign him, and no club will bid for him. When the loan runs out he goes home, and there's no option to buy him.",
  ],
};

export default entry;
