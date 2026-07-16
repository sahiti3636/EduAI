import json
import os
import pickle
from pathlib import Path

import numpy as np

from app.gemini_client import get_llm_client

_TEXTBOOK_PATH = Path("backend/data/textbook.json")
_EMBEDDINGS_CACHE_PATH = Path("backend/data/textbook_embeddings.pkl")

# In-memory vector store
_chunks: list[dict] = []
_embeddings: np.ndarray | None = None


def _load_and_embed_all():
    global _chunks, _embeddings
    if not _TEXTBOOK_PATH.exists():
        return

    with open(_TEXTBOOK_PATH, "r", encoding="utf-8") as f:
        _chunks = json.load(f)

    if not _chunks:
        return

    # Check for cached embeddings
    if _EMBEDDINGS_CACHE_PATH.exists():
        with open(_EMBEDDINGS_CACHE_PATH, "rb") as f:
            _embeddings = pickle.load(f)
        if len(_embeddings) == len(_chunks):
            return  # Cache is valid

    print("Generating embeddings for textbook... (this may take a minute)")
    llm = get_llm_client()
    vectors = []
    
    # Batch embeddings to avoid 429 rate limits (15 RPM free tier)
    batch_size = 50
    for i in range(0, len(_chunks), batch_size):
        batch = _chunks[i:i + batch_size]
        texts = [c["text"] for c in batch]
        batch_vecs = llm.embed_batch(texts)
        vectors.extend(batch_vecs)

    _embeddings = np.array(vectors)

    # Save to cache
    _EMBEDDINGS_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_EMBEDDINGS_CACHE_PATH, "wb") as f:
        pickle.dump(_embeddings, f)
    print("Saved embeddings cache.")


def search(query: str, top_k: int = 1) -> str | None:
    """Returns the most semantically relevant textbook chunk for a query."""
    if _embeddings is None:
        try:
            _load_and_embed_all()
        except Exception as e:
            print(f"Failed to load RAG vectors: {e}")
            return None

    if _embeddings is None or len(_embeddings) == 0:
        return None

    llm = get_llm_client()
    try:
        query_vec = np.array(llm.embed(query))
    except Exception:
        return None

    # Compute cosine similarities
    # Dot product of query with all embeddings
    # Assuming embeddings are not perfectly normalized, compute full cosine similarity
    dot_products = np.dot(_embeddings, query_vec)
    norms_emb = np.linalg.norm(_embeddings, axis=1)
    norm_query = np.linalg.norm(query_vec)
    
    # Avoid division by zero
    norms = norms_emb * norm_query
    norms[norms == 0] = 1e-10
    
    similarities = dot_products / norms

    # Get top k indices
    top_indices = np.argsort(similarities)[-top_k:][::-1]
    
    results = []
    for idx in top_indices:
        chunk = _chunks[idx]
        results.append(f"[Source: {chunk.get('source', 'Textbook')} (Page {chunk.get('page', '?')})]\n{chunk['text']}")
        
    return "\n\n".join(results)
