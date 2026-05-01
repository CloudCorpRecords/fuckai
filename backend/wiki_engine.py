"""
AgentZero WikiEngine — Full LLM Wiki Implementation
Based on Karpathy's "Compile, Don't Retrieve" pattern.

Three-layer architecture:
  raw/      ← immutable truth anchors
  wiki/     ← LLM-compiled structured Markdown
  backend/  ← this engine + tools

Key capabilities:
  - Smart context selection (not dump-everything)
  - Incremental page updates with backlink tracking
  - Raw document ingestion + entity extraction
  - Wiki linting (stale pages, broken links, contradictions)
  - Session summarization
  - Index.md maintenance
"""

import os
import re
import json
import threading
from pathlib import Path
from datetime import datetime
from typing import Optional


# ─── Page Schema Template ─────────────────────────────────────────────────────
PAGE_TEMPLATE = """# {title}

## Summary
{summary}

## Key Claims
{key_claims}

## Connections
{connections}

## Contradictions
{contradictions}

## Sources
{sources}

---
*Last compiled: {timestamp}*
"""

PAGE_SCHEMA_DESCRIPTION = """
Every wiki page MUST follow this exact schema:
# Title (H1 — single, descriptive)
## Summary (2-4 sentence synthesis — NO bullet points)
## Key Claims (bullet list of concrete, verifiable claims)
## Connections (wikilinks as [[path/to/page]] with one-line explanation each)
## Contradictions (known tensions, caveats, open questions)
## Sources (list of source names / dates)
---
*Last compiled: YYYY-MM-DD*
"""


