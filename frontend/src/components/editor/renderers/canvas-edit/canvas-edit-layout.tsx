/* Copyright 2024 Marimo. All rights reserved. */

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createShapeId, type Editor, type TLShapeId, Tldraw } from "tldraw";
import "tldraw/tldraw.css";

import { Cell } from "@/components/editor/notebook-cell";
import type { CellId } from "@/core/cells/ids";
import { useCellActions } from "@/core/cells/cells";
import type { CellData, CellRuntimeState } from "@/core/cells/types";
import type { AppConfig, UserConfig } from "@/core/config/config-schema";
import type { AppMode } from "@/core/mode";
import type { Theme } from "@/theme/useTheme";
import type { Variables } from "@/core/variables/types";
import { cn } from "@/utils/cn";
import {
  CanvasCellActionsContext,
  CellDataContext,
  CellRenderContext,
  EditableCellShapeUtil,
  ThemeContext,
  UserConfigContext,
} from "./editable-cell-shape-util";
import {
  type CanvasCellPosition,
  type CanvasEditLayoutState,
  CELL_SPACING,
  DEFAULT_CELL_HEIGHT,
  DEFAULT_CELL_WIDTH,
} from "./types";
import { updateDependencyArrows } from "../canvas-layout/dependency-arrows";
import { CanvasToolbar } from "../canvas-layout/canvas-toolbar";
import {
  alignShapesLeft,
  alignShapesTop,
  layoutShapesByDependency,
  layoutShapesHorizontally,
  layoutShapesVertically,
} from "../canvas-layout/layout-utils";

import "./styles.css";

// Custom shape utils array - must be defined outside component
const customShapeUtils = [EditableCellShapeUtil];

interface CanvasEditLayoutProps {
  cells: (CellRuntimeState & CellData)[];
  mode: AppMode;
  userConfig: UserConfig;
  appConfig: AppConfig;
  theme: Theme;
  variables: Variables;
}

/**
 * Canvas Edit Layout Renderer using TLDraw.
 *
 * Renders notebook cells as draggable, editable shapes on an infinite canvas.
 * Cells are always interactive - use the drag handle to reposition them.
 */
