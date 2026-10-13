import type { Editor } from "../app/editor";
import type { Id, Keyframe, Timeline } from "../core/model";
import { jointKinds } from "../motion/joints";
import { clipTime, DEFAULT_TIMELINE, keysFromRecording, setKey, timelineOf, valueAt, valuesAt } from "../motion/timeline";
import { t } from "../i18n";
import { icons } from "./icons";
import { driverName } from "./motionPanels";
import { chartSeries, drawSeries, fmtValue, valueOn, type Series } from "./chart";
import { download, exportGif, recordVideo } from "./exportMedia";

/** How the stretch after a key moves: eased in and out, at a steady speed, or on a smooth curve through the keys. */
const SEGS = ["eased", "steady", "smooth"] as const;
type Seg = (typeof SEGS)[number];
const segKind = (k: Keyframe): Seg => (k.smooth ? "smooth" : k.linear ? "steady" : "eased");
function setSeg(k: Keyframe, how: Seg) {
  delete k.linear;
  delete k.smooth;
  if (how === "steady") k.linear = true;
  if (how === "smooth") k.smooth = true;
}

/** Line colours for the chart, one per series. */
const PALETTE = ["#2069e0", "#d81b60", "#0b8a7a", "#f28c18", "#8e44ad", "#5f6b7a"];


const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

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
    const targets = valuesAt(timelineOf(doc), time).flatMap(({ driver, value }) => (doc.motion.drivers[driver] ? [{ joint: doc.motion.drivers[driver].joint, value }] : []));
    if (!targets.length) return ed.emit();
    const m = ed.mech;
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

  /** Start recording what the sliders do while you drag the mechanism or move sliders. */
  startRecording(): void {
    const ed = this.ed;
    if (!Object.keys(ed.doc.motion.drivers).length) return ed.flash(t("timeline.noSliders"));
    if (this.playing) this.stop();
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
      const tl: Timeline = structuredClone(doc.motion.timeline ?? DEFAULT_TIMELINE);
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
      const tl: Timeline = structuredClone(doc.motion.timeline ?? DEFAULT_TIMELINE);
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
}

export const round = (x: number) => Math.round(x * 1000) / 1000;

let player: Player | null = null;

/** The timeline's player, for the play and key shortcuts. */
export function timelinePlayer(): Player | null {
  return player;
}

/**
 * The keyframe timeline above the tabs (Motion mode): a row per slider with
 * its keys (◆), a playhead to scrub, and the clip's length and play mode.
 */
