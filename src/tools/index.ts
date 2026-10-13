import { Registry } from "../core/registry";
import type { Tool } from "./types";
import { selectTool } from "./select";
import { arcTool, circleTool, rectTool, rectCenterTool, pointTool } from "./draw";
import { dimensionTool } from "./dimension";
import { lineTool } from "./polyline";
import { constraintPickTool } from "./constraintPick";
import { driveTool, moveTool } from "./motion";

export const tools = new Registry<Tool>("tools");

// Toolbar order follows registration order.
[selectTool, lineTool, arcTool, circleTool, rectTool, rectCenterTool, pointTool, dimensionTool, constraintPickTool, moveTool, driveTool].forEach((tool) =>
  tools.register(tool),
);

export type { Tool } from "./types";
export { toolInMode } from "./types";
