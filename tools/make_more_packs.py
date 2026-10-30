"""
Generates two more bundled packs (all original material):

  resources/packs/airplane-2  - a second batch of cabin announcements (merges into the Airplane board)
  resources/packs/cockpit     - lock-on tones, missile warnings, GPWS "pull up" and radio chatter

Reuses the DSP + TTS helpers from make_airplane_pack.py.

Usage:  tools/.venv/Scripts/python tools/make_more_packs.py
"""

import asyncio
import json

import numpy as np
import soundfile as sf
from scipy import signal

import make_airplane_pack as ap
from make_airplane_pack import (
    SR, CAPTAIN, ATTENDANT, filt, peaking, db, rms, place, fade, reverb, bell,
    overhead_speaker, finish, tts, make_announcement,
)

rng = np.random.default_rng(4242)

FIRST_OFFICER = dict(voice="en-US-BrianMultilingualNeural", rate="-4%", pitch="-2Hz")
TOWER = dict(voice="en-US-AriaNeural", rate="+8%", pitch="+0Hz")
WINGMAN = dict(voice="en-US-BrianNeural", rate="+14%", pitch="+0Hz")
BETTY = dict(voice="en-US-JennyNeural", rate="-8%", pitch="-3Hz")
GPWS = dict(voice="en-US-GuyNeural", rate="-6%", pitch="-14Hz")

# id, name, emoji, color, voice, role, text
CABIN = [
    ("fasten-seatbelt", "Fasten Seatbelt Sign", "💺", "#4dabf7", ATTENDANT, "attendant",
     "Ladies and gentlemen, the captain has turned on the fasten seatbelt sign. Please return to your seats "
     "and keep your seatbelts securely fastened. Thank you."),
    ("seatbelt-enemy-team", "Seatbelt: Turbulence Ahead", "🌩️", "#ffd43b", ATTENDANT, "attendant",
     "Ladies and gentlemen, the captain has turned on the fasten seatbelt sign. Please return to your seats. "
     "We are expecting some turbulence ahead... and by turbulence, we mean the enemy team."),
    ("wifi", "Wi-Fi Password", "📡", "#4dabf7", CAPTAIN, "captain",
     "Folks, this is your captain. The in-flight Wi-Fi is now available. The password is... stop lagging. "
     "All one word. All lowercase."),
    ("teammates-denver", "Your Teammates Are In Denver", "🧳", "#ffa94d", CAPTAIN, "captain",
     "Ladies and gentlemen, I have some bad news. Your luggage is in Denver. Your teammates... are also in Denver. "
     "Good luck out there."),
    ("sneeze", "That Was Me", "🤧", "#69db7c", CAPTAIN, "captain",
     "Uh, folks, that turbulence you just felt? That was me. I sneezed. We're fine. Everybody's fine."),
    ("barrel-roll", "Barrel Roll Vote", "🗳️", "#b197fc", CAPTAIN, "captain",
     "Quick fuel update, folks. We have enough fuel to reach our destination... or to do one really sick barrel roll. "
     "I'm gonna let you vote."),
    ("respawn-point", "Respawn Point", "📍", "#ff6b6b", CAPTAIN, "captain",
     "Ladies and gentlemen, if you look out the right side of the aircraft, you'll see our respawn point. "
     "Please memorize it. Some of you are gonna need it."),
    ("boss-fight", "Boss Fight Ahead", "🐉", "#38d9a9", CAPTAIN, "captain",
     "Folks, we're now approaching our destination. Air traffic control has informed me that it is... a boss fight. "
     "Please equip your best gear."),
    ("afk", "Captain Is AFK", "💤", "#748ffc", CAPTAIN, "captain",
     "Uh, folks, this is your captain. I'm gonna be A F K for about five minutes. The autopilot is in charge. "
     "It's on easy mode."),
    ("lobby", "Returned To Lobby", "🔙", "#f783ac", FIRST_OFFICER, "captain",
     "Ladies and gentlemen, this is your first officer. Due to a scheduling error, this flight has been returned "
     "to the lobby. Please wait for the next match."),
    ("overtime", "Overtime", "⏱️", "#ffd43b", CAPTAIN, "captain",
     "Ladies and gentlemen, the tower has asked us to circle the airport a few more times. "
     "Looks like we're going into overtime."),
    ("clutch", "Absolute Clutch", "🛬", "#69db7c", CAPTAIN, "captain",
     "Welcome to the ground, everybody. I'd like to thank the one engine that was still working. Absolute clutch."),
    ("camper", "Lavatory Camper", "🚽", "#4dabf7", ATTENDANT, "attendant",
     "Attention passengers. Someone has been camping in the rear lavatory for forty-five minutes. "
     "Sir, we can see your feet. Please rotate."),
    ("exit-row", "Exit Row Judgment", "🚪", "#ffa94d", ATTENDANT, "attendant",
     "If you are seated in an exit row, you must be willing to assist in an emergency. "
     "If you are not willing, please let us know now... so we can judge you."),
    ("oxygen", "Oxygen Masks", "😷", "#38d9a9", ATTENDANT, "attendant",
     "Should the cabin lose pressure, oxygen masks will drop from above. Please secure your own mask before "
     "assisting others. Yes. Even your duo partner."),
    ("trash-talk", "Trash Talk Policy", "🗑️", "#e599f7", ATTENDANT, "attendant",
     "At this time, please return your tray tables to their upright and locked position... "
     "and your trash talk to a reasonable level."),
    ("report", "Report After The Flight", "🚩", "#ff6b6b", ATTENDANT, "attendant",
     "As always, if you see something, say something. And if you see someone throwing, "
     "please report them after the flight."),
    ("not-your-healer", "I Am Not Your Healer", "🩺", "#f783ac", ATTENDANT, "attendant",
     "Sir, this is the fourth time you've pressed the call button. I am a flight attendant. I am not your healer."),
]


