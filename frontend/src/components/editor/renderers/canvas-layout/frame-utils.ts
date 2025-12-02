/* Copyright 2024 Marimo. All rights reserved. */

import { createShapeId, type Editor, type TLShapeId } from "tldraw";
import type { CellId } from "@/core/cells/ids";
import type { CellData, CellRuntimeState } from "@/core/cells/types";
import type { CollapsibleTree } from "@/utils/id-tree";
import { canCollapseOutline } from "@/core/dom/outline";

// Frame padding around cells
const FRAME_PADDING = 20;
const COLUMN_SPACING = 50;
const HEADER_FRAME_PADDING = 15;

/**
 * Creates frame shapes for columns and header groups.
 * Returns maps of frame IDs for reference.
 */
export function createColumnFrames(
  editor: Editor,
  columns: readonly CollapsibleTree<CellId>[],
  cellDataMap: Map<CellId, CellRuntimeState & CellData>,
  cellShapeIds: Map<CellId, TLShapeId>,
): {
  columnFrameIds: Map<number, TLShapeId>;
  headerFrameIds: Map<CellId, TLShapeId>;
} {
  const columnFrameIds = new Map<number, TLShapeId>();
  const headerFrameIds = new Map<CellId, TLShapeId>();

  let currentX = 100;

  columns.forEach((column, columnIndex) => {
    const cellIds = column.inOrderIds;
    if (cellIds.length === 0) {
      return;
    }

    // Calculate column dimensions based on cell positions
    const columnBounds = calculateColumnBounds(cellIds, cellShapeIds, editor);
    if (!columnBounds) {
      return;
    }

    // Create the column frame
    const frameId = createShapeId();
    const frameX = columnBounds.minX - FRAME_PADDING;
    const frameY = columnBounds.minY - FRAME_PADDING - 30; // Extra space for label
    const frameWidth = columnBounds.maxX - columnBounds.minX + FRAME_PADDING * 2;
    const frameHeight = columnBounds.maxY - columnBounds.minY + FRAME_PADDING * 2 + 30;

    editor.createShape({
      id: frameId,
      type: "frame",
      x: frameX,
      y: frameY,
      props: {
        w: frameWidth,
        h: frameHeight,
        name: columns.length > 1 ? `Column ${columnIndex + 1}` : "",
      },
    });

    columnFrameIds.set(columnIndex, frameId);

    // Reparent all cells in this column to the frame
    for (const cellId of cellIds) {
      const shapeId = cellShapeIds.get(cellId);
      if (shapeId) {
        editor.reparentShapes([shapeId], frameId);
      }
    }

    // Now create header frames within this column
    createHeaderFramesForColumn(
      editor,
      column,
      cellDataMap,
      cellShapeIds,
      frameId,
      headerFrameIds,
    );

    currentX += frameWidth + COLUMN_SPACING;
  });

  // Send all frames to the back (behind cells)
  const allFrameIds = [...columnFrameIds.values(), ...headerFrameIds.values()];
  if (allFrameIds.length > 0) {
    editor.sendToBack(allFrameIds);
  }

  return { columnFrameIds, headerFrameIds };
}

/**
 * Creates nested frames for header cells within a column.
 */
