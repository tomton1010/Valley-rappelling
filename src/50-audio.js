// ============================================================================
// 50-audio.js — AudioEngine fragment (concatenated into one shared ES module).
// Fully procedural WebAudio: original pastoral BGM (104 BPM, D major
// pentatonic, D–Bm–G–A pad loop, 16-bar composed phrase with deterministic
// variation), speed-driven wind, bike/horse/board vehicle layers, 16 SFX.
// No external assets, no timers: all scheduling is driven by update(dt, s)
// against ctx.currentTime with a 0.35s lookahead. Safe before unlock().
// ============================================================================

class AudioEngine {
  constructor() {
    // No AudioContext here (autoplay policy): fields only.
    this.ctx = null;
    this._built = false;
    this._running = false;
    this._unlocking = null;
    this._volume = 0.75;
    this._muted = false;
    this._paused = false;

    this._levels = { music: 0.32, sfx: 0.6, wind: 0.35, veh: 0.55 };
    this._master = null;
    this._comp = null;
    this._music = null;
    this._sfxBus = null;
    this._windBus = null;
    this._vehBus = null;
    this._delay = null;
    this._delayDamp = null;
    this._delayFb = null;
    this._delayWet = null;
    this._noiseBuf = null;
    this._windGain = null;
    this._windFilter = null;
    this._layers = null;
    this._bikeRollGain = null;
    this._boardOsc1 = null;
    this._boardOsc2 = null;
    this._boardSub = null;
    this._boardFilter = null;
    this._boardHumGain = null;

    // Transport / sequencer state.
    this._bpm = 104;
    this._beat = 60 / 104;
    this._eighth = this._beat / 2;
    this._bar = this._beat * 4;
    this._step = 0;
    this._cycle = 0;
    this._nextNoteTime = 0;
    this._nextHoof = null;
    this._hoofIdx = 0;
    this._nextChain = null;
    this._chainIdx = 0;
    this._speedSm = 0;
    this._lastParamT = -1;
    this._layerTgt = { bike: -1, horse: -1, board: -1 };
    this._sfxLast = new Map();

    // Deterministic LCG (seeded once) for noise + composed variation.
    this._seed = 0x51f7a3c9;

    // Chord pads: pentatonic-safe voicings over D – Bm – G – A.
    // G bar: B3 D4 A4 (G6/9, root in bass) — A bar: A3 E4 B4 (Aadd9).
    this._chords = [
      [57, 62, 66], // D : A3 D4 F#4
      [59, 62, 66], // Bm: B3 D4 F#4
      [59, 62, 69], // G : B3 D4 A4
      [57, 64, 71], // A : A3 E4 B4
    ];
    this._roots = [50, 47, 43, 45]; // D3 B2 G2 A2

    // Original 16-bar lead phrase, eighth-note grid (128 steps).
    // Entries: [step, midi, lengthInSteps, velocity]; all D E F# A B.
    this._melody = new Array(128).fill(null);
    const phrase = [
      [0, 66, 2, 0.72], [2, 69, 2, 0.7], [4, 71, 3, 0.8], [7, 69, 1, 0.6],
      [8, 66, 2, 0.7], [10, 64, 1, 0.55], [11, 66, 1, 0.6], [12, 62, 4, 0.75],
      [16, 64, 2, 0.68], [18, 66, 1, 0.6], [19, 64, 1, 0.55], [20, 62, 2, 0.7], [22, 59, 2, 0.62],
      [24, 64, 2, 0.66], [26, 69, 2, 0.72], [28, 71, 4, 0.78],
      [32, 74, 2, 0.8], [34, 71, 2, 0.7], [36, 69, 3, 0.72], [39, 66, 1, 0.58],
      [40, 66, 1, 0.6], [41, 64, 1, 0.55], [42, 66, 2, 0.66], [44, 71, 4, 0.74],
      [48, 69, 2, 0.72], [50, 66, 1, 0.6], [51, 64, 1, 0.55], [52, 62, 3, 0.7], [55, 64, 1, 0.55],
      [56, 64, 2, 0.64], [58, 69, 6, 0.72],
      [64, 69, 1, 0.66], [65, 71, 1, 0.68], [66, 74, 2, 0.8], [68, 76, 3, 0.82], [71, 74, 1, 0.62],
      [72, 71, 2, 0.72], [74, 74, 1, 0.66], [75, 71, 1, 0.6], [76, 69, 2, 0.68], [78, 66, 2, 0.6],
      [80, 71, 1, 0.66], [81, 74, 1, 0.7], [82, 76, 2, 0.8], [84, 74, 2, 0.72], [86, 71, 2, 0.64],
      [88, 69, 2, 0.7], [90, 71, 1, 0.62], [91, 69, 1, 0.58], [92, 64, 4, 0.66],
      [96, 78, 2, 0.82], [98, 76, 1, 0.7], [99, 74, 1, 0.66], [100, 69, 3, 0.72], [103, 71, 1, 0.6],
      [104, 74, 2, 0.76], [106, 71, 2, 0.68], [108, 66, 2, 0.62], [110, 69, 2, 0.66],
      [112, 71, 2, 0.72], [114, 69, 1, 0.62], [115, 66, 1, 0.58], [116, 64, 2, 0.64], [118, 62, 2, 0.68],
      [120, 64, 2, 0.62], [122, 69, 6, 0.7],
    ];
    for (const n of phrase) this._melody[n[0]] = [n[1], n[2], n[3]];

    // Fixed per-step variation table: on odd 16-bar cycles a few notes rest,
    // a few lift an octave, velocities breathe; even cycles add soft echoes.
    this._varTab = new Float32Array(128);
    for (let i = 0; i < 128; i++) this._varTab[i] = this._rng();
  }

