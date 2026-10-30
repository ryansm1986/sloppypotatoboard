// Audio engine.
//
// Two AudioContexts:
//   game    -> the virtual cable ("CABLE Input"). Carries your real mic + the clips.
//              Games / Discord listen to the other end of the cable ("CABLE Output").
//   monitor -> your headphones. Carries only the clips so you hear what you play.
//
// "Auto-swap" fades the mic out the moment a clip starts and back in when it ends,
// so the game hears either you or the board, never a muddy mix.

export const isCableCapture = (label = '') => /CABLE[^()]*Output/i.test(label);
export const isCablePlayback = (label = '') => /CABLE[^()]*Input/i.test(label);
const stripPrefix = (label = '') => label.replace(/^(Default|Communications) - /, '');

function softClipper(ctx) {
  const ws = ctx.createWaveShaper();
  const n = 4096;
  const knee = 0.8;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    curve[i] = a <= knee ? x : Math.sign(x) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
  }
  ws.curve = curve;
  ws.oversample = '2x';
  return ws;
}

function makeAnalyser(ctx) {
  const a = ctx.createAnalyser();
  a.fftSize = 1024;
  a.smoothingTimeConstant = 0;
  a._buf = new Float32Array(a.fftSize);
  return a;
}

function peakOf(analyser) {
  if (!analyser) return 0;
  analyser.getFloatTimeDomainData(analyser._buf);
  let peak = 0;
  for (const v of analyser._buf) {
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
  }
  return peak;
}

/** Waveform bars + a loudness-matching gain for a decoded clip. */
function analyze(buf, bars = 48) {
  const channels = [];
  for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
  const n = buf.length;
  const per = Math.max(1, Math.floor(n / bars));
  const sums = new Float64Array(bars);
  const counts = new Uint32Array(bars);
  let peak = 0;
  let activeSq = 0;
  let active = 0;
  const inv = 1 / channels.length;
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (const ch of channels) v += ch[i];
    v *= inv;
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
    if (a > 0.004) {
      activeSq += v * v;
      active++;
    }
    const b = Math.min(bars - 1, (i / per) | 0);
    sums[b] += v * v;
    counts[b]++;
  }
  const rmsBars = Array.from(sums, (s, i) => Math.sqrt(s / Math.max(1, counts[i])));
  const max = Math.max(...rmsBars, 1e-6);
  const peaks = rmsBars.map((v) => Math.max(0.06, Math.sqrt(v / max)));
  const rms = Math.sqrt(activeSq / Math.max(1, active));
  let norm = rms > 0 ? 0.1 / rms : 1; // aim for ~-20 dBFS RMS
  norm = Math.min(norm, 1.25 / Math.max(peak, 1e-4));
  norm = Math.max(0.25, Math.min(4, norm));
  return { peaks, norm, duration: buf.duration };
}

const sameSink = (a, b) =>
  typeof a === 'object' || typeof b === 'object' ? a?.type === b?.type && typeof a === typeof b : a === b;

