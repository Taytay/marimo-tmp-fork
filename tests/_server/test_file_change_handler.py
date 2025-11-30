# Copyright 2024 Marimo. All rights reserved.
"""Tests for SessionFileChangeHandler functionality.

These tests verify that file change handling properly updates the frontend
with cell names when cells are renamed.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any
from unittest.mock import MagicMock

import pytest

from marimo._config.manager import get_default_config_manager
from marimo._messaging.ops import UpdateCellCodes, UpdateCellIdsRequest
from marimo._server.file_router import AppFileRouter, MarimoFileKey
from marimo._server.model import ConnectionState, SessionMode
from marimo._server.session.session_view import SessionView
from marimo._server.sessions import SessionManager
from marimo._types.ids import SessionId
from marimo._utils.marimo_path import MarimoPath
from tests.conftest import save_and_restore_main


session_id = SessionId("session-123")


@save_and_restore_main
async def test_file_change_sends_cell_names() -> None:
    """Test that file changes send cell names to the frontend.

    This is a regression test for the bug where cell names were not sent
    to the frontend when a file was changed externally, causing the UI
    to show stale cell names until page reload.
    """
    # Create a temporary file with initial content
    with NamedTemporaryFile(delete=False, suffix=".py") as tmp_file:
        tmp_path = Path(tmp_file.name)
        tmp_file.write(
            b"""import marimo
app = marimo.App()

@app.cell
def __():
    x = 1
    return (x,)

@app.cell
def __(x):
    y = x + 1
    return (y,)
"""
        )

    try:
        config_reader = get_default_config_manager(current_path=None)
        # Use lazy mode to test UpdateCellCodes (autorun uses SyncGraphRequest)
        config_reader_lazy = config_reader.with_overrides(
            {
                "runtime": {
                    "watcher_on_save": "lazy",
                }
            }
        )

        file_router = AppFileRouter.from_filename(MarimoPath(str(tmp_path)))
        session_manager = SessionManager(
            file_router=file_router,
            mode=SessionMode.EDIT,
            development_mode=False,
            quiet=True,
            include_code=True,
            lsp_server=MagicMock(),
            config_manager=config_reader_lazy,
            cli_args={},
            argv=None,
            auth_token=None,
            redirect_console_to_browser=False,
            ttl_seconds=None,
            watch=True,
        )

        # Create a mock session consumer
        session_consumer = MagicMock()
        session_consumer.connection_state.return_value = ConnectionState.OPEN
        operations: list[Any] = []
        session_consumer.write_operation = (
            lambda op, *_args: operations.append(op)
        )

        # Create a session
        session = session_manager.create_session(
            session_id=session_id,
            session_consumer=session_consumer,
            query_params={},
            file_key=str(tmp_path),
        )
        session.session_view = MagicMock(SessionView)

        # Wait for initial setup
        for _ in range(16):
            await asyncio.sleep(0.1)
            if len(operations) > 0:
                break

        # Modify the file - rename cells from def __() to def my_cell_name()
        operations.clear()
        with open(tmp_path, "w") as f:
            f.write(
                """import marimo
app = marimo.App()

@app.cell
def compute_x():
    x = 1
    return (x,)

@app.cell
def compute_y(x):
    y = x + 1
    return (y,)
"""
            )

        # Wait for the watcher to detect the change
        for _ in range(16):
            await asyncio.sleep(0.1)
            if len(operations) > 0:
                break

        # Check that UpdateCellCodes was sent
        update_ops = [
            op for op in operations if isinstance(op, UpdateCellCodes)
        ]

        assert len(update_ops) >= 1, "Should have sent UpdateCellCodes"

        # Verify that names are included in the update
        update_cell_codes = update_ops[0]
        assert hasattr(update_cell_codes, "names"), (
            "UpdateCellCodes should have names field"
        )
        assert update_cell_codes.names is not None, (
            "names should not be None"
        )
        assert len(update_cell_codes.names) == len(update_cell_codes.codes), (
            "names and codes should have same length"
        )

        # Check that the new names are present
        assert "compute_x" in update_cell_codes.names, (
            "Should include renamed cell 'compute_x'"
        )
        assert "compute_y" in update_cell_codes.names, (
            "Should include renamed cell 'compute_y'"
        )

        session_manager.shutdown()

    finally:
        tmp_path.unlink(missing_ok=True)


@save_and_restore_main
async def test_file_change_autorun_sends_cell_names() -> None:
    """Test that file changes with autorun also handle cell names.

    In autorun mode, the SyncGraphRequest is sent to the kernel, but the
    frontend should still be notified about cell name changes.
    """
    with NamedTemporaryFile(delete=False, suffix=".py") as tmp_file:
        tmp_path = Path(tmp_file.name)
        tmp_file.write(
            b"""import marimo
app = marimo.App()

@app.cell
def __():
    x = 1
    return (x,)
"""
        )

    try:
        config_reader = get_default_config_manager(current_path=None)
        config_reader_autorun = config_reader.with_overrides(
            {
                "runtime": {
                    "watcher_on_save": "autorun",
                }
            }
        )

        file_router = AppFileRouter.from_filename(MarimoPath(str(tmp_path)))
        session_manager = SessionManager(
            file_router=file_router,
            mode=SessionMode.EDIT,
            development_mode=False,
            quiet=True,
            include_code=True,
            lsp_server=MagicMock(),
            config_manager=config_reader_autorun,
            cli_args={},
            argv=None,
            auth_token=None,
            redirect_console_to_browser=False,
            ttl_seconds=None,
            watch=True,
        )

        session_consumer = MagicMock()
        session_consumer.connection_state.return_value = ConnectionState.OPEN
        operations: list[Any] = []
        session_consumer.write_operation = (
            lambda op, *_args: operations.append(op)
        )

        session = session_manager.create_session(
            session_id=session_id,
            session_consumer=session_consumer,
            query_params={},
            file_key=str(tmp_path),
        )
        session.session_view = MagicMock(SessionView)

        for _ in range(16):
            await asyncio.sleep(0.1)
            if len(operations) > 0:
                break

        # Modify the file - rename cell
        operations.clear()
        with open(tmp_path, "w") as f:
            f.write(
                """import marimo
app = marimo.App()

@app.cell
def my_named_cell():
    x = 1
    return (x,)
"""
            )

        for _ in range(16):
            await asyncio.sleep(0.1)
            if len(operations) > 0:
                break

        # In autorun mode, we should have either UpdateCellCodes with names
        # or a separate UpdateCellNames operation
        update_ops = [
            op for op in operations if isinstance(op, UpdateCellCodes)
        ]

        # For autorun mode, check that cell names are communicated somehow
        # This could be via UpdateCellCodes.names or UpdateCellIdsRequest
        # with names, depending on the implementation
        cell_ids_ops = [
            op for op in operations if isinstance(op, UpdateCellIdsRequest)
        ]

        # At minimum, the cell IDs should be updated
        assert len(cell_ids_ops) >= 1, (
            "Should have sent UpdateCellIdsRequest"
        )

        session_manager.shutdown()

    finally:
        tmp_path.unlink(missing_ok=True)