function createHeaderFramesForColumn(
  editor: Editor,
  column: CollapsibleTree<CellId>,
  cellDataMap: Map<CellId, CellRuntimeState & CellData>,
  cellShapeIds: Map<CellId, TLShapeId>,
  columnFrameId: TLShapeId,
  headerFrameIds: Map<CellId, TLShapeId>,
): void {
  // Find all header cells and their groups
  const headerGroups = findHeaderGroups(column, cellDataMap);

  for (const group of headerGroups) {
    const { headerCellId, headerText, cellIds } = group;

    // Calculate bounds for this header group
    const groupBounds = calculateGroupBounds(cellIds, cellShapeIds, editor);
    if (!groupBounds) {
      continue;
    }

    // Create the header frame
    const frameId = createShapeId();
    const frameX = groupBounds.minX - HEADER_FRAME_PADDING;
    const frameY = groupBounds.minY - HEADER_FRAME_PADDING - 25; // Space for label
    const frameWidth = groupBounds.maxX - groupBounds.minX + HEADER_FRAME_PADDING * 2;
    const frameHeight = groupBounds.maxY - groupBounds.minY + HEADER_FRAME_PADDING * 2 + 25;

    // TODO: Add frame color support based on headerLevel when TLDraw supports it

    editor.createShape({
      id: frameId,
      type: "frame",
      x: frameX,
      y: frameY,
      props: {
        w: frameWidth,
        h: frameHeight,
        name: headerText,
      },
    });

    headerFrameIds.set(headerCellId, frameId);

    // Reparent cells to this header frame
    for (const cellId of cellIds) {
      const shapeId = cellShapeIds.get(cellId);
      if (shapeId) {
        // Only reparent if not already in a nested header frame
        const currentParent = editor.getShape(shapeId)?.parentId;
        if (currentParent === columnFrameId) {
          editor.reparentShapes([shapeId], frameId);
        }
      }
    }

    // Reparent the header frame to the column frame
    editor.reparentShapes([frameId], columnFrameId);
  }
}

interface HeaderGroup {
  headerCellId: CellId;
  headerLevel: number;
  headerText: string;
  cellIds: CellId[];
}

/**
 * Find header groups within a column.
 * A header group is a header cell and all cells "under" it until the next same-or-higher level header.
 */
function findHeaderGroups(
  column: CollapsibleTree<CellId>,
  cellDataMap: Map<CellId, CellRuntimeState & CellData>,
): HeaderGroup[] {
  const groups: HeaderGroup[] = [];
  const cellIds = column.inOrderIds;

  let currentGroup: HeaderGroup | null = null;

  for (const cellId of cellIds) {
    const cellData = cellDataMap.get(cellId);
    if (!cellData) {
      continue;
    }

    const outline = cellData.outline;
    const isHeader = canCollapseOutline(outline);

    if (isHeader && outline) {
      // Find the highest-level header in this cell
      const headerLevel = Math.min(...outline.items.map((item) => item.level));
      const headerItem = outline.items.find((item) => item.level === headerLevel);
      const headerText = headerItem?.name || "Section";

      // If we have a current group and this header is same or higher level, close it
      if (currentGroup && headerLevel <= currentGroup.headerLevel) {
        groups.push(currentGroup);
        currentGroup = null;
      }

      // Start a new group
      currentGroup = {
        headerCellId: cellId,
        headerLevel,
        headerText,
        cellIds: [cellId],
      };
    } else if (currentGroup) {
      // Add to current group
      currentGroup.cellIds.push(cellId);
    }
  }

  // Don't forget the last group
  if (currentGroup) {
    groups.push(currentGroup);
  }

  return groups;
}

/**
 * Calculate the bounding box for a set of cells.
 */
function calculateColumnBounds(
  cellIds: CellId[],
  cellShapeIds: Map<CellId, TLShapeId>,
  editor: Editor,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hasShapes = false;

  for (const cellId of cellIds) {
    const shapeId = cellShapeIds.get(cellId);
    if (!shapeId) {
      continue;
    }

    const shape = editor.getShape(shapeId);
    if (!shape) {
      continue;
    }

    const bounds = editor.getShapePageBounds(shape);
    if (!bounds) {
      continue;
    }

    hasShapes = true;
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  if (!hasShapes) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Calculate bounds for a group of cells.
 */
function calculateGroupBounds(
  cellIds: CellId[],
  cellShapeIds: Map<CellId, TLShapeId>,
  editor: Editor,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  return calculateColumnBounds(cellIds, cellShapeIds, editor);
}

/**
 * Update frame bounds when cells move.
 */
export function updateFrameBounds(
  editor: Editor,
  columnFrameIds: Map<number, TLShapeId>,
  headerFrameIds: Map<CellId, TLShapeId>,
): void {
  // For now, frames don't auto-resize. Users can manually resize them.
  // In the future, we could implement auto-fit based on child positions.
}

/**
 * Clear all frames from the canvas.
 */
export function clearAllFrames(editor: Editor): void {
  const frames = editor.getCurrentPageShapes().filter((shape) => shape.type === "frame");
  if (frames.length > 0) {
    editor.deleteShapes(frames.map((f) => f.id));
  }
}
