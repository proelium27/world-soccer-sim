import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-09",
  title: "A player only changes clubs once per transfer window",
  items: [
    "Somebody pointed out that players were being passed around mid-window like they were being traded in an American league, and they were right. **Once a club buys a player, he's theirs until the window shuts.** That goes for you too: no buying somebody cheap on Tuesday and selling him on for four times the money on Thursday, and nobody can come and take a new signing off you either.",
    "The worst of it was happening between AI clubs and I hadn't noticed how bad. About one summer deal in thirty was a second sale of somebody who'd already moved that window, and the fees were absurd. One player went for $7.1M and was sold on for $113.3M without kicking a ball in between. The club in the middle was just pocketing the difference.",
    "Two separate things were causing it. One was a guard on the AI market that was written back when there were only two divisions in a country and never updated when third divisions arrived, so clubs down there were signing players who were far too good for them and getting them confiscated straight back the same summer.",
    "The other was the rule that stops a division getting too strong for the one above it. When it moved a third-division player who was good enough for the top flight, it walked him up a division at a time and billed it as two separate transfers, so a second-division club it passed through banked a fee for a player it held for no time at all. He goes straight where he's meant to go now, in one move, and the club that actually signs him pays the club he came from.",
    "If you go looking for someone who's already moved this window, the search tells you instead of quietly ignoring your offer, and a player who's just joined you shows \"Can't sell yet\" on his roster row. Loans are the exception, since a loan isn't a change of ownership, so you can still send a new signing straight back out on one.",
  ],
};

export default entry;
