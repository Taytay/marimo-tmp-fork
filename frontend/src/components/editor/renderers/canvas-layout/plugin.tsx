/* Copyright 2024 Marimo. All rights reserved. */

import { z } from "zod";
import type { CellId } from "@/core/cells/ids";
import { Logger } from "@/utils/Logger";
import type { ICellRendererPlugin } from "../types";
import { CanvasLayoutRenderer } from "./canvas-layout";
import type {
  CanvasCellPosition,
  CanvasLayout,
  SerializedCanvasLayout,
  SerializedCanvasLayoutCell,
} from "./types";
import { CELL_SPACING, DEFAULT_CELL_HEIGHT, DEFAULT_CELL_WIDTH } from "./types";

/**
 * Plugin definition for the canvas layout.
 */
export const CanvasLayoutPlugin: ICellRendererPlugin<
  SerializedCanvasLayout,
  CanvasLayout
> = {
  type: "canvas",
  name: "Canvas",

  validator: z.object({
    cells: z.array(
      z.object({
        position: z
          .tuple([z.number(), z.number(), z.number(), z.number()])
          .nullable(),
      }),
    ),
  }),

  deserializeLayout: (serialized, cells): CanvasLayout => {
    if (serialized.cells.length === 0) {
      return {
        cells: [],
      };
    }

    if (serialized.cells.length !== cells.length) {
      Logger.warn(
        "Number of cells in canvas layout does not match number of cells in notebook",
      );
    }

    const cellPositions: CanvasCellPosition[] = [];

    for (let idx = 0; idx < serialized.cells.length; idx++) {
      const cellLayout = serialized.cells[idx];
      const cell = cells[idx];

      if (!cell) {
        continue;
      }

      if (cellLayout.position) {
        cellPositions.push({
          cellId: cell.id,
          x: cellLayout.position[0],
          y: cellLayout.position[1],
          width: cellLayout.position[2],
          height: cellLayout.position[3],
        });
      }
    }

    return {
      cells: cellPositions,
    };
  },

  serializeLayout: (layout, cells): SerializedCanvasLayout => {
    const positionMap = new Map<CellId, CanvasCellPosition>();
    for (const pos of layout.cells) {
      positionMap.set(pos.cellId, pos);
    }

    const serializedCells: SerializedCanvasLayoutCell[] = cells.map((cell) => {
      const cellPosition = positionMap.get(cell.id);
      if (!cellPosition) {
        return {
          position: null,
        };
      }
      return {
        position: [
          cellPosition.x,
          cellPosition.y,
          cellPosition.width,
          cellPosition.height,
        ],
      };
    });

    return {
      cells: serializedCells,
    };
  },

  Component: CanvasLayoutRenderer,

  getInitialLayout: (cells): CanvasLayout => {
    // Create a vertical layout as the initial layout
    const cellPositions: CanvasCellPosition[] = [];
    let currentY = 50;

    for (const cell of cells) {
      cellPositions.push({
        cellId: cell.id,
        x: 100,
        y: currentY,
        width: DEFAULT_CELL_WIDTH,
        height: DEFAULT_CELL_HEIGHT,
      });
      currentY += DEFAULT_CELL_HEIGHT + CELL_SPACING;
    }

    return {
      cells: cellPositions,
    };
  },
};
