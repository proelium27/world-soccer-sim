import type { Player } from "../../core/players/types.js";
import { faTransferLocked } from "../../core/freeAgency.js";
import { seasonYear } from "../format.js";
import { Dropdown } from "./Dropdown.js";

export interface ListingMenuProps {
  player: Player;
  season: number;
  transferListed: boolean;
  loanListed: boolean;
  /** False when loaning him out would drop the squad below the depth floor at his position. */
  keepsDepthFloor: boolean;
  /**
   * True when he has already changed clubs in the open window, so nobody will
   * bid until the next one (see movedThisWindow). Loaning him out is still
   * fine — a loan isn't a transfer of ownership.
   */
  movedThisWindow?: boolean;
  /** Loan listings are only accepted while a transfer window is open, same as the Loans page. */
  windowOpen: boolean;
  onToggleTransferListed: (pid: number, listed: boolean) => void;
  onToggleLoanListed: (pid: number, listed: boolean) => void;
}

/**
 * The one "List" control on a roster row: sell him, or send him out on loan.
 *
 * Both live in one dropdown rather than two buttons because a roster row
 * already carries Extend, More minutes and Release, and the two listings are
 * the same decision seen twice ("I'd let him go"). Sharing one component also
 * keeps the gates from drifting between the XI/bench tables and the pitch
 * popover, which render the identical menu.
 *
 * A blocked action stays visible as a disabled item whose *label* is the
 * reason, so the explanation survives on touch devices where a title tooltip
 * never appears. Loan listings are always the 1-season default; the duration
 * picker stays on the Loans page.
 */
export function ListingMenu({
  player, season, transferListed, loanListed, keepsDepthFloor, windowOpen,
  movedThisWindow = false,
  onToggleTransferListed, onToggleLoanListed,
}: ListingMenuProps) {
  const faLocked = faTransferLocked(player, season);
  const saleLocked = faLocked || movedThisWindow;
  const saleLockedLabel = faLocked
    ? "Can't sell yet (just signed)"
    : "Can't sell yet (just moved)";
  const saleLockedTitle = faLocked
    ? `You signed him from free agency, so he can't be sold until ${seasonYear(player.faSignedSeason! + 1)}.`
    : "He's already changed clubs this window, so nobody will bid until the next one opens.";
  const listed = transferListed || loanListed;
  const listedWhat = transferListed && loanListed
    ? "Listed for transfer and for loan."
    : transferListed
      ? "Listed for transfer."
      : loanListed
        ? "Listed for a 1 season loan."
        : "";

  return (
    <Dropdown
      alignEnd
      label="List"
      buttonClassName={
        "btn btn-sm dropdown-toggle text-nowrap " +
        (listed ? "btn-warning" : "btn-outline-warning")
      }
      title={
        listed
          ? listedWhat
          : "Offer him around: list him for transfer, or send him out on loan."
      }
    >
      {saleLocked ? (
        <li>
          <button
            type="button"
            className="dropdown-item"
            disabled
            title={saleLockedTitle}
          >
            {saleLockedLabel}
          </button>
        </li>
      ) : (
        <li>
          <button
            type="button"
            className="dropdown-item"
            onClick={() => onToggleTransferListed(player.pid, !transferListed)}
            title="Listing signals AI clubs you're willing to sell, making an offer more likely."
          >
            {transferListed ? "Remove transfer listing" : "List for transfer"}
          </button>
        </li>
      )}
      {loanListed ? (
        <li>
          <button
            type="button"
            className="dropdown-item"
            onClick={() => onToggleLoanListed(player.pid, false)}
            title="He's listed for a 1 season loan. Change the duration or see offers on the Loans page."
          >
            Remove loan listing
          </button>
        </li>
      ) : !windowOpen ? (
        <li>
          <button type="button" className="dropdown-item" disabled>
            Loans need an open window
          </button>
        </li>
      ) : !keepsDepthFloor ? (
        <li>
          <button type="button" className="dropdown-item" disabled>
            Too thin at {player.pos} to loan him out
          </button>
        </li>
      ) : (
        <li>
          <button
            type="button"
            className="dropdown-item"
            onClick={() => onToggleLoanListed(player.pid, true)}
            title="Lists him for a 1 season loan so AI clubs can make an offer. Pick a longer loan on the Loans page."
          >
            List for loan (1 season)
          </button>
        </li>
      )}
    </Dropdown>
  );
}