# ----------------------------------------------------------------------------- building blocks

def tone(freq, dur, harmonics=((1, 1.0), (2, 0.25), (3, 0.12)), attack=0.003, release=0.006):
    t = np.arange(int(dur * SR)) / SR
    y = sum(g * np.sin(2 * np.pi * freq * k * t) for k, g in harmonics)
    return fade(y, attack, release)


def sweep(f0, f1, dur, harmonics=((1, 1.0), (3, 0.3), (5, 0.12))):
    t = np.arange(int(dur * SR)) / SR
    f = f0 * (f1 / f0) ** (t / dur)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return sum(g * np.sin(k * ph) for k, g in harmonics)


def headset(x, drive=1.4):
    """Cockpit audio panel: band-limited, a little crunchy."""
    y = filt(x, "highpass", 220, 2)
    y = filt(y, "lowpass", 6500, 2)
    y = y / (np.max(np.abs(y)) + 1e-9)
    return np.tanh(drive * y) / np.tanh(drive)


def digital_voice(x, hold=2, bits=10):
    """Warning-computer voice: narrowed, sample-and-hold grit, coarse quantization."""
    y = filt(x, "highpass", 280, 4)
    y = filt(y, "lowpass", 4800, 4)
    y = np.repeat(y[::hold], hold)[: len(y)]
    y = y / (np.max(np.abs(y)) + 1e-9)
    q = 2 ** (bits - 1)
    y = np.round(y * q) / q
    return filt(y, "lowpass", 7000, 2)


def radio_voice(x, low=380, high=2900, drive=2.8):
    y = filt(x, "highpass", low, 4)
    y = filt(y, "lowpass", high, 4)
    y = peaking(y, 1600, 5, 1.0)
    y = y / (np.max(np.abs(y)) + 1e-9) * 0.9
    y = np.tanh(drive * y) / np.tanh(drive)
    return filt(y, "lowpass", 3400, 2)


def squelch(dur=0.16, level=-16):
    n = int(dur * SR)
    burst = filt(rng.standard_normal(n), "bandpass", [600, 3800], 2)
    burst = burst / rms(burst) * db(level)
    return fade(burst, 0.002, 0.04)


def jet_bed(n, level=-30):
    w = rng.standard_normal(n + SR)
    y = filt(w, "lowpass", 220, 2) + 0.5 * filt(w, "bandpass", [700, 2400], 2)
    y = y[SR:]
    return y / rms(y) * db(level)


def radio_call(voice, cockpit_noise=False, tail=0.35):
    """Push-to-talk radio transmission: click, hiss bed (+ jet noise from the cockpit), voice, squelch tail."""
    v = radio_voice(voice)
    lead = 0.12
    n = int((lead + len(v) / SR + tail) * SR)
    out = np.zeros(n)
    hiss = filt(rng.standard_normal(n), "bandpass", [500, 3600], 2)
    hiss = hiss / rms(hiss) * db(-36)
    if cockpit_noise:
        hiss = hiss + radio_voice(jet_bed(n, -20) * 0.3, drive=1.2) * db(-24)
    out += fade(hiss, 0.004, 0.02)
    place(out, ap.pa_click(-18, "on"), 0)
    place(out, v, lead)
    place(out, squelch(), lead + len(v) / SR + 0.05)
    out[int((lead + len(v) / SR + 0.21) * SR):] *= 0  # squelch closes
    voiced = out[int(lead * SR): int(lead * SR) + len(v)]
    return finish(fade(out, 0.002, 0.01), target_rms_db=-17, ceiling_db=-1, voiced=voiced)


