import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Per-route document metadata.
 *
 * The whole game is one client-side app served from a single index.html, so
 * every route starts life with the same <head>. This module rewrites the parts
 * that matter for search and link previews once React knows which route is
 * actually showing.
 *
 * The split that drives everything here: only a handful of routes render real
 * content to a visitor with no saved league. Every other route sits behind
 * Layout, which bounces to /leagues when no save is loaded — so to a crawler
 * they are all the same page. Those get `noindex` and no canonical rather than
 * being indexed as a pile of duplicates.
 */

/** Production origin. Canonical URLs must be absolute, so this can't be relative. */
export const SITE_ORIGIN = "https://worldsoccersim.org";

/** Fallback description, matching the one hard-coded in index.html. */
const DEFAULT_DESCRIPTION =
  "Free browser soccer manager game. Take over a club, sign players, work the transfer market, run a youth academy and chase the title across 36 leagues and 626 clubs.";

interface PageSeo {
  /** Page title, rendered as "<title> | <brand>". Empty means brand only. */
  title: string;
  description: string;
  /**
   * Path to canonicalize to. Present = indexable. Absent = the page needs a
   * loaded save to show anything, so it's marked noindex instead.
   */
  canonical?: string;
}

/**
 * Static routes. `/` and `/leagues` are the same destination in practice (`/`
 * redirects), so both canonicalize to `/` and the duplicate collapses.
 */
const ROUTES: Record<string, PageSeo> = {
  "/": {
    title: "",
    description: DEFAULT_DESCRIPTION,
    canonical: "/",
  },
  "/leagues": {
    title: "",
    description: DEFAULT_DESCRIPTION,
    canonical: "/",
  },
  "/new-league": {
    title: "Start a new league",
    description:
      "Create a new save: pick a country, pick the club you want to manage, and customize team names before kickoff.",
    canonical: "/new-league",
  },
  "/manual": {
    title: "Manual",
    description:
      "How the game works: ratings and potential, formations and tactics, transfers and contracts, the youth academy, scouting, finances, cups and international football.",
    canonical: "/manual",
  },
  "/changelog": {
    title: "Changelog",
    description:
      "Every update to World Soccer Simulator, newest first: new features, rule changes and fixes, with the date each one shipped.",
    canonical: "/changelog",
  },
};

/**
 * Titles for the save-gated pages. None of these are indexable, but a real
 * title still beats the bare brand in the tab strip and in browser history.
 */
const APP_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/standings": "Standings",
  "/cup": "Continental Cup",
  "/domestic-cup": "Domestic Cup",
  "/power-rankings": "Power rankings",
  "/schedule": "Schedule",
  "/news": "News",
  "/awards": "Awards",
  "/history": "Club history",
  "/frivolities": "Frivolities",
  "/season-preview": "Season preview",
  "/set-scouting": "Scouting",
  "/roster": "Roster",
  "/leaders": "Stat leaders",
  "/free-agents": "Free agents",
  "/academy": "Academy",
  "/transfers": "Transfers",
  "/incoming-offers": "Incoming offers",
  "/loans": "Loans",
  "/finance": "Finance",
  "/god-mode": "God mode",
  "/national-teams/world-cup": "World Cup",
  "/national-teams/qualifying": "Qualifying",
  "/national-teams/schedule": "International schedule",
  "/national-teams/rosters": "National team rosters",
  "/national-teams/power-rankings": "National team rankings",
  "/national-teams/leaders": "International stat leaders",
  "/national-teams/history": "International history",
};

/** Prefix matches for the routes that carry an id segment. */
const APP_PREFIXES: [string, string][] = [
  ["/player/", "Player"],
  ["/box-score/", "Box score"],
];

function lookup(pathname: string): PageSeo {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

  const content = ROUTES[path];
  if (content) return content;

  const appTitle =
    APP_TITLES[path] ?? APP_PREFIXES.find(([prefix]) => path.startsWith(prefix))?.[1] ?? "";

  // No canonical: everything here is behind a loaded save, so it's noindex.
  return { title: appTitle, description: DEFAULT_DESCRIPTION };
}

/**
 * Upsert a <meta> tag by name. Tags added here are marked so they can be told
 * apart from whatever index.html shipped with, though in practice we only ever
 * rewrite the same three.
 */
function setMeta(name: string, content: string): void {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("name", name);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

/** Upsert a <meta property="..."> tag (Open Graph uses `property`, not `name`). */
function setProperty(property: string, content: string): void {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute("property", property);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

/** Set the canonical link, or drop it entirely when `href` is null. */
function setCanonical(href: string | null): void {
  const existing = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (href === null) {
    existing?.remove();
    return;
  }
  const tag = existing ?? document.createElement("link");
  tag.setAttribute("rel", "canonical");
  tag.setAttribute("href", href);
  if (!existing) document.head.appendChild(tag);
}

/**
 * Keeps <head> in sync with the current route. Mounted once, near the top of
 * the tree. This owns `document.title` outright — nothing else should write it,
 * or the two will fight over which one ran last.
 */
export function useRouteSeo(brand: string): void {
  const { pathname } = useLocation();

  useEffect(() => {
    const page = lookup(pathname);

    const title = page.title ? `${page.title} | ${brand}` : brand;
    document.title = title;

    setMeta("description", page.description);
    setProperty("og:title", title);
    setProperty("og:description", page.description);
    setMeta("twitter:title", title);
    setMeta("twitter:description", page.description);

    if (page.canonical) {
      const url = `${SITE_ORIGIN}${page.canonical}`;
      setCanonical(url);
      setProperty("og:url", url);
      setMeta("robots", "index, follow, max-image-preview:large");
    } else {
      setCanonical(null);
      setProperty("og:url", SITE_ORIGIN + "/");
      setMeta("robots", "noindex, follow");
    }
  }, [pathname, brand]);
}
