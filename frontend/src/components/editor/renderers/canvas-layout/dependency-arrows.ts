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
  // Group variables by the cell pairs they connect
  const connectionVariables = new Map<string, string[]>();

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

        const fromShapeId = cellShapeIds.get(fromId);
        const toShapeId = cellShapeIds.get(toId);

        if (fromShapeId && toShapeId) {
          // Use a delimiter that won't appear in shape IDs (which contain dashes)
          const key = `${fromShapeId}|||${toShapeId}`;
          const existing = connectionVariables.get(key);
          if (existing) {
            if (!existing.includes(variable.name)) {
              existing.push(variable.name);
            }
          } else {
            connectionVariables.set(key, [variable.name]);
          }
        }
      }
    }
  }

  // Create arrows with variable labels
  const arrowIds: TLShapeId[] = [];
  for (const [key, varNames] of connectionVariables.entries()) {
    const [fromShapeId, toShapeId] = key.split("|||") as [TLShapeId, TLShapeId];
    const label =
      varNames.length <= 3
        ? varNames.join(", ")
        : `${varNames.slice(0, 2).join(", ")} +${varNames.length - 2}`;
    const arrowId = createArrowBetweenShapes(
      editor,
      fromShapeId,
      toShapeId,
      label,
    );
    arrowIds.push(arrowId);
  }

  // Send all arrows to the back so they render behind cells
  if (arrowIds.length > 0) {
    editor.sendToBack(arrowIds);
  }
}

/**
 * Edge position on a shape (normalized 0-1 coordinates)
 */
type EdgePosition = "top" | "bottom" | "left" | "right";

interface EdgeAnchor {
  edge: EdgePosition;
  anchor: { x: number; y: number };
  point: { x: number; y: number };
}

/**
 * Calculate the closest edges between two shapes.
 */
function getClosestEdges(
  startBounds: { x: number; y: number; width: number; height: number },
  endBounds: { x: number; y: number; width: number; height: number },
): { start: EdgeAnchor; end: EdgeAnchor } {
  // Calculate centers
  const startCenter = {
    x: startBounds.x + startBounds.width / 2,
    y: startBounds.y + startBounds.height / 2,
  };
  const endCenter = {
    x: endBounds.x + endBounds.width / 2,
    y: endBounds.y + endBounds.height / 2,
  };

  // Calculate the direction from start to end
  const dx = endCenter.x - startCenter.x;
  const dy = endCenter.y - startCenter.y;

  // Determine which edges to use based on relative positions
  let startEdge: EdgePosition;
  let endEdge: EdgePosition;

  // Use the dominant direction to determine edges
  if (Math.abs(dx) > Math.abs(dy)) {
    // Horizontal dominant
    if (dx > 0) {
      startEdge = "right";
      endEdge = "left";
    } else {
      startEdge = "left";
      endEdge = "right";
    }
  } else {
    // Vertical dominant
    if (dy > 0) {
      startEdge = "bottom";
      endEdge = "top";
    } else {
      startEdge = "top";
      endEdge = "bottom";
    }
  }

  // Calculate anchor points and actual positions
  const getEdgeInfo = (
    bounds: { x: number; y: number; width: number; height: number },
    edge: EdgePosition,
  ): EdgeAnchor => {
    switch (edge) {
      case "top":
        return {
          edge,
          anchor: { x: 0.5, y: 0 },
          point: { x: bounds.x + bounds.width / 2, y: bounds.y },
        };
      case "bottom":
        return {
          edge,
          anchor: { x: 0.5, y: 1 },
          point: {
            x: bounds.x + bounds.width / 2,
            y: bounds.y + bounds.height,
          },
        };
      case "left":
        return {
          edge,
          anchor: { x: 0, y: 0.5 },
          point: { x: bounds.x, y: bounds.y + bounds.height / 2 },
        };
      case "right":
        return {
          edge,
          anchor: { x: 1, y: 0.5 },
          point: {
            x: bounds.x + bounds.width,
            y: bounds.y + bounds.height / 2,
          },
        };
    }
  };

  return {
    start: getEdgeInfo(startBounds, startEdge),
    end: getEdgeInfo(endBounds, endEdge),
  };
}

/**
 * Creates an arrow shape connecting two shapes from closest edges.
 *
 * @param editor - The TLDraw editor instance
 * @param startShapeId - The source shape ID
 * @param endShapeId - The target shape ID
 * @param label - Optional label to display on the arrow
 */
export function createArrowBetweenShapes(
  editor: Editor,
  startShapeId: TLShapeId,
  endShapeId: TLShapeId,
  label?: string,
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

  // Calculate closest edges
  const { start, end } = getClosestEdges(startBounds, endBounds);

  const arrowId = createShapeId();

  // Create the arrow shape (locked so it's not selectable)
  // Use 'elbow' kind for railroad-style orthogonal arrows with right-angle turns
  editor.createShape({
    id: arrowId,
    type: "arrow",
    x: start.point.x,
    y: start.point.y,
    isLocked: true,
    props: {
      start: {
        x: 0,
        y: 0,
      },
      end: {
        x: end.point.x - start.point.x,
        y: end.point.y - start.point.y,
      },
      color: "grey",
      size: "s",
      dash: "dashed",
      arrowheadEnd: "arrow",
      arrowheadStart: "none",
      // Use elbow arrows for railroad-style orthogonal routing
      // This creates right-angle turns instead of curved arcs
      kind: "elbow",
      // Use richText for arrow labels (TLDraw v3 format)
      richText: label
        ? {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: label }],
              },
            ],
          }
        : undefined,
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
        normalizedAnchor: start.anchor,
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
        normalizedAnchor: end.anchor,
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
    // Check if this arrow is bound to cell shapes (either read-mode "cell" or edit-mode "editable-cell")
    const bindings = editor.getBindingsFromShape(shape, "arrow");
    return bindings.some((binding) => {
      const targetShape = editor.getShape(binding.toId);
      return (
        targetShape?.type === "cell" || targetShape?.type === "editable-cell"
      );
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
