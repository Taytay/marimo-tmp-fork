/* Copyright 2024 Marimo. All rights reserved. */

import type { CellId } from "@/core/cells/ids";

/**
 * Position and dimensions for a cell on the canvas.
 */
export interface CanvasCellPosition {
  cellId: CellId;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Runtime layout state for the canvas.
 */
export interface CanvasLayout {
  cells: CanvasCellPosition[];
}

/**
 * Serialized layout for storage.
 * Position is [x, y, width, height] or null if not placed.
 */
export interface SerializedCanvasLayoutCell {
  position: [number, number, number, number] | null;
}

export interface SerializedCanvasLayout {
  cells: SerializedCanvasLayoutCell[];
}

/**
 * Default cell dimensions
 */
export const DEFAULT_CELL_WIDTH = 500;
export const DEFAULT_CELL_HEIGHT = 200;
export const CELL_SPACING = 50;