def missile_whoosh(dur=1.8):
    n = int(dur * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    zi = None
    for i in range(0, n, 512):
        c = 3200 * (500 / 3200) ** (t[i] / dur)
        s = signal.butter(2, [c / 1.6, min(c * 1.6, SR / 2 - 100)], "bandpass", fs=SR, output="sos")
        if zi is None:
            zi = signal.sosfilt_zi(s) * 0
        out[i:i + 512], zi = signal.sosfilt(s, noise[i:i + 512], zi=zi)
    env = (1 - np.exp(-t / 0.02)) * np.exp(-t / 0.7)
    rumble = filt(rng.standard_normal(n), "lowpass", 120, 2) * np.exp(-t / 0.5)
    y = out / rms(out) * env + rumble / rms(rumble) * env * 0.5
    return fade(y, 0.002, 0.3)


# ----------------------------------------------------------------------------- lock-on sounds

def make_lock_on():
    """Acquiring beeps that speed up, then a solid lock tone."""
    out = np.zeros(int(3.9 * SR))
    t, gap = 0.04, 0.38
    while t < 2.2:
        place(out, tone(1180, 0.055), t, 0.8)
        t += gap
        gap = max(0.06, gap * 0.78)
    lock = tone(1180, 1.45, harmonics=((1, 1.0), (2, 0.3), (3, 0.14)), release=0.06)
    lock = lock * (1 + 0.04 * np.sin(2 * np.pi * 7 * np.arange(len(lock)) / SR))
    place(out, lock, t + 0.02, 0.9)
    return finish(headset(out), target_rms_db=-16, ceiling_db=-1.5)


def make_missile_warning():
    """Incoming missile: fast two-tone warble alarm."""
    out = np.zeros(int(3.2 * SR))
    t, k = 0.0, 0
    while t < 3.05:
        place(out, tone(1650 if k % 2 == 0 else 1250, 0.06, harmonics=((1, 1.0), (3, 0.3), (5, 0.12))), t)
        t += 0.0625
        k += 1
    return finish(fade(headset(out, 1.8), 0.002, 0.05), target_rms_db=-16, ceiling_db=-1.5)


def make_sidewinder():
    """Seeker growl while searching, rising to a hard tone when it locks."""
    dur = 4.2
    n = int(dur * SR)
    t = np.arange(n) / SR
    lock_at, lock_end = 1.7, 2.25
    f = np.interp(t, [0, lock_at, lock_end, dur], [360, 430, 1340, 1340])
    f = f * (1 + 0.03 * filt(rng.standard_normal(n), "lowpass", 12, 1) * (t < lock_end))
    ph = 2 * np.pi * np.cumsum(f) / SR
    growl = sum(np.sin(k * ph) / k for k in range(1, 9))
    clean = np.sin(ph) + 0.3 * np.sin(2 * ph)
    rasp = np.abs(filt(rng.standard_normal(n), "lowpass", 45, 2))
    rasp = 0.35 + rasp / np.max(rasp) * 1.3
    mix = np.clip((t - lock_at) / (lock_end - lock_at), 0, 1)
    y = growl * rasp * (1 - mix) * 0.55 + clean * mix * (1 + 0.03 * np.sin(2 * np.pi * 6 * t))
    return finish(fade(headset(y, 1.6), 0.02, 0.08), target_rms_db=-16, ceiling_db=-1.5)


def make_missile_lock_voice(voice):
    v = digital_voice(voice)
    out = np.zeros(int((0.55 + len(v) / SR + 0.5) * SR))
    for i in range(3):
        place(out, tone(1650 if i % 2 == 0 else 1250, 0.07), 0.02 + i * 0.09, 0.45)
    place(out, v, 0.55)
    voiced = out[int(0.55 * SR): int(0.55 * SR) + len(v)]
    return finish(fade(out, 0.002, 0.08), target_rms_db=-17, ceiling_db=-1, voiced=voiced)


def make_pull_up(voice):
    """GPWS: two 'whoop' sirens, then the voice."""
    v = digital_voice(voice, hold=3, bits=9)
    whoop = fade(sweep(520, 1350, 0.42), 0.01, 0.06)
    out = np.zeros(int((1.15 + len(v) / SR + 0.4) * SR))
    place(out, whoop, 0.02, 0.5)
    place(out, whoop, 0.5, 0.5)
    place(out, v, 1.1)
    voiced = out[int(1.1 * SR): int(1.1 * SR) + len(v)]
    return finish(fade(out, 0.002, 0.08), target_rms_db=-17, ceiling_db=-1, voiced=voiced)


def make_fox_two(voice):
    call = radio_call(voice, cockpit_noise=True, tail=0.25).astype(np.float64)
    out = np.zeros(len(call) + int(1.6 * SR))
    place(out, call, 0)
    place(out, missile_whoosh(), len(call) / SR - 0.3, db(-14))
    return finish(fade(out, 0.002, 0.2), target_rms_db=-17, ceiling_db=-1, voiced=call)


# ----------------------------------------------------------------------------- main

COCKPIT_LINES = {
    "missile-lock-voice": (BETTY, "Warning, missile lock. Warning, missile lock."),
    "pull-up": (GPWS, "Terrain, terrain, pull up, pull up!"),
    "fox-two": (WINGMAN, "Good tone, good tone... Fox two! Fox two!"),
    "bogey": (WINGMAN, "Bogey on your six! Bogey on your six! Break left! Break left!"),
    "cleared-takeoff": (TOWER, "Sloppy Potato four two one, wind calm, runway two seven, cleared for takeoff. Send it."),
    "mayday": (CAPTAIN, "Mayday, mayday, mayday. Sloppy Potato four two one. We have a... skill issue. Requesting backup."),
    "go-around": (TOWER, "Sloppy Potato four two one, go around. I say again, go around. That was... not it."),
}


def write_pack(folder, meta, sounds):
    out = ap.ROOT / "resources" / "packs" / folder
    out.mkdir(parents=True, exist_ok=True)
    listed = []
    for s in sounds:
        file = f"{s['id']}.flac"
        sf.write(str(out / file), s.pop("audio"), SR, subtype="PCM_16")
        listed.append({**s, "file": file, "hotkey": None})
    pack = dict(format="sloppy-potato-pack", version=1, **meta, sounds=listed)
    (out / "pack.json").write_text(json.dumps(pack, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {len(listed)} sounds to {out}")


def report(name, audio):
    print(f"  {name:<30} {len(audio) / SR:5.1f}s  peak {20 * np.log10(np.max(np.abs(audio))):6.1f} dBFS")


async def main():
    # ---- cabin announcements, batch 2
    voices = await asyncio.gather(*[tts(text, **who) for (*_, who, _role, text) in CABIN])
    cabin = []
    for (sid, name, emoji, color, _who, role, _text), v in zip(CABIN, voices):
        audio = make_announcement(v)
        report(name, audio)
        cabin.append(dict(id=sid, name=name, emoji=emoji, color=color, tags=["announcement", role], audio=audio))
    write_pack("airplane-2", dict(id="airplane-2", category="airplane", order=2, name="Airplane", emoji="✈️"), cabin)

    # ---- cockpit board
    lines = dict(zip(COCKPIT_LINES, await asyncio.gather(*[tts(t, **w) for w, t in COCKPIT_LINES.values()])))
    cockpit = [
        dict(id="lock-on", name="Lock-On", emoji="🎯", color="#ff6b6b", tags=["lock-on", "alert"], audio=make_lock_on()),
        dict(id="missile-warning", name="Missile Lock Warning", emoji="🚨", color="#ffa94d", tags=["lock-on", "alert"],
             audio=make_missile_warning()),
        dict(id="sidewinder", name="Sidewinder Tone", emoji="🐍", color="#69db7c", tags=["lock-on", "alert"],
             audio=make_sidewinder()),
        dict(id="missile-lock-voice", name="Warning: Missile Lock", emoji="⚠️", color="#ffd43b", tags=["alert", "voice"],
             audio=make_missile_lock_voice(lines["missile-lock-voice"])),
        dict(id="pull-up", name="Pull Up! Pull Up!", emoji="⛰️", color="#ff6b6b", tags=["alert", "voice"],
             audio=make_pull_up(lines["pull-up"])),
        dict(id="fox-two", name="Fox Two!", emoji="🚀", color="#748ffc", tags=["radio", "lock-on"],
             audio=make_fox_two(lines["fox-two"])),
        dict(id="bogey", name="Bogey On Your Six", emoji="🛩️", color="#b197fc", tags=["radio"],
             audio=radio_call(lines["bogey"], cockpit_noise=True)),
        dict(id="cleared-takeoff", name="Cleared For Takeoff", emoji="🗼", color="#38d9a9", tags=["radio"],
             audio=radio_call(lines["cleared-takeoff"])),
        dict(id="mayday", name="Mayday (Skill Issue)", emoji="📻", color="#f783ac", tags=["radio"],
             audio=radio_call(lines["mayday"], cockpit_noise=True)),
        dict(id="go-around", name="Tower: Go Around", emoji="🔁", color="#4dabf7", tags=["radio"],
             audio=radio_call(lines["go-around"])),
    ]
    for s in cockpit:
        report(s["name"], s["audio"])
    write_pack("cockpit", dict(id="cockpit", category="cockpit", order=3, name="Cockpit", emoji="🎯"), cockpit)


if __name__ == "__main__":
    asyncio.run(main())
