import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-10-16",
  title: "Watch any match from the Schedule page",
  items: [
    "The Schedule page used to show only your own club. Now there's a dropdown at the top that switches it to any league, continental cup or domestic cup in the world, and you step through it a matchday at a time.",
    "Every match on the next matchday has a **Watch** button. It plays the matchday and opens the live viewer on that game, whether or not your club is in it. When it's over you land back on the schedule you came from.",
    "Matchdays further ahead get **Sim to** instead. It plays everything before that matchday and stops, so you can watch it or sim it yourself.",
    "Spectator saves get the Schedule page too, which means you can finally watch a match when you don't have a club.",
    "Watch Next Game also picks up Continental Shield and Americas Cup ties now. Before, it only found Continental Cup ones.",
  ],
};

export default entry;
