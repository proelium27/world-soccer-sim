import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-10",
  title: "Halves are real now: 45+2, first-half stoppage, and what the card was for",
  items: [
    "A player wrote in about the live match view. Stoppage time counting 91, 92, 93 instead of 90+1. No first-half stoppage at all. Two goals landing in the same minute. No way to tell what a booking was for. All of that was fair, and most of it turned out to be the same root cause.",
    "**The clock had no half-time in it.** Both halves' stoppage was worked out separately and then played together at the end of the second half. That's fine for the result, because the sim doesn't care when the minutes happen, and it's wrong for everything you actually read. First-half stoppage never existed as a passage of play, nothing could be stamped 45+1, and an injury in the 20th minute bought three minutes that got handed to the 93rd.",
    "So the two halves are real periods now. The first half ends with its own stoppage, the fourth official's board goes up at 45:00 and again at 90:00, and the feed marks half time and full time where they belong. Minutes read 45+2 and 90+4 the way they should.",
    "**A goal costs time now.** It used to cost none at all, which is why you were seeing two goals in the same minute, including straight after a kickoff with no celebration in between. A goal now takes about a minute out of the clock for the celebration and the restart, and the referee adds that time back on. Those two halves go together: the first is what separates the goals, the second is what keeps the amount of football in a match what it was.",
    "That's also the honest answer to how stoppage gets worked out, which was the other thing you asked. It's a standing minute, plus time for each notable thing that happened, plus the time the goals actually took. You can watch the number go up, and watch it revised if someone scores in stoppage, because that celebration gets added on too.",
    "Matches run longer on the clock as a result: about three added at the break and six at the end, where before it was one lump of six or seven at the very end. That's roughly where real football has ended up the last couple of seasons.",
    "**Minutes played are counted on the match clock now**, which holds at 45 and 90 through stoppage. So a player who lasts the whole game is down for 90, not 97 as he used to be. That also fixes every per-90 figure in the game, which had been reading about 7% low, because the minutes it divided by included stoppage while everything else assumed a 90-minute match. Seasons already played keep the minutes they were recorded with.",
    "**Bookings say what they were for.** A card now reads \"late challenge\", \"tactical foul, breaks up the counter\", \"time wasting\", \"dissent\", \"foul in the penalty area\" and so on. Shots say where they came from too: from the spot, a header from the corner, a tap-in, from the edge of the box.",
    "These aren't sprayed on at random. The game checks what actually happened on that tick. A booking that gave away a penalty can only be a foul in the box, and will never claim to be time wasting. A card shown while your side is protecting a lead late on can be. A second yellow is read off the player's own first one rather than guessed at, and sending-offs get the same treatment.",
    "Shot locations have one limit I should be upfront about: the sim doesn't track where anyone is on the pitch. Penalties, corner headers and free kicks are real, because they really happened. For everything else the game picks a spot that fits how the shot ended, so goals mostly come from inside the box, blocked shots more often from outside it, and a striker shoots from closer in than a holding midfielder. Over a season it comes out at the same split real top flights have. It's a description, not a cause, so it doesn't change the xG.",
    "None of this is stored in your save, because it's worked out from the match you already have. So **every box score you can browse back to has it**, right back to your first season.",
    "One thing this doesn't cover. Extra time still has no clock of its own, so there's no stoppage in it to show. That needs extra time rebuilt as a proper period, which is its own job for another day.",
  ],
};

export default entry;
