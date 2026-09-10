import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-10",
  title: "Youth intake comes through a year younger",
  items: [
    "Your academy turns up **15-year-olds** now instead of 16-year-olds.",
    "That's a bigger change than it sounds, because ratings are generated with no age term in them at all. A prospect is rolled to the same standard whatever age he is, and the age curve then hands him whatever growth he has left before he peaks. So taking a kid in a year earlier doesn't make him rawer. It hands every player in the world an extra year of development, and the league drifts up off the back of it.",
    "The intake is generated about a point rawer to pay for that. I ran careers start to finish under the old numbers and the new ones: the rating a player carries through his peak years lands at 66.2 against 66.6, and the share of those years spent at 80 or better goes 30.2% to 30.7%. He ends up in the same place. He just starts further back and takes an extra year getting there.",
    "They arrive earlier and need longer, so **academy deals run three seasons instead of two**. A 15-year-old you sign is still yours at 18 rather than walking off for nothing at 17. The academy holds **15 instead of 10** too, because you're carrying three intakes at once now rather than two.",
    "Starting squads reach down to 15 as well. When world generation got an age model last week I had squads reach down to 16 so there'd be no gap between the youngest generated player and the youngest academy player. Moving intake without moving that would have opened the same hole again, a year wide.",
    "Scouted ceilings read about a point higher than they did, because there's an extra year of career left for a scout to guess at. I've left that alone. Nothing else about potential changed, and the guess is as unreliable as it ever was.",
    "The generation half is new worlds only. A save you're already playing keeps the squad it has, and gets its first 15-year-olds at the next intake.",
  ],
};

export default entry;
