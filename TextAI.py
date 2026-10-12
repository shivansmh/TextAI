import os
import time
import sys
import queue
import threading
from pynput import keyboard
from groq import Groq
import pyperclip

kb = keyboard.Controller()
ui_queue = queue.Queue()

# Config -----------------------------------------------------------
MODEL = "llama-3.3-70b-versatile"
API = os.environ.get("GROQ_API_KEY")
HOTKEY = "<ctrl>+<alt>+g"
INSTRUCTION = (
    "You get a piece of text the user selected on a web page. "
    "If it is a question, answer it. If it is a concept or paragraph, explain it simply and concisely. Keep the answer short and clear."
)
if not API:
    sys.exit("API Key is not found.")

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
    def work():
        text = copy_prompt()

        if not text:
            ui_queue.put("No text selected. Select some text first, then try.")
            return
        ui_queue.put("Thinking...")
     
        try:
            ui_queue.put(ask_groq(text))
        except Exception as e:
            ui_queue.put(f"Error.\n{e}")

    threading.Thread(target=work, daemon=True).start()

# Start the global hotkey listener
with keyboard.GlobalHotKeys({HOTKEY: on_hotkey}) as listener:
    print(f"Hotkey listener active: {HOTKEY}")
    listener.join()