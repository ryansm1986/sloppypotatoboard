"""
Generates the bundled "Airplane" sound pack.

  * Cabin chimes are synthesized from scratch (bell-style additive synthesis).
  * Pilot / flight-attendant announcements are written for this app, voiced with
    Microsoft neural TTS (edge-tts) and run through a cabin-PA simulation:
    PA chime -> mic key-up click -> band-limited, slightly overdriven voice ->
    cabin reverb + engine hum -> key-off click.
  * The jet takeoff is synthesized noise + turbine whine.

Output: 48 kHz FLAC (lossless) in resources/packs/airplane plus pack.json.

Usage:  tools/.venv/Scripts/python tools/make_airplane_pack.py
"""

import asyncio
import hashlib
import json
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy import signal

SR = 48000
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "resources" / "packs" / "airplane"
CACHE = ROOT / "tools" / ".cache" / "tts"
rng = np.random.default_rng(1337)

CAPTAIN = dict(voice="en-US-AndrewMultilingualNeural", rate="-7%", pitch="-5Hz")
ATTENDANT = dict(voice="en-US-EmmaMultilingualNeural", rate="-2%", pitch="+0Hz")

# id, name, emoji, color, hotkey, voice, text
ANNOUNCEMENTS = [
    ("no-healer", "No Healer", "🩹", "#ff6b6b", "num3", CAPTAIN,
     "Uh, ladies and gentlemen, this is your captain speaking. We've just been informed that our team... "
     "has no healer. At this time, please return your seat backs to the upright position... and brace for impact."),
    ("skill-issue", "Skill Issue Turbulence", "🌪️", "#748ffc", "num4", CAPTAIN,
     "Folks, this is your captain. We're going through a little bit of turbulence right now. "
     "Uh, it's not the weather. It's a skill issue. Please keep your seatbelts fastened."),
    ("ping", "Lower Than Your Ping", "📶", "#38d9a9", "num5", CAPTAIN,
     "Folks, we've now reached our cruising altitude of thirty-five thousand feet. "
     "Which is, uh... still lower than your ping."),
    ("gg-go-next", "GG Go Next", "🛬", "#ffa94d", "num6", CAPTAIN,
     "Ladies and gentlemen, welcome to your destination. That landing was... rough. "
     "So, uh, G G, go next. Please exit through the front of the aircraft."),
    ("mute-your-mic", "Mute Your Mic", "🎙️", "#f783ac", "num7", ATTENDANT,
     "Ladies and gentlemen, at this time we ask that you please mute your microphone. "
     "We can all hear you breathing."),
    ("sit-down", "Sit. Down.", "💺", "#ffd43b", "num8", CAPTAIN,
     "Ladies and gentlemen, the captain has turned on the fasten seatbelt sign. "
     "That means, sit down. Sit. Down. Sir. I can see you."),
    ("anyone-fly", "Anyone Know How To Fly?", "🧑‍✈️", "#4dabf7", "num9", CAPTAIN,
     "Uh, hey folks, quick question. Is there anyone on board who knows how to fly a plane? "
     "No reason. Just... curious."),
    ("left-wing", "Left Wing Update", "🛩️", "#b197fc", None, CAPTAIN,
     "Ladies and gentlemen, if you look out the left side of the aircraft, you'll notice that the left wing... "
     "is no longer with us. We're, uh, we're looking into it."),
    ("one-more-lap", "One More Lap", "🔁", "#69db7c", None, CAPTAIN,
     "Uh, folks, we've been cleared to land, but I'm gonna go around one more time, because honestly... "
     "that last one was kinda sick."),
    ("tuna", "Tuna Sandwich", "🐟", "#4dabf7", None, CAPTAIN,
     "Attention passengers. Whoever brought the tuna sandwich on board... we know. Everybody knows."),
    ("lag-spike", "Lag Spike Safety Demo", "🛟", "#ff6b6b", None, ATTENDANT,
     "In the event of a water landing, your seat cushion may be used as a flotation device. "
     "In the event of a lag spike... there is nothing we can do for you."),
    ("carrying", "Absolutely Carrying", "🏆", "#ffd43b", None, CAPTAIN,
     "Ladies and gentlemen, I'd like to give a quick shout out to the passenger in seat twelve A, "
     "who is absolutely carrying this flight right now. Let's give 'em a hand."),
    ("rage-quit", "Rage Quit Policy", "😤", "#ffa94d", None, CAPTAIN,
     "Ladies and gentlemen, we've begun our final descent. If you're planning to rage quit, "
     "please wait until the aircraft has come to a complete stop."),
    ("no-snacks", "No Snacks For You", "🥨", "#e599f7", None, ATTENDANT,
     "We'll be coming through the cabin shortly with complimentary snacks and beverages. "
     "Unfortunately, you will not be receiving any... because you did not help with the objective."),
    ("biscuit", "Co-Pilot Biscuit", "🐕", "#ffa94d", None, CAPTAIN,
     "Uh, folks, this is your captain. I'm gonna go grab a sandwich, so the co-pilot is in charge now. "
     "He is a golden retriever. His name is Biscuit."),
    ("respawn", "Wait For Respawn", "⏳", "#748ffc", None, CAPTAIN,
     "Folks, we're gonna be holding here at the gate for a few minutes, because somebody on this flight "
     "pushed without their team. We'll, uh, wait for the respawn timer."),
]


# ----------------------------------------------------------------------------- DSP helpers

def sos(kind, freq, order=2):
    return signal.butter(order, freq, kind, fs=SR, output="sos")


def filt(x, kind, freq, order=2):
    return signal.sosfilt(sos(kind, freq, order), x)


def peaking(x, f0, gain_db, q):
    """RBJ cookbook peaking EQ."""
    a = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f0 / SR
    alpha = np.sin(w0) / (2 * q)
    b = [1 + alpha * a, -2 * np.cos(w0), 1 - alpha * a]
    den = [1 + alpha / a, -2 * np.cos(w0), 1 - alpha / a]
    return signal.lfilter(b, den, x)


def db(v):
    return 10 ** (v / 20)


def rms(x):
    return float(np.sqrt(np.mean(np.square(x)) + 1e-12))


def place(canvas, x, at_seconds, gain=1.0):
    i = int(at_seconds * SR)
    end = min(len(canvas), i + len(x))
    canvas[i:end] += x[: end - i] * gain


def fade(x, fin=0.005, fout=0.05):
    x = x.copy()
    ni, no = int(fin * SR), int(fout * SR)
    if ni:
        x[:ni] *= np.linspace(0, 1, ni) ** 2
    if no:
        x[-no:] *= np.linspace(1, 0, no) ** 2
    return x


def cabin_ir(rt60=0.32, length=0.6):
    """Small, absorptive room with a few speaker-to-speaker slapbacks down the cabin."""
    n = int(length * SR)
    t = np.arange(n) / SR
    tail = rng.standard_normal(n) * np.exp(-6.91 * t / rt60)
    tail = filt(tail, "lowpass", 4200)
    tail[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
    tail /= np.max(np.abs(tail))
    ir = tail * 0.35
    for d, g in [(0.0062, 0.45), (0.0117, 0.32), (0.0188, 0.26), (0.0263, 0.18), (0.0391, 0.12)]:
        ir[int(d * SR)] += g
    return ir


IR = cabin_ir()


def reverb(x, wet=0.22):
    w = signal.fftconvolve(x, IR)[: len(x) + len(IR)]
    out = np.zeros(len(w))
    out[: len(x)] += x
    return out + w * wet


def bell(freq, dur=2.4, decay=0.75):
    """Soft electronic airliner chime: sine body + a few decaying partials + slow shimmer."""
    t = np.arange(int(dur * SR)) / SR
    y = np.zeros_like(t)
    for ratio, gain, dmul in [(1.0, 1.0, 1.0), (1.0016, 0.12, 0.9), (2.0, 0.22, 0.45),
                              (3.0, 0.07, 0.3), (4.07, 0.025, 0.18), (0.5, 0.05, 1.3)]:
        phase = rng.uniform(0, 2 * np.pi)
        y += gain * np.sin(2 * np.pi * freq * ratio * t + phase) * np.exp(-t / (decay * dmul))
    attack = 1 - np.exp(-t / 0.0025)
    y *= attack
    return fade(y, 0, 0.08)


def overhead_speaker(x):
    x = filt(x, "highpass", 230, 2)
    x = filt(x, "lowpass", 7500, 2)
    return x


def cabin_noise(n, level_db=-44):
    w = rng.standard_normal(n + SR)
    y = filt(w, "lowpass", 160, 2) * 1.0 + filt(w, "lowpass", 650, 2) * 0.45 + filt(w, "bandpass", [380, 420], 2) * 0.05
    y = y[SR:]
    y = y / rms(y) * db(level_db)
    return y


def pa_click(level_db=-20, kind="on"):
    n = int(0.045 * SR)
    t = np.arange(n) / SR
    burst = rng.standard_normal(n) * np.exp(-t / (0.004 if kind == "on" else 0.006))
    burst = filt(burst, "bandpass", [900, 3800], 2)
    thump = np.sin(2 * np.pi * 110 * t) * np.exp(-t / 0.012) * 0.6
    y = burst / (np.max(np.abs(burst)) + 1e-9) + thump
    return y * db(level_db)


def pa_voice(x):
    """Cabin PA: narrow band, honky mids, a little speaker overdrive."""
    y = filt(x, "highpass", 300, 4)
    y = filt(y, "lowpass", 3900, 4)
    y = peaking(y, 2100, 4.5, 0.9)
    y = peaking(y, 950, 2.5, 1.3)
    y = y / (np.max(np.abs(y)) + 1e-9) * 0.85
    drive = 2.0
    y = np.tanh(drive * y) / np.tanh(drive)
    y = filt(y, "lowpass", 5200, 2)
    return y


def finish(y, target_rms_db=-17.0, ceiling_db=-1.0, voiced=None):
    ref = voiced if voiced is not None else y
    y = y * (db(target_rms_db) / rms(ref))
    peak = np.max(np.abs(y))
    if peak > db(ceiling_db):
        y *= db(ceiling_db) / peak
    return y.astype(np.float32)


def trim_silence(x, thresh_db=-50):
    env = np.abs(x) > db(thresh_db)
    idx = np.flatnonzero(env)
    if not len(idx):
        return x
    return x[max(0, idx[0] - int(0.01 * SR)): idx[-1] + int(0.03 * SR)]


# ----------------------------------------------------------------------------- TTS

async def tts(text, voice, rate, pitch):
    import edge_tts

    CACHE.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(f"{voice}|{rate}|{pitch}|{text}".encode()).hexdigest()[:16]
    path = CACHE / f"{key}.mp3"
    for attempt in range(4):  # the TTS service occasionally drops a request
        if path.exists() and path.stat().st_size > 1000:
            break
        try:
            await edge_tts.Communicate(text, voice, rate=rate, pitch=pitch).save(str(path))
        except Exception as err:
            print(f"  tts retry {attempt + 1}: {err}")
            await asyncio.sleep(1.5 * (attempt + 1))
    data, sr = sf.read(str(path), dtype="float64")
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sr != SR:
        g = np.gcd(SR, sr)
        data = signal.resample_poly(data, SR // g, sr // g)
    return trim_silence(data)


# ----------------------------------------------------------------------------- sounds

def make_seatbelt():
    tone = overhead_speaker(bell(1046.5, dur=2.6, decay=0.8))
    canvas = np.zeros(int(3.0 * SR))
    place(canvas, tone, 0.02)
    canvas = reverb(canvas, 0.16)
    return finish(fade(canvas, 0, 0.3), target_rms_db=-20, ceiling_db=-3)


def make_bing_bong():
    hi = overhead_speaker(bell(1318.5, dur=1.6, decay=0.55))
    lo = overhead_speaker(bell(1046.5, dur=2.6, decay=0.8))
    canvas = np.zeros(int(3.2 * SR))
    place(canvas, hi, 0.02)
    place(canvas, lo, 0.62)
    canvas = reverb(canvas, 0.16)
    return finish(fade(canvas, 0, 0.3), target_rms_db=-20, ceiling_db=-3)


def make_announcement(voice_audio):
    voice = pa_voice(voice_audio)
    chime = overhead_speaker(bell(1046.5, dur=2.2, decay=0.65))

    voice_at = 1.05
    total = voice_at + len(voice) / SR + 0.9
    n = int(total * SR)
    dry = np.zeros(n)
    place(dry, chime, 0.02, 0.32)
    place(dry, pa_click(-22, "on"), voice_at - 0.16)
    # open-mic hiss while the PA is keyed
    keyed = int((len(voice) / SR + 0.4) * SR)
    hiss = filt(rng.standard_normal(keyed), "highpass", 1800, 2)
    hiss = fade(hiss / rms(hiss) * db(-52), 0.02, 0.02)
    place(dry, hiss, voice_at - 0.15)
    place(dry, voice, voice_at)
    place(dry, pa_click(-24, "off"), voice_at + len(voice) / SR + 0.22)

    out = reverb(dry, 0.24)
    out[: n] += fade(cabin_noise(n), 0.25, 0.5)
    out = fade(out, 0.002, 0.35)
    voiced = out[int(voice_at * SR): int(voice_at * SR) + len(voice)]
    return finish(out, target_rms_db=-17, ceiling_db=-1, voiced=voiced)


def make_jet():
    dur = 11.0
    n = int(dur * SR)
    t = np.arange(n) / SR
    block = 512

    def ramp(points):
        xs, ys = zip(*points)
        return np.interp(t, xs, ys)

    # Turbine whine: rises in pitch as the engines spool up, then fades under the roar.
    f_whine = ramp([(0, 380), (2.5, 1500), (5.0, 2900), (11, 3100)])
    phase = 2 * np.pi * np.cumsum(f_whine) / SR
    whine = (np.sin(phase) + 0.35 * np.sin(2 * phase + 0.4) + 0.15 * np.sin(3.02 * phase)) * (
        1 + 0.08 * np.sin(2 * np.pi * 5.3 * t))
    whine *= ramp([(0, 0.0), (0.6, 0.12), (3.5, 0.22), (6.5, 0.12), (11, 0.02)])

    # Roar: time-varying band-pass noise, opening up as thrust builds.
    white = rng.standard_normal(n)
    roar = np.zeros(n)
    zi = None
    center = ramp([(0, 220), (3, 420), (6, 750), (8.5, 650), (11, 300)])
    width = ramp([(0, 1.2), (6, 2.6), (11, 1.4)])
    for i in range(0, n, block):
        c = center[i]
        lo, hi = c / width[i], min(c * width[i], SR / 2 - 100)
        s = signal.butter(2, [lo, hi], "bandpass", fs=SR, output="sos")
        if zi is None:
            zi = signal.sosfilt_zi(s) * 0
        roar[i:i + block], zi = signal.sosfilt(s, white[i:i + block], zi=zi)
    roar *= ramp([(0, 0.0), (1.5, 0.15), (5.5, 1.0), (8.0, 0.9), (11, 0.0)])

    rumble = filt(rng.standard_normal(n), "lowpass", 90, 2)
    rumble = rumble / rms(rumble) * ramp([(0, 0.0), (2, 0.1), (6, 0.55), (8.5, 0.45), (11, 0.0)])

    crackle = filt(rng.standard_normal(n), "highpass", 2500, 2) * (rng.random(n) < 0.002)
    crackle = filt(crackle, "lowpass", 7000, 1) * ramp([(0, 0), (5, 0.6), (8, 0.4), (11, 0)])

    mix = whine * 0.5 + roar / rms(roar) * 0.18 + rumble * 0.6 + crackle * 3
    # Doppler-ish darkening as the plane leaves.
    dark = filt(mix, "lowpass", 900, 2)
    blend = ramp([(0, 0), (7.5, 0), (11, 1)])
    mix = mix * (1 - blend) + dark * blend
    mix = reverb(mix, 0.12)[:n]
    return finish(fade(mix, 0.05, 1.2), target_rms_db=-18, ceiling_db=-1.5)


# ----------------------------------------------------------------------------- main

async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sounds = []

    def save(sid, name, emoji, color, hotkey, audio, tags):
        file = f"{sid}.flac"
        sf.write(str(OUT / file), audio, SR, subtype="PCM_16")
        sounds.append(dict(id=sid, name=name, emoji=emoji, color=color, hotkey=hotkey, file=file, tags=tags))
        print(f"  {name:<28} {len(audio) / SR:5.1f}s  peak {20 * np.log10(np.max(np.abs(audio))):6.1f} dBFS")

    save("seatbelt", "Seatbelt Sign", "🔔", "#4dabf7", "num1", make_seatbelt(), ["chime"])
    save("bing-bong", "Call Button Bing-Bong", "🛎️", "#38d9a9", "num2", make_bing_bong(), ["chime"])

    voices = await asyncio.gather(*[tts(text, **who) for (_, _, _, _, _, who, text) in ANNOUNCEMENTS])
    for (sid, name, emoji, color, hotkey, who, _), v in zip(ANNOUNCEMENTS, voices):
        role = "captain" if who is CAPTAIN else "attendant"
        save(sid, name, emoji, color, hotkey, make_announcement(v), ["announcement", role])

    save("jet-takeoff", "Jet Takeoff", "🛫", "#748ffc", None, make_jet(), ["effect"])

    pack = dict(format="sloppy-potato-pack", version=1, id="airplane", category="airplane", order=1,
                name="Airplane", emoji="✈️", sounds=sounds)
    (OUT / "pack.json").write_text(json.dumps(pack, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {len(sounds)} sounds to {OUT}")


if __name__ == "__main__":
    asyncio.run(main())
