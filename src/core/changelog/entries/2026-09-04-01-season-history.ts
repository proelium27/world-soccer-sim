import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-04",
  title: "Season History: who won what, one line a season",
  items: [
    "There's a new **Season History** page in the sidebar, just above Club History. One line per season, newest at the top. This is straight off a request from someone who'd jumped twenty years ahead and then had to open twenty separate pages to find out what had happened in them.",
    "Each line gives you the Continental Cup and Continental Shield winners, whoever won the World Cup or their confederation's championship in the offseason that followed, and then a column per country holding that country's champion. A toggle above the table swaps all the country columns over to **domestic cup winners**, so you can read one country's cup back through the years the same way you read its league.",
    "The country columns are three letter club codes, which is the only way a dozen countries fit on one line. Hover a code for the full name, or click it and you land on what that club did that year. Titles your own club won are shaded so they stand out as you scroll down.",
    "**Jumping ahead now drops you here.** The recap you get at the end of a jump covers your own club, and this is the other half of it: taking over lands you on Season History with every champion from the years you were away. That was the whole point of the original request, so it shouldn't need finding.",
    "It's all worked out from records the game was already keeping, so an old save shows its entire back catalogue the first time you open the page. Nothing extra gets saved to disk.",
    "The continental finals are played before a season rolls over, so the season you're in turns up as soon as one of them is decided, marked \"(now)\", with its league columns still empty. International tournaments run in the offseason *after* a season, so a World Cup sits on the line of the season it came after rather than the one it kicks off. That's how the news feed and the awards have always filed them.",
    "Super cups aren't on it. They'd be another thirteen columns for the smallest trophy in the game, and Champions Cups already has them.",
  ],
};

export default entry;
