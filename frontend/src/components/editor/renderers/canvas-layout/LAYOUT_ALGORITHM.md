# Dependency Layout Algorithm for Canvas

This document explains the Sugiyama-style layout algorithm adapted from Mozilla's iongraph project for laying out notebook cells with their dependencies.

## Overview

The algorithm arranges nodes (cells) in horizontal layers based on their dependencies, then routes edges between them using "railroad diagram" style paths with right-angle turns and smooth arcs.

## Six-Phase Layout Process

### Phase 1: Layering

Nodes are assigned to horizontal layers based on dependency depth:

```
Layer 0: Cells with no dependencies (roots)
Layer 1: Cells that depend only on Layer 0 cells
Layer 2: Cells that depend on Layer 0 or 1 cells
...
```

**Algorithm:**
1. Start with cells that have no dependencies (layer 0)
2. For each cell, its layer = max(layer of all dependencies) + 1
3. Track the total number of layers

**Key insight:** A cell's layer is always greater than all its dependencies, ensuring arrows always point downward (or across for same-layer references).

### Phase 2: Dummy Node Creation

When an edge spans multiple layers, create invisible "dummy nodes" at each intermediate layer. This allows edges to be routed cleanly through the layout.

```
Without dummy nodes:        With dummy nodes:
┌───┐                       ┌───┐
│ A │ Layer 0               │ A │ Layer 0
└───┘                       └─┬─┘
  │                           │
  │  (long diagonal)        ┌─┴─┐
  │                         │ · │ Layer 1 (dummy)
  │                         └─┬─┘
  │                           │
┌─▼─┐                       ┌─▼─┐
│ C │ Layer 2               │ C │ Layer 2
└───┘                       └───┘
```

**Benefits:**
- Edges only connect adjacent layers
- Enables horizontal edge routing between layers
- Reduces visual clutter from long diagonal lines

### Phase 3: Horizontal Positioning (Edge Straightening)

Multiple iterative passes position nodes horizontally to minimize edge crossings and create straighter edges:

1. **Push neighbors**: Ensure minimum spacing (BLOCK_GAP) between nodes
2. **Straighten children**: Align child nodes horizontally with their parents
3. **Straighten nearly-straight edges**: If an edge is "almost vertical" (within threshold), nudge nodes to make it perfectly vertical
4. **Conservative straightening**: Move nodes right (never left) to align with parents/children without causing overlaps

**Constants:**
- `BLOCK_GAP = 44px` - Minimum horizontal spacing between nodes
- `NEARLY_STRAIGHT = 30px` - Threshold for "almost vertical" edges
- `LAYOUT_ITERATIONS = 2` - Number of straightening passes

### Phase 4: Horizontal Edge Tracking (Joints)

Edges that travel horizontally between layers are assigned to parallel "tracks" to prevent overlap:

```
Track allocation:
─────────────────────── Track 2 (rightward edges)
─────────────────────── Track 1 (rightward edges)
─────────────────────── Track 0 (rightward edges)
═══════════════════════ Layer boundary
─────────────────────── Track 0 (leftward edges)
─────────────────────── Track 1 (leftward edges)
```

**Rules:**
- Rightward edges use tracks above the layer boundary
- Leftward edges use tracks below the layer boundary
- Edges to the same destination share a track (coalesced)
- Non-overlapping edges can share a track

**Constants:**
- `JOINT_SPACING = 16px` - Vertical space between tracks
- `TRACK_PADDING = 36px` - Space reserved for tracks

### Phase 5: Verticalization

Assign final Y coordinates by summing:
- Layer heights (max height of nodes in each layer)
- Track heights (space for horizontal edge routing)
- Padding between layers

### Phase 6: Rendering Railroad-Style Edges

Edges are drawn using SVG paths with right-angle turns and rounded corners:

```
Standard downward edge:      Backedge (upward):
    │                             │
    │ vertical                    │ vertical
    │                             │
    ╰──────╮ arc + horizontal    ╭──────╯ arc
           │                      │
           │ vertical             │ vertical
           ▼                      ▲
```

**Path construction for downward edge:**
```
1. Vertical line from source down to joint Y
2. Quarter-circle arc (radius R) turning horizontal
3. Horizontal line along the joint track
4. Quarter-circle arc turning vertical
5. Vertical line down to destination
```

**SVG Arc syntax:** `A rx ry rotation large-arc sweep x y`
- Use `ARROW_RADIUS = 12px` for smooth corners
- Sweep direction determines clockwise vs counter-clockwise

## Constants Reference

```typescript
const CONTENT_PADDING = 20;      // Border around entire graph
const BLOCK_GAP = 44;            // Min horizontal spacing between nodes
const PORT_START = 16;           // Offset from node edge to connection point
const PORT_SPACING = 60;         // Spacing between multiple edges on same node
const ARROW_RADIUS = 12;         // Corner radius for edge arcs
const TRACK_PADDING = 36;        // Space reserved for edge tracks
const JOINT_SPACING = 16;        // Vertical space between tracks
const LAYOUT_ITERATIONS = 2;     // Straightening pass count
const NEARLY_STRAIGHT = 30;      // Threshold for edge straightening
```

## Adaptation for Marimo Canvas

For the Marimo canvas layout, we adapt this algorithm:

1. **Cells as Nodes**: Each notebook cell becomes a node with its computed output size
2. **Dependencies as Edges**: Variable references between cells create directed edges
3. **Layering**: Cells are layered by their dependency depth
4. **Railroad Edges**: Dependencies are shown as railroad-style curved arrows
5. **Interactive**: Users can drag cells, and the layout provides "organize" operations

### Simplifications for Notebooks

- No loop structures (notebooks are DAGs)
- Fewer nodes than compiler graphs (typically <100 cells)
- User-positioned nodes (layout is a suggestion, not mandatory)
- Real-time updates as dependencies change

## References

- [iongraph blog post](https://spidermonkey.dev/blog/2025/10/28/iongraph-web.html)
- [iongraph source code](https://github.com/mozilla-spidermonkey/iongraph)
- [Sugiyama et al. 1981 - "Methods for Visual Understanding of Hierarchical System Structures"](https://doi.org/10.1109/TSMC.1981.4308636)
