import { describe, it, expect } from "vitest";
import { shortName } from "../../src/ui/playerName.js";
import { NATIONALITIES, OTHER_NATIONS, UNLISTED_NATIONALITIES } from "../../src/core/players/nationalities.js";

/**
 * The one-word label five surfaces use when there is only room for a surname.
 *
 * Every one of them used to take the last whitespace-separated word, which
 * reads a surname off its own end: the shipped pools store the particle as part
 * of the entry ("van Dijk", "De Luca"), so "Jan Van Loo" came out as "Loo".
 */
describe("shortName", () => {
  it("keeps a plain surname exactly as it was", () => {
    expect(shortName("Danny Palmer")).toBe("Palmer");
    expect(shortName("Mikkel Toft")).toBe("Toft");
  });

  it("keeps a particle with the surname it belongs to", () => {
    expect(shortName("Jan Van Loo")).toBe("Van Loo");
    expect(shortName("Kees van Dijk")).toBe("van Dijk");
    expect(shortName("Paolo De Luca")).toBe("De Luca");
    expect(shortName("Joao Da Silva")).toBe("Da Silva");
    expect(shortName("Mohamed Ben Ali")).toBe("Ben Ali");
  });

  it("does not eat a given name that happens to be a particle", () => {
    // The trap this guards: "Ben" and "Le" are first names too, and a
    // two-word name's first word is never part of the surname.
    expect(shortName("Ben Carter")).toBe("Carter");
    expect(shortName("Le Nguyen")).toBe("Nguyen");
    expect(shortName("De Vries")).toBe("Vries");
  });

  it("handles more than one particle", () => {
    expect(shortName("Sergio de la Cruz")).toBe("de la Cruz");
  });

  it("survives odd input rather than throwing", () => {
    expect(shortName("")).toBe("");
    expect(shortName("   ")).toBe("   ");
    expect(shortName("Pele")).toBe("Pele");
    expect(shortName("  Danny   Palmer  ")).toBe("Palmer");
  });

  /**
   * The particle list was read off the shipped surname pools, so it has to
   * still cover them. A pool entry gaining a particle nobody listed is exactly
   * how this silently goes back to printing half a surname.
   */
  it("covers every multi-word surname the game can generate", () => {
    const pools = [
      ...Object.values(NATIONALITIES),
      ...Object.values(OTHER_NATIONS),
      ...Object.values(UNLISTED_NATIONALITIES),
    ];
    const missed: string[] = [];
    for (const nat of pools) {
      for (const last of nat.last) {
        if (!last.includes(" ")) continue;
        // A generated name is "<first> <last>"; the label must give back the
        // whole surname rather than its tail.
        if (shortName(`Testfirst ${last}`) !== last) missed.push(last);
      }
    }
    expect(missed).toEqual([]);
  });
});
