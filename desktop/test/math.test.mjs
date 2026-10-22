import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatMath, mathToPlain } from "../math.js";

describe("TextAI desktop math formatting", () => {
  it("keeps the original prompt's inline and display math readable", () => {
    const output = formatMath(String.raw`The model is \(y=a+bx\).\n\[7=a+2b\]`);
    assert.match(output, /y=a\+bx/);
    assert.match(output, /7=a\+2b/);
    assert.doesNotMatch(output, /\\\(|\\\[/);
  });

  it("formats powers, subscripts, nested fractions, and radicals", () => {
    assert.equal(
      mathToPlain(String.raw`x^{2}+H_{2}O+\frac{1}{\frac{3}{4}}+\sqrt{9}`),
      "x²+H₂O+(1)/((3)/(4))+√(9)",
    );
  });

  it("converts common Greek symbols and set notation", () => {
    assert.equal(mathToPlain(String.raw`\alpha \in \mathbb{R} \leq \beta`), "α ∈ ℝ ≤ β");
  });
});
