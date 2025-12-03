/* Copyright 2024 Marimo. All rights reserved. */

import { graphlib, layout } from "@dagrejs/dagre";
import type { Editor, TLShapeId } from "tldraw";
import type { CellId } from "@/core/cells/ids";
import type { Variables } from "@/core/variables/types";
import { CELL_SPACING } from "./types";

/**
 * A cell-like shape with w/h props (supports both "cell" and "editable-cell" types)
 */
interface CellLikeShape {
  id: TLShapeId;
  type: string;
  x: number;
  y: number;
  props: { w: number; h: number };
}

/**
 * Type guard for cell-like shapes (both "cell" and "editable-cell")
 */
function isCellLikeShape(shape: unknown): shape is CellLikeShape {
  return (
    shape !== null &&
    shape !== undefined &&
    typeof shape === "object" &&
    "type" in shape &&
    "props" in shape &&
    (shape.type === "cell" || shape.type === "editable-cell")
  );
}

/**
 * Get cell-like shapes from shape IDs, filtering out non-cell shapes.
 */
function getCellLikeShapes(
  editor: Editor,
  shapeIds: TLShapeId[],
): CellLikeShape[] {
  const result: CellLikeShape[] = [];
  for (const id of shapeIds) {
    const shape = editor.getShape(id);
    if (isCellLikeShape(shape)) {
      result.push(shape);
    }
  }
  return result;
}

export type LayoutDirection = "TB" | "LR"; // Top-to-Bottom or Left-to-Right

export interface LayoutOptions {
  direction: LayoutDirection;
  nodeSpacing: number;
  rankSpacing: number;
}

const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  direction: "TB",
  nodeSpacing: CELL_SPACING,
  rankSpacing: CELL_SPACING * 2,
};

/**
 * Build a dependency graph from variables.
 * Returns a map of cellId -> set of cellIds that it depends on.
 */
export function buildDependencyGraph(
  variables: Variables,
  cellIds: Set<CellId>,
): Map<CellId, Set<CellId>> {
  const dependencies = new Map<CellId, Set<CellId>>();

  // Initialize all cells with empty dependency sets
  for (const cellId of cellIds) {
    dependencies.set(cellId, new Set());
  }

  for (const variable of Object.values(variables)) {
    // Skip marimo module
    if (variable.name === "mo" && variable.value === "marimo") {
      continue;
    }

    const { declaredBy, usedBy } = variable;

    for (const producerId of declaredBy) {
      for (const consumerId of usedBy) {
        if (producerId === consumerId) {
          continue;
        }
        if (!cellIds.has(producerId) || !cellIds.has(consumerId)) {
          continue;
        }

        // consumerId depends on producerId
        const deps = dependencies.get(consumerId);
        if (deps) {
          deps.add(producerId);
        }
      }
    }
  }

  return dependencies;
}

/**
 * Compute execution levels for cells.
 * Cells at level 0 have no dependencies.
 * Cells at level N depend on at least one cell at level N-1.
 */
export function computeExecutionLevels(
  cellIds: CellId[],
  dependencies: Map<CellId, Set<CellId>>,
): Map<CellId, number> {
  const levels = new Map<CellId, number>();
  const visited = new Set<CellId>();

  function computeLevel(cellId: CellId): number {
    const cachedLevel = levels.get(cellId);
    if (cachedLevel !== undefined) {
      return cachedLevel;
    }

    if (visited.has(cellId)) {
      // Cycle detected, return 0 to break the cycle
      return 0;
    }

    visited.add(cellId);

    const deps = dependencies.get(cellId) || new Set();
    if (deps.size === 0) {
      levels.set(cellId, 0);
      return 0;
    }

    let maxDepLevel = -1;
    for (const depId of deps) {
      const depLevel = computeLevel(depId);
      maxDepLevel = Math.max(maxDepLevel, depLevel);
    }

    const level = maxDepLevel + 1;
    levels.set(cellId, level);
    return level;
  }

  for (const cellId of cellIds) {
    computeLevel(cellId);
  }

  return levels;
}

