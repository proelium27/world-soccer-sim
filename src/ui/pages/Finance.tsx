import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { ClubLink } from "../components/ClubLink.js";
import { usePlayerMap } from "../usePlayerMap.js";
import { HelpHint } from "../components/HelpHint.js";
import { computeStandings } from "../../core/standings.js";
import {
  seasonRevenue, wageBill, financeScaleFor, budgetCap, settleSeasonEnd, chargeSeasonStart,
} from "../../core/finance/budget.js";
import { seasonPrizeIncome } from "../../core/finance/prizeIncome.js";
import { ClauseLedger } from "../components/ClauseLedger.js";
import { CompetitionSelect } from "../components/CompetitionSelect.js";
import { competitionOf, competitionTeamCount } from "../../core/competitions.js";
import { clausesOwedBy, clausesOwedTo } from "../../core/transfers/clauses.js";
import {
  SCOUTING_SPEND_MAX, difficultyProfile, DEBT_INTEREST_RATE, DEBT_DEDUCTION_POINTS,
  DEBT_DEDUCTION_REPEAT_POINTS, DEBT_DEDUCTION_MAX_POINTS,
} from "../../core/constants.js";
import { currency, formatWeeklyWage, ordinal, seasonYear, transferFeeLabel } from "../format.js";
import { Flag } from "../components/Flag.js";
import { PlayerRatingsTooltip } from "../components/PlayerRatingsTooltip.js";
import { PlayerRefLink, usePlayerRefs } from "../components/PlayerRefLink.js";
import { SortableTh, useTableSort, sortRows } from "../components/SortableTable.js";
import { pointsDeductionMap } from "../../core/finance/debt.js";
import { userDebtView } from "../userDebt.js";

/**
 * A balance — a position rather than a movement, so it carries no plus sign.
 * Negative uses the typographic minus rather than `currency.format`'s hyphen,
 * because these sit directly beside `Amount`'s figures and two different dashes
 * in one column reads as a rendering bug.
 */
function balanceText(value: number): string {
  return value < 0 ? `\u2212${currency.format(-value)}` : currency.format(value);
}

/**
 * A signed money amount on the money-year timeline.
 *
 * The sign is always rendered, never implied by the colour alone (the Signal
 * Rule), and zero reads as a muted plain figure rather than a green "+$0" —
 * nothing arrived, so nothing should look like income.
 */
function Amount({ value }: { value: number }) {
  const cls = value === 0 ? "fin-amt--none" : value > 0 ? "fin-amt--in" : "fin-amt--out";
  const sign = value === 0 ? "" : value > 0 ? "+" : "−";
  return <span className={`fin-amt ${cls}`}>{sign}{currency.format(Math.abs(value))}</span>;
}

/**
 * One label/amount row on the timeline. `why` is a quiet second line under the
 * label, for the timing rule or caveat that makes the number mean what it says.
 * `plain` is for a running balance, which is a position rather than a movement
 * and so must not carry a +/- sign.
 */
function Line(
  { label, why, amount, sub = false, total = false, plain = false, unknown = false }: {
    label: React.ReactNode;
    why?: React.ReactNode;
    amount?: number;
    sub?: boolean;
    total?: boolean;
    plain?: boolean;
    /** No figure exists yet — distinct from a figure that is zero. */
    unknown?: boolean;
  },
) {
  return (
    <div className={`fin-line${sub ? " fin-line--sub" : ""}${total ? " fin-line--total" : ""}`}>
      <div className="fin-line-label">
        {label}
        {why && <span className="fin-line-why">{why}</span>}
      </div>
      {/* "$0" would claim the line is worth nothing, which for a sell-on on a
          player nobody has bid for yet is a different statement from "we can't
          say". An em dash says the second thing. */}
      {unknown
        ? <span className="fin-amt fin-amt--none">&mdash;</span>
        : plain
          ? <span className="fin-amt">{balanceText(amount ?? 0)}</span>
          : <Amount value={amount ?? 0} />}
    </div>
  );
}

/** One moment in the year when money actually moves. */
function Stage(
  { when, state, note, children }: {
    when: string;
    state: "done" | "now" | "ahead";
    note: React.ReactNode;
    children: React.ReactNode;
  },
) {
  return (
    <li className={`fin-stage fin-stage--${state}`}>
      <div className="fin-stage-head">
        <span className="fin-stage-when">{when}</span>
        {state === "now" && <span className="fin-stage-tag">You are here</span>}
      </div>
      <p className="fin-stage-note">{note}</p>
      {children}
    </li>
  );
}

