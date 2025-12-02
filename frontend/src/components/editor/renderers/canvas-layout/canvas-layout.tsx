/* Copyright 2024 Marimo. All rights reserved. */

import React, { memo, useCallback, useEffect, useMemo, useRef } from "react";
import {
  createShapeId,
  Tldraw,
  type Editor,
  type TLShapeId,
} from "tldraw";
import "tldraw/tldraw.css";

import type { CellId } from "@/core/cells/ids";
import type { CellData, CellRuntimeState } from "@/core/cells/types";
import { useVariables } from "@/core/variables/state";
import { cn } from "@/utils/cn";
import type { ICellRendererProps } from "../types";
import {
  CellShapeUtil,
  CellDataContext,
  CellActionsContext,
  type CellActions,
} from "./cell-shape-util";
import { updateDependencyArrows } from "./dependency-arrows";
import type {
  CanvasLayout,
  CanvasCellPosition,
} from "./types";
import {
  DEFAULT_CELL_WIDTH,
  DEFAULT_CELL_HEIGHT,
  CELL_SPACING,
} from "./types";

import "./styles.css";

type Props = ICellRendererProps<CanvasLayout>;

// Custom shape utils array - must be defined outside component
const customShapeUtils = [CellShapeUtil];

/**
 * Canvas Layout Renderer using TLDraw.
 *
 * Renders notebook cells as draggable shapes on an infinite canvas,
 * with dependency arrows showing the data flow between cells.
 */
export const CanvasLayoutRenderer: React.FC<Props> = memo(
  ({ layout, setLayout, cells, mode }) => {
    const variables = useVariables();
    const editorRef = useRef<Editor | null>(null);
    const cellShapeIdsRef = useRef<Map<CellId, TLShapeId>>(new Map());
    const isInitializedRef = useRef(false);

    // Create a map of cell data for the context
    const cellDataMap = useMemo(() => {
      const map = new Map<CellId, CellRuntimeState & CellData>();
      for (const cell of cells) {
        map.set(cell.id, cell);
      }
      return map;
    }, [cells]);

    // Cell actions passed to the shape component
    const cellActions: CellActions = useMemo(
      () => ({
        onRun: (cellId: CellId) => {
          // TODO: Integrate with cell running logic
          console.log("Run cell:", cellId);
        },
        onFocus: (cellId: CellId) => {
          // TODO: Focus the cell for editing
          console.log("Focus cell:", cellId);
        },
      }),
      []
    );

    // Handle editor mount
    const handleMount = useCallback(
      (editor: Editor) => {
        editorRef.current = editor;

        // Initialize cell shapes if this is the first mount
        if (!isInitializedRef.current) {
          initializeCellShapes(editor, cells, layout, cellShapeIdsRef.current);
          isInitializedRef.current = true;
        }

        // Update dependency arrows
        updateDependencyArrows(editor, variables, cellShapeIdsRef.current);

        // Listen for shape changes to update layout
        const handleChange = () => {
          const positions = extractPositions(editor, cellShapeIdsRef.current);
          if (hasPositionsChanged(layout.cells, positions)) {
            setLayout({ cells: positions });
          }
        };

        // Use a store listener for changes
        const unsubscribe = editor.store.listen(handleChange, {
          source: "user",
          scope: "document",
        });

        return () => {
          unsubscribe();
        };
      },
      [cells, layout, setLayout, variables]
    );

    // Update cell shapes when cells change
    useEffect(() => {
      const editor = editorRef.current;
      if (!editor || !isInitializedRef.current) {
        return;
      }

      syncCellShapes(editor, cells, layout, cellShapeIdsRef.current);
    }, [cells, layout]);

    // Update dependency arrows when variables change
    useEffect(() => {
      const editor = editorRef.current;
      if (!editor || !isInitializedRef.current) {
        return;
      }

      updateDependencyArrows(editor, variables, cellShapeIdsRef.current);
    }, [variables]);

    const isReadMode = mode === "read";

    return (
      <CellDataContext.Provider value={cellDataMap}>
        <CellActionsContext.Provider value={cellActions}>
          <div
            className={cn(
              "canvas-layout-container",
              "w-full h-full",
              isReadMode && "pointer-events-none"
            )}
          >
            <Tldraw
              shapeUtils={customShapeUtils}
              onMount={handleMount}
              hideUi={isReadMode}
              inferDarkMode={true}
            />
          </div>
        </CellActionsContext.Provider>
      </CellDataContext.Provider>
    );
  }
);

CanvasLayoutRenderer.displayName = "CanvasLayoutRenderer";

/**
 * Initialize cell shapes on the canvas.
 */
function initializeCellShapes(
  editor: Editor,
  cells: (CellRuntimeState & CellData)[],
  layout: CanvasLayout,
  cellShapeIds: Map<CellId, TLShapeId>
): void {
  const positionMap = new Map<CellId, CanvasCellPosition>();
  for (const pos of layout.cells) {
    positionMap.set(pos.cellId, pos);
  }

  // Create shapes for each cell
  let currentY = 0;
  for (const cell of cells) {
    const existingPos = positionMap.get(cell.id);
    const shapeId = createShapeId();

    const x = existingPos?.x ?? 100;
    const y = existingPos?.y ?? currentY;
    const w = existingPos?.width ?? DEFAULT_CELL_WIDTH;
    const h = existingPos?.height ?? DEFAULT_CELL_HEIGHT;

    editor.createShape({
      id: shapeId,
      type: "cell",
      x,
      y,
      props: {
        w,
        h,
        cellId: cell.id,
      },
    });

    cellShapeIds.set(cell.id, shapeId);
    currentY = y + h + CELL_SPACING;
  }

  // Zoom to fit all shapes
  editor.zoomToFit({ animation: { duration: 200 } });
}

/**
 * Sync cell shapes with current cells.
 * Adds new cells, removes deleted cells, and updates positions.
 */
function syncCellShapes(
  editor: Editor,
  cells: (CellRuntimeState & CellData)[],
  layout: CanvasLayout,
  cellShapeIds: Map<CellId, TLShapeId>
): void {
  const currentCellIds = new Set(cells.map((c) => c.id));
  const positionMap = new Map<CellId, CanvasCellPosition>();
  for (const pos of layout.cells) {
    positionMap.set(pos.cellId, pos);
  }

  // Remove shapes for deleted cells
  const shapesToDelete: TLShapeId[] = [];
  for (const [cellId, shapeId] of cellShapeIds.entries()) {
    if (!currentCellIds.has(cellId)) {
      shapesToDelete.push(shapeId);
      cellShapeIds.delete(cellId);
    }
  }
  if (shapesToDelete.length > 0) {
    editor.deleteShapes(shapesToDelete);
  }

  // Add shapes for new cells
  let maxY = 0;
  for (const [, shapeId] of cellShapeIds.entries()) {
    const shape = editor.getShape(shapeId);
    if (shape) {
      const bounds = editor.getShapePageBounds(shape);
      if (bounds) {
        maxY = Math.max(maxY, bounds.y + bounds.height);
      }
    }
  }

  for (const cell of cells) {
    if (!cellShapeIds.has(cell.id)) {
      const shapeId = createShapeId();
      const existingPos = positionMap.get(cell.id);

      const x = existingPos?.x ?? 100;
      const y = existingPos?.y ?? maxY + CELL_SPACING;
      const w = existingPos?.width ?? DEFAULT_CELL_WIDTH;
      const h = existingPos?.height ?? DEFAULT_CELL_HEIGHT;

      editor.createShape({
        id: shapeId,
        type: "cell",
        x,
        y,
        props: {
          w,
          h,
          cellId: cell.id,
        },
      });

      cellShapeIds.set(cell.id, shapeId);
      maxY = y + h;
    }
  }
}

/**
 * Extract cell positions from the canvas.
 */
function extractPositions(
  editor: Editor,
  cellShapeIds: Map<CellId, TLShapeId>
): CanvasCellPosition[] {
  const positions: CanvasCellPosition[] = [];

  for (const [cellId, shapeId] of cellShapeIds.entries()) {
    const shape = editor.getShape(shapeId);
    if (shape && shape.type === "cell") {
      positions.push({
        cellId,
        x: shape.x,
        y: shape.y,
        width: (shape.props as { w: number }).w,
        height: (shape.props as { h: number }).h,
      });
    }
  }

  return positions;
}

/**
 * Check if positions have changed.
 */
function hasPositionsChanged(
  oldPositions: CanvasCellPosition[],
  newPositions: CanvasCellPosition[]
): boolean {
  if (oldPositions.length !== newPositions.length) {
    return true;
  }

  const oldMap = new Map<CellId, CanvasCellPosition>();
  for (const pos of oldPositions) {
    oldMap.set(pos.cellId, pos);
  }

  for (const newPos of newPositions) {
    const oldPos = oldMap.get(newPos.cellId);
    if (!oldPos) {
      return true;
    }
    if (
      oldPos.x !== newPos.x ||
      oldPos.y !== newPos.y ||
      oldPos.width !== newPos.width ||
      oldPos.height !== newPos.height
    ) {
      return true;
    }
  }

  return false;
}
