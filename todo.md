# Bug Investigation: `watcher_on_save = "autorun"` Not Running Stale Cells

## Summary

When editing a marimo notebook file externally (e.g., via an agent or IDE) with `watcher_on_save = "autorun"` enabled, cells that should be automatically run are left in a stale state. Additionally, when renaming cells from `def _()` to `def new_name()`, the UI does not update the cell names without a page reload.

## Root Causes

### Bug 1: `sync_graph` Ignores Return Value of `mutate_graph`

**Location:** `marimo/_runtime/runtime.py:1550-1552`

```python
# Use existing mutate_graph infrastructure to update the graph
self.mutate_graph(execution_requests, deletion_requests)  # RETURN VALUE IGNORED!
await self.run(execution_requests)
```

**Problem:**

1. `sync_graph()` is called when a file change is detected with `watcher_on_save = "autorun"`
2. First `mutate_graph()` call:
   - Registers the changed cells in the graph
   - Computes stale descendants (cells that depend on changed cells)
   - Returns `cells_registered_without_error.union(stale_cells)` - all cells that need to run
   - **But this return value is completely ignored!**

3. `run(execution_requests)` is called with only the originally changed cells

4. Inside `run()`, `mutate_graph()` is called again (line 1574):
   ```python
   await self._run_cells(
       self.mutate_graph(execution_requests, deletion_requests=[])
   )
   ```

5. But now `is_cell_cached(cell_id, code)` returns `True` because the cells were already registered by the first call

6. Since cells are cached, `_maybe_register_cell()` does nothing:
   - `cells_registered_without_error` is empty
   - `stale_cells` is empty (no mutations detected)
   - Returns empty set

7. `_run_cells(empty_set)` runs **nothing**!

**Result:** Changed cells are registered but never executed. Their descendants are identified as stale but also never executed.

### Bug 2: Cell Names Not Sent to Frontend During File Watch Updates

**Location:** `marimo/_server/sessions.py:1219-1223`

```python
# Send the updated cell ids and codes to the frontend
session.write_operation(
    UpdateCellIdsRequest(cell_ids=cell_ids),  # Only IDs, NO NAMES!
    from_consumer_id=None,
)
```

**Problem:**

- `UpdateCellIdsRequest` only contains `cell_ids: list[CellId_t]`
- Cell names (the function names like `new_cell_name` from `def new_cell_name()`) are only sent via `KernelReady` at startup
- There is no mechanism to update cell names after a file change

**Result:** When you rename `def _()` to `def new_cell_name()`, the frontend never receives the new name until page reload.

## Reproduction Steps

1. Start marimo with a notebook that has `watcher_on_save = "autorun"` in config
2. Open the notebook in the browser
3. Edit the notebook file externally (e.g., with vim or an agent):
   - Change `def _():` to `def my_new_name():`
   - Make several such changes
4. Observe:
   - Cell names don't update in the UI (Bug 2)
   - Cells show as stale but don't auto-run (Bug 1)
   - Reloading the page shows the correct names and runs cells

## Proposed Fixes

### Fix 1: Use Return Value of `mutate_graph` in `sync_graph`

```python
async def sync_graph(
    self,
    cells: dict[CellId_t, str],
    run_ids: list[CellId_t],
    delete_ids: list[CellId_t],
) -> None:
    # ... existing code ...

    # Create execution requests for cells to run
    execution_requests = [
        ExecutionRequest(cell_id=cell_id, code=cells[cell_id])
        for cell_id in run_ids
    ]

    # Create deletion requests for all cells to delete
    deletion_requests = [
        DeleteCellRequest(cell_id=cell_id) for cell_id in all_delete_ids
    ]

    # Clean up uninstantiated requests for deleted cells
    for cell_id in all_delete_ids:
        if cell_id in self._uninstantiated_execution_requests:
            del self._uninstantiated_execution_requests[cell_id]

    # FIX: Use the return value from mutate_graph directly
    cells_to_run = self.mutate_graph(execution_requests, deletion_requests)
    await self._run_cells(cells_to_run)
```

### Fix 2: Add Cell Names to `UpdateCellCodes` Operation

Option A: Add names to `UpdateCellCodes`:
```python
class UpdateCellCodes(Op, tag="update-cell-codes"):
    name: ClassVar[str] = "update-cell-codes"
    cell_ids: list[CellId_t]
    codes: list[str]
    names: list[str]  # NEW FIELD
    code_is_stale: bool
```

Option B: Create a new `UpdateCellNames` operation:
```python
class UpdateCellNames(Op, tag="update-cell-names"):
    name: ClassVar[str] = "update-cell-names"
    cell_ids: list[CellId_t]
    names: list[str]
```

Then update `SessionFileChangeHandler._handle_file_change()` to send names.

## Files to Modify

1. `marimo/_runtime/runtime.py` - Fix `sync_graph` method
2. `marimo/_messaging/ops.py` - Add names to `UpdateCellCodes` or create new op
3. `marimo/_server/sessions.py` - Send cell names in file change handler
4. `frontend/src/core/cells/` - Handle new names field in frontend
5. `packages/openapi/api.yaml` - Update schema

## Test Cases Needed

1. Test that `sync_graph` runs stale descendants when cells change
2. Test that cell names are updated on frontend after file change
3. Test multiple cell renames in sequence
4. Test that transitive dependencies are properly re-run

---

## Implementation Status: COMPLETED

### Fix 1: `sync_graph` Bug - IMPLEMENTED

**File:** `marimo/_runtime/runtime.py:1550-1557`

Changed from:
```python
self.mutate_graph(execution_requests, deletion_requests)
await self.run(execution_requests)
```

To:
```python
# Use mutate_graph to update the graph and get cells to run.
# mutate_graph returns the set of cells that need to run, including
# both the directly changed cells AND their stale descendants.
# We must use this return value directly rather than calling run(),
# because run() calls mutate_graph again, and the second call would
# see the cells as already cached and return an empty set.
cells_to_run = self.mutate_graph(execution_requests, deletion_requests)
await self._run_cells(cells_to_run)
```

**Test:** `tests/_runtime/test_sync_graph.py`

### Fix 2: Cell Names Update - IMPLEMENTED

**Files Modified:**

1. `marimo/_messaging/ops.py` - Added optional `names` field to `UpdateCellCodes`:
   ```python
   class UpdateCellCodes(Op, tag="update-cell-codes"):
       ...
       names: Optional[list[str]] = None
   ```

2. `marimo/_server/sessions.py` - Updated `_handle_file_change()` to send names:
   ```python
   names = list(cell_manager.names())
   ...
   session.write_operation(
       UpdateCellCodes(
           cell_ids=cell_ids,
           codes=codes,
           code_is_stale=...,
           names=names,  # NEW
       ),
       ...
   )
   ```

3. `packages/openapi/api.yaml` - Added `names` to `UpdateCellCodes` schema

4. `frontend/src/core/cells/cells.ts` - Updated `setCellCodes` action to handle names:
   ```typescript
   setCellCodes: (
       state,
       action: {
           codes: string[];
           ids: CellId[];
           codeIsStale: boolean;
           names?: string[];  // NEW
       },
   ) => { ... }
   ```

5. `frontend/src/core/websocket/useMarimoWebSocket.tsx` - Pass names to action:
   ```typescript
   setCellCodes({
       codes: msg.data.codes,
       ids: msg.data.cell_ids as CellId[],
       codeIsStale: msg.data.code_is_stale,
       names: msg.data.names,  // NEW
   });
   ```

**Test:** `tests/_server/test_file_change_handler.py`
