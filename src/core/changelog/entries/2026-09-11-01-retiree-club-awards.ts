import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-11",
  title: "Retired players keep the awards they won for your club",
  items: [
    "When a player retired, the awards he'd won for your club disappeared from Club History: his Player of the Season, his Golden Boot, his Team of the Season places, all gone the summer he hung up his boots.",
    "They were never deleted. The page worked out which club a player won each award at by looking him up among the players still in the game, and retiring takes him out of that list. The award was still on record, the page just couldn't tell it was yours.",
    "Now it also checks the career record the game keeps for retired players, and the note saved with each season's awards of where every winner was playing. The page for a single club season reads the same records, so retired players get their award badges back there too.",
    "Everything it needs is already in your save, so the missing awards come back the next time you open the page. On a 32-season save I tested with, the club's list went from 25 awards to 170.",
    "Some of the oldest can stay missing on a long save. If a player retired before the game started keeping those notes, and his career was too short for the retired-player archive, nothing wrote down where he played.",
  ],
};

export default entry;
