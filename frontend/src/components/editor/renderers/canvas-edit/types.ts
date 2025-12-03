/* Copyright 2024 Marimo. All rights reserved. */

import type { CellId } from "@/core/cells/ids";

/**
 * Position and size of a cell on the canvas.
 */
export interface CanvasCellPosition {
  cellId: CellId;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Layout state for canvas edit mode.
 */
export interface CanvasEditLayoutState {
  cells: CanvasCellPosition[];
}

// Default dimensions for cells - larger to accommodate editor UI
export const DEFAULT_CELL_WIDTH = 800;
export const DEFAULT_CELL_HEIGHT = 350;
export const CELL_SPACING = 50;
export const MIN_CELL_WIDTH = 400;
export const MIN_CELL_HEIGHT = 150;
