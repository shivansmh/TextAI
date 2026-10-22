const MATH_SYMBOLS = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε",
  theta: "θ", lambda: "λ", mu: "μ", pi: "π", rho: "ρ", sigma: "σ",
  phi: "φ", omega: "ω", Delta: "Δ", Gamma: "Γ", Lambda: "Λ", Omega: "Ω",
  times: " × ", cdot: " · ", div: " ÷ ", pm: " ± ", mp: " ∓ ",
  le: " ≤ ", leq: " ≤ ", ge: " ≥ ", geq: " ≥ ", neq: " ≠ ",
  approx: " ≈ ", equiv: " ≡ ", infty: "∞", sum: "∑", prod: "∏",
  int: "∫", partial: "∂", nabla: "∇", rightarrow: "→", to: "→",
  leftarrow: "←", in: " ∈ ", notin: "∉", subset: "⊂", subseteq: "⊆", cup: "∪",
  cap: "∩", therefore: "∴", because: "∵", ell: "ℓ", Re: "ℜ", Im: "ℑ",
};
const SUPERSCRIPT = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵",
  "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻",
  "=": "⁼", "(": "⁽", ")": "⁾", i: "ⁱ", n: "ⁿ",
};
const SUBSCRIPT = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅",
  "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋",
  "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ",
  j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ",
  s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
};

function readGroup(input, start) {
  while (/\s/.test(input[start] ?? "")) start += 1;
  if (input[start] !== "{") return null;
  let depth = 1;
  for (let index = start + 1; index < input.length; index += 1) {
    if (input[index] === "\\" && ["{", "}"].includes(input[index + 1])) {
      index += 1;
      continue;
    }
    if (input[index] === "{") depth += 1;
    if (input[index] === "}" && --depth === 0) {
      return { value: input.slice(start + 1, index), end: index + 1 };
    }
  }
  return null;
}

function replaceGrouped(input, command, format) {
  let output = "";
  const expression = new RegExp(`^\\\\${command}\\b\\s*`);
  for (let index = 0; index < input.length;) {
    const match = input.slice(index).match(expression);
    if (!match) {
      output += input[index++];
      continue;
    }
    const group = readGroup(input, index + match[0].length);
    if (!group) {
      output += input[index++];
      continue;
    }
    output += format(group.value);
    index = group.end;
  }
  return output;
}

function replaceFractions(input) {
  let output = "";
  const expression = /^\\(?:dfrac|frac|tfrac)\b\s*/;
  for (let index = 0; index < input.length;) {
    const match = input.slice(index).match(expression);
    if (!match) {
      output += input[index++];
      continue;
    }
    const numerator = readGroup(input, index + match[0].length);
    const denominator = numerator && readGroup(input, numerator.end);
    if (!numerator || !denominator) {
      output += input[index++];
      continue;
    }
    output += `(${mathToPlain(numerator.value)})/(${mathToPlain(denominator.value)})`;
    index = denominator.end;
  }
  return output;
}

function mapScript(value, map, fallback) {
  return [...value].every((character) => map[character])
    ? [...value].map((character) => map[character]).join("")
    : `${fallback}(${value})`;
}

export function mathToPlain(value) {
  let result = replaceFractions(value.replace(/\r\n/g, "\n"));
  result = replaceGrouped(result, "sqrt", (group) => `√(${mathToPlain(group)})`);
  const blackboard = { R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ" };
  result = result.replace(/\\mathbb\s*\{([RNZQC])\}/g, (_match, letter) => blackboard[letter]);
  for (let iteration = 0; iteration < 4; iteration += 1) {
    result = result.replace(
      /\\(?:text|mathrm|mathbf|mathit|operatorname|mathsf|mathtt|mathcal|mathbb|boxed)\s*\{([^{}]*)\}/g,
      "$1",
    );
  }
  result = result.replace(/\\(?:begin|end)\{(?:aligned|align\*?|gather\*?|split|equation\*?|cases|matrix|pmatrix|bmatrix)\}/g, "");
  result = result.replace(/\\left|\\right/g, "");
  result = result.replace(/\\\{/g, "⟪").replace(/\\\}/g, "⟫");
  result = result.replace(/\\\\/g, "\n").replace(/&/g, "   ");
  result = result.replace(/\\quad/g, "    ").replace(/\\qquad/g, "        ");
  result = result.replace(/\\[,;:]/g, " ").replace(/\\!/g, "").replace(/\\ /g, " ");
  result = result.replace(/\^\{([^{}]+)\}|\^([0-9+\-=()in]+)/g,
    (_match, grouped, simple) => mapScript(grouped ?? simple, SUPERSCRIPT, "^"));
  result = result.replace(/_\{([^{}]+)\}|_([0-9+\-=()a-z]+)/g,
    (_match, grouped, simple) => mapScript(grouped ?? simple, SUBSCRIPT, "_"));

  for (const command of Object.keys(MATH_SYMBOLS).sort((a, b) => b.length - a.length)) {
    result = result.replace(new RegExp(`\\\\${command}\\b`, "g"), MATH_SYMBOLS[command]);
  }
  return result
    .replace(/[{}]/g, "")
    .replace(/\\([A-Za-z]+)/g, "$1")
    .replace(/\\/g, "")
    .replace(/⟪/g, "{")
    .replace(/⟫/g, "}")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

export function formatMath(text) {
  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, expression) => `\n\n${mathToPlain(expression)}\n\n`)
    .replace(/\$\$([\s\S]*?)\$\$/g, (_match, expression) => `\n\n${mathToPlain(expression)}\n\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, expression) => mathToPlain(expression))
    .replace(/(?<!\$)\$([^$\n]+)\$(?!\$)/g, (match, expression) => {
      // Avoid treating text between two ordinary currency symbols as inline math.
      if (/\b[A-Za-z]{2,}\b/.test(expression) && !/[\\^_{}=+*/<>-]/.test(expression)) return match;
      return mathToPlain(expression);
    })
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
