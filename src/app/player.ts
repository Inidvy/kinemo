import type { Editor } from "./editor";
import type { Id, Timeline } from "../core/model";
import { jointKinds } from "../motion/joints";
import { clipTime, deleteKeys, keysFromRecording, setKey, timelineCopy, timelineOf, valueAt, type KeyRef } from "../motion/timeline";
import { clipTargets } from "../motion/clip";
import { t } from "../i18n";

export const round = (x: number) => Math.round(x * 1000) / 1000;

/** Seconds of count-in before a recording starts, remembered in this browser. */
const LEAD_IN_KEY = "kinemo.recordLeadIn";
function loadLeadIn(): number {
  try {
    const n = parseFloat(localStorage.getItem(LEAD_IN_KEY) ?? "");
    return Number.isFinite(n) && n >= 0 ? n : 3;
  } catch {
    return 3;
  }
}

/**
 * Plays the keyframe timeline: each frame the keyed sliders go to their
 * values at the playhead, and the sliders without keys stay free.
 */
export class Player {
  /** Playhead, seconds from the start of the clip. */
  time = 0;
  private frame = 0;
  private started = 0;
  private offset = 0;
  /** Slider values when the playhead last moved or a key was set: sliders moved since then get keys. */
  private base: Record<Id, number> = {};
  /** The selected keys on the timeline. */
  keySel: KeyRef[] = [];
  private lead = loadLeadIn();

  constructor(private ed: Editor) {}

  get playing(): boolean {
    return this.frame !== 0;
  }

  toggle(): void {
    if (this.playing) this.stop();
    else this.play();
  }

  play(): void {
    const ed = this.ed;
    if (this.playing || ed.mode !== "motion") return;
    const tl = timelineOf(ed.doc);
    if (!Object.values(tl.keys).some((k) => k.length)) {
      ed.flash(t("timeline.noKeys"));
      return;
    }
    // A clip that has played to its end starts over.
    if (tl.mode === "once" && this.time >= tl.length - 1e-6) this.time = 0;
    ed.beginDrag();
    // Ping-pong on its way back resumes going back; anything else goes forward from the playhead.
    this.offset = this.time;
    this.started = performance.now();
    this.frame = requestAnimationFrame((now) => this.tick(now));
    ed.emit();
  }

  /** Stop and go back to the start of the clip. */
  toStart(): void {
    if (this.playing) this.stop();
    this.seek(0);
    this.ed.emit();
  }

  stop(): void {
    if (!this.playing) return;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.snapshot();
    this.ed.endDrag();
    const done = this.onCycle;
    this.onCycle = undefined;
    this.cycle = 0;
    done?.();
  }

  /** While recording: how long one whole cycle runs, and what to do after it. */
  private cycle = 0;
  private onCycle?: () => void;

  /** Play one whole cycle from the start (there and back for ping-pong), then call `done`. */
  playCycle(done: () => void): boolean {
    const tl = timelineOf(this.ed.doc);
    if (this.playing) this.stop();
    this.time = 0;
    this.pose(0);
    this.play();
    if (!this.playing) return false;
    this.cycle = tl.mode === "pingpong" ? 2 * tl.length : tl.length;
    this.onCycle = done;
    return true;
  }

  private tick(now: number) {
    const ed = this.ed;
    if (ed.mode !== "motion") return this.stop();
    const tl = timelineOf(ed.doc);
    const elapsed = this.offset + (now - this.started) / 1000;
    if (this.cycle && elapsed >= this.cycle) {
      this.time = tl.mode === "pingpong" ? 0 : tl.length;
      this.pose(this.time);
      return this.stop();
    }
    const { t: time, done } = clipTime(elapsed, tl);
    this.time = time;
    this.pose(time);
    if (done) return this.stop();
    this.frame = requestAnimationFrame((n) => this.tick(n));
  }

  /** Put the keyed sliders where the timeline has them at a time. */
  pose(time: number): void {
    const ed = this.ed;
    const doc = ed.doc;
    const m = ed.mech;
    const targets = clipTargets(doc, m, time);
    if (!targets.length) return ed.emit();
    const r = m.driveAll(targets);
    ed.setPoses(m.poses(r.q));
  }

