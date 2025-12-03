# Canvas Layout Implementation Plan

## Overview

Create a new "Canvas" layout for Marimo notebooks using **TLDraw** as the rendering engine. This layout will allow users to:

1. View cells in a draggable, infinite canvas
2. See dependency arrows between cells (like the sidebar DAG view, but interactive)
3. Edit and run cells directly on the canvas
4. Arrange cells freely by dragging them

## Architecture Summary

### Current Layout System

Marimo uses a plugin-based layout system defined in:
- `frontend/src/components/editor/renderers/types.ts` - Core types and interfaces
- `frontend/src/components/editor/renderers/plugins.ts` - Plugin registry

Each layout plugin implements `ICellRendererPlugin<S, L>`:
```typescript
interface ICellRendererPlugin<S, L> {
  type: LayoutType;              // "vertical" | "grid" | "slides" | "canvas"
  name: string;                  // Display name
  validator: ZodType<S>;         // Zod schema for serialized layout
  deserializeLayout: (layout: S, cells: CellData[]) => L;
  serializeLayout: (layout: L, cells: CellData[]) => S;
  Component: React.FC<ICellRendererProps<L>>;
  getInitialLayout: (cells: CellData[]) => L;
}
```

### Dependency Information

Variable dependencies are available via `useVariables()` hook from `@/core/variables/state.ts`:
```typescript
interface Variable {
  name: VariableName;
  declaredBy: CellId[];  // Cells that define this variable
  usedBy: CellId[];      // Cells that use this variable
}
```

Edges represent: `declaredBy[i] → usedBy[j]` (dependency flow)

### TLDraw Integration

TLDraw provides:
- **Custom shapes**: Create a `CellShape` to render notebook cells
- **Arrow bindings**: Connect shapes with arrows that move with the shapes
- **Editor API**: Programmatic control for shape creation and positioning
- **Pan/zoom**: Built-in infinite canvas navigation

## Implementation Plan

### Phase 1: Setup and Basic Infrastructure

#### 1.1 Add TLDraw Dependency
```bash
cd frontend && npm install tldraw
```

#### 1.2 Create Directory Structure
```
frontend/src/components/editor/renderers/canvas-layout/
├── canvas-layout.tsx       # Main canvas component
├── plugin.tsx              # Layout plugin definition
├── types.ts                # Type definitions
├── cell-shape.tsx          # Custom TLDraw shape for cells
├── cell-shape-util.ts      # Shape utility class
├── dependency-arrows.ts    # Arrow binding logic
└── styles.css              # Canvas-specific styles
```

#### 1.3 Define Types
```typescript
// types.ts
export interface CanvasLayout {
  cells: CanvasCellPosition[];
}

export interface CanvasCellPosition {
  cellId: CellId;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SerializedCanvasLayout {
  cells: {
    position: [number, number, number, number] | null; // [x, y, w, h]
  }[];
}
```

### Phase 2: Custom Cell Shape

#### 2.1 Define Cell Shape Type
```typescript
// cell-shape.tsx
import { TLBaseShape, ShapeUtil, HTMLContainer } from 'tldraw'

type CellShape = TLBaseShape<'cell', {
  cellId: CellId;
  w: number;
  h: number;
}>
```

#### 2.2 Create CellShapeUtil
The `CellShapeUtil` will:
- Render the full cell component (code editor + output)
- Handle selection and focus
- Support resizing
- Provide geometry for hit testing

Key methods:
- `getDefaultProps()`: Default cell dimensions
- `getGeometry()`: Rectangle bounds for selection
- `component()`: Render the actual cell content
- `indicator()`: Selection outline

#### 2.3 Cell Content Rendering
For each cell shape, render:
- Cell toolbar (run, add above/below, delete)
- Code editor (CodeMirror)
- Output area
- Status indicators (running, error, stale)

Use existing components:
- `<Cell>` from `frontend/src/components/editor/Cell.tsx`
- Or create a simplified version for canvas

### Phase 3: Dependency Arrows

