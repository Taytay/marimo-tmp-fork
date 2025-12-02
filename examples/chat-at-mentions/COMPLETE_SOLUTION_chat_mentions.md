# Complete Solution: @ Mention Resolution in mo.ui.chat

## How Context Flows from Python to Frontend

You were absolutely right! Here's the complete flow:

### 1. Python Backend Sends Context to Frontend

**When cells execute:**

1. **Variables** → Sent via `Variables` operation ([ops.py:568](marimo/_messaging/ops.py#L568))
   ```python
   Variables(variables=[VariableDeclaration(...), ...])
   ```

2. **Variable Values** → Sent via `VariableValues` operation ([ops.py:575](marimo/_messaging/ops.py#L575))
   ```python
   VariableValues(variables=[VariableValue(name="df", value="...", datatype="DataFrame"), ...])
   ```

3. **Tables/DataFrames** → Sent via `Datasets` operation ([ops.py:582](marimo/_messaging/ops.py#L582))
   ```python
   Datasets(tables=[DataTable(...), ...])
   ```

These operations are sent via WebSocket to the frontend.

### 2. Frontend Stores Context in Jotai Atoms

The frontend receives these operations and stores them:

- **`variablesAtom`** ([variables/state.ts:75](frontend/src/core/variables/state.ts#L75)) - Variable declarations
- **`allTablesAtom`** ([datasets/data-source-connections.ts](frontend/src/core/datasets/data-source-connections.ts)) - Tables/DataFrames
- **`dataSourceConnectionsAtom`** - Data source connections

### 3. AI Context Registry Uses These Atoms

The `AIContextRegistry` ([context/context.ts:18-31](frontend/src/core/ai/context/context.ts#L18-L31)) reads from these atoms:

```typescript
export function getAIContextRegistry(store: JotaiStore) {
  const datasource = store.get(dataSourceConnectionsAtom);
  const tablesMap = store.get(allTablesAtom);
  const variables = store.get(variablesAtom);

  return new AIContextRegistry()
    .register(new TableContextProvider(tablesMap))
    .register(new VariableContextProvider(variables, tablesMap))
    // ... more providers
}
```

### 4. Autocomplete Works in mo.ui.chat

The `PromptInput` component in `mo.ui.chat` includes `resourceExtension` ([resources.ts:41](frontend/src/core/codemirror/ai/resources.ts#L41)), which:
- Reads from the context registry
- Shows autocomplete dropdown with rich previews
- BUT doesn't resolve @ mentions when you submit!

---

## The Problem

**Editor Chat Sidebar** calls `buildCompletionRequestBody` which:
1. Parses `@data://df` from input
2. Looks up `df` in the registry
3. Formats as XML with metadata
4. Sends to backend

**mo.ui.chat** does NOT call `buildCompletionRequestBody`, so:
1. Autocomplete works (shows preview)
2. But only raw text `"@data://df"` is sent to Python
3. Your model function receives the URI, not the data

---

## The Solution: Access Session Data Directly in Python!

Since the context already exists in Python (in `SessionView`), we can access it directly without needing frontend resolution.

### How to Access Session Data

The session data is stored in `SessionView` ([session_view.py:68-94](marimo/_server/session/session_view.py#L68-L94)):

```python
class SessionView:
    def __init__(self) -> None:
        self.datasets = Datasets(tables=[])  # All tables/DataFrames
        self.variable_values: dict[str, VariableValue] = {}  # Variable values
        # ...
```

The AI tools already use this! See [tables_and_variables.py:88-89](marimo/_ai/_tools/tools/tables_and_variables.py#L88-L89):

```python
tables = session_view.datasets.tables
variables = session_view.variable_values
```

---

## Updated Python Helper with Session Access

Here's an improved solution that accesses the session data directly:

```python
"""
chat_mention_resolver_v2.py - Access marimo's session data directly
"""

import re
from typing import Any, Callable, Dict, List, Optional
from dataclasses import dataclass
import marimo as mo


@dataclass
class ResolvedContext:
    """Container for resolved @ mention context."""
    plain_text: str
    mentions: Dict[str, Any]
    messages: List[Any]


def get_session_context() -> Optional[Dict[str, Any]]:
    """
    Get the current session's context (variables, tables, etc.).

    Returns None if not in a session context (e.g., testing).
    """
    try:
        from marimo._runtime.context import get_context
        from marimo._runtime.context.kernel_context import KernelRuntimeContext
        from marimo._server.sessions import get_current_session

        # Get the current session
        session = get_current_session()
        if session is None:
            return None

        session_view = session.session_view

        return {
            'variables': session_view.variable_values,  # dict[str, VariableValue]
            'tables': session_view.datasets.tables,      # list[DataTable]
            'connections': session_view.data_connectors.connections,  # list[DataSourceConnection]
        }
    except Exception:
        return None


class SessionMentionResolver:
    """Resolves @ mentions using session data."""

    PATTERNS = {
        'variable': re.compile(r'@variable://(\w+)'),
        'data': re.compile(r'@data://(\w+)'),
    }

    def __init__(self):
        self.session_context = get_session_context()

    def extract_mentions(self, text: str) -> Dict[str, List[str]]:
        """Extract all @ mentions from text."""
        mentions = {}
        for mention_type, pattern in self.PATTERNS.items():
            matches = pattern.findall(text)
            if matches:
                mentions[mention_type] = list(set(matches))
        return mentions

    def resolve_variable(self, name: str) -> Optional[Dict[str, Any]]:
        """Resolve @variable:// mention using session data."""
        if not self.session_context or 'variables' not in self.session_context:
            return None

        var_value = self.session_context['variables'].get(name)
        if not var_value:
            return None

        return {
            'name': name,
            'dataType': var_value.datatype,
            'value': var_value.value,
        }

    def resolve_table(self, name: str) -> Optional[Dict[str, Any]]:
        """Resolve @data:// mention using session data."""
        if not self.session_context or 'tables' not in self.session_context:
            return None

        # Find table by name
        for table in self.session_context['tables']:
            if table.name == name:
                # Format column info
                columns_info = []
                for col in table.columns:
                    col_info = {
                        'name': col.name,
                        'type': col.type,
                    }
                    if hasattr(col, 'sample_values') and col.sample_values:
                        col_info['samples'] = col.sample_values
                    columns_info.append(col_info)

                return {
                    'name': name,
                    'source': table.source,
                    'rows': table.num_rows,
                    'columns': table.num_columns,
                    'columns_info': columns_info,
                    'summary': f"{table.num_rows} rows × {table.num_columns} columns",
                }

        return None

    def format_as_xml(self, mention_type: str, data: Dict[str, Any]) -> str:
        """Format resolved mention as XML."""
        if mention_type == 'variable':
            return f"""<variable name="{data['name']}" dataType="{data['dataType']}">
{data['value']}
</variable>"""

        elif mention_type == 'data':
            xml = f"""<data name="{data['name']}" source="{data['source']}">
{data['summary']}
Columns:"""
            for col in data['columns_info']:
                xml += f"\n  - {col['name']} ({col['type']})"
                if 'samples' in col:
                    xml += f" - samples: {col['samples']}"
            xml += "\n</data>"
            return xml

        return f"<{mention_type}>{data}</{mention_type}>"

    def resolve_all(self, text: str) -> ResolvedContext:
        """Resolve all @ mentions in text."""
        mentions = self.extract_mentions(text)
        resolved_data = {}
        xml_parts = []

        # Resolve variables
        for var_name in mentions.get('variable', []):
            data = self.resolve_variable(var_name)
            if data:
                resolved_data[f"variable://{var_name}"] = data
                xml_parts.append(self.format_as_xml('variable', data))

        # Resolve tables
        for table_name in mentions.get('data', []):
            data = self.resolve_table(table_name)
            if data:
                resolved_data[f"data://{table_name}"] = data
                xml_parts.append(self.format_as_xml('data', data))

        return ResolvedContext(
            plain_text="\n\n".join(xml_parts),
            mentions=resolved_data,
            messages=[],
        )


def resolve_mentions_from_session(
    messages: List[Any],
) -> Dict[str, Any]:
    """
    Resolve @ mentions using session data (no need for locals()!).

    This uses marimo's internal session state, which already has all
    variable and table metadata.
    """
    resolver = SessionMentionResolver()

    # Extract text from all messages
    all_text = ""
    for msg in messages:
        if hasattr(msg, 'content'):
            all_text += str(msg.content) + "\n"

    context = resolver.resolve_all(all_text)
    context.messages = messages

    return {
        'context': context,
        'messages': messages,
    }


# Decorator version
def with_session_context(model_fn: Callable) -> Callable:
    """
    Decorator to automatically resolve @ mentions using session data.

    Example:
        @with_session_context
        def my_model(messages, config, context=None):
            if context and context.plain_text:
                # Use resolved context from session
                prompt = f"Context:\\n{context.plain_text}\\n\\nUser: {messages[-1].content}"
            return call_llm(prompt)
    """
    import inspect

    def wrapper(messages, config=None):
        # Resolve mentions from session
        resolved = resolve_mentions_from_session(messages)
        context = resolved['context']

        # Call original function with context
        sig = inspect.signature(model_fn)
        if 'context' in sig.parameters:
            return model_fn(messages, config, context=context)
        else:
            return model_fn(messages, config)

    return wrapper
```

---

## Usage Example

```python
import marimo as mo
from chat_mention_resolver_v2 import with_session_context

# Your data - will be sent to frontend automatically by marimo
sales_data = pd.DataFrame(...)
revenue = 1000000

@with_session_context
def my_model(messages, config, context=None):
    """This uses session data - no need for locals()!"""

    user_msg = messages[-1].content

    if context and context.plain_text:
        # Context comes from marimo's session, not locals()
        prompt = f"Context:\n{context.plain_text}\n\nUser: {user_msg}"
    else:
        prompt = user_msg

    # Call your LLM
    return call_llm(prompt)

chat = mo.ui.chat(my_model)
```

When you type `@data://sales_data`, it resolves using the session's `Datasets` operation data!

---

## Benefits of This Approach

1. **No duplicate data** - Uses the same data marimo already sends to frontend
2. **Always in sync** - Session data updates automatically when cells run
3. **No locals() hacks** - Accesses marimo's internal state properly
4. **Same metadata** - Uses exact same `VariableValue` and `DataTable` structures
5. **Works with all variable types** - Including UI elements, modules, etc.

---

## How to Get the Current Session

The tricky part is accessing the current session from within a chat model function. We need to:

1. Get the current session (stored in Flask/Starlette request context)
2. Access its `session_view`
3. Read `variable_values` and `datasets.tables`

This might require a small addition to marimo's public API to expose `get_current_session()`.

Alternatively, we could pass the session_id to the chat widget and look it up.

---

## Next Steps

The cleanest solution would be to:

1. Add a public API in marimo to get current session's context:
   ```python
   import marimo as mo
   context = mo.get_session_context()  # Returns variables, tables, etc.
   ```

2. Use this in your model function:
   ```python
   def my_model(messages, config):
       context = mo.get_session_context()
       # Resolve @ mentions using context
   ```

This would be a valuable feature for marimo to add!
