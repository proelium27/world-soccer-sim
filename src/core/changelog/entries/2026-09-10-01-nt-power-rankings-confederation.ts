import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-10",
  title: "National team rankings got a Power score, and a confederation filter",
  items: [
    "A player asked whether the national rankings could be narrowed to one confederation, which turned into two changes to that page.",
    "**The filter first.** The rankings list every eligible nation in one long run, and if you're managing a country outside Europe most of that list is nations you will never play. The ones you have to get past to qualify are all in your own confederation. So there's a dropdown for it now. Pick North America and you get the North American nations, numbered from 1, and it only offers confederations your world has eligible nations in.",
    "Once you've narrowed it, the rank *and* the movement arrows are both against that confederation, so if a nation above you slips and your world rank hasn't moved an inch, you'll still see the place you gained on them. A **World** column sits next to it, because 1st in your confederation might be 4th in the world or 40th.",
    "**The second change came out of checking the first.** Club rankings have always been a blended Power score: squad strength plus a bonus or penalty for how you've actually been playing. National teams had nothing of the kind. The column said Rating and it meant the average overall of your best eleven, full stop. Win the World Cup and you ranked exactly where you would have if you'd gone out in the group.",
    "They get a real **Power** score now, on the same idea as the club one. Results are worth more when you weren't expected to get them, so beating a side rated well above you moves you further than beating one you should have beaten. Record and goal difference sit on the table too, and Rating stays in its own column so you can still see who has the better squad.",
    "**Where the game was played counts as well**, using FIFA's own weights from the real world ranking: a qualifier is worth 25, a continental tournament 35 and 40 once you reach the quarter-finals, the World Cup 50 and 60 on the same split. So a World Cup knockout tie moves you more than twice as far as a qualifying group game, which is roughly how it should feel. A tie settled on penalties goes into the record as the draw it was, but the side that won the shootout is credited halfway between a draw and a win. That is FIFA's rule too, and it's better than my first attempt, which ignored the shootout entirely.",
    "The campaign you're **currently playing** counts as well. Qualifying runs three legs across three summers, and only got added to the record when the whole thing finished, so for two years out of every four the most recent football anyone had played was invisible here.",
    "It reads the **last four seasons** of international football rather than resetting every year. Clubs reset because they play 38 league games; a nation plays a handful, and the tournament falls in the last summer of the cycle, so a yearly reset would throw the World Cup away the very next time you looked.",
    "This reorders the top more than you might expect, because national squad ratings bunch up tightly there. In my test save the best squad in the world belonged to Spain and Germany was still top of the table on the back of a better qualifying campaign.",
    "One deliberate gap. Your federation still judges you on squad strength, not on Power, so the order on this page and the bar you're held to can differ. If results moved the bar, losing on purpose would lower it, which is exactly the hole the club board's expectations were rebuilt to close.",
    "All of it is worked out from results your save already had, so every past ranking you can browse back to has the new columns filled in.",
  ],
};

export default entry;
