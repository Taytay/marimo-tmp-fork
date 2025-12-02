# Proposed Fix: Add @ Mention Resolution to mo.ui.chat

## The Problem

Currently, `mo.ui.chat` shows @ mention autocomplete (via `resourceExtension`), but when you submit a message with `@data://df`, it only sends the raw text to Python, not the resolved metadata.

## The Solution

Modify `chat-ui.tsx` to call `buildCompletionRequestBody` (just like the editor chat does) before sending to Python.

## Code Changes

### File: frontend/src/plugins/impl/chat/chat-ui.tsx

#### 1. Add import at top (around line 22)
```typescript
import { buildCompletionRequestBody } from "@/components/chat/chat-utils";
```

#### 2. Modify the form onSubmit handler (around line 510)

**Current code:**
```typescript
<form
  onSubmit={async (evt) => {
    evt.preventDefault();

    const fileParts = files
      ? await convertToFileUIPart(files)
      : undefined;

    sendMessage({
      role: "user",
      parts: [{ type: "text", text: input }, ...(fileParts ?? [])],
    });
    resetInput();
  }}
```

**New code:**
```typescript
<form
  onSubmit={async (evt) => {
    evt.preventDefault();

    const fileParts = files
      ? await convertToFileUIPart(files)
      : undefined;

    // BUILD THE MESSAGE FIRST
    const userMessage = {
      role: "user" as const,
      parts: [{ type: "text", text: input }, ...(fileParts ?? [])],
    };

    // RESOLVE @ MENTIONS
    const completionBody = await buildCompletionRequestBody([userMessage]);

    // Send the message (frontend display)
    sendMessage(userMessage);

    // Note: completionBody.context contains the resolved XML
    // But we need to pass this to the Python backend...
    // See next section for backend changes needed

    resetInput();
  }}
```

#### 3. Problem: Python backend needs to receive context

The `send_prompt` function in chat.py currently only receives messages, not context.

We need to modify the Python backend to accept optional context.

---

## Backend Changes Needed

### File: marimo/_plugins/ui/_impl/chat/chat.py

#### 1. Modify SendMessageRequest dataclass (around line 33)

**Current:**
```python
@dataclass
class SendMessageRequest:
    messages: list[ChatMessage]
    config: ChatModelConfig
```

**New:**
```python
from marimo._server.models.completion import AiCompletionContext

@dataclass
class SendMessageRequest:
    messages: list[ChatMessage]
    config: ChatModelConfig
    context: Optional[AiCompletionContext] = None  # NEW!
```

#### 2. Modify ChatMessage to include resolved context

**Option A: Add context to each message**
```python
class ChatMessage(msgspec.Struct):
    role: Literal["user", "assistant", "system"]
    content: Any
    attachments: Optional[list[ChatAttachment]] = None
    parts: Optional[list[ChatPart]] = None
    resolved_context: Optional[str] = None  # NEW: XML context
```

**Option B: Pass context separately to model function**

Modify the model function signature to optionally receive context:

```python
def my_model(messages, config, context=None):
    # context is automatically provided if @ mentions exist
    if context and context.plain_text:
        # Use the resolved XML context
        prompt = f"Context:\n{context.plain_text}\n\nUser: {messages[-1].content}"
    else:
        prompt = messages[-1].content

    return call_llm(prompt)
```

---

## Frontend Changes (Complete Implementation)

### File: frontend/src/plugins/impl/chat/chat-ui.tsx

```typescript
<form
  onSubmit={async (evt) => {
    evt.preventDefault();

    const fileParts = files
      ? await convertToFileUIPart(files)
      : undefined;

    // Build message with parts
    const userMessage: UIMessage = {
      id: Date.now().toString(),
      role: "user",
      parts: [{ type: "text", text: input }, ...(fileParts ?? [])],
    };

    // Resolve @ mentions (this extracts context)
    const completionBody = await buildCompletionRequestBody([userMessage]);

    // Send message to frontend (for display)
    sendMessage(userMessage);

    // The completionBody now contains:
    // - completionBody.context.plainText: XML with resolved data
    // - completionBody.messages: original messages
    //
    // We need to somehow pass completionBody.context to the Python backend
    // This requires modifying the transport to include context

    resetInput();
  }}
```

### Problem: The transport needs modification

The current transport (line 109-189) directly calls `props.send_prompt({ messages, config })`.

We need to modify it to also pass `context`.

#### Modified transport (around line 142)

**Current:**
```typescript
const response = await props.send_prompt({
  messages: messages,
  config: {
    max_tokens: config.max_tokens,
    temperature: config.temperature,
    top_p: config.top_p,
    top_k: config.top_k,
    frequency_penalty: config.frequency_penalty,
    presence_penalty: config.presence_penalty,
  },
});
```

**New:** (requires passing context somehow - this is the tricky part)

The issue is that `buildCompletionRequestBody` is called in the form's `onSubmit`, but the actual backend call happens in the transport's fetch function. We need to make the context available there.

---

## Recommended Approach: Store context in React state

```typescript
// Add state for resolved context
const [pendingContext, setPendingContext] = useState<any>(null);

// In form onSubmit:
const completionBody = await buildCompletionRequestBody([userMessage]);
setPendingContext(completionBody.context);
sendMessage(userMessage);

// In transport fetch:
const response = await props.send_prompt({
  messages: messages,
  config: { ... },
  context: pendingContext,  // Pass the context!
});
setPendingContext(null);  // Clear after sending
```

---

## Full Implementation Summary

### Changes Needed:

1. **Frontend (TypeScript):**
   - Import `buildCompletionRequestBody`
   - Add state to store resolved context
   - Call `buildCompletionRequestBody` in form submit
   - Pass context to `send_prompt`

2. **Backend (Python):**
   - Modify `SendMessageRequest` to accept optional `context`
   - Modify model function signature to accept optional `context` parameter
   - Pass context to user's model function

3. **Types (TypeScript → Python):**
   - Update the ChatPlugin interface to include context in send_prompt
   - Regenerate OpenAPI types if needed

---

## Benefit

After these changes, users could write:

```python
def my_model(messages, config, context=None):
    prompt = messages[-1].content

    # Context is automatically resolved!
    if context and context.plain_text:
        prompt = f"{context.plain_text}\n\n{prompt}"

    return call_llm(prompt)

chat = mo.ui.chat(my_model)
```

And typing `@data://df` would automatically resolve to XML with shape, columns, samples, etc.

---

## Alternative: Use the Python helper I created

Until this is implemented in marimo core, users can use the `chat_mention_resolver.py` helper I created earlier, which resolves mentions on the Python side.
