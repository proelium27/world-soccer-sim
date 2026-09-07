import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-06",
  title: "You can take players on loan now",
  items: [
    "Loans only ever went one way. You could send players out, and AI clubs traded loans among themselves, but there was no way to borrow anyone. The Loans page now has a **Loan a Player In** panel that searches the whole world, with the same filters as the transfer search. You can agree two a window.",
    "The rules are the ones the AI already played by. A club will lend you someone 23 or under who isn't in its starting eleven, whose contract covers the loan, who it can spare at his position, and who'd be worth more to you than to them.",
    "**Loans now have to get the player a game**, both ways round. A club only lends to somewhere he'd be better than the weakest man in the first eleven at his position. That's the entire reason a loan exists, a young player who isn't getting minutes going somewhere he will, and it turned out the game wasn't checking it. I measured a full season of every loan the AI clubs agreed: **more than half the loaned players never played a single match at their new club**, and the median one made zero appearances. They'd moved and were sitting on a different bench. It's now 89% who play, and the median loanee gets 26 games.",
    "This applies when you send someone out too, which is the case I actually care about. Before, a club that fancied him could take him and never pick him. Now the offer only comes from somewhere he'd play. The flip side: list someone genuinely poor and you may get no offers at all, because nobody wants to develop a player who'd be on their bench as well.",
    "It also decides how good a loan you can get coming the other way, and I didn't tune this in. It falls out of how strong your own eleven is. The best sides in the world are offered nobody worth having. A mid-table top-flight club gets a short list. Drop a division or two and the screen fills with players who'd walk into your team. Loans are how a small club punches above itself, which is right.",
    "He shows up on your roster with an **On loan** badge and plays like anyone else, but he isn't yours. You can't sell him, release him, or re-sign him, and no club will bid for him. When the loan runs out he goes home, and there's no option to buy him.",
    "The fee is a fraction of what he'd cost to buy, and it's marked up or down by your difficulty like any other asking price, so borrowing isn't a way round a hard save. There's a small minimum too. Without one, more than half the players in the game are cheap enough that a loan fee rounds to nothing, and the column just read $0.",
  ],
};

export default entry;
