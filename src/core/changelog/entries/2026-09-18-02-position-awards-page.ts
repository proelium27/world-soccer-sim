import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-18",
  title: "A better look at the Goalkeeper and Defender of the Year",
  items: [
    "The two awards now sit side by side on the Awards page, and each one shows the number it's really decided on: save percentage for keepers, tackles and interceptions per game for defenders.",
    "Under each winner there's a **How he won it** table that splits his points into match rating, shot-stopping or defending, goals and assists, player quality and league strength, and trophies, with the gap to the runner-up next to each line. The old shortlist lumped almost all of it into one \"from league\" number, so you couldn't tell what won it. The answer can surprise you: a defender can make fewer tackles than the man behind him and still win on goals and quality.",
    "The help text on both awards said they counted goals kept out. They never did, so that's fixed.",
    "The breakdown starts with this season's awards. Older seasons still show the simpler split.",
  ],
};

export default entry;
