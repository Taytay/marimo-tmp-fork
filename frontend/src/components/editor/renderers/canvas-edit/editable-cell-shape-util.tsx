/* Copyright 2024 Marimo. All rights reserved. */

import { GripVerticalIcon, PlusIcon } from "lucide-react";
import React, { memo } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  type RecordProps,
  resizeBox,
  T,
  type TLBaseShape,
  type TLResizeInfo,
} from "tldraw";
import type { CellId } from "@/core/cells/ids";
import type { CellData, CellRuntimeState } from "@/core/cells/types";
import type { UserConfig } from "@/core/config/config-schema";
import type { Theme } from "@/theme/useTheme";
import { cn } from "@/utils/cn";
import { DEFAULT_CELL_HEIGHT, DEFAULT_CELL_WIDTH } from "./types";

/**
 * Custom shape props for an editable marimo cell on the canvas.
 */
export interface EditableCellShapeProps {
  w: number;
  h: number;
  cellId: CellId;
}

/**
 * The TLDraw shape type for editable marimo cells.
 */
export type EditableCellShape = TLBaseShape<"editable-cell", EditableCellShapeProps>;

/**
 * Context for providing cell data to the shape component.
 */
export const CellDataContext = React.createContext<
  Map<CellId, CellRuntimeState & CellData>
>(new Map());

/**
 * Context for providing user config to the shape component.
 */
export const UserConfigContext = React.createContext<UserConfig | null>(null);

/**
 * Context for providing theme to the shape component.
 */
export const ThemeContext = React.createContext<Theme>("light");

/**
 * Context for the cell render function.
 */
export interface CellRenderContext {
  renderCell: (cellId: CellId) => React.ReactNode;
}

export const CellRenderContext = React.createContext<CellRenderContext>({
  renderCell: () => null,
});

/**
 * Context for canvas-specific cell actions.
 */
export interface CanvasCellActionsContext {
  onStartDrag: (cellId: CellId, shapeId: string) => void;
  onAddCellAbove: (cellId: CellId) => void;
  onAddCellBelow: (cellId: CellId) => void;
  getSelectedCount: () => number;
  onCellHover: (isHovered: boolean) => void;
}

export const CanvasCellActionsContext = React.createContext<CanvasCellActionsContext>({
  onStartDrag: () => {
    // Default no-op, will be overridden by provider
  },
  onAddCellAbove: () => {
    // Default no-op
  },
  onAddCellBelow: () => {
    // Default no-op
  },
  getSelectedCount: () => 0,
  onCellHover: () => {
    // Default no-op
  },
});

/**
 * Shape utility for rendering editable marimo cells in TLDraw canvas.
 *
 * Key design decisions:
 * - Single selection: cells are interactive (pointer events enabled)
 * - Multi-selection: cells become draggable (TLDraw handles events)
 * - Users can also grab the drag handle to move individual cells
 */
export class EditableCellShapeUtil extends BaseBoxShapeUtil<EditableCellShape> {
  static override type = "editable-cell" as const;

  static override props: RecordProps<EditableCellShape> = {
    w: T.number,
    h: T.number,
    cellId: T.string as unknown as T.Validator<CellId>,
  };

  override getDefaultProps(): EditableCellShapeProps {
    return {
      w: DEFAULT_CELL_WIDTH,
      h: DEFAULT_CELL_HEIGHT,
      cellId: "" as CellId,
    };
  }

  override canResize(): boolean {
    return true;
  }

  override canBind(): boolean {
    return true;
  }

  override canEdit(): boolean {
    // We don't use TLDraw's edit mode - cells are always editable when single-selected
    return false;
  }

  override canSnap(): boolean {
    return true;
  }

  override onResize(shape: EditableCellShape, info: TLResizeInfo<EditableCellShape>) {
    return resizeBox(shape, info);
  }

  override component(shape: EditableCellShape) {
    const isSelected = this.editor.getSelectedShapeIds().includes(shape.id);
    const selectedCount = this.editor.getSelectedShapeIds().length;
    // When multiple shapes are selected, we want TLDraw to handle drag
    const isMultiSelected = selectedCount > 1 && isSelected;

    return (
      <HTMLContainer
        id={shape.id}
        style={{
          // Enable pointer events for single selection (editing)
          // Disable for multi-selection (TLDraw handles drag)
          pointerEvents: isMultiSelected ? "none" : "all",
          width: shape.props.w,
          height: shape.props.h,
          // Allow content to overflow for add-cell buttons
          overflow: "visible",
        }}
      >
        <EditableCellShapeContent
          shapeId={shape.id}
          cellId={shape.props.cellId}
          width={shape.props.w}
          height={shape.props.h}
          isSelected={isSelected}
          isMultiSelected={isMultiSelected}
        />
      </HTMLContainer>
    );
  }

  override indicator(shape: EditableCellShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} ry={8} />;
  }
}

/**
 * The inner content of an editable cell shape.
 * This component renders the actual cell using the provided render function.
 */
