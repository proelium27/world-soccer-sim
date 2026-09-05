import { lazy, Suspense } from "react";
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { LeagueProvider } from "./context/LeagueContext.js";
import { SportNameProvider, useSportName } from "./sportName.js";
import { useRouteSeo } from "./seo.js";
import { Layout } from "./components/Layout.js";
import { AnnouncementBanner } from "./components/AnnouncementBanner.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { ClubOnly } from "./components/ClubOnly.js";
import { Leagues } from "./pages/Leagues.js";
import { NewLeague } from "./pages/NewLeague.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Standings } from "./pages/Standings.js";
import { Cup, Shield } from "./pages/Cup.js";
import { DomesticCup } from "./pages/DomesticCup.js";
import { PromotionPlayoffs } from "./pages/PromotionPlayoffs.js";
import { ChampionsCups } from "./pages/ChampionsCups.js";
import { NTWorldCup } from "./pages/nationalTeams/WorldCup.js";
import { NTMySquad } from "./pages/nationalTeams/MySquad.js";
import { NTPlayerPool } from "./pages/nationalTeams/PlayerPool.js";
import { NTFederation } from "./pages/nationalTeams/Federation.js";
import { NTQualifying } from "./pages/nationalTeams/Qualifying.js";
import { NTConfederationCups } from "./pages/nationalTeams/ConfederationCups.js";
import { NTSchedule } from "./pages/nationalTeams/Schedule.js";
import { NTRosters } from "./pages/nationalTeams/Rosters.js";
import { NTPowerRankings } from "./pages/nationalTeams/PowerRankings.js";
import { NTStatLeaders } from "./pages/nationalTeams/StatLeaders.js";
import { NTHistory } from "./pages/nationalTeams/History.js";
import { Frivolities } from "./pages/Frivolities.js";
import { PowerRankings } from "./pages/PowerRankings.js";
import { Schedule } from "./pages/Schedule.js";
import { Roster } from "./pages/Roster.js";
import { Leaders } from "./pages/Leaders.js";
import { BoxScore } from "./pages/BoxScore.js";
import { YouthIntake } from "./pages/YouthIntake.js";
import { FreeAgents } from "./pages/FreeAgents.js";
import { Academy } from "./pages/Academy.js";
import { Transfers } from "./pages/Transfers.js";
import { Watchlist } from "./pages/Watchlist.js";
import { IncomingOffers } from "./pages/IncomingOffers.js";
import { Loans } from "./pages/Loans.js";
import { Finance } from "./pages/Finance.js";
import { GodMode } from "./pages/GodMode.js";
import { Manager } from "./pages/Manager.js";
import { NewsFeed } from "./pages/NewsFeed.js";
import { Awards } from "./pages/Awards.js";
import { ClubHistory } from "./pages/ClubHistory.js";
import { SeasonHistory } from "./pages/SeasonHistory.js";
import { ClubSeason } from "./pages/ClubSeason.js";
import { SeasonPreview } from "./pages/SeasonPreview.js";
import { SetScouting } from "./pages/SetScouting.js";
import { Manual } from "./pages/Manual.js";
/**
 * The one lazily-loaded route. Changelog entries are markdown, and
 * react-markdown plus remark-gfm is ~158 kB raw / ~48 kB gzipped — a real cost
 * to put in front of every player for a page most open once, if ever. Split
 * out, it is fetched only when someone actually opens /changelog.
 *
 * Nothing else here is lazy: the rest of the app shares the same handful of
 * dependencies, so splitting those routes would trade one download for many
 * without shrinking the total.
 */
const Changelog = lazy(() =>
  import("./pages/Changelog.js").then((m) => ({ default: m.Changelog })),
);
import { PlayerProfile } from "./pages/PlayerProfile.js";

function RootRedirect() {
  return <Navigate to="/leagues" replace />;
}

/**
 * Keeps <head> (title, description, canonical, robots) in step with the route.
 * Renders nothing — it exists purely for the effect, and has to sit inside both
 * the router and the sport-name provider to read either one.
 */
