import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-10-17",
  title: "Watch any match, club or international, from the Schedule",
  items: [
    "The Schedule page used to show only your own club. Now there's a dropdown at the top that switches it to any league, continental cup or domestic cup in the world, and you step through it a matchday at a time.",
    "Every match on the next matchday has a **Watch** button. It plays the matchday and opens the live viewer on that game, whether or not your club is in it. When it's over you land back on the schedule you came from.",
    "Matchdays further ahead get **Sim to** instead. It plays everything before that matchday and stops, so you can watch it or sim it yourself.",
    "Spectator saves get the Schedule page too, which means you can finally watch a match when you don't have a club.",
    "International matches are watchable now too. On the National Teams **Schedule**, pick qualifying, the World Cup or a confederation cup, and every fixture in the stage that's up next has a **Watch** button. You get flags on the scoreboard and the group table moving down the side.",
    "Watching plays the whole stage, so picking one group game plays out the full group stage, same as the stage button. That page has the stage buttons too, so you don't have to go back to the Dashboard to keep going.",
    "Watch Next Game also picks up Continental Shield and Americas Cup ties now. Before, it only found Continental Cup ones.",
  ],
};

export default entry;
