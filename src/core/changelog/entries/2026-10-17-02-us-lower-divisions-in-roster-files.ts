import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-10-17",
  title: "The US lower divisions in the roster files are fixed",
  items: [
    "Both roster files had the American second and third divisions wrong. They now match the 2026 season.",
    "In the second division, San Antonio FC was getting left out and Loudoun United was playing in the West. Loudoun is back in the East and San Antonio is in. The real league has 25 clubs, but the game runs 24 so the two conferences come out even, which means Brooklyn FC sits this one out.",
    "The third division now has Corpus Christi FC, Fort Wayne FC, FC Naples, the New York Cosmos and Sarasota Paradise, badges included. Northern Colorado Hailstorm, Tormenta, Texoma, Chattanooga FC and Carolina Core are gone, since none of them play in USL League One this year.",
    "Download the file again to get the fix. A league you've already started keeps the clubs it began with.",
  ],
};

export default entry;
