from pathlib import Path
from wiki_engine import WikiEngine

BACKEND_DIR = Path(__file__).parent
WIKI_DIR = BACKEND_DIR.parent / "wiki"
RAW_DIR = BACKEND_DIR.parent / "raw"

wiki = WikiEngine(WIKI_DIR, RAW_DIR)
print("Rebuilding wiki index...")
wiki._rebuild_index()
print("Done.")
