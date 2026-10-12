import os
import time
import sys
import queue
import threading
import tkinter as tk
from tkinter import scrolledtext
from pynput import keyboard
from groq import Groq
import pyperclip

kb = keyboard.Controller()
ui_queue = queue.Queue()

# Config -----------------------------------------------------------
# Groq retired llama-3.1-8b-instant; use its recommended replacement by default.
# Override this with GROQ_MODEL if you want to use another model enabled for your account.
MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-20b")
API = os.environ.get("GROQ_API_KEY")
HOTKEY = "<ctrl>+<alt>+g"
INSTRUCTION = (
    "You get a piece of text the user selected on a web page. "
    "If it is a question, answer it. If it is a concept or paragraph, explain it simply and concisely. Keep the answer short and clear."
)
if not API:
    sys.exit("API Key is not found. Set your GROQ_API_KEY environment variable.")

# --------------------------------------------------------------------

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
            {"role": "user", "content": text}
        ],
        temperature=0.4,
        max_tokens=2048,
    )
    return response.choices[0].message.content or "Groq returned an empty response."

def on_hotkey():
    ui_queue.put("Copying selected text...")

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

# Hide the window on startup so it runs completely in the background
root.withdraw()

# Status / Output Text Area
output_box = scrolledtext.ScrolledText(
    root,
    wrap=tk.WORD,
    font=("Arial", 11),
    background=TEXT_BG,
    foreground=FG,
    insertbackground=FG,
    selectbackground="#34506b",
    selectforeground="#ffffff",
    relief=tk.FLAT,
    borderwidth=0,
    padx=12,
    pady=12,
)
output_box.pack(expand=True, fill="both", padx=12, pady=(12, 8))
output_box.vbar.configure(
    background=BUTTON_BG,
    activebackground=BUTTON_ACTIVE_BG,
    troughcolor=TEXT_BG,
    relief=tk.FLAT,
    borderwidth=0,
    highlightthickness=0,
)
output_box.config(state=tk.DISABLED)

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
        
        output_box.config(state=tk.NORMAL)
        output_box.delete("1.0", tk.END)
        output_box.insert(tk.END, msg)
        output_box.see(tk.END)
        output_box.config(state=tk.DISABLED)
        
    root.after(100, process_queue)

root.after(100, process_queue)

# Start the global hotkey listener cleanly
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
