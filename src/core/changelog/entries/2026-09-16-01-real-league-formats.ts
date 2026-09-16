import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-16",
  title: "Leagues that play by their real rules",
  items: [
    "A lot of countries were running the same generic setup, so I went through them one by one and gave each its real league format.",
    "Promotion rules can now be different at each step of a country's pyramid. **Spain and Italy** still send three up from their second divisions, but four up from their third. **Germany, Portugal and the Netherlands** send two up and two down automatically and settle a third place with a two-legged tie between the clubs either side of the line. **Scotland** does the same with one automatic place each way. **Belgium, Greece and Brazil** swap straight, with no playoff at all. The **Dutch and Belgian third divisions are closed**, because their real ones are semi-professional with no way up.",
    "**France** gets Ligue 2's playoff. The top two go up and the bottom two go down, then 4th hosts 5th, the winner goes to 3rd, and whoever gets through plays the top flight's 16th home and away for the last place. Finish fifth and you need to win three rounds, the last one against a club from the division above.",
    "**Scotland and Greece split their tables.** Scotland's top flight plays 33 games, then the top six and bottom six each play one more round among themselves, 38 in all. Greece plays 26, then splits into a top four playing for the title, a middle four playing for the European places and a bottom six trying to stay up. Points carry over, but once the split happens you finish inside your group, so the club in sixth can't drop below sixth even if seventh passes it on points. Standings labels each group, and the second part of the fixture list shows up on your schedule the moment the split happens. Scotland's second and third divisions now play each other four times.",
    "Some divisions changed size to match the real leagues. **Belgium's** top flight goes up to 18, **Turkey's** second division down to 18, **Portugal's** third division up to 20, and **Serbia** drops to 12 clubs in every division. The **US** lower divisions now copy the USL: a second division of 25 in conferences of 13 and 12, and a third division of 17. Both finish with a title playoff: the top eight of each conference in the second division, and the top eight of the table in the third.",
    "England's and Spain's second divisions stay at 20 rather than their real 24 and 22, because more than 20 clubs playing each other twice won't fit in the season.",
    "World setup has a separate promotion count and playoff picker for each step of a three-division country, and the new French playoff is one of the options.",
    "The division sizes and the per-step counts only apply to new saves. In a save you already have, the new playoff systems, the Scottish and Greek splits and the US lower-division playoffs start from your next season.",
  ],
};

export default entry;