export function Finance() {
  const { league, setScoutingSpendAction, simming } = useLeague();
  // Slider position while dragging; persisted (and clamped) only on release
  // so we don't write to IndexedDB on every drag tick.
  const [scoutingDraft, setScoutingDraft] = useState<number | null>(null);
  const [compFilterOverride, setCompFilterOverride] = useState<number | "all" | null>(null);
  const { sort, toggle } = useTableSort<"club" | "budget" | "hype" | "wages" | "squad">(
    "budget",
    "desc",
  );

  // All memoized because dragging the scouting slider re-renders this page on
  // every tick: without it each tick rebuilt two ~6000-entry maps and recomputed
  // the division table.
  const playerMap = usePlayerMap(league?.players);
  const refOf = usePlayerRefs();
  const salaryMap = useMemo(
    () => new Map((league?.players ?? []).map((p) => [p.pid, p.contract.salary])),
    [league?.players],
  );
  // Cup prize money banked so far. Derived rather than stored (see
  // prizeIncome.ts), and memoized for the same reason everything else here is:
  // this walks the cup states, and a scouting-slider drag re-renders the page
  // on every tick.
  const prizeIncome = useMemo(
    () =>
      league
        ? seasonPrizeIncome(league, league.meta.userTid)
        : { sources: [], total: 0 },
    [league],
  );
  // The user's league position, which sets the prize tier in the estimate below.
  //
  // Also reports whether the division has played anything yet, because before a
  // ball is kicked every club is level on nothing and the "position" is just
  // array order — quoting a prize tier off that reads as a promise rather than
  // the placeholder it is.
  const table = useMemo(() => {
    const userTeam = league?.teams.find((t) => t.tid === league.meta.userTid);
    if (!league || !userTeam) return null;
    const divisionTeamIds = league.teams
      .filter((t) => t.compId === userTeam.compId)
      .map((t) => t.tid);
    // Set membership, not Array.includes — this filter runs once per played
    // match and the old form scanned the whole division for each one.
    const divisionTids = new Set(divisionTeamIds);
    const matches = league.played.filter((m) => divisionTids.has(m.home));
    const standings = computeStandings(
      divisionTeamIds, matches, pointsDeductionMap(league.debtSanctions, league.season),
    );
    return {
      rank: standings.findIndex((r) => r.tid === league.meta.userTid) + 1,
      started: matches.length > 0,
    };
  }, [league]);

  if (!league) {
    return <p className="p-3">Loading...</p>;
  }

  const userTeam = league.teams.find((t) => t.tid === league.meta.userTid);
  if (!userTeam || table === null) {
    return <p className="p-3">Team not found.</p>;
  }
  const { rank, started } = table;

  const compFilter = compFilterOverride ?? userTeam.compId;

  const commitScoutingDraft = async () => {
    if (scoutingDraft === null) return;
    await setScoutingSpendAction(scoutingDraft);
    setScoutingDraft(null);
  };

  const difficulty = difficultyProfile(league.difficulty);
  const inTheRed = userTeam.budget < 0;
  // One derivation shared with the spending actions and the Dashboard warning,
  // so the page that tells you your headroom and the button that refuses the
  // signing can never disagree.
  const debt = userDebtView(league);
  const interestPct = Math.round(DEBT_INTEREST_RATE * 100);
  const seasonOver = league.phase === "offseason";

  // The user's own projection, so it takes the difficulty-aware scale — the
  // plain competition scale would promise income the offseason won't pay.
  const scale = financeScaleFor(
    league.competitions, userTeam.compId, userTeam.tid, league.meta.userTid, league.difficulty,
  );
  // Prize cutoffs are a fraction of the division, so the projection has to pass
  // the club's own division size or it promises a smaller league's clubs money
  // the offseason won't pay.
  const divisionSize = competitionTeamCount(competitionOf(league.competitions, userTeam.compId));
  const revenue = seasonRevenue(rank, userTeam.hype, scale, divisionSize);
  const wages = wageBill([...userTeam.roster, ...userTeam.academyRoster], salaryMap);

  // The savings ceiling, surfaced because it is the one mechanic on this page
  // that DESTROYS money silently: clampBudget caps every credit, so a club
  // banking past its cap simply never receives the excess and nothing says so.
  const cap = budgetCap(scale, userTeam.hype);
  const capUsed = cap > 0 ? Math.max(0, userTeam.budget) / cap : 0;

  // Mirror of the offseason's own two money events, in the order runOffseason
  // applies them: settleSeasonEnd (prize + hype − scouting), then — after a
  // great deal else — chargeSeasonStart (base allocation in, the new season's
  // whole wage bill straight back out).
  //
  // Running them through the real functions rather than summing the rows is
  // what makes the CEILING apply. The old projection added the rows up raw and
  // so over-promised for any club near its cap: it quoted money the offseason
  // was going to destroy on arrival.
  //
  // Both remain estimates. The rank is provisional until the table is final,
  // hype moves between the two steps (so the second clamp really uses a
  // ceiling we can't know yet), and the wage line is next season's roster,
  // after retirements, expiries and youth intake.
  const afterSettlement = settleSeasonEnd(
    userTeam.budget, rank, userTeam.hype, userTeam.scoutingSpend, scale, divisionSize,
  );
  const startNext = chargeSeasonStart(afterSettlement, wages, scale, userTeam.hype);
  const rawSettlement =
    userTeam.budget + revenue.successPayout + revenue.hypeRevenue - userTeam.scoutingSpend;
  const rawStart = afterSettlement + revenue.base - wages;
  // What the ceiling refuses to let the club bank. Both steps clamp, so both
  // can lose money.
  const lostToCeiling = (rawSettlement - afterSettlement) + (rawStart - startNext);

  // Exactly-derivable in-season cash. FEES ONLY, and the label has to say so: a
  // mid-season signing also charges that player's season wages up front (see
  // executeTransfer) and nothing records that charge, so calling this "spent"
  // would be a number the save cannot stand behind.
  const thisSeason = league.transfers.filter((t) => t.season === league.season);
  const feesIn = thisSeason
    .filter((t) => t.fromTid === league.meta.userTid)
    .reduce((sum, t) => sum + t.fee, 0);
  const feesOut = thisSeason
    .filter((t) => t.toTid === league.meta.userTid)
    .reduce((sum, t) => sum + t.fee, 0);

  // Add-ons still hanging over the club. A bonus names its own amount; a
  // sell-on's payout depends on a fee nobody has agreed yet, so it is counted
  // rather than valued.
  const owedBy = clausesOwedBy(league, league.meta.userTid);
  const owedTo = clausesOwedTo(league, league.meta.userTid);
  const bonusOwed = owedBy.reduce((s, c) => s + (c.kind === "bonus" ? c.amount : 0), 0);
  const bonusDue = owedTo.reduce((s, c) => s + (c.kind === "bonus" ? c.amount : 0), 0);
  const sellOnCount =
    owedBy.filter((c) => c.kind === "sellOn").length
    + owedTo.filter((c) => c.kind === "sellOn").length;

  const rosterPlayers = userTeam.roster
    .map((pid) => playerMap.get(pid))
    .filter((p) => p !== undefined)
    .sort((a, b) => b.contract.salary - a.contract.salary);

  const userTransfers = league.transfers
    .filter(
      (t) =>
        t.fromTid === league.meta.userTid || t.toTid === league.meta.userTid,
    )
    .slice()
    .reverse();
  const spent = userTransfers
    .filter((t) => t.toTid === league.meta.userTid)
    .reduce((sum, t) => sum + t.fee, 0);
  const received = userTransfers
    .filter((t) => t.fromTid === league.meta.userTid)
    .reduce((sum, t) => sum + t.fee, 0);

  const clubRowsUnsorted = league.teams
    .filter((t) => compFilter === "all" || t.compId === compFilter)
    .map((t) => ({ team: t, wages: wageBill([...t.roster, ...t.academyRoster], salaryMap) }));
  const clubRows = sortRows(clubRowsUnsorted, sort, {
    club: (r) => r.team.name,
    budget: (r) => r.team.budget,
    hype: (r) => r.team.hype,
    wages: (r) => r.wages,
    squad: (r) => r.team.roster.length,
  });

  const wageShare = revenue.total > 0 ? wages / revenue.total : 0;
  const netProjected = startNext - userTeam.budget;

  return (
    <div className="container-fluid p-3">
      <h4>Finance: {userTeam.name}</h4>

      {/* The sanction already in force, if any. Kept separate from the
          projection below because they answer different questions: this is what
          you are living with now, that is what today's balance would cost you
          next season. */}
      {debt?.sanction && (
        <div className="alert alert-danger py-2" role="alert">
          <div className="fw-semibold">
            {debt.sanction.pointsDeduction > 0
              ? `Transfer embargo and a ${debt.sanction.pointsDeduction}-point deduction`
              : "Transfer embargo"}
          </div>
          <div className="small mb-0">
            You ended last season {currency.format(-debt.sanction.balance)} overdrawn, past your{" "}
            {currency.format(debt.sanction.limit)} limit
            {debt.sanction.consecutiveSeasons > 1
              && `, and that is ${debt.sanction.consecutiveSeasons} seasons running`}.
            You can&apos;t buy or sign anyone this season. You can still sell, promote from your
            academy, and take on trialists.
            {debt.sanction.pointsDeduction > 0
              && ` The ${debt.sanction.pointsDeduction} points are already off your league table.`}
          </div>
        </div>
      )}

      {/* Warned DURING the season, not after. The books are read at the final
          whistle, so telling the player once the penalty has landed gives him no
          chance to sell his way out of it. */}
      {debt && debt.projected !== "clear" && (
        <div className="alert alert-warning py-2" role="alert">
          <div className="fw-semibold">
            {debt.projected === "deduction"
              ? "On course for a points deduction"
              : "On course for a transfer embargo"}
          </div>
          <div className="small mb-0">
            Finish the season this far overdrawn and next season starts with a transfer embargo
            {debt.projected === "deduction" && " and a points deduction"}. Your books are read
            at the final whistle, so selling in the summer won&apos;t undo it. Get back above{" "}
            {currency.format(debt.embargoAt)} before the season ends.
          </div>
        </div>
      )}

      {debt?.inDebt && (
        <div className="alert alert-secondary py-2" role="alert">
          <div className="fw-semibold">You&apos;re in the red.</div>
          <div className="small mb-0">
            You can borrow up to {currency.format(debt.limit)}, and you have{" "}
            {currency.format(debt.headroom)} of that left. Carrying this balance into next season
            costs {currency.format(debt.interestNext)} in interest, and interest compounds. Your
            scouting also stays at zero while you&apos;re overdrawn, so potential estimates get
            vaguer.
          </div>
        </div>
      )}

      {/* Where the club stands, in four figures. Deliberately a dense strip
          rather than four cards: this is the scoreboard idiom, and the page
          below it is where the detail lives. */}
      <div className="fin-strip">
        <div className="fin-stat">
          <div className="fin-stat-label">Balance</div>
          <div className={`fin-stat-value${inTheRed ? " fin-stat-value--neg" : ""}`}>
            {currency.format(userTeam.budget)}
          </div>
          <div className="fin-meter">
            <div
              className={
                "fin-meter-fill"
                + (capUsed >= 1 ? " fin-meter-fill--over" : capUsed >= 0.85 ? " fin-meter-fill--warn" : "")
              }
              style={{ width: `${Math.min(100, Math.max(0, capUsed * 100))}%` }}
            />
          </div>
          <div className="fin-stat-sub">
            {Math.round(capUsed * 100)}% of a {currency.format(cap)} ceiling
            <HelpHint>
              Your club can only bank so much. The ceiling rises with your hype and with how rich
              your league is, and anything you would have saved above it is never paid at all.
              It&apos;s destroyed, not carried over. Spending below the line is
              unrestricted; only hoarding is capped. So if you&apos;re near it, spend the money
              rather than watch the next prize cheque disappear.
            </HelpHint>
          </div>
        </div>

        <div className="fin-stat">
          <div className="fin-stat-label">Season wage bill</div>
          <div className="fin-stat-value">{currency.format(wages)}</div>
          <div className="fin-meter">
            <div
              className={
                "fin-meter-fill"
                + (wageShare >= 1 ? " fin-meter-fill--over" : wageShare >= 0.8 ? " fin-meter-fill--warn" : "")
              }
              style={{ width: `${Math.min(100, Math.max(0, wageShare * 100))}%` }}
            />
          </div>
          <div className="fin-stat-sub">
            {Math.round(wageShare * 100)}% of what the club earns in a year &middot;{" "}
            {formatWeeklyWage(wages)}
          </div>
        </div>

        <div className="fin-stat">
          <div className="fin-stat-label">Next season starts with</div>
          <div className={`fin-stat-value${startNext < 0 ? " fin-stat-value--neg" : ""}`}>
            {currency.format(startNext)}
          </div>
          <div className="fin-stat-sub">
            {netProjected < 0
              ? <>&minus;{currency.format(-netProjected)} from here</>
              : <>+{currency.format(netProjected)} from here</>}
            {" "}&middot; estimate
          </div>
        </div>

        <div className="fin-stat">
          <div className="fin-stat-label">Hype</div>
          <div className="fin-stat-value">{Math.round(userTeam.hype)}</div>
          <div className="fin-meter">
            <div className="fin-meter-fill" style={{ width: `${Math.round(userTeam.hype)}%` }} />
          </div>
          <div className="fin-stat-sub">
            Out of 100, earned by winning. Sets both your season income and your ceiling.
          </div>
        </div>
      </div>

      {/* The whole finance model, in the order it actually happens. This is
          the page's answer to "where did my money go" — every other card here
          is a detail hanging off one of these four moments. */}
      <div className="card mb-3">
        <div className="card-body">
          <h5 className="card-title">Your money year</h5>
          <p className="text-secondary small">
            This season&apos;s wages were charged in full on day one, so they aren&apos;t still
            to come.
          </p>

          <ol className="fin-year">
            <Stage
              when="During the season"
              state={seasonOver ? "done" : "now"}
              note="Cup money lands the day you play the tie, fees when a deal closes. All of it is already in your balance."
            >
              {prizeIncome.total === 0 ? (
                <Line label="Cup prize money" why="No ties played yet." amount={0} />
              ) : (
                <>
                  <Line label="Cup prize money banked" amount={prizeIncome.total} />
                  {prizeIncome.sources.map((source) => (
                    <Fragment key={source.competition}>
                      {source.lines.map((line) => (
                        <Line
                          key={`${source.competition}-${line.label}`}
                          label={`${source.competition} — ${line.label}`}
                          amount={line.amount}
                          sub
                        />
                      ))}
                    </Fragment>
                  ))}
                </>
              )}
              <Line label="Transfer fees received" amount={feesIn} />
              <Line
                label="Transfer fees paid"
                why="A mid-season signing costs his wages for the season too."
                amount={-feesOut}
              />
              {/* "Net", not "banked": the summer window is stamped with the
                  season it opens, so this line is routinely negative and
                  "banked -$74M" reads as a bug. */}
              <Line
                label="Net so far this season"
                amount={prizeIncome.total + feesIn - feesOut}
                total
              />
            </Stage>

            <Stage
              when="At season end"
              state={seasonOver ? "now" : "ahead"}
              note={
                seasonOver
                  ? "Real numbers now the table is final. They settle when you advance."
                  : "Provisional: you can still move up or down the table."
              }
            >
              <Line
                label={
                  started
                    ? `League prize money (${ordinal(rank)} of ${divisionSize})`
                    : "League prize money"
                }
                // Before a ball is kicked every club is level on nothing, so there is
                // no position to base a tier on and quoting "1st" reads as a prediction.
                // Once there is a table the label carries the rank and needs no gloss.
                why={started ? undefined : "Nothing played yet, so this is a standing start."}
                amount={revenue.successPayout}
              />
              <Line label="Hype revenue" amount={revenue.hypeRevenue} />
              <Line
                label="Scouting bill"
                why="Paid at the end, not up front."
                amount={-userTeam.scoutingSpend}
              />
              <Line label="Balance after settlement" amount={afterSettlement} total plain />
            </Stage>

            <Stage
              when="In the offseason"
              state="ahead"
              note="Add-ons on past deals settle once the season's totals are known."
            >
              {owedBy.length === 0 && owedTo.length === 0 ? (
                <Line label="Add-ons outstanding" amount={0} />
              ) : (
                <>
                  {bonusDue > 0 && (
                    <Line label="Bonuses you could be paid" amount={bonusDue} />
                  )}
                  {bonusOwed > 0 && (
                    <Line
                      label="Bonuses you could owe"
                      why="Charged even if you can't cover it; you go overdrawn."
                      amount={-bonusOwed}
                    />
                  )}
                  {sellOnCount > 0 && (
                    <Line
                      label={`Sell-on shares outstanding: ${sellOnCount}`}
                      why="No figure until he's sold. Paid out of the fee, not your balance."
                      unknown
                    />
                  )}
                </>
              )}
            </Stage>

            <Stage
              when="When next season starts"
              state="ahead"
              note="The allocation arrives and the whole wage bill comes straight back out of it, at once."
            >
              <Line label="Base allocation" amount={revenue.base} />
              <Line
                label="Wage bill for the whole season"
                why="Today's squad. The real charge uses next season's."
                amount={-wages}
              />
              <Line label="Budget you start next season with" amount={startNext} total plain />
            </Stage>
          </ol>

          {lostToCeiling > 0 && (
            <div className="alert alert-warning py-2 mt-3 mb-0" role="alert">
              <span className="fw-semibold">
                {currency.format(lostToCeiling)} of this won&apos;t reach you.
              </span>{" "}
              It would take you over your {currency.format(cap)} savings ceiling, and money above
              the line is destroyed rather than banked. Spend it before then, or raise the ceiling
              by raising your hype.
            </div>
          )}
        </div>
      </div>

      {/* The rules themselves, stated in the club's own money rather than in
          percentages, and shown whether or not the club is in any trouble. The
          three alerts at the top of this page only appear once something has
          already gone wrong, and a rule you can only read once it has bitten
          you is not one the player can plan around. Every figure here is
          derived — from `userDebtView` or straight from the constants — so a
          retune can't leave the copy quoting a threshold that has moved. */}
      {debt && (
        <div className="card mb-3">
          <div className="card-body">
            <h5 className="card-title">Borrowing and debt</h5>
            <p className="text-secondary small">
              Your balance is allowed to go below zero, on purpose. How far depends on what your
              club earns, so a big side in a rich league has far more room than a small one.{" "}
              {debt.inDebt
                ? `You're ${currency.format(-debt.balance)} overdrawn with `
                  + `${currency.format(debt.headroom)} of room left.`
                : `You're in credit, with the whole ${currency.format(debt.limit)} available `
                  + `if you want it.`}
            </p>

            <ol className="fin-year">
              <Stage
                when="Into the overdraft"
                state={debt.inDebt ? (debt.projected === "clear" ? "now" : "done") : "ahead"}
                note={
                  `Sign who you like down to this line. Nothing stops you and nothing tells the `
                  + `board. Any balance below zero is charged ${interestPct}% interest when the `
                  + `next season starts, and the interest is added to the debt, so leaving it `
                  + `alone makes it worse on its own.`
                }
              >
                <Line label="You can spend down to" amount={-debt.limit} plain />
                <Line
                  label="Interest on today's balance"
                  why="Charged when next season starts."
                  amount={-debt.interestNext}
                />
              </Stage>

              <Stage
                when="Transfer embargo"
                state={
                  debt.projected === "embargo"
                    ? "now"
                    : debt.projected === "deduction" ? "done" : "ahead"
                }
                note={
                  "Finish a season below this line and you can't buy or sign anyone for the "
                  + "whole of the next one. You can still sell, promote from your academy and "
                  + "take on trialists, which is the cheapest way back out."
                }
              >
                <Line label="Finish the season below" amount={debt.embargoAt} plain />
              </Stage>

              <Stage
                when="Points deduction"
                state={debt.projected === "deduction" ? "now" : "ahead"}
                note={
                  `Deeper still and the league docks you points as well. Next season starts on `
                  + `minus ${DEBT_DEDUCTION_POINTS}, climbing by ${DEBT_DEDUCTION_REPEAT_POINTS} `
                  + `for each season running you stay down here, up to `
                  + `${DEBT_DEDUCTION_MAX_POINTS}. One season finishing clear of the embargo `
                  + `line wipes the record.`
                }
              >
                <Line label="Finish the season below" amount={debt.deductionAt} plain />
              </Stage>
            </ol>

            <p className="text-secondary small mb-0 mt-3">
              Your books are read at the final whistle, not in the summer, so a good cup run can
              rescue you and selling your best player in July can't. That's why the warnings on
              this page start during the season, while you can still trade your way out of it.
            </p>
          </div>
        </div>
      )}

      {/* Scouting */}
      <div className="card mb-3">
        <div className="card-body">
          <h5 className="card-title">Scouting</h5>
          <label className="form-label mb-1" htmlFor="finance-scouting-spend">
            {seasonOver
              ? <>Budget for next season: <strong>{currency.format(scoutingDraft ?? userTeam.nextScoutingSpend)}</strong></>
              : <>This season: <strong>{currency.format(userTeam.scoutingSpend)}</strong>, locked until the offseason</>}
          </label>
          <input
            id="finance-scouting-spend"
            type="range"
            className="form-range"
            min={0}
            max={SCOUTING_SPEND_MAX}
            step={100_000}
            value={seasonOver ? (scoutingDraft ?? userTeam.nextScoutingSpend) : userTeam.scoutingSpend}
            disabled={simming || !seasonOver}
            onChange={(e) => setScoutingDraft(Number(e.target.value))}
            onPointerUp={commitScoutingDraft}
            onBlur={commitScoutingDraft}
          />
          <p className="card-text text-secondary small mb-0">
            Buys two things: sharper transfer valuations (&plusmn;35% guesswork at $0, down to
            &plusmn;5% at the {currency.format(SCOUTING_SPEND_MAX)} maximum), and tighter potential
            estimates on players you don&apos;t own.
            <HelpHint>
              You set it once a year, in the offseason, and it&apos;s locked for the whole season it
              covers. You commit and pay before you get the sharper view, so you can&apos;t
              crank it up to peek and turn it straight back down. Every value you see on a transfer
              target (Recommended Transfers, negotiation offers, offers for your own players) is a
              perceived value, not the real one. Potential shows as an estimate band rather than an
              exact number, and more scouting tightens the band and reveals a player&apos;s true
              ceiling sooner. Players on your senior roster also sharpen on their own over 2&ndash;3
              seasons, while prospects, free agents and rival clubs&apos; players stay fogged until
              you scout or sign them. Starts at $5M each season.
            </HelpHint>
          </p>
          {difficulty.budgetScale !== 1 && (
            <p className="card-text text-secondary small mb-0 mt-2">
              On {difficulty.label.toLowerCase()}, your club earns{" "}
              {Math.round(Math.abs(1 - difficulty.budgetScale) * 100)}%{" "}
              {difficulty.budgetScale < 1 ? "less" : "more"} than it otherwise would, and can bank
              that much {difficulty.budgetScale < 1 ? "less" : "more"} too. Wages cost the same as
              they do for everyone else.
            </p>
          )}
        </div>
      </div>
      {/* Wage bill */}
      <div className="card mb-3">
        <div className="card-body">
          <h5 className="card-title">Where the wage bill goes</h5>
          <p className="text-secondary small">
            {currency.format(wages)} a season across {rosterPlayers.length} senior players
            {userTeam.academyRoster.length > 0 && <> plus {userTeam.academyRoster.length} on academy stipends</>}
            , or {Math.round(wageShare * 100)}% of what the club earns in a year. Charged in full
            the day the season starts, not spread across it.
          </p>
          <table className="table table-striped table-sm align-middle mb-0">
            <thead>
              <tr>
                <th>Name</th>
                <th>Pos</th>
                <th className="text-end">Age</th>
                <th className="text-end">Ovr</th>
                <th className="text-end">Expires</th>
                <th className="text-end">Wage</th>
                <th className="text-end">Season salary</th>
                <th className="text-end">Share</th>
              </tr>
            </thead>
            <tbody>
              {rosterPlayers.map((p) => (
                <tr key={p.pid}>
                  <td>
                    <PlayerRatingsTooltip player={p}>
                      <Link to={`/player/${p.pid}`}>{p.name}</Link>
                    </PlayerRatingsTooltip>{" "}
                    <Flag nationality={p.nationality} />
                  </td>
                  <td>{p.pos}</td>
                  <td className="text-end">{league.season - p.born}</td>
                  <td className="text-end">{p.ovr}</td>
                  <td className="text-end">{seasonYear(p.contract.expiresSeason)}</td>
                  <td className="text-end">{formatWeeklyWage(p.contract.salary)}</td>
                  <td className="text-end">{currency.format(p.contract.salary)}</td>
                  <td className="text-end">
                    {wages > 0 ? `${Math.round((p.contract.salary / wages) * 100)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="fw-bold">
                {/* The bill includes academy stipends, which have no row here —
                    hence "whole bill" rather than a total of the rows above, and
                    no share figure (the rows would sum to just under 100%). */}
                <td colSpan={5}>Whole wage bill</td>
                <td className="text-end">{formatWeeklyWage(wages)}</td>
                <td className="text-end">{currency.format(wages)}</td>
                <td className="text-end"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Add-ons still hanging over the club, both directions. Money that has
          already been paid is gone from this list — a clause is deleted the
          moment it settles — so this is strictly what is still outstanding. */}
      <ClauseLedger />

      {/* Transfer history */}
      <div className="card mb-3">
        <div className="card-body">
          <h5 className="card-title">Transfer History</h5>
          {userTransfers.length === 0 ? (
            <p className="mb-0">No transfers yet.</p>
          ) : (
            <>
              <p className="card-text">
                All-time: <strong>{currency.format(spent)}</strong> spent
                {received > 0 && (
                  <> &middot; <strong>{currency.format(received)}</strong> received</>
                )}
              </p>
              <table className="table table-striped table-sm align-middle mb-0">
                <thead>
                  <tr>
                    <th className="text-end">Season</th>
                    <th>Window</th>
                    <th>Player</th>
                    <th></th>
                    <th>Club</th>
                    <th className="text-end">Fee</th>
                  </tr>
                </thead>
                <tbody>
                  {userTransfers.map((t, i) => {
                    // Not playerMap: your own transfer history should still name
                    // the striker you bought in 2031 after he's retired.
                    const ref = refOf(t.pid);
                    const bought = t.toTid === league.meta.userTid;
                    return (
                      <tr key={i}>
                        <td className="text-end">{seasonYear(t.season)}</td>
                        <td>{t.window === "summer" ? "Summer" : "Winter"}</td>
                        <td>
                          <PlayerRefLink pid={t.pid} fallback={`Player ${t.pid}`} />{" "}
                          {ref && <Flag nationality={ref.nationality} />}
                        </td>
                        <td>
                          {bought ? (
                            <span className="text-success">Bought</span>
                          ) : (
                            <span className="text-danger">Sold</span>
                          )}
                        </td>
                        <td><ClubLink tid={bought ? t.fromTid : t.toTid} season={t.season} /></td>
                        <td className="text-end">{transferFeeLabel(t)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>

      {/* League finances */}
      <div className="card mb-3">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h5 className="card-title mb-0">League Finances</h5>
            <CompetitionSelect
              competitions={league.competitions}
              value={compFilter}
              onChange={setCompFilterOverride}
              allOption
              style={{ width: "auto" }}
            />
          </div>
          <table className="table table-striped table-sm align-middle mb-0">
            <thead>
              <tr>
                <SortableTh sortKey="club" sort={sort} onSort={toggle} defaultDir="asc">Club</SortableTh>
                <SortableTh sortKey="budget" sort={sort} onSort={toggle} className="text-end">Budget</SortableTh>
                <SortableTh sortKey="hype" sort={sort} onSort={toggle} className="text-end">Hype</SortableTh>
                <SortableTh sortKey="wages" sort={sort} onSort={toggle} className="text-end">Wage bill</SortableTh>
                <SortableTh sortKey="squad" sort={sort} onSort={toggle} className="text-end">Squad</SortableTh>
              </tr>
            </thead>
            <tbody>
              {clubRows.map(({ team, wages: clubWages }) => (
                <tr
                  key={team.tid}
                  className={
                    team.tid === league.meta.userTid ? "team-highlight" : undefined
                  }
                >
                  <td>
                    <ClubLink
                      tid={team.tid}
                      crest
                      crestSize={20}
                      className="d-inline-flex align-items-center gap-1 text-decoration-none"
                    />
                  </td>
                  <td className="text-end">{currency.format(team.budget)}</td>
                  <td className="text-end">{Math.round(team.hype)}</td>
                  <td className="text-end">{currency.format(clubWages)}</td>
                  <td className="text-end">{team.roster.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