function RouteSeo() {
  const { brand } = useSportName();
  useRouteSeo(brand);
  return null;
}

// itch.io and CrazyGames both serve the game from a deep subpath inside an
// iframe with no server to handle history-API deep links, so those builds swap
// to hash-based routes (/#/roster). Every other target keeps clean URLs. Driven
// by the build mode (see .env.itch / .env.crazygames / vite.config.ts).
const crazyGames = import.meta.env.VITE_BUILD_TARGET === "crazygames";
const embedded = import.meta.env.VITE_BUILD_TARGET === "itch" || crazyGames;
const Router = embedded ? HashRouter : BrowserRouter;

// Where the app is mounted on its host. "/" for our own domain, "/soccer-gm/"
// on a GitHub Pages project page — BASE_URL is whatever `base` the build used,
// so this tracks vite.config.ts automatically and needs no target flag of its
// own. Without it every route under a subpath falls through to no match: React
// Router would read the browser's "/soccer-gm/manual" and look for a
// "/soccer-gm/manual" route, which does not exist.
//
// Undefined for the hash builds: their base is the relative "./", which is not
// a URL path, and a hash router has no path prefix to strip in the first place.
const basename = embedded ? undefined : import.meta.env.BASE_URL;

// The CrazyGames build strips the SEO block from index.html, so it must not run
// the runtime half either — useRouteSeo would recreate the canonical tag, which
// points at worldsoccersim.org, a playable copy of this same game. Their rules
// don't allow linking one from the other.
const seoEnabled = !crazyGames;

// The announcement banner is dropped from the CrazyGames build for two reasons
// that happen to agree. Space: their container is a fixed 16:9 box as small as
// 914x514, where the strip costs 36px of 514 — 7% of the height, on every
// screen, permanently for anyone who doesn't dismiss it. Rules: it is a
// full-width bar whose action is "Join the Discord", and community links are
// allowed on a game menu only so long as they aren't a main CTA. The same link
// still sits in the sidebar, which is squarely within what they allow.
const announcementEnabled = !crazyGames;

