/* Copyright 2024 Marimo. All rights reserved. */

import {
  ChevronDownIcon,
  ChevronUpIcon,
  PlayIcon,
  PlusIcon,
} from "lucide-react";
import React, { memo, useState } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  type RecordProps,
  resizeBox,
  T,
  type TLBaseShape,
  type TLResizeInfo,
} from "tldraw";
import { TinyCode } from "@/components/editor/cell/TinyCode";
import { OutputArea } from "@/components/editor/Output";
import { outputIsLoading, outputIsStale } from "@/core/cells/cell";
import type { CellId } from "@/core/cells/ids";
import type { CellData, CellRuntimeState } from "@/core/cells/types";
import { cn } from "@/utils/cn";
import { DEFAULT_CELL_HEIGHT, DEFAULT_CELL_WIDTH } from "./types";

/**
 * Custom shape props for a marimo cell on the canvas.
 */
export interface CellShapeProps {
  w: number;
  h: number;
  cellId: CellId;
}

/**
 * The TLDraw shape type for marimo cells.
 */
export type CellShape = TLBaseShape<"cell", CellShapeProps>;

/**
 * Props for rendering the cell content.
 */
export interface CellContentProps {
  cell: CellRuntimeState & CellData;
  isSelected: boolean;
}

/**
 * Context for providing cell data to the shape component.
 */
export const CellDataContext = React.createContext<
  Map<CellId, CellRuntimeState & CellData>
>(new Map());

/**
 * Direction for adding a new cell relative to an existing cell.
 */
export type AddCellDirection = "above" | "below" | "left" | "right";

/**
 * Context for providing cell actions.
 */
export interface CanvasCellActions {
  onRun: (cellId: CellId) => void;
  onDelete: (cellId: CellId) => void;
  onFocus: (cellId: CellId) => void;
  onAddCell: (cellId: CellId, direction: AddCellDirection) => void;
}

export const CellActionsContext = React.createContext<CanvasCellActions>({
  onRun: () => {
    // noop
  },
  onDelete: () => {
    // noop
  },
  onFocus: () => {
    // noop
  },
  onAddCell: () => {
    // noop
  },
});

/**
 * Context for read mode state (app view vs edit view).
 */
export const ReadModeContext = React.createContext<boolean>(false);

/**
 * Shape utility for rendering marimo cells in TLDraw canvas.
 */
export class CellShapeUtil extends BaseBoxShapeUtil<CellShape> {
  static override type = "cell" as const;

  static override props: RecordProps<CellShape> = {
    w: T.number,
    h: T.number,
    cellId: T.string as unknown as T.Validator<CellId>,
  };

  override getDefaultProps(): CellShapeProps {
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
    return false; // Editing happens through the cell's own UI
  }

  override canSnap(): boolean {
    return true;
  }

  override onResize(shape: CellShape, info: TLResizeInfo<CellShape>) {
    return resizeBox(shape, info);
  }

  override component(shape: CellShape) {
    return (
      <HTMLContainer
        id={shape.id}
        style={{
          pointerEvents: "all",
          width: shape.props.w,
          height: shape.props.h,
        }}
      >
        <CellShapeContent
          cellId={shape.props.cellId}
          width={shape.props.w}
          height={shape.props.h}
          isSelected={this.editor.getSelectedShapeIds().includes(shape.id)}
        />
      </HTMLContainer>
    );
  }

  override indicator(shape: CellShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} ry={8} />;
  }
}

/**
 * Add cell button component for the cell shape.
 */
const AddCellButton: React.FC<{
  position: AddCellDirection;
  onClick: () => void;
}> = memo(({ position, onClick }) => {
  const positionStyles: Record<AddCellDirection, string> = {
    above: "top-0 left-1/2 -translate-x-1/2 -translate-y-full pb-1",
    below: "bottom-0 left-1/2 -translate-x-1/2 translate-y-full pt-1",
    left: "left-0 top-1/2 -translate-x-full -translate-y-1/2 pr-1",
    right: "right-0 top-1/2 translate-x-full -translate-y-1/2 pl-1",
  };

  return (
    <div className={cn("absolute z-10", positionStyles[position])}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={cn(
          "flex items-center justify-center",
          "w-5 h-5 rounded-full",
          "bg-primary/80 hover:bg-primary text-primary-foreground",
          "shadow-sm hover:shadow-md transition-all",
          "opacity-0 group-hover:opacity-100",
          "hover:scale-110",
        )}
        title={`Add cell ${position}`}
      >
        <PlusIcon className="w-3 h-3" strokeWidth={3} />
      </button>
    </div>
  );
});
AddCellButton.displayName = "AddCellButton";

