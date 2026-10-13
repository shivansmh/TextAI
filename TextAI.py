import os
import re
import time
import sys
import queue
import threading
import tkinter as tk
from pynput import keyboard
from groq import Groq
import pyperclip

kb = keyboard.Controller()
ui_queue = queue.Queue()

# Config -----------------------------------------------------------

MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-20b")
API = os.environ.get("GROQ_API_KEY")
HOTKEY = "<ctrl>+<alt>+g"
INSTRUCTION = (
    "You get a piece of text the user selected on a web page. "
    "If it is a question, answer it. If it is a concept or paragraph, explain it simply and concisely. "
    "For math, use standard LaTeX delimiters for formulas and put multi-step equations on separate lines. "
    "Keep the answer short and clear."
)
if not API:
    sys.exit("API Key is not found. Set your GROQ_API_KEY environment variable.")

# --------------------------------------------------------------------
# MATHS optimization ---------------------------------------------------------------------------------

SUPERSCRIPT = str.maketrans("0123456789+-=()in", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁱⁿ")
SUBSCRIPT = str.maketrans({
    "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
    "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
    "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
    "a": "ₐ", "e": "ₑ", "h": "ₕ", "i": "ᵢ", "j": "ⱼ",
    "k": "ₖ", "l": "ₗ", "m": "ₘ", "n": "ₙ", "o": "ₒ",
    "p": "ₚ", "r": "ᵣ", "s": "ₛ", "t": "ₜ", "u": "ᵤ",
    "v": "ᵥ", "x": "ₓ",
})

MATH_SYMBOLS = {
    "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ",
    "epsilon": "ε", "theta": "θ", "lambda": "λ", "mu": "μ",
    "pi": "π", "rho": "ρ", "sigma": "σ", "phi": "φ",
    "omega": "ω", "Delta": "Δ", "Gamma": "Γ", "Lambda": "Λ",
    "Omega": "Ω", "times": " × ", "cdot": " · ", "div": " ÷ ",
    "pm": " ± ", "mp": " ∓ ", "le": " ≤ ", "leq": " ≤ ",
    "ge": " ≥ ", "geq": " ≥ ", "neq": " ≠ ", "approx": " ≈ ",
    "equiv": " ≡ ", "infty": "∞", "sum": "∑", "prod": "∏",
    "int": "∫", "partial": "∂", "nabla": "∇", "rightarrow": "→",
    "to": "→", "leftarrow": "←", "in": "∈", "notin": "∉",
    "subset": "⊂", "subseteq": "⊆", "cup": "∪", "cap": "∩",
    "therefore": "∴", "because": "∵", "ell": "ℓ", "Re": "ℜ",
    "Im": "ℑ",
}


def _read_braced_group(text, start):
    """Return (contents, next_index) for a possibly nested LaTeX brace group."""
    while start < len(text) and text[start].isspace():
        start += 1
    if start >= len(text) or text[start] != "{":
        return None, start

    depth = 1
    index = start + 1
    content_start = index
    while index < len(text):
        char = text[index]
        if char == "\\" and index + 1 < len(text) and text[index + 1] in "{}":
            index += 2
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[content_start:index], index + 1
        index += 1
    return None, start


def _format_grouped_command(expression, command_pattern, formatter):
    """Replace LaTeX commands that take brace-group arguments."""
    output = []
    index = 0
    while index < len(expression):
        match = re.match(command_pattern, expression[index:]) if expression[index] == "\\" else None
        if not match:
            output.append(expression[index])
            index += 1
            continue

        argument_start = index + match.end()
        first, after_first = _read_braced_group(expression, argument_start)
        if first is None:
            output.append(expression[index])
            index += 1
            continue
        output.append(formatter(first))
        index = after_first
    return "".join(output)


def math_to_plain(expression):
    """Convert common LaTeX notation to clean, readable Unicode/plain text."""
    expression = expression.replace("\r\n", "\n")

    # Fractions take two groups, so parse them separately from one-argument commands.
    output = []
    index = 0
    while index < len(expression):
        match = re.match(r"\\(?:dfrac|frac|tfrac)\b\s*", expression[index:]) if expression[index] == "\\" else None
        if match:
            first, after_first = _read_braced_group(expression, index + match.end())
            second, after_second = _read_braced_group(expression, after_first) if first is not None else (None, after_first)
            if first is not None and second is not None:
                output.append(f"({math_to_plain(first)})/({math_to_plain(second)})")
                index = after_second
                continue
        output.append(expression[index])
        index += 1
    expression = "".join(output)

    expression = _format_grouped_command(
        expression, r"\\sqrt\b\s*", lambda value: "√(" + math_to_plain(value) + ")"
    )
    blackboard = {"R": "ℝ", "N": "ℕ", "Z": "ℤ", "Q": "ℚ", "C": "ℂ"}
    expression = re.sub(
        r"\\mathbb\s*\{([RNZQC])\}",
        lambda match: blackboard[match.group(1)],
        expression,
    )
    for _ in range(4):
        cleaned = re.sub(
            r"\\(?:text|mathrm|mathbf|mathit|operatorname|mathsf|mathtt|mathcal|mathbb|boxed)\s*\{([^{}]*)\}",
            r"\1",
            expression,
        )
        if cleaned == expression:
            break
        expression = cleaned

    # Remove layout-only LaTeX and recognizable math environments.
    expression = re.sub(r"\\(?:begin|end)\{(?:aligned|align\*?|gather\*?|split|equation\*?|cases|matrix|pmatrix|bmatrix)\}", "", expression)
    expression = expression.replace(r"\left", "").replace(r"\right", "")
    expression = expression.replace(r"\{", "⟪").replace(r"\}", "⟫")
    expression = expression.replace(r"\\", "\n").replace("&", "   ")
    expression = expression.replace(r"\quad", "    ").replace(r"\qquad", "        ")
    expression = expression.replace(r"\,", " ").replace(r"\;", " ").replace(r"\:", " ").replace(r"\!", "")
    expression = expression.replace(r"\ ", " ")

    # Render powers and subscripts with Unicode where possible.
    def script(match, alphabet, fallback):
        value = match.group(1) if match.group(1) is not None else match.group(2)
        mapped = value.translate(alphabet)
        return mapped if all(ord(char) in alphabet for char in value) else fallback + "(" + value + ")"

    expression = re.sub(r"\^\{([^{}]+)\}|\^([0-9+\-=()in]+)", lambda m: script(m, SUPERSCRIPT, "^"), expression)
    expression = re.sub(r"_\{([^{}]+)\}|_([0-9+\-=()a-z]+)", lambda m: script(m, SUBSCRIPT, "_"), expression)

    for command, symbol in sorted(MATH_SYMBOLS.items(), key=lambda item: len(item[0]), reverse=True):
        expression = re.sub(r"\\" + re.escape(command) + r"\b", lambda _m, value=symbol: value, expression)

    # Remove leftover formatting braces and backslashes without exposing raw LaTeX.
    expression = expression.replace("{", "").replace("}", "")
    expression = re.sub(r"\\([A-Za-z]+)", r"\1", expression)
    expression = expression.replace("\\", "").replace("⟪", "{").replace("⟫", "}")
    expression = re.sub(r"[ \t]+", " ", expression)
    expression = re.sub(r" *\n *", "\n", expression)
    return expression.strip()


def format_response(response):
    """Render inline and display math without leaving raw LaTeX delimiters."""
    def display(match):
        return "\n\n" + math_to_plain(match.group(1)).strip() + "\n\n"

    def inline(match):
        return math_to_plain(match.group(1))

    response = re.sub(r"\\\[(.*?)\\\]", display, response, flags=re.DOTALL)
    response = re.sub(r"\$\$(.*?)\$\$", display, response, flags=re.DOTALL)
    response = re.sub(r"\\\((.*?)\\\)", inline, response, flags=re.DOTALL)
    response = re.sub(r"(?<!\$)\$([^$\n]+)\$(?!\$)", inline, response)
    response = re.sub(r"[ \t]*\n[ \t]*", "\n", response)
    response = re.sub(r"\n{3,}", "\n\n", response)
    return response.strip()

# ----------------------------------------------------------------------------------------
def copy_prompt():
    oldtext = pyperclip.paste()
    pyperclip.copy("")

    for key in (keyboard.Key.shift, keyboard.Key.alt, keyboard.Key.ctrl):
        kb.release(key)
    time.sleep(0.1)

    copy = keyboard.Key.ctrl

    with kb.pressed(copy):
        kb.press("c")
        kb.release("c")

    time.sleep(0.2)
    text = pyperclip.paste().strip()
    pyperclip.copy(oldtext)
    return text


def ask_groq(text):
    client = Groq(api_key=API)
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": INSTRUCTION},
            {"role": "user", "content": text},
        ],
        temperature=0.4,
        max_tokens=2048,
    )
    return response.choices[0].message.content or "Groq returned an empty response."


