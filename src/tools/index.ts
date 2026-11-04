import { Registry } from "../core/registry";
import type { Tool } from "./types";
import { selectTool } from "./select";
import { arcTool, circleTool, rectTool, rectCenterTool, pointTool } from "./draw";
import { dimensionTool, measureTool } from "./dimension";
import { lineTool } from "./polyline";
import { textTool } from "./text";
import { constraintPickTool } from "./constraintPick";
import { driveTool, moveTool, traceTool } from "./motion";

export const tools = new Registry<Tool>("tools");

// Toolbar order follows registration order.
[selectTool, lineTool, arcTool, circleTool, rectTool, rectCenterTool, pointTool, textTool, dimensionTool, measureTool, constraintPickTool, moveTool, driveTool, traceTool].forEach((tool) =>
  tools.register(tool),
);

export type { Tool } from "./types";
export { toolInMode } from "./types";
