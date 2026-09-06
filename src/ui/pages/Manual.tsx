import type { ReactNode } from "react";
import { useSportName } from "../sportName.js";

/**
 * The in-game manual: player-facing documentation of every shipped feature,
 * modeled on the Basketball GM manual's single-page, plain-spoken format.
 *
 * This page doubles as the project's feature ledger — when a feature ships,
 * changes, or is removed, update the relevant section here in the same PR
 * (see the "In-game Manual" section of CLAUDE.md). Numbers quoted below are
 * the live values from src/core/constants.ts at the time of writing; if you
 * retune a constant, fix its mention here too.
 */

const SECTIONS: [id: string, title: string][] = [
  ["overview", "Overview"],
  ["difficulty", "Difficulty"],
  ["spectator", "Spectating: A Save With Nobody in Charge"],
  ["manager", "Your Job: Confidence, Offers & Sackings"],
  ["pages", "The Pages"],
  ["season", "The Season & Simming"],
  ["world", "The World"],
  ["cup", "The Continental Cup"],
  ["shield", "The Continental Shield"],
  ["domestic-cup", "The Domestic Cup"],
  ["champions-cups", "The Champions Cups"],
  ["international", "International Football"],
  ["players", "Players: Ratings, OVR & Potential"],
  ["development", "Player Development & Aging"],
  ["matches", "The Match Engine"],
  ["squad", "Your Squad: Lineups, Depth & the Roster Cap"],
  ["transfers", "Transfers & Negotiation"],
  ["loans", "Loans"],
  ["contracts", "Contracts, Wages & Free Agents"],
  ["finance", "Finance"],
  ["youth", "The Youth Academy"],
  ["ai", "How AI Clubs Think"],
  ["strategy", "Strategy"],
  ["frivolities", "Frivolities"],
  ["godmode", "God Mode"],
  ["faq", "FAQ & Known Quirks"],
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mb-4">
      <h5 className="mt-4">{title}</h5>
      {children}
      <div><a href="#toc" className="small text-muted">Back to top ↑</a></div>
    </section>
  );
}

