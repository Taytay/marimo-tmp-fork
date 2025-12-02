/* Copyright 2024 Marimo. All rights reserved. */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createShapeId,
  Tldraw,
  type Editor,
  type TLShapeId,
} from "tldraw";
import "tldraw/tldraw.css";

import type { CellId } from "@/core/cells/ids";
import { CellId as CellIdUtils } from "@/core/cells/ids";
import type { CellData, CellRuntimeState } from "@/core/cells/types";
import { useCellActions } from "@/core/cells/cells";
import { useVariables } from "@/core/variables/state";
import { useRunCells } from "@/components/editor/cell/useRunCells";
import { cn } from "@/utils/cn";
import type { ICellRendererProps } from "../types";
import {
  CellShapeUtil,
  CellDataContext,
  CellActionsContext,
  type CanvasCellActions,
  type AddCellDirection,
} from "./cell-shape-util";
import { updateDependencyArrows } from "./dependency-arrows";
import { CanvasToolbar } from "./canvas-toolbar";
import {
  layoutShapesByDependency,
  layoutShapesVertically,
  layoutShapesHorizontally,
  alignShapesLeft,
  alignShapesTop,
} from "./layout-utils";
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
    const [selectedCount, setSelectedCount] = useState(0);
    const { createNewCell, focusCell } = useCellActions();
    const runCells = useRunCells();

    // Create a map of cell data for the context
    const cellDataMap = useMemo(() => {
      const map = new Map<CellId, CellRuntimeState & CellData>();
      for (const cell of cells) {
        map.set(cell.id, cell);
      }
      return map;
    }, [cells]);

    // Cell actions passed to the shape component
    const cellActions: CanvasCellActions = useMemo(
      () => ({
        onRun: (cellId: CellId) => {
          runCells([cellId]);
        },
        onDelete: (cellId: CellId) => {
          // TODO: Implement cell deletion
          console.log("Delete cell:", cellId);
        },
        onFocus: (cellId: CellId) => {
          focusCell({ cellId, where: "exact" });
        },
        onAddCell: (cellId: CellId, direction: AddCellDirection) => {
          const editor = editorRef.current;
          if (!editor) return;

          const newCellId = CellIdUtils.create();

          // Create the cell in the notebook
          const before = direction === "above";
          createNewCell({
            cellId: before ? cellId : cellId,
            before,
            code: "",
          });

          // Get the position of the reference cell
          const refShapeId = cellShapeIdsRef.current.get(cellId);
          if (!refShapeId) return;

          const refShape = editor.getShape(refShapeId);
          if (!refShape) return;

          // Calculate position for new cell based on direction
          let newX = refShape.x;
          let newY = refShape.y;
          const width = DEFAULT_CELL_WIDTH;
          const height = DEFAULT_CELL_HEIGHT;

          switch (direction) {
            case "above":
              newY = refShape.y - height - CELL_SPACING;
              break;
            case "below":
              newY = refShape.y + (refShape.props as { h: number }).h + CELL_SPACING;
              break;
            case "left":
              newX = refShape.x - width - CELL_SPACING;
              break;
            case "right":
              newX = refShape.x + (refShape.props as { w: number }).w + CELL_SPACING;
              break;
          }

          // Create the shape for the new cell
          const newShapeId = createShapeId();
          editor.createShape({
            id: newShapeId,
            type: "cell",
            x: newX,
            y: newY,
            props: {
              w: width,
              h: height,
              cellId: newCellId,
            },
          });

          cellShapeIdsRef.current.set(newCellId, newShapeId);

          // Update layout
          const positions = extractPositions(editor, cellShapeIdsRef.current);
          setLayout({ cells: positions });

          // Select the new cell
          editor.select(newShapeId);
        },
      }),
      [createNewCell, focusCell, runCells, setLayout]
    );

    // Get selected cell shape IDs
    const getSelectedCellShapeIds = useCallback((): TLShapeId[] => {
      const editor = editorRef.current;
      if (!editor) return [];

      return editor
        .getSelectedShapeIds()
        .filter((id) => {
          const shape = editor.getShape(id);
          return shape?.type === "cell";
        });
    }, []);

    // Layout operations
    const handleLayoutVertical = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      layoutShapesVertically(editor, getSelectedCellShapeIds());
      const positions = extractPositions(editor, cellShapeIdsRef.current);
      setLayout({ cells: positions });
    }, [getSelectedCellShapeIds, setLayout]);

    const handleLayoutHorizontal = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      layoutShapesHorizontally(editor, getSelectedCellShapeIds());
      const positions = extractPositions(editor, cellShapeIdsRef.current);
      setLayout({ cells: positions });
    }, [getSelectedCellShapeIds, setLayout]);

    const handleLayoutByDependencyVertical = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      layoutShapesByDependency(
        editor,
        getSelectedCellShapeIds(),
        variables,
        cellShapeIdsRef.current,
        { direction: "TB" }
      );
      const positions = extractPositions(editor, cellShapeIdsRef.current);
      setLayout({ cells: positions });
    }, [getSelectedCellShapeIds, setLayout, variables]);

    const handleLayoutByDependencyHorizontal = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      layoutShapesByDependency(
        editor,
        getSelectedCellShapeIds(),
        variables,
        cellShapeIdsRef.current,
        { direction: "LR" }
      );
      const positions = extractPositions(editor, cellShapeIdsRef.current);
      setLayout({ cells: positions });
    }, [getSelectedCellShapeIds, setLayout, variables]);

    const handleAlignLeft = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      alignShapesLeft(editor, getSelectedCellShapeIds());
      const positions = extractPositions(editor, cellShapeIdsRef.current);
      setLayout({ cells: positions });
    }, [getSelectedCellShapeIds, setLayout]);

    const handleAlignTop = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      alignShapesTop(editor, getSelectedCellShapeIds());
      const positions = extractPositions(editor, cellShapeIdsRef.current);
      setLayout({ cells: positions });
    }, [getSelectedCellShapeIds, setLayout]);

    const handleZoomIn = useCallback(() => {
      editorRef.current?.zoomIn();
    }, []);

    const handleZoomOut = useCallback(() => {
      editorRef.current?.zoomOut();
    }, []);

    const handleZoomToFit = useCallback(() => {
      editorRef.current?.zoomToFit({ animation: { duration: 200 } });
    }, []);

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

        // Listen for selection changes
        const handleSelectionChange = () => {
          const selectedIds = editor.getSelectedShapeIds();
          const cellCount = selectedIds.filter((id) => {
            const shape = editor.getShape(id);
            return shape?.type === "cell";
          }).length;
          setSelectedCount(cellCount);
        };

        // Listen for shape changes to update layout
        const handleChange = () => {
          const positions = extractPositions(editor, cellShapeIdsRef.current);
          if (hasPositionsChanged(layout.cells, positions)) {
            setLayout({ cells: positions });
          }
        };

        // Subscribe to store changes
        const unsubscribe = editor.store.listen(
          (entry) => {
            handleChange();
            if (entry.changes.updated) {
              handleSelectionChange();
            }
          },
          { source: "user", scope: "document" }
        );

        // Initial selection count
        handleSelectionChange();

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
              "w-full h-full relative",
              isReadMode && "pointer-events-none"
            )}
          >
            {!isReadMode && (
              <CanvasToolbar
                selectedCount={selectedCount}
                onLayoutVertical={handleLayoutVertical}
                onLayoutHorizontal={handleLayoutHorizontal}
                onLayoutByDependencyVertical={handleLayoutByDependencyVertical}
                onLayoutByDependencyHorizontal={handleLayoutByDependencyHorizontal}
                onAlignLeft={handleAlignLeft}
                onAlignTop={handleAlignTop}
                onZoomIn={handleZoomIn}
                onZoomOut={handleZoomOut}
                onZoomToFit={handleZoomToFit}
              />
            )}
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
  let currentY = 50;
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
