import { Link } from "react-router-dom";
import type { FormationId } from "../../core/lineup/formations.js";
import { FORMATIONS } from "../../core/lineup/formations.js";
import { assignLayoutIndices, layoutSlots } from "../pitchLayout.js";
import type { LiveLine, LiveSide } from "../live/liveRatings.js";
import { BallIcon, BootIcon, CardIcon, SubInIcon } from "./matchEvents.js";
import { shortName } from "../playerName.js";

/**
 * Both starting elevens on one pitch, the way a match is actually drawn:
 * home on the left attacking right, away on the right attacking left, each
 * chip carrying that player's rating and what he has done so far.
 *
 * It reuses `FORMATION_LAYOUTS` rather than defining its own coordinates. Those
 * are the same numbers the Roster page's pitch uses, so a 4-3-3 sits in the
 * same shape on both screens — a second table would drift the moment either was
 * retuned. The layouts are drawn horizontally with x:0 at a side's own goal, so
 * a side occupies a half by halving x, and the away side is rotated 180
 * degrees (both axes) because that is what turning a team round does.
 *
 * A pitch is a picture, and this one is on the screen a screen reader user
 * asked for. So it is an ordered list first and a diagram second: chips sit in
 * formation order in the DOM, every one carries a full sentence describing the
 * player, and the icons are decoration on top of text that already says the
 * same thing. There is deliberately no separate text lineup beside it — two
 * copies of one team sheet means hearing the eleven twice.
 */

/** Where a chip sits, as percentages of the pitch box. */
function place(
  x: number,
  y: number,
  side: "home" | "away",
  vertical: boolean,
): { left: string; top: string } {
  // Own half: home takes 0-50 of the attacking axis, away 50-100 reversed.
  const along = side === "home" ? x / 2 : 100 - x / 2;
  const across = side === "home" ? y : 100 - y;
  return vertical
    ? { left: `${across}%`, top: `${100 - along}%` }
    : { left: `${along}%`, top: `${across}%` };
}

/** Match ratings run 0-10; these are the bands the box score already colours by. */
function ratingTone(rating: number): string {
  if (rating >= 8) return "mp-rating--great";
  if (rating >= 7) return "mp-rating--good";
  if (rating < 6) return "mp-rating--poor";
  return "";
}

/** 1st, 2nd, 3rd, 4th — including the 11th-13th exceptions that catch every naive version. */
function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** The sentence a screen reader gets. Everything the icons and the pill say. */
function describe(line: LiveLine, name: string): string {
  const bits: string[] = [];
  if (line.slot) bits.push(line.slot);
  bits.push(name);
  if (line.rating !== null) bits.push(`rating ${line.rating.toFixed(1)}`);
  if (line.goals === 1) bits.push("1 goal");
  else if (line.goals > 1) bits.push(`${line.goals} goals`);
  if (line.assists === 1) bits.push("1 assist");
  else if (line.assists > 1) bits.push(`${line.assists} assists`);
  if (line.redCards > 0) bits.push("sent off");
  else if (line.yellowCards > 1) bits.push("booked twice");
  else if (line.yellowCards === 1) bits.push("booked");
  if (line.from > 0) bits.push(`came on in the ${ordinal(line.from)} minute`);
  return `${bits.join(". ")}.`;
}

function Chip({
  line,
  name,
  colors,
  style,
}: {
  line: LiveLine;
  name: string;
  colors: [string, string];
  style: { left: string; top: string };
}) {
  // Capped so a hat-trick doesn't push the chip wider than its neighbours; the
  // count beside it carries the rest, and the hidden sentence always has it.
  const balls = Math.min(line.goals, 3);
  return (
    <li className="mp-chip" style={style}>
      <span className="visually-hidden">{describe(line, name)}</span>
      <span className="mp-shirt" style={{ background: colors[0], borderColor: colors[1] }}>
        <span className="mp-slot">{line.slot ?? "?"}</span>
      </span>
      {line.rating !== null && (
        <span className={`mp-rating stat-num ${ratingTone(line.rating)}`} aria-hidden="true">
          {line.rating.toFixed(1)}
        </span>
      )}
      <span className="mp-marks" aria-hidden="true">
        {Array.from({ length: balls }, (_, i) => (
          <span key={`g${i}`} className="mp-mark mp-mark--goal">
            <BallIcon size={9} />
          </span>
        ))}
        {line.goals > 3 && <span className="mp-mark mp-mark--more">x{line.goals}</span>}
        {line.assists > 0 && (
          <span className="mp-mark mp-mark--assist">
            <BootIcon size={9} />
          </span>
        )}
        {line.redCards > 0 ? (
          <span className="mp-mark mp-mark--red">
            <CardIcon size={7} />
          </span>
        ) : (
          line.yellowCards > 0 && (
            <span className="mp-mark mp-mark--yellow">
              <CardIcon size={7} />
            </span>
          )
        )}
        {line.from > 0 && (
          <span className="mp-mark mp-mark--on">
            <SubInIcon size={8} />
          </span>
        )}
      </span>
      <Link to={`/player/${line.pid}`} className="mp-name" aria-hidden="true" tabIndex={-1}>
        {shortName(name)}
      </Link>
    </li>
  );
}

function sideChips(
  side: LiveSide,
  formation: FormationId | null,
  which: "home" | "away",
  vertical: boolean,
  colors: [string, string],
  playerName: (pid: number) => string,
) {
  // With no nameable shape there are no coordinates to use, so fall back to
  // 4-3-3's — the chips still land in a sane spread rather than on top of each
  // other, which is the only thing the picture owes anyone here.
  const shape: FormationId = formation ?? "4-3-3";
  const coords = layoutSlots(shape);
  const indices = assignLayoutIndices(
    FORMATIONS[shape],
    side.onPitch.map((l) => l.slot),
  );
  return side.onPitch.map((line, i) => {
    const coord = coords[indices[i]] ?? coords[0];
    return (
      <Chip
        key={line.pid}
        line={line}
        name={playerName(line.pid)}
        colors={colors}
        style={place(coord.x, coord.y, which, vertical)}
      />
    );
  });
}

export function MatchPitch({
  home,
  away,
  homeFormation,
  awayFormation,
  homeName,
  awayName,
  homeColors,
  awayColors,
  playerName,
  vertical,
}: {
  home: LiveSide;
  away: LiveSide;
  homeFormation: FormationId | null;
  awayFormation: FormationId | null;
  homeName: string;
  awayName: string;
  homeColors: [string, string];
  awayColors: [string, string];
  playerName: (pid: number) => string;
  /** Portrait on a narrow screen, where two elevens across the width don't fit. */
  vertical: boolean;
}) {
  return (
    <div className={`mp-pitch${vertical ? " mp-pitch--vertical" : ""}`}>
      {/* Markings only. Everything a reader needs is in the chips. */}
      <div className="mp-markings" aria-hidden="true">
        <span className="mp-halfway" />
        <span className="mp-circle" />
        <span className="mp-box mp-box--home" />
        <span className="mp-box mp-box--away" />
      </div>
      <ol className="mp-side" aria-label={`${homeName} lineup`}>
        {sideChips(home, homeFormation, "home", vertical, homeColors, playerName)}
      </ol>
      <ol className="mp-side" aria-label={`${awayName} lineup`}>
        {sideChips(away, awayFormation, "away", vertical, awayColors, playerName)}
      </ol>
    </div>
  );
}
