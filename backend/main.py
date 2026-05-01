"""
AgentZero Backend — Powered by LLM Wiki Engine
"""

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json
import asyncio
import threading
import re
import sys
import io
import requests
from pathlib import Path
from datetime import datetime
from wiki_engine import WikiEngine

# Fix Windows console encoding
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

app = FastAPI(title="AgentZero")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

# ─── Paths & Wiki ─────────────────────────────────────────────────────────────
BACKEND_DIR = Path(__file__).parent
WIKI_DIR = BACKEND_DIR.parent / "wiki"
RAW_DIR = BACKEND_DIR.parent / "raw"
GLOBAL_DIR = BACKEND_DIR.parent / "global_library"

wiki = WikiEngine(WIKI_DIR, RAW_DIR, global_dir=GLOBAL_DIR)

# ─── Session State ────────────────────────────────────────────────────────────
conversation_history: list[dict] = []
session_id = datetime.now().strftime("%Y-%m-%d_%H-%M")
MAX_HISTORY = 30
history_lock = threading.Lock()

# ─── LLM & Agent (lazy loaded) ───────────────────────────────────────────────
current_model = "llama3.1"
_model = None
_agent = None
_agent_lock = threading.Lock()


def get_model():
    global _model
    if _model is None:
        from smolagents import LiteLLMModel
        _model = LiteLLMModel(
            model_id=f"ollama_chat/{current_model}",
            api_base="http://localhost:11434",
            api_key="ollama"
        )
        print(f"[AgentZero] Model loaded: {current_model}")
    return _model


def get_agent():
    global _agent
    if _agent is None:
        with _agent_lock:
            if _agent is None:
                from smolagents import ToolCallingAgent, DuckDuckGoSearchTool
                _agent = ToolCallingAgent(
                    tools=[DuckDuckGoSearchTool()],
                    model=get_model(),
                    verbosity_level=0,
                    max_steps=5
                )
                print(f"[AgentZero] Agent ready with model: {current_model}")
    return _agent


def call_llm_direct(prompt: str) -> str:
    """Direct LLM call — bypasses agent loop. Used for wiki operations."""
    try:
        from smolagents.models import ChatMessage
        response = get_model()([ChatMessage(role="user", content=prompt)])
        return response.content if hasattr(response, 'content') else str(response)
    except Exception as e:
        return f'{{"pages": {{}}, "error": "{str(e)}"}}'


# ─── System Prompt Builder ────────────────────────────────────────────────────
def build_system_prompt(query: str) -> str:
    """Build prompt by selecting relevant wiki pages for this specific query."""
    wiki_context = wiki.get_context_for_query(query, max_pages=4)

    base = f"""You are AgentZero, a highly capable personal AI assistant running entirely locally on the user's GPU ({current_model}, RTX 3080 Ti).

PERSONALITY:
- Direct, intelligent, warm but efficient
- Conversational for casual chat — do NOT execute code or use tools for simple questions
- Use web search ONLY when you genuinely need current/real-world facts
- Never hallucinate. If you don't know something, say so clearly.
- Remember context from the conversation history provided to you.

"""
    if wiki_context:
        base += f"""YOUR COMPILED KNOWLEDGE (from wiki — pre-synthesized, not raw):
{wiki_context}

When answering, draw on the above wiki knowledge first before using tools.
"""
    return base


# ─── Chat ─────────────────────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []


async def run_chat_stream(message: str, history: list[dict]):
    loop = asyncio.get_event_loop()

    # Merge incoming history into session
    with history_lock:
        conversation_history.clear()
        conversation_history.extend(history[-MAX_HISTORY:])
        conversation_history.append({"role": "user", "content": message})

    yield f"data: {json.dumps({'type': 'status', 'content': 'Consulting wiki...'})}\n\n"

    try:
        # Build context-aware prompt
        system_prompt = build_system_prompt(message)
        agent = get_agent()
        agent.system_prompt = system_prompt

        # Build conversation history string for the model
        history_lines = []
        for m in conversation_history[:-1]:  # exclude current message
            role = "User" if m["role"] == "user" else "Assistant"
            history_lines.append(f"{role}: {m['content']}")

        if history_lines:
            full_prompt = "CONVERSATION HISTORY:\n" + "\n".join(history_lines[-10:]) + f"\n\nUser: {message}"
        else:
            full_prompt = message

        yield f"data: {json.dumps({'type': 'status', 'content': 'Thinking...'})}\n\n"

        def run_sync():
            return agent.run(full_prompt, reset=True)

        result = await loop.run_in_executor(None, run_sync)
        result_str = str(result)

        # Update history
        with history_lock:
            conversation_history.append({"role": "assistant", "content": result_str})

        # Background wiki update (non-blocking)
        snapshot = list(conversation_history)
        wiki.update_from_conversation(snapshot, call_llm_direct)

        yield f"data: {json.dumps({'type': 'response', 'content': result_str})}\n\n"

    except Exception as e:
        error_msg = f"Sorry, I ran into an error: {str(e)}"
        print(f"[AgentZero] Chat error: {e}")
        yield f"data: {json.dumps({'type': 'response', 'content': error_msg})}\n\n"

    finally:
        yield f"data: {json.dumps({'type': 'done'})}\n\n"


@app.post("/chat")
async def chat(request: ChatRequest):
    return StreamingResponse(run_chat_stream(request.message, request.history),
                              media_type="text/event-stream")


# ─── Wiki API ─────────────────────────────────────────────────────────────────
@app.get("/wiki/stats")
async def wiki_stats():
    return wiki.get_stats()


@app.get("/wiki/pages")
async def wiki_pages():
    return wiki.list_pages()


@app.get("/wiki/page")
async def wiki_page(path: str):
    content = wiki.read_page(path)
    if content is None:
        return {"error": "Page not found"}
    return {"path": path, "content": content}


@app.get("/wiki/index")
async def wiki_index():
    return {"content": wiki.read_page("index") or ""}


@app.get("/wiki/lint")
async def wiki_lint():
    return {"issues": wiki.lint()}


@app.post("/wiki/ingest")
async def wiki_ingest(source_name: str = Form(...), content: str = Form(...)):
    """Ingest raw text content into the wiki."""
    loop = asyncio.get_event_loop()
    created = await loop.run_in_executor(
        None, lambda: wiki.ingest_raw_text(content, source_name, call_llm_direct)
    )
    return {"created": created, "count": len(created)}


@app.post("/wiki/save-session")
async def save_session():
    """Save current session as a compiled wiki page."""
    with history_lock:
        snapshot = list(conversation_history)
    wiki.save_session(snapshot, session_id, call_llm_direct)
    return {"session_id": session_id, "status": "saving"}


@app.get("/wiki/global")
async def wiki_global():
    """List pages available in the global library."""
    return wiki.list_global_pages()


@app.post("/wiki/import")
async def wiki_import(path: str):
    """Import a page from global to local."""
    success = wiki.import_from_global(path)
    return {"success": success, "path": path}


@app.get("/wiki/graph")
async def wiki_graph():
    """Get the node-link graph data for the wiki."""
    return wiki.get_graph_data()


@app.post("/wiki/clip")
async def wiki_clip(url: str):
    """Clip a web page into the wiki."""
    return wiki.clip_url(url, llm_caller=call_llm_direct)

# ─── Models ───────────────────────────────────────────────────────────────────
@app.get("/models")
async def list_models():
    try:
        r = requests.get("http://localhost:11434/api/tags")
        return r.json()
    except Exception as e:
        return {"models": [], "error": str(e)}

@app.get("/models/current")
async def get_current_model():
    return {"current_model": current_model}

@app.post("/models/switch")
async def switch_model(name: str):
    global current_model, _model, _agent
    with _agent_lock:
        current_model = name
        _model = None
        _agent = None
    get_agent()  # Warm up new model
    return {"status": "switched", "model": current_model}

@app.post("/models/pull")
async def pull_model(name: str):
    async def generate():
        try:
            with requests.post("http://localhost:11434/api/pull", json={"name": name}, stream=True) as r:
                for line in r.iter_lines():
                    if line:
                        yield f"data: {line.decode('utf-8')}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield "data: {\"status\": \"success\"}\n\n"
    return StreamingResponse(generate(), media_type="text/event-stream")


# ─── Health ───────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    stats = wiki.get_stats()
    return {
        "status": "ok",
        "model": current_model,
        "agent_loaded": _agent is not None,
        "wiki_pages": stats["total_pages"],
        "wiki_issues": stats["lint_issues"]
    }


# ─── Startup ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn, socket, subprocess, sys, time

    PORT = 8765
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        if s.connect_ex(('127.0.0.1', PORT)) == 0:
            print(f"[AgentZero] Port {PORT} busy — clearing...")
            if sys.platform == 'win32':
                subprocess.call(
                    f'for /f "tokens=5" %a in (\'netstat -ano ^| findstr :{PORT}\') do taskkill /F /PID %a',
                    shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(1)

    # Build index on startup
    print("[AgentZero] Building wiki index...")
    wiki._rebuild_index()

    print(f"[AgentZero] Backend ready -> http://127.0.0.1:{PORT}")
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
