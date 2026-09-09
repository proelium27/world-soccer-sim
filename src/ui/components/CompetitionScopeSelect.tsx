import type { Competition, CompetitionScope } from "../../core/competitions.js";
import {
  TOP_LEAGUE_COUNTRY_COUNT, countriesOf, decodeScope, encodeScope, strongestCountries,
} from "../../core/competitions.js";

/**
 * "Where to look" as one control: everything, a tier across the world, the
 * strongest countries' top flights, one country, or one competition.
 *
 * One `<select>` rather than a country picker beside a tier picker beside a
 * competition picker, because each of the questions people ask ("the top
 * divisions", "the big five", "the Spanish second tier") is a single thought
 * and three dropdowns to express one thought is what makes a filter bar
 * unreadable. Optgroups keep the presets, the countries and the individual
 * competitions apart.
 *
 * The presets are **derived from the world's own strength ladder**, never from
 * a list of country names — see `strongestCountries`. In the shipped world the
 * top-five preset lands exactly on the big four plus France; in a world where
 * someone has added or retuned a league it lands on whatever is actually
 * strongest there, instead of quietly lying.
 */
interface Props {
  competitions: Competition[];
  value: CompetitionScope;
  onChange: (scope: CompetitionScope) => void;
  className?: string;
  style?: React.CSSProperties;
  id?: string;
}

/** Tiers present in this world, ascending — a custom world may have one or three. */
function tiersOf(competitions: Competition[]): number[] {
  return [...new Set(competitions.map((c) => c.tier))].sort((a, b) => a - b);
}

const TIER_LABEL: Record<number, string> = {
  1: "Top divisions only",
  2: "Second divisions only",
  3: "Third divisions only",
};

export function CompetitionScopeSelect({
  competitions, value, onChange, className, style, id,
}: Props) {
  const countries = countriesOf(competitions);
  const tiers = tiersOf(competitions);
  const topCountries = strongestCountries(competitions, TOP_LEAGUE_COUNTRY_COUNT);
  // Only worth offering when it is actually narrower than "top divisions".
  const showTopLeagues = topCountries.length < countries.length;

  return (
    <select
      id={id}
      className={className ?? "form-select form-select-sm"}
      style={style ?? { width: "13rem" }}
      value={encodeScope(value)}
      onChange={(e) => onChange(decodeScope(e.target.value))}
    >
      <option value="all">All competitions</option>
      <optgroup label="Presets">
        {showTopLeagues && (
          <option
            value={encodeScope({ kind: "topLeagues", countries: TOP_LEAGUE_COUNTRY_COUNT })}
            title={`Top flights of the ${TOP_LEAGUE_COUNTRY_COUNT} strongest countries: ${topCountries.join(", ")}`}
          >
            Top {TOP_LEAGUE_COUNTRY_COUNT} leagues
          </option>
        )}
        {tiers.map((tier) => (
          <option key={tier} value={encodeScope({ kind: "tier", tier })}>
            {TIER_LABEL[tier] ?? `Tier ${tier} only`}
          </option>
        ))}
      </optgroup>
      <optgroup label="Countries">
        {countries.map((country) => (
          <option key={country} value={encodeScope({ kind: "country", country })}>
            {country} (all divisions)
          </option>
        ))}
      </optgroup>
      {countries.map((country) => (
        <optgroup key={country} label={country}>
          {competitions.filter((c) => c.country === country).map((c) => (
            <option key={c.id} value={encodeScope({ kind: "competition", compId: c.id })}>
              {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