def on_hotkey():
    def work():
        
        text = copy_prompt()

        if not text:
            ui_queue.put("No text selected. Select some text first, then try.")
            return
        ui_queue.put("Thinking...")

        try:
            ui_queue.put(ask_groq(text))
        except Exception as e:
            ui_queue.put(f"Error:\n{e}")

    threading.Thread(target=work, daemon=True).start()


# --- Tkinter GUI Setup ---
root = tk.Tk()
root.title("TextAI Assistant")
root.geometry("500x350")
BG = "#151922"
TEXT_BG = "#10141b"
FG = "#e6edf3"
MUTED_FG = "#aab6c5"
BUTTON_BG = "#2a3341"
BUTTON_ACTIVE_BG = "#3a4658"
SCROLL_THUMB = "#384454"
SCROLL_HOVER = "#536176"

root.configure(bg=BG)
root.tk_setPalette(
    background=BG,
    foreground=FG,
    activeBackground=BUTTON_ACTIVE_BG,
    activeForeground=FG,
    disabledForeground=MUTED_FG,
    highlightBackground=BG,
    highlightColor=BUTTON_ACTIVE_BG,
    insertBackground=FG,
    selectBackground="#34506b",
    selectForeground="#ffffff",
    troughColor=TEXT_BG,
)