/**
 * The inner content of a cell shape that renders the actual cell.
 */
const CellShapeContent: React.FC<{
  cellId: CellId;
  width: number;
  height: number;
  isSelected: boolean;
}> = memo(({ cellId, width, height, isSelected }) => {
  const cellDataMap = React.useContext(CellDataContext);
  const actions = React.useContext(CellActionsContext);
  const isReadMode = React.useContext(ReadModeContext);
  const cell = cellDataMap.get(cellId);
  const [isCodeCollapsed, setIsCodeCollapsed] = useState(false);

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

  const outputStale = outputIsStale(
    {
      status: cell.status,
      output: cell.output,
      interrupted: cell.interrupted,
      runStartTimestamp: cell.runStartTimestamp,
      staleInputs: cell.staleInputs,
    },
    false,
  );
  const loading = outputIsLoading(cell.status);
  const hasOutput = cell.output !== null && cell.output.data !== "";
  const hasError = cell.errored || cell.interrupted || cell.stopped;

  return (
    <div
      className={cn(
        "group relative flex flex-col bg-background border rounded-lg overflow-visible h-full shadow-sm transition-shadow",
        isSelected && "ring-2 ring-primary shadow-md",
        hasError && "border-destructive",
        cell.staleInputs && "border-warning",
      )}
      style={{ width, height }}
    >
      {/* Add cell buttons - only in edit mode */}
      {!isReadMode && (
        <>
          <AddCellButton
            position="above"
            onClick={() => actions.onAddCell(cellId, "above")}
          />
          <AddCellButton
            position="below"
            onClick={() => actions.onAddCell(cellId, "below")}
          />
          <AddCellButton
            position="left"
            onClick={() => actions.onAddCell(cellId, "left")}
          />
          <AddCellButton
            position="right"
            onClick={() => actions.onAddCell(cellId, "right")}
          />
        </>
      )}

      {/* Cell content wrapper with overflow hidden */}
      <div className="flex flex-col h-full overflow-hidden rounded-lg">
        {/* Cell Header - minimal in read mode */}
        <div
          className={cn(
            "flex items-center justify-between px-3 shrink-0",
            isReadMode ? "py-1" : "py-1.5 border-b bg-muted/30",
          )}
        >
          <div className="flex items-center gap-2">
            {/* Code toggle - only in edit mode */}
            {!isReadMode && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsCodeCollapsed(!isCodeCollapsed);
                }}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {isCodeCollapsed ? (
                  <ChevronDownIcon className="w-4 h-4" />
                ) : (
                  <ChevronUpIcon className="w-4 h-4" />
                )}
              </button>
            )}
            {/* Only show cell name if it has a custom name */}
            {cell.name && (
              <span className="text-xs font-medium text-muted-foreground">
                {cell.name}
              </span>
            )}
            {cell.status === "running" && (
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            )}
            {cell.status === "queued" && (
              <span className="w-2 h-2 bg-yellow-500 rounded-full" />
            )}
            {!isReadMode && cell.staleInputs && (
              <span className="text-xs text-warning">stale</span>
            )}
          </div>
          {/* Run button - only in edit mode */}
          {!isReadMode && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="flex items-center gap-1 text-xs px-2 py-0.5 bg-primary/10 hover:bg-primary/20 text-primary rounded transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  actions.onRun(cellId);
                }}
              >
                <PlayIcon className="w-3 h-3" />
                Run
              </button>
            </div>
          )}
        </div>

        {/* Code Section - only in edit mode */}
        {!isReadMode && !isCodeCollapsed && (
          <div
            className="flex-none border-b overflow-hidden cursor-pointer"
            style={{ maxHeight: Math.min(150, height * 0.4) }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              actions.onFocus(cellId);
            }}
          >
            <TinyCode code={cell.code} className="p-2" />
          </div>
        )}

        {/* Output Area */}
        <div className="flex-1 overflow-auto min-h-0 p-2">
          {hasOutput ? (
            <OutputArea
              allowExpand={false}
              output={cell.output}
              cellId={cellId}
              stale={outputStale}
              loading={loading}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
              {cell.status === "running" ? (
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  Running...
                </span>
              ) : (
                "No output"
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

CellShapeContent.displayName = "CellShapeContent";
