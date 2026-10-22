import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatMath, mathToPlain } from "../math.js";

describe("TextAI math formatting", () => {
  it("converts the raw LaTeX style shown in the original desktop output", () => {
    const input = String.raw`The model is \(y = a + bx\). For \((x,y)=(2,7)\):
\[7 = a + 2b\]`;
    const output = formatMath(input);
    assert.match(output, /y = a \+ bx/);
    assert.match(output, /\(x,y\)=\(2,7\)/);
    assert.match(output, /7 = a \+ 2b/);
    assert.doesNotMatch(output, /\\\(|\\\[|\\\)/);
  });

  it("renders powers, subscripts, fractions, roots, Greek symbols and inequalities", () => {
    const output = mathToPlain(String.raw`x^{2} + H_{2}O + \frac{1}{2} + \sqrt{9} + \alpha \leq \beta`);
    assert.equal(output, "x² + H₂O + (1)/(2) + √(9) + α ≤ β");
  });

  it("handles nested fractions and blackboard-bold number sets", () => {
    const output = mathToPlain(String.raw`\frac{x^{2}}{\frac{1}{2}} \in \mathbb{R}`);
    assert.equal(output, "(x²)/((1)/(2)) ∈ ℝ");
  });

  it("does not interpret ordinary currency or dollar signs as math", () => {
    assert.equal(formatMath("It costs $5, and $10 after tax."), "It costs $5, and $10 after tax.");
  });

  it("turns display equations into standalone readable lines", () => {
    const output = formatMath(String.raw`Start here.
\[y=a+bx\]
Continue here.`);
    assert.equal(output, "Start here.\n\ny=a+bx\n\nContinue here.");
  });
});
