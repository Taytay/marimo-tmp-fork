/* Copyright 2024 Marimo. All rights reserved. */

import React, { memo } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type TLBaseShape,
  type RecordProps,
  type TLResizeInfo,
  resizeBox,
} from "tldraw";
import type { CellId } from "@/core/cells/ids";
import type { CellData, CellRuntimeState } from "@/core/cells/types";
import { OutputArea } from "@/components/editor/Output";
import { TinyCode } from "@/components/editor/cell/TinyCode";
import { outputIsLoading, outputIsStale } from "@/core/cells/cell";
import { cn } from "@/utils/cn";
import {
  DEFAULT_CELL_WIDTH,
  DEFAULT_CELL_HEIGHT,
} from "./types";

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
 * Context for providing cell actions.
 */
export interface CellActions {
  onRun: (cellId: CellId) => void;
  onFocus: (cellId: CellId) => void;
}

export const CellActionsContext = React.createContext<CellActions>({
  onRun: () => {},
  onFocus: () => {},
});

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
    return (
      <rect
        width={shape.props.w}
        height={shape.props.h}
        rx={8}
        ry={8}
      />
    );
  }
}

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

  const outputStale = outputIsStale(
    {
      status: cell.status,
      output: cell.output,
      interrupted: cell.interrupted,
      runStartTimestamp: cell.runStartTimestamp,
      staleInputs: cell.staleInputs,
    },
    false
  );
  const loading = outputIsLoading(cell.status);
  const hasOutput = cell.output !== null && cell.output.data !== "";
  const hasError = cell.errored || cell.interrupted || cell.stopped;

  return (
    <div
      className={cn(
        "flex flex-col bg-background border rounded-lg overflow-hidden h-full shadow-sm transition-shadow",
        isSelected && "ring-2 ring-primary shadow-md",
        hasError && "border-destructive",
        cell.staleInputs && "border-warning"
      )}
      style={{ width, height }}
      onDoubleClick={() => actions.onFocus(cellId)}
    >
      {/* Cell Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {cell.name || `Cell`}
          </span>
          {cell.status === "running" && (
            <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
          )}
          {cell.status === "queued" && (
            <span className="w-2 h-2 bg-yellow-500 rounded-full" />
          )}
        </div>
        <button
          type="button"
          className="text-xs px-2 py-0.5 bg-primary/10 hover:bg-primary/20 text-primary rounded transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            actions.onRun(cellId);
          }}
        >
          Run
        </button>
      </div>

      {/* Code Preview */}
      <div className="flex-none border-b max-h-[120px] overflow-hidden">
        <TinyCode code={cell.code} className="p-2" />
      </div>

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
            {cell.status === "running" ? "Running..." : "No output"}
          </div>
        )}
      </div>
    </div>
  );
});

CellShapeContent.displayName = "CellShapeContent";
