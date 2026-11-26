import { describe, expect, it } from "vitest";

import {
  chainageAt,
  chainageRange,
  distanceAlongFor,
  InvalidInput,
  milestonesFor,
  type ChainageFrame,
} from "../src/index";

/**
 * Kilometre posts, and the two assumptions that make them wrong.
 *
 * The audited intake computed a parcel's abscissa as `ST_LineLocatePoint(ST_GeometryN(geom, 1), c)`
 * — a fraction of the **first part** of a multi-part route, taken in EPSG:4326 — multiplied by the
 * **projected length of that same first part**. Three errors compounding: only one part of the
 * route, a fraction measured in degrees, and that part's length standing in for the whole. On a
 * single straight segment near the equator the answer looks plausible, which is what let it
 * survive; on a route in two pieces every parcel past the join is placed inside the first piece.
 *
 * This file is about the half that is arithmetic: given a route length measured properly, where do
 * the posts go. The four cases the brief asks for are four calls.
 */

const simple: ChainageFrame = {
  routeLengthM: 3_400,
  startChainageM: 0,
  direction: "forward",
};

/** A study of a *segment*: the road already had abscissas where this one starts. */
const offsetOrigin: ChainageFrame = {
  routeLengthM: 3_500,
  startChainageM: 2_300,
  direction: "forward",
};

/** Digitised against the road's numbering: the abscissa falls as the geometry advances. */
const reversed: ChainageFrame = {
  routeLengthM: 3_500,
  startChainageM: 5_800,
  direction: "reverse",
};

describe("a route that starts at 0+000", () => {
  it("is posted at every whole kilometre it covers, and at no other place", () => {
    expect(milestonesFor(simple).map((m) => m.label)).toEqual(["0+000", "1+000", "2+000", "3+000"]);
  });

  it("puts each post at its own distance along the line", () => {
    const posts = milestonesFor(simple);
    expect(posts.map((m) => m.distanceAlongM)).toEqual([0, 1_000, 2_000, 3_000]);
  });

  /*
   * The end of the route is not a post unless it lands on one. A marker drawn at 3+400 and
   * labelled `3+400` would be a kilometre post that is not at a kilometre.
   */
  it("does not invent a post at the end of the route", () => {
    expect(milestonesFor(simple).some((m) => m.chainageM === 3_400)).toBe(false);
  });

  it("gives a route shorter than one kilometre no posts rather than a made-up one", () => {
    const short: ChainageFrame = { routeLengthM: 640, startChainageM: 120, direction: "forward" };
    expect(milestonesFor(short)).toEqual([]);
  });
});

describe("a route whose origin is not zero", () => {
  /*
   * The case the audited code could not express at all, because it measured from the first vertex.
   * A segment running 2+300 → 5+800 is posted three times, and neither end is a post.
   */
  it("follows the road's abscissas, not a count from its first vertex", () => {
    expect(milestonesFor(offsetOrigin).map((m) => m.label)).toEqual(["3+000", "4+000", "5+000"]);
  });

  it("places those posts at the right distance along the geometry", () => {
    expect(milestonesFor(offsetOrigin).map((m) => m.distanceAlongM)).toEqual([700, 1_700, 2_700]);
  });

  it("reports the abscissa range it covers", () => {
    expect(chainageRange(offsetOrigin)).toEqual({ fromM: 2_300, toM: 5_800 });
  });

  it("converts in both directions and round-trips", () => {
    expect(chainageAt(offsetOrigin, 700)).toBe(3_000);
    expect(distanceAlongFor(offsetOrigin, 3_000)).toBe(700);
    expect(distanceAlongFor(offsetOrigin, 1_000)).toBeNull();
    expect(distanceAlongFor(offsetOrigin, 9_000)).toBeNull();
  });
});

describe("a route digitised against its own numbering", () => {
  it("counts the abscissa down as the geometry advances", () => {
    expect(chainageAt(reversed, 0)).toBe(5_800);
    expect(chainageAt(reversed, 1_000)).toBe(4_800);
    expect(chainageAt(reversed, 3_500)).toBe(2_300);
  });

  /* The same three posts as the forward segment: it is the same stretch of road. */
  it("posts the same kilometres, at mirrored distances along the line", () => {
    const posts = milestonesFor(reversed);
    expect(posts.map((m) => m.label)).toEqual(["3+000", "4+000", "5+000"]);
    expect(posts.map((m) => m.distanceAlongM)).toEqual([2_800, 1_800, 800]);
  });

  it("covers the same abscissa range, reported lowest first", () => {
    expect(chainageRange(reversed)).toEqual({ fromM: 2_300, toM: 5_800 });
  });
});

describe("a multi-part route is measured whole, or not at all", () => {
  /*
   * This module takes a length, so the multi-part case arrives here as *one* length — which is the
   * point. `ST_GeometryN(geom, 1)` handed the arithmetic the length of the first piece, and every
   * post past the join then fell inside that piece. Measuring the whole route and passing one
   * number is what makes the posts come out where the road is.
   */
  it("posts the kilometres of the whole route, not of its first piece", () => {
    const firstPieceOnly: ChainageFrame = {
      routeLengthM: 1_250,
      startChainageM: 0,
      direction: "forward",
    };
    const wholeRoute: ChainageFrame = {
      routeLengthM: 4_180,
      startChainageM: 0,
      direction: "forward",
    };
    expect(milestonesFor(firstPieceOnly).map((m) => m.label)).toEqual(["0+000", "1+000"]);
    expect(milestonesFor(wholeRoute).map((m) => m.label)).toEqual([
      "0+000",
      "1+000",
      "2+000",
      "3+000",
      "4+000",
    ]);
  });
});

describe("what it refuses rather than guesses", () => {
  it("refuses a route with no length", () => {
    expect(() =>
      milestonesFor({ routeLengthM: 0, startChainageM: 0, direction: "forward" }),
    ).toThrow(InvalidInput);
  });

  it("refuses a negative origin", () => {
    expect(() =>
      milestonesFor({ routeLengthM: 100, startChainageM: -1, direction: "forward" }),
    ).toThrow(InvalidInput);
  });

  /*
   * A reversed route that is longer than its own start abscissa would pass below 0+000 before it
   * ended. Clamping it would move every post on the corridor, so it is refused and the
   * declaration gets fixed instead.
   */
  it("refuses a reversed route that would run below zero", () => {
    expect(() =>
      milestonesFor({ routeLengthM: 3_000, startChainageM: 2_000, direction: "reverse" }),
    ).toThrow(InvalidInput);
  });

  it("refuses a distance that is not on the route", () => {
    expect(() => chainageAt(simple, -1)).toThrow(InvalidInput);
    expect(() => chainageAt(simple, 3_401)).toThrow(InvalidInput);
  });

  it("refuses a spacing that is not a positive distance", () => {
    expect(() => milestonesFor(simple, 0)).toThrow(InvalidInput);
    expect(() => milestonesFor(simple, -500)).toThrow(InvalidInput);
  });
});