#### 3.1 Create Arrow Bindings
Use TLDraw's binding system to create arrows:
```typescript
function createDependencyArrows(
  editor: Editor,
  variables: Variables,
  cellShapeIds: Map<CellId, TLShapeId>
) {
  for (const variable of Object.values(variables)) {
    // Skip 'mo' (marimo module)
    if (variable.name === 'mo') continue;

    for (const fromId of variable.declaredBy) {
      for (const toId of variable.usedBy) {
        const fromShapeId = cellShapeIds.get(fromId);
        const toShapeId = cellShapeIds.get(toId);
        if (fromShapeId && toShapeId) {
          createArrowBetweenShapes(editor, fromShapeId, toShapeId);
        }
      }
    }
  }
}
```

#### 3.2 Arrow Styling
- Use smooth curves for better readability
- Color-code arrows (e.g., by variable type or error state)
- Show variable name on hover/selection
- Animate arrows during execution flow

### Phase 4: Canvas Layout Component

#### 4.1 Main Component Structure
```typescript
// canvas-layout.tsx
export const CanvasLayoutRenderer: React.FC<ICellRendererProps<CanvasLayout>> = ({
  layout,
  setLayout,
  cells,
  mode,
}) => {
  const variables = useVariables();
  const editorRef = useRef<Editor>(null);

  // Sync shapes when cells change
  useEffect(() => {
    syncCellShapes(editorRef.current, cells, layout);
  }, [cells]);

  // Update arrows when dependencies change
  useEffect(() => {
    updateDependencyArrows(editorRef.current, variables);
  }, [variables]);

  // Save positions when shapes move
  const handleMount = (editor: Editor) => {
    editorRef.current = editor;
    editor.on('change', () => {
      const positions = extractPositions(editor);
      setLayout({ cells: positions });
    });
  };

  return (
    <div className="canvas-layout">
      <Tldraw
        shapeUtils={[CellShapeUtil]}
        onMount={handleMount}
      />
    </div>
  );
};
```

#### 4.2 Position Synchronization
When shapes are moved in TLDraw, update the layout state:
```typescript
function extractPositions(editor: Editor): CanvasCellPosition[] {
  return editor.getCurrentPageShapes()
    .filter(shape => shape.type === 'cell')
    .map(shape => ({
      cellId: shape.props.cellId,
      x: shape.x,
      y: shape.y,
      width: shape.props.w,
      height: shape.props.h,
    }));
}
```

### Phase 5: Auto-Layout Algorithm

#### 5.1 Initial Layout
When switching to canvas view for the first time:
```typescript
function getInitialLayout(cells: CellData[]): CanvasLayout {
  // Use dagre (already in codebase) to calculate DAG positions
  const g = new graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 100, ranksep: 150 });

  // Add nodes and edges based on dependencies
  // ...

  layout(g);

  return {
    cells: cells.map(cell => {
      const node = g.node(cell.id);
      return {
        cellId: cell.id,
        x: node?.x ?? 0,
        y: node?.y ?? 0,
        width: 400,
        height: calculateHeight(cell),
      };
    }),
  };
}
```

#### 5.2 Manual Positioning
After initial layout, respect user-positioned cells:
- Track which cells have been manually moved
- Only auto-layout new cells
- Provide "Reset Layout" button to re-apply auto-layout

### Phase 6: Plugin Registration

#### 6.1 Create Plugin
```typescript
// plugin.tsx
export const CanvasLayoutPlugin: ICellRendererPlugin<
  SerializedCanvasLayout,
  CanvasLayout
> = {
  type: "canvas",
  name: "Canvas",
  validator: z.object({
    cells: z.array(z.object({
      position: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
    })),
  }),
  deserializeLayout,
  serializeLayout,
  Component: CanvasLayoutRenderer,
  getInitialLayout,
};
```

