import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-18",
  title: "One file for your whole world, with a checklist",
  items: [
    "A roster file can now carry each club's badge along with its name, colors and squad, so a whole world fits in one file instead of a roster file plus a logo pack. Roster files and logo packs you already have load the same as before.",
    "When you load one, a checklist shows up above the club picker, like the one in Basketball GM. You can switch names, colors, squads and badges on or off, and tick each league in the file separately. A file only gets the boxes for what's actually in it. If you want the real players but the fictional club names, untick names and leave squads on. The club picker changes as you click, so you can see what you'll start with.",
    "I also added **Export League File** to the Leagues screen. It turns any save into one of these files: names and colors always go in, and squads and badges you loaded yourself are up to you. Importing it starts a fresh league, so it's what you'd send a friend who wants to play your world. It's plain JSON, so you can edit it first.",
  ],
};

export default entry;
