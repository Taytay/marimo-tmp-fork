"""
Example: Using @ mentions in mo.ui.chat

This notebook demonstrates how to use @ mention resolution in marimo chat widgets.
You can type @variable://name or @data://table in the chat to reference notebook data.
"""

import marimo

__generated_with = "0.9.0"
app = marimo.App(width="medium")


@app.cell
def _():
    import marimo as mo
    import pandas as pd
    import numpy as np
    return mo, pd, np


@app.cell
def _(pd, np):
    """Create some sample data for testing @ mentions."""

    # Sample DataFrame
    sales_data = pd.DataFrame({
        'product': ['Widget', 'Gadget', 'Doohickey', 'Thingamajig'],
        'sales': [100, 150, 75, 200],
        'region': ['North', 'South', 'East', 'West'],
        'profit': [1000, 2250, 900, 3500]
    })

    # Another DataFrame
    customer_data = pd.DataFrame({
        'name': ['Alice', 'Bob', 'Charlie', 'Diana'],
        'age': [25, 30, 35, 28],
        'city': ['NYC', 'LA', 'Chicago', 'Boston']
    })

    # Some variables
    total_revenue = sales_data['sales'].sum()
    best_product = sales_data.loc[sales_data['sales'].idxmax(), 'product']
    company_name = "Acme Corporation"

    return sales_data, customer_data, total_revenue, best_product, company_name


@app.cell
def _(mo):
    """Import the mention resolver."""
    from chat_mention_resolver import resolve_mentions, create_context_aware_model
    return resolve_mentions, create_context_aware_model


@app.cell
def _(mo):
    """
    Example 1: Simple model with manual resolution.

    Try typing in the chat:
    - "Show me @data://sales_data"
    - "What is @variable://best_product"
    - "Compare @data://sales_data and @data://customer_data"
    """

    # Simple echo model that shows resolved context
    def simple_model(messages, config):
        from chat_mention_resolver import resolve_mentions

        # Resolve @ mentions
        resolved = resolve_mentions(messages, locals())
        context = resolved['context']

        # Get user message
        user_msg = messages[-1].content

        # Build response
        response = f"**User message:**\n{user_msg}\n\n"

        if context.plain_text:
            response += f"**Resolved context:**\n```xml\n{context.plain_text}\n```\n\n"
            response += f"**Mentioned data:** {list(context.mentions.keys())}"
        else:
            response += "*No @ mentions found in message*"

        return response

    simple_chat = mo.ui.chat(simple_model)
    return simple_model, simple_chat


@app.cell
def _(simple_chat):
    """Display the simple chat."""
    simple_chat
    return


@app.cell
def _(mo):
    """
    Example 2: Model with LLM integration (using decorator).

    This uses the @create_context_aware_model decorator to automatically
    resolve mentions and pass them as a 'context' parameter.
    """

    @create_context_aware_model
    def smart_model(messages, config, context=None):
        """Model that uses context to answer questions about data."""

        user_msg = messages[-1].content

        # Simple rule-based responses (replace with actual LLM call)
        response = f"I received your message: {user_msg}\n\n"

        if context and context.plain_text:
            response += "I can see you mentioned some data:\n\n"

            # Extract data from mentions
            for mention_uri, mention_data in context.mentions.items():
                name = mention_data.get('name', 'unknown')
                data_type = mention_data.get('dataType') or mention_data.get('type')

                response += f"- **{name}** ({data_type})\n"

                # Add specific info based on type
                if 'shape' in mention_data:
                    response += f"  - Shape: {mention_data['shape']}\n"
                if 'summary' in mention_data:
                    response += f"  - Summary: {mention_data['summary']}\n"

            response += "\n*In a real implementation, this would be sent to an LLM!*"
        else:
            response += "No @ mentions found. Try typing @data:// or @variable:// to reference notebook data!"

        return response

    smart_chat = mo.ui.chat(smart_model)
    return smart_model, smart_chat


@app.cell
def _(smart_chat):
    """Display the smart chat."""
    smart_chat
    return