export function Manual() {
  const { brand, term } = useSportName();
  const sport = term.toLowerCase();
  return (
    <div className="container-fluid p-3">
      {/* h1, styled as an h4. The manual is reachable (and indexable) without a
          save loaded, so it needs one real top-level heading — but it should
          still look like every other page title in the app. */}
      <h1 className="h4">Manual</h1>
      <div style={{ maxWidth: "56rem" }}>
        <p className="text-muted">
          Everything about how the game works, in one place. It won't spoil anything hidden.
          Where the game keeps a secret (like a club's asking price), the manual tells you the
          secret exists and how it behaves, not what the number actually is.
        </p>
        <p className="text-muted">
          Want a quick reminder while you're playing? Look for the little <strong>?</strong> next
          to a heading or a column like Potential, Scout value, or Power, and hover (or focus) it
          for a one-line explanation. This manual is just the full version of those hints.
        </p>

        <div id="toc" className="card mb-3">
          <div className="card-body">
            <h6>Contents</h6>
            <ul className="mb-0">
              {SECTIONS.map(([id, title]) => (
                <li key={id}><a href={`#${id}`}>{title}</a></li>
              ))}
            </ul>
          </div>
        </div>

        <Section id="overview" title="Overview">
          <p>
            {brand} is a single-player {sport} management sim, and you run one club in a 20-team
            league. You pick the starting XI, buy and sell players, haggle over transfers, deal
            with contracts and the wage bill, and try to build a squad that actually wins. This
            season, or three seasons out. Your call.
          </p>
          <p>
            If you'd rather not run anybody, you don't have to. A save can be started as a{" "}
            <a href="#spectator">spectator</a>, with every club in the world left to the AI and you
            watching what it does with them. That's a choice you make when you create the save, and
            it can't be changed afterwards.
          </p>
          <p>
            The other 19 clubs are run by AI managers doing all the same stuff you are. They value
            players, buy, sell, renew contracts, and bring up youth, each one driven by its own
            situation rather than some script (there's a whole section on this: <a href="#ai">How
            AI Clubs Think</a>).
          </p>
          <p>
            There's no way to actually "win" {brand}. The game never ends. Win the league, then go
            win it again. Or blow the whole thing up, hoard teenagers, and build a dynasty straight
            out of the academy. Everything runs locally in your browser and saves on its own, and
            you can keep a bunch of league saves going at once and hop between them from the Leagues
            screen. When you start a league, "Start Customized League" lets you rename every club
            and set its colors and abbreviation before the save's created, and "Customize Teams" on
            any existing save does the same thing later.
          </p>
          <p>
            Saves live in your browser, so they don't follow you to another browser or another
            computer on their own. Each save on the Leagues screen has "Export Save", which downloads
            that whole save as a file — every club, player, stat and transfer, exactly as it stands —
            and "Import" at the bottom of the same screen loads one back. An import always comes in
            as a new save alongside what you already have, so bringing in a file can't overwrite a
            league you're in the middle of; if you meant to replace one, delete the old one
            afterwards. Worth knowing: the file is a snapshot, not a live backup, so re-importing an
            old export gives you the save exactly as it was the day you exported it.
          </p>
          <p>
            Exported saves are compressed, so they come out as a <code>.json.gz</code> file that's
            roughly sixteen times smaller than it would otherwise be — an eight-season save lands
            around 5 MB instead of 84 MB, which is the difference between a file you can send someone
            and one you can't. Nothing is left out to achieve that; compression is reversible, and
            importing gives you back every last detail. There's no need to unzip it yourself, and you
            shouldn't: Import takes the file exactly as it downloaded. Saves exported by older
            versions of the game are plain <code>.json</code> and still import fine.
          </p>
          <p>
            That same "Import" button also takes a roster file — a plain text (JSON) file listing
            clubs by league — and works out which kind of file you gave it from the file itself. Give
            it one of those and it starts a brand new save with those clubs in place of the fictional
            ones. You pick your club from the imported teams, so you're choosing between the real
            names rather than guessing which fictional slot is about to become which. Clubs match to
            leagues by slot, and anything the file doesn't cover keeps its original name and squad,
            so you can bring in only the leagues you care about and leave the rest alone. It's the
            easiest way to turn the fictional default world into whatever you want, real leagues or
            otherwise.
          </p>
          <p>
            The same screen carries the <strong>World setup</strong> panel, so an import isn't stuck
            with the eight countries the game ships. If your file covers a league this world hasn't
            got, add it there and name it what the file calls it, and the file fills it. See{" "}
            <a href="#world">the world</a> for the whole panel. Roster files can also be loaded
            straight from the plain New League screen, so both ways in do the same things. They
            just start you in a different place.
          </p>
          <p>
            If you don't have a roster file, the "Download Real Rosters" button next to Import gets
            you one covering every league in the game. It's a separate download rather than part of
            the game, which is why it's a button that fetches it instead of something already built
            in. Two things worth knowing before you look at the squads: the best players come out
            around 80 rather than 90, because ratings are rescaled onto the spread this game is
            tuned for and the ordering matters more than the absolute numbers; and imported clubs
            don't show a crest, since a crest belongs to a team slot rather than a club name and
            would otherwise end up on the wrong team. Colors do carry over. If you'd rather have a
            file made to your own description, the "Copy AI Prompt to Customize" button beside it
            is the other way in — see just below.
          </p>
          <p>
            Every club in it carries a real name, but not every one carries a real squad, because
            the source data doesn't reach that far down. Serbia, the second tiers of Portugal,
            Belgium, Turkey, the Netherlands, Scotland and Greece, and most of the Greek top flight
            get real names with generated players. Everywhere else has both. The file is rebuilt
            when the ratings are, and the link never changes, so downloading it again is how you
            get a newer one.
          </p>
          <p>
            You can hand it more than one file. Select as many as you like at once, or load one and
            then use "Add another file" on the club picker, and they all go into the same league. A
            file per league is usually the sane way to do it, since asking an AI for twelve leagues
            of real squads in a single answer tends to end badly. Files are stacked in the order you
            load them, so if two of them cover the same league, the later one wins and the game tells
            you which it used.
          </p>
          <p>
            Roster files only work when you're starting a league, on purpose. One can replace whole
            squads, and doing that to a save you've been playing would delete the careers, stats and
            transfer history of every player it overwrote. So they're applied at creation and nowhere
            else.
          </p>
          <p>
            A club entry can also carry a <em>players</em> list to bring in a whole squad, not just a
            name. Each player needs a name, position, and age, plus either an <em>overall</em> (the
            game builds position-appropriate ratings to match it) or an exact <em>ratings</em> block
            if you want full control; nationality, height, and potential are optional. You don't have
            to list a full 25 — whatever you leave short gets topped up with lower-rated reserves so
            the squad is always legal to field. Leave the players list off a club and only its name
            and colors change, exactly like Customize Teams.
          </p>
          <p>
            Writing all that JSON by hand is tedious, so the easiest route is to let an AI build it.
            The "Copy AI Prompt to Customize" button copies a ready-made prompt to your clipboard,
            already filled in with your world's exact league names and sizes. It sits on the Leagues
            screen next to Import, on the New League screen, and in the top bar of any save you have
            open, so you can grab it whether or not you've started anything yet. Paste it into
            ChatGPT or Claude and tell it what you want in there. Real present-day leagues are the
            obvious use, but nothing about it is limited to that: ask for a 2004 throwback league,
            all-time national XIs, clubs from a show you like, or a world you made up entirely. Then
            save its reply as a <code>.json</code> file and start a league with it using "Import" on
            the Leagues screen. (If your browser blocks clipboard access, the button downloads the
            prompt as a text file instead.)
          </p>
          <p>
            Press it on the New League screen rather than the Leagues screen if you've changed
            anything about your world, since that's the one that describes the world you're actually
            building — the leagues you added, the ones you renamed, the sizes you set. The Leagues
            one describes the default world, which is what most saves are.
          </p>
          <p>
            Three things the prompt spells out for the AI, because all three go wrong. Two go wrong
            quietly: it can only fill leagues your world actually has, so if you ask for one it
            hasn't got it will say so rather than invent a name, which the importer would skip
            without a word; and it has to keep each division inside its real size, since a division
            here can be anywhere from ten clubs to twenty. Both are why the prompt carries your
            world's league names and sizes rather than being the same text for everyone. The third
            goes wrong loudly: every club takes exactly two colors, and a club with three is enough
            to make the game refuse the entire file. That one catches AIs out because plenty of real
            clubs genuinely wear three, so being accurate is what breaks it.
          </p>
          <p>
            England's and Spain's clubs all have real crest art that shows up wherever the club's
            name does. Every club without one yet (Italy, Germany, France, Portugal, Belgium and
            Turkey) just shows a two-color swatch until it gets a crest of its own. Clubs that came
            in from a roster file always show their colors rather than a crest: the artwork belongs
            to the club that shipped in that slot, not to the one you imported over it.
          </p>
          <p>
            You can bring your own badges, though. On the New League screen there's a{" "}
            <strong>Load club logos</strong> button underneath the roster loader. Point it at a
            folder of picture files named after the clubs &mdash; <code>Liverpool.png</code>,{" "}
            <code>real-sociedad.webp</code> &mdash; and each one gets matched to the club of that
            name and shows up everywhere that club does. PNG, JPG, WebP, GIF and SVG all work.
            Capitals, accents and punctuation don't matter, so <code>bayern-munchen.png</code> finds
            Bayern M&uuml;nchen; if a name doesn't match anything the screen tells you which ones
            were skipped rather than leaving you to notice a missing badge later.
          </p>
          <p>
            Two things worth knowing. <strong>Load your roster file first</strong> &mdash; badges
            are matched by club name, so the clubs have to be called what you think they're called
            before the badges can find them. And the game <strong>shrinks every picture</strong> as
            it loads it, down to 160 pixels square, which is why a whole world's worth of badges
            doesn't turn your save into something that takes ten seconds to write. A logo pack
            somebody sends you (a <code>.json</code> file) works in the same picker, and your badges
            travel with the save when you export it.
          </p>
        </Section>

        <Section id="difficulty" title="Difficulty">
          <p>
            You pick a difficulty when you create a league, and it's fixed for that save. There are
            four: <strong>Easy</strong>, <strong>Normal</strong>, <strong>Hard</strong> and{" "}
            <strong>Brutal</strong>. Normal is the game exactly as it's tuned, so if you'd rather not
            think about this, take Normal and skip the rest of this section.
          </p>
          <p>
            The important thing to know is what difficulty <em>doesn't</em> do. It never touches the
            rest of the world. AI clubs buy and sell each other's players at the same prices, their
            academies produce the same players, and the leagues stay exactly as strong as they'd
            otherwise be. Every knob below applies to your club and only your club, so a hard save is
            a harder job in the same world, not a different world.
          </p>
          <p>Four things change:</p>
          <ul>
            <li>
              <strong>Money</strong>. Your club earns more or less than it otherwise would, and can
              bank more or less. Wages cost you exactly what they cost everyone else, which is the
              part that bites: on the harder levels a big squad's wage bill can outrun what the club
              brings in, and then you're losing money every season until you sell someone.
            </li>
            <li>
              <strong>Your academy</strong>. Your youth intake comes through stronger or weaker.
              Everyone else's is untouched, so on Brutal you're developing worse kids than the club
              finishing next to you.
            </li>
            <li>
              <strong>What you pay</strong>. Asking prices are marked up or down for you. Selling
              isn't affected, and neither is what anything is worth on paper, just the fee you're
              asked for when you go and buy someone.
            </li>
            <li>
              <strong>Who'll sell to you</strong>. The best players at the best clubs are already off
              the market (see <a href="#transfers">Transfers</a>). On the harder levels that net is
              cast wider for you, so more of the game's best players simply aren't available and you
              have to develop your own. On Easy it barely applies at all and you can go buy whoever
              you like. When a player is out of reach because of your difficulty, the game says "not
              available to you" rather than pretending his club won't sell, because his club might
              well sell him to somebody else.
            </li>
          </ul>
          <p>
            Scouting is also fuzzier on the harder levels: potential estimate bands are wider and
            take longer to sharpen up, so you're making decisions with worse information.
          </p>
          <p>
            <strong>You can go broke.</strong> There's no debt system and nobody bails you out. If
            your balance goes negative you simply can't sign anyone until it's positive again, and
            your scouting is stuck at zero while you're overdrawn, which makes potential even harder
            to read. It's recoverable, but you recover by selling. On Brutal that's less a warning
            than a description of the job.
          </p>
        </Section>

        <Section id="spectator" title="Spectating: A Save With Nobody in Charge">
          <p>
            You don't have to manage anyone. Above the club picker on the New League screen there's
            a <strong>Spectator mode</strong> switch. Leave it off and you get the game the rest of
            this manual describes. Turn it on and the same world gets built and then left entirely
            to the AI, with no club picker and no club of your own. You still run time. You just
            don't run a team.
          </p>
          <p>
            <strong>It's fixed for the life of the save.</strong> A spectator save isn't handed a
            club later, and a save with a club can't give one up. Normal play has no switch for it
            either way, so if you get twenty seasons in and decide you'd rather be managing
            somebody, that means a new save. The one exception is <a href="#godmode">God Mode</a>,
            which will let you walk in and take charge of any club the same way it lets you do
            anything else, and that's a one-way trip. Worth being sure before you press Start
            Watching.
          </p>
          <p>
            None of the football changes. The AI already runs every club except yours, and
            spectating just takes away the exception. It's the same handover the{" "}
            <a href="#season">jump ahead</a> button makes while you're away, kept permanently.
            Transfers, free agency, contract renewals, squad trimming, formations, promotion and
            relegation all carry on exactly as they would have, so what you're watching is the
            world this game would have produced anyway.
          </p>
          <p>
            You keep the whole sim card: one matchday, the rest of the season, sim to a matchday you
            pick, the offseason, each stage of the summer's international football, and{" "}
            the top bar's <strong>Jump</strong> menu for up to 25 seasons at a time. Everything about the world
            stays open too. Standings, all three cup competitions, the promotion playoffs, Power
            Rankings, Schedule, Stat Leaders, Awards, Season History, Club History, Frivolities, Season Preview, the
            News Feed, every National Teams page, and the profile of every player and every club in
            the world. The <a href="#pages">Watchlist</a> comes with you as well, moved up into the
            League part of the sidebar, which is a good way to follow a sixteen-year-old you've
            spotted in somebody's academy and find out what becomes of him.
          </p>
          <p>
            What's gone is everything that needed a squad of your own: Roster, Transfers, Incoming
            Offers, Loans, Finance, Incoming Talent, Free Agents, the Academy, the scouting slider
            and the Manager page. They're dropped from the sidebar rather than greyed out, since
            there's never going to be a club behind them, and an old bookmark to one of them lands
            on a short note saying you're spectating. There's no board, no confidence bar, no
            sackings and no job offers, so <a href="#manager">Your Job</a> doesn't apply to you at
            all. National teams go the same way: you can watch every World Cup, qualifying campaign
            and confederation cup, but you don't manage a country and no federation ever gets in
            touch, because a spectator holds no jobs of any kind. And there's no{" "}
            <strong>Watch Next Game</strong>, since that plays out your own club's match and you
            haven't got one.
          </p>
          <p>
            Your Dashboard is a page of its own: the season and matchday with a Spectating badge,
            the sim controls, a league table with a dropdown for any competition in the
            world, and that league's latest matchday beside it, every game with the score
            once it's been played. Along the bottom are the ten
            best clubs anywhere by power ranking, and the Continental Cup and Continental Shield,
            each showing its league phase table until the knockout starts and its bracket after
            that. And the News Feed carries world-level news only, so the big transfers, the
            trophies, the awards and who went up and who went down. It normally works out what to
            show you by which league is yours, and here none of them is.
          </p>
          <p>
            In the offseason, any summer with a tournament in it gets its own panel up near the sim
            controls: the World Cup bracket every fourth year, and the confederation championships
            two years after that, all of them side by side. The other two summers are qualifying
            only, so there's no panel for them.
          </p>
        </Section>

        <Section id="manager" title="Your Job: Confidence, Offers & Sackings">
          <p>
            You're a manager, not an owner. The club you start at is a job you can lose, and other
            clubs can offer you a better one. All of it happens at the end of a season, never
            mid-season.
          </p>
          <h6>Board confidence</h6>
          <p>
            Your board keeps a running confidence in you, shown as a bar on the Dashboard and on the
            Manager page. It moves once a season, and what moves it is <strong>where you finished
            against where a club like yours is expected to finish</strong> &mdash; not where you
            finished on its own. Finish 6th when they expected 12th and they're delighted. Finish
            6th when they expected 2nd and you're in trouble, even though 6th is the same 6th. The
            Manager page always tells you the number you're being measured against.
          </p>
          <p>
            That expectation comes from <strong>what the club is</strong>, not what your squad is:
            where you've finished over the last few seasons, and how well known the club is.
            Nothing you do in the transfer market feeds into it. If it did, you could sell every
            good player, finish next to last, and have the board congratulate you for beating a bar
            you'd just lowered yourself. Building the squad is your job, so it can't also be your
            grade. Your bank balance is left out for the same reason &mdash; otherwise spending
            your budget, which is simply doing the job, would quietly make the target easier.
          </p>
          <p>
            One consequence worth planning around: keep succeeding and the bar rises with you, so a
            club you dragged up from mid-table will eventually expect to be there. Sustained decline
            lowers it too, but slowly, over seasons rather than in one summer. Early in a save there
            aren't enough recorded seasons to read yet, so the expectation starts from the squad
            at the club and shifts onto results as they accumulate.
          </p>
          <p>
            Trophies are counted on top, and so are promotion and relegation. Winning your division
            is worth a lot. Going down is worth a lot in the other direction, but it isn't an
            automatic sacking: if you'd spent years overachieving before it happened, the goodwill
            you banked can carry you through. That's the point of a running balance rather than a
            "two bad seasons and you're out" rule.
          </p>
          <h6>Not every board is as patient</h6>
          <p>
            Two things make a board harder to please. The first is <strong>how big a job it
            is</strong>: a superclub's board treats winning as the baseline, so it gives you less
            credit for a good season and charges you more for a bad one. The same finish that keeps
            you comfortable at a small club can start costing you at a giant, and being the biggest
            club in a strong league is the most demanding job of all.
          </p>
          <p>
            The second is your save's <strong>difficulty</strong>. Easy boards are forgiving, Brutal
            boards are not, with Normal and Hard in between. It's the one difficulty knob that has no
            effect at all on the world around you &mdash; it changes how long you keep your job,
            nothing else.
          </p>
          <p>
            You always get a full season's grace at a new club before the board can sack you, so
            inheriting a mess can't end your job before you've had a transfer window of your own.
          </p>
          <h6>Job offers</h6>
          <p>
            Beat expectations and clubs come calling in the offseason. Two things decide which ones.
            Your <strong>current club sets the floor</strong> &mdash; while you're employed you'll
            never be offered a step down, only a lateral move or better, so the list is worth reading
            rather than noise. Your <strong>reputation sets how far above it you can reach</strong>,
            and it's built from the titles and cups you've won, how consistently you've beaten what
            your squads were worth, and how long you've been at it, with a sacking counting against
            you. Run a small club with nothing on your CV and you'll hear from clubs at roughly your
            own level; win things and the biggest jobs in the world start ringing instead.
          </p>
          <p>
            Being at the very top doesn't switch the offers off. If you're already at one of the
            biggest clubs there is nowhere left to climb, so what you get instead are approaches from
            your peers &mdash; fewer of them, and all from clubs in the same bracket as yours.
          </p>
          <p>
            Taking a job has real costs, and they're worth knowing before you click. Your current
            squad goes straight to the AI. Your youth academy graduates onto that club's senior
            roster on the way out, so those prospects are gone. Any transfer talks, incoming bids and
            loan listings you had open are dropped. And you arrive at the new club knowing its
            players' ratings but <em>not</em> their potential &mdash; scouting starts from scratch,
            exactly as if you'd just signed all of them. The club keeps its own money, so you inherit
            its budget and its wage bill, not your old club's.
          </p>
          <h6>Getting sacked</h6>
          <p>
            If confidence hits zero, you're out. You'll be shown a list of clubs still willing to
            take you on, generally a rung below the one that just let you go, and you have to pick
            one &mdash; there's no sitting a season out. The save carries on from there with your
            record intact, sacking and all.
          </p>
          <p>
            <strong>If you'd rather not play this way</strong>, there's a "Never sack me" switch on
            the Manager page. Job offers still arrive, so you keep the ability to move clubs when you
            want to; the board just can't move you.
          </p>
        </Section>

        <Section id="pages" title="The Pages">
          <p>Every screen in the game and what it's for:</p>
          <ul>
            <li><strong>Manager</strong>. Your job: how the board feels about you, any clubs that want to hire you, and the record of every club you've managed. Also where the "never sack me" switch lives.</li>
            <li><strong>Dashboard</strong>. Your current W/D/L record and next fixture front and center, with your division's standings on the left and the latest news headlines on the right. Below that, a Stat Leaders section splits league-wide leaders from your own squad's leaders across a few key stats, and below that a finances snapshot with the scouting-spend slider and the sim controls. Right at the bottom, away from all of that, sit three panels about the rest of the world: the ten best clubs anywhere by power ranking with your own picked out, and the Continental Cup and Continental Shield, each showing its league phase table until the knockout starts and its bracket after that. In the offseason a fourth joins them whenever there's a tournament on, which is the World Cup every fourth year and the confederation championships two years after that.</li>
            <li><strong>Standings</strong>. The league table, plus each club's current OVR/POT. A season dropdown lets you pull up any past season&apos;s final table next to the current one. The champion&apos;s row is highlighted, and the <a href="#cup">Continental Cup</a> and <a href="#shield">Continental Shield</a> qualification places are shaded.</li>
            <li><strong>Continental Cup</strong>. The live league-phase table and knockout bracket for the current season, plus past winners via a season dropdown. More in <a href="#cup">The Continental Cup</a>.</li>
            <li><strong>Continental Shield</strong>. The same page for the second competition, for clubs finishing just below the Cup places. More in <a href="#shield">The Continental Shield</a>.</li>
            <li><strong>Domestic Cup</strong>. Every round of your country&apos;s cup as it&apos;s drawn and played, with a dropdown for any other country and for past seasons. More in <a href="#domestic-cup">The Domestic Cup</a>.</li>
            <li><strong>National Teams</strong>. A whole section for the summer's national-team football: Player Pool (call players into your own country's squad) and My Squad (pick its eleven), Federation (your international career, and who wants you), the current World Cup, Qualifying and Confederation Cups (the Euro, Copa América and AFCON), Rosters showing every nation's named squad, a Schedule of fixtures, Power Rankings of every nation, Stat Leaders (top nations and top players, filterable by country), and History with past winners and each nation's record. More in <a href="#international">International Football</a>.</li>
            <li><strong>Power Rankings</strong>. Every club in the world ranked by a blended Power score: squad OVR (Starting XI plus bench, depth-weighted, same formula as Standings' OVR column) plus a current-season form bonus or penalty. Form isn't just your record. Beating a strong side counts for more than beating a weak one (and losing to a weak side hurts more than losing to a strong one), and goal difference factors in too, so a club can rank above or below its raw OVR depending on how it's actually playing. Record, goal difference, OVR, and the blended Power score all sit side by side, with a badge showing each club's competition and its rank within it. Click a team to expand its full roster in place. The rankings also get snapshotted every 10 matchdays (plus once after the final matchday), so four times a season, and a dropdown lets you browse any past snapshot from any season, with arrows showing how far each club rose or fell since the last one. Snapshots taken before this cadence changed are kept, so an older save has a denser dropdown for its early seasons. Historical views can't expand rosters, since past squads aren't stored, and snapshots only start piling up from the point this feature shipped.</li>
            <li><strong>Schedule</strong>. Every matchday's fixtures and results. Click a played match for its box score.</li>
            <li><strong>Stat Leaders</strong>. A Players tab (league-wide leaderboards for one season at a time: goals, assists, shots, shots on target, xG, tackles, interceptions, passes, crosses, fouls, yellow cards, red cards, saves, minutes, and average match rating, with a season dropdown covering the current season and every completed one) and a Teams tab (the same stats plus possession, goals against, and xG against, totaled per club, with its own season dropdown). Match rating is an average rather than a running total, so to keep a one-off cameo from topping the chart a player needs to have appeared in at least half of the games played so far before he shows up on the match-rating board (a threshold that scales as the season goes, so it works ten games in as well as at the end). A <strong>Totals / Per 90</strong> switch sits next to the stat dropdown: Per 90 divides each stat by the number of full matches the player's minutes add up to, which is how you find the squad player outproducing a starter rather than just the one who played most. Per-90 mode has a playing-time floor of its own &mdash; 30% of the minutes available so far, quoted above the table &mdash; because a rate is far easier to fluke than a total: score in a twelve-minute cameo and you've "scored" 7.5 per 90. It's counted in minutes rather than appearances, since twenty run-outs off the bench is exactly the case an appearance count would wave through. Appearances, minutes and match rating stay as totals either way (the first two are what the rate divides by, and a match rating is already an average). For career totals and all-time bests across every season at once, see <a href="#frivolities">Frivolities</a>' All-Time Leaders.</li>
            <li><strong>Awards</strong>. Two tabs. World gives the Ballon d'Or for the best player in the world that season (with a top-10 shortlist and a breakdown of where his points came from), a Goalkeeper and a Defender of the Year judged on the defensive work the Ballon d'Or can't see, and a World Team of the Year pitch view. By league gives Player of the Season, the Golden Boot, and a Team of the Season pitch view for one competition. Both have a dropdown to browse past years.</li>
            <li><strong>Season History</strong>. Who won what, one line per season, newest first &mdash; so you can read a twenty-year dynasty in one screen instead of clicking through twenty seasons. It&apos;s also where you land after <a href="#season">jumping ahead</a>, since that&apos;s the moment you most want it. Each line gives the Continental Cup and Continental Shield winners, whoever won the World Cup or their confederation&apos;s championship in the offseason that followed, and then one column per country holding that country&apos;s champion. A toggle swaps those country columns between <strong>league champions</strong> and <strong>domestic cup winners</strong>. The country columns use three-letter club codes to keep the whole world on one line &mdash; hover one for the full name, or click through to what that club did that year. Your own club&apos;s titles are shaded. Two things worth knowing: the continental finals are played before a season rolls over, so the season you&apos;re in appears as soon as one of them is decided, marked &quot;(now)&quot; and with its league columns still empty; and an international tournament is played in the offseason <em>after</em> a season, so it sits on that season&apos;s line. It&apos;s all read straight off the records your save already keeps, so a dynasty that started long before this page existed shows its whole back catalogue.</li>
            <li><strong>Club History</strong>. A per-club honours page (yours by default, with a dropdown for any club in the world): a trophy case (league titles, second-tier titles, Continental Cups, domestic cups, any trebles, promotions and relegations), individual honours won by the club's players (Player of the Season, Golden Boot, Team of the Season selections), franchise records (best finish, most points and wins in a season, all-time record), and a season-by-season table of every completed season (each season's note also shows how far the club got in that year's Continental Cup and domestic cup). It also ranks the club's greatest players &mdash; see <a href="#frivolities">Frivolities</a> for how that score is worked out.</li>
            <li><strong>A club in one season</strong>. Click any club anywhere in the game &mdash; a table, a transfer, the club beside a season on a player's profile &mdash; and you land on what that club did that year: the squad, where it finished and its record, how far it got in the domestic cup, the Continental Cup and the Continental Shield, and where the Power Rankings had it at the end. A dropdown walks you through the club's other seasons. Two things to know about an old squad. It's who <em>finished</em> the season there, so a player sold in January shows up at his new club and not his old one. And players who retired long ago may be missing altogether, because the game only keeps a permanent career record for the ones worth remembering &mdash; the rest are gone for good. Retirees who are still on record show their appearances and the rating they played at, but not their goals and assists for that year, which aren't kept.</li>
            <li><strong>Frivolities</strong>. All-time lists that don't affect play: GOAT rankings for players and clubs, an awards record book (most Ballon d'Ors, World Team of the Year places, Players of the Season, Golden Boots and Team of the Season places, the highest-scoring individual seasons ever, and awards by club and country), all-time records (most dominant and worst team seasons, highest rating ever reached, longest careers, biggest transfer fees), All-Time Leaders (the top 10 in every stat at a glance, click through for the full board, career totals or best single seasons, world-wide and including retired players), an international record book (most caps, international goals and World Cups won, laid out the same way and filterable by country), player bios (oldest, youngest, where players come from, one-club men, name oddities), and club records (trophy cabinet, longest title droughts, biggest spenders and best traders). More in <a href="#frivolities">Frivolities</a>.</li>
            <li><strong>Season Preview</strong>. A snapshot of how the offseason shook out: the league's top 10 highest-rated players, top 10 highest-rated teams (both by OVR), the top 10 biggest transfers from the summer window ranked by fee, and who <a href="#development">retired</a>. It opens automatically the moment you advance past a season, with a link through to Awards.</li>
            <li><strong>News Feed</strong>. Transfers and player accomplishments woven into one timeline per season, with club and season filters, and your club's items highlighted. It's filtered by how much the story has to do with you, because the world is sixteen leagues across eight countries and reporting all of them equally buries you in news about clubs you'll never play. Your own club is always in, whatever it did &mdash; every transfer, loan, loan return and free signing, and every accomplishment. Your league is next: every deal (loans included) and every accomplishment in it. From the rest of the world you only get the big stories &mdash; a four-goal haul, a 100th career goal, a 35-goal season, the standout performance of the matchday, the Ballon d'Or, the World Team of the Year, Goalkeeper and Defender of the Year, and transfers over $40M. Accomplishments themselves are hat-tricks, one standout performance a matchday, career goal milestones at 50 and then every 50, season goal milestones at 25 and then every 5, and position changes for established players. <strong>Trophies and end-of-season awards land in the feed too</strong>, at the bottom of the season they belong to. Trophies first: who won the Continental Cup and the Continental Shield, and who won the World Cup and each confederation cup, with the final score. Then the honours: anything one of your players wins, plus your league's Player of the Season, Golden Boot and Team of the Season. All of it comes straight off the same records the Awards and cup pages read, so old saves show every trophy and honour they ever handed out, right back to season 1. Last of all comes what it changed: <strong>countries winning and losing Continental Cup places</strong>, saying which way the places went and what the counts went from and to. Those are always reported, wherever they happen, because a place changes hands well under once a season across the whole world and when it does it reshapes the competition everyone plays in. They're worked out from the cups your save already has on record too, so an old dynasty shows every place it ever won or lost. Trophies also reach your dashboard's news panel the moment they're won, and an honour won by one of your own players sits there until the new season kicks off.</li>
            <li><strong>Roster</strong>. Your squad: your Starting XI on a pitch view (with an optional Depth Chart overlay), a stats table for the XI, and a bench table (both with ratings, ages, contracts, and season stats, and goalkeepers also show goals against and xG against). Drag a bench player onto a pitch slot to swap him into the XI, drag one starter onto another to switch their positions, extend contracts, or release players.</li>
            <li><strong>Transfers</strong>. Recommended targets you can actually afford, plus your live negotiations. Make offers, read counter-offers, close deals.</li>
            <li><strong>Watchlist</strong>. Players you&apos;ve starred to keep an eye on. Click the star beside anyone&apos;s name &mdash; on his profile, in the transfer search, or on the Free Agents and Incoming Talent lists &mdash; and he shows up here with his club, this season&apos;s form, his wage, when his contract runs out, what your scouts think he&apos;s worth, and whether his club would entertain an offer at all. It&apos;s a shortlist and nothing more: watching a player doesn&apos;t scout him, doesn&apos;t tell his club anything, and doesn&apos;t change what he costs. Everything on it is worked out fresh each time you open it, so a name you starred three seasons ago shows the club he&apos;s at today at today&apos;s price. He drops off on his own if he retires.</li>
            <li><strong>Incoming Offers</strong>. AI clubs bidding for <em>your</em> players. Accept, reject, or counter to push the fee upward.</li>
            <li><strong>Loans</strong>. List your own players for a fixed-length loan, look over AI clubs' incoming loan offers, and keep track of who's currently out on loan.</li>
            <li><strong>Finance</strong>. Budget, the full wage-bill table, a projected (or final) season settlement, your transfer history, and a league-wide money table.</li>
            <li><strong>Youth Intake</strong>. This year's crop from your academy, on trial. Offer a contract to a few of them; the rest leave. Also where you set your scout directions &mdash; which countries your scouts look in, and which positions they look for.</li>
            <li><strong>Free Agents</strong>. Every other unsigned player, sign straight to your senior team. The default view shows the best across every position but caps how many of any one position it lists, so a spot that always has lots of free agents (defensive and attacking mids only get two roster spots per club, so their good extras spill into free agency more often) can't crowd out the rest. Pick a position from the dropdown to see that position's full list.</li>
            <li><strong>Academy</strong>. Your club's youth-academy holding pool: extend, release, or promote to the senior team.</li>
            <li><strong>Box Score</strong>. Per-match detail, in three parts. The scoreboard at the top names the competition and matchday and starts the Man of the Match, the highest-rated player among those who actually played. Under it, a head-to-head strip compares the two sides on possession, shots, shots on target, xG, corners and fouls. Then a full-width stat table per club (xG, passes completed/attempted, crosses and fouls, goals against and xG against on the goalkeeper's row, and a 0&ndash;10 match rating for everyone who appeared), grouped into attacking, keeping, defending, passing and discipline blocks. The play-by-play at the bottom runs down a timeline with one club on each side, showing goals, cards, substitutions, penalties and injuries by default; switch it to "Every event" to add every shot and corner too.</li>
            <li><strong>Leagues</strong>. Your saved leagues. Create, enter, or delete saves. Each one is fully independent. Every save is named after the club you took over, so the row also shows the season it's reached and when you started it, which is how you tell two saves of the same club apart.</li>
            <li><strong>Player Profile</strong>. Click any player's name anywhere in the game (Roster, Stat Leaders, Awards, Transfers, News Feed) to open his full career page: every attribute rating, individual and team honors (Ballon d'Or, World Team of the Year, Goalkeeper of the Year, Defender of the Year, Player of the Season, Golden Boot, Team of the Season, league titles), the fullest season-by-season stat line in the game (goals, assists, goals+assists, shots, shots on target, shot accuracy, conversion rate, xG, goals over or under xG, passes, pass completion, crosses, tackles, interceptions, fouls, yellow and red cards, and average match rating), with a <strong>Career</strong> row underneath totaling the lot. Keepers get their own set instead &mdash; saves, save percentage, goals against, xG against, and goals prevented &mdash; and the shooting columns disappear for them, so nobody carries a row of columns that will only ever read zero (a keeper who has actually scored keeps them). Two of those columns are worth knowing what to do with. <strong>Goals over xG</strong> is the finishing read: xG doesn't care who's taking the shot, so a striker sitting well above his xG season after season really is finishing better than the chances he's getting, and one below it is missing chances an average forward would take. <strong>Goals prevented</strong> is the same idea for keepers, the other way round: xG against minus what he actually let in, so positive means he's saving shots that usually go in. The table carries the same Totals / Per 90 switch as Stat Leaders &mdash; on the Cup tab as well, but not on national-team stats, where caps are recorded without minutes and so have no per-90 reading. Percentages and match ratings stay put in Per 90 mode, since they're already rates. The Career row is worked out from the underlying totals rather than by averaging the seasons above it, so a big season counts for more than a six-game one in his career pass completion or match rating &mdash; full transfer history, a transfer-value-over-time chart, and a season-by-season OVR/POT/attribute history. The value chart plots what he's worth on the market against the seasons he's played, with the line colored by whichever club he was at and club crests marking transfers. Hover any season for a card with his value that year, his age, his OVR and POT, his goals and assists, his appearances, his average match rating, and the club he was at, where a youth-academy year reads as "Club (Academy)". A Value/OVR switch in the corner of the panel flips the same chart to his rating over time, which is worth a look on an older player: a veteran's OVR can sit flat for years while his value falls away underneath it, because the market is paying for the seasons he has left as much as for how good he is. His ratings only move in the offseason, so there's one real value per season and the line between them is just a smooth join, not extra readings. The value is worked out from the same numbers the market uses, which includes his potential &mdash; so if your scouts still only have a range on his POT, the chart is priced off that range rather than the real number, and it sharpens as they do.</li>
          </ul>
        </Section>

        <Section id="season" title="The Season & Simming">
          <p>
            A season is a double round-robin: 38 matchdays from August to May, every club playing
            every other home and away. A win is 3 points, a draw is 1. Alongside the league, the
            world's best clubs fight it out in the <a href="#cup">Continental Cup</a> on fixed
            matchdays. Seasons show as real years, starting at 2026 and ticking up one each time
            you go to the offseason.
          </p>
          <p>
            <strong>Start year.</strong> 2026 is just the default. There's a start year box on the
            New League screen, so you can begin in 1994, or 2038, or whatever year you want your
            save to be set in. It's purely cosmetic. Nothing in the game reads it, so a save that
            starts in 1994 plays exactly the same as one that starts in 2026, and behind the scenes
            it's still season 1. Saves you already have keep showing 2026.
          </p>
          <p>
            <strong>Naming your save.</strong> There's a league name box on the New League screen.
            Leave it alone and the save gets named after the club you picked, the way it always
            has. Fill it in and that's what shows on the Leagues screen instead, which is worth
            doing once you've got three saves in the same country. Renaming your club later only
            renames the save if you never typed a name of your own.
          </p>
          <p>
            <strong>Historic seasons.</strong> Every so often, a club's whole season just clicks.
            Or completely falls apart. A rare hidden form swing can carry a squad well above (or
            below) what its ratings say, for one season only. It's where the runaway record-points
            champion comes from, and the collapse nobody saw coming. It's season-long and it stays
            in that season. Ratings, values, and wages don't change, and next year the club is
            right back to its true level. Your club is just as eligible as any other, both
            directions.
          </p>
          <p>
            You sim from the Dashboard (or the Sim menu in the top bar) in whatever chunk you want:
            one game, the rest of the season, or a distance you pick yourself &mdash; either{" "}
            <strong>sim to matchday</strong> a number, or <strong>sim this many matchdays</strong>{" "}
            forward. The line under the box tells you what you're about to play, how many matchdays
            that is, and what month it lands in, so you can stop anywhere: the game before a big
            cup tie, the last matchday of a month, or matchday 21 to land on{" "}
            <strong>deadline day</strong> with the winter transfer window still open. Matches
            involving your club use your saved starting XI. Once the season's over, both the card
            and the menu keep their place and swap their buttons for the offseason ones, so
            whatever comes next &mdash; a round of World Cup qualifying, a tournament stage, or
            advancing into the new season &mdash; is right where the sim controls always were.
          </p>
          <p>
            <strong>Watching a match.</strong> Next to Sim One Game there's <strong>Watch Next
            Game</strong>, which plays your club's match out a minute at a time instead of jumping
            to the result: a running clock, the events as they happen, and the rest of your
            division's scores and the live table down the right. You can pause, run it at 1x, 2x or
            4x, or skip to the final whistle, and the <strong>Every chance</strong> switch decides
            whether you see every shot or only the goals, cards, subs, penalties and injuries. To
            see one again later, open its box score and hit <strong>Watch it back</strong>.
          </p>
          <p>
            Cup ties can be watched too. Continental Cup rounds land on league matchdays, so on
            one of those you have two matches: the game asks which you'd rather watch, and plays
            both either way &mdash; the one you skip still has its box score. A league-phase match
            shows the Swiss table beside it instead of your league table, and a two-legged
            quarter-final or semi-final is watched a leg at a time, the second leg at the other
            club's ground.
          </p>
          <p>
            The match is played the moment you press the button, and what you're watching is the
            recording of it, so watching never changes the result. It also means the matchday isn't
            saved until you close the viewer: quit halfway and it simply hasn't happened, and
            playing it again gives you the same match. You can't make substitutions while you watch
            yet, and possession and xG appear only at full time (they aren't tracked minute by
            minute).
          </p>
          <p>After matchday 38, the offseason runs on its own, in this order:</p>
          <ol>
            <li>AI clubs renew expiring contracts for players they still rate (<a href="#ai">details</a>).</li>
            <li>Contracts that didn't get renewed expire, and those players become free agents.</li>
            <li>Every player ages a year and develops (or declines) per the <a href="#development">development model</a>.</li>
            <li>Retirements: veterans from the mid-30s onward, plus players nobody has signed (<a href="#development">details</a>).</li>
            <li>The youth academy delivers each club's new intake (<a href="#youth">details</a>).</li>
            <li>AI clubs sign free agents, both to fill holes and to poach any that upgrade a spot they're already stocked at, then trim their squads back to 25.</li>
            <li>The summer transfer window opens and the AI-to-AI market runs.</li>
            <li>New season: budgets get settled, base allocation in and the full season's wages out (<a href="#finance">details</a>).</li>
          </ol>
          <p>
            Any lingering injuries get healed over the offseason, so anyone still hurt at the
            rollover starts the new season fit.
          </p>
          <p>
            <strong>Jumping ahead.</strong> The <strong>Jump</strong> menu in the top bar, next to Sim,
            plays whole seasons at once &mdash; up to 25 &mdash; with the AI running your club
            while they go by. It's for seeing where a world ends up, or for skipping past a
            rebuild you don't fancy managing. It works mid-season too: it finishes the season
            you're in first, so jumping 1 season always means "get me to next year".
          </p>
          <p>
            While you're gone your club is treated as an AI club in every respect. It picks its own
            formation and XI, buys and sells, renews contracts, signs free agents and trims itself
            back to 25. Other clubs can bid for your players, and your stars are protected exactly
            the way an AI club's are &mdash; by price, not by a veto. If it gets relegated its best
            players can be pulled up to the first division like anyone else's, and your{" "}
            <a href="#squad">saved starting XI</a>, transfer listings and any talks you had open
            are cleared when you hand it over, because nobody's there to finish them.
          </p>
          <p>
            You get the club back at the start of the season you asked for, with a summary of how
            each year went, and taking over drops you on <strong>Season History</strong> so you can
            read who won everything else while you were away. Two things to know: potential comes
            back <a href="#players">fogged</a>{" "}
            for anyone signed while you were away (you haven't watched those players), and there's
            no undo &mdash; the only way back to the season you left is a save you exported first.
            A long jump takes a few minutes to play out.
          </p>
        </Section>

        <Section id="world" title="The World">
          <p>
            A new save drops you into one shared world: twelve countries (<strong>England</strong>,{" "}
            <strong>Spain</strong>, <strong>Italy</strong>, <strong>Germany</strong>,{" "}
            <strong>France</strong>, the <strong>Netherlands</strong>, <strong>Portugal</strong>,{" "}
            <strong>Belgium</strong>, <strong>Turkey</strong>, <strong>Greece</strong>,{" "}
            <strong>Scotland</strong> and <strong>Serbia</strong>), each with its own league
            pyramid, for 36 leagues and 626 clubs total. You pick any club in any country and
            division when you start.
          </p>
          <p>
            <strong>Every country runs three divisions.</strong> Sizes vary — England, Spain and
            Italy field 20 in every tier, down to Scotland's 10 in its bottom two — and the third
            tier works like any other division: its own table, its own promotion and relegation with
            the division above, its clubs in the domestic cup. Starting down there is the longest
            climb the game offers. Be warned that it's a genuinely different game: third-division
            money is a fraction of top-flight money, and a youth academy that deep produces very
            little, so you'll be building out of the transfer market and out of whoever you can keep
            hold of.
          </p>
          <p>
            <strong>Leagues are the size they are in real life</strong>, not all the same. England,
            Spain and Italy field 20 clubs; Germany, France, Portugal, Turkey and the Netherlands
            18; Belgium and Serbia 16; Greece 14; and Scotland 12. Second divisions vary the same
            way, down to Scotland's 10. Twenty is the ceiling, because a division of that size
            already fills every matchday in the season, and a smaller league spreads its games
            across the same calendar rather than finishing early — so the transfer windows and the
            run-in still fall where you'd expect. A smaller league also plays fewer games, so its
            points totals are lower; don't read a 12-club champion's tally against a 20-club one.
          </p>
          <p>
            <strong>Promotion and relegation scale with that.</strong> Most countries swap three
            clubs each way, but Portugal, Belgium, the Netherlands, Greece and Serbia swap two, and
            Scotland only one — three up out of a 10-club second division would turn over a third
            of it every season. Where there's a third division the same count applies to both
            links, and each is settled on its own final table, so you can only ever move one
            division a season.
          </p>
          <p>
            <strong>The last promotion place is a playoff, and there are two systems.</strong>{" "}
            Each country runs the one it runs in real life, and you can change any of them in
            World setup when you start a save.
          </p>
          <p>
            The <strong>English</strong> system is what England, Spain, Italy, France, Turkey and
            the rest use. Only the top clubs go up automatically and the last place is decided on
            the pitch by the four that finished just below them, so in a country promoting three,
            1st and 2nd go up on the table and 3rd through 6th play off: two-legged semi-finals
            (3rd v 6th, 4th v 5th), then a one-off final. Finishing higher gets you the tie against
            the lowest-placed club and nothing else, because over two legs you each host once and
            the final is at a neutral ground. Sixth goes up about as often as third does, which is
            roughly how it works in real life, and it means a mid-table run-in still has something
            to play for.
          </p>
          <p>
            The <strong>German</strong> system, which the Bundesliga uses, points the last place at
            both divisions at once. One fewer club goes up automatically and one fewer goes down,
            and then the club that just missed out below plays the lowest club that just survived
            above, home and away, for the remaining top-flight place. Win it from below and you
            swap: you go up, they go down. Win it from above and nobody moves at all, so that
            season the country promotes and relegates one fewer club than usual. It is a harder
            route up than the English bracket, because you are playing a top-flight side rather
            than your own division's stragglers.
          </p>
          <p>
            Scotland promotes only one club and so runs no playoff by default: its champion goes
            up and that's that. You can give it either system in World setup, though the English
            bracket needs at least two promotion places to sit below, so at one place only the
            German one is offered.
          </p>
          <p>
            It's played the moment the season ends, before anyone retires or moves clubs, so a
            veteran on his way out gets one last game. Suspensions don't carry into it — there are
            no matchdays left to serve a ban against — but injuries do. Results are on the{" "}
            <strong>Promotion Playoffs</strong> page, for any country and any past season.
          </p>
          <p>
            The big four (England, Spain, Italy and Germany) are all built to the same strength and
            budget bands, so none of them is a flagship league above the others. The other eight are
            deliberately weaker and poorer: their clubs generate at lower OVR, and they earn and can
            bank less money. They step down in that order —{" "}
            <strong>France</strong>, then the <strong>Netherlands</strong>, then{" "}
            <strong>Portugal</strong>, then <strong>Belgium</strong>, then <strong>Turkey</strong>,
            then <strong>Greece</strong>, then <strong>Scotland</strong>, then{" "}
            <strong>Serbia</strong> weakest of all, and their budgets step down in that same order.
            All eight are selling leagues, and Serbia is the poorest as well as the weakest. Worth
            knowing that these gaps close as a save gets long: weaker leagues develop players faster
            than the big four do, so by season 20 or so the bottom few leagues are bunched much
            closer together than they started. The order is real when you begin, and it softens from
            there. You
            won't feel it inside their own matches (someone still wins Ligue 1), but it shows up
            wherever leagues meet. Their players are cheaper, so the big four steadily buy up their
            best talent, and they go into every Continental Cup tie at a real disadvantage. Division 2
            in any country generates weaker than its own Division 1, exactly like the real second
            division always has, and that gap is kept real and structural across a whole dynasty (see
            the ceiling mechanism below), not just at the start.
          </p>
          <p>
            <strong>One global transfer market.</strong> The AI transfer market, free agency,
            recommended transfers, and inbound offers for your own players all run across every
            country with no home-country bias. An Italian club can and will buy a Spanish player,
            sign an English free agent, or bid on one of yours, exactly like they're all in one
            league. A strong Division 2 player anywhere in the world can also get pulled up to a
            Division 1 club by the same thing that already applies at home (there's a "Wants a move
            to Division 1" note in <a href="#ai">How AI Clubs Think</a>), and it isn't limited to
            his own country.
          </p>
          <p>
            Promotion and relegation (three clubs each way in most countries, fewer in the smaller
            ones, with the last place up decided by a playoff) runs on its
            own within each country at the end of every season, so a rough season in Spain's top
            flight doesn't touch any other country's tables. Standings, Awards, and Stat Leaders each have a competition dropdown,
            grouped by country, so you can browse any of the 36 leagues. It defaults to
            whichever one your own club is currently in.
          </p>
          <p>
            <strong>Shaping your own world.</strong> The twelve countries above are the default, not
            the only option. The <strong>World setup</strong> panel on the New League screen lets you
            switch any of them off and add leagues of your own. An added league's clubs get
            generated names and colours, since the game ships no real clubs. The panel is on both
            ways in, whether you started a plain new league or came through Import Custom League.
          </p>
          <p>
            It starts closed, with a one-line summary of the world you'd get — how many countries,
            divisions and clubs — so you can take the default without scrolling past a dozen rows
            of countries you weren't going to change. Hit <strong>Customize</strong> on it to open
            it up. If you loaded a roster file it opens on its own, because adding or renaming a
            league in there is usually the thing that makes your file apply.
          </p>
          <p>
            <strong>Every setting works on the countries the game ships, too.</strong> Hit{" "}
            <strong>Customize</strong> beside England, Spain, Turkey or any of the others and you
            get the same panel a league you added gets: names, strength, money, shape, promotion,
            continental places, who it produces, and a roster import of its own. So you can make
            Portugal a big-four league, shrink Belgium to twelve clubs, seal off Germany's second
            division, or hand Turkey your own thirty-six clubs, without having to switch the
            country off and rebuild it from scratch. Everything you leave alone keeps exactly the
            values that country has always had.
          </p>
          <p>
            The one thing you can't change on a shipped country is its <em>name</em>, because its
            clubs, its flag and its player nationalities all hang off it. If you want a country the
            game doesn't have, switch one off and add your own — that's what adding is for.
          </p>
          <p>
            <strong>Naming the leagues.</strong> Every league has a name of its own, and you can
            change it. There's a box per division — three of them for the countries that ship with
            three — and they're the first thing in the panel, on shipped countries and added ones
            alike. Leave one empty and it goes back to following the country's name.
          </p>
          <p>
            <strong>Renaming won't break a roster file.</strong> A world-wide roster file names the
            competition it fills, but the name isn't the only thing it's found by: if the name
            doesn't match anything, the game reads it as the country and division it describes and
            looks there instead. So a file written for "English Division 1" still fills your top
            flight after you've renamed it to the Premier League, and the real-rosters download
            keeps working however much of the world you've renamed. Countries can't be renamed on
            shipped leagues, which is what makes that reliable.
          </p>
          <p>
            The name still does real work in the other direction: a file written for a league this
            world doesn't have — the Eredivisie, say, if you've switched the Netherlands off —
            fills nothing until you rename a league to it or add one and name it. The Import Custom
            League screen tells you which of your file's leagues it couldn't place, and World setup
            sits directly underneath so you can fix it and watch the count of matched clubs change.
            If two divisions end up with the same name the panel warns you, because a file aimed at
            that name can only fill one.
          </p>
          <p>
            You also choose a league's <strong>shape</strong>: one division or two, how many clubs
            are in each, and how many go up and down between them. Two divisions is the default and works
            like every shipped country, three up and three down, but that number is yours to set:
            anything from none at all up to six, capped at half the division so promoting six out
            of eight clubs isn't on offer. Pick <strong>None</strong> and the two divisions are
            sealed off from each other, so winning the second one keeps you in it. One division
            means exactly that, and nothing is promoted or relegated there at all. Divisions run from 8 to 20 clubs, in even numbers, because the
            fixture list pairs clubs off each round and the season is a fixed 38-matchday calendar
            that a 20-club double round robin already fills exactly. A smaller division plays fewer
            games, spread across the same season with blank matchdays in between, so its run-in
            still lines up with everyone else's and the transfer deadline still falls mid-season
            for it. Three divisions isn't offered.
          </p>
          <p>
            Every league carries more settings. <strong>Strength</strong> runs 0 to
            20 and higher is stronger, with <strong>20</strong> level with England, Spain, Italy
            and Germany. Each point below that costs a league about 1 OVR across its squads, so at{" "}
            <strong>15</strong> (where France sits) its champion is about as good as England's
            5th-best club, at <strong>10</strong> (Portugal) about the 12th, and at{" "}
            <strong>2</strong> its champion is weaker than England's worst club. The panel shows a
            table of where every shipped league sits so you have something to aim at.{" "}
            <strong>Money</strong> is what its clubs earn and can bank, against 1 for the richest
            leagues. And you set how many places it sends to the{" "}
            <a href="#cup">Continental Cup</a> and the <a href="#shield">Continental Shield</a>.
            Every league holds its level for the life of the save, shipped or added. Note the
            places move with the strength you set: drag a big-four league below 20 and it starts
            sending a weak league's two clubs to the Cup rather than four, which changes the size
            of the field. The panel warns you if the total stops adding up.
          </p>
          <p>
            Money is tied to strength by default and you should think twice before unlinking it. A
            weak league with big money climbs the pecking order over a long save until it finishes
            above leagues it generated well below, which is usually not what you were going for. The
            panel warns you when your settings would do that.
          </p>
          <p>
            <strong>Bringing your own clubs to one league.</strong> Every league has an
            <strong> Import roster</strong> button of its own. It takes the same roster files the
            world-wide import takes, but it applies them to that one league, and it ignores what
            the file calls its competitions: the file's first competition fills the league's top
            division, the second fills its second division, and anything past that is skipped with
            a note. That means a file someone wrote for an entirely different world still works,
            since the league you're dropping it into didn't exist when the file was written. Clubs
            land on slots in order, and any slot the file doesn't cover keeps the invented club it
            was given. The league's name decides its division names, so renaming it after loading a
            file is fine.
          </p>
          <p>
            Continental places can't overlap however you set them: the Shield always starts at the
            place directly below the Cup's last one in that same league. If a league sends 1 to the
            Cup and 3 to the Shield, that's its champion in the Cup and 2nd through 4th in the
            Shield.
          </p>
          <p>
            <strong>Giving a league places doesn't take them off anybody, unless the total comes out
            wrong.</strong> Each league keeps its own allowance and the field grows to fit. But a
            competition can only be played at certain field sizes, going up in fours from twelve, so
            if your world's leagues ask for a total in between, the field is cut back to the size
            below and the lowest-placed qualifiers <em>in the world</em> miss out.
          </p>
          <p>
            That's worth understanding because the cost doesn't land on the league that caused it.
            Add a ninth league taking 2 Cup places and the world asks for 26, which isn't a size the
            Cup can play, so it fields 24 and two clubs are cut. Your new league keeps both of its
            places, since its champion and runner-up outrank every 4th-placed club anywhere; it's two
            of the big four that lose a place. Which two comes down to who finished worst that
            season, so it moves around from year to year.
          </p>
          <p>
            The Shield counts its own total the same way, and it's the one that catches people out.
            Every league sends it 2, so any ninth league takes it from 16 to 18 and trims two clubs
            no matter what you did with the Cup. Switching a shipped country off keeps both totals
            clean, and so does giving your league 4 Cup places instead of 2. The panel warns you
            about each competition separately and tells you how many clubs a bad total would cost.
          </p>
          <p>
            <strong>Where its players come from.</strong> A league you add has its own
            nationalities panel: name the nations you want and give each one a number. The numbers
            are relative, so you can type percentages, squad counts, or anything else you find
            easier — the share shown beside each row is what you'll actually get, which matters
            because a real league's published breakdown usually adds up to more than 100 and would
            otherwise quietly hand you a smaller home share than it says.
          </p>
          <p>
            This isn't only about the squads you start with. Every youth intake the league produces
            for the rest of the save is drawn from the same mix, so a league you set up as Dutch
            keeps bringing through Dutch teenagers in season forty. Nationality also picks a
            player's name, so it's what makes an invented league read as somewhere in particular
            rather than as a pile of random surnames.
          </p>
          <p>
            <strong>Rest of the world</strong> is a single row standing for everyone you didn't
            name, and it's worth knowing that it leans English — it's built from how often each
            nation turns up in English football, which is where those numbers came from. The panel
            shows you the countries it'll mostly produce. If you want a league that genuinely isn't
            English, name the nations you want rather than leaning on that row. Leave the panel
            alone entirely and the league is all rest-of-the-world, which is what leagues you added
            used to be before this panel existed.
          </p>
          <p>
            There are 211 nations to choose from, which is every country that plays international
            football. So a league can be Taiwanese, Icelandic, Haitian, Nepalese or Samoan, not just
            European, and every one of them brings its own pool of about three thousand names rather
            than borrowing somebody else's. About half of them have no flag art and show a plain
            swatch next to the name instead, which is deliberate: those flags are Arabic script, a
            coat of arms or a dragon, and a wrong flag reads worse than none.
          </p>
          <p>
            A roster file can carry the mix too, as a <code>nationalities</code> block. Loading one
            fills the panel in for you, and you can still change it afterwards. The shipped
            countries aren't editable — they keep the real breakdowns they were built from.
          </p>
          <p>
            <strong>Naming the clubs.</strong> Tick <strong>Name the clubs yourself</strong> before
            you start and you get an editor once the world is built, listing every club in every
            competition with its name, its three-letter abbreviation and both of its colours. It
            covers leagues you invented as well as the shipped ones, and nothing is written to disk
            until you're finished, so you can back out. The same editor is on the Leagues page as
            Customize Teams if you'd rather come at it that way, and you can still rename any club
            later from there.
          </p>
          <p className="text-muted small">
            World setup only applies when you create a save. There's no mid-save world expansion, and
            saves created before it shipped keep whatever countries they were made with.
          </p>
        </Section>

        <Section id="cup" title="The Continental Cup">
          <p>
            The Continental Cup is a 32-club competition played alongside the league season.
            Qualification is purely about <strong>league position</strong>, not squad quality. The
            top four clubs in each of the four strongest top-flight leagues (England, Spain, Italy and
            Germany) get in, plus the top two from each of the eight weaker leagues. That's
            4×4 + 8×2 = 32 clubs. On
            the <a href="#pages">Standings</a> page the qualifying places are shaded as the
            qualification zone (top four in a strong league, top two in a weak one).
          </p>
          <p>
            <strong>How many places your country gets is earned, not fixed.</strong> Every season
            the Cup&apos;s 32 places are handed out in order of a{" "}
            <strong>country coefficient</strong>: a rolling record, over the last five seasons, of
            how that country&apos;s clubs have actually done in Europe. Winning matches counts,
            going deep counts for more, and it&apos;s divided by how many clubs the country sent, so
            sending four clubs isn&apos;t worth anything by itself. Both competitions count toward
            it. If your league&apos;s clubs keep going out in the league phase for years, it will
            send fewer; if they keep winning things, it will send more, and England has no special
            protection.
          </p>
          <p>
            The places are only ever <strong>moved between countries, never created</strong>. The
            competition always fields exactly 32 clubs, so for one country to gain a place another
            has to lose one. Nobody can be reduced below a single place, because a country with no
            clubs in Europe would have no way to earn its way back. Five seasons is a long window on
            purpose: a place should take years of results to move, not one bad year. You can see
            where every country stands on the <a href="#cup">Continental Cup</a> page.
          </p>
          <p>
            If you'd rather the places never moved, there's a checkbox for it on the New League
            screen: turn <strong>&quot;Cup places can move between countries&quot;</strong> off and
            every country keeps the number it started with forever, however its clubs do in Europe.
            It's fixed for the life of the save, same as difficulty, and with it off the coefficient
            table doesn't appear on the Cup page at all. Saves made before the setting existed have
            it on.
          </p>
          <p>
            League position is the usual way in, but not the only one.{" "}
            <strong>The holders keep their place.</strong> Win the Continental Cup and you're in it
            again next season wherever you finish, and win the{" "}
            <a href="#shield">Continental Shield</a> and you're promoted into the Cup. If you'd have
            qualified through your league anyway, nothing changes and your league keeps all its
            places. If you wouldn't have, you take the lowest of your league's Cup places, and the
            club who held it drops into the Shield rather than out of Europe. The field is always 32
            clubs, so a place is never created, only moved.
          </p>
          <p>
            It opens with a <strong>league phase</strong>: all 32 clubs sit in one combined table and
            each plays <strong>six games</strong> against six different opponents. The draw isn't
            random. The field is split into a stronger half and a weaker half, and everyone plays
            three from each half, so no club draws six giants or six minnows. You never play a club
            from your own league. Home and away are evenly split, and you play once per league-phase
            round (on matchdays 3, 7, 11, 15, 19 and 23).
          </p>
          <p>
            When the six rounds are done, the table splits three ways. The <strong>top four</strong>{" "}
            go straight to the quarter-finals. Clubs ranked <strong>5th to 12th</strong> drop into a
            single-leg <strong>playoff round</strong> (matchday 27) and the four winners take the last
            four quarter-final places. Clubs finishing <strong>13th to 32nd</strong> are knocked out.
            From there it's a straight knockout: quarter-finals, semi-finals and final.
          </p>
          <p>
            Those cut lines move if the competition is smaller, because what goes through is{" "}
            <strong>half the field</strong>, up to a maximum of twelve. Both competitions here are
            big enough to hit that maximum, so both send twelve through and nothing about them has
            changed. Shrink one below 24 clubs and it starts sending fewer: a 20-club competition
            puts ten through, and a 16-club one puts eight through with no playoff round at all,
            since eight is already a full quarter-final bracket. You'll only see this if you build
            your own world. The key under the league-phase table always names the actual numbers.
          </p>
          <p>
            The <strong>quarter-finals and semi-finals are two-legged</strong>: each side hosts once,
            on <strong>separate matchdays</strong> (first leg then second leg), and the tie is decided
            on the <strong>aggregate</strong> (both clubs' goals across the two games added up). Two
            matches instead of one, with home advantage cancelling out, let the stronger squad's
            quality actually come through, so cup runs track how good you really are far more than a
            single-game coin flip did. The QF legs are on matchdays 29 and 31, the semis on 33 and 35,
            and the <strong>final is a single match</strong> on matchday 37 at a neutral venue. The
            league-phase <strong>playoff (matchday 27) stays single-leg</strong> too. Your cup
            fixtures show up on your <strong>Schedule</strong> page alongside your league games.
          </p>
          <p className="text-muted small">
            This is deliberately a fairer road in for France and Portugal than a one-off qualifier
            would be: their clubs get in with more places, are guaranteed six games, and only need a
            mid-table league-phase finish to reach the playoff. That said, don't expect miracles.
            The cup reads a weak-league side as genuinely weaker than a big-four side with the same
            league position, not as an equal, so those clubs go in as underdogs and usually have to
            scrap for a playoff spot.
          </p>
          <p>
            Since qualification comes off a finished table, the cup runs a season behind. The first
            Continental Cup is in your world's <strong>second season</strong>, seeded from season
            one's final tables. Season one has no cup.
          </p>
          <p>
            A tie level after its full running time (90 minutes for single-leg ties, or level on
            aggregate after both legs of a two-legged one) goes to extra time, then a penalty shootout
            if it's still level, so every knockout tie ends with a winner (league-phase games can just
            be draws). The league phase and bracket play automatically as the season reaches them, and
            the <strong>Continental Cup</strong> page shows the live table and bracket with your club
            highlighted; each two-legged tie lists both leg scores beneath it.
          </p>
          <p>
            Prize money is real, it's paid as you go, and the biggest single cheque is for{" "}
            <strong>getting there at all</strong>. Qualifying for the league phase banks $10M on its
            own, half of what finishing in the top quarter of your league pays, and it lands whether
            you go on to win a game or not. After that every league-phase result is worth
            money too: $1.5M for a win, $500k each for a draw. Six games, six chances to earn.
          </p>
          <p>
            Going deep pays more on top. A playoff win is $3M, the quarter-final $6M, the semi-final
            $9M, and lifting the trophy $14M, with $5M for losing the final. Win the lot from the
            playoff round and you'll clear $40M across the campaign. That shape is deliberate, and
            it's the one real continental football has: simply being in it is transformative,
            especially for a club from a smaller league, and a deep run is a bonus rather than the
            only thing worth having. Qualifying is a season's work and it's paid like one.
          </p>
          <p>
            Cup matches are their own thing. Goals, assists and appearances there are tracked{" "}
            <strong>separately</strong> from your league stats (they don't feed Stat Leaders, the
            end-of-season awards, or player development). You'll find a club's cup record under the{" "}
            <strong>Cup</strong> tab on any <a href="#players">player's profile</a>. That tab is a
            little thinner than the league one &mdash; no xG, passing or cards &mdash; because cup
            matches have always been stored as a summary rather than a full stat line, and the older
            seasons can't be filled in after the fact. Average match rating is there, though, and
            it's the one number in the game you can compare straight across leagues: cup ratings are
            judged against the whole field rather than against a player's own division.
          </p>
          <p>
            One handy thing: if your club reaches the final, simming to the end of the season{" "}
            <strong>stops just before the final</strong> so you don't blow past it. Check your
            lineup, then sim on to play it.
          </p>
        </Section>

        <Section id="shield" title="The Continental Shield">
          <p>
            The Continental Shield is the second competition, for the clubs that just miss out on the
            Continental Cup. It takes the places directly below the Cup's: <strong>5th and 6th</strong>{" "}
            in each of the four strongest leagues, and <strong>3rd and 4th</strong> in each of the eight
            weaker ones. That's 12 × 2 = <strong>24 clubs</strong>, and because it starts exactly where
            the Cup stops, no club is ever in both. On the <a href="#pages">Standings</a> page the
            Shield places get their own shaded band directly under the Cup's.
          </p>
          <p>
            There's one more way in, and it's the interesting one:{" "}
            <strong>your country's domestic cup winner gets a Shield place</strong>. Win your{" "}
            <a href="#domestic-cup">domestic cup</a> and you're in Europe next season however badly
            your league campaign went. He takes the lowest of his league's Shield places, so the
            field is still 24 and it's your league's 6th-placed club who makes way, not your 5th.
            Most years this changes nothing, because the club who wins the cup has usually finished
            high enough to qualify anyway — and when that happens the place just passes back down
            the table.
          </p>
          <p>
            The domestic cups are contested by both divisions, so a{" "}
            <strong>second-division club really can win one and go into the Shield</strong>. He goes
            in as the bottom seed, because a good finish in the second division isn't the same thing
            as a good finish in the top one, and he'll be kept apart from his own country's clubs in
            the draw like anyone else. It doesn't happen often. It's worth watching when it does.
          </p>
          <p>
            Because all of this is settled at the end of the season, the shading on the Standings
            table is a live projection: it shows where each club would go if the season ended today,
            and it can move when a cup final is played. A club shaded from mid-table is there on one
            of these routes — hover the bar and it tells you which.
          </p>
          <p>
            It runs exactly like the Cup: a 24-club league phase of six games, then the top four go
            straight to the quarter-finals, 5th to 12th fight through a single-leg playoff, and the
            rest go out. Quarter-finals and semi-finals are two-legged, the final is one match.
            It uses the <strong>same matchdays</strong> as the Cup, which is fine because no club
            plays in both. Like the Cup it starts in your world's second season, and if your club
            reaches the final the sim stops just before it.
          </p>
          <p>
            The money is real but smaller, at roughly <strong>40%</strong> of the Cup's rates, and
            it's front-loaded the same way: $4M for qualifying, $600k a win and $200k a draw in the
            league phase, then $1.5M for a playoff win and $2.5M / $3.5M / $5.5M through the
            knockout. Winning the whole thing is worth about what a decent cup run is, not what
            winning the Cup is. That's the point of it: finishing 5th now has something to play for,
            and a mid-table club can put a trophy in the cabinet, without it ever rivalling the Cup.
          </p>
          <p>
            Shield stats are tracked the same way cup stats are, separately from your league season,
            and they show up on the same <strong>Cup</strong> tab of a{" "}
            <a href="#players">player's profile</a> with a column saying which competition each row
            is. Shield titles show on a club's trophy case and count on the all-time boards, weighted
            below a Continental Cup, and a winner's players get a Shield pill on their profile
            alongside their other honours. They don't currently feed the Ballon d'Or. Winning it is
            also not part of the <a href="#domestic-cup">treble</a>: that's the league, the
            Continental Cup and your domestic cup, and the Shield is what you win instead of the
            Cup rather than alongside it.
          </p>
        </Section>

        <Section id="domestic-cup" title="The Domestic Cup">
          <p>
            Every country also runs its own cup, and this one is open to{" "}
            <strong>every division</strong>, top flight to third tier together, which in England is
            60 clubs. It's the trophy that lets a small club have the season of its life, and
            it's the third leg of the <strong>treble</strong>: win your league, the Continental Cup
            and your domestic cup in the same season and you've done the lot.
          </p>
          <p>
            Winning it also gets you into Europe. Your country's cup winner takes a{" "}
            <a href="#shield">Continental Shield</a> place next season, whatever he did in the
            league, including a club from the second or third division, who goes in as a bottom
            seed. See{" "}
            <a href="#shield">The Continental Shield</a> for who makes way.
          </p>
          <p>
            There is no seeding and no bracket. Every round is an <strong>open draw</strong>: the
            clubs still standing go back in the hat, get paired at random, and the club drawn first
            plays at home. You find out who you've got when the previous round finishes, exactly
            once. The two best clubs in the country can meet in round one, and often do.
          </p>
          <p>
            A country's club count doesn't divide neatly into a knockout, so the{" "}
            <strong>lowest-placed clubs</strong> from last season play a preliminary round first
            (matchday 5) and the winners join everyone else for a round of 32 (matchday 9). Then
            it's a round of 16 (13), quarter-finals (21), semi-finals (26) and the{" "}
            <strong>final on matchday 36</strong>. A country with fewer clubs simply skips the
            early rounds, so every final lands on the same day. None of those clash with a
            Continental Cup matchday, and your cup fixtures appear on your{" "}
            <strong>Schedule</strong> page.
          </p>
          <p>
            Every tie is a <strong>single match</strong>. Level after 90 minutes goes to extra time,
            and still level goes to penalties, so somebody always goes through on the day. A
            lower-division club really can knock you out: the cup measures every division against{" "}
            <strong>one shared yardstick</strong> rather than grading each club against its own
            league, so the gap between a top-flight side and a third-tier one is real, but it's a
            gap, not a wall, and over one match anything can happen.
          </p>
          <p>
            Cup stats are tracked separately from your league stats, under the{" "}
            <strong>Domestic Cup</strong> tab on a player's profile. And as with the Continental
            Cup, if you reach the final the sim <strong>stops just before it</strong> so you can
            take a look at your lineup first.
          </p>
          <p>
            The cup pays, and it's built for the smaller clubs. Every round you win is worth money,
            from $90k for a preliminary tie up to $1.5M for lifting it, with $700k for losing the
            final. That's deliberately modest: a full run to the trophy is about $3.3M, well under a
            top-half league finish, because a real domestic cup is a useful season's bonus rather
            than a jackpot.
          </p>
          <p>
            The part that matters if you're below the top flight is the{" "}
            <strong>glamour tie</strong>. Draw a club from a higher division and you bank an extra{" "}
            <strong>$300k per division between you</strong>, whatever the score, win or lose,
            because a full house and the cameras are worth more to you than the tie itself. So a
            second-tier club drawing the top flight gets $300k, and a third-tier club drawing them
            gets <strong>$600k</strong>. It's the one payment in the game that only goes to the
            smaller club.
          </p>
          <p>
            That's what makes a cup run worth chasing from the lower divisions. It won't make you
            rich: a typical run is worth about <strong>1%</strong> of your season, and the top flight
            still collects a bit more cup money per club than you do, because they're the ones who
            go deep. What it does is spread the money around instead of handing it all to one club —
            roughly <strong>300</strong> clubs below the top flight bank something from the cup every
            season. A deep run in a smaller country is worth far more than that, up to a quarter of
            your year if you go all the way.
          </p>
          <p>
            Every payment here is scaled to your country, so an English cup run pays more than a
            Serbian one, but it is <strong>not</strong> scaled down for being in a lower division.
            You get the same cheque for the same round a top-flight club would, which is how the
            real ones work, and it's worth far more to you than it is to them.
          </p>
          <p>
            And the biggest prize still isn't the money. Winning the thing puts you in Europe, and a
            Shield place is worth several times the trophy's own cheque. A lower-division club
            really can win it and go: for one of those, the European place alone can be worth a
            fifth of a season's income.
          </p>
          <p className="text-muted small">
            Saves started before domestic cups existed pick them up at the next offseason, so
            there's one season without one. New saves have a cup from season one, since nothing has
            to qualify for it.
          </p>
        </Section>

        <Section id="champions-cups" title="The Champions Cups">
          <p>
            Your season doesn't open with a league game. It opens with the{" "}
            <strong>champions cups</strong>, played in the preseason before anyone has a point on
            the board, the way the Community Shield and the UEFA Super Cup are.
          </p>
          <p>
            There's one in <strong>every country</strong>: your league champions against your{" "}
            <a href="#domestic-cup">domestic cup</a> winners. If the same club won both, the{" "}
            <strong>league runners-up</strong> take the other place, because a club can't play
            itself. And there's one more on top of those, the only match of the year between the
            two continental competitions: the <a href="#cup">Continental Cup</a> winners against
            the <a href="#shield">Continental Shield</a> winners.
          </p>
          <p>
            They're <strong>one-off matches at a neutral ground</strong>, so nobody has home
            advantage and there's no second leg to put a bad night right. Level after 90 minutes
            goes to extra time and then penalties. You'll find them all on the{" "}
            <strong>Champions Cups</strong> page, with a dropdown for past seasons, and a win shows
            up in your club's trophy cabinet on <strong>Club History</strong>.
          </p>
          <p>
            Because they're played before the first matchday, they use the squad you have{" "}
            <em>then</em> — so anyone you sign in the summer can play in yours, and anyone you sell
            can't. You can play them from your dashboard when the season opens. If you'd rather not
            stop for it, just sim as normal and they'll be played on the way into the season.
          </p>
          <p className="text-muted small">
            Like the domestic cup, a champions cup <strong>pays no prize money</strong>, and for
            the same reason: I measured what handing the domestic cup real payouts did to a
            20-season dynasty and it pushed two of four test worlds' poorest clubs into the red.
            A one-off match crediting the same clubs would do the same thing, so it's a trophy and
            bragging rights and nothing else. It also means the competition can't disturb anything
            — I've got a test that plays a season with the champions cups and a season without and
            checks the two come out identical down to the last scoreline.
          </p>
          <p className="text-muted small">
            There's nothing to contest in season one, since nobody has won anything yet, so your
            first champions cups are at the start of season two. Older saves pick them up at their
            next offseason the same way.
          </p>
        </Section>

        <Section id="international" title="International Football">
          <p>
            Your players also represent their countries. National teams play in the summer, on a
            four-year cycle: there's a <strong>World Cup</strong> every fourth season, and the three
            offseasons leading up to it each run a round of <strong>qualifying</strong>. Halfway
            between one World Cup and the next, the same summer as that year's qualifying, the{" "}
            <strong>confederation cups</strong> are played: the European Championship, Copa
            América and the Africa Cup of Nations. Nothing about any of it touches your league
            calendar; it all happens between seasons, and the <strong>National Teams</strong> pages
            are where you follow it.
          </p>
          <p>
            You play it out yourself, a stage at a time. When you reach the offseason, the Dashboard
            hands you the buttons: in a qualifying year you play that year's round of qualifying (one
            of three); in a World Cup year you play the group stage, then the quarter-finals, then
            the semis, then the final, one click each, so you can watch it unfold. A confederation
            cup summer works the same way, except every cup is played side by side: one click
            for all their group stages, then a click per knockout round, and because a smaller
            tournament waits for a bigger one to catch up, every final lands on the same click. If
            you'd rather not linger, "Sim through the World Cup" (or "the cups") plays the
            rest in one go and leaves you on the Dashboard to read the results. And if you don't
            care for it at all, the skip button takes you straight to the offseason. Skipping doesn't cancel
            anything: the games are still played as you advance, on exactly the same results they'd
            have had, and they're waiting on the National Teams pages afterwards.
          </p>
          <p>
            Every nation with enough players in the world enters qualifying. They're split into
            groups by confederation and play a long home-and-away campaign spread over the three
            qualifying offseasons, and the number of places each confederation gets depends on how
            many genuinely strong nations it has, so the 32 who make it are a believable field rather
            than whoever happens to be nearby. At the
            tournament those 32 are drawn into eight groups of four; the top two from each go through
            to a round of 16, then quarter-finals, semi-finals and a final. Knockout ties level after
            extra time go to a shootout, exactly like the Continental Cup.
          </p>
          <p>
            How many go through from any one qualifying group isn't fixed. Every group winner
            qualifies, and then the runners-up from all of that confederation's groups are ranked
            against each other for whatever places are left, so a strong runner-up can go through
            while a weaker one in the next group misses out. Both the confederation's share of the
            32 places and the groups it plays in are settled the moment the campaign is drawn, three
            offseasons before the last round is played, so the Qualifying page tells you what each
            confederation is playing for from the start. In the tables, a solid bar down the left
            marks a place that qualifies outright and a fainter one marks a place that's in the
            running for whatever's left.
          </p>
          <p>
            A 32-nation field is most of the nations that can field a squad at all, so several
            confederations now send everyone they have and play no qualifying matches. They're still
            listed on the Qualifying page, with a line saying everyone's through instead of a table.
            The contest is in Europe and Africa, where there are more nations than places. If you'd
            rather qualifying meant more everywhere, the fix is a deeper world: more countries with
            leagues means more nations with enough players to enter.
          </p>
          <p>
            The <strong>confederation cups</strong> have no qualifying of their own: each
            confederation simply takes its strongest nations at the time of the draw, which is the
            order you see on Power Rankings. How big a cup is depends on how much football
            its continent has — Europe fills a sixteen-nation field with four groups and a
            quarter-final, while a confederation with only a handful of real football nations plays
            a single group and sends its top two straight to the final. A confederation that can't
            field even four nations doesn't hold one at all, which is why you'll usually see the
            Euro, Copa América and AFCON and not the others: nearly every player in the world is
            born into one of the twelve countries whose leagues you play in, so the rest of the world
            is thin. Fill it out — with an imported roster, say — and those cups start
            being played on their own.
          </p>
          <p>
            <strong>You can manage one of these countries yourself.</strong> Pick one when you
            start a save — there's a National team box under Difficulty — or leave it alone and
            wait, because federations get in touch over the summer and anything on the table shows
            up on the <strong>Federation</strong> page. Managing a country is entirely optional,
            and plenty of good saves never bother. Every nation you don't manage picks itself:
            its best available players in the strongest shape it can field.
          </p>
          <p>
            What you actually control is the squad and the team, and they're two pages. When a
            campaign is drawn, at the end of a season, a squad of 23 is named for you.{" "}
            <strong>Player Pool</strong> is where you change who's in it — everyone born in your
            country is eligible, whoever they play for, so you can call anyone up and drop anyone
            you don't fancy. <strong>My Squad</strong> is where you pick the shape and drag your
            eleven around, exactly as you do on your club's Roster page. Both are open until the
            first match, and you can change the eleven again between rounds. Two
            rules the game keeps for you: you have to take at least one goalkeeper, and only a
            goalkeeper can go in goal. If anyone in the eleven you picked can't play on the day,
            because he got hurt or retired since you named him, the game picks that whole eleven
            for you rather than field ten. It won't leave you a man short, but it does mean a
            lineup you set two seasons ago can quietly stop being the one that gets used, so look
            in between rounds.
          </p>
          <p>
            You don't get a transfer market, a budget or any say in training — a national manager
            picks from who exists, and that's the whole job. One consequence worth knowing: a squad
            is chosen from the ratings and injuries your players finished the club season with, so
            a star who ends the year injured really does miss the tournament. The whole thing also
            plays out before anyone retires, so a veteran in his final season gets one last crack
            at it.
          </p>
          <p>
            The federation judges you once per campaign, not once per season — after qualifying
            ends, after a World Cup, after a continental championship. They compare how far you got
            with how good your players are, which is a bar you genuinely cannot move: it's read off
            your country's best available eleven, not the squad you named, so leaving your stars at
            home lowers nothing except your chances. Qualifying is the campaign that can really
            hurt you. If you were expected to make the finals and you don't, that's the worst thing
            that can happen to an international manager; if nobody expected you and you get there
            anyway, it's the best. Winning a World Cup buys you years. Confidence works exactly
            like the club version, including the "Never sack me" switch, and there's one important
            difference: being let go by a country is a perfectly ordinary place to end up. You just
            go back to club football until someone else asks.
          </p>
          <p>
            Offers from other federations work the same way club offers do, but on a
            <em>separate</em> reputation built only from what you've done with a country. While you
            hold a job you'll only hear from nations at roughly your own level or better, and your
            international record is what lifts that level. With no country at all the filter comes
            off entirely and approaches arrive far more readily, because that's the only way back
            in. Approaches are rarer at the top: manage one of the best teams in the world and only
            a handful of jobs are even a sideways move, so it might be a few summers between calls.
          </p>
          <p>
            Your club career isn't invisible to federations, but they discount it heavily. A big
            trophy cabinet at club level gets you noticed by a decent country &mdash; somewhere
            around the top quarter of the world, roughly the level of Wales or Serbia &mdash; and
            never by one of the giants. It starts to count once your club reputation is up around
            the high 40s, which is about one league title. The best national jobs stay behind an
            international reputation you can only earn in the job, so the way to Spain or Brazil is
            still to take a smaller country first and do well with it.
          </p>
          <p>
            International football is mostly a record, not a lever. Caps, goals, tournaments played
            and titles won show up on a player's profile and build over his career — confederation
            cups are counted separately from World Cups, so winning the Euro doesn't read
            as winning the World Cup — and the{" "}
            <strong>National Team</strong> tab on his stats card breaks them down campaign by
            campaign, the same way his league and cup seasons are listed. None of it feeds his
            development or his value. There's one real cost, though: if a player gets hurt
            at a tournament, part of the recovery happens over the summer, but a serious injury
            still carries into the new club season and he'll miss its opening weeks (a minor knock
            heals in time). Beyond that it's there to give your players a story beyond your club, and
            to see a golden generation announce itself.
          </p>
          <p>
            You can browse all of it in the <strong>National Teams</strong> section.{" "}
            <strong>Player Pool</strong> is where you decide who's in your country's squad and{" "}
            <strong>My Squad</strong> is where you pick the eleven, while{" "}
            <strong>Federation</strong> is the international half of your career: how they rate
            you, what they made of the last campaign, which other countries have been in touch,
            and every job you've held. The World Cup,
            Qualifying and Confederation Cups tabs show the current campaign and let you flip back to
            past years (Confederation Cups shows every cup of a given summer on one page);
            Rosters shows the squad every nation has named for the campaign being played, with the
            eleven it would field highlighted; Schedule lists the fixtures for whatever's being
            played, opening on the qualifying round currently being played (a whole campaign at once
            is hundreds of games, but "All rounds" is there if you want it); Power Rankings sorts every
            nation by squad strength, with movement since last time; Stat Leaders has both the most
            successful nations and the top individual players, which you can filter to a single
            country; and History keeps the roll of past winners plus each nation's tally of titles,
            finals and best finishes. Past editions keep their results and standings, though not the
            match-by-match detail of the current one.
          </p>
        </Section>

        <Section id="players" title="Players: Ratings, OVR & Potential">
          <p>Every player plays one of eight positions:</p>
          <p>
            <strong>GK</strong> goalkeeper · <strong>CB</strong> center back · <strong>FB</strong> full
            back · <strong>DM</strong> defensive midfielder · <strong>CM</strong> central
            midfielder · <strong>AM</strong> attacking midfielder · <strong>W</strong> winger ·{" "}
            <strong>ST</strong> striker
          </p>
          <p>
            Under the hood, every player has 14 individual ratings on a 1&ndash;99 scale: four
            physical ones (speed, strength, stamina, jumping) and ten technical/mental ones (short
            passing, long passing, crossing, dribbling, long shots, finishing, tackling,
            interceptions, positioning, goalkeeping).
          </p>
          <p>
            <strong>OVR</strong> is a position-weighted blend of those ratings. A striker's OVR
            leans on finishing and speed, a center back's on tackling, positioning, and strength.
            The scale is deliberately tight:
          </p>
          <ul>
            <li><strong>65</strong>. An average starter.</li>
            <li><strong>70</strong>. A good starter.</li>
            <li><strong>75</strong>. Usually a team's best player.</li>
            <li><strong>80&ndash;85</strong>. A league-wide elite player.</li>
            <li><strong>90+</strong>. A rare, generational outlier.</li>
          </ul>
          <p>
            <strong>An OVR means the same thing wherever a player plays.</strong> The weights are
            different for every position, but the scale they land on isn't: a 78 full back is exactly
            as rare as a 78 striker, and every position has the same shot at producing your club's
            best player. That's worth saying out loud because it used to be false. A position whose
            rating leaned hardest on the handful of skills it's generated best at read several points
            high, so strikers and keepers filled the top of every list and full backs and central
            midfielders almost never did.
          </p>
          <p>
            <strong>Potential is a scout's guess, not a promise.</strong> The game simulates a
            player's future career a bunch of times and reports the 75th percentile of those peaks,
            so roughly three players in four never quite reach their listed potential, and one in
            four meets or beats it. And here's the important bit: potential has <em>zero</em> effect
            on how a player actually develops. It's a forecast of the development model, not an input
            to it. It also gets re-estimated as the player ages, so it drifts toward his current OVR
            over time.
          </p>
          <p>
            <strong>You don't see a player's exact potential. You see a scouting estimate.</strong>{" "}
            Everywhere POT shows up (Roster, prospects, free agents, transfer targets, rival squads,
            player profiles), it's a low&ndash;high band rather than a single number, and the real
            value always sits somewhere inside that band. Two things tighten the band toward the
            exact figure. First, your <a href="#finance">scouting spend</a>: more scouting means a
            tighter estimate right away. Second, time on your own senior roster: a player you own
            sharpens up on his own over about two to three seasons until his POT is fully known
            (more scouting spend gets you there faster). Prospects, free agents, and other clubs'
            players are never on your roster, so they stay at their foggiest until you scout harder
            or just sign them. Current OVR and individual attribute ratings are always exact. Only
            potential is fogged.
          </p>
          <p>
            <strong>Team OVR and POT</strong> (shown on Standings and at the top of your Roster
            page) aren't a plain average of the whole squad. Just like a genuinely deep squad beats
            a stacked XI with nothing behind it in real football, your starting XI counts in full,
            and each bench player behind them counts for less the further down the depth chart he
            sits. A deep, talented bench really does lift the number, and fringe reserves barely
            move it.
          </p>
        </Section>

        <Section id="development" title="Player Development & Aging">
          <p>
            Players develop each offseason based on age and randomness, and nothing else. The
            typical arc peaks around <strong>age 26</strong>, but not all of a player at once:
          </p>
          <ul>
            <li><strong>Physical ratings</strong> (speed, strength, stamina, jumping) peak earlier and go first. A 30-year-old winger loses his legs before he loses his touch.</li>
            <li><strong>Technical and mental ratings</strong> peak later and fade slower.</li>
            <li><strong>Goalkeepers</strong> age the best of anyone. Their careers routinely run deep into the 30s.</li>
          </ul>
          <p>
            Development is noisy, and way noisier when a player's young. An 18-year-old can jump
            several points in a season (or stall out completely), while a 30-year-old barely moves
            year to year, and mostly downhill. Playing time gives a growing player a little nudge:
            regular minutes help, rotting on the bench hurts a bit, but it never beats the age
            curve.
          </p>
          <p>
            Retirement comes down to two things: how old a player is, and whether anybody actually
            wanted him last season. Age does most of the work. Nobody with a club retires before 33,
            and from there it climbs every year, so even a great player eventually hangs them up.
            But holding a squad place knocks those odds down by about 40%, which is enough that a
            player good enough to keep his place can still be going at 39 or 40, while a fringe
            one his age is long gone. It's never a free pass, though. There's no age at which a
            still-brilliant veteran is safe.
          </p>
          <p>
            The other half is that players nobody signs drift out of the game, at any age. Go a
            full season unsigned and you start rolling to retire whether you're 19 or 35. Two things
            soften that. A contract simply running out doesn't count against you, so a player always
            gets one full free agency to find a club before it starts applying. And genuine young
            prospects are exempt: if a player is still in his early twenties and his ceiling is
            high, he sticks around waiting for his shot no matter how long he's been unsigned. That
            exemption is for prospects only, though. An unsigned 30-year-old is done regardless of
            how good he used to be.
          </p>
          <p>
            You get to see who went. The Season Preview lists the offseason's retirements: how many
            players called it a career, how many of those were on a club's books, and then the
            biggest names to go, with the club they last played for and what they did over their
            career. Anyone your own club loses is always on that list. It only covers the biggest
            names, though, because most of the players who retire in any given offseason are
            unsigned ones nobody would recognize.
          </p>
          <p>
            Who counts as a big name is settled by the same score the GOAT rankings use, not by the
            rating each player happened to retire at. That matters because great players leave the
            game on the way down: a twelve-year forward with three Ballon d'Ors bowing out at 71
            belongs above a journeyman who drifted out at 74, and the rating alone would tell you
            the opposite. So the list reads as a ranking of careers, trophies and all.
          </p>
          <p>
            The score itself is in the table, in the GOAT column, so you can see what separated
            them instead of taking the order on trust. It's a snapshot taken the summer each player
            went, and it counts the season he'd just finished, so a title won on the way out is on
            his record. Lists from before the game started recording it leave that column blank:
            those players are gone, and there's no career left to score.
          </p>
          <p>
            One thing to know: a retired player is gone from the game, not filed away somewhere.
            There's no career page to visit afterwards, and old transfer entries or news items about
            him lose his name. That Season Preview list is the record of his send-off.
          </p>
          <p>
            What this means for you day to day: the free agent and incoming talent lists churn.
            Journeymen you passed on won't sit there forever, so the bargain bin is thinner and
            older than it used to be. The genuinely promising kids stay put, so you're not on a
            clock with those.
          </p>
          <p>
            <strong>Generational talents.</strong> Development normally gets a lot harder the better
            a player already is, and that resistance is exactly what keeps the league's elite tier
            genuinely rare. But every once in a long while (think years, not seasons), a youth
            prospect shows up somewhere in the world who's just built different. That resistance
            barely applies to him, and he can genuinely climb to heights no ordinary player reaches.
            Nothing announces him, and no badge marks him out. The only tell is the one your scouts
            can actually earn: a potential estimate with a ceiling far beyond what any ordinary
            prospect shows. It's a trajectory, not a guarantee, and a rough run of seasons can still leave
            him merely very good, but these are the players your true legends come from. If one lands
            in <em>your</em> academy, treat him accordingly.
          </p>
        </Section>

        <Section id="matches" title="The Match Engine">
          <p>
            Matches are simulated event by event, and everything below shows up in the box score:
          </p>
          <ul>
            <li><strong>Who gets credited</strong>. Every event is pinned on a real player, picked from who's on the pitch using both his position and how good he is at that particular thing. Goals lean on finishing, assists on passing, tackles and interceptions on tackling and reading the game, corners on heading. Ability counts for a lot in that pick, so your best defender really does top your tackles chart and your playmaker really does rack up the assists, rather than them landing on whoever happened to be nearby. Fouls are the deliberate exception: they're spread by position and not sharpened by ability, because "best defender" and "most booked" shouldn't be the same list. Around a quarter of goals are scored with no assist at all.</li>
            <li><strong>Passes, crosses &amp; fouls</strong>. Every box score also carries per-player passing (completed / attempted), crosses, and fouls committed. Central and deep players move the ball most, wide players do most of the crossing. These are just stat-sheet detail, they don't change the scoreline.</li>
            <li><strong>Cards</strong>. Yellows, second yellows, and straight reds. Going a man down is a real hit to your side's strength for the rest of the match, and cards now carry a cost past the final whistle too &mdash; see Suspensions below.</li>
            <li><strong>Set pieces</strong>. Corners, and penalty kicks resolved as a duel between the taker and the keeper (saved, scored, or dragged wide).</li>
            <li><strong>Fatigue &amp; substitutions</strong>. Players tire as the match runs, and the coach makes subs around the 60th and 75th minutes, throwing on an attacker when chasing the game. Subs aren't automatic anymore: the coach weighs how good the fresh bench player is against the tired starter he'd replace, and also how that starter is actually playing on the day. A close-quality bench refreshes freely, but he won't pull a good starter for a much weaker reserve unless that starter is genuinely gassed, so a shallow bench leaves your tired legs on. A starter tearing the game up is harder to justify hooking than one having a stinker, even at the same fitness. The coach also cares where a replacement would have to play: he's filling a specific hole in the shape, so a bench striker who'd have to cover at centre-back has to be a lot better to be worth it, and if nobody on the bench fits, the tired starter stays on rather than the shape getting wrecked. The one exception is the chase-the-game sub late on when you're losing, where the coach deliberately changes shape instead, pulling a defender for an attacker who plays his own position. Your matches use the same in-match sub logic. You can also flag any bench player for <strong>More minutes</strong> on the Roster page, which tips the coach toward bringing him on more often.</li>
            <li><strong>Suspensions</strong>. Cards follow a player around. Pick up 5 yellows over the league season and he misses the next match; get sent off for a second yellow and he misses 1; get a straight red and he misses 3. If a sending-off and your fifth yellow land in the same game you serve the longer of the two, not both. Bans only cover league matches, so a suspended player is still available for the Continental Cup, and only league cards count toward them. He shows a red card marker on your Roster and his profile, your Dashboard lists everyone banned, and he's left out of your XI automatically until he's served it. Everything resets when the season does.</li>
            <li><strong>Injuries</strong>. A player can go down mid-match and miss 1&ndash;6 matches. Recovery ticks down as you sim, and he comes back on his own. While he's hurt he shows a red cross on your Roster (both the pitch and the tables) and on his profile, and your Dashboard lists everyone currently sidelined. He's automatically left out of your XI until he's fit.</li>
            <li><strong>Stoppage time</strong>. Scaled to how eventful the half was.</li>
          </ul>
          <p>
            When the XI changes mid-match (a sub, a red card, an injury), the team's effective
            strength is recalculated from who's actually on the pitch, so losing your best center
            back at minute 20 genuinely hurts for the other 70.
          </p>
          <p>
            <strong>Stars carry their phase.</strong> When your side's strength is rolled up for a
            match, the players who actually drive each part of the game count for the most, and a
            genuine standout isn't dragged all the way down to his teammates' level. Your attack
            leans hardest on your strikers and wingers, possession on your central midfielders, and
            your defense on your center backs, so a world-class player in the right spot lifts that
            part of your game noticeably even if the rest of that unit is ordinary. The flip side:
            buying a great player in the wrong position, or padding your OVR with squad filler, moves
            the needle far less than the raw rating suggests. This is why a smart, positionally
            balanced XI can outperform a higher-OVR one that's stacked in the wrong places.
          </p>
          <p>
            <strong>Finishing is individual.</strong> How many chances your team creates comes from
            the whole XI's strength, but whether a given shot goes in also leans on the specific
            player taking it, measured against his own teammates. A striker who's a clear cut above
            the rest of his side will bury chances they'd miss and rack up goals even on a weak team,
            while a poor finisher wastes good ones. It's a redistribution, not free goals: your side's
            best finishers score more than their share, the rest score less, and the league's overall
            scoring stays the same. Corners work the same way off a player's heading. (Your xG stays a
            neutral, team-blind chance quality, so goals well above xG is exactly what a great finisher
            looks like.)
          </p>
          <p>
            <strong>Match ratings.</strong> Every appearance earns a FotMob-style 0.0&ndash;10.0
            rating, starting from a 6.0 baseline and moving with the player's stat line, weighted by
            position. A clean sheet means more to a keeper, and a goal from a defender is worth more
            than a goal from a striker. Short cameos get damped by minutes played, so a two-minute
            sub can't post a 9.8 off one touch. The season-long average is a sortable column on Stat
            Leaders.
          </p>
          <p>
            <strong>End-of-season awards.</strong> The moment you advance past a season, you land on
            the Season Preview page (a quick look at the league's top players, top teams, and
            biggest offseason transfers), with a link through to the Awards page for three honors
            covering the season that just finished. <strong>Player of the Season</strong> starts
            from a player's season-long average match rating, then adds a bonus for his goals and
            assists, weighted heavier than the match rating alone already credits them, and heavier
            still for a defender or keeper who chips in goals, so end product genuinely tips a close
            race and not just consistency. Central and defensive midfielders sit between the two.
            An attacking midfielder counts as an attacker for this, not a midfielder, because in
            this game he scores and creates about as much as a winger does, so his goals are priced
            the same as a winger's rather than at the scarcer midfield rate. The{" "}
            <strong>Golden Boot</strong> is just the league's top
            goalscorer. <strong>Team of the Season</strong> fills an 11-man pitch, laid out as a
            4-3-3 &mdash; a keeper, a back four, a midfield three of a holding man, a central
            midfielder and an attacking midfielder, and a front three of two wingers and a striker
            &mdash; with whoever rates highest at each of those positions across the whole league,
            blending match rating with the stats that matter most for the role: goals and assists up
            front, tackles and interceptions in defense and midfield, saves for the keeper. Every
            slot takes a player who actually plays that position, so a great season at a position
            the shape has only one of (striker, say) can still miss out. Both Player of
            the Season and Team of the Season also factor in overall quality, not just the stat
            line, so a modest player who piled up a big statistical season (often just from facing
            heavy pressure on a weaker side) won't out-rank a genuinely elite one. Only players who
            appeared in a decent share of the season's matchdays are eligible for any of the three.
          </p>
          <p>
            <strong>The Ballon d'Or and the World Team of the Year.</strong> The three honors above
            are decided inside one league. The Awards page also has a World tab, which judges every
            league in the world as a single field: the <strong>Ballon d'Or</strong> for the best
            player alive that season (with the nine behind him listed as a shortlist), and a{" "}
            <strong>World Team of the Year</strong> best XI drawn from anywhere. A few things go into
            it. First, the domestic season, scored the same way Player of the Season is, and it's
            still the biggest single part. Second, the Continental Cup: cup goals and assists count
            the same as league ones, your rating in it counts, and there's a bonus for how far your
            club went, biggest by far for winning the thing (all of it scaled down if you only
            played a game or two of the run). Third, everything he played that summer for his
            country: goals, assists and caps, worth double at a World Cup and half again at a
            confederation cup compared with a qualifier. A confederation cup summer counts both the
            cup and that year's qualifying round. Your
            domestic cup counts too, but only as a trophy: winning it is worth points to everyone who
            played in the run, while goals scored in it are not. Those games are only ever measured
            against one country, so unlike Continental Cup games they can't be compared fairly with
            anyone else's, and counting them would quietly favour whoever plays in the weakest
            league.
          </p>
          <p>
            Trophies count for a lot here. Winning your league, winning the Continental Cup,
            winning your domestic cup, winning a confederation cup and being in the squad
            that won the World Cup are all worth real points on top of whatever you did personally,
            and they stack. Roughly speaking, your domestic cup is worth about three league goals to
            a striker, a confederation cup title about nine, winning your league about ten, the Continental
            Cup a bit more than that, and the World Cup more again. The domestic cup is deliberately
            the smallest: it's six games and a bit of luck, and it shouldn't weigh the same as a
            whole league campaign. It isn't a pure team prize: you
            still have to have played a good season yourself, and a squad player who barely featured
            in a cup run only collects a fraction of it.
          </p>
          <p>
            The last thing in the mix is how good the player actually is. The world award leans on a
            player's overall rating noticeably harder than your league's own Player of the Season
            does, and that's deliberate. Every other number in the calculation has been scored
            against the standard of one league, so a rating is the only thing that means the same
            everywhere. Practically, it means the Ballon d'Or usually goes to someone genuinely
            among the very best players alive rather than to whoever had the hottest goal tally, and
            it's the reason the odd midfielder or defender can win it at all. There's a real tension
            between this and the trophy bonuses above, and they're balanced against each other on
            purpose: turn either one up and the other stops mattering. So the leading scorer won't
            always win, a treble winner won't always win, and the very best player won't always win.
            Whoever the season made the strongest case for does.
          </p>
          <p>
            One thing worth knowing about how the world award compares leagues. Match ratings are
            scored against the standard of the league you're playing in, so a 7.5 average in a weak
            league and a 7.5 in a strong one are not the same season &mdash; the first was earned
            against easier opponents. The world award corrects for that by how strong each league's
            players actually are, so the trophy doesn't just drift to whoever plays in the weakest
            division. It's a correction, not a penalty: a genuinely better player in France or
            Portugal still beats a merely good one in England, and the second division is not shut
            out by rule, only by the correction. The Continental Cup is the exception that needs no
            correcting &mdash; everyone in it is measured against the same pooled field, which is why
            it carries the weight it does.
          </p>
          <p>
            <strong>Your league title and your domestic cup are worth more if you win them in a
            strong league.</strong> Every country crowns a champion regardless of how good its
            football is, so a title in Belgium and a title in England used to be worth exactly the
            same to a world award, which is plainly wrong. Both are now scaled by how far your
            league sits above or below the world's average standard: in the shipped world that's
            roughly a 1.45x gap between the strongest top flight and the weakest. Winning a weaker
            league is still worth real points, never a penalty &mdash; and a second-division club
            that wins its domestic cup still gets credit, just heavily reduced. The Continental Cup
            and international football take no such scaling, because they're contested between
            countries already, so winning them is equally hard whoever you are.
          </p>
          <p>
            <strong>Goalkeeper of the Year and Defender of the Year.</strong> Two more worldwide
            awards on the same World tab, each with a five-man shortlist. They exist because the
            Ballon d'Or can't really be won by a keeper or a defender, and that isn't a bug to be
            fixed so much as what that award is: it's scored on goals, assists and match rating, and
            no amount of clean sheets shows up in any of those. The real one has gone to one
            defender in sixty years, which is why the actual ceremony hands out a separate keeper's
            trophy instead of pretending otherwise.
          </p>
          <p>
            So these two are judged on the things the Ballon d'Or ignores. The keeper's award counts
            saves and holds goals conceded against him; the defender's counts tackles and
            interceptions and goals conceded, and is open to centre-backs and full-backs. On top of
            that come the same worldwide extras the Ballon d'Or uses: the league-strength
            correction, your Continental Cup run, your summer with your country, your league title,
            your domestic cup.
          </p>
          <p>
            Those extras count for three times as much here as they do in the Ballon d'Or, and
            there's a reason for the difference. Tackles, interceptions and saves are counted up
            over a season and they get big, so a defender's raw defensive work can reach half his
            score and leave everything else as rounding. A league title was worth under 4% of a
            defender's total. Tripling the rest puts trophies back roughly where they sit in the
            Ballon d'Or: about a fifth of a defender's winning score now comes from outside his
            league, against a sixth for a Ballon d'Or winner.
          </p>
          <p>
            It has a second effect that's worth knowing about, because it's the reason the defender
            award stopped drifting to weak leagues. Two of those extras &mdash; the Continental Cup
            and your summer with your country &mdash; are the only parts of the whole calculation
            that put players from different leagues against each other directly, and a club from a
            weak league rarely goes deep in the cup. Turning them up pulls the award towards the
            stronger leagues on its own. Your league title and your domestic cup don't help with
            that at all, since every league crowns a champion regardless of how good it is.
          </p>
          <p>
            The World Team of the Year is scored the same way, trophies and all, because it's built
            on the same numbers and had the same problem. So the three agree with each other: the
            Goalkeeper of the Year is the keeper in that XI, and the Defender of the Year is in its
            back four. The Ballon d'Or is the one that stands apart, since it's scored on goals and
            assists rather than on defending, and it keeps its own trophy weighting.
          </p>
          <p>
            One thing worth knowing about how the defender's award reads. Tackles and interceptions
            are counted up raw over a season rather than as rates, and they vary a lot from one
            defender to the next. A defender who spends every week under siege makes more of both
            than an equally good one at a club that controls its games, so the award favours
            defenders with plenty of defending to do, and centre-backs take it more often than
            full-backs. It's the same measure the World Team of the Year has always picked its back
            four with.
          </p>
          <p>
            Both awards show up as honours on a player's profile, in a club's history, and on the
            Frivolities award boards, and they count towards the GOAT ranking. Seasons you played
            before this update don't have them: awards are written down when they're won and never
            recalculated, so an old save picks these up from its next completed season onward.
          </p>
          <p>
            <strong>xG (expected goals).</strong> Every shot's chance of going in before you know
            the outcome, based on the defense and keeper it's taken against, tallied up per player
            and per team, shown next to the score on the Box Score page and as a column on Stat
            Leaders. It deliberately ignores the shooter's own finishing skill (an elite finisher's
            shots don't get marked as better chances just because he's elite), so comparing a
            player's actual goals to his xG tells you whether he's finishing above or below what an
            average attacker would from the same chances, instead of the two numbers just tracking
            each other. It's purely informational. It doesn't feed match ratings or anything else,
            it just tells you whether a scoreline flattered a team (or a keeper) or was earned.
          </p>
          <p>
            <strong>Goals against &amp; xG against.</strong> The mirror stat for goalkeepers: how
            many goals he's actually conceded versus how many an average keeper would be expected to
            concede from the shots he faced, shown on his Roster row, his Box Score line, and as Team
            Stat Leaders columns. A keeper conceding fewer goals than his xG against is beating his
            shot-stopping expectation. More means the defense in front of him is doing its job but
            he isn't turning that into saves, or he's just been unlucky. Goalkeepers can't be subbed
            mid-match right now, so both stats always cover a keeper's full 90 minutes.
          </p>
        </Section>

        <Section id="squad" title="Your Squad: Lineups, Depth & the Roster Cap">
          <p>
            Pick your <strong>formation</strong> from the dropdown above the pitch on the Roster
            page. Sixteen shapes are on offer: <strong>4-3-3</strong>, <strong>4-4-2</strong>,{" "}
            <strong>3-5-2</strong>, <strong>5-3-2</strong>, <strong>4-2-3-1</strong>,{" "}
            <strong>4-5-1</strong>, <strong>3-4-3</strong>, <strong>5-4-1</strong>,{" "}
            <strong>4-3-1-2</strong>, <strong>4-4-1-1</strong>, <strong>4-3-2-1</strong>,{" "}
            <strong>4-2-2-2</strong>, <strong>3-4-2-1</strong>, <strong>3-5-1-1</strong>,{" "}
            <strong>5-2-3</strong>, and <strong>5-2-1-2</strong>. It's a real tactical choice, not
            just for show. Your team's match strength is rolled up from whichever eleven the
            formation fields, so a shape that starts two strikers (say 4-4-2) puts a different XI on
            the pitch than 4-3-3. Every shape fields a genuinely different mix of positions, so
            picking one is really picking which of your players get on the pitch: 4-2-2-2 wants two
            attacking mids and two strikers, 5-2-3 wants a back three behind two holding mids, and
            so on. Changing formation resets your Starting XI to the auto-picked best fit for the
            new shape, so you re-arrange from a sensible starting point. If you'd rather not fiddle
            with it, hit the <strong>Best XI</strong> button next to the formation dropdown: it
            picks whichever shape fields your strongest eleven and fills the lineup for you in one
            click, the same way the AI sets up its own clubs. Each AI club automatically lines up in
            whichever shape fields its own strongest eleven, re-checked at the end of each transfer
            window as its squad changes. On the Roster page, your Starting XI sits on
            a pitch, one chip per slot. Drag a bench player from the bench table onto a slot to swap
            him in, and the outgoing starter drops to the bench on its own. You can also drag one
            starter straight onto another to have the two trade positions, so shifting a midfielder
            out wide or pushing a full-back up the flank doesn't mean routing him through the bench
            first. The one pairing the game won't allow is a keeper and an outfielder, since nobody
            else can go in goal. Click a chip to extend or release that player. Below the pitch is a <strong>stats table for your Starting XI</strong>{" "}
            with the same columns the bench table has (appearances, minutes, goals, assists, tackles,
            rating, and so on), so you can read every starter's season at a glance without pulling
            him off the pitch. A <strong>Depth Chart</strong> toggle above the pitch shows each
            starter's current best-fit backup from the bench next to his chip. Each chip also shows
            a small ▲/▼ badge next to a starter's OVR when it changed from last season, green for
            growth and red for decline, so you can spot who's developing or fading without leaving
            the pitch view. Your XI sticks and gets used every match. If your saved XI ever goes
            invalid (a starter is sold, injured, or released), the game quietly falls back to
            auto-picking the best available XI, so you're never fielding a ghost. The bench is the
            best 7 remaining players by OVR. Each bench row has a <strong>More minutes</strong> button:
            flag a reserve you want to see on the pitch more and the coach will lean toward subbing
            him on during matches, even slightly ahead of a marginally better option. It nudges the
            sub decision, it won't force a clearly worse player on.
          </p>
          <p>
            <strong>Playing someone out of position costs you.</strong> Your team's match strength is
            built slot by slot from the shape you picked, so what matters is the job each player is
            doing, not what kind of player he is. Put a centre-back in the striker slot and he
            attacks like a centre-back who has been shoved up front: he drags your attack down, and
            he stops helping your defense, because he isn't back there any more. How much it hurts
            depends on how far you've moved him. Covering a nearby position (a full-back at
            centre-back, a winger at striker) is a modest hit that a good player can absorb. Sticking
            him somewhere unrelated is a real downgrade, and an outfielder in goal is a disaster,
            which is why the game won't let you put one there. Roughly, a good player one position
            out of his own plays like an ordinary player in his proper spot. The upshot is that a
            balanced squad that fills its shape beats a collection of better players crammed into
            the wrong slots, so it's worth checking your XI after injuries pile up. On the pitch view
            anyone lined up somewhere he doesn't play is flagged in amber, showing his position and
            the slot you've put him in, so you're never paying that cost without knowing.
          </p>
          <p>
            <strong>That cost is a price, though, not a ban.</strong> Any time the game picks an XI
            for you (Best XI, the reset after a formation change, the fallback when your saved XI
            goes invalid, and every AI club's lineup) it weighs what each player would be rated in
            the job he'd be doing against what covering it costs him, and starts the eleven worth
            most. So if the only recognised full-back left on your books is miles off the standard of
            the rest of your squad, a centre-back or a winger who's far better will take the slot and
            eat the penalty, because that genuinely leaves you stronger. A specialist still keeps his
            place whenever the gap is smaller than the cost of moving someone across, and a player
            with a real second position pays nothing to fill it, so he wins those slots outright.
          </p>
          <p>
            <strong>Some players have more than one position.</strong> Look at a player profile and
            you'll see what he'd be rated at each spot he can cover, with his listed position
            highlighted. If he's genuinely good enough at a nearby position for his kind of player,
            it counts as a real second position: it shows next to his name (like "W / FB"), it's
            starred on his rating strip, and he plays there with no out-of-position penalty at all.
            In a new world about a third of players have a second position and only a handful have a
            third, so a proper utility man is worth holding on to. That share climbs over a long
            save, to around half by season 20 or so, and then holds steady: players broaden as they
            develop, and a squad full of veterans really is more flexible than a squad of kids.
            Keepers are always keepers.
          </p>
          <p>
            This matters when the team picks itself. A versatile player counts as a first-choice
            option for every position he actually plays, so a better winger who also plays full-back
            will now take the full-back slot ahead of a weaker specialist, where before the
            specialist always got it. It works the same on the bench: he's a natural pick to come on
            in any of his positions. Versatility isn't a hidden dice roll, it comes straight from his
            attributes, so it can appear or fade as he develops.
          </p>
          <p>
            <strong>Players can change position for good.</strong> A second position says he can also
            do that job. Sometimes a player stops being what he was: if he's been clearly better at a
            nearby position for a few seasons running, not just in one good year, that position
            becomes the one he's listed at. His rating is then worked out as that kind of player, so
            it usually ticks up, and his wage and transfer value follow. You'll see it on the news
            feed for your own players, and his profile keeps the record ("came through at W, moved to
            AM in 2031").
          </p>
          <p>
            You can't order a conversion, and it isn't random either. It comes out of how he's
            developed: as players grow, their strongest attributes get harder to push, so a sharp
            specialist gradually broadens, and now and then he broadens far enough that a different
            job genuinely suits him better. It happens most in a player's early and middle twenties
            and it's uncommon, a handful of players across the world each season, so a converted
            player is worth noticing. New worlds start with nobody miscast, so nothing moves in your
            first seasons. Keepers never convert, and nobody ever converts into a keeper.
          </p>
          <p>
            <strong>Roster cap: 30 players.</strong> Signings, transfer buys, and academy promotions
            are blocked once you're full (the Roster, Transfers, and Free Agents pages all show
            an x/30 count). Your academy has its own separate 10-player cap, covered in{" "}
            <a href="#youth">The Youth Academy</a>.
          </p>
          <p>
            <strong>Depth floor.</strong> You can't sell or release a player if it'd leave a position
            with too little cover to put out a team. The game blocks the move rather than letting you
            strand yourself without, say, a goalkeeper. AI clubs play by the same floor.
          </p>
        </Section>

        <Section id="transfers" title="Transfers & Negotiation">
          <p>Two transfer windows per season, just like real football:</p>
          <ul>
            <li><strong>Summer</strong>. The whole offseason plus matchdays 1&ndash;4 (closes early September).</li>
            <li><strong>Winter</strong>. Matchdays 18&ndash;22 (mid-December to late January). Matchday 22 is <strong>deadline day</strong>, and simming to matchday 21 lands you on it with the window still open.</li>
          </ul>
          <p>
            <strong>Keeping a shortlist.</strong> The star beside a player's name puts him on your{" "}
            <strong>Watchlist</strong>, which is just a list of names you're keeping an eye on. It
            shows each of them with his club, his form this season, his wage and contract, what your
            scouts reckon he's worth, and whether his club would take an offer &mdash; so you can
            line targets up in October and act on them when the window opens. It changes nothing
            about the player: he isn't scouted any harder, his club never finds out, and his price
            doesn't move.
          </p>
          <p>
            <strong>Market value.</strong> A player's value climbs steeply with OVR (an average
            starter runs $35&ndash;45M, an elite player can top $150M), then gets multiplied by age
            (youth is a premium here, since you're buying years of control and resale value, so value
            peaks in the late teens and drops hard after 28), by potential headroom (a big gap
            between potential and current OVR is worth a real premium for young players, fading to
            nothing by 30), and by remaining contract length (a player locked up for years is
            pricier to pry loose).
          </p>
          <p>
            <strong>Values are capped, and the very best players aren't for sale.</strong> No
            player's value ever runs past $350M, so you'll never see a fantasy price tag. Instead,
            the genuine elite are simply taken off the market the way a top club would never sell
            its star at any price: if a player was one of the best in the world last season &mdash;
            either a top-of-the-league OVR, or he won Player of the Season, the Golden Boot, or a
            Team of the Season place &mdash; and his club finished in the top four of a top-flight
            league, he's not for sale to anyone. He won't appear in your recommended targets and any
            offer you make is ignored. You can still buy a solid, competitive squad, but the
            difference-makers who actually win titles you have to develop yourself (a gamble, per the
            note on potential above) or catch at a club that had a down year. Money buys you a good
            team; it can't buy you a great one.
          </p>
          <p>
            <strong>Buying.</strong> The Transfers page recommends 5&ndash;10 for-sale players near
            your level and within your budget, and how accurately they're ranked comes down to your
            scouting spend (<a href="#finance">Finance</a>). The filter bar actually re-runs the
            search rather than just hiding rows, so pinning a position pulls up a fresh, fuller list
            of players there. You can filter on position, nationality, which league he plays in, a
            range of overall, potential, age and scout value, a weekly wage ceiling, and how much
            contract he has left &mdash; and every column heading sorts the table. Money boxes take
            shorthand, so "50m" and "800k" work as well as typing the zeros. Negotiation goes
            like this: the selling club has a hidden asking price, rolled once per window, so you
            can't reopen talks hoping they're in a better mood. Offer way below it and they hang up
            for the rest of the window. Offer low-but-believable and they counter above their true
            price, giving up a little less each round. Repeat an offer they already rejected, or drag
            it past five rounds, and talks are over. Meet the price and the deal goes through on the
            spot: fee out of your budget, player on your roster.
          </p>
          <p>
            <strong>Search all players.</strong> Under the recommended list is a search panel that
            reaches every club in the world, not just targets near your level. Type a name, or set
            any of the same filters, and it lists matching players from every league with an Offer
            control right on the row &mdash; negotiation works exactly as above. Two things it won't
            let you buy: a player his club needs for squad depth, and the very best players at clubs
            coming off a big season, who aren't for sale at any price. In those cases the row says
            why instead of taking an offer that would go nowhere &mdash; or tick "only show players I
            can actually bid on" and they drop out of the list entirely. The search shows the best 60
            matches by overall, so if you're hunting something specific, narrow the filters rather
            than scrolling.
          </p>
          <p>
            <strong>The player has to want it.</strong> Money isn't the whole story, and this is the
            big way football differs from basketball: there's no salary cap here, so nothing would
            otherwise stop a superstar dropping into a small club that happened to have cash. So
            players have a say. The better a player is, the more he cares about the size of the club
            he's joining, judged on squad quality and fame together. A fringe squad player will go
            wherever the game time is. A genuine star will move sideways or up, but won't drop to a
            much smaller club at any price, and a row that says "Wouldn't drop to a club this size"
            means exactly that. This applies to you the same as to every AI club, so building your
            own reputation is what opens up the top of the market.
          </p>
          <p>
            <strong>Settling in.</strong> A player who's only just joined somewhere is much harder to
            prise away again, and gets easier over about three seasons. Squads hold their shape from
            year to year instead of reshuffling every summer.
          </p>
          <p>
            <strong>Selling.</strong> During a window, AI clubs that rate your players will come in
            with offers, up to 4 at a time, from whichever club values each player most (
            <a href="#ai">how they decide</a>). You can accept (immediate sale, fee into your
            budget), reject, or counter upward. The buyer haggles by exactly the same rules you face
            when buying, just mirrored, and walks away from greedy counters the same way a seller
            would. Sold players show up in a "Sold This Window" section so deals never vanish on you.
            Each offer comes with a one-line scout take: a straight "take it," a suggested counter
            price, or a dismissive "not worth discussing," based on how the offer stacks up against
            the player's open-market value. Like Recommended Transfers, how sharp that read is
            depends on your scouting spend (<a href="#finance">Finance</a>) &mdash; a thin scouting
            budget gives you a fuzzier, less reliable take.
          </p>
          <p>
            <strong>List for transfer.</strong> AI clubs already scout your whole roster on their
            own, but the <strong>List</strong> menu on the Roster page (in each player's pitch
            popover and in his XI or bench row) lets you flag a player as available, a clearer
            signal that you're open to selling. The same menu is where you list him for loan. A listed player needs a much smaller edge in value to some AI club to
            draw a bid, and gets first claim on one of the 4 offer slots each window over an unlisted
            player. It's not a guarantee (a buyer still has to rate him above what he's worth to
            you), just better odds of a bite.
          </p>
          <p>
            <strong>Sell-on shares and bonuses.</strong> Any deal you negotiate, buying or selling,
            has an <strong>Add-ons</strong> panel under the offer buttons. Two things live there:
          </p>
          <ul>
            <li>
              A <strong>sell-on share</strong> of up to <strong>40%</strong>. Sell a player with one
              attached and you keep that share of the <em>profit</em> if his new club sells him on
              again within <strong>5 seasons</strong>. Profit, not the fee: if they sell him for less
              than they paid you, you get nothing. Buy a player and you can hand a share the other
              way instead.
            </li>
            <li>
              <strong>Bonuses</strong>, paid once each if the thing happens within{" "}
              <strong>3 seasons</strong> while he's still at that club. Up to four: league
              appearances in a season, league goals in a season, his club qualifying for Europe, and
              his club winning promotion. Together they can't come to more than{" "}
              <strong>half</strong> the cash fee.
            </li>
          </ul>
          <p>
            <strong>The bonuses on offer are picked for the player.</strong> You won't be offered a
            goals bonus for a goalkeeper, or a promotion bonus when the club buying him is already in
            the top flight, because neither could ever pay. And the target moves with the player: a
            squad man might be offered a bonus at 14 league games where a first-choice signing gets
            one at 31. They're set so every bonus you're offered is about equally likely to pay,
            which is what makes the number itself worth reading. You can change the money, but not
            the target.
          </p>
          <p>
            <strong>Add-ons sit on top of the fee</strong>, the way a real transfer gets reported:
            "$20M rising to $25M". They don't change what you pay or receive today. What they do is
            count toward whether the other club says yes, because the club on the other side weighs
            your cash <em>and</em> what your add-ons are likely to be worth to them.
          </p>
          <p>
            That's what makes them useful. Buying, they're how you land a player you can't quite
            afford: bid below his price, promise a share of any future sale, and the deal can clear
            even though your cash alone wouldn't have. Selling, they work the same way in reverse.
            Asking for a sell-on as well as the money is asking for more, so a buyer will only wear
            it while the whole package still sits under what the player is worth to him. If he
            won't, you'll see the Accept button greyed out and you'll have to counter instead.
          </p>
          <p>
            The panel spells out both halves before you commit: what changes hands now, and what it
            could rise to if the add-ons land.
          </p>
          <p>
            Everything still owed, in both directions, is listed under <strong>Transfer Add-ons</strong>{" "}
            on the <a href="#finance">Finance</a> page, and on each player's own page. Clauses
            disappear from those lists the moment they pay out, run out of time, or the player leaves
            the club that owed them. A bonus dies unpaid if he's sold before it triggers, and a
            sell-on settles and ends the moment he's sold on. Only deals you make carry add-ons; AI
            clubs don't attach them to each other's transfers.
          </p>
          <p>
            Every deal you make and every deal in your own league lands in the News Feed, along
            with the biggest moves elsewhere in the world.
          </p>
        </Section>

        <Section id="loans" title="Loans">
          <p>
            A loan sends one of your players to another club's roster for a fixed <strong>1, 2, or
            3 seasons</strong> without selling him. He plays for (and develops at) his loanee club
            the whole time, then comes back to you on his own once the loan ends. It's the move for a
            good player stuck behind a better one on your depth chart: real minutes matter for
            development, so a season out on loan can be worth more to him than a season on your
            bench.
          </p>
          <p>
            From the Loans page, <strong>list</strong> a senior-roster player and pick a duration
            (the depth floor still applies, so you can't loan away your last cover at a position).
            You can also list him from the Roster page: the <strong>List</strong> menu on each
            player (pitch popover, XI row or bench row) holds both listings, so
            "List for loan (1 season)" is one click from the squad screen &mdash; use the Loans page
            if you want a 2 or 3 season loan instead. It's the same listing either way, so it shows
            up on both pages, and the loan half of the menu is only available while a transfer
            window is open. A player listed for loan carries an <strong>L</strong> flag on his pitch
            chip, the same way a transfer-listed player carries a <strong>$</strong>.
            Interested AI clubs then make offers there, each with a flat, non-negotiable fee and the
            duration you picked. Accept one and the move goes through right away, or reject and keep
            looking. The <strong>loanee club pays the fee up front and covers his wages for the whole
            loan</strong>. His contract itself doesn't change, and once he's back he's still on the
            same deal he left with. AI clubs also loan players to each other in the background, and
            they stick strictly to real-football logic: <strong>only young players who aren't in
            their club's starting XI</strong> go out on loan. A starter is already getting his
            minutes at home, so he's never loaned, whatever the numbers say. A club will let a
            prospect it rates highly go out, though, as long as someone else rates him more, so the
            players moving are genuinely ones worth watching rather than only the ones nobody wanted.
            Second-division clubs can't take a loan of a player good enough that the top flight would
            claim him anyway. That background market only ever moves players between AI clubs, so
            nothing happens to your own roster unless you list a player yourself.
          </p>
          <p>
            <strong>A loan can't run past his contract.</strong> Since his deal doesn't change while
            he's away, a loan that outlasted it would mean he was somewhere else when it ran down
            and left on a free the moment he got home &mdash; so the duration list only offers the
            seasons his current contract covers. A player in the last year of his deal can go out
            for one season, not three. Extend him first if you want to send him further out.
          </p>
          <p>
            He's still your player the whole time he's away, contract included. The
            <strong> Players Out on Loan</strong> list at the bottom of the Loans page shows when
            each deal expires and lets you extend him from there, one at a time or all at once,
            which is the only place you can &mdash; he isn't on your Roster page while he's gone,
            so the Roster page's own Extend all button can't reach him.
          </p>
        </Section>

        <Section id="contracts" title="Contracts, Wages & Free Agents">
          <p>
            Contracts are one-button. The game shows you the exact weekly wage and length, and you
            take it or leave it, no salary haggling. Length comes off age: <strong>3 years</strong>{" "}
            under 30, <strong>2 years</strong> at 30&ndash;32, <strong>1 year</strong> at 33+.
            Academy players are the exception, and <a href="#youth">The Youth Academy</a> covers
            their flat stipend, which doesn't follow this age/ovr scale.
          </p>
          <p>
            Wages climb steeply with ability, so superstar money is real money. Roughly, per week
            (each signing rolls ±15%):
          </p>
          <table className="table table-sm table-striped" style={{ maxWidth: "24rem" }}>
            <thead><tr><th>OVR</th><th>Weekly wage</th></tr></thead>
            <tbody>
              <tr><td className="stat-num">60</td><td className="stat-num">~$11k</td></tr>
              <tr><td className="stat-num">65</td><td className="stat-num">~$21k</td></tr>
              <tr><td className="stat-num">70</td><td className="stat-num">~$36k</td></tr>
              <tr><td className="stat-num">75</td><td className="stat-num">~$57k</td></tr>
              <tr><td className="stat-num">80</td><td className="stat-num">~$84k</td></tr>
              <tr><td className="stat-num">85</td><td className="stat-num">~$120k</td></tr>
              <tr><td className="stat-num">90</td><td className="stat-num">~$164k</td></tr>
            </tbody>
          </table>
          <p>
            A player whose contract expires becomes a <strong>free agent</strong>, signable for no
            transfer fee, just wages, on the same one-button terms. Extend your own players from the
            Roster page before they walk (pick any length from 1 to 4 seasons, and length doesn't
            change the wage). The AI extends its own keepers too (<a href="#ai">details</a>), so the
            free-agent pool is mostly players somebody decided not to hang onto.
          </p>
          <p>
            Nobody manages your squad for you, so an expiring deal you don't act on just runs out and
            the player leaves on a free the next offseason. To keep that from sneaking up on you, the
            Roster page flags anyone in the final year of his deal with a <strong>"Final year"</strong>{" "}
            badge and a heads-up banner, so you can extend him before he's gone for nothing. Academy
            stipends run out the same way, so the Academy page carries the same badge and banner for
            your prospects.
          </p>
          <p>
            That banner also carries an <strong>Extend all</strong> button, which re-signs every one
            of those players at once so you don't have to work down the list. It quotes the total
            weekly wage before you press it, and each player gets the default length for his age
            rather than a length you pick, so extend anyone you want on different terms yourself
            first. Anyone holding out for a move to Division 1 is left out and the banner says so.
            The Academy page and the Players Out on Loan list on the Loans page each have their own
            button, covering the players on that page.
          </p>
          <p>
            Signing a free agent shows up on his profile as a <strong>free move</strong> the same way
            a paid transfer does &mdash; in his transfer history, on his transfer-value chart, and in
            the News Feed for your own signings. Signing a prospect straight into your academy counts
            as one too, so the club on his profile matches where he actually is.
            Before, a free signing left no trace, so his profile could wrongly show him still at a
            club he'd long since left even while he was playing for you.
          </p>
          <p>
            Don't count on picking up a gem for free, though. Each offseason the AI clubs work the
            free-agent pool before you do, and they don't just fill holes: any club will grab a
            genuinely useful free agent to upgrade a spot it's already stocked at. By the time you
            get to the Free Agents page, most of the good ones are gone and what's left skews toward
            squad filler and reclamation projects. A real bargain still turns up now and then, but
            it's the exception.
          </p>
          <p>
            The pool also doesn't just pile up anymore. A player who goes a full season with nobody
            signing him starts rolling to <a href="#development">retire</a>, at any age, so the
            journeymen clear out over time instead of sitting on that page forever. Young prospects
            with a high ceiling are exempt and will wait for a club however long it takes, so this
            thins out the filler rather than the talent.
          </p>
          <p>
            <strong>Signed a free agent? You're keeping him for a season.</strong> A free agent you
            sign onto your senior roster can't be sold until the following season &mdash; no AI club
            will bid on him, and the Roster page shows "Can't sell yet (just signed)" in place of the
            List for Transfer button until the hold clears. This closes the old loophole of signing a
            free agent for nothing and immediately flipping him for a fee. You can still release him
            for free at any time; you just can't cash him in right away.
          </p>
          <p>
            If you run a Division 2 club, every so often a breakout player will refuse a new deal.
            The Roster page shows "Wants a move to Division 1" instead of an Extend button once he's
            genuinely good enough that a Division 1 club would want him. He can't be extended or
            stopped from leaving, and the best you can do is sell him yourself before his contract
            runs out, since letting him walk for free gets you nothing. It works the other way too:{" "}
            <strong>Division 2 clubs never buy players of that caliber</strong>, not from each other
            and not from you. A player good enough for the top flight just wouldn't sign for the
            second division, so don't expect a Division 2 club in the bidding for your stars.
          </p>
        </Section>

        <Section id="finance" title="Finance">
          <p>
            Every club starts each season with the same base allocation (<strong>$88M</strong>),
            and the squad's <strong>entire season wage bill is paid up front</strong> at the season
            start. Whatever's left is genuinely yours to spend, on transfer fees, mid-season
            signings, and scouting. A mid-season pickup (transfer buy or free-agent signing) charges
            the player's full season salary the moment you get him, on top of any fee.
          </p>
          <p>At season's end, the settlement adds and subtracts the rest:</p>
          <ul>
            <li><strong>Prize money</strong>. $40M for winning the league, $20M for the rest of the top quarter, $10M for the rest of the top half, nothing below that. In a 20-club league that's 2nd&ndash;5th and 6th&ndash;10th; a smaller division pays the same share of its table, so half of it is paid whatever its size.</li>
            <li><strong>Hype revenue</strong>. Every club has a hype score (0&ndash;100) that drifts toward its recent results rather than snapping to them. Hype earns extra revenue (up to ~$30M at max hype), deliberately kept modest so fame stays a bonus and not an engine. Success payouts matter more.</li>
            <li><strong>Scouting spend</strong>. Whatever you set the slider to comes out here.</li>
          </ul>
          <p>
            <strong>Scouting</strong> is one slider, $0&ndash;20M per season, starting at $5M. You
            set it <em>once a year, in the offseason</em>, and it's locked for the whole season it
            covers (deducted at that season's end), and during the season the slider is disabled.
            You can't skip the decision either: when you advance to a new season the game stops you
            on a Set Scouting Budget screen first, so every year you actively choose the number
            before the games start.
            That's on purpose: you commit to the spend, and pay for it, before you get the sharper
            view, so you can't crank it up to peek at a player and turn it straight back down. It
            buys accuracy, not players. Every value you see on a transfer target (Recommended
            Transfers, negotiation offers, incoming offers for your own players) is a{" "}
            <em>perceived</em> value, not the real one, and how far off it can be comes down to your
            spend. At $0 it's noisy (±35%, so a target that looks like a bargain, or a rip-off, might
            just be a bad read), and at the $20M max it's nearly exact (±5%). Spend also drives the{" "}
            <a href="#players">potential (POT) fog</a>: more scouting tightens every player's
            estimated-potential band and reveals a signing's true ceiling sooner. So plan ahead. If
            you expect a busy transfer year, set your scouting budget high in the offseason before
            it.
          </p>
          <p>
            <strong>Cup prize money is separate, and it doesn't wait for the settlement.</strong>{" "}
            Continental and domestic cup money is paid as you go, landing in your budget the day you
            play the tie, across all three cups you can be in at once. It's money you already have,
            not a projection.
          </p>
          <p>
            <strong>The Finance page is built around when money moves, not just how much.</strong>{" "}
            Four figures across the top say where you stand: your balance (and how close it is to
            your savings ceiling), your wage bill as a share of what the club earns in a year, what
            you're projected to start next season with, and your hype. Under that, "Your money year"
            walks through the four moments money actually changes hands, marking the one you're
            sitting in: during the season (cup prizes and transfer fees), at season end (league prize
            money, hype revenue, your scouting bill), in the offseason (any add-ons settling), and
            when next season starts (the new allocation arrives and the whole wage bill comes
            straight back out of it). Below that sit your scouting budget, where the wage bill goes
            player by player, any outstanding add-ons, your full transfer history and a league-wide
            money table for comparison, scoped by a competition dropdown that defaults to your own
            division and has an "All Competitions" option.
          </p>
          <p>
            AI clubs are tuned to never go broke. <em>You</em> can overspend, though: hoard a full
            roster of elite wages and the projection will happily show you the shortfall coming.
            Budget is a running balance that carries over between seasons instead of resetting. The
            savings cap scales with a club's fame: a top-flight club can bank up to{" "}
            <strong>$400M</strong> at full hype, down to <strong>$200M</strong> for a club with no
            fame (lower divisions are capped lower still, reflecting the money gap between them).
            Spending below your cap is unrestricted, but you can't bank cash past it &mdash; money
            you would have saved above the line is never paid at all rather than carried over, so if
            you're near the ceiling the page warns you before the next cheque disappears.
          </p>
        </Section>

        <Section id="youth" title="The Youth Academy">
          <p>
            Every offseason, your club's academy turns out <strong>3&ndash;5 new 16-year-olds</strong>,
            landing in a holding pool on the Academy page instead of straight onto your senior
            roster. They show up raw, well below first-team level, but with youth on their side, and
            some will develop into stars (and some won't, see <a href="#players">potential</a>).
          </p>
          <p>
            Academy quality starts from a fixed trait each club has, set when the league is created,
            so a big club's intake trends better than a small club's. That slope has a floor under
            it: the weakest clubs in the world turn out genuinely poor prospects, but never ones so
            bad they aren't footballers. On top of that anchor,{" "}
            <strong>recent results move the needle</strong>: young players want to join a club that's
            been winning, so finishing high in your league over the last few seasons nudges your
            intake quality up, and finishing low nudges it down. It's a gentle pull, not a
            transformation. Sustained success at the top of the table is worth a few points of intake
            quality over sustained struggle, judged over roughly the last three seasons, and it fades
            as results normalize. Buying a great squad doesn't do it. The results themselves are what
            count.
          </p>
          <p>
            Academy players draw a cheap flat weekly stipend instead of the normal wage formula, and
            they can't be transferred. Each has a one-button <strong>Extend</strong> (fresh stipend
            terms once his contract hits its final season) or <strong>Release</strong> (cut him
            outright, since the academy has no depth floor to protect, unlike your senior roster);
            <strong> Extend all</strong> in the banner does the whole final-year group at once.
            When one's ready, <strong>Promote</strong> moves him onto your senior roster on a normal
            ovr-based wage, which is blocked once you're at the 30-man roster cap. The academy has
            its own cap, separate from your senior roster's, at 10 prospects.
          </p>
          <p>
            AI clubs don't keep a real academy pool. Their youth intake lands straight on their
            senior roster and gets trimmed back to target depth like any other offseason surplus,
            with one exception: each club hangs on to a handful of its most promising youngsters
            beyond that, whatever their current rating. They're carried on top of the squad rather
            than in place of anyone, so it doesn't change who a club picks. It does mean rival clubs
            no longer throw away every wonderkid they produce, and the ones who do reach the free
            market are the ones nobody rated. If
            you leave your own academy alone for several seasons while your senior roster shrinks
            (retirements, expiring contracts you don't re-sign), the game will automatically call up
            your best academy prospects, goalkeeper first if you have none at all, to keep your squad
            fieldable. This is a last-resort safety net, not a real way to build a squad, so check in
            on the Academy page regularly instead.
          </p>
          <p>
            Every summer your academy turns up a group of 16-year-olds on trial, and they land on
            the <strong>Youth Intake</strong> page. Nobody's signed until you say so. You can offer
            a contract to five of them, and whoever's left when you start the next season has gone,
            free for anyone else to sign, so passing on the right one can come back to bite you.
            Their ceilings are estimates like everywhere else, which is the whole difficulty of it:
            you're choosing on a guess.
          </p>
          <p>
            How good that group is comes down to four things. Your academy's standing, fixed when
            the league was created. How you've been finishing lately. And two you control directly:{" "}
            <strong>what you spend on scouting</strong>, which is what finds young players in the
            first place, and <strong>your hype</strong>, because kids want to join a club people are
            excited about. Those last two are worth a few rating points on the whole group at full
            tilt. Not transformative on their own, but they compound over a decade of intakes, and
            scouting money now buys you something beyond a clearer view of a player's ceiling.
          </p>
          <p>
            The Youth Intake page also carries your <strong>scout directions</strong>: two things
            you can tell your scouts before they go out. Both take effect at your next intake,
            not the group already on your desk.
          </p>
          <p>
            <strong>Countries</strong> &mdash; up to three, and they'll turn up most of next
            summer's group between them, with the rest still coming from around your own league.
            Be clear about what this one does: your scouts find you <em>different</em> players, not
            better ones. Where a player is from decides his name and which country is allowed to
            pick him, and nothing else. That eligibility part is the reason to bother with it, if
            you'd like to build a national team out of players you developed yourself.
          </p>
          <p>
            <strong>Positions</strong> &mdash; up to three, if you can see a hole coming in a few
            years and would rather start filling it now. It's a strong lean and not a filter: ask
            for centre-backs and you'll get a lot of centre-backs, never a group of nothing else,
            because an academy that stopped producing everything you weren't thinking about this
            year would cost you more than it gave you.
          </p>
          <p>
            One honest note on positions. Your own academy turns up a handful of kids each summer
            on its own, and those arrive as they are &mdash; positions shape the ones your{" "}
            <em>scouts</em> go out and find, which is most of the group but not all of it.
            Countries are the exception and cover everyone, because that only changes where a
            player is from rather than what kind of player he is.
          </p>
          <p>
            Unsigned players of any age, youngsters included, live on the <strong>Free Agents</strong>{" "}
            page. Don't expect to find a future star there: clubs keep their best young players now,
            so what reaches it is genuinely what nobody wanted. Your own academy is the reliable
            route to a homegrown star.
          </p>
        </Section>

        <Section id="ai" title="How AI Clubs Think">
          <p>
            AI clubs don't run off scripts like "big club buys stars, small club sells." Instead,
            each club keeps working out its outlook from its actual situation:
          </p>
          <ul>
            <li><strong>Ambition</strong>. Win-now pressure, blended from wealth, fame, squad strength, and recent form. An ambitious club pays up for prime-age quality, a low-ambition club builds young.</li>
            <li><strong>Frugality</strong>. Financial caution, driven by relative wealth. Rich clubs can eat an expensive mistake, poor clubs can't, and they price accordingly.</li>
          </ul>
          <p>
            When an AI club sizes up a player, it starts from his open-market value and adjusts for
            its own needs: <strong>positional need</strong> (thin at his position and he'd be an
            upgrade? worth more; already loaded there? worth less), <strong>timeline fit</strong>{" "}
            (does his age match the club's ambition?), and <strong>affordability</strong> (a deal
            that eats too much of the budget gets marked down, harder for frugal clubs). Two clubs
            looking at the same player genuinely value him differently.
          </p>
          <p>
            "Would he be an upgrade" means against the man he'd actually take the shirt off, not
            against the club's best player in that position. A back four starts two centre-backs, so
            a club with one excellent one and three poor ones is measured on the poor one it has to
            field alongside him. That's the difference between a club seeing a hole and thinking
            itself well stocked, and it's why a side with money will now go and buy a second
            centre-back instead of sitting on the cash and starting a teenager.
          </p>
          <p>
            Pricing its <em>own</em> players is a different question, and the club asks it
            differently: not "how much would he improve us" (he's already here) but "how far would we
            fall back without him". A star with no ready deputy behind him is priced brutally
            &mdash; that's the whole gap between his level and his replacement's &mdash; while one
            with a good understudy is easier to prise loose. A club also won't write off its own
            young talent just because it's chasing the title this season.
          </p>
          <p>
            <strong>The AI-to-AI market</strong> runs once per window on a single rule: a player's
            asking price is what he's worth <em>to his own club</em>, and he moves to whichever club
            values him meaningfully more than that and can afford the fee (which splits the
            difference between the two valuations). Everything you'd expect falls out of that one
            rule with no special cases. Surplus players get dumped, aging stars get sold at peak the
            moment their keep-value dips below their market price, and needy clubs overpay for scarce
            positions. And a club that's sitting on cash with a real hole in its squad (short of
            bodies at a position, or a clear weak spot in its best XI) won't hold out for a bargain
            the way it does for a luxury buy. It'll pay a fair price to fill that hole and dig a bit
            deeper into its budget to get it done, so rivals patch their gaps instead of hoarding
            money. Guardrails keep it sane: clubs won't auction off irreplaceable core players,
            cap themselves at 3 buys and 3 sells per window, always respect the depth floor and
            roster cap, and hold back a cash reserve instead of spending to zero (so even a
            gap-filling club never bankrupts itself, and the genuine superstars stay unbuyable at any
            price). On top of all that, players won't drop to much smaller clubs and won't be
            shifted easily in their first seasons somewhere (see{" "}
            <a href="#transfers">Transfers</a>), so the very best players change club rarely &mdash;
            roughly one in ten in a season &mdash; and when they do it's sideways or upward, for a
            fee that makes the news. Those are exactly the moves the News Feed carries from
            leagues other than your own.
          </p>
          <p>
            <strong>Contract renewals.</strong> Before contracts expire each offseason, every AI club
            re-signs any expiring player it still values above his new wage, on the same one-button
            terms you get. Players who don't clear that bar (too old, too expensive, squad surplus)
            get let go into free agency. So an AI club's good young players rarely walk for free, but
            a declining veteran on superstar wages will.
          </p>
          <p>
            AI valuations also carry a little noise, since clubs aren't all-knowing, so the "best"
            bidder doesn't always land a player.
          </p>
        </Section>

        <Section id="strategy" title="Strategy">
          <p>Think like a real sporting director:</p>
          <ul>
            <li><strong>Age is an asset class.</strong> A 21-year-old and a 29-year-old at the same OVR are totally different buys. The young one holds his resale value (and might still grow), while the veteran loses value every season. Buy young, sell before the decline.</li>
            <li><strong>Watch the wage bill, not just fees.</strong> Wages climb steeply with OVR and come out of your budget up front. A squad of 80s can out-wage your income even if you never pay a single transfer fee, and the Finance page shows you exactly where you'll land.</li>
            <li><strong>Sell into demand.</strong> Incoming offers come from clubs that actually need your player, and their first bid is rarely their best. Counter once or twice before you accept, but greedy counters end talks.</li>
            <li><strong>Decide your scouting spend a year ahead.</strong> It sharpens valuations, target rankings, and potential estimates, but you set it in the offseason and it's locked for the season. So if you're planning a busy transfer year, budget for scouting the offseason before, and dial it back for a quiet one.</li>
            <li><strong>Potential is a forecast, not a fact.</strong> Most players fall short of it. Paying a big potential premium is a real gamble, and that's the game working as intended.</li>
            <li><strong>Deadline day is leverage.</strong> Asking prices are fixed for the whole window, so there's no discount for waiting, but simming to matchday 21 guarantees a last look at the market (and any incoming offers) before it shuts.</li>
          </ul>
        </Section>

        <Section id="frivolities" title="Frivolities">
          <p>
            Frivolities holds the all-time lists derived from records your save already keeps.
            None of it affects play. It has seven tabs.
          </p>
          <p>
            <strong>GOAT</strong> ranks the greatest players and clubs in your save from a fixed
            formula. A player is scored on six things: his peak rating, his prime (the years spent
            near that peak), career length and sustained match rating, individual awards, trophies,
            and goals and assists. Prime is weighted to outweigh peak over a long career, and
            individual awards make up roughly half of a typical score. Clubs are scored mostly on
            trophies, with top-four finishes and points per game separating clubs with similar
            trophy counts. A treble is worth a large bonus on top of the three trophies it's made
            of, so winning all three in one season counts for much more than winning them in
            different years. Selecting a row expands it into the full calculation: every award,
            trophy and stat that contributed, how many of each, and what one is worth. Retired
            players are ranked alongside active ones. Known limitation: the player ranking still
            favours attackers, because it builds on the Ballon d'Or and Player of the Season scores,
            which are based on scoring and contain no defensive stats. Three things offset it &mdash;
            the Team of the Season and World Team of the Year terms, which fill specific positions,
            and the Goalkeeper and Defender of the Year awards, which are the first honours on this
            board a keeper or a centre-back can win outright rather than take a slot in. It's not a
            full correction and isn't meant to be: a forward can win the Ballon d'Or on top of
            everything a defender can win, so the ceiling is still higher for attackers. The formula
            is a first draft.
          </p>
          <p>
            The same score ranks each club's own greatest players, on{" "}
            <strong>Club History</strong>. That board is scored on a player's time at that club
            rather than on his whole career, so a man who spent one season with you and a decade
            winning things elsewhere doesn't outrank a player who gave you four hundred games. His
            row shows the years he was there, the appearances he made for that club and the rating
            he peaked at while he was there. An award only counts on a club's board if he won it in
            a season he was on that club's books, and a league title counts if he was in the squad
            for it whether or not he played. The unit is a whole season, not a transfer window:
            a player is counted at the club he finished each season with, so a January signing
            is credited with the title his new club wins that May, and a January departure isn't.
            International honours are left off entirely: a World Cup belongs to his country. Goals and assists are left off too, but for a different
            reason &mdash; once a player retires the game keeps his career totals rather than a
            breakdown club by club, so a per-club figure isn't something the save can still answer.
            Rather than show one thing for players who are still playing and another for the ones
            who have retired, the board leaves production out for everybody and ranks on quality,
            longevity and honours. Because the record of retired players keeps only the most
            notable careers, the further back a save runs the fewer old names survive to be ranked;
            once a club has more than twenty seasons behind it the board says so.
          </p>
          <p>
            <strong>Awards</strong> collects every individual honour the game has handed out. The
            career board counts Ballon d'Ors, World Team of the Year places, Goalkeeper and
            Defender of the Year awards, Players of the Season, Golden Boots and Team of the Season
            places, and you can rank it by any one of them or by the lot. Below it, single seasons are ranked by the Ballon d'Or score they earned,
            which answers which individual season your save has ever seen was the best one;
            selecting a row breaks that score into what he did in his league, in the Continental
            Cup, with his country, and whether he won his title. The Ballon d'Or record board goes
            deeper than wins: the whole top ten is kept every season, so second and third places
            count, and shares score each finish (a win is 1.00, tenth place 0.10) so a career of
            near-misses can outrank a single win. There's also a roll of honour, the youngest and
            oldest winners, and the same awards totalled by club and by country. A club is credited
            for the season the player was there, not for where he ended up. Team trophies aren't
            counted here; they're on GOAT and on Club Records.
          </p>
          <p>
            The tab also builds any club's <strong>all-time award XI</strong>, laid out on a pitch,
            starting with your own. Both the Team of the Season and the World Team of the Year are
            picked position by position, so this is a record rather than a ranking: each slot goes
            to whoever that club has had picked there most often, counting a worldwide place above
            a domestic one. A player can only hold one slot, so someone picked at two positions over
            his career takes his stronger one and the next best man gets the other. A position
            nobody has ever been picked in is left empty rather than filled with the nearest
            approximation. One wrinkle on a save that predates the attacking-midfield slot: those
            older seasons picked two central midfielders instead, and since past awards are never
            re-run, a central midfielder from back then can show up in the attacking-midfield slot.
            It sorts itself out as new seasons pile up.
          </p>
          <p>
            <strong>Records</strong> covers the most dominant and worst team seasons, the highest
            rating any player has reached, the longest careers, and the biggest transfer fees. Team
            seasons rank by points per game rather than raw points, so a season in a smaller league
            isn't penalised for playing fewer matches. The transfer list counts permanent deals
            only, since loans and free moves aren't purchases. Plain stat leaderboards live on
            All-Time Leaders instead, so the two tabs don't repeat each other.
          </p>
          <p>
            <strong>All-Time Leaders</strong> opens on every stat at once, as a grid of cards
            showing the top 10 in each. Click a category and you get its full top 30, with clubs,
            appearances and the season each figure comes from. One switch sits above the grid and
            applies to every card: career totals, or the best single seasons recorded. Anyone who
            has played a league game for your club is highlighted, on the cards and on the full
            boards, so you can see at a glance which records your own players hold. It counts
            former players too, which is the point: an all-time list is mostly people who have
            moved on or retired. Two
            differences from Stat Leaders, which covers one season at a time: these boards cover
            the whole world at once rather than one league, because a career crosses divisions and
            countries; and the single-season view shows one row per player, his best, rather than
            one row per season.
          </p>
          <p>
            <strong>International</strong> is the all-time national-team record book: most
            international goals, most caps, and most World Cups won. It lays out the same way
            All-Time Leaders does, a card per category showing the top 10, and clicking one opens
            its full top 30 with caps, goals and World Cups side by side. A player's caps and goals
            cover his whole international career, qualifying and World Cups together, the same
            numbers his profile shows. The country dropdown sits above the cards and filters all
            three at once, which is what the tab is really for, since it answers who your country's
            all-time leading scorer is. Your own players are highlighted here too. Retired players
            matter more here than anywhere else on the page: an all-time top scorer has almost
            always finished playing by the time he holds the record, so a list of active players
            only would hand it to someone new every few seasons.
          </p>
          <p>
            <strong>Player Bios</strong> covers the current player pool: oldest and youngest, which
            countries the world's players come from and each country's best player, one-club men,
            and the longest and most common names. Academy players are included, which is why the
            youngest list is entirely teenagers.
          </p>
          <p>
            <strong>Club Records</strong> is the club-level version: the trophy cabinet (total
            trophies, then league titles, Continental Cups, domestic cups, trebles and
            second-tier titles), the longest wait for a title, all-time biggest spenders, and
            the clubs that have made the most money trading players. A treble is counted where
            the three wins fall in one season, and it isn't added to the total, since those
            three trophies are already in it.
          </p>
          <p>
            Retired players are otherwise deleted from the save entirely, so the game keeps a
            permanent record of the ones who either reached a high rating or played a long career.
            That is what lets the all-time lists cover them. The rest are still deleted, which
            keeps the save file from growing without limit. On an older save the record starts
            from your next offseason, because players who retired earlier left nothing to recover.
          </p>
          <p>
            Anyone with that record kept is still clickable. His name links to a career page, the
            same way a current player's does, from the all-time lists and from anywhere else he
            comes up: an old transfer, a news item, your own transfer history, an awards board. The
            page carries the season he retired and the age he did it at, his peak rating and when
            he hit it, the clubs he played for, career totals with his best single season in each
            stat beside them, his trophies and awards, his caps and international goals, and a
            season-by-season line with the club and rating for each year. It shows less than a
            current player's profile because that's all that was kept: no attribute ratings, and no
            per-season goals and assists behind the career totals. An appearance count of zero in
            the seasons list means he was in the squad that year but never got on the pitch.
          </p>
          <p>
            A retiree the game didn't keep is just a name &mdash; but if he ever won something, it
            keeps that name. Every award is stored with the winner's name, country, position and
            club at the time, so an honours board still tells you who won a Player of the Season
            forty years ago even though the player himself is long gone from the save. He shows up
            on the awards record book too, and his award still counts for his club and his country.
            There's no career page behind him, so his name isn't a link. This only covers seasons
            played from this update on: on an older save, winners who had already been deleted
            can't be recovered, and the ones still on record when you load it are kept from then on.
          </p>
          <p>
            The permanent career record now holds ten times as many careers as it used to, so a lot
            more retirees keep a full page instead of just a name. It used to be a small number for a
            technical reason that's gone: the whole list was rewritten every time you touched
            anything, so a big one slowed down changing your lineup. It lives in its own place now
            and only new entries get written, which is why it can afford to be big.
          </p>
          <p>
            Separately from that permanent career record, the game keeps a plain name for every
            retiree your save still mentions anywhere &mdash; an old transfer, a news item, an
            awards board, a cup stat line. That's a much shorter record than a career page, so
            there's no limit on it the way there is on the career records: if something in your
            history points at a player, his name stays. It costs about 20 KB a season. This is
            what stops a long save filling up with "Player #4821" where a name should be. He's
            still a name and not a career, so he isn't a link. And it only covers players who
            retire from this update on: anyone your save had already deleted is gone.
          </p>
          <p>
            One more place names survive: the Season Preview's retirements list. Every offseason it
            writes down the biggest names who went, and the game now reads that list back. So a
            player who made that table when he hung his boots up keeps his name everywhere he comes
            up afterwards &mdash; an old transfer, a news item, an awards board &mdash; even if his
            career wasn't big enough to keep. This one works backwards as well as forwards, because
            those lists have been in your save all along, so loading an old league gets some names
            back straight away. Like an award winner, he's a name without a career page, so he isn't
            a link. And because that list records him as he was in his final season, an award he won
            years earlier shows no rating rather than the wrong one.
          </p>
        </Section>

        <Section id="godmode" title="God Mode">
          <p>
            God Mode is an optional sandbox. It's a per-save switch in the top bar. Turn it on any
            time, turn it off any time, and nothing gets penalized or locked. While it's on, the
            usual rules that keep the world realistic just don't apply to you. Your edits ignore
            transfer fees, budgets, the 30-man roster cap, and the depth floor that normally stops
            you gutting a squad. It's for building a dream league, testing an idea, or fixing
            something the sim did that you'd rather it hadn't. Not for a straight, honest career.
          </p>
          <p>What it unlocks while it's on:</p>
          <ul>
            <li><strong>Manage any club.</strong> The <em>God Mode</em> page (it shows up in the sidebar once the switch is on) opens on a Switch Club tab. Pick any club in the world and take charge of it on the spot, no job offer needed and no waiting for the offseason. The club you leave goes straight to the AI, its youth academy graduates onto the senior squad on the way out, and any transfer talks you were holding are dropped. You arrive at the new club knowing its players' ratings but not their ceilings, same as taking a job normally. It goes in your career record as a spell like any other, and the board there starts you on a fresh slate.</li>
            <li><strong>Manage any country.</strong> The same page has a Switch Country tab. Take charge of any national team in the world without waiting for a federation to come calling, and step down again whenever you like. Only countries with enough players born into your world to name a squad are listed, since the rest have no team to manage. The country you leave goes back to the AI and picks its own eleven again from the squad you named, the new one starts you on a fresh slate with its federation, and your club job carries on untouched. If a campaign is already under way you inherit it as it stands. In a spectator save there's nobody for a federation to appoint, so take a club first.</li>
            <li><strong>Edit any player.</strong> Open any player's profile and hit <em>Edit</em>. Change every one of his 14 ratings (OVR recomputes as you go), his potential, name, nationality, age, position, height, and his contract wage and length. You can also clear an injury outright.</li>
            <li><strong>Move players freely.</strong> From a player's profile, send him to any club instantly, with no fee, no budget check, and no cap, or release him to free agency.</li>
            <li><strong>Create players.</strong> The <em>God Mode</em> page has a Create Player tool. Build a player from scratch and drop him onto any club or leave him a free agent.</li>
            <li><strong>Build any club's roster.</strong> The same page lets you pick any club and add, move, or release its players directly.</li>
            <li><strong>Set club finances and identity.</strong> Set any club's budget and hype to whatever you want, and rename or recolor any club.</li>
            <li><strong>See true potential.</strong> The scouting fog lifts while God Mode is on, so every player's exact potential shows everywhere, not an estimate.</li>
          </ul>
          <p>
            What it deliberately <em>won't</em> do: it can't add or delete whole clubs (the shape of
            the world is fixed when you create the save, and the schedule depends on it), it can't
            erase a player from
            history (releasing him to free agency is how you get rid of him), and it can't force a
            match result or rewrite the standings. Everything else about the sim keeps running
            normally around your edits.
          </p>
        </Section>

        <Section id="faq" title="FAQ & Known Quirks">
          <p><strong>How do I win?</strong> You don't, the game never ends. Set your own goal: a title, a decade of dominance, an all-academy XI.</p>
          <p><strong>Can I take over a club in a spectator save, or give mine up in a normal one?</strong> Not in normal play. Which of the two a save is gets decided when you create it and it's fixed from there, so changing your mind usually means starting again. <a href="#godmode">God Mode</a> will let a spectator take charge of a club, since it lets you do most things, but it doesn't work the other way round. See <a href="#spectator">Spectating</a>.</p>
          <p><strong>Where can I see that a player is injured?</strong> Injured players show a red cross on your Roster (on the pitch chip and next to their name in the tables) and on their profile, and your Dashboard has an Injuries list of everyone currently out and roughly how long. They sit out on their own until they're fit.</p>
          <p><strong>Can I change formation?</strong> Yep. Pick from sixteen shapes (4-3-3, 4-4-2, 3-5-2, 5-3-2, 4-2-3-1, 4-5-1, 3-4-3, 5-4-1, 4-3-1-2, 4-4-1-1, 4-3-2-1, 4-2-2-2, 3-4-2-1, 3-5-1-1, 5-2-3, 5-2-1-2) in the dropdown above the pitch on the Roster page. It changes which eleven you field (and so your match strength), and resets your Starting XI to the best fit for the new shape. Or just click <strong>Best XI</strong> next to the dropdown to let the game pick the shape that fields your strongest eleven and fill the lineup for you. Each AI club automatically uses whichever shape fields its own strongest eleven, refreshed at the end of each transfer window (summer and winter).</p>
          <p><strong>Can I go into debt?</strong> AI clubs are tuned never to. You can, by hoarding elite wages past what the base allocation covers. The Finance page shows you the shortfall before it hits. There are no debt consequences yet beyond the number itself.</p>
          <p><strong>I bought a striker in January and his whole season's stats show at my club.</strong> Season stats are one running total per player and show at his current club. There's no per-club split for mid-season movers yet. (Known quirk.)</p>
          <p><strong>A recommended target or incoming offer disappeared.</strong> Both lists are recalculated live from the state of the league, so a target can get bought by an AI club right out from under you, and an offer can drift if the bidding club's situation changes. Deals you've already agreed to are never affected.</p>
          <p><strong>Why can't I release this player?</strong> The depth floor. Releasing him would leave a position without enough cover to field a legal team. Sign or promote cover first.</p>
          <p><strong>Why did his potential drop? Scouts promised 82!</strong> Potential is a forecast that gets re-estimated over time (see <a href="#players">Players</a>). A development setback lowers the realistic ceiling, and the estimate follows it down.</p>
          <p><strong>Why is potential shown as a range like "74&ndash;88"?</strong> You never see a player's exact potential, just a scouting estimate that brackets the real value (see <a href="#players">Players</a>). Raise your <a href="#finance">scouting spend</a> to tighten it, and keep a player on your senior roster for a couple of seasons to reveal his true ceiling. The midpoint isn't the answer, the truth can sit anywhere inside the band.</p>
          <p><strong>Do AI clubs cheat?</strong> Nope. They play by the exact same rules you do: same wages, same budgets, same roster limits, same transfer machinery, no hidden income. The whole league's finances are on the Finance page if you want to check.</p>
          <p><strong>How does a player earn a "League Champion" trophy?</strong> He has to have been in the squad that won it. The credit comes from his own season record at the club, so signing for a club with a trophy cabinet doesn't hand him anything he wasn't there for. The one rough edge is mid-season movers: a title counts for whoever's squad he finished the season in, so a January arrival at the champions gets it and a January departure doesn't.</p>
          <p><strong>Why does the transfers page only show some of the completed deals?</strong> Because drawing all of them is what used to freeze the page. A full world moves thousands of players in a summer window, and rendering every one (each with a flag) was over 10,000 elements and about a megabyte of flag art. You now get all of your own club's business plus the 50 biggest deals elsewhere. The News Feed goes wider &mdash; everything in your own league, and the big moves from the rest of the world &mdash; but it isn't a complete record either, and nothing in the game shows you literally every deal any more. That's deliberate: a full world's transfer log is thousands of rows a season, nearly all of it clubs swapping squad players in countries you don't play in.</p>
          <p><strong>My News Feed got a lot shorter.</strong> On purpose. It used to report all sixteen leagues equally, which came to thousands of rows a season with only about one in ten having anything to do with your club or your league &mdash; the rest was a second-division striker in another country reaching ten career goals. Now your own club is always in, your league is fully covered, and everywhere else has to clear a much higher bar to reach you. Goal milestones moved with it: they used to fire every ten goals, which meant almost everyone hit one constantly, and now a career milestone starts at 50 and a season milestone at 25. Old saves get the same treatment, so a feed that was already buried clears out too. Nothing was deleted &mdash; the milestones you'd already earned just aren't headlines any more. There's also a ceiling per season now: a season shows its 150 biggest stories and says how many it held back, for the same reason the transfers page has one. The feed is kept forever and only ever grows, so on a long save it was heading for the same freeze. Anything involving your own club is always shown, however deep into the season it falls.</p>
          <p><strong>My player's cup stats suddenly went up a lot.</strong> They were wrong before, and now they're right. The Continental Cup has three stages, and cup stats used to count only the knockout ties, so league-phase and playoff games never showed up on anyone's profile at all. They all count now, including for past seasons, so appearances and goals jump for anyone who played group games. Nothing was inflated, it was under-counted.</p>
          <p><strong>Where did all the free agents go?</strong> Once a free agent turns 24, has never been any good in his career, and isn't projected to become good, he's permanently removed from the game. Nothing ever cleared these players out before, so a long save built up thousands of them, which bloated saves badly. Anyone under 24 is kept, so your incoming talent list is unaffected, as is anyone with real potential left and any former star who's since declined.</p>
          <p><strong>Why does the game get slower the longer I play?</strong> It used to be because the entire save was rewritten every time anything happened, so the more history you'd built up, the more every single click cost. Players are now stored individually and only the ones that actually changed get written, so signing someone or setting your lineup no longer depends on how long you've been playing. What's left is the running history a save keeps (power rankings, transfers, news, past seasons), which is still rewritten in full, so there's still some growth. Simming is a separate cost. Advancing hands your save to a background worker and takes it back again, so it scales with the whole save rather than with what changed. The heaviest thing in there was match reports: every game played this season keeps its full box score and event timeline, which on a big world is most of your save by the end of a season, and it was enough to run a phone out of memory and crash the tab. The worker no longer gets them, along with the retiree archive and the power rankings history, none of which it read. On a real 60-season save that took the end of a season from 222 MB to 99 MB, and the copy from 4.8 seconds to 1.2. Note this was never about how long you'd been playing: match reports clear every offseason, so it depended on how big your world is and how far into the season you were. A very old save is still large, so this makes the crash much less likely rather than impossible.</p>
          <p><strong>A page showed me an error box instead of the page.</strong> Something in the game broke while drawing that page. Your save isn't affected and nothing was written to it, so you can use the menu to go somewhere else, or hit Try again to have another go at the page. The error details are there to copy into a bug report, and the crash is reported automatically too. There's a known one on the Transfers page that hasn't been pinned down yet, so if you hit it there, the details are genuinely useful.</p>
        </Section>
      </div>
    </div>
  );
}