export class AudioEngine {
  constructor() {
    this.listeners = new Map();
    this.buffers = new Map();
    this.meta = new Map();
    this.loading = new Map();
    this.playing = new Map();
    this.devices = { inputs: [], outputs: [] };
    this.defaultInputLabel = '';
    this.defaultOutputLabel = '';
    this.status = { mic: null, micError: null, game: null, monitor: null, cable: false, cableMic: false };
    this.settings = {};
    this.gateOpen = true;
    this.micOp = Promise.resolve();
    this.micStream = null;
    this.micSource = null;
    this.micDeviceId = null;
    this.listening = false;
    this.listenViaCable = false;
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event).delete(fn);
  }

  emit(event, payload) {
    this.listeners.get(event)?.forEach((fn) => fn(payload));
  }

  async start(settings, readSound) {
    this.readSound = readSound;
    this.settings = { ...settings };

    const game = (this.game = { ctx: new AudioContext({ latencyHint: 'interactive' }) });
    // Until we know where the virtual cable is the game mix goes nowhere, so you never hear your own mic.
    await game.ctx.setSinkId({ type: 'none' }).catch(() => {});
    game.input = game.ctx.createGain();
    game.analyser = makeAnalyser(game.ctx);
    game.input.connect(softClipper(game.ctx)).connect(game.analyser).connect(game.ctx.destination);
    game.clips = game.ctx.createGain();
    game.clips.connect(game.input);
    game.clipAnalyser = makeAnalyser(game.ctx);
    game.clips.connect(game.clipAnalyser);
    game.micHP = new BiquadFilterNode(game.ctx, { type: 'highpass', frequency: 75, Q: 0.7 });
    game.micAnalyser = makeAnalyser(game.ctx);
    game.micVol = game.ctx.createGain();
    game.micGate = game.ctx.createGain();
    game.micHP.connect(game.micAnalyser);
    game.micHP.connect(game.micVol).connect(game.micGate).connect(game.input);

    const mon = (this.mon = { ctx: new AudioContext({ latencyHint: 'interactive' }) });
    mon.clips = mon.ctx.createGain();
    mon.analyser = makeAnalyser(mon.ctx);
    mon.clips.connect(softClipper(mon.ctx)).connect(mon.analyser).connect(mon.ctx.destination);
    mon.listen = mon.ctx.createGain();
    mon.listen.connect(mon.ctx.destination);

    await this.unlockDeviceLabels();
    await this.refreshDevices();
    await this.apply(settings, true);

    let t = null;
    navigator.mediaDevices.addEventListener('devicechange', () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        await this.refreshDevices();
        await this.applyDevices();
      }, 400);
    });
    game.ctx.resume();
    mon.ctx.resume();
  }

  // ------------------------------------------------------------------ devices

  async unlockDeviceLabels() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch (err) {
      this.status.micError = this.micErrorText(err);
    }
  }

  micErrorText(err) {
    if (err?.name === 'NotAllowedError') return 'Windows is blocking microphone access (Settings › Privacy › Microphone)';
    if (err?.name === 'NotFoundError') return 'No microphone found';
    if (err?.name === 'NotReadableError') return 'Your mic is being used exclusively by another app';
    return err?.message || 'Microphone error';
  }

  async refreshDevices() {
    const all = await navigator.mediaDevices.enumerateDevices();
    const real = (d) => d.deviceId !== 'default' && d.deviceId !== 'communications';
    const pick = ({ deviceId, label }) => ({ deviceId, label: label || 'Unknown device' });
    this.devices = {
      inputs: all.filter((d) => d.kind === 'audioinput' && real(d)).map(pick),
      outputs: all.filter((d) => d.kind === 'audiooutput' && real(d)).map(pick),
    };
    this.defaultInputLabel = stripPrefix(all.find((d) => d.kind === 'audioinput' && d.deviceId === 'default')?.label);
    this.defaultOutputLabel = stripPrefix(all.find((d) => d.kind === 'audiooutput' && d.deviceId === 'default')?.label);
    this.status.cable = this.devices.outputs.some((d) => isCablePlayback(d.label));
    this.status.cableMic = this.devices.inputs.some((d) => isCableCapture(d.label));
    this.emit('devices', this.devices);
    this.emit('status', this.status);
  }

  /** Real microphones only: the cable's output is excluded so we can never feed ourselves. */
  micChoices() {
    return this.devices.inputs.filter((d) => !isCableCapture(d.label));
  }

  monitorChoices() {
    return this.devices.outputs.filter((d) => !isCablePlayback(d.label));
  }

  pickMic() {
    const ins = this.micChoices();
    return (
      ins.find((d) => d.label === this.settings.micLabel) ||
      ins.find((d) => d.label === this.defaultInputLabel) ||
      ins[0] ||
      null
    );
  }

  pickGame() {
    const outs = this.devices.outputs;
    if (this.settings.gameLabel) {
      const d = outs.find((x) => x.label === this.settings.gameLabel);
      if (d) return d;
    }
    return outs.find((d) => isCablePlayback(d.label)) || null;
  }

  pickMonitor() {
    const outs = this.monitorChoices();
    if (this.settings.monitorLabel) {
      const d = outs.find((x) => x.label === this.settings.monitorLabel);
      if (d) return d;
    }
    // If Windows' default output *is* the cable, don't monitor into it.
    if (isCablePlayback(this.defaultOutputLabel)) return outs[0] || null;
    return null; // system default
  }

  async applyDevices() {
    const game = this.pickGame();
    const gameSink = game ? game.deviceId : { type: 'none' };
    if (!sameSink(this.game.ctx.sinkId, gameSink)) {
      await this.game.ctx.setSinkId(gameSink).catch((e) => console.warn('game sink', e));
    }
    const mon = this.pickMonitor();
    const monSink = mon ? mon.deviceId : '';
    if (!sameSink(this.mon.ctx.sinkId, monSink)) {
      await this.mon.ctx.setSinkId(monSink).catch((e) => console.warn('monitor sink', e));
    }
    this.status.game = game?.label || null;
    this.status.monitor = mon?.label || this.defaultOutputLabel || 'Default speakers';
    if (this.pickMic()?.deviceId !== this.micDeviceId) await this.openMic();
    this.emit('status', this.status);
  }

  openMic() {
    this.micOp = this.micOp.then(() => this._openMic()).catch((e) => console.warn(e));
    return this.micOp;
  }

  async _openMic() {
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micSource?.disconnect();
    this.micStream = this.micSource = this.micDeviceId = null;
    const mic = this.pickMic();
    if (!mic) {
      this.status.mic = null;
      this.status.micError = this.status.micError || 'No microphone found';
      this.emit('status', this.status);
      return;
    }
    const s = this.settings;
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: mic.deviceId },
          echoCancellation: !!s.echoCancellation,
          noiseSuppression: !!s.noiseSuppression,
          autoGainControl: false,
          channelCount: { ideal: 1 },
          sampleRate: { ideal: 48000 },
        },
      });
      this.micSource = this.game.ctx.createMediaStreamSource(this.micStream);
      this.micSource.connect(this.game.micHP);
      this.micDeviceId = mic.deviceId;
      this.status.mic = mic.label;
      this.status.micError = null;
    } catch (err) {
      this.status.mic = mic.label;
      this.status.micError = this.micErrorText(err);
    }
    this.emit('status', this.status);
  }

  // ------------------------------------------------------------------ settings

  ramp(ctx, param, value, tc = 0.03) {
    if (!param || typeof value !== 'number') return;
    const now = ctx.currentTime;
    param.cancelAndHoldAtTime(now);
    param.setTargetAtTime(value, now, tc);
  }

  async apply(next, force = false) {
    const prev = this.settings;
    this.settings = { ...next };
    const changed = (k) => force || prev[k] !== next[k];
    if (['gameLabel', 'monitorLabel'].some(changed)) await this.applyDevices();
    if (['micLabel', 'noiseSuppression', 'echoCancellation'].some(changed)) await this.openMic();
    this.ramp(this.game.ctx, this.game.micVol.gain, next.micVolume);
    this.ramp(this.game.ctx, this.game.clips.gain, next.gameVolume);
    this.ramp(this.mon.ctx, this.mon.clips.gain, this.listening && this.listenViaCable ? 0 : next.monitorVolume);
    this.updateMicGate(force);
  }

  updateMicGate(force = false) {
    const s = this.settings;
    const live = [...this.playing.values()].some((e) => !e.preview);
    const open = !s.micMuted && !(s.micMode === 'swap' && live);
    if (open === this.gateOpen && !force) return;
    this.gateOpen = open;
    const p = this.game.micGate.gain;
    const t = this.game.ctx.currentTime;
    p.cancelAndHoldAtTime(t);
    if (open) p.setTargetAtTime(1, t + 0.15, 0.07); // short hold, then ease back in
    else p.setTargetAtTime(0, t, 0.015); // duck fast so the clip lands clean
    this.emit('gate', { micLive: open, boardLive: live });
  }

  // ------------------------------------------------------------------ clips

  key(sound) {
    return `${sound.id}|${sound.file}`;
  }

  metaFor(sound) {
    return this.meta.get(this.key(sound));
  }

  load(sound) {
    if (!sound?.file) return Promise.resolve(null);
    const key = this.key(sound);
    if (this.buffers.has(key)) return Promise.resolve(this.buffers.get(key));
    if (!this.loading.has(key)) {
      const job = (async () => {
        const bytes = await this.readSound(sound.id);
        const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const buf = await this.game.ctx.decodeAudioData(ab);
        this.buffers.set(key, buf);
        this.meta.set(key, analyze(buf));
        return buf;
      })().finally(() => this.loading.delete(key));
      this.loading.set(key, job);
    }
    return this.loading.get(key);
  }

  forget(sound) {
    for (const k of [...this.buffers.keys()]) if (k.startsWith(`${sound.id}|`)) this.buffers.delete(k);
  }

  voice(bus, buf, gain, delay) {
    const src = bus.ctx.createBufferSource();
    src.buffer = buf;
    const g = bus.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(bus.clips);
    src.start(bus.ctx.currentTime + delay);
    return { ctx: bus.ctx, src, g };
  }

  /** Plays to the game + your ears, or with preview=true only to your ears. */
  async play(sound, { preview = false } = {}) {
    const buf = await this.load(sound);
    if (!buf) return false;
    const meta = this.metaFor(sound);
    const gain = (sound.volume ?? 1) * (this.settings.normalize ? meta.norm : 1);

    this.stop(sound.id, 0.015);
    if (!preview && !this.settings.allowOverlap) this.stopAll(0.05);

    // In auto-swap, give the mic ~60 ms to duck before the clip lands in the game.
    const swapping = !preview && this.settings.micMode === 'swap' && !this.settings.micMuted && this.micStream;
    const delay = swapping ? 0.06 : 0;
    const voices = [this.voice(this.mon, buf, gain, 0)];
    if (!preview) voices.push(this.voice(this.game, buf, gain, delay));

    const entry = { id: sound.id, voices, startedAt: performance.now(), duration: buf.duration, preview };
    voices[voices.length - 1].src.onended = () => {
      if (this.playing.get(sound.id) !== entry) return;
      this.playing.delete(sound.id);
      this.updateMicGate();
      this.emit('playing', this.playing);
    };
    this.playing.set(sound.id, entry);
    this.updateMicGate();
    this.emit('playing', this.playing);
    return true;
  }

  stop(id, fade = 0.04) {
    const e = this.playing.get(id);
    if (!e) return;
    this.playing.delete(id);
    for (const v of e.voices) {
      const t = v.ctx.currentTime;
      v.g.gain.cancelAndHoldAtTime(t);
      v.g.gain.linearRampToValueAtTime(0, t + fade);
      try {
        v.src.stop(t + fade + 0.01);
      } catch {
        /* already stopped */
      }
    }
    this.updateMicGate();
    this.emit('playing', this.playing);
  }

  stopAll(fade = 0.08) {
    for (const id of [...this.playing.keys()]) this.stop(id, fade);
  }

  // ------------------------------------------------------------------ testing

  /** Hear exactly what games hear (reads back the cable), or just your mic if there is no cable. */
  async setListening(on) {
    this.listenStream?.getTracks().forEach((t) => t.stop());
    this.listenSrc?.disconnect();
    this.listenStream = this.listenSrc = null;
    this.listening = false;
    this.listenViaCable = false;
    if (on) {
      const cable = this.devices.inputs.find((d) => isCableCapture(d.label));
      const game = this.pickGame();
      try {
        if (cable && game && isCablePlayback(game.label)) {
          this.listenStream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: cable.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          });
          this.listenViaCable = true;
        } else if (this.micStream) {
          this.listenStream = this.micStream.clone();
        }
        if (this.listenStream) {
          this.listenSrc = this.mon.ctx.createMediaStreamSource(this.listenStream);
          this.listenSrc.connect(this.mon.listen);
          this.listening = true;
        }
      } catch (err) {
        console.warn('listen', err);
      }
    }
    this.ramp(this.mon.ctx, this.mon.clips.gain, this.listenViaCable ? 0 : this.settings.monitorVolume);
    this.emit('status', this.status);
    return this.listening;
  }

  levels() {
    return {
      mic: this.micStream ? peakOf(this.game.micAnalyser) * (this.settings.micVolume ?? 1) : 0,
      game: peakOf(this.game.clipAnalyser),
      monitor: peakOf(this.mon.analyser),
    };
  }
}
