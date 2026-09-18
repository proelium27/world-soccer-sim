import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-18",
  title: "Every rating in OVR now counts in matches",
  items: [
    "Some of the ratings that make up a player's OVR weren't doing anything in matches. They still pushed up his wage and his transfer fee, but his team played no better for them. That was over a quarter of a **full-back's** OVR (pace and crossing), about a third of a **keeper's** (positioning and passing) and nearly a quarter of a **striker's** (strength and heading). So a squad built around great full-backs could look strong on paper and still finish mid-table.",
    "Now each player counts in a match using the same mix of ratings as his OVR. A full-back's pace and crossing help you attack down the flanks and his pace helps you defend, a keeper's positioning helps him stop shots, and a big target man makes your attack more dangerous.",
    "I also rebalanced how much each position counts, so one extra point of OVR is worth about the same to your results wherever the player plays. Before, a point on a full-back was worth about a third of a point anywhere else. Keepers still count for more than any single outfielder, since one player does the whole job.",
    "Goals per game, home advantage and the points it takes to win a league haven't moved. A team's OVR just predicts where it finishes more closely than it used to. Existing saves play by the new rules from their next match.",
  ],
};

export default entry;