export function App() {
  return (
    <Router basename={basename}>
      <SportNameProvider>
      {seoEnabled && <RouteSeo />}
      <LeagueProvider>
        {announcementEnabled && <AnnouncementBanner />}
        {/* Outer net for the routes that render outside Layout (the league
            picker and new-league flow), which have no boundary of their own.
            Pages inside Layout get a per-route boundary that keeps the nav
            alive, so this one only catches what that can't reach. */}
        <ErrorBoundary what="the game">
        <Routes>
          <Route path="/leagues" element={<Leagues />} />
          <Route path="/new-league" element={<NewLeague />} />
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/standings" element={<Standings />} />
            <Route path="/cup" element={<Cup />} />
            <Route path="/shield" element={<Shield />} />
            <Route path="/domestic-cup" element={<DomesticCup />} />
            <Route path="/promotion-playoffs" element={<PromotionPlayoffs />} />
            <Route path="/champions-cups" element={<ChampionsCups />} />
            <Route path="/national-teams/my-squad" element={<NTMySquad />} />
            <Route path="/national-teams/player-pool" element={<NTPlayerPool />} />
            <Route path="/national-teams/federation" element={<NTFederation />} />
            <Route path="/national-teams/world-cup" element={<NTWorldCup />} />
            <Route path="/national-teams/qualifying" element={<NTQualifying />} />
            <Route path="/national-teams/confederation-cups" element={<NTConfederationCups />} />
            <Route path="/national-teams/schedule" element={<NTSchedule />} />
            <Route path="/national-teams/rosters" element={<NTRosters />} />
            <Route path="/national-teams/power-rankings" element={<NTPowerRankings />} />
            <Route path="/national-teams/leaders" element={<NTStatLeaders />} />
            <Route path="/national-teams/history" element={<NTHistory />} />
            {/* Old single International page → the World Cup tab of the new section. */}
            <Route path="/international" element={<Navigate to="/national-teams/world-cup" replace />} />
            <Route path="/power-rankings" element={<PowerRankings />} />
            {/* Club-only despite living under League in the sidebar: the page
                is your club's fixture list and nothing else, so without a club
                it is an empty table rather than a world schedule. */}
            <Route path="/schedule" element={<ClubOnly><Schedule /></ClubOnly>} />
            <Route path="/news" element={<NewsFeed />} />
            <Route path="/awards" element={<Awards />} />
            {/* Every season on one page, a line each. Not ClubOnly: it is a
                record of the whole world, which a spectator save has as much
                of as a managed one. */}
            <Route path="/season-history" element={<SeasonHistory />} />
            <Route path="/history" element={<ClubHistory />} />
            {/* One club, one season: squad, league finish, cup runs, power ranking. */}
            <Route path="/club/:tid/:season" element={<ClubSeason />} />
            <Route path="/frivolities" element={<Frivolities />} />
            <Route path="/season-preview" element={<SeasonPreview />} />
            <Route path="/set-scouting" element={<ClubOnly><SetScouting /></ClubOnly>} />
            <Route path="/box-score/:matchIndex" element={<BoxScore />} />
            {/* Club-only. A spectator reaches these by URL alone (the sidebar
                drops them), and ClubOnly answers with "you're spectating"
                rather than the "Team not found." each page would otherwise
                show. The watchlist is deliberately NOT in here: it is a note
                about players anywhere in the world, not an instruction to a
                club, which is the same reason switchClub keeps it. */}
            <Route path="/roster" element={<ClubOnly><Roster /></ClubOnly>} />
            <Route path="/leaders" element={<Leaders />} />
            {/* Club-only like the rest of this block: a trial group is an
                offer to YOUR academy, so a spectator save has none. */}
            <Route path="/youth-intake" element={<ClubOnly><YouthIntake /></ClubOnly>} />
            {/* The old Incoming Talent path: keep it working rather than 404 a
                bookmark, and it lands on what replaced it. The redirect is
                deliberately NOT wrapped — it resolves to /youth-intake, which
                does the gating, so wrapping here would answer "you're
                spectating" at a URL that is only ever a forwarding address. */}
            <Route path="/incoming-talent" element={<Navigate to="/youth-intake" replace />} />
            <Route path="/free-agents" element={<ClubOnly><FreeAgents /></ClubOnly>} />
            <Route path="/academy" element={<ClubOnly><Academy /></ClubOnly>} />
            <Route path="/transfers" element={<ClubOnly><Transfers /></ClubOnly>} />
            <Route path="/watchlist" element={<Watchlist />} />
            <Route path="/incoming-offers" element={<ClubOnly><IncomingOffers /></ClubOnly>} />
            <Route path="/loans" element={<ClubOnly><Loans /></ClubOnly>} />
            <Route path="/finance" element={<ClubOnly><Finance /></ClubOnly>} />
            <Route path="/manager" element={<ClubOnly><Manager /></ClubOnly>} />
            <Route path="/god-mode" element={<GodMode />} />
            <Route path="/player/:pid" element={<PlayerProfile />} />
          </Route>
          {/* The manual and the changelog are plain reading material — they
              don't touch league state, so they render with or without a save
              loaded. That matters beyond convenience: they're the only pages a
              search engine (or anyone following a shared link) can actually
              read, and behind the normal Layout gate they just bounced to the
              league picker. */}
          <Route element={<Layout allowNoLeague />}>
            <Route path="/manual" element={<Manual />} />
            <Route
              path="/changelog"
              element={
                // Falls back to the page's own heading rather than a spinner,
                // so the chunk arriving reads as the list filling in rather
                // than the page replacing itself.
                <Suspense fallback={<div className="container-fluid p-3"><h1 className="h4">Changelog</h1></div>}>
                  <Changelog />
                </Suspense>
              }
            />
          </Route>
          <Route path="*" element={<RootRedirect />} />
        </Routes>
        </ErrorBoundary>
      </LeagueProvider>
      </SportNameProvider>
    </Router>
  );
}
