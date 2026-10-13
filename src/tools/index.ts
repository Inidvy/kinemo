import { Registry } from "../core/registry";
import type { Tool } from "./types";
import { selectTool } from "./select";
import { lineTool, arcTool, circleTool, rectTool, rectCenterTool, pointTool } from "./draw";
import { dimensionTool } from "./dimension";

export const tools = new Registry<Tool>("tools");

// Toolbar order follows registration order.
[selectTool, lineTool, arcTool, circleTool, rectTool, rectCenterTool, pointTool, dimensionTool].forEach((tool) =>
  tools.register(tool),
);

export type { Tool } from "./types";
