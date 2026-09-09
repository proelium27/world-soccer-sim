import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-09",
  title: "New worlds know how old their players are",
  items: [
    "A player reported that the ratings in a save go strange after about the fifth season: the best players in the world end up all being 20 to 23, the top ratings creep up toward the ceiling, and squads that started out looking evenly good turn into a strong eleven plus a pile of filler. All three are real. The first two came down to age, and they're what this fixes; the third has a different cause and I've written up where it stands at the bottom.",
    "When a world was generated, age didn't affect a player's ratings at all. It only set his birthday. So an 18-year-old was rolled at exactly the same standard as a 27-year-old, and then the game gave him a decade of normal development on top of that. He wasn't a prospect, he was a finished player with ten years of growth still owed to him.",
    "Those teenagers were the best players in the game within two seasons. At season 4 the ten best players in the big four leagues were aged 21, 21, 23, 21, 23, 21, 21, 22, 21, 21, and they kept climbing until they ran out of room at the top of the scale. Meanwhile the 30-somethings, generated at that same flat standard, only ever declined and retired, so squads hollowed out underneath them.",
    "Starting squads are now generated at the level the age curve says a player of that age should be at. A 17-year-old on the books is a prospect rated well below the first team, the best players in a new world are in their mid-to-late twenties like they should be, and a 35-year-old has lost a yard without losing his technique. The growth a young player gets from here is growth he hasn't already been paid for, so a new save starts in roughly the shape it's going to keep instead of lurching into it over five seasons.",
    "While I was in there I found a second one. Starting squads were aged 18 to 33 and youth intake starts at 16, so the two never met and no player was ever born in the gap between them. Every world had a two-year hole in its age distribution that crawled upward one year per season, and around season 10 it sat right on peak age. Squads now reach down to 16, so there's no gap.",
    "The third thing on that list isn't fixed, and it's worth saying so plainly rather than letting you find out. Squads really do hollow out over the first few seasons, but not because of age at generation: by season 13, about a fifth of a big-four squad is 16 and 17 year olds rated in the low 40s. That's AI clubs holding on to five high-potential kids each, on the senior roster, where they sit and never play. It's why the squad average falls even though the eleven doesn't get worse. Moving those prospects somewhere other than the senior squad is a separate job and I haven't done it yet.",
    "This only affects worlds created from here on. Saves you're already playing are untouched.",
  ],
};

export default entry;
