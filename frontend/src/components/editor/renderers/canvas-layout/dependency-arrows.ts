/* Copyright 2024 Marimo. All rights reserved. */

import {
  createShapeId,
  type Editor,
  type TLArrowBinding,
  type TLShapeId,
} from "tldraw";
import type { CellId } from "@/core/cells/ids";
import type { Variables } from "@/core/variables/types";

/**
 * Creates dependency arrows between cell shapes based on variable dependencies.
 *
 * @param editor - The TLDraw editor instance
 * @param variables - Variable dependency information from the kernel
 * @param cellShapeIds - Map from CellId to TLDraw shape ID
 */
export function createDependencyArrows(
  editor: Editor,
  variables: Variables,
  cellShapeIds: Map<CellId, TLShapeId>,
): void {
  const visited = new Set<string>();
  const arrowsToCreate: {
    fromShapeId: TLShapeId;
    toShapeId: TLShapeId;
    variableName: string;
  }[] = [];

  for (const variable of Object.values(variables)) {
    // Skip marimo module (likely every cell uses it)
    if (variable.name === "mo" && variable.value === "marimo") {
      continue;
    }

    const { declaredBy, usedBy } = variable;

    for (const fromId of declaredBy) {
      for (const toId of usedBy) {
        // Skip self-references
        if (fromId === toId) {
          continue;
        }

        const key = `${fromId}-${toId}`;
        if (visited.has(key)) {
          continue;
        }
        visited.add(key);

        const fromShapeId = cellShapeIds.get(fromId);
        const toShapeId = cellShapeIds.get(toId);

        if (fromShapeId && toShapeId) {
          arrowsToCreate.push({
            fromShapeId,
            toShapeId,
            variableName: variable.name,
          });
        }
      }
    }
  }

  // Batch create all arrows
  const arrowIds: TLShapeId[] = [];
  for (const { fromShapeId, toShapeId } of arrowsToCreate) {
    const arrowId = createArrowBetweenShapes(editor, fromShapeId, toShapeId);
    arrowIds.push(arrowId);
  }

  // Send all arrows to the back so they render behind cells
  if (arrowIds.length > 0) {
    editor.sendToBack(arrowIds);
  }
}

/**
 * Creates an arrow shape connecting two shapes.
 *
 * @param editor - The TLDraw editor instance
 * @param startShapeId - The source shape ID
 * @param endShapeId - The target shape ID
 */
export function createArrowBetweenShapes(
  editor: Editor,
  startShapeId: TLShapeId,
  endShapeId: TLShapeId,
): TLShapeId {
  const startShape = editor.getShape(startShapeId);
  const endShape = editor.getShape(endShapeId);

  if (!startShape || !endShape) {
    throw new Error("Cannot create arrow: one or both shapes not found");
  }

  const startBounds = editor.getShapePageBounds(startShape);
  const endBounds = editor.getShapePageBounds(endShape);

  if (!startBounds || !endBounds) {
    throw new Error("Cannot create arrow: one or both shapes have no bounds");
  }

  // Calculate arrow start and end points
  // Start from the bottom center of the source shape
  // End at the top center of the target shape
  const startPoint = {
    x: startBounds.x + startBounds.width / 2,
    y: startBounds.y + startBounds.height,
  };
  const endPoint = {
    x: endBounds.x + endBounds.width / 2,
    y: endBounds.y,
  };

  const arrowId = createShapeId();

  // Create the arrow shape (locked so it's not selectable)
  editor.createShape({
    id: arrowId,
    type: "arrow",
    x: startPoint.x,
    y: startPoint.y,
    isLocked: true,
    props: {
      start: {
        x: 0,
        y: 0,
      },
      end: {
        x: endPoint.x - startPoint.x,
        y: endPoint.y - startPoint.y,
      },
      color: "grey",
      size: "s",
      arrowheadEnd: "arrow",
      arrowheadStart: "none",
    },
  });

  // Create bindings to connect the arrow to the shapes
  editor.createBindings<TLArrowBinding>([
    {
      fromId: arrowId,
      toId: startShapeId,
      type: "arrow",
      props: {
        terminal: "start",
        normalizedAnchor: { x: 0.5, y: 1 }, // Bottom center
        isPrecise: false,
        isExact: false,
      },
    },
    {
      fromId: arrowId,
      toId: endShapeId,
      type: "arrow",
      props: {
        terminal: "end",
        normalizedAnchor: { x: 0.5, y: 0 }, // Top center
        isPrecise: false,
        isExact: false,
      },
    },
  ]);

  return arrowId;
}

/**
 * Removes all existing dependency arrows from the canvas.
 *
 * @param editor - The TLDraw editor instance
 */
export function clearDependencyArrows(editor: Editor): void {
  const arrows = editor.getCurrentPageShapes().filter((shape) => {
    if (shape.type !== "arrow") {
      return false;
    }
    // Check if this arrow is bound to cell shapes
    const bindings = editor.getBindingsFromShape(shape, "arrow");
    return bindings.some((binding) => {
      const targetShape = editor.getShape(binding.toId);
      return targetShape?.type === "cell";
    });
  });

  if (arrows.length > 0) {
    editor.deleteShapes(arrows.map((a) => a.id));
  }
}

/**
 * Updates dependency arrows when the variables or cell positions change.
 *
 * @param editor - The TLDraw editor instance
 * @param variables - Variable dependency information from the kernel
 * @param cellShapeIds - Map from CellId to TLDraw shape ID
 */
export function updateDependencyArrows(
  editor: Editor,
  variables: Variables,
  cellShapeIds: Map<CellId, TLShapeId>,
): void {
  // Clear existing arrows and create new ones
  clearDependencyArrows(editor);
  createDependencyArrows(editor, variables, cellShapeIds);
}