/**
 * Group cells by their execution level.
 */
export function groupByLevel(
  cellIds: CellId[],
  levels: Map<CellId, number>,
): CellId[][] {
  const maxLevel = Math.max(...levels.values(), 0);
  const groups: CellId[][] = Array.from({ length: maxLevel + 1 }, () => []);

  for (const cellId of cellIds) {
    const level = levels.get(cellId) ?? 0;
    groups[level].push(cellId);
  }

  return groups;
}

/**
 * Layout selected shapes in dependency order.
 */
export function layoutShapesByDependency(
  editor: Editor,
  shapeIds: TLShapeId[],
  variables: Variables,
  cellShapeIds: Map<CellId, TLShapeId>,
  options: Partial<LayoutOptions> = {},
): void {
  const opts = { ...DEFAULT_LAYOUT_OPTIONS, ...options };

  // Get cell IDs from selected shapes
  const selectedCellIds: CellId[] = [];
  const shapeIdToCellId = new Map<TLShapeId, CellId>();

  for (const [cellId, shapeId] of cellShapeIds.entries()) {
    if (shapeIds.includes(shapeId)) {
      selectedCellIds.push(cellId);
      shapeIdToCellId.set(shapeId, cellId);
    }
  }

  if (selectedCellIds.length === 0) {
    return;
  }

  // Build dependency graph for selected cells
  const dependencies = buildDependencyGraph(
    variables,
    new Set(selectedCellIds),
  );

  // Compute execution levels (used by dagre for ranking)
  const dependenciesForDagre = dependencies;

  // Calculate positions using dagre for proper layout
  const g = new graphlib.Graph();
  g.setGraph({
    rankdir: opts.direction,
    nodesep: opts.nodeSpacing,
    ranksep: opts.rankSpacing,
    ranker: "longest-path",
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Add nodes
  for (const cellId of selectedCellIds) {
    const shapeId = cellShapeIds.get(cellId);
    if (!shapeId) {
      continue;
    }

    const shape = editor.getShape(shapeId);
    if (!shape) {
      continue;
    }

    g.setNode(cellId, {
      width: (shape.props as { w: number }).w,
      height: (shape.props as { h: number }).h,
    });
  }

  // Add edges
  for (const [cellId, deps] of dependenciesForDagre.entries()) {
    for (const depId of deps) {
      if (selectedCellIds.includes(depId)) {
        g.setEdge(depId, cellId);
      }
    }
  }

  // Run layout
  layout(g);

  // Find the bounding box of selected shapes to position relative to selection center
  let minX = Infinity;
  let minY = Infinity;
  for (const shapeId of shapeIds) {
    const shape = editor.getShape(shapeId);
    if (shape) {
      minX = Math.min(minX, shape.x);
      minY = Math.min(minY, shape.y);
    }
  }

  // Update shape positions
  const updates: { id: TLShapeId; x: number; y: number }[] = [];

  for (const cellId of selectedCellIds) {
    const shapeId = cellShapeIds.get(cellId);
    if (!shapeId) {
      continue;
    }

    const node = g.node(cellId);
    if (!node) {
      continue;
    }

    const shape = editor.getShape(shapeId);
    if (!shape) {
      continue;
    }

    // Position from dagre is center-based, convert to top-left
    updates.push({
      id: shapeId,
      x: minX + node.x - (shape.props as { w: number }).w / 2,
      y: minY + node.y - (shape.props as { h: number }).h / 2,
    });
  }

  // Batch update positions - detect shape type from existing shapes
  editor.updateShapes(
    updates.map(({ id, x, y }) => {
      const shape = editor.getShape(id);
      return {
        id,
        type: shape?.type || "cell",
        x,
        y,
      };
    }),
  );
}

/**
 * Arrange shapes in a simple grid layout.
 */
export function layoutShapesInGrid(
  editor: Editor,
  shapeIds: TLShapeId[],
  _cellShapeIds: Map<CellId, TLShapeId>,
  columns = 3,
): void {
  // Get shapes with their current order
  const shapes = getCellLikeShapes(editor, shapeIds);

  if (shapes.length === 0) {
    return;
  }

  // Find starting position
  const minX = Math.min(...shapes.map((s) => s.x));
  const minY = Math.min(...shapes.map((s) => s.y));

  // Calculate grid positions
  const updates: { id: TLShapeId; x: number; y: number }[] = [];
  let currentX = minX;
  let currentY = minY;
  let maxHeightInRow = 0;
  let col = 0;

  for (const shape of shapes) {
    updates.push({
      id: shape.id,
      x: currentX,
      y: currentY,
    });

    maxHeightInRow = Math.max(maxHeightInRow, shape.props.h);
    col++;

    if (col >= columns) {
      col = 0;
      currentX = minX;
      currentY += maxHeightInRow + CELL_SPACING;
      maxHeightInRow = 0;
    } else {
      currentX += shape.props.w + CELL_SPACING;
    }
  }

  // Batch update positions - detect shape type from existing shapes
  editor.updateShapes(
    updates.map(({ id, x, y }) => {
      const shape = editor.getShape(id);
      return {
        id,
        type: shape?.type || "cell",
        x,
        y,
      };
    }),
  );
}

/**
 * Arrange shapes in a vertical stack.
 */
export function layoutShapesVertically(
  editor: Editor,
  shapeIds: TLShapeId[],
): void {
  const shapes = getCellLikeShapes(editor, shapeIds).sort((a, b) => a.y - b.y); // Maintain relative order

  if (shapes.length === 0) {
    return;
  }

  const minX = Math.min(...shapes.map((s) => s.x));
  const minY = Math.min(...shapes.map((s) => s.y));

  const updates: { id: TLShapeId; type: string; x: number; y: number }[] = [];
  let currentY = minY;

  for (const shape of shapes) {
    updates.push({
      id: shape.id,
      type: shape.type,
      x: minX,
      y: currentY,
    });
    currentY += shape.props.h + CELL_SPACING;
  }

  editor.updateShapes(updates);
}

/**
 * Arrange shapes in a horizontal row.
 */
export function layoutShapesHorizontally(
  editor: Editor,
  shapeIds: TLShapeId[],
): void {
  const shapes = getCellLikeShapes(editor, shapeIds).sort((a, b) => a.x - b.x); // Maintain relative order

  if (shapes.length === 0) {
    return;
  }

  const minX = Math.min(...shapes.map((s) => s.x));
  const minY = Math.min(...shapes.map((s) => s.y));

  const updates: { id: TLShapeId; type: string; x: number; y: number }[] = [];
  let currentX = minX;

  for (const shape of shapes) {
    updates.push({
      id: shape.id,
      type: shape.type,
      x: currentX,
      y: minY,
    });
    currentX += shape.props.w + CELL_SPACING;
  }

  editor.updateShapes(updates);
}

/**
 * Align shapes to their left edges.
 */
export function alignShapesLeft(editor: Editor, shapeIds: TLShapeId[]): void {
  const shapes = getCellLikeShapes(editor, shapeIds);

  if (shapes.length === 0) {
    return;
  }

  const minX = Math.min(...shapes.map((s) => s.x));

  editor.updateShapes(
    shapes.map((shape) => ({
      id: shape.id,
      type: shape.type,
      x: minX,
    })),
  );
}

/**
 * Align shapes to their top edges.
 */
export function alignShapesTop(editor: Editor, shapeIds: TLShapeId[]): void {
  const shapes = getCellLikeShapes(editor, shapeIds);

  if (shapes.length === 0) {
    return;
  }

  const minY = Math.min(...shapes.map((s) => s.y));

  editor.updateShapes(
    shapes.map((shape) => ({
      id: shape.id,
      type: shape.type,
      y: minY,
    })),
  );
}
