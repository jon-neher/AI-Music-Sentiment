import * as Tone from "tone";
import type { AggregateOut, Category, PostOut } from "../data/api";

const MODES: Record<string, number[]> = {
  locrian:    [0, 1, 3, 5, 6, 8, 10],
  phrygian:   [0, 1, 3, 5, 7, 8, 10],
  aeolian:    [0, 2, 3, 5, 7, 8, 10],
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  ionian:     [0, 2, 4, 5, 7, 9, 11],
  lydian:     [0, 2, 4, 6, 7, 9, 11],
};
const MODE_ORDER = ["locrian","phrygian","aeolian","dorian","mixolydian","ionian","lydian"];

const ROOT = 48; // C3

function noteFromScale(scale: number[], degree: number): string {
  const oct = Math.floor(degree / scale.length);
  const step = scale[((degree % scale.length) + scale.length) % scale.length];
  const midi = ROOT + step + 12 * oct;
  return Tone.Frequency(midi, "midi").toNote();
}

export interface BusMix {
  public: number;
  business: number;
  science: number;
  master: number;
}

export class AudioEngine {
  private started = false;
  private reverb!: Tone.Reverb;
  private limiter!: Tone.Limiter;
  private masterGain!: Tone.Gain;

  private pads!: Tone.PolySynth;
  private bells!: Tone.FMSynth;
  private drone!: Tone.Oscillator;
  private droneGain!: Tone.Gain;
  private sub!: Tone.MembraneSynth;
  private marimba!: Tone.MetalSynth;
  private busGains: Record<Category, Tone.Gain> = {} as any;

  private loopId: number | null = null;
  private currentScale = MODES.dorian;
  private density = 0.4;

  async start(): Promise<void> {
    if (this.started) return;
    await Tone.start();

    this.masterGain = new Tone.Gain(0.8);
    this.limiter = new Tone.Limiter(-2);
    this.reverb = new Tone.Reverb({ decay: 8, wet: 0.5 });

    this.masterGain.connect(this.reverb);
    this.reverb.connect(this.limiter);
    this.limiter.toDestination();

    for (const cat of ["public", "business", "science"] as Category[]) {
      const g = new Tone.Gain(0.7);
      g.connect(this.masterGain);
      this.busGains[cat] = g;
    }

    this.pads = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 2.5, decay: 1.5, sustain: 0.7, release: 4 },
    }).connect(this.busGains.public);
    this.pads.volume.value = -10;

    this.bells = new Tone.FMSynth({
      harmonicity: 3.1,
      modulationIndex: 10,
      envelope: { attack: 0.01, decay: 1.2, sustain: 0.0, release: 2 },
    }).connect(this.busGains.public);
    this.bells.volume.value = -14;

    this.drone = new Tone.Oscillator({ type: "sawtooth", frequency: 55 });
    this.droneGain = new Tone.Gain(0.0).connect(this.busGains.business);
    this.drone.connect(this.droneGain);
    this.drone.start();

    this.sub = new Tone.MembraneSynth({ pitchDecay: 0.2, octaves: 4 }).connect(this.busGains.business);
    this.sub.volume.value = -12;

    this.marimba = new Tone.MetalSynth({
      envelope: { attack: 0.002, decay: 1.4, release: 0.2 },
      harmonicity: 3.5,
      modulationIndex: 16,
      resonance: 2000,
      octaves: 0.5,
    }).connect(this.busGains.science);
    this.marimba.volume.value = -24;

    this.started = true;
  }

  stop(): void {
    if (this.loopId !== null) {
      clearInterval(this.loopId);
      this.loopId = null;
    }
    Tone.Transport.stop();
  }

  setMix(mix: Partial<BusMix>): void {
    if (!this.started) return;
    if (mix.public !== undefined) this.busGains.public.gain.rampTo(mix.public, 0.3);
    if (mix.business !== undefined) this.busGains.business.gain.rampTo(mix.business, 0.3);
    if (mix.science !== undefined) this.busGains.science.gain.rampTo(mix.science, 0.3);
    if (mix.master !== undefined) this.masterGain.gain.rampTo(mix.master, 0.3);
  }

  /** Update musical parameters from a window of aggregates + exemplars. */
  updateFromWindow(aggregates: AggregateOut[], exemplars: PostOut[]): void {
    if (!this.started || aggregates.length === 0) return;

    const meanSent = aggregates.reduce((a, b) => a + b.mean_sentiment * b.volume, 0) /
      Math.max(1, aggregates.reduce((a, b) => a + b.volume, 0));
    const idx = Math.round(((meanSent + 1) / 2) * (MODE_ORDER.length - 1));
    this.currentScale = MODES[MODE_ORDER[Math.max(0, Math.min(MODE_ORDER.length - 1, idx))]];

    const totalVol = aggregates.reduce((a, b) => a + b.volume, 0);
    this.density = Math.min(1.5, 0.2 + Math.log1p(totalVol) * 0.08);

    const emoAgg: Record<string, number> = {};
    for (const a of aggregates) {
      for (const [k, v] of Object.entries(a.emotions || {})) {
        emoAgg[k] = (emoAgg[k] || 0) + v * a.volume;
      }
    }
    const norm = Math.max(1, totalVol);
    const anger = (emoAgg.anger || 0) / norm;
    const fear = (emoAgg.fear || 0) / norm;

    this.reverb.wet.rampTo(0.35 + fear * 0.4, 1.0);
    this.droneGain.gain.rampTo(0.05 + anger * 0.25, 1.0);

    this.schedulePerSource(aggregates);
    this.scheduleOutliers(exemplars);
  }

  private schedulePerSource(aggregates: AggregateOut[]): void {
    if (this.loopId !== null) clearInterval(this.loopId);
    const tick = () => {
      const volByCat: Record<string, number> = { public: 0, business: 0, science: 0 };
      for (const a of aggregates) volByCat[a.category] += a.volume;
      const maxV = Math.max(1, ...Object.values(volByCat));

      if (Math.random() < (volByCat.public / maxV) * this.density) {
        const n = noteFromScale(this.currentScale, Math.floor(Math.random() * 7));
        this.pads.triggerAttackRelease(n, "4n");
      }
      if (Math.random() < (volByCat.public / maxV) * this.density * 0.4) {
        const n = noteFromScale(this.currentScale, 7 + Math.floor(Math.random() * 7));
        this.bells.triggerAttackRelease(n, "8n");
      }
      if (Math.random() < (volByCat.business / maxV) * this.density * 0.3) {
        this.sub.triggerAttackRelease("C2", "8n");
      }
      if (Math.random() < (volByCat.science / maxV) * this.density * 0.5) {
        const freq = Tone.Frequency(noteFromScale(this.currentScale, 10 + Math.floor(Math.random() * 5))).toFrequency();
        this.marimba.triggerAttackRelease(freq, "16n");
      }
    };
    this.loopId = window.setInterval(tick, 650);
  }

  private scheduleOutliers(exemplars: PostOut[]): void {
    const sorted = [...exemplars].sort((a, b) => Math.abs(b.sentiment) - Math.abs(a.sentiment)).slice(0, 8);
    sorted.forEach((p, i) => {
      setTimeout(() => {
        const degree = p.sentiment > 0 ? 7 + Math.floor(Math.random() * 5) : Math.floor(Math.random() * 5);
        const note = noteFromScale(this.currentScale, degree);
        this.bells.triggerAttackRelease(note, "2n");
        window.dispatchEvent(new CustomEvent("outlier-bell", { detail: p }));
      }, 1200 + i * 1400);
    });
  }
}
