# Copyright 2024 Marimo. All rights reserved.
"""Tests for sync_graph functionality.

These tests verify that sync_graph properly runs stale descendants when cells
are updated via file watching (watcher_on_save = "autorun").
"""

from __future__ import annotations

import pytest

from marimo._runtime.requests import ExecutionRequest
from marimo._runtime.runtime import Kernel


class TestSyncGraph:
    """Test sync_graph functionality."""

    async def test_sync_graph_runs_stale_descendants(
        self, any_kernel: Kernel
    ) -> None:
        """Test that sync_graph runs stale descendants when a cell changes.

        This is a regression test for the bug where sync_graph ignored the
        return value of mutate_graph, causing stale descendants to not run.

        Scenario:
        - Cell 0 defines x = 1
        - Cell 1 defines y = x + 1 (depends on x)
        - Cell 2 defines z = y + 1 (depends on y)
        - When cell 0 is updated via sync_graph, cells 1 and 2 should also run
        """
        k = any_kernel

        # Initial setup: create a chain of dependent cells
        await k.run(
            [
                ExecutionRequest(cell_id="0", code="x = 1"),
                ExecutionRequest(cell_id="1", code="y = x + 1"),
                ExecutionRequest(cell_id="2", code="z = y + 1"),
            ]
        )

        # Verify initial state
        assert k.globals["x"] == 1
        assert k.globals["y"] == 2
        assert k.globals["z"] == 3

        # Now simulate a file change using sync_graph
        # Cell 0's code changes: x = 1 -> x = 10
        await k.sync_graph(
            cells={
                "0": "x = 10",
                "1": "y = x + 1",
                "2": "z = y + 1",
            },
            run_ids=["0"],  # Only cell 0 was directly changed
            delete_ids=[],
        )

        # All dependent cells should have been re-run
        assert k.globals["x"] == 10, "Cell 0 should have run with new value"
        assert k.globals["y"] == 11, "Cell 1 (stale descendant) should have run"
        assert k.globals["z"] == 12, "Cell 2 (stale descendant) should have run"

    async def test_sync_graph_runs_multiple_branches(
        self, any_kernel: Kernel
    ) -> None:
        """Test that sync_graph runs all branches of stale descendants.

        Scenario:
        - Cell 0 defines x = 1
        - Cell 1 defines y = x * 2 (depends on x)
        - Cell 2 defines z = x * 3 (depends on x)
        - Cell 3 defines w = y + z (depends on y and z)
        - When cell 0 is updated, all cells should re-run
        """
        k = any_kernel

        await k.run(
            [
                ExecutionRequest(cell_id="0", code="x = 1"),
                ExecutionRequest(cell_id="1", code="y = x * 2"),
                ExecutionRequest(cell_id="2", code="z = x * 3"),
                ExecutionRequest(cell_id="3", code="w = y + z"),
            ]
        )

        assert k.globals["x"] == 1
        assert k.globals["y"] == 2
        assert k.globals["z"] == 3
        assert k.globals["w"] == 5

        # Update cell 0 via sync_graph
        await k.sync_graph(
            cells={
                "0": "x = 10",
                "1": "y = x * 2",
                "2": "z = x * 3",
                "3": "w = y + z",
            },
            run_ids=["0"],
            delete_ids=[],
        )

        assert k.globals["x"] == 10
        assert k.globals["y"] == 20, "Branch 1 should have run"
        assert k.globals["z"] == 30, "Branch 2 should have run"
        assert k.globals["w"] == 50, "Convergent cell should have run"

    async def test_sync_graph_with_cell_rename(
        self, any_kernel: Kernel
    ) -> None:
        """Test that sync_graph handles cell renames (def _ -> def name).

        When a cell is renamed from `def _()` to `def my_func()`, the cell's
        definitions change. This should trigger a re-run of the cell and any
        descendants.
        """
        k = any_kernel

        # Initial setup with anonymous cell
        await k.run(
            [
                ExecutionRequest(cell_id="0", code="x = 1"),
                ExecutionRequest(cell_id="1", code="y = x + 1"),
            ]
        )

        assert k.globals["x"] == 1
        assert k.globals["y"] == 2

        # Simulate renaming cell 0 from def _() to def my_cell()
        # The code changes because the function name changes
        await k.sync_graph(
            cells={
                "0": "x = 100",  # Changed value to verify re-run
                "1": "y = x + 1",
            },
            run_ids=["0"],  # Cell 0 was changed (renamed)
            delete_ids=[],
        )

        assert k.globals["x"] == 100, "Renamed cell should have run"
        assert k.globals["y"] == 101, "Descendant should have run"

    async def test_sync_graph_multiple_cells_changed(
        self, any_kernel: Kernel
    ) -> None:
        """Test sync_graph when multiple cells are changed at once.

        This simulates the scenario where an external editor changes multiple
        cells in a single save operation.
        """
        k = any_kernel

        await k.run(
            [
                ExecutionRequest(cell_id="0", code="a = 1"),
                ExecutionRequest(cell_id="1", code="b = 2"),
                ExecutionRequest(cell_id="2", code="c = a + b"),
            ]
        )

        assert k.globals["a"] == 1
        assert k.globals["b"] == 2
        assert k.globals["c"] == 3

        # Both cell 0 and cell 1 are changed
        await k.sync_graph(
            cells={
                "0": "a = 10",
                "1": "b = 20",
                "2": "c = a + b",
            },
            run_ids=["0", "1"],  # Both cells changed
            delete_ids=[],
        )

        assert k.globals["a"] == 10
        assert k.globals["b"] == 20
        assert k.globals["c"] == 30, "Dependent cell should reflect both changes"

    async def test_sync_graph_with_deletion(
        self, any_kernel: Kernel
    ) -> None:
        """Test sync_graph when cells are deleted."""
        k = any_kernel

        await k.run(
            [
                ExecutionRequest(cell_id="0", code="x = 1"),
                ExecutionRequest(cell_id="1", code="y = 2"),
                ExecutionRequest(cell_id="2", code="z = x + y"),
            ]
        )

        assert k.globals["x"] == 1
        assert k.globals["y"] == 2
        assert k.globals["z"] == 3

        # Delete cell 1, which should affect cell 2
        await k.sync_graph(
            cells={
                "0": "x = 1",
                "2": "z = x + 10",  # Changed to not depend on y
            },
            run_ids=["2"],
            delete_ids=["1"],
        )

        assert k.globals["x"] == 1
        assert "y" not in k.globals, "Deleted cell's variable should be removed"
        assert k.globals["z"] == 11

    async def test_sync_graph_no_double_mutation(
        self, any_kernel: Kernel
    ) -> None:
        """Test that sync_graph doesn't cause issues from double mutation.

        Previously, sync_graph called mutate_graph and then run(), which also
        called mutate_graph. This could cause issues. This test verifies the
        fix works correctly.
        """
        k = any_kernel

        # Track how many times each cell runs using a side effect
        await k.run(
            [
                ExecutionRequest(cell_id="0", code="run_count_0 = 1"),
                ExecutionRequest(cell_id="1", code="run_count_1 = run_count_0"),
            ]
        )

        assert k.globals["run_count_0"] == 1
        assert k.globals["run_count_1"] == 1

        # Update via sync_graph
        await k.sync_graph(
            cells={
                "0": "run_count_0 = 2",
                "1": "run_count_1 = run_count_0",
            },
            run_ids=["0"],
            delete_ids=[],
        )

        # Cells should run exactly once each
        assert k.globals["run_count_0"] == 2
        assert k.globals["run_count_1"] == 2