  /** Move the playhead (not while playing) and pose the mechanism there. */
  seek(time: number): void {
    const tl = timelineOf(this.ed.doc);
    this.time = Math.min(tl.length, Math.max(0, time));
    if (this.playing) {
      this.offset = this.time;
      this.started = performance.now();
      return;
    }
    this.pose(this.time);
    this.snapshot();
  }

  private values(): Record<Id, number> {
    const m = this.ed.mech;
    const q = m.current();
    const out: Record<Id, number> = {};
    for (const d of Object.values(this.ed.doc.motion.drivers)) if (m.joint(d.joint)) out[d.id] = m.measure(q, d.joint);
    return out;
  }

  snapshot(): void {
    this.base = this.values();
  }

  /** A free-hand movement being recorded: when it started and every slider's value each frame. */
  private take: { frame: number; t: number[]; v: Record<Id, number[]>; last: Record<Id, number> } | null = null;

  get recording(): boolean {
    return this.take !== null;
  }

  /** The count-in before recording: when it ends, and the timer ticking it down. */
  private count: { end: number; timer: number } | null = null;

  /** Whole seconds left on the count-in before recording starts (null when not counting in). */
  get countdown(): number | null {
    return this.count ? Math.max(1, Math.ceil((this.count.end - performance.now()) / 1000)) : null;
  }

  /** Seconds of count-in before recording, to get the mechanism where you want it to start. */
  get leadIn(): number {
    return this.lead;
  }

  set leadIn(n: number) {
    this.lead = Math.min(30, Math.max(0, n));
    try {
      localStorage.setItem(LEAD_IN_KEY, String(this.lead));
    } catch {
      // Not remembered, but still used for now.
    }
  }

  /** Stop the count-in without recording. */
  cancelCountdown(): void {
    if (!this.count) return;
    clearInterval(this.count.timer);
    this.count = null;
    this.ed.emit();
  }

  /**
   * Record what the sliders do while you drag the mechanism or move sliders,
   * after a count-in to get it where the movement should start.
   */
  startRecording(): void {
    const ed = this.ed;
    if (!Object.keys(ed.doc.motion.drivers).length) return ed.flash(t("timeline.noSliders"));
    if (this.playing) this.stop();
    if (this.count || this.take) return;
    if (this.lead <= 0) return this.beginTake();
    let shown = this.countdown;
    const end = performance.now() + this.lead * 1000;
    const timer = window.setInterval(() => {
      if (performance.now() >= end) {
        this.cancelCountdown();
        this.beginTake();
        return;
      }
      if (this.countdown !== shown) (shown = this.countdown), ed.emit();
    }, 50);
    this.count = { end, timer };
    ed.emit();
  }

  private beginTake(): void {
    const ed = this.ed;
    if (ed.mode !== "motion") return;
    this.take = { frame: 0, t: [], v: {}, last: {} };
    const sample = (now: number) => {
      const take = this.take;
      if (!take) return;
      const m = ed.mech;
      const q = m.current();
      take.t.push(now / 1000);
      for (const d of Object.values(ed.doc.motion.drivers)) {
        const j = m.joint(d.joint);
        if (!j) continue;
        const kind = jointKinds.get(j.kind);
        let v = m.measure(q, d.joint);
        const list = (take.v[d.id] ??= []);
        // Count on past a full turn, so a crank turned round and round records as turning.
        if (kind.wraps?.(j) && list.length) {
          const [lo, hi] = kind.range(ed.doc, j);
          const per = hi - lo, prev = list[list.length - 1];
          v = prev + ((((v - prev + per / 2) % per) + per) % per) - per / 2;
        }
        list.push(v);
      }
      this.time = take.t[take.t.length - 1] - take.t[0];
      ed.emit();
      take.frame = requestAnimationFrame(sample);
    };
    this.take.frame = requestAnimationFrame(sample);
    ed.emit();
  }

