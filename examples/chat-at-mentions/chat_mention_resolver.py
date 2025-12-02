"""
Helper module to resolve @ mentions in marimo chat widgets.

This module provides utilities to parse and resolve @ mention references
like @variable://name, @data://table, etc. in mo.ui.chat messages.

Usage:
    from chat_mention_resolver import resolve_mentions, create_context_aware_model

    # Option 1: Resolve mentions manually
    def my_model(messages, config):
        resolved = resolve_mentions(messages, locals())
        # Use resolved['context'] and resolved['messages']

    # Option 2: Use decorator
    @create_context_aware_model
    def my_model(messages, config, context):
        # context is automatically resolved
"""

import re
import json
from typing import Any, Callable, Dict, List, Optional, Union
from dataclasses import dataclass
import marimo as mo


@dataclass
class ResolvedContext:
    """Container for resolved @ mention context."""

    # Plain text representation (XML format, compatible with marimo's system)
    plain_text: str

    # Structured data for each mention
    mentions: Dict[str, Any]

    # Original messages with mentions preserved
    messages: List[Any]


class MentionResolver:
    """Resolves @ mentions in chat messages to their actual values."""

    # Regex patterns for different mention types
    PATTERNS = {
        'variable': re.compile(r'@variable://(\w+)'),
        'data': re.compile(r'@data://(\w+)'),
        'cell-output': re.compile(r'@cell-output://(\w+)'),
        'datasource': re.compile(r'@datasource://(\w+)'),
        'error': re.compile(r'@error://(\w+)'),
        'file': re.compile(r'@file://([\w./\-]+)'),
    }

    def __init__(self, namespace: Dict[str, Any]):
        """
        Initialize resolver with a namespace (typically locals() or globals()).

        Args:
            namespace: Dictionary of available variables (use locals() or globals())
        """
        self.namespace = namespace

    def extract_mentions(self, text: str) -> Dict[str, List[str]]:
        """
        Extract all @ mentions from text.

        Args:
            text: Input text containing @ mentions

        Returns:
            Dictionary mapping mention type to list of names
        """
        mentions = {}
        for mention_type, pattern in self.PATTERNS.items():
            matches = pattern.findall(text)
            if matches:
                mentions[mention_type] = list(set(matches))  # Remove duplicates
        return mentions

    def resolve_variable(self, name: str) -> Optional[Dict[str, Any]]:
        """
        Resolve a @variable:// mention.

        Args:
            name: Variable name

        Returns:
            Dictionary with variable info or None if not found
        """
        if name not in self.namespace:
            return None

        value = self.namespace[name]

        # Determine data type
        data_type = type(value).__name__

        # Get string representation
        try:
            if hasattr(value, 'shape'):  # DataFrame, numpy array, etc.
                value_str = f"Shape: {value.shape}\n{repr(value)}"
            elif hasattr(value, '__len__') and len(value) > 100:
                value_str = f"{type(value).__name__} with {len(value)} items\n{repr(value)[:500]}..."
            else:
                value_str = repr(value)
                if len(value_str) > 1000:
                    value_str = value_str[:1000] + "..."
        except Exception:
            value_str = str(value)

        return {
            'name': name,
            'dataType': data_type,
            'value': value,
            'value_str': value_str,
        }

    def resolve_data(self, name: str) -> Optional[Dict[str, Any]]:
        """
        Resolve a @data:// mention (tables/dataframes).

        Args:
            name: Table/dataframe name

        Returns:
            Dictionary with table info or None if not found
        """
        var_info = self.resolve_variable(name)
        if not var_info:
            return None

        value = var_info['value']

        # Try to get DataFrame-like information
        info = {
            'name': name,
            'type': type(value).__name__,
        }

        try:
            if hasattr(value, 'shape'):
                info['shape'] = value.shape
                info['rows'] = value.shape[0]
                info['columns'] = value.shape[1] if len(value.shape) > 1 else 1

            if hasattr(value, 'columns'):
                # Pandas DataFrame
                columns_info = []
                for col in value.columns:
                    col_info = {
                        'name': col,
                        'type': str(value[col].dtype),
                    }
                    # Get sample values
                    try:
                        samples = value[col].dropna().head(3).tolist()
                        col_info['samples'] = samples
                    except Exception:
                        pass
                    columns_info.append(col_info)
                info['columns_info'] = columns_info
                info['summary'] = f"{value.shape[0]} rows × {value.shape[1]} columns"
            elif hasattr(value, 'head'):
                # Try to get head
                info['head'] = str(value.head())
        except Exception as e:
            info['error'] = str(e)

        info['value'] = value
        return info

    def format_as_xml(self, mention_type: str, data: Dict[str, Any]) -> str:
        """
        Format resolved mention as XML (compatible with marimo's format).

        Args:
            mention_type: Type of mention (variable, data, etc.)
            data: Resolved data

        Returns:
            XML string
        """
        if mention_type == 'variable':
            return f"""<variable name="{data['name']}" dataType="{data['dataType']}">
{data['value_str']}
</variable>"""

        elif mention_type == 'data':
            xml = f"""<data name="{data['name']}" type="{data['type']}">"""
            if 'summary' in data:
                xml += f"\n{data['summary']}"
            if 'columns_info' in data:
                xml += "\nColumns:"
                for col in data['columns_info']:
                    xml += f"\n  - {col['name']} ({col['type']})"
                    if 'samples' in col:
                        xml += f" - samples: {col['samples']}"
            if 'head' in data:
                xml += f"\n\nPreview:\n{data['head']}"
            xml += "\n</data>"
            return xml

        else:
            # Generic format
            return f"""<{mention_type} name="{data.get('name', 'unknown')}">
{json.dumps(data, indent=2, default=str)}
</{mention_type}>"""

    def resolve_all(self, text: str) -> ResolvedContext:
        """
        Resolve all @ mentions in text.

        Args:
            text: Input text with @ mentions

        Returns:
            ResolvedContext with resolved data
        """
        mentions = self.extract_mentions(text)
        resolved_data = {}
        xml_parts = []

        # Resolve variables
        for var_name in mentions.get('variable', []):
            data = self.resolve_variable(var_name)
            if data:
                resolved_data[f"variable://{var_name}"] = data
                xml_parts.append(self.format_as_xml('variable', data))

        # Resolve data/tables
        for table_name in mentions.get('data', []):
            data = self.resolve_data(table_name)
            if data:
                resolved_data[f"data://{table_name}"] = data
                xml_parts.append(self.format_as_xml('data', data))

        # TODO: Add support for cell-output, datasource, error, file
        # These would require access to marimo's internal state
        for mention_type in ['cell-output', 'datasource', 'error', 'file']:
            if mention_type in mentions:
                xml_parts.append(f"<!-- {mention_type} mentions not yet supported in Python resolver -->")

        return ResolvedContext(
            plain_text="\n\n".join(xml_parts),
            mentions=resolved_data,
            messages=[],  # Will be set by caller
        )


