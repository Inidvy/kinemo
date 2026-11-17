import type { Editor } from "../app/editor";
import { esc } from "./html";
import { download, fileStem } from "../io/file";
import type { Id, Keyframe, Timeline } from "../core/model";
import { jointKinds } from "../motion/joints";
import { round, startPlayer, type Player } from "../app/player";
import { shiftKeys, spinDirection, spinKeys, setTurnWay, timelineCopy, timelineOf, turnWay, type KeyRef, type TurnWay } from "../motion/timeline";
import { turnOf } from "../motion/clip";
import { t } from "../i18n";
import { icons } from "../render/icons";
import { driverName } from "./motionPanels";
import { chartSeries, drawSeries, fmtValue, valueOn, type Series } from "./chart";
import { EXPORT_SCALES, exportGif, exportScale, recordVideo, setExportScale } from "./exportMedia";

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




/**
 * The keyframe timeline above the tabs (Motion mode): a row per slider with
 * its keys (◆), a playhead to scrub, and the clip's length and play mode.
 */
export function mountTimeline(el: HTMLElement, ed: Editor): Player {
  const p = startPlayer(ed);
  const isSel = (driver: Id, i: number) => p.keySel.some((r) => r.driver === driver && r.i === i);
  let lastOpen = false;
  /** A video being recorded, and how far a GIF has got (null when none is being made). */
  let video: MediaRecorder | null = null;
  let gifProgress: number | null = null;
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
    p.keySel = p.keySel.filter((r) => tl.keys[r.driver]?.[r.i]);
    // While playing or recording only the playhead moves: rebuilding every
    // frame would pull the Pause or Stop button out from under the pointer.
    const flags = `${p.playing}|${p.recording}|${p.countdown}|${!!video}|${gifProgress === null ? "" : Math.round(gifProgress * 100)}`;
    const running = p.playing || p.recording || p.countdown !== null;
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
            const on = isSel(d.id, i);
            const how = segKind(k);
            const seg = i < keys.length - 1 ? `<span class="tl-seg ${how}" data-seg="${i}" data-driver="${d.id}" style="left:${pct(k.t)};width:calc(${pct(keys[i + 1].t)} - ${pct(k.t)})" title="${t(`timeline.seg.${how}`)}"></span>` : "";
            return `${seg}<span class="tl-key${on ? " on" : ""}" data-key="${i}" data-driver="${d.id}" style="left:${pct(k.t)}" title="${k.t.toFixed(2)} s · ${fmt(ed, d.id, k.v)}"></span>`;
          })
          .join("");
        const span = spinSpan(d.joint);
        const dir = span ? spinDirection(keys, span) : 0;
        // A joint that goes round gets a button that keys one full turn over the clip.
        const spin = span
          ? `<button class="tl-spin${dir ? " on" : ""}" data-tl="spin" data-driver="${d.id}" title="${t(dir > 0 ? "timeline.spinBack" : "timeline.spinTip")}">${dir < 0 ? "↺" : "↻"}</button>`
          : "";
        const label = `<div class="tl-name${ed.selection.has(d.id) || ed.selection.has(d.joint) ? " sel" : ""}" data-pick="${d.joint}" title="${esc(driverName(ed, d))}">${spin}${esc(driverName(ed, d))}</div>`;
        // A looping clip goes back to the first key at the end: shown as a hollow key there.
        const last = keys[keys.length - 1];
        const ghost =
          tl.mode === "loop" && last && last.t < tl.length - 1e-6
            ? `<span class="tl-seg ${segKind(last)}" style="left:${pct(last.t)};width:calc(100% - ${pct(last.t)})"></span><span class="tl-key ghost" style="left:100%" title="${t("timeline.loopKey")}"></span>`
            : "";
        return `${label}<div class="tl-lane" data-driver="${d.id}">${diamonds}${ghost}</div>`;
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
    const picked = p.keySel.map((r) => tl.keys[r.driver][r.i]);
    const one = picked.length === 1 ? picked[0] : null;
    const segAll = picked.length && picked.every((x) => segKind(x) === segKind(picked[0])) ? segKind(picked[0]) : null;
    // A key of a slider that goes round: which way it turns to the next key.
    const oneRef = one ? p.keySel[0] : null;
    const way = oneRef && turnOf(doc, ed.mech, oneRef.driver) && tl.keys[oneRef.driver][oneRef.i + 1] ? turnWay(tl.keys[oneRef.driver], oneRef.i) : undefined;
    const turnSelect =
      way !== undefined
        ? `<select data-tl="kturn" title="${t("timeline.turnWayTip")}">${way ? "" : `<option value="" selected>${t("timeline.turnHold")}</option>`}${(["ccw", "cw"] as const).map((x) => `<option value="${x}"${way === x ? " selected" : ""}>${t(`timeline.turnWay.${x}`)}</option>`).join("")}</select>`
        : "";
    const editor = picked.length
      ? `<span class="tl-keyedit">
          <span class="tl-keyname">◆ ${one ? esc(driverName(ed, doc.motion.drivers[p.keySel[0].driver])) : t("timeline.nKeys", { n: picked.length })}</span>
          ${one ? `<label>${t("timeline.at")}<input type="number" step="0.05" min="0" data-tl="kt" value="${one.t}"> s</label>
          <label>${t("timeline.value")}<input type="number" step="any" data-tl="kv" value="${round(one.v)}"></label>` : ""}
          ${turnSelect}
          <select data-tl="kseg" title="${t("timeline.segTip")}">${segAll ? "" : `<option value="" selected>${t("timeline.segMixed")}</option>`}${SEGS.map((x) => `<option value="${x}"${segAll === x ? " selected" : ""}>${t(`timeline.segShort.${x}`)}</option>`).join("")}</select>
          <button class="icon-btn" data-tl="kdel" title="${t("timeline.deleteKeys")} (Del)">${icons.delete}</button>
        </span>`
      : "";
    const anyKeys = Object.values(tl.keys).some((x) => x.length);
    const counting = p.countdown;
    const busy = p.recording || counting !== null || !!video || gifProgress !== null;
    el.innerHTML = `
      <div class="tl-head">
        <span class="tl-group">
          <button class="icon-btn tl-play" data-tl="play" ${busy ? "disabled" : ""} title="${t(p.playing ? "timeline.pause" : "timeline.play")} (Space)">${p.playing ? icons.pause : icons.play}</button>
          <button class="icon-btn tl-stop" data-tl="stop" ${busy ? "disabled" : ""} title="${t("timeline.stop")}">${icons.stop}</button>
          <span class="tl-time">${p.time.toFixed(2)}<span class="muted"> / ${tl.length} s</span></span>
        </span>
        <span class="tl-group">
          <button class="btn tl-keybtn" data-tl="key" ${busy ? "disabled" : ""} title="${t("timeline.keyTip")}">${icons.key}${t("timeline.key")}</button>
          <button class="btn tl-rec${p.recording ? " on" : ""}${counting !== null ? " counting" : ""}" data-tl="rec" ${video || gifProgress !== null ? "disabled" : ""} title="${t("record.tip")}"><span class="tl-recdot"></span>${counting !== null ? t("record.cancel", { n: counting }) : t(p.recording ? "record.stop" : "record.start")}</button>
        </span>
        ${editor}
        <span class="tl-spacer"></span>
        <span class="tl-group tl-clip">
          <label title="${t("timeline.lengthTip")}">${t("timeline.length")}<input type="number" min="0.1" step="0.5" data-tl="length" value="${tl.length}"> s</label>
          <select data-tl="mode" title="${t("timeline.playMode")}">
            ${(["once", "loop", "pingpong"] as const).map((m) => `<option value="${m}"${tl.mode === m ? " selected" : ""}>${t(`timeline.${m}`)}</option>`).join("")}
          </select>
          <label title="${t("record.leadInTip")}">${t("record.leadIn")}<input type="number" min="0" max="30" step="1" data-tl="lead" value="${p.leadIn}"> s</label>
          <button class="icon-btn tl-delall" data-tl="delall" ${anyKeys && !busy ? "" : "disabled"} title="${t("timeline.deleteAll")}">${icons.delete}</button>
        </span>
        <span class="tl-group tl-export">
          <span class="muted">${t("export.title")}</span>
          <select data-tl="quality" title="${t("export.qualityTip")}" ${busy ? "disabled" : ""}>${EXPORT_SCALES.map((n) => `<option value="${n}"${exportScale() === n ? " selected" : ""}>${t(`export.quality${n}`)}</option>`).join("")}</select>
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
      </div>
      ${counting !== null ? `<div class="tl-countdown"><b>${counting}</b><span>${t("record.getReady")}</span></div>` : ""}`;
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
    download(new Blob([csv], { type: "text/csv" }), `${fileStem(ed.doc)}.csv`);
  };

  const editTimeline = (fn: (tl: Timeline) => void) =>
    ed.change((doc) => {
      const tl: Timeline = timelineCopy(doc);
      fn(tl);
      doc.motion.timeline = tl;
    });

  /** How far one full turn of a joint's slider goes (360° for a crank, the length of a closed track), or 0 if it doesn't go round. */
  function spinSpan(jointId: Id): number {
    const j = ed.mech.joint(jointId);
    const kind = j && jointKinds.get(j.kind);
    if (!j || !kind?.wraps?.(j)) return 0;
    const [lo, hi] = kind.range(ed.doc, j);
    return hi - lo;
  }

  /** Key a full turn from where the joint is now; pressed again, turn the other way. */
  const spin = (driverId: Id) => {
    const d = ed.doc.motion.drivers[driverId];
    const span = d ? spinSpan(d.joint) : 0;
    if (!span) return;
    const tl = timelineOf(ed.doc);
    const dir = spinDirection(tl.keys[driverId], span) > 0 ? -1 : 1;
    const from = tl.keys[driverId]?.[0]?.v ?? ed.mech.measure(ed.mech.current(), d.joint);
    editTimeline((x) => spinKeys(x, driverId, from, dir * span));
    ed.flash(t(dir > 0 ? "timeline.spinOn" : "timeline.spinReversed"));
  };

  el.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const b = target.closest<HTMLElement>("[data-tl]");
    if (b?.tagName === "BUTTON") {
      const what = b.dataset.tl;
      b.blur();
      if (what === "play") p.toggle();
      if (what === "stop") p.toStart();
      if (what === "delall") p.deleteAllKeys();
      if (what === "spin") spin(b.dataset.driver!);
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
      if (what === "kdel") p.deleteSelectedKeys();
      ed.emit();
      return;
    }
    const name = target.closest<HTMLElement>("[data-pick]");
    // Shift- or Ctrl-click adds a slider to the selection, so a key goes to several at once.
    if (name) ed.select([name.dataset.pick!], e.shiftKey || e.ctrlKey || e.metaKey);
  });

  el.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const what = input.dataset.tl;
    const n = parseFloat(input.value);
    // The clip can't end before its last key: that key would play nowhere and couldn't be reached.
    if (what === "length" && n > 0) editTimeline((tl) => (tl.length = Math.max(n, ...Object.values(tl.keys).flat().map((k) => k.t))));
    if (what === "mode") editTimeline((tl) => (tl.mode = input.value as Timeline["mode"]));
    if (what === "lead" && n >= 0) (p.leadIn = n), ed.emit();
    if (what === "quality") setExportScale(n);
    const refs = p.keySel;
    if (what === "kseg" && refs.length && input.value) editTimeline((tl) => refs.forEach((r) => setSeg(tl.keys[r.driver][r.i], input.value as Seg)));
    if (refs.length === 1) {
      const s = refs[0];
      const per = what === "kturn" && input.value ? turnOf(ed.doc, ed.mech, s.driver) : undefined;
      if (per) editTimeline((tl) => setTurnWay(tl.keys[s.driver], s.i, input.value as TurnWay, per));
      if (what === "kv" && Number.isFinite(n)) editTimeline((tl) => (tl.keys[s.driver][s.i].v = n));
      if (what === "kt" && Number.isFinite(n)) {
        editTimeline((tl) => {
          const keys = tl.keys[s.driver];
          const k = keys[s.i];
          k.t = Math.min(tl.length, Math.max(0, n));
          keys.sort((a, b) => a.t - b.t);
          p.keySel = [{ driver: s.driver, i: keys.indexOf(k) }];
        });
      }
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
    p.keySel = [];
    editTimeline((tl) => {
      tl.keys[driver]?.splice(i, 1);
      if (tl.keys[driver] && !tl.keys[driver].length) delete tl.keys[driver];
    });
  });

  // Click a key to select it (Shift or Ctrl adds to the selection) and drag to retime the selected keys.
  // Press anywhere else on the lanes to scrub; Shift- or Ctrl-drag there to box-select keys.
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const key = target.closest<HTMLElement>("[data-key]");
    const onLanes = target.closest(".tl-lane, .tl-ruler, .tl-seg");
    if (!key && !onLanes) return;
    e.preventDefault();
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    if (key) {
      const ref = { driver: key.dataset.driver!, i: Number(key.dataset.key) };
      const was = isSel(ref.driver, ref.i);
      if (add) {
        p.keySel = was ? p.keySel.filter((r) => r.driver !== ref.driver || r.i !== ref.i) : [...p.keySel, ref];
        return ed.emit();
      }
      if (!was) p.keySel = [ref];
      const start = structuredClone(timelineOf(ed.doc));
      const refs = p.keySel;
      const t0 = start.keys[ref.driver][ref.i].t;
      const x0 = e.clientX;
      let moved = false;
      const move = (ev: PointerEvent) => {
        if (!moved && Math.abs(ev.clientX - x0) < 3) return;
        if (!moved) ed.beginDrag();
        moved = true;
        const dt = snap(timeAt(ev.clientX)) - t0;
        ed.live((doc) => {
          const tl = structuredClone(start);
          p.keySel = shiftKeys(tl, refs, dt);
          doc.motion.timeline = tl;
        });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (moved) ed.endDrag();
        else {
          // A plain click on one of several selected keys picks just that one.
          p.keySel = [ref];
          p.seek(t0);
          ed.emit();
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      ed.emit();
      return;
    }
    if (add) return boxSelect(e);
    p.keySel = [];
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

  /** Drag a box over the lanes to add the keys inside it to the selection. */
  const boxSelect = (e: PointerEvent) => {
    const box = document.createElement("div");
    box.className = "tl-box";
    el.append(box);
    const x0 = e.clientX, y0 = e.clientY;
    const rect = (x: number, y: number) => ({ l: Math.min(x0, x), r: Math.max(x0, x), t: Math.min(y0, y), b: Math.max(y0, y) });
    const move = (ev: PointerEvent) => {
      const r = rect(ev.clientX, ev.clientY);
      Object.assign(box.style, { left: `${r.l}px`, top: `${r.t}px`, width: `${r.r - r.l}px`, height: `${r.b - r.t}px` });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      box.remove();
      const r = rect(ev.clientX, ev.clientY);
      const inside: KeyRef[] = [];
      for (const k of el.querySelectorAll<HTMLElement>("[data-key]")) {
        const b = k.getBoundingClientRect();
        const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
        const ref = { driver: k.dataset.driver!, i: Number(k.dataset.key) };
        if (cx >= r.l - 4 && cx <= r.r + 4 && cy >= r.t - 4 && cy <= r.b + 4 && !isSel(ref.driver, ref.i)) inside.push(ref);
      }
      p.keySel = [...p.keySel, ...inside];
      ed.emit();
    };
    move(e);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

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