export function mountTimeline(el: HTMLElement, ed: Editor): Player {
  const p = (player = new Player(ed));
  /** The selected key: slider and index into its keys. */
  let sel: { driver: Id; i: number } | null = null;
  let lastOpen = false;
  /** A video being recorded, and how far a GIF has got (null when none is being made). */
  let video: MediaRecorder | null = null;
  let gifProgress: number | null = null;
  /** The clip settings pop-up is open. */
  let menuOpen = false;
  let lastFlags = "";

  const lanes = () => el.querySelector<HTMLElement>(".tl-lanes");
  const timeAt = (clientX: number) => {
    const r = lanes()?.getBoundingClientRect();
    if (!r || !r.width) return 0;
    return (Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * timelineOf(ed.doc).length);
  };
  const snap = (time: number) => {
    // Snap to tenths of a second, finer when the clip is short.
    const step = timelineOf(ed.doc).length > 10 ? 0.5 : 0.05;
    return round(Math.round(time / step) * step);
  };

  const update = () => {
    const open = ed.mode === "motion" && ed.animation;
    if (open !== lastOpen) {
      lastOpen = open;
      p.stop();
      if (open) p.snapshot();
    }
    el.hidden = !open;
    if (el.hidden) return;
    const doc = ed.doc;
    const tl = timelineOf(doc);
    if (sel && !tl.keys[sel.driver]?.[sel.i]) sel = null;
    // While playing or recording only the playhead moves: rebuilding every
    // frame would pull the Pause or Stop button out from under the pointer.
    const flags = `${p.playing}|${p.recording}|${!!video}|${gifProgress === null ? "" : Math.round(gifProgress * 100)}`;
    const running = p.playing || p.recording;
    if (running && flags === lastFlags) {
      patch();
      return;
    }
    lastFlags = flags;
    const active = document.activeElement;
    if (active && el.contains(active) && active.matches("input, select")) {
      // Don't disturb typing: only move the playhead.
      patch();
      return;
    }
    const drivers = Object.values(doc.motion.drivers);
    const pct = (time: number) => `${(Math.min(tl.length, Math.max(0, time)) / tl.length) * 100}%`;
    const ticks: string[] = [];
    const step = tl.length <= 2 ? 0.25 : tl.length <= 6 ? 0.5 : tl.length <= 20 ? 1 : 5;
    for (let s = 0; s <= tl.length + 1e-9; s += step) {
      const whole = Math.abs(s - Math.round(s)) < 1e-9;
      ticks.push(`<span class="tl-tick${whole ? " major" : ""}" style="left:${pct(s)}">${whole ? `${Math.round(s)}s` : ""}</span>`);
    }
    const rows = drivers
      .map((d) => {
        const keys = tl.keys[d.id] ?? [];
        const diamonds = keys
          .map((k, i) => {
            const on = sel?.driver === d.id && sel.i === i;
            const how = segKind(k);
            const seg = i < keys.length - 1 ? `<span class="tl-seg ${how}" data-seg="${i}" data-driver="${d.id}" style="left:${pct(k.t)};width:calc(${pct(keys[i + 1].t)} - ${pct(k.t)})" title="${t(`timeline.seg.${how}`)}"></span>` : "";
            return `${seg}<span class="tl-key${on ? " on" : ""}" data-key="${i}" data-driver="${d.id}" style="left:${pct(k.t)}" title="${k.t.toFixed(2)} s · ${fmt(ed, d.id, k.v)}"></span>`;
          })
          .join("");
        const label = `<div class="tl-name${ed.selection.has(d.id) || ed.selection.has(d.joint) ? " sel" : ""}" data-pick="${d.joint}" title="${esc(driverName(ed, d))}">${esc(driverName(ed, d))}</div>`;
        return `${label}<div class="tl-lane" data-driver="${d.id}">${diamonds}</div>`;
      })
      .join("");
    const series = chartSeries(ed);
    const chart = series?.length
      ? `<div class="tl-name tl-section">${t("chart.title")}</div><div class="tl-section"></div>` +
        series
          .map(
            (s, i) =>
              `<div class="tl-name tl-chart-name" data-pick="${doc.motion.drivers[s.id]?.joint ?? s.id}" title="${esc(s.label)}"><span class="tl-dot" style="background:${PALETTE[i % PALETTE.length]}"></span>${esc(s.label)}<b data-series="${i}">${fmtValue(s, valueOn(s, p.time))}</b></div><div class="tl-lane tl-chart"><canvas data-chart="${i}"></canvas></div>`,
          )
          .join("")
      : "";
    const k = sel && tl.keys[sel.driver][sel.i];
    const editor = k
      ? `<span class="tl-keyedit">
          <span class="tl-keyname">◆ ${esc(driverName(ed, doc.motion.drivers[sel!.driver]))}</span>
          <label>${t("timeline.at")}<input type="number" step="0.05" min="0" data-tl="kt" value="${k.t}"> s</label>
          <label>${t("timeline.value")}<input type="number" step="any" data-tl="kv" value="${round(k.v)}"></label>
          <select data-tl="kseg" title="${t("timeline.segTip")}">${SEGS.map((x) => `<option value="${x}"${segKind(k) === x ? " selected" : ""}>${t(`timeline.segShort.${x}`)}</option>`).join("")}</select>
          <button class="icon-btn" data-tl="kdel" title="${t("panel.delete")}">${icons.delete}</button>
        </span>`
      : "";
    const anyKeys = Object.values(tl.keys).some((x) => x.length);
    const busy = p.recording || !!video || gifProgress !== null;
    el.innerHTML = `
      <div class="tl-head">
        <span class="tl-group">
          <button class="icon-btn tl-play" data-tl="play" ${busy ? "disabled" : ""} title="${t(p.playing ? "timeline.pause" : "timeline.play")} (Space)">${p.playing ? icons.pause : icons.play}</button>
          <span class="tl-time">${p.time.toFixed(2)}<span class="muted"> / ${tl.length} s</span></span>
        </span>
        <span class="tl-group">
          <button class="btn tl-keybtn" data-tl="key" ${busy ? "disabled" : ""} title="${t("timeline.keyTip")}">${icons.key}${t("timeline.key")}</button>
          <button class="btn tl-rec${p.recording ? " on" : ""}" data-tl="rec" ${video || gifProgress !== null ? "disabled" : ""} title="${t("record.tip")}"><span class="tl-recdot"></span>${t(p.recording ? "record.stop" : "record.start")}</button>
        </span>
        ${editor}
        <span class="tl-spacer"></span>
        <details class="tl-menu"${menuOpen ? " open" : ""}>
          <summary class="btn">${icons.clock}${t("timeline.clip")}</summary>
          <div class="tl-pop">
            <label>${t("timeline.length")}<input type="number" min="0.1" step="0.5" data-tl="length" value="${tl.length}"> s</label>
            <label>${t("timeline.playMode")}<select data-tl="mode">
              ${(["once", "loop", "pingpong"] as const).map((m) => `<option value="${m}"${tl.mode === m ? " selected" : ""}>${t(`timeline.${m}`)}</option>`).join("")}
            </select></label>
          </div>
        </details>
        <span class="tl-group tl-export">
          <span class="muted">${t("export.title")}</span>
          <button class="btn" data-tl="gif" ${anyKeys && !busy ? "" : "disabled"} title="${t("export.gifTip")}">${gifProgress !== null ? `${Math.round(gifProgress * 100)}%` : "GIF"}</button>
          <button class="btn" data-tl="video" ${anyKeys && (!busy || video) ? "" : "disabled"} title="${t("export.videoTip")}">${video ? t("export.recording") : t("export.video")}</button>
          <button class="btn" data-tl="csv" ${anyKeys && !busy ? "" : "disabled"} title="${t("export.csvTip")}">CSV</button>
        </span>
      </div>
      ${anyKeys || p.recording ? "" : `<div class="tl-empty muted">${t(drivers.length ? "timeline.hint" : "timeline.noSliders")}</div>`}
      <div class="tl-body">
        <div class="tl-name tl-corner"></div>
        <div class="tl-lanes tl-ruler">${ticks.join("")}</div>
        ${rows}
        ${chart}
        <div class="tl-playhead-wrap"><div class="tl-playhead" style="left:${pct(p.time)}"></div></div>
      </div>`;
    shown = series ?? [];
    for (const c of el.querySelectorAll<HTMLCanvasElement>("canvas[data-chart]")) {
      const i = Number(c.dataset.chart);
      drawSeries(c, shown[i], tl.length, PALETTE[i % PALETTE.length]);
    }
  };
  let shown: Series[] = [];

  /** Just the playhead and time readout. */
  const patch = () => {
    const tl = timelineOf(ed.doc);
    const head = el.querySelector<HTMLElement>(".tl-playhead");
    if (head) head.style.left = `${(Math.min(tl.length, p.time) / tl.length) * 100}%`;
    const time = el.querySelector<HTMLElement>(".tl-time");
    if (time) time.firstChild!.textContent = p.time.toFixed(2);
    for (const b of el.querySelectorAll<HTMLElement>("[data-series]")) {
      const s = shown[Number(b.dataset.series)];
      if (s) b.textContent = fmtValue(s, valueOn(s, p.time));
    }
  };

  /** The chart's numbers as a spreadsheet file. */
  const exportCsv = () => {
    const series = chartSeries(ed);
    if (!series?.length) return ed.flash(t("timeline.noKeys"));
    const head = ["time (s)", ...series.map((s) => `${s.label} (${s.unit === "deg" ? "deg" : "mm"})`)];
    const rows = series[0].times.map((time, i) => [time.toFixed(4), ...series.map((s) => (s.values[i] ?? NaN).toFixed(4))]);
    const csv = [head, ...rows].map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
    download(new Blob([csv], { type: "text/csv" }), "mechanism.csv");
  };

  const editTimeline = (fn: (tl: Timeline) => void) =>
    ed.change((doc) => {
      const tl: Timeline = structuredClone(doc.motion.timeline ?? DEFAULT_TIMELINE);
      fn(tl);
      doc.motion.timeline = tl;
    });

  el.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const b = target.closest<HTMLElement>("[data-tl]");
    if (b?.tagName === "BUTTON") {
      const what = b.dataset.tl;
      b.blur();
      if (what === "play") p.toggle();
      if (what === "key") p.key();
      if (what === "video") {
        if (video) p.stop();
        else video = recordVideo(ed, p, () => ((video = null), ed.emit()));
      }
      if (what === "gif") {
        gifProgress = 0;
        exportGif(ed, p, (f) => {
          gifProgress = f >= 1 ? null : f;
          ed.emit();
        }).catch((err: Error) => ed.flash(err.message));
      }
      if (what === "rec") {
        if (p.recording) p.stopRecording();
        else p.startRecording();
      }
      if (what === "csv") exportCsv();
      if (what === "kdel" && sel) {
        const s = sel;
        sel = null;
        editTimeline((tl) => {
          tl.keys[s.driver].splice(s.i, 1);
          if (!tl.keys[s.driver].length) delete tl.keys[s.driver];
        });
      }
      ed.emit();
      return;
    }
    const name = target.closest<HTMLElement>("[data-pick]");
    if (name) ed.select([name.dataset.pick!]);
  });

  el.addEventListener("toggle", (e) => {
    if ((e.target as HTMLElement).matches(".tl-menu")) menuOpen = (e.target as HTMLDetailsElement).open;
  }, true);

  el.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const what = input.dataset.tl;
    const n = parseFloat(input.value);
    if (what === "length" && n > 0) editTimeline((tl) => (tl.length = n));
    if (what === "mode") editTimeline((tl) => (tl.mode = input.value as Timeline["mode"]));
    if (!sel) return;
    const s = sel;
    if (what === "kv" && Number.isFinite(n)) editTimeline((tl) => (tl.keys[s.driver][s.i].v = n));
    if (what === "kseg") editTimeline((tl) => setSeg(tl.keys[s.driver][s.i], input.value as Seg));
    if (what === "kt" && Number.isFinite(n)) {
      editTimeline((tl) => {
        const keys = tl.keys[s.driver];
        const k = keys[s.i];
        k.t = Math.max(0, n);
        keys.sort((a, b) => a.t - b.t);
        sel = { driver: s.driver, i: keys.indexOf(k) };
      });
    }
    input.blur();
  });

  // Right-click a key or the stretch after it: switch that stretch between eased and steady.
  el.addEventListener("contextmenu", (e) => {
    const h = (e.target as HTMLElement).closest<HTMLElement>("[data-key],[data-seg]");
    if (!h) return;
    e.preventDefault();
    const driver = h.dataset.driver!;
    const i = Number(h.dataset.key ?? h.dataset.seg);
    editTimeline((tl) => {
      const k = tl.keys[driver]?.[i];
      if (k) setSeg(k, SEGS[(SEGS.indexOf(segKind(k)) + 1) % SEGS.length]);
    });
  });

  el.addEventListener("dblclick", (e) => {
    const h = (e.target as HTMLElement).closest<HTMLElement>("[data-key]");
    if (!h) return;
    const driver = h.dataset.driver!;
    const i = Number(h.dataset.key);
    sel = null;
    editTimeline((tl) => {
      tl.keys[driver]?.splice(i, 1);
      if (tl.keys[driver] && !tl.keys[driver].length) delete tl.keys[driver];
    });
  });

  // Drag a key to retime it; press anywhere else on the lanes to scrub.
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const key = target.closest<HTMLElement>("[data-key]");
    const onLanes = target.closest(".tl-lane, .tl-ruler, .tl-seg");
    if (!key && !onLanes) return;
    e.preventDefault();
    if (key) {
      const driver = key.dataset.driver!;
      sel = { driver, i: Number(key.dataset.key) };
      const t0 = timelineOf(ed.doc).keys[driver][sel.i].t;
      const x0 = e.clientX;
      let moved = false;
      const move = (ev: PointerEvent) => {
        if (!moved && Math.abs(ev.clientX - x0) < 3) return;
        if (!moved) ed.beginDrag();
        moved = true;
        const time = snap(timeAt(ev.clientX));
        ed.live((doc) => {
          const tl: Timeline = structuredClone(doc.motion.timeline ?? DEFAULT_TIMELINE);
          const keys = tl.keys[driver];
          const k = keys[sel!.i];
          k.t = time;
          keys.sort((a, b) => a.t - b.t);
          sel = { driver, i: keys.indexOf(k) };
          doc.motion.timeline = tl;
        });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (moved) {
          // Two keys at one time: the moved one wins.
          ed.live((doc) => {
            const keys = doc.motion.timeline?.keys[driver];
            if (!keys) return;
            const k = keys[sel!.i];
            doc.motion.timeline!.keys[driver] = keys.filter((x) => x === k || Math.abs(x.t - k.t) > 1e-6);
            sel = { driver, i: doc.motion.timeline!.keys[driver].indexOf(k) };
          });
          ed.endDrag();
        } else {
          p.seek(t0);
          ed.emit();
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      ed.emit();
      return;
    }
    sel = null;
    const wasPlaying = p.playing;
    if (wasPlaying) p.stop();
    ed.beginDrag();
    p.seek(snap(timeAt(e.clientX)));
    const move = (ev: PointerEvent) => p.seek(snap(timeAt(ev.clientX)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      ed.endDrag();
      p.snapshot();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });

  ed.subscribe(update);
  update();
  return p;
}

function fmt(ed: Editor, driver: Id, v: number): string {
  const d = ed.doc.motion.drivers[driver];
  const j = d && ed.mech.joint(d.joint);
  const deg = j && jointKinds.get(j.kind).unit === "deg";
  return `${v.toFixed(deg ? 1 : 2)} ${deg ? "°" : "mm"}`;
}
