import type { ChangelogEntry } from "../types.js";

const entry: ChangelogEntry = {
  date: "2026-09-11",
  title: "Pick your World Cup size",
  items: [
    "The World Cup was always 32 nations. Now you can have **16, 24, 32 or 48**, or leave it on **Auto** and let the game size it to your world. 24 and 48 work like Euro 2016 and the 2026 World Cup: the top two in each group go through along with the best third-placed teams, and 48 gets a round of 32. Pick it when you start a save, or change it on the **Qualifying** page. A change starts with the next qualifying draw, so a campaign already under way keeps its size.",
    "I also fixed qualifying for the smaller confederations. A save came in where North America had nine nations and one place, so all nine were drawn into a single group and played each other three times: 24 games each for one spot. Every confederation now gets at least one place for each group it's drawn into, so groups stay at around five and every group winner goes through. The standard world never hit this, so its qualifying doesn't change.",
    "And the national team History page was recording finishes one round too deep ever since the World Cup went to 32: going out in the round of 16 counted as a quarter-final, and a quarter-final exit counted as a semi. It reads them correctly now, past tournaments included.",
  ],
};

export default entry;
