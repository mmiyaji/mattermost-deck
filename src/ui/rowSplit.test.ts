import { expect, it } from "vitest";
import { normaliseRowSplit } from "./rowSplit";

it("keeps imported row ratios usable and defaults legacy or invalid values to equal heights", () => {
  expect([undefined, null, "70", NaN, Infinity].map(normaliseRowSplit)).toEqual([50, 50, 50, 50, 50]);
  expect([-10, 64.6, 200].map(normaliseRowSplit)).toEqual([20, 65, 80]);
});