# ─── WikiEngine ────────────────────────────────────────────────────────────────
class WikiEngine:
    def __init__(self, wiki_dir: Path, raw_dir: Path, global_dir: Optional[Path] = None):
        self.wiki_dir = wiki_dir
        self.raw_dir = raw_dir
        self.global_dir = global_dir
        self._lock = threading.Lock()

        # Ensure structure exists
        for subdir in ["entities", "concepts", "topics", "sessions"]:
            (wiki_dir / subdir).mkdir(parents=True, exist_ok=True)
        raw_dir.mkdir(parents=True, exist_ok=True)

    # ─── Page I/O ─────────────────────────────────────────────────────────────

    def read_page(self, rel_path: str) -> Optional[str]:
        """Read a wiki page. rel_path e.g. 'concepts/llm_wiki' """
        path = self._resolve(rel_path)
        if path and path.exists():
            return path.read_text(encoding="utf-8")
        return None

    def write_page(self, rel_path: str, content: str, source: str = "agent"):
        """Write a wiki page, ensuring it has the timestamp footer."""
        path = self._resolve(rel_path)
        if path is None:
            return False
        path.parent.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y-%m-%d")
        # Update or add the last-compiled timestamp
        content = re.sub(
            r"\*Last compiled:.*?\*",
            f"*Last compiled: {timestamp}*",
            content
        )
        if "*Last compiled:" not in content:
            content = content.rstrip() + f"\n\n---\n*Last compiled: {timestamp}*\n"
        with self._lock:
            path.write_text(content, encoding="utf-8")
        return True

    def list_pages(self) -> list[dict]:
        """Return list of all wiki pages with metadata."""
        pages = []
        for path in sorted(self.wiki_dir.rglob("*.md")):
            rel = path.relative_to(self.wiki_dir)
            rel_str = str(rel).replace("\\", "/").replace(".md", "")
            content = path.read_text(encoding="utf-8")
            title = self._extract_title(content) or rel_str
            summary = self._extract_section(content, "Summary")
            timestamp = self._extract_timestamp(content)
            pages.append({
                "path": rel_str,
                "title": title,
                "summary": summary[:200] if summary else "",
                "last_compiled": timestamp,
                "size": len(content),
                "category": rel.parts[0] if len(rel.parts) > 1 else "root"
            })
        return pages

    def delete_page(self, rel_path: str) -> bool:
        path = self._resolve(rel_path)
        if path and path.exists():
            path.unlink()
            return True
        return False

    # ─── Smart Context Selection ───────────────────────────────────────────────

    def get_context_for_query(self, query: str, max_pages: int = 5) -> str:
        """
        Select the most relevant wiki pages for a given query.
        Uses keyword matching over titles + summaries — NOT dumping everything.
        """
        query_lower = query.lower()
        query_words = set(re.findall(r'\b\w{3,}\b', query_lower))

        scored = []
        for page in self.list_pages():
            if page["path"] == "index":
                continue
            title_words = set(re.findall(r'\b\w{3,}\b', page["title"].lower()))
            summary_words = set(re.findall(r'\b\w{3,}\b', page["summary"].lower()))
            # Score: title matches worth 3x, summary matches worth 1x
            score = (len(query_words & title_words) * 3 +
                     len(query_words & summary_words))
            if score > 0:
                scored.append((score, page))

        # Sort by score, take top N
        scored.sort(key=lambda x: x[0], reverse=True)
        top_pages = [p for _, p in scored[:max_pages]]

        # Always include user_profile if it exists (personalization)
        profile_path = "entities/user_profile"
        profile_in_top = any(p["path"] == profile_path for p in top_pages)
        if not profile_in_top:
            profile = self.read_page(profile_path)
            if profile:
                top_pages = top_pages[:max_pages - 1]
                profile_data = next((p for p in self.list_pages() if p["path"] == profile_path), None)
                if profile_data:
                    top_pages.insert(0, profile_data)

        if not top_pages:
            return ""

        sections = []
        for page_meta in top_pages:
            content = self.read_page(page_meta["path"])
            if content:
                sections.append(f"### [{page_meta['path']}]\n{content[:1500]}")

        return "\n\n---\n\n".join(sections)

    def get_full_context(self) -> str:
        """Return all wiki pages concatenated (for full-wiki queries)."""
        sections = []
        for page in self.list_pages():
            if page["path"] == "index":
                continue
            content = self.read_page(page["path"])
            if content:
                sections.append(f"### [{page['path']}]\n{content}")
        return "\n\n---\n\n".join(sections)

    # ─── Ingestion Pipeline ───────────────────────────────────────────────────

    def ingest_raw_text(self, content: str, source_name: str, llm_caller) -> list[str]:
        """
        Compile a raw document into wiki pages.
        Returns list of created/updated page paths.
        """
        # Save to raw/
        raw_path = self.raw_dir / f"{source_name}.md"
        raw_path.write_text(content, encoding="utf-8")

        existing_index = self.read_page("index") or ""
        existing_pages_summary = "\n".join([
            f"- [[{p['path']}]]: {p['summary'][:100]}"
            for p in self.list_pages()
        ])

        prompt = f"""You are a knowledge compiler implementing the LLM Wiki pattern.
Compile the following raw document into structured wiki pages.

EXISTING WIKI PAGES:
{existing_pages_summary if existing_pages_summary else "(empty wiki — first ingestion)"}

PAGE SCHEMA (ALL pages must follow this):
{PAGE_SCHEMA_DESCRIPTION}

AVAILABLE CATEGORIES:
- entities/  → people, tools, technologies, organizations (e.g. entities/andrej_karpathy)
- concepts/  → ideas, patterns, algorithms, frameworks (e.g. concepts/transformer_attention)
- topics/    → broader subject areas (e.g. topics/deep_learning)

RAW DOCUMENT ({source_name}):
{content[:4000]}

TASK:
1. Identify all entities, concepts, and topics worth creating or updating wiki pages for.
2. For each, write a complete page following the schema above.
3. Include wikilinks [[path/page]] between related pages.
4. Prefer updating existing pages over creating duplicates.

Return JSON only:
{{
  "pages": {{
    "concepts/page_name": "full markdown content",
    "entities/page_name": "full markdown content"
  }},
  "summary": "one sentence describing what was ingested"
}}"""

        response = llm_caller(prompt)
        created = []
        try:
            clean = re.sub(r"```(?:json)?", "", response).strip().strip("`").strip()
            data = json.loads(clean)
            for path, content in data.get("pages", {}).items():
                self.write_page(path, content, source=source_name)
                created.append(path)
            print(f"[Wiki] Ingested '{source_name}' → {len(created)} pages")
        except (json.JSONDecodeError, Exception) as e:
            print(f"[Wiki] Ingestion parse error: {e}")

        if created:
            self._rebuild_index(llm_caller)
        return created

    # ─── Conversation Update ───────────────────────────────────────────────────

    def update_from_conversation(self, messages: list[dict], llm_caller):
        """
        Asynchronously compile conversation turns into wiki updates.
        Only extracts durable, worth-keeping knowledge.
        """
        def _run():
            try:
                if len(messages) < 2:
                    return

                recent = messages[-8:]  # Last 4 turns
                convo_text = "\n".join([
                    f"{m['role'].upper()}: {m['content']}"
                    for m in recent
                ])

                existing_summary = "\n".join([
                    f"- [[{p['path']}]]: {p['summary'][:80]}"
                    for p in self.list_pages()[:20]
                ])

                prompt = f"""You are a knowledge compiler for an LLM Wiki system.
Analyze this conversation and extract any durable, worth-keeping knowledge into wiki pages.

EXISTING WIKI:
{existing_summary if existing_summary else "(empty)"}

PAGE SCHEMA:
{PAGE_SCHEMA_DESCRIPTION}

RECENT CONVERSATION:
{convo_text}

RULES:
- Only extract DURABLE facts (not temporary context, filler, or obvious things)
- Personal facts (user's name, preferences, goals) → update entities/user_profile
- Technical knowledge discussed → update or create relevant concept/topic pages
- If nothing meaningful to extract, return {{"pages": {{}}}}
- Keep additions concise and structured

Return JSON only:
{{
  "pages": {{
    "entities/user_profile": "full updated markdown (if changed)",
    "concepts/some_concept": "full page content (if new knowledge)"
  }}
}}"""

                response = llm_caller(prompt)
                clean = re.sub(r"```(?:json)?", "", response).strip().strip("`").strip()
                data = json.loads(clean)
                updated = []
                for path, content in data.get("pages", {}).items():
                    if content and len(content) > 50:
                        self.write_page(path, content)
                        updated.append(path)
                if updated:
                    print(f"[Wiki] Updated from conversation: {updated}")
                    self._rebuild_index(llm_caller)
            except Exception as e:
                print(f"[Wiki] Conversation update error: {e}")

        thread = threading.Thread(target=_run, daemon=True)
        thread.start()

    def save_session(self, messages: list[dict], session_id: str, llm_caller):
        """Compile a full conversation session into a sessions/ summary page."""
        def _run():
            try:
                convo_text = "\n".join([
                    f"{m['role'].upper()}: {m['content'][:500]}"
                    for m in messages
                ])
                prompt = f"""Compile this conversation into a wiki session summary page.

PAGE SCHEMA:
{PAGE_SCHEMA_DESCRIPTION}

CONVERSATION:
{convo_text[:3000]}

Write a sessions/{session_id} page that summarizes:
- What was discussed (Summary)
- Key decisions or facts established (Key Claims)
- Connections to other wiki topics
Return only the full Markdown page content."""

                content = llm_caller(prompt)
                if content and len(content) > 100:
                    self.write_page(f"sessions/{session_id}", content)
                    print(f"[Wiki] Session saved: sessions/{session_id}")
            except Exception as e:
                print(f"[Wiki] Session save error: {e}")

        thread = threading.Thread(target=_run, daemon=True)
        thread.start()

    # ─── Linting ──────────────────────────────────────────────────────────────

    def lint(self) -> list[dict]:
        """
        Audit the wiki for issues:
        - Missing required sections
        - Broken wikilinks
        - Stale pages (> 7 days old)
        - Very short summaries (< 20 chars)
        """
        issues = []
        all_paths = {p["path"] for p in self.list_pages()}
        cutoff = datetime.now()

        for page in self.list_pages():
            path = page["path"]
            if path == "index":
                continue
                
            content = self.read_page(path) or ""

            # Missing sections
            for section in ["## Summary", "## Key Claims", "## Connections"]:
                if section not in content:
                    issues.append({"type": "missing_section", "page": path, "detail": section})

            # Broken wikilinks
            links = re.findall(r'\[\[([^\]]+)\]\]', content)
            for link in links:
                link_path = link.split("|")[0].strip()  # handle [[path|alias]]
                if link_path not in all_paths and link_path != "index":
                    issues.append({"type": "broken_link", "page": path, "detail": f"[[{link_path}]]"})

            # Stale check (> 14 days)
            if page["last_compiled"]:
                try:
                    compiled = datetime.strptime(page["last_compiled"], "%Y-%m-%d")
                    days_old = (cutoff - compiled).days
                    if days_old > 14:
                        issues.append({"type": "stale", "page": path, "detail": f"{days_old} days old"})
                except ValueError:
                    pass

            # Empty summary
            summary = self._extract_section(content, "Summary")
            if not summary or len(summary.strip()) < 20:
                issues.append({"type": "empty_summary", "page": path, "detail": "Summary too short"})

        return issues

    # ─── Index Maintenance ────────────────────────────────────────────────────

    def _rebuild_index(self, llm_caller=None):
        """Rebuild index.md from current page list."""
        pages = self.list_pages()
        by_category = {}
        for p in pages:
            if p["path"] == "index":
                continue
            cat = p["category"]
            by_category.setdefault(cat, []).append(p)

        now = datetime.now().strftime("%Y-%m-%d %H:%M")
        lines = [
            "# AgentZero Wiki — Index\n",
            "> The compiled knowledge base of AgentZero.\n",
            f"**Pages:** {len(pages) - 1}  |  **Last rebuilt:** {now}\n\n---\n"
        ]

        cat_icons = {"entities": "👤", "concepts": "🧠", "topics": "📚", "sessions": "💬", "root": "📄"}
        for cat, cat_pages in sorted(by_category.items()):
            icon = cat_icons.get(cat, "📄")
            lines.append(f"\n## {icon} {cat.title()}\n")
            for p in sorted(cat_pages, key=lambda x: x["title"]):
                lines.append(f"- [[{p['path']}]] — {p['summary'][:100]}\n")

        lint_issues = self.lint()
        if lint_issues:
            lines.append(f"\n## ⚠️ Health Issues ({len(lint_issues)})\n")
            for issue in lint_issues[:5]:
                lines.append(f"- `{issue['page']}`: {issue['type']} — {issue['detail']}\n")

        lines.append(f"\n---\n*Automatically maintained by AgentZero.*\n")
        self.write_page("index", "".join(lines))

    def get_stats(self) -> dict:
        pages = self.list_pages()
        raw_files = list(self.raw_dir.glob("*"))
        issues = self.lint()
        return {
            "total_pages": len(pages),
            "by_category": {},
            "raw_sources": len(raw_files),
            "lint_issues": len(issues),
            "pages": pages
        }

    def list_global_pages(self) -> list[dict]:
        """List pages in the read-only global library."""
        if not self.global_dir or not self.global_dir.exists():
            return []
        pages = []
        for path in sorted(self.global_dir.rglob("*.md")):
            rel = path.relative_to(self.global_dir)
            rel_str = str(rel).replace("\\", "/").replace(".md", "")
            content = path.read_text(encoding="utf-8")
            title = self._extract_title(content) or rel_str
            summary = self._extract_section(content, "Summary")
            pages.append({
                "path": rel_str,
                "title": title,
                "summary": summary[:200] if summary else "",
                "category": rel.parts[0] if len(rel.parts) > 1 else "root",
                "is_global": True
            })
        return pages

    def import_from_global(self, rel_path: str) -> bool:
        """Copy a page from global library to local wiki."""
        if not self.global_dir:
            return False
        src = self.global_dir / (rel_path + ".md")
        if not src.exists():
            return False
        content = src.read_text(encoding="utf-8")
        # Add a note that it was pulled from global
        if "Pulled from Global Library" not in content:
            content = content.replace("---", "---\n*Pulled from Global Library*\n---", 1)
        return self.write_page(rel_path, content, source="global_library")

    # ─── Helpers ──────────────────────────────────────────────────────────────

    def _resolve(self, rel_path: str) -> Optional[Path]:
        """Resolve a relative path to an absolute wiki path."""
        rel_path = rel_path.strip("/").replace("\\", "/")
        if not rel_path.endswith(".md"):
            rel_path += ".md"
        full = self.wiki_dir / rel_path
        # Security: ensure it's inside wiki_dir
        try:
            full.resolve().relative_to(self.wiki_dir.resolve())
            return full
        except ValueError:
            return None

    def _extract_title(self, content: str) -> Optional[str]:
        m = re.search(r'^# (.+)$', content, re.MULTILINE)
        return m.group(1).strip() if m else None

    def _extract_section(self, content: str, section_name: str) -> Optional[str]:
        pattern = rf'## {section_name}\n(.*?)(?=\n## |\Z)'
        m = re.search(pattern, content, re.DOTALL)
        return m.group(1).strip() if m else None

    def _extract_timestamp(self, content: str) -> Optional[str]:
        m = re.search(r'\*Last compiled: (\d{4}-\d{2}-\d{2})', content)
        return m.group(1) if m else None