const EditableCellShapeContent: React.FC<{
  shapeId: string;
  cellId: CellId;
  width: number;
  height: number;
  isSelected: boolean;
  isMultiSelected: boolean;
}> = memo(({ shapeId, cellId, width, height, isSelected, isMultiSelected }) => {
  const { renderCell } = React.useContext(CellRenderContext);
  const { onStartDrag, onAddCellAbove, onAddCellBelow, onCellHover } = React.useContext(CanvasCellActionsContext);
  const cellDataMap = React.useContext(CellDataContext);
  const cell = cellDataMap.get(cellId);

  if (!cell) {
    return (
      <div
        className="flex items-center justify-center bg-muted border border-border rounded-lg h-full"
        style={{ width, height }}
      >
        <span className="text-muted-foreground text-sm">
          Cell not found: {cellId}
        </span>
      </div>
    );
  }

  // Check if cell needs to be re-run (stale)
  const isStale = cell.staleInputs;

  return (
    <div
      className={cn(
        "relative bg-background rounded-lg h-full transition-shadow group/canvas-cell",
        // Yellow border for stale cells
        isStale && "ring-2 ring-yellow-500",
        // Blue ring for selected (non-stale)
        isSelected && !isStale && "ring-2 ring-primary shadow-md",
        // Show multi-select state
        isMultiSelected && "opacity-90",
      )}
      style={{ width, height, overflow: "visible" }}
      // Stop propagation to prevent TLDraw from handling clicks inside the cell
      // UNLESS we're in multi-select mode
      onPointerDown={(e) => {
        if (isMultiSelected) {
          // Let TLDraw handle for drag
          return;
        }
        // Allow the drag handle and add-cell buttons to work
        if (
          (e.target as HTMLElement).closest('[data-drag-handle]') ||
          (e.target as HTMLElement).closest('[data-add-cell-button]')
        ) {
          return;
        }
        // Stop propagation for everything else so TLDraw doesn't select/drag
        e.stopPropagation();
      }}
      // Track hover state for arrow animations
      onMouseEnter={() => onCellHover(true)}
      onMouseLeave={() => onCellHover(false)}
    >
      {/* Add cell button - ABOVE (outside shape bounds) */}
      <div
        data-add-cell-button
        className={cn(
          "absolute -top-8 left-1/2 -translate-x-1/2 z-20",
          "opacity-0 group-hover/canvas-cell:opacity-100 transition-opacity",
        )}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAddCellAbove(cellId);
          }}
          className={cn(
            "flex items-center justify-center",
            "w-6 h-6 rounded-full",
            "bg-green-500/80 hover:bg-green-500 text-white",
            "shadow-sm hover:shadow-md transition-all",
            "hover:scale-110",
          )}
          title="Add cell above"
        >
          <PlusIcon className="w-4 h-4" strokeWidth={2.5} />
        </button>
      </div>

      {/* Add cell button - BELOW (outside shape bounds) */}
      <div
        data-add-cell-button
        className={cn(
          "absolute -bottom-8 left-1/2 -translate-x-1/2 z-20",
          "opacity-0 group-hover/canvas-cell:opacity-100 transition-opacity",
        )}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAddCellBelow(cellId);
          }}
          className={cn(
            "flex items-center justify-center",
            "w-6 h-6 rounded-full",
            "bg-green-500/80 hover:bg-green-500 text-white",
            "shadow-sm hover:shadow-md transition-all",
            "hover:scale-110",
          )}
          title="Add cell below"
        >
          <PlusIcon className="w-4 h-4" strokeWidth={2.5} />
        </button>
      </div>

      {/* Drag handle - positioned on the left side */}
      <div
        data-drag-handle
        className={cn(
          "absolute -left-7 top-1/2 -translate-y-1/2 z-20",
          "cursor-grab active:cursor-grabbing",
          "p-1.5 rounded bg-muted/80 hover:bg-muted border border-border",
          "opacity-0 group-hover/canvas-cell:opacity-100 transition-opacity",
          isSelected && "opacity-100",
        )}
        onPointerDown={() => {
          // Let this event propagate to TLDraw for dragging
          onStartDrag(cellId, shapeId);
        }}
        title="Drag to move cell"
      >
        <GripVerticalIcon className="w-4 h-4 text-muted-foreground" />
      </div>

      {/* Stale indicator badge */}
      {isStale && (
        <div className="absolute top-2 right-2 z-10 px-2 py-0.5 bg-yellow-500 text-yellow-950 text-xs font-medium rounded">
          Stale
        </div>
      )}

      {/* Multi-select overlay */}
      {isMultiSelected && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/10 pointer-events-none rounded-lg">
          <span className="text-sm text-primary bg-background/90 px-3 py-1.5 rounded-md shadow-sm">
            Drag to move
          </span>
        </div>
      )}

      {/* Render the actual cell component */}
      <div className="h-full overflow-auto rounded-lg">
        {renderCell(cellId)}
      </div>
    </div>
  );
});

EditableCellShapeContent.displayName = "EditableCellShapeContent";
