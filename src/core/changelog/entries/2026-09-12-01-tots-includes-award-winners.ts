import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-12",
  title: "Award winners always make the Team of the Season",
  items: [
    "A player could win the Ballon d'Or and still get left out of his own league's Team of the Season. The two awards are scored on different things: the Team of the Season counts tackles and interceptions, so another striker in the league who did more defending could take the only striker spot.",
    "I've changed it so the bigger awards get their places first. The Ballon d'Or winner, the Goalkeeper and Defender of the Year, everyone in the World Team of the Year, and your league's Player of the Season and Golden Boot winner are always in their league's Team of the Season. The rest of the XI gets picked around them.",
    "One of them can still miss out if two of them play a position the XI only has one spot for, like striker. The bigger award keeps that spot.",
    "It starts with the next season you finish. Seasons you've already played keep the Team of the Season they had.",
  ],
};

export default entry;
