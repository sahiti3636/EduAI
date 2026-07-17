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
    
    # Batch embeddings to avoid TPM/RPM free tier limits
    batch_size = 10
    import time
    for i in range(0, len(_chunks), batch_size):
        batch = _chunks[i:i + batch_size]
        texts = [c["text"] for c in batch]
        batch_vecs = llm.embed_batch(texts)
        vectors.extend(batch_vecs)
        time.sleep(2) # Avoid TPM limit bursts

    _embeddings = np.array(vectors)

    # Save to cache
    _EMBEDDINGS_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_EMBEDDINGS_CACHE_PATH, "wb") as f:
        pickle.dump(_embeddings, f)
    print("Saved embeddings cache.")


def search(query: str, top_k: int = 1) -> str | None:
    """Returns the most semantically relevant textbook chunk for a query."""
    import os
    if os.environ.get("DEMO_MODE") == "true":
        return "[Source: jemh104.pdf (Page 6)]\nQUADRA TIC EQUA TIONS 43 Note that we have found the roots of  2 x2 – 5 x + 3 = 0 by factorising 2x2 – 5 x + 3 into two linear factors and equating each factor to zero . Example 4 : Find the roots of the quadratic equation 6 x2 – x – 2 = 0. Solution : We have 6x2 – x – 2 = 6 x2 + 3x – 4x – 2 =3 x (2x + 1) – 2 (2 x + 1) =( 3x – 2)(2x + 1)"

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