  async unlock() {
    if (this._unlocking) {
      try { return await this._unlocking; } catch { return false; }
    }
    const run = async () => {
      if (!this.ctx) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) return false;
        try { this.ctx = new AC({ latencyHint: 'interactive' }); }
        catch { this.ctx = new AC(); }
        this._buildGraph();
        this._built = true;
        this._nextNoteTime = this.ctx.currentTime + 0.12;
      }
      if (this.ctx.state !== 'running') {
        try { await this.ctx.resume(); } catch { /* resume rejected; retry later */ }
      }
      if (this.ctx.state !== 'running') return false;
      this._running = true;
      const t = this.ctx.currentTime;
      this._master.gain.setValueAtTime(this._muted ? 0 : this._volume, t);
      if (this._paused) this.setPaused(true);
      return true;
    };
    this._unlocking = run();
    try {
      return await this._unlocking;
    } catch {
      if (this.ctx && !this._built) {
        try { this.ctx.close(); } catch { /* already closed */ }
        this.ctx = null;
      }
      return false;
    } finally {
      this._unlocking = null;
    }
  }

  get ready() {
    return !!(this.ctx && this._running && this.ctx.state === 'running');
  }

  get muted() {
    return this._muted;
  }

  setMuted(muted) {
    this._muted = !!muted;
    if (!this.ctx) return;
    const g = this._master.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(this._muted ? 0 : this._volume, t, 0.04); // ~0.12s settle
  }

  setVolume(v) {
    this._volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (!this.ctx || this._muted) return;
    const g = this._master.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(this._volume, t, 0.04);
  }

  setPaused(paused) {
    this._paused = !!paused;
    if (!this.ctx) return;
    const d = this._paused ? 0.16 : 1;
    const t = this.ctx.currentTime;
    const ducked = [
      [this._music, this._levels.music],
      [this._windBus, this._levels.wind],
      [this._vehBus, this._levels.veh],
    ];
    for (const [bus, base] of ducked) {
      bus.gain.cancelScheduledValues(t);
      bus.gain.setTargetAtTime(base * d, t, 0.12);
    }
  }

  update(dt, s) {
    if (!this.ctx || !this._built) return;
    try {
      const st = s || {};
      const now = this.ctx.currentTime;
      const sp01 = Math.max(0, Math.min(1, st.speed01 || 0));
      const k = Math.min(1, Math.max(0, dt || 0) * 7);
      this._speedSm += (sp01 - this._speedSm) * k;
      const v = this._speedSm;
      const playing = !!st.playing && !st.crashed;
      const air = !!st.airborne;
      const veh = st.vehicle || 'bike';

      this._scheduleMusic(now);

      this._setLayer('bike', veh === 'bike' && playing && !air ? 1 : 0, now);
      this._setLayer('horse', veh === 'horse' && playing && !air ? 1 : 0, now);
      this._setLayer('board', veh === 'board' && playing ? (air ? 0.35 : 1) : 0, now);

      if (now - this._lastParamT > 0.06) {
        this._lastParamT = now;
        this._updateParams(v, now);
      }

      if (veh === 'bike' && playing && !air) this._scheduleChain(now, v);
      else this._nextChain = null;
      if (veh === 'horse' && playing && !air) this._scheduleHooves(now, v);
      else this._nextHoof = null;
    } catch { /* a bad frame must never break the game loop */ }
  }

  sfx(name, opts) {
    if (!this.ctx || !this._built) return;
    try {
      const now = this.ctx.currentTime;
      const last = this._sfxLast.get(name);
      if (last !== undefined && now - last < 0.04) return; // 40ms per-name limit
      const o = opts || {};
      const gm = Math.max(0, Math.min(2, o.gain ?? 1));
      if (gm === 0) return;
      const dt = Math.pow(2, (o.detune || 0) / 1200);
      const t = now + 0.005;
      const B = this._sfxBus;
      switch (name) {
        case 'jump': {
          this._tone(B, t, { type: 'triangle', f: 300 * dt, f2: 760 * dt, glideT: 0.16, dur: 0.2, a: 0.006, g: 0.22 * gm });
          this._tone(B, t, { type: 'sine', f: 600 * dt, f2: 1520 * dt, glideT: 0.16, dur: 0.16, a: 0.006, g: 0.08 * gm });
          break;
        }
        case 'land': {
          this._noiseHit(B, t, { dur: 0.12, a: 0.003, g: 0.3 * gm, filt: { type: 'lowpass', f: 650, q: 0.7 } });
          this._tone(B, t, { type: 'sine', f: 95 * dt, f2: 52 * dt, glideT: 0.12, dur: 0.16, a: 0.004, g: 0.34 * gm });
          break;
        }
        case 'hardLand': {
          this._noiseHit(B, t, { dur: 0.28, a: 0.003, g: 0.5 * gm, filt: { type: 'lowpass', f: 420, q: 0.8 } });
          this._tone(B, t, { type: 'sine', f: 78 * dt, f2: 36 * dt, glideT: 0.3, dur: 0.34, a: 0.004, g: 0.55 * gm });
          this._noiseHit(B, t + 0.03, { dur: 0.5, a: 0.012, g: 0.38 * gm, filt: { type: 'lowpass', f: 130, q: 0.5 } });
          break;
        }
        case 'crate': {
          this._noiseHit(B, t, { dur: 0.06, a: 0.001, g: 0.4 * gm, filt: { type: 'bandpass', f: 1900, q: 1.6 } });
          this._noiseHit(B, t + 0.02, { dur: 0.12, a: 0.002, g: 0.2 * gm, filt: { type: 'bandpass', f: 900, q: 1.2 } });
          const knocks = [[0, 620], [0.032, 470], [0.068, 350]];
          for (const [off, f] of knocks) {
            this._tone(B, t + off, { type: 'triangle', f: f * dt, dur: 0.045, a: 0.001, g: 0.22 * gm, filt: { type: 'bandpass', f: f * dt, q: 6 } });
          }
          break;
        }
        case 'fence': {
          this._noiseHit(B, t, { dur: 0.05, a: 0.001, g: 0.32 * gm, filt: { type: 'lowpass', f: 750, q: 0.6 } });
          const knocks = [[0, 190], [0.028, 150], [0.055, 120]];
          for (const [off, f] of knocks) {
            this._tone(B, t + off, { type: 'triangle', f: f * dt, dur: 0.03, a: 0.001, g: 0.18 * gm, filt: { type: 'bandpass', f: f * dt, q: 3 } });
          }
          break;
        }
        case 'boost': {
          this._tone(B, t, { type: 'sawtooth', f: 190 * dt, f2: 980 * dt, glideT: 0.38, dur: 0.42, a: 0.01, g: 0.2 * gm, filt: { type: 'lowpass', f: 700, f2: 4200, q: 1.2 } });
          this._bell(B, t + 0.08, 1760 * dt, 0.5, 0.12 * gm);
          this._bell(B, t + 0.16, 2349.32 * dt, 0.4, 0.07 * gm);
          break;
        }
        case 'trick': {
          const arp = [1174.66, 1479.98, 1760]; // D6 F#6 A6
          for (let i = 0; i < 3; i++) this._bell(B, t + i * 0.07, arp[i] * dt, 0.32, 0.16 * gm);
          break;
        }
        case 'checkpoint': {
          this._tone(B, t, { type: 'triangle', f: 880 * dt, dur: 0.4, a: 0.008, g: 0.16 * gm, filt: { type: 'lowpass', f: 2600, q: 0.6 } });
          this._tone(B, t, { type: 'sine', f: 880 * dt, dur: 0.35, a: 0.008, g: 0.1 * gm });
          this._tone(B, t + 0.13, { type: 'triangle', f: 1174.66 * dt, dur: 0.55, a: 0.008, g: 0.16 * gm, filt: { type: 'lowpass', f: 3000, q: 0.6 } });
          this._tone(B, t + 0.13, { type: 'sine', f: 1174.66 * dt, dur: 0.5, a: 0.008, g: 0.1 * gm });
          break;
        }
        case 'finish': {
          const fan = [[0, 587.33, 0.3], [0.11, 880, 0.3], [0.22, 987.77, 0.3], [0.33, 1174.66, 0.34], [0.46, 1479.98, 0.4], [0.62, 1760, 0.9]];
          for (const [off, f, dur] of fan) {
            this._tone(B, t + off, { type: 'sawtooth', f: f * dt, dur, a: 0.01, g: 0.11 * gm, filt: { type: 'lowpass', f: 3200, q: 0.7 } });
            this._tone(B, t + off, { type: 'triangle', f: f * dt, dur: dur * 0.9, a: 0.008, g: 0.1 * gm });
          }
          // Warm sustained D-major pad under the fanfare.
          const c = this.ctx;
          const lp = c.createBiquadFilter();
          lp.type = 'lowpass'; lp.frequency.value = 1000; lp.Q.value = 0.5;
          const env = c.createGain();
          const end = t + 2.1;
          env.gain.setValueAtTime(0.0001, t);
          env.gain.linearRampToValueAtTime(0.055 * gm, t + 0.3);
          env.gain.setValueAtTime(0.055 * gm, t + 1.1);
          env.gain.linearRampToValueAtTime(0.0001, end);
          lp.connect(env); env.connect(B);
          const oscs = [];
          const padNotes = [62, 69, 74];
          const dets = [-6, 5, -3];
          for (let i = 0; i < 3; i++) {
            const osc = c.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.value = this._midi(padNotes[i]) * dt;
            osc.detune.value = dets[i];
            osc.connect(lp);
            osc.start(t); osc.stop(end + 0.05);
            oscs.push(osc);
          }
          oscs[2].onended = () => {
            oscs[2].onended = null;
            for (const os of oscs) os.disconnect();
            lp.disconnect(); env.disconnect();
          };
          break;
        }
        case 'crash': {
          this._noiseHit(B, t, { dur: 0.55, a: 0.004, g: 0.45 * gm, filt: { type: 'lowpass', f: 2800, f2: 260, q: 0.8 } });
          this._noiseHit(B, t + 0.12, { dur: 0.18, a: 0.004, g: 0.28 * gm, filt: { type: 'bandpass', f: 620, q: 1.1 } });
          this._noiseHit(B, t + 0.26, { dur: 0.14, a: 0.004, g: 0.18 * gm, filt: { type: 'bandpass', f: 430, q: 1.1 } });
          this._tone(B, t, { type: 'sawtooth', f: 320 * dt, f2: 55 * dt, glideT: 0.45, dur: 0.5, a: 0.005, g: 0.2 * gm, filt: { type: 'lowpass', f: 900, q: 0.7 } });
          this._tone(B, t + 0.02, { type: 'sine', f: 70 * dt, f2: 35 * dt, glideT: 0.25, dur: 0.3, a: 0.004, g: 0.4 * gm });
          break;
        }
        case 'switch': {
          const arp = [587.33, 739.99, 880, 1174.66]; // D5 F#5 A5 D6
          for (let i = 0; i < 4; i++) this._bell(B, t + i * 0.055, arp[i] * dt, 0.28, 0.12 * gm);
          this._noiseHit(B, t, { dur: 0.26, a: 0.03, g: 0.12 * gm, filt: { type: 'bandpass', f: 500, f2: 2600, q: 1.4 } });
          break;
        }
        case 'ui': {
          this._tone(B, t, { type: 'sine', f: 720 * dt, dur: 0.05, a: 0.002, g: 0.12 * gm });
          this._noiseHit(B, t, { dur: 0.015, a: 0.001, g: 0.05 * gm, filt: { type: 'highpass', f: 4000, q: 0.7 } });
          break;
        }
        case 'countdown': {
          this._tone(B, t, { type: 'triangle', f: 660 * dt, dur: 0.14, a: 0.004, g: 0.2 * gm });
          this._tone(B, t, { type: 'sine', f: 1320 * dt, dur: 0.1, a: 0.004, g: 0.05 * gm });
          break;
        }
        case 'go': {
          this._tone(B, t, { type: 'triangle', f: 990 * dt, f2: 1010 * dt, glideT: 0.08, dur: 0.4, a: 0.004, g: 0.22 * gm });
          this._tone(B, t, { type: 'sine', f: 1485 * dt, dur: 0.3, a: 0.004, g: 0.08 * gm });
          break;
        }
        case 'mushroom': {
          const spring = Float32Array.from([260, 620, 430, 560, 400, 470, 420, 445, 430], (x) => x * dt);
          this._tone(B, t, { type: 'triangle', f: 260 * dt, curve: spring, curveT: 0.32, dur: 0.36, a: 0.005, g: 0.22 * gm });
          this._tone(B, t, { type: 'sine', f: 130 * dt, f2: 215 * dt, glideT: 0.1, dur: 0.3, a: 0.006, g: 0.08 * gm });
          break;
        }
        case 'splash': {
          this._noiseHit(B, t, { dur: 0.3, a: 0.004, g: 0.35 * gm, filt: { type: 'highpass', f: 400, f2: 4200, glideT: 0.16, q: 0.8 } });
          this._noiseHit(B, t, { dur: 0.18, a: 0.004, g: 0.2 * gm, filt: { type: 'lowpass', f: 900, q: 0.6 } });
          this._tone(B, t + 0.1, { type: 'sine', f: 900 * dt, f2: 1400 * dt, glideT: 0.06, dur: 0.07, a: 0.003, g: 0.05 * gm });
          break;
        }
        default:
          return; // unknown names ignored silently
      }
      this._sfxLast.set(name, now);
    } catch { /* sfx must never throw into gameplay */ }
  }

  // ------------------------------------------------------------- private --

  _rng() {
    this._seed = (Math.imul(this._seed, 1664525) + 1013904223) >>> 0;
    return this._seed / 4294967296;
  }

  _midi(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  _buildGraph() {
    const c = this.ctx;
    const t0 = c.currentTime + 0.05;

    this._master = c.createGain();
    this._master.gain.value = this._muted ? 0 : this._volume;
    this._comp = c.createDynamicsCompressor();
    this._comp.threshold.value = -14;
    this._comp.knee.value = 22;
    this._comp.ratio.value = 3.5;
    this._comp.attack.value = 0.004;
    this._comp.release.value = 0.25;
    this._comp.connect(this._master);
    this._master.connect(c.destination);

    const bus = (level) => {
      const g = c.createGain();
      g.gain.value = level;
      g.connect(this._comp);
      return g;
    };
    this._music = bus(this._levels.music);
    this._sfxBus = bus(this._levels.sfx);
    this._windBus = bus(this._levels.wind);
    this._vehBus = bus(this._levels.veh);

    // Tempo-synced echo for the lead: delay -> damp -> feedback, wet tap.
    this._delay = c.createDelay(1);
    this._delay.delayTime.value = this._eighth; // ~0.288s at 104 BPM
    this._delayDamp = c.createBiquadFilter();
    this._delayDamp.type = 'lowpass';
    this._delayDamp.frequency.value = 2400;
    this._delayDamp.Q.value = 0.5;
    this._delayFb = c.createGain();
    this._delayFb.gain.value = 0.25;
    this._delayWet = c.createGain();
    this._delayWet.gain.value = 0.18;
    this._delay.connect(this._delayDamp);
    this._delayDamp.connect(this._delayFb);
    this._delayFb.connect(this._delay);
    this._delayDamp.connect(this._delayWet);
    this._delayWet.connect(this._music);

    // ONE reusable 2s mono noise buffer for every noise voice.
    this._noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 2), c.sampleRate);
    const data = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = this._rng() * 2 - 1;

    // Wind: looped noise -> bandpass -> gain, with a slow gust LFO.
    const wsrc = c.createBufferSource();
    wsrc.buffer = this._noiseBuf;
    wsrc.loop = true;
    this._windFilter = c.createBiquadFilter();
    this._windFilter.type = 'bandpass';
    this._windFilter.frequency.value = 320;
    this._windFilter.Q.value = 0.55;
    this._windGain = c.createGain();
    this._windGain.gain.value = 0.03;
    wsrc.connect(this._windFilter);
    this._windFilter.connect(this._windGain);
    this._windGain.connect(this._windBus);
    wsrc.start(t0, 0);
    const gust = c.createOscillator();
    gust.type = 'sine';
    gust.frequency.value = 0.07;
    const gustAmt = c.createGain();
    gustAmt.gain.value = 0.016;
    const gustHz = c.createGain();
    gustHz.gain.value = 90;
    gust.connect(gustAmt); gustAmt.connect(this._windGain.gain);
    gust.connect(gustHz); gustHz.connect(this._windFilter.frequency);
    gust.start(t0);

    // Vehicle layers (crossfaded under the vehicle bus).
    const layer = () => {
      const g = c.createGain();
      g.gain.value = 0;
      g.connect(this._vehBus);
      return g;
    };
    this._layers = { bike: layer(), horse: layer(), board: layer() };

    // Bike: quiet tire-roll noise bed under the scheduled chain clicks.
    const rsrc = c.createBufferSource();
    rsrc.buffer = this._noiseBuf;
    rsrc.loop = true;
    const rlp = c.createBiquadFilter();
    rlp.type = 'lowpass';
    rlp.frequency.value = 850;
    rlp.Q.value = 0.6;
    this._bikeRollGain = c.createGain();
    this._bikeRollGain.gain.value = 0.04;
    rsrc.connect(rlp);
    rlp.connect(this._bikeRollGain);
    this._bikeRollGain.connect(this._layers.bike);
    rsrc.start(t0, 0.7);

    // Board: detuned saw pair + sub sine -> lowpass -> hum gain.
    this._boardOsc1 = c.createOscillator();
    this._boardOsc1.type = 'sawtooth';
    this._boardOsc1.frequency.value = 58;
    this._boardOsc1.detune.value = -7;
    this._boardOsc2 = c.createOscillator();
    this._boardOsc2.type = 'sawtooth';
    this._boardOsc2.frequency.value = 58;
    this._boardOsc2.detune.value = 9;
    this._boardSub = c.createOscillator();
    this._boardSub.type = 'sine';
    this._boardSub.frequency.value = 29;
    const subG = c.createGain();
    subG.gain.value = 0.4;
    this._boardFilter = c.createBiquadFilter();
    this._boardFilter.type = 'lowpass';
    this._boardFilter.frequency.value = 260;
    this._boardFilter.Q.value = 1.1;
    this._boardHumGain = c.createGain();
    this._boardHumGain.gain.value = 0.45;
    this._boardOsc1.connect(this._boardFilter);
    this._boardOsc2.connect(this._boardFilter);
    this._boardSub.connect(subG);
    subG.connect(this._boardFilter);
    this._boardFilter.connect(this._boardHumGain);
    this._boardHumGain.connect(this._layers.board);
    this._boardOsc1.start(t0);
    this._boardOsc2.start(t0);
    this._boardSub.start(t0);
  }

  _scheduleMusic(now) {
    // Resync if we fell more than 1s behind (tab hidden, huge frame gap).
    if (this._nextNoteTime < now - 1) this._nextNoteTime = now + 0.06;
    let n = 0;
    while (this._nextNoteTime < now + 0.35 && n < 8) {
      this._scheduleStep(this._step, this._nextNoteTime);
      this._step++;
      if (this._step >= 128) { this._step = 0; this._cycle++; }
      this._nextNoteTime += this._eighth;
      n++;
    }
  }

  _scheduleStep(step, t) {
    const bar = step >> 3;
    const inBar = step & 7;
    const chord = bar & 3;
    if (inBar === 0) this._padChord(t, this._chords[chord]);
    if (inBar === 0 || inBar === 4) this._bassNote(t, this._roots[chord], inBar === 0 ? 0.3 : 0.24);
    if ((inBar & 1) && !(bar === 15 && inBar >= 5)) {
      this._shaker(t, ((step >> 1) & 1) ? 0.5 : 0.8);
    }

    const odd = (this._cycle & 1) === 1;
    const vt = this._varTab[step];
    const note = this._melody[step];
    if (note) {
      if (odd && vt < 0.1) return; // occasional composed rest
      let m = note[0];
      let vel = note[2];
      if (odd) {
        if (vt > 0.92 && m <= 69) m += 12; // rare octave lift
        vel *= 0.85 + 0.3 * this._varTab[(step + 37) & 127];
      }
      this._lead(t, this._midi(m), note[1] * this._eighth, vel);
    } else if (!odd && vt > 0.94 && (step & 1) && step > 0 && this._melody[step - 1]) {
      const p = this._melody[step - 1]; // soft echo into a rest
      this._lead(t, this._midi(p[0]), this._eighth, p[2] * 0.4);
    }
  }

  _lead(t, f, lenSec, vel) {
    const c = this.ctx;
    const dur = Math.min(0.6 + lenSec * 0.4, 1.4);
    const end = t + dur + 0.05;
    const env = c.createGain();
    const peak = Math.max(0.0002, 0.17 * vel);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    env.connect(this._music);
    env.connect(this._delay);
    const o1 = c.createOscillator();
    o1.type = 'triangle';
    o1.frequency.value = f;
    o1.detune.value = -4;
    const o2 = c.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f;
    o2.detune.value = 4;
    o1.connect(env); o2.connect(env);
    o1.start(t); o2.start(t);
    o1.stop(end); o2.stop(end);
    o2.onended = () => {
      o2.onended = null;
      o1.disconnect(); o2.disconnect(); env.disconnect();
    };
    // Quiet octave-up partial for the piano-ish sparkle.
    this._tone(this._music, t, { type: 'sine', f: f * 2, dur: dur * 0.55, a: 0.006, g: peak * 0.12 });
  }

  _padChord(t, midis) {
    const c = this.ctx;
    const barSec = this._bar;
    const end = t + barSec + 1.25;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.Q.value = 0.4;
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.06, t + 0.6); // slow strings attack
    env.gain.setValueAtTime(0.06, t + barSec);
    env.gain.linearRampToValueAtTime(0.0001, end);   // 1.2s release
    lp.connect(env);
    env.connect(this._music);
    const dets = [-7, 5, -3];
    const oscs = [];
    for (let i = 0; i < midis.length; i++) {
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = this._midi(midis[i]);
      osc.detune.value = dets[i % 3];
      osc.connect(lp);
      osc.start(t);
      osc.stop(end + 0.05);
      oscs.push(osc);
    }
    oscs[oscs.length - 1].onended = () => {
      oscs[oscs.length - 1].onended = null;
      for (const os of oscs) os.disconnect();
      lp.disconnect(); env.disconnect();
    };
  }

  _bassNote(t, m, vel) {
    const f = this._midi(m);
    this._tone(this._music, t, { type: 'triangle', f, dur: 0.38, a: 0.009, g: vel, filt: { type: 'lowpass', f: 480, q: 0.6 } });
    this._tone(this._music, t, { type: 'sine', f, dur: 0.36, a: 0.009, g: vel * 0.7 });
  }

  _shaker(t, accent) {
    this._noiseHit(this._music, t, { dur: 0.05, a: 0.002, g: 0.04 * accent, filt: { type: 'highpass', f: 6800, q: 0.8 } });
  }

  _setLayer(name, target, now) {
    if (Math.abs(target - this._layerTgt[name]) < 0.001) return;
    this._layerTgt[name] = target;
    this._layers[name].gain.setTargetAtTime(target, now, 0.05); // ~0.15s fade
  }

  _updateParams(v, now) {
    this._windGain.gain.setTargetAtTime(0.035 + 0.6 * Math.pow(v, 1.35), now, 0.15);
    this._windFilter.frequency.setTargetAtTime(280 + 2200 * Math.pow(v, 1.2), now, 0.12);
    this._bikeRollGain.gain.setTargetAtTime(0.04 + 0.34 * v, now, 0.1);
    const f = 58 * (1 + 1.15 * v);
    this._boardOsc1.frequency.setTargetAtTime(f, now, 0.1);
    this._boardOsc2.frequency.setTargetAtTime(f, now, 0.1);
    this._boardSub.frequency.setTargetAtTime(f * 0.5, now, 0.1);
    this._boardFilter.frequency.setTargetAtTime(240 + 2000 * Math.pow(v, 1.3), now, 0.1);
    this._boardHumGain.gain.setTargetAtTime(0.4 + 0.45 * v, now, 0.1);
  }

  _scheduleChain(now, v) {
    if (this._nextChain === null || this._nextChain < now - 0.5) {
      this._nextChain = now + 0.02;
      this._chainIdx = 0;
    }
    const rate = 3.5 + 16 * v; // clicks per second, scales with speed
    let n = 0;
    while (this._nextChain < now + 0.3 && n < 8) {
      const i = this._chainIdx;
      const accent = (i & 3) === 0 ? 1 : (i & 1 ? 0.55 : 0.75);
      this._chainTick(this._nextChain, accent, v);
      const swing = (i & 1) ? 1.06 : 0.94;
      this._nextChain += swing / rate;
      this._chainIdx = (i + 1) & 15;
      n++;
    }
  }

  _chainTick(t, accent, v) {
    this._noiseHit(this._layers.bike, t, { dur: 0.02, a: 0.001, g: 0.09 * accent, filt: { type: 'bandpass', f: 3400, q: 2.5 } });
    this._tone(this._layers.bike, t, { type: 'square', f: 1500 + 500 * v, dur: 0.014, a: 0.001, g: 0.028 * accent, filt: { type: 'highpass', f: 900, q: 0.7 } });
  }

  _scheduleHooves(now, v) {
    if (this._nextHoof === null || this._nextHoof < now - 0.5) {
      this._nextHoof = now + 0.03;
      this._hoofIdx = 0;
    }
    const period = 1 / (0.9 + 1.6 * v); // stride rate scales with speed
    const offs = [0, 0.14, 0.28, 0.44];  // four-beat gallop within a stride
    const vels = [1, 0.68, 0.84, 0.6];
    let n = 0;
    while (this._nextHoof < now + 0.3 && n < 8) {
      const i = this._hoofIdx;
      this._hoof(this._nextHoof, vels[i], i);
      const next = (i + 1) & 3;
      const gap = next === 0 ? 1 - offs[3] : offs[next] - offs[i];
      this._nextHoof += gap * period;
      this._hoofIdx = next;
      n++;
    }
  }

  _hoof(t, vel, i) {
    const f = 82 + (i === 0 ? 0 : i === 2 ? 8 : -6);
    this._noiseHit(this._layers.horse, t, { dur: 0.055, a: 0.002, g: 0.16 * vel, filt: { type: 'lowpass', f: 520, q: 0.8 } });
    this._tone(this._layers.horse, t, { type: 'sine', f: f * 1.6, f2: f * 0.8, glideT: 0.07, dur: 0.1, a: 0.003, g: 0.3 * vel });
  }

  // Pitched one-shot voice: osc -> [filter] -> env -> bus, self-cleaning.
  _tone(bus, t, o) {
    const c = this.ctx;
    const osc = c.createOscillator();
    osc.type = o.type || 'sine';
    if (o.curve) {
      osc.frequency.setValueCurveAtTime(o.curve, t, o.curveT || o.dur);
    } else {
      osc.frequency.setValueAtTime(Math.max(20, o.f), t);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + (o.glideT || o.dur));
    }
    if (o.detune) osc.detune.setValueAtTime(o.detune, t);
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.g ?? 0.2), t + (o.a ?? 0.005));
    env.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    const nodes = [osc, env];
    let head = osc;
    if (o.filt) {
      const fl = c.createBiquadFilter();
      fl.type = o.filt.type || 'lowpass';
      fl.frequency.setValueAtTime(Math.max(20, o.filt.f), t);
      if (o.filt.f2) fl.frequency.exponentialRampToValueAtTime(Math.max(20, o.filt.f2), t + (o.filt.glideT || o.dur));
      fl.Q.value = o.filt.q ?? 0.8;
      head.connect(fl);
      head = fl;
      nodes.push(fl);
    }
    head.connect(env);
    env.connect(bus);
    osc.start(t);
    osc.stop(t + o.dur + 0.06);
    osc.onended = () => {
      osc.onended = null;
      for (const nd of nodes) nd.disconnect();
    };
  }

  // Noise one-shot voice: shared buffer -> [filter] -> env -> bus.
  _noiseHit(bus, t, o) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.g ?? 0.2), t + (o.a ?? 0.003));
    env.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    const nodes = [src, env];
    let head = src;
    if (o.filt) {
      const fl = c.createBiquadFilter();
      fl.type = o.filt.type || 'lowpass';
      fl.frequency.setValueAtTime(Math.max(20, o.filt.f), t);
      if (o.filt.f2) fl.frequency.exponentialRampToValueAtTime(Math.max(20, o.filt.f2), t + (o.filt.glideT || o.dur));
      fl.Q.value = o.filt.q ?? 0.8;
      head.connect(fl);
      head = fl;
      nodes.push(fl);
    }
    head.connect(env);
    env.connect(bus);
    src.start(t, this._rng() * 1.5);
    src.stop(t + o.dur + 0.05);
    src.onended = () => {
      src.onended = null;
      for (const nd of nodes) nd.disconnect();
    };
  }

  // Bell partial pair: sine fundamental + inharmonic 2.756x shimmer.
  _bell(bus, t, f, dur, g) {
    this._tone(bus, t, { type: 'sine', f, dur, a: 0.004, g });
    this._tone(bus, t, { type: 'sine', f: f * 2.756, dur: dur * 0.45, a: 0.003, g: g * 0.22 });
  }
}