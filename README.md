# AgentZero: Local Agentic AI Desktop

AgentZero is a high-performance, private-first AI agent powered by **smolagents** and **llama3.1**. It implements the **LLM Wiki** ("Compile, Don't Retrieve") pattern to create a persistent, compounding personal knowledge base.

## 🚀 Key Features
- **Local-First**: Runs entirely on your GPU (via Ollama). No cloud APIs, no data leaks.
- **LLM Wiki Memory**: Instead of ephemeral RAG, the agent compiles knowledge into structured Markdown pages.
- **Global Library**: Pull shared, community-curated knowledge into your local wiki.
- **GPU Monitor**: Real-time tracking of VRAM, utility, and power.
- **Electron IPC Stack**: Secure, performant communication between UI and Python engine.

## 📁 Directory Structure
- `wiki/`: Your personal knowledge base (ignored by Git).
- `raw/`: Immutable source documents (ignored by Git).
- `global_library/`: Shared community knowledge (committed to Git).
- `backend/`: FastAPI engine + smolagents logic.
- `desktop-app/`: Electron + React (Vite) frontend.

## 🛠️ Setup
1. **Ollama**: Install and run `ollama serve`. Pull `llama3.1`.
2. **Backend**: 
   ```bash
   pip install smolagents fastapi uvicorn smolagents[duckduckgo] python-multipart requests
   ```
3. **Frontend**:
   ```bash
   cd desktop-app
   npm install
   npm run dev
   ```

## 🧠 The LLM Wiki Pattern
Inspired by Andrej Karpathy's "Compile, Don't Retrieve" framing. AgentZero doesn't just search your docs; it *understands* them and synthesizes them into an interlinked web of entities, concepts, and topics.

---
*Built for the local-first AI future.*