def resolve_mentions(
    messages: List[Any],
    namespace: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Resolve @ mentions in chat messages.

    Args:
        messages: List of chat messages
        namespace: Variable namespace (defaults to caller's locals())

    Returns:
        Dictionary with 'context' (ResolvedContext) and 'messages' (original)

    Example:
        def my_model(messages, config):
            resolved = resolve_mentions(messages, locals())
            context = resolved['context']

            # Use context.plain_text for LLM prompt
            prompt = f"Context:\n{context.plain_text}\n\nUser: {messages[-1].content}"
            return call_llm(prompt)
    """
    import inspect

    if namespace is None:
        # Get caller's locals
        frame = inspect.currentframe()
        if frame and frame.f_back:
            namespace = frame.f_back.f_locals
        else:
            namespace = {}

    resolver = MentionResolver(namespace)

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


def create_context_aware_model(model_fn: Callable) -> Callable:
    """
    Decorator to automatically resolve @ mentions in model function.

    The decorated function will receive an additional 'context' parameter
    with resolved @ mention data.

    Args:
        model_fn: Model function with signature (messages, config, context=None)

    Returns:
        Wrapped function that auto-resolves @ mentions

    Example:
        @create_context_aware_model
        def my_model(messages, config, context=None):
            if context and context.plain_text:
                # Use resolved context
                prompt = f"Context:\n{context.plain_text}\n\nUser: {messages[-1].content}"
            else:
                prompt = messages[-1].content

            return call_llm(prompt)

        chat = mo.ui.chat(my_model)
    """
    import inspect

    def wrapper(messages, config=None):
        # Get the caller's frame to access their namespace
        frame = inspect.currentframe()
        namespace = {}

        # Walk up the call stack to find the notebook's namespace
        current_frame = frame
        while current_frame:
            if '__name__' in current_frame.f_locals:
                namespace = {**namespace, **current_frame.f_locals}
            current_frame = current_frame.f_back

        # Resolve mentions
        resolved = resolve_mentions(messages, namespace)
        context = resolved['context']

        # Call original function with context
        sig = inspect.signature(model_fn)
        if 'context' in sig.parameters:
            return model_fn(messages, config, context=context)
        else:
            # Function doesn't accept context, call normally
            return model_fn(messages, config)

    return wrapper


# Example usage
if __name__ == "__main__":
    # Test the resolver
    import pandas as pd

    # Create test data
    test_data = pd.DataFrame({'a': [1, 2, 3], 'b': [4, 5, 6]})
    test_var = "hello world"

    # Test extraction
    text = "Can you analyze @variable://test_var and @data://test_data?"

    resolver = MentionResolver(locals())
    mentions = resolver.extract_mentions(text)
    print("Extracted mentions:", mentions)

    context = resolver.resolve_all(text)
    print("\nResolved context:")
    print(context.plain_text)
    print("\nMentions data:")
    for key, value in context.mentions.items():
        print(f"  {key}: {value.get('name')}")