def set_dark_window_chrome():
    """Ask Windows DWM for dark title-bar and border colors when available."""
    if sys.platform != "win32":
        return
    try:
        import ctypes

        dwm = ctypes.WinDLL("dwmapi")
        setter = dwm.DwmSetWindowAttribute
        setter.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_uint]
        setter.restype = ctypes.c_long
        hwnd = ctypes.c_void_p(root.winfo_id())

        dark = ctypes.c_int(1)
        # Attribute 20 is current; 19 is the compatibility value on older builds.
        if setter(hwnd, 20, ctypes.byref(dark), ctypes.sizeof(dark)) != 0:
            setter(hwnd, 19, ctypes.byref(dark), ctypes.sizeof(dark))

        def colorref(hex_color):
            red = int(hex_color[1:3], 16)
            green = int(hex_color[3:5], 16)
            blue = int(hex_color[5:7], 16)
            return red | (green << 8) | (blue << 16)

        for attribute, hex_color in ((34, BG), (35, BG), (36, FG)):
            color = ctypes.c_uint(colorref(hex_color))
            setter(hwnd, attribute, ctypes.byref(color), ctypes.sizeof(color))
    except Exception:
        # Tk still works normally if DWM theme APIs are unavailable.
        return


root.withdraw()

output_frame = tk.Frame(root, bg=BG)
output_frame.pack(expand=True, fill="both", padx=12, pady=(12, 8))

# A canvas scrollbar avoids the wide, bright native Windows scrollbar.
scrollbar = tk.Canvas(
    output_frame,
    width=8,
    bg=TEXT_BG,
    highlightthickness=0,
    borderwidth=0,
    takefocus=0,
)
scrollbar.pack(side="right", fill="y", padx=(4, 0))


def draw_scrollbar(first, last):
    scrollbar.delete("thumb")
    height = scrollbar.winfo_height()
    if height <= 1:
        return
    first, last = float(first), float(last)
    if last - first >= 0.999:
        return
    top = max(2, int(first * height))
    bottom = min(height - 2, max(top + 20, int(last * height)))
    scrollbar.create_rectangle(
        2, top, 6, bottom,
        fill=SCROLL_THUMB,
        outline="",
        tags="thumb",
    )


output_box = tk.Text(
    output_frame,
    wrap=tk.WORD,
    font=("Segoe UI", 11),
    background=TEXT_BG,
    foreground=FG,
    insertbackground=FG,
    selectbackground="#34506b",
    selectforeground="#ffffff",
    relief=tk.FLAT,
    borderwidth=0,
    highlightthickness=0,
    padx=10,
    pady=10,
    yscrollcommand=draw_scrollbar,
)
output_box.pack(side="left", expand=True, fill="both")
output_box.config(state=tk.DISABLED)
scrollbar.bind("<Configure>", lambda _event: draw_scrollbar(*output_box.yview()))

