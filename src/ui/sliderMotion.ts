import type { Editor } from "../app/editor";
import type { Id } from "../core/model";
import { jointKinds } from "../motion/joints";

/**
 * Moves sliders smoothly. A slider dragged in the panel eases towards its
 * new value a little each frame instead of jumping; a held button or key
 * keeps the slider running at a steady speed until it is let go. One whole
 * movement is one undo step.
 */
export class SliderMotion {
  private targets = new Map<Id, number>();
  private holds = new Map<Id, number>();
  /** For targets that count turns: where the slider is, counting turns, and its last reading. */
  private turns = new Map<Id, { raw: number; last: number }>();
  private frame = 0;
  private last = 0;

  constructor(private ed: Editor) {}

  /**
   * Ease a slider towards a value. With `turns`, the value counts on past a
   * full turn (370° is one turn and 10° more) instead of taking the short way.
   */
  setTarget(driver: Id, value: number, turns = false): void {
    this.targets.set(driver, value);
    if (!turns) this.turns.delete(driver);
    else if (!this.turns.has(driver)) {
      const d = this.ed.doc.motion.drivers[driver];
      const m = d ? this.ed.mech.measure(this.ed.mech.current(), d.joint) : 0;
      this.turns.set(driver, { raw: m, last: m });
    }
    this.start();
  }

  /** Keep a slider moving down (-1) or up (+1) until released. */
  hold(driver: Id, dir: number): void {
    this.targets.delete(driver);
    this.turns.delete(driver);
    this.holds.set(driver, dir);
    this.start();
  }

  release(driver?: Id): void {
    if (driver) this.holds.delete(driver);
    else this.holds.clear();
  }

  /** Start counting turns afresh for a slider. */
  resetTurns(driver: Id): void {
    this.turns.delete(driver);
  }

  get active(): boolean {
    return this.frame !== 0;
  }

  private start() {
    if (this.frame) return;
    if (!this.ed.dragging) this.ed.beginDrag();
    this.last = performance.now();
    this.frame = requestAnimationFrame((t) => this.tick(t));
  }

  private unit(driver: Id): { deg: boolean; size: number; period: number } | null {
    const d = this.ed.doc.motion.drivers[driver];
    const j = d && this.ed.mech.joint(d.joint);
    if (!j) return null;
    const kind = jointKinds.get(j.kind);
    const [lo, hi] = kind.range(this.ed.doc, j);
    return { deg: kind.unit === "deg", size: this.ed.mech.size, period: kind.wraps?.(j) ? hi - lo : 0 };
  }

  private tick(now: number) {
    const ed = this.ed;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    for (const [id, dir] of this.holds) {
      const u = this.unit(id);
      if (!u) {
        this.holds.delete(id);
        continue;
      }
      // About a quarter turn, or half the mechanism's size, per second.
      const speed = u.deg ? 90 : u.size * 0.5;
      const d = ed.doc.motion.drivers[id];
      ed.driveSlider(id, ed.mech.measure(ed.mech.current(), d.joint) + dir * speed * dt);
    }
    for (const [id, target] of this.targets) {
      const u = this.unit(id);
      const d = ed.doc.motion.drivers[id];
      if (!u || !d) {
        this.targets.delete(id);
        continue;
      }
      const cur = ed.mech.measure(ed.mech.current(), d.joint);
      const wrap = (x: number) => (u.period ? ((((x + u.period / 2) % u.period) + u.period) % u.period) - u.period / 2 : x);
      const tr = this.turns.get(id);
      let delta: number;
      if (tr) {
        // Count whole turns, so a fast drag never turns back the short way.
        tr.raw += wrap(cur - tr.last);
        tr.last = cur;
        delta = target - tr.raw;
      } else delta = wrap(target - cur);
      const maxStep = (u.deg ? 360 : u.size * 2) * dt;
      const step = Math.max(-maxStep, Math.min(maxStep, delta * Math.min(1, dt * 14)));
      if (Math.abs(delta) < (u.deg ? 0.01 : u.size * 1e-5)) {
        this.targets.delete(id);
        continue;
      }
      ed.driveSlider(id, cur + (Math.abs(delta) < (u.deg ? 0.2 : u.size * 1e-3) ? delta : step));
      // At a limit the slider can't get closer: stop trying.
      const now2 = ed.mech.measure(ed.mech.current(), d.joint);
      if (Math.abs(now2 - cur) < 1e-9) this.targets.delete(id);
    }
    if (!this.holds.size && !this.targets.size) {
      this.frame = 0;
      ed.endDrag();
      return;
    }
    this.frame = requestAnimationFrame((t) => this.tick(t));
  }
}
