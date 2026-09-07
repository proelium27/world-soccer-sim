import type { DebtSanction } from "./finance/debt.js";

/**
 * Financial sanctions bucketed by the season they take effect in.
 *
 * **Derived rather than a stored `NewsEvent`, like the trophies in
 * `trophyNews.ts`, the honours in `awardNews.ts` and the playoffs in
 * `promotionNews.ts`, and for the same reason**: the sanction is already
 * recorded on `LeagueStore.debtSanctions`, so writing a news event for one
 * would be a second copy of the same fact that could drift from the first. It
 * also means a save that has already been sanctioned reports it the moment
 * this ships, and that nothing has to be migrated.
 *
 * There is deliberately no `DebtNews` type wrapping the record. The other three
 * modules each derive something the raw record does not carry (a normalised
 * cup `kind`, a finishing position, a scoreline); a sanction already holds
 * every field the headline needs, so a wrapper would be a rename and one more
 * thing to keep in step.
 *
 * Bucketed by `season` — the season the sanction APPLIES to, which is the
 * season it is news in. It is decided in the offseason before that, but what
 * the player needs to be told is "this is in force now", which is also when the
 * embargo starts biting: the rollover has already moved `league.season` on, so
 * the summer window it governs is the one about to open.
 */
export function debtNewsBySeason(
  sanctions: readonly DebtSanction[] | undefined,
): Map<number, DebtSanction[]> {
  const out = new Map<number, DebtSanction[]>();
  for (const s of sanctions ?? []) {
    const bucket = out.get(s.season);
    if (bucket) bucket.push(s);
    else out.set(s.season, [s]);
  }
  return out;
}