@app.cell
def _(mo):
    """
    Example 3: Full LLM integration (OpenAI/Anthropic).

    Uncomment and configure with your API key.
    """

    # Uncomment to use with OpenAI:
    # import openai
    #
    # @create_context_aware_model
    # def openai_model(messages, config, context=None):
    #     # Build system prompt with context
    #     system_prompt = "You are a helpful data analysis assistant."
    #
    #     if context and context.plain_text:
    #         system_prompt += f"\n\nThe user has provided the following data context:\n{context.plain_text}"
    #
    #     # Convert to OpenAI format
    #     openai_messages = [{"role": "system", "content": system_prompt}]
    #     for msg in messages:
    #         openai_messages.append({
    #             "role": msg.role,
    #             "content": msg.content
    #         })
    #
    #     # Call OpenAI
    #     response = openai.chat.completions.create(
    #         model="gpt-4",
    #         messages=openai_messages,
    #         temperature=config.temperature if config else 0.7,
    #     )
    #
    #     return response.choices[0].message.content
    #
    # openai_chat = mo.ui.chat(openai_model)

    # Uncomment to use with Anthropic:
    # import anthropic
    #
    # @create_context_aware_model
    # def claude_model(messages, config, context=None):
    #     client = anthropic.Anthropic(api_key="your-api-key")
    #
    #     # Build system prompt with context
    #     system_prompt = "You are a helpful data analysis assistant."
    #
    #     if context and context.plain_text:
    #         system_prompt += f"\n\nThe user has provided the following data context:\n{context.plain_text}"
    #
    #     # Convert to Anthropic format
    #     anthropic_messages = []
    #     for msg in messages:
    #         anthropic_messages.append({
    #             "role": msg.role,
    #             "content": msg.content
    #         })
    #
    #     # Call Claude
    #     response = client.messages.create(
    #         model="claude-3-5-sonnet-20241022",
    #         max_tokens=config.max_tokens if config else 4096,
    #         system=system_prompt,
    #         messages=anthropic_messages,
    #     )
    #
    #     return response.content[0].text
    #
    # claude_chat = mo.ui.chat(claude_model)

    mo.md("See source for LLM integration examples")
    return


@app.cell
def _(mo):
    """
    Example 4: Advanced - Custom context formatting.

    You can access the raw data directly and format it however you want.
    """

    def custom_format_model(messages, config):
        from chat_mention_resolver import resolve_mentions

        resolved = resolve_mentions(messages, locals())
        context = resolved['context']
        user_msg = messages[-1].content

        # Build custom context string
        custom_context = ""

        for mention_uri, mention_data in context.mentions.items():
            if 'variable://' in mention_uri:
                # Custom variable formatting
                name = mention_data['name']
                value = mention_data['value']
                custom_context += f"Variable {name} = {value}\n"

            elif 'data://' in mention_uri:
                # Custom data formatting - include actual DataFrame
                name = mention_data['name']
                df = mention_data['value']

                # You have the actual DataFrame!
                custom_context += f"\n{name} statistics:\n"
                custom_context += str(df.describe()) + "\n"

        if custom_context:
            response = f"**Custom formatted context:**\n```\n{custom_context}\n```\n\n"
            response += f"**Your message:** {user_msg}"
        else:
            response = f"No data mentioned. Try @data://sales_data"

        return response

    custom_chat = mo.ui.chat(custom_format_model)
    return custom_format_model, custom_chat


@app.cell
def _(custom_chat):
    """Display the custom chat."""
    custom_chat
    return


@app.cell
def _(mo):
    """Usage instructions."""
    mo.md("""
    ## How to Use @ Mentions

    In any of the chat widgets above, you can reference notebook data using @ mentions:

    ### Supported Mention Types

    1. **`@variable://name`** - Reference any Python variable
       - Example: `@variable://total_revenue`
       - Example: `@variable://best_product`

    2. **`@data://name`** - Reference DataFrames or tables
       - Example: `@data://sales_data`
       - Example: `@data://customer_data`

    ### Try These Prompts

    - "What is the value of @variable://total_revenue?"
    - "Show me the first few rows of @data://sales_data"
    - "Compare @data://sales_data and @data://customer_data"
    - "What product is @variable://best_product and what are its sales in @data://sales_data?"

    ### What Gets Resolved

    When you type `@data://sales_data`, the resolver:
    1. Finds the DataFrame in your notebook scope
    2. Extracts metadata (shape, columns, types, sample values)
    3. Formats it as XML (compatible with marimo's format)
    4. Passes it to your model function

    You get access to:
    - The actual data object (`mention_data['value']`)
    - Formatted summary (`mention_data['summary']`)
    - Column information (`mention_data['columns_info']`)
    - Pre-formatted XML (`context.plain_text`)

    ### Notes

    - The autocomplete dropdown works automatically (provided by marimo)
    - Resolution happens in Python (on the backend)
    - You have full access to the actual data objects
    - Currently supports variables and DataFrames
    - Cell outputs, datasources, errors, and files require marimo's internal APIs
    """)
    return


if __name__ == "__main__":
    app.run()
