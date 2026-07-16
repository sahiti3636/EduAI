import json
import os
from pathlib import Path
from pypdf import PdfReader

def clean_text(text: str) -> str:
    # simple cleanup of extra spaces and newlines
    lines = text.split('\n')
    cleaned = ' '.join([line.strip() for line in lines if line.strip()])
    return cleaned

def extract_pdf_chunks(pdf_path: Path):
    print(f"Processing {pdf_path.name}...")
    try:
        reader = PdfReader(pdf_path)
        chunks = []
        for i, page in enumerate(reader.pages):
            text = page.extract_text()
            if text:
                cleaned = clean_text(text)
                if len(cleaned) > 50: # ignore mostly empty pages
                    chunks.append({
                        "source": pdf_path.name,
                        "page": i + 1,
                        "text": cleaned
                    })
        return chunks
    except Exception as e:
        print(f"Error processing {pdf_path}: {e}")
        return []

def main():
    base_dir = Path("/Users/sahitipotini/Desktop/EduAI")
    pdf_dir = base_dir / "class_10_cbse"
    out_file = base_dir / "backend/data/textbook.json"
    
    all_chunks = []
    
    for pdf_file in pdf_dir.glob("*.pdf"):
        chunks = extract_pdf_chunks(pdf_file)
        all_chunks.extend(chunks)
        
    print(f"Extracted {len(all_chunks)} chunks total.")
    
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(all_chunks, f, ensure_ascii=False, indent=2)
        
    print(f"Saved to {out_file}")

if __name__ == "__main__":
    main()