#### 6.2 Register Plugin
Update `frontend/src/components/editor/renderers/plugins.ts`:
```typescript
import { CanvasLayoutPlugin } from "./canvas-layout/plugin";

export const cellRendererPlugins: ICellRendererPlugin<any, any>[] = [
  GridLayoutPlugin,
  SlidesLayoutPlugin,
  VerticalLayoutPlugin,
  CanvasLayoutPlugin,  // Add new plugin
];
```

#### 6.3 Add to Layout Types
Update `frontend/src/components/editor/renderers/types.ts`:
```typescript
export type LayoutType = "vertical" | "grid" | "slides" | "canvas";
export const LAYOUT_TYPES: LayoutType[] = ["vertical", "grid", "slides", "canvas"];
```

### Phase 7: UI Integration

#### 7.1 Layout Selector Icon
Add canvas icon to layout selector:
```typescript
// layout-select.tsx
function renderIcon(layoutType: LayoutType) {
  switch (layoutType) {
    case "canvas":
      return LayoutPanelLeftIcon; // or a custom canvas icon
    // ...
  }
}
```

#### 7.2 Canvas Controls
Add a toolbar for canvas-specific actions:
- Zoom to fit
- Reset layout (re-apply auto-layout)
- Toggle dependency arrows
- Lock/unlock positions

### Phase 8: Cell Interactions

#### 8.1 Running Cells
- Click to select cell
- Double-click to focus code editor
- Run button executes cell
- Shift+Enter runs current cell

#### 8.2 Adding Cells
- "Add cell above/below" buttons on cell toolbar
- New cells appear near the selected cell
- Right-click context menu for adding cells

#### 8.3 Deleting Cells
- Delete button on cell toolbar
- Keyboard shortcut (with confirmation)

## File Changes Summary

### New Files
1. `frontend/src/components/editor/renderers/canvas-layout/canvas-layout.tsx`
2. `frontend/src/components/editor/renderers/canvas-layout/plugin.tsx`
3. `frontend/src/components/editor/renderers/canvas-layout/types.ts`
4. `frontend/src/components/editor/renderers/canvas-layout/cell-shape-util.ts`
5. `frontend/src/components/editor/renderers/canvas-layout/dependency-arrows.ts`
6. `frontend/src/components/editor/renderers/canvas-layout/styles.css`

### Modified Files
1. `frontend/src/components/editor/renderers/types.ts` - Add "canvas" to LayoutType
2. `frontend/src/components/editor/renderers/plugins.ts` - Register CanvasLayoutPlugin
3. `frontend/src/components/editor/renderers/layout-select.tsx` - Add canvas icon
4. `frontend/package.json` - Add tldraw dependency

## Technical Considerations

### Performance
- Use React.memo for cell shapes
- Virtualize cells outside viewport (TLDraw handles this)
- Debounce layout saves
- Batch dependency arrow updates

### State Management
- Cell data: Existing Jotai atoms
- Canvas state: TLDraw's internal store
- Position sync: On TLDraw change events

### Edge Cases
- New cells added while in canvas view
- Cells deleted from another view
- Circular dependencies (show error styling)
- Very large notebooks (100+ cells)

## Implementation Order

1. **Setup**: Add tldraw, create directory structure
2. **Basic Canvas**: Render cells as simple boxes
3. **Cell Content**: Integrate real cell rendering
4. **Arrows**: Add dependency arrows
5. **Auto-Layout**: Implement dagre-based initial layout
6. **Interactions**: Cell editing, running, adding, deleting
7. **Polish**: Styling, icons, controls
8. **Testing**: Manual testing, edge cases

## Estimated Complexity

- **Low**: Plugin registration, types, basic canvas
- **Medium**: Custom cell shape, arrow bindings
- **High**: Full cell editing integration, auto-layout

## References

- TLDraw Docs: https://tldraw.dev/
- TLDraw Custom Shapes: https://tldraw.dev/docs/shapes
- TLDraw Arrow Bindings: https://tldraw.dev/examples/create-arrow
- Existing Grid Layout: `frontend/src/components/editor/renderers/grid-layout/`
- Existing DAG View: `frontend/src/components/dependency-graph/`