scroll_state = {"drag_offset": None}


def scrollbar_press(event):
    height = max(scrollbar.winfo_height(), 1)
    first, last = output_box.yview()
    thumb_top = first * height
    thumb_bottom = last * height
    span = last - first
    if thumb_top <= event.y <= thumb_bottom:
        scroll_state["drag_offset"] = event.y - thumb_top
    else:
        scroll_state["drag_offset"] = span * height / 2
        output_box.yview_moveto(max(0, min(1 - span, event.y / height - span / 2)))


def scrollbar_drag(event):
    offset = scroll_state["drag_offset"]
    if offset is None:
        return
    height = max(scrollbar.winfo_height(), 1)
    span = output_box.yview()[1] - output_box.yview()[0]
    position = max(0, min(1 - span, (event.y - offset) / height))
    output_box.yview_moveto(position)


def scrollbar_release(_event):
    scroll_state["drag_offset"] = None


def wheel_scroll(event):
    if getattr(event, "delta", 0):
        output_box.yview_scroll(-1 if event.delta > 0 else 1, "units")
    elif getattr(event, "num", None) == 4:
        output_box.yview_scroll(-1, "units")
    elif getattr(event, "num", None) == 5:
        output_box.yview_scroll(1, "units")
    return "break"


scrollbar.bind("<Button-1>", scrollbar_press)
scrollbar.bind("<B1-Motion>", scrollbar_drag)
scrollbar.bind("<ButtonRelease-1>", scrollbar_release)
scrollbar.bind("<MouseWheel>", wheel_scroll)
scrollbar.bind("<Button-4>", wheel_scroll)
scrollbar.bind("<Button-5>", wheel_scroll)
scrollbar.bind("<Enter>", lambda _event: scrollbar.itemconfigure("thumb", fill=SCROLL_HOVER))
scrollbar.bind("<Leave>", lambda _event: scrollbar.itemconfigure("thumb", fill=SCROLL_THUMB))


def hide_window():
    """Hide the output window without stopping the app or hotkey listener."""
    root.withdraw()


def quit_app():
    """Stop the hotkey listener and exit the application."""
    listener.stop()
    root.destroy()


controls = tk.Frame(root, bg=BG)
controls.pack(fill="x", padx=12, pady=(0, 12))
tk.Button(
    controls,
    text="Hide",
    command=hide_window,
    bg=BUTTON_BG,
    fg=FG,
    activebackground=BUTTON_ACTIVE_BG,
    activeforeground=FG,
    relief=tk.FLAT,
    borderwidth=0,
    padx=14,
    pady=7,
    cursor="hand2",
).pack(side="left")
tk.Button(
    controls,
    text="Quit TextAI",
    command=quit_app,
    bg=BUTTON_BG,
    fg=FG,
    activebackground=BUTTON_ACTIVE_BG,
    activeforeground=FG,
    relief=tk.FLAT,
    borderwidth=0,
    padx=14,
    pady=7,
    cursor="hand2",
).pack(side="right")


def process_queue():
    """Check the queue periodically, pop up the window, and update text."""
    while not ui_queue.empty():
        msg = ui_queue.get()

        root.deiconify()
        root.lift()
        root.focus_force()
        root.after_idle(set_dark_window_chrome)

        output_box.config(state=tk.NORMAL)
        output_box.delete("1.0", tk.END)
        output_box.insert(tk.END, format_response(msg))
        output_box.see(tk.END)
        output_box.config(state=tk.DISABLED)

    root.after(100, process_queue)


root.after(100, process_queue)

# Start the global hotkey listener cleanly.
listener = keyboard.GlobalHotKeys({HOTKEY: on_hotkey})
listener.start()


def on_close():
    """Treat the title-bar close button as Hide so the hotkey stays active."""
    hide_window()


root.protocol("WM_DELETE_WINDOW", on_close)

# Run the Tkinter main event loop. Closing the window hides it; use Quit TextAI to exit.
try:
    root.mainloop()
except KeyboardInterrupt:
    listener.stop()
    sys.exit(0)