  /** Stop recording and turn the movement into smooth keys for the sliders that moved. */
  stopRecording(): void {
    if (this.count) return this.cancelCountdown();
    const take = this.take;
    if (!take) return;
    cancelAnimationFrame(take.frame);
    this.take = null;
    const ed = this.ed;
    const duration = take.t.length ? take.t[take.t.length - 1] - take.t[0] : 0;
    if (duration < 0.2) {
      ed.flash(t("record.tooShort"));
      return ed.emit();
    }
    const moved = Object.entries(take.v).filter(([id, vs]) => {
      const d = ed.doc.motion.drivers[id];
      const j = d && ed.mech.joint(d.joint);
      const tiny = j && jointKinds.get(j.kind).unit === "deg" ? 0.2 : ed.mech.size * 1e-3;
      return vs.length === take.t.length && Math.max(...vs) - Math.min(...vs) > tiny;
    });
    if (!moved.length) {
      ed.flash(t("record.nothingMoved"));
      return ed.emit();
    }
    ed.change((doc) => {
      const tl: Timeline = timelineCopy(doc);
      tl.length = Math.max(0.1, Math.ceil(duration * 10) / 10);
      for (const [id, vs] of moved) tl.keys[id] = keysFromRecording(take.t, vs);
      doc.motion.timeline = tl;
    });
    this.time = 0;
    this.pose(0);
    this.snapshot();
    ed.flash(t("record.done", { n: moved.length }));
  }

  /**
   * Set keys at the playhead for the sliders that already have keys, the
   * sliders moved since the playhead last moved, and a selected slider. With
   * none of those, every slider gets a key.
   */
  key(): void {
    const ed = this.ed;
    if (ed.mode !== "motion") return;
    const drivers = Object.values(ed.doc.motion.drivers);
    if (!drivers.length) {
      ed.flash(t("timeline.noSliders"));
      return;
    }
    if (this.playing) this.stop();
    const now = this.values();
    const tl0 = timelineOf(ed.doc);
    let pick = drivers.filter(
      (d) => tl0.keys[d.id]?.length || ed.selection.has(d.id) || ed.selection.has(d.joint) || (d.id in now && Math.abs(now[d.id] - (this.base[d.id] ?? now[d.id])) > 1e-6),
    );
    if (!pick.length) pick = drivers;
    const time = this.time;
    ed.change((doc) => {
      const tl: Timeline = timelineCopy(doc);
      for (const d of pick) {
        if (!(d.id in now)) continue;
        let v = now[d.id];
        // A crank keeps counting turns: take the reading nearest what the timeline has there.
        const j = ed.mech.joint(d.joint)!;
        const kind = jointKinds.get(j.kind);
        const prev = valueAt(tl.keys[d.id], time);
        if (prev !== null && kind.wraps?.(j)) {
          const [lo, hi] = kind.range(doc, j);
          const p = hi - lo;
          v = prev + ((((v - prev + p / 2) % p) + p) % p) - p / 2;
        }
        setKey(tl, d.id, round(time), v);
      }
      doc.motion.timeline = tl;
    });
    this.snapshot();
  }

  /** Delete the selected keys. False when none are selected. */
  deleteSelectedKeys(): boolean {
    const refs = this.keySel;
    if (!refs.length) return false;
    this.keySel = [];
    this.ed.change((doc) => {
      const tl: Timeline = timelineCopy(doc);
      deleteKeys(tl, refs);
      doc.motion.timeline = tl;
    });
    return true;
  }

  /** Delete every key of every slider. */
  deleteAllKeys(): void {
    const tl0 = timelineOf(this.ed.doc);
    if (!Object.values(tl0.keys).some((k) => k.length)) return;
    if (this.playing) this.stop();
    this.keySel = [];
    this.ed.change((doc) => (doc.motion.timeline = { ...structuredClone(tl0), keys: {} }));
    this.ed.flash(t("timeline.allDeleted"));
  }
}

let player: Player | null = null;

/** The timeline's player, for the play and key shortcuts; null until the timeline is set up. */
export function timelinePlayer(): Player | null {
  return player;
}

/** Make the editor's player. */
export function startPlayer(ed: Editor): Player {
  return (player = new Player(ed));
}