export const CanvasEditLayout: React.FC<CanvasEditLayoutProps> = memo(
  ({ cells, mode, userConfig, appConfig, theme, variables }) => {
    const editorRef = useRef<Editor | null>(null);
    const cellShapeIdsRef = useRef<Map<CellId, TLShapeId>>(new Map());
    const isInitializedRef = useRef(false);
    const [layout, setLayout] = useState<CanvasEditLayoutState>({ cells: [] });
    const [selectedCount, setSelectedCount] = useState(0);
    const [hasActiveCell, setHasActiveCell] = useState(false);

    // Get cell actions for adding new cells
    const { createNewCell } = useCellActions();

    // Create a map of cell data for the context
    const cellDataMap = useMemo(() => {
      const map = new Map<CellId, CellRuntimeState & CellData>();
      for (const cell of cells) {
        map.set(cell.id, cell);
      }
      return map;
    }, [cells]);

    // Function to render a cell - passed via context to the shape
    const renderCell = useCallback(
      (cellId: CellId): React.ReactNode => {
        const cell = cellDataMap.get(cellId);
        if (!cell) {
          return null;
        }

        // Render the full Cell component with all editing features
        return (
          <Cell
            cellId={cellId}
            theme={theme}
            showPlaceholder={false}
            canDelete={cells.length > 1}
            mode={mode}
            userConfig={userConfig}
            isCollapsed={false}
            collapseCount={0}
            canMoveX={false}
          />
        );
      },
      [cellDataMap, cells.length, mode, theme, userConfig]
    );

    const cellRenderContext = useMemo(
      () => ({ renderCell }),
      [renderCell]
    );

    // Canvas cell actions context
    const canvasCellActions = useMemo(
      () => ({
        onStartDrag: (cellId: CellId, shapeId: string) => {
          // Select the shape when drag handle is used
          const editor = editorRef.current;
          if (editor) {
            editor.select(shapeId as TLShapeId);
          }
        },
        onAddCellAbove: (cellId: CellId) => {
          createNewCell({ cellId, before: true });
        },
        onAddCellBelow: (cellId: CellId) => {
          createNewCell({ cellId, before: false });
        },
        getSelectedCount: () => {
          const editor = editorRef.current;
          return editor ? editor.getSelectedShapeIds().length : 0;
        },
        onCellHover: (isHovered: boolean) => {
          setHasActiveCell(isHovered);
        },
      }),
      [createNewCell]
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

        // Update dependency arrows (clears existing and creates new ones, then sends to back)
        updateDependencyArrows(editor, variables, cellShapeIdsRef.current);

        // Bring cell shapes to front so they render above arrows
        const cellShapeIds = Array.from(cellShapeIdsRef.current.values());
        if (cellShapeIds.length > 0) {
          editor.bringToFront(cellShapeIds);
        }

        // Listen for shape changes to update layout
        const handleChange = () => {
          const positions = extractPositions(editor, cellShapeIdsRef.current);
          if (hasPositionsChanged(layout.cells, positions)) {
            setLayout({ cells: positions });
          }
        };

        // Subscribe to document changes (shape positions, etc.)
        const unsubscribeDoc = editor.store.listen(
          () => {
            handleChange();
          },
          { source: "user", scope: "document" }
        );

        // Subscribe to selection changes
        const unsubscribeSelection = editor.store.listen(
          () => {
            const selectedIds = editor.getSelectedShapeIds();
            // Only count cell shapes
            const cellCount = selectedIds.filter((id) => {
              const shape = editor.getShape(id);
              return shape?.type === "editable-cell";
            }).length;
            setSelectedCount(cellCount);
          },
          { source: "user", scope: "session" }
        );

        return () => {
          unsubscribeDoc();
          unsubscribeSelection();
        };
      },
      [cells, layout, variables]
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

      // Bring cell shapes to front so they render above arrows
      const cellShapeIds = Array.from(cellShapeIdsRef.current.values());
      if (cellShapeIds.length > 0) {
        editor.bringToFront(cellShapeIds);
      }
    }, [variables]);

    // Toolbar handlers
    const handleLayoutVertical = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const selectedIds = editor.getSelectedShapeIds();
      layoutShapesVertically(editor, selectedIds);
      updateDependencyArrows(editor, variables, cellShapeIdsRef.current);
    }, [variables]);

    const handleLayoutHorizontal = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const selectedIds = editor.getSelectedShapeIds();
      layoutShapesHorizontally(editor, selectedIds);
      updateDependencyArrows(editor, variables, cellShapeIdsRef.current);
    }, [variables]);

    const handleLayoutByDependencyVertical = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const selectedIds = editor.getSelectedShapeIds();
      layoutShapesByDependency(editor, selectedIds, variables, cellShapeIdsRef.current, { direction: "TB" });
      updateDependencyArrows(editor, variables, cellShapeIdsRef.current);
    }, [variables]);

    const handleLayoutByDependencyHorizontal = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const selectedIds = editor.getSelectedShapeIds();
      layoutShapesByDependency(editor, selectedIds, variables, cellShapeIdsRef.current, { direction: "LR" });
      updateDependencyArrows(editor, variables, cellShapeIdsRef.current);
    }, [variables]);

    const handleAlignLeft = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const selectedIds = editor.getSelectedShapeIds();
      alignShapesLeft(editor, selectedIds);
      updateDependencyArrows(editor, variables, cellShapeIdsRef.current);
    }, [variables]);

    const handleAlignTop = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const selectedIds = editor.getSelectedShapeIds();
      alignShapesTop(editor, selectedIds);
      updateDependencyArrows(editor, variables, cellShapeIdsRef.current);
    }, [variables]);

    const handleZoomIn = useCallback(() => {
      editorRef.current?.zoomIn();
    }, []);

    const handleZoomOut = useCallback(() => {
      editorRef.current?.zoomOut();
    }, []);

    const handleZoomToFit = useCallback(() => {
      editorRef.current?.zoomToFit({ animation: { duration: 200 } });
    }, []);

    return (
      <CellDataContext.Provider value={cellDataMap}>
        <UserConfigContext.Provider value={userConfig}>
          <ThemeContext.Provider value={theme}>
            <CellRenderContext.Provider value={cellRenderContext}>
              <CanvasCellActionsContext.Provider value={canvasCellActions}>
                <div
                  className={cn(
                    "canvas-edit-container",
                    "w-full h-full relative",
                    // Fill the available space
                    "min-h-[calc(100vh-100px)]",
                    // Add class when cells are hovered or selected for arrow animations
                    (hasActiveCell || selectedCount > 0) && "has-active-cell",
                  )}
                >
                  <Tldraw
                    shapeUtils={customShapeUtils}
                    onMount={handleMount}
                    inferDarkMode={true}
                  />
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
                </div>
              </CanvasCellActionsContext.Provider>
            </CellRenderContext.Provider>
          </ThemeContext.Provider>
        </UserConfigContext.Provider>
      </CellDataContext.Provider>
    );
  }
);

CanvasEditLayout.displayName = "CanvasEditLayout";

/**
 * Initialize cell shapes on the canvas.
 */
function initializeCellShapes(
  editor: Editor,
  cells: (CellRuntimeState & CellData)[],
  layout: CanvasEditLayoutState,
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
      type: "editable-cell",
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
 * Adds new cells, removes deleted cells.
 */
function syncCellShapes(
  editor: Editor,
  cells: (CellRuntimeState & CellData)[],
  layout: CanvasEditLayoutState,
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
        type: "editable-cell",
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
    if (shape && shape.type === "editable-cell") {
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
