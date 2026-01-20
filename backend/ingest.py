import os
from dotenv import load_dotenv
from pypdf import PdfReader
import google.generativeai as genai
from supabase import create_client, Client

# 1. Load Keys
load_dotenv()

# Setup Google Gemini
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
genai.configure(api_key=GOOGLE_API_KEY)

# Setup Supabase
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def extract_text_from_pdf(pdf_path):
    print(f"📖 Reading {pdf_path}...")
    reader = PdfReader(pdf_path)
    text = ""
    for page in reader.pages:
        text += page.extract_text() or ""
    return text

def split_text(text, chunk_size=1000, overlap=100):
    """
    Simple chunking: Splits text into parts of ~1000 characters
    with a small overlap so context isn't lost at the edges.
    """
    chunks = []
    start = 0
    text_length = len(text)

    while start < text_length:
        end = start + chunk_size
        chunk = text[start:end]
        chunks.append(chunk)
        # Move forward, but back up a bit for overlap
        start += chunk_size - overlap
    
    print(f"🔪 Split text into {len(chunks)} chunks.")
    return chunks

def save_to_supabase(chunks):
    print("💾 Generating embeddings and saving to Supabase...")
    
    for i, chunk in enumerate(chunks):
        # A. Get the "Vector" (Embedding) from Gemini
        # We use 'embedding-001' or 'text-embedding-004'
        response = genai.embed_content(
            model="models/text-embedding-004",
            content=chunk,
            task_type="retrieval_document"
        )
        embedding = response['embedding']

        # B. Insert into Database
        data = {
            "content": chunk,
            "embedding": embedding
        }
        
        supabase.table("documents").insert(data).execute()
        print(f"   ✅ Saved chunk {i+1}/{len(chunks)}")

def main():
    # CONFIGURATION
    filename = "sample.pdf"  # Put your PDF file name here
    
    if not os.path.exists(filename):
        print(f"❌ Error: Could not find {filename}. Please add it to this folder.")
        return

    # 1. Extract
    raw_text = extract_text_from_pdf(filename)
    
    # 2. Split
    text_chunks = split_text(raw_text)
    
    # 3. Embed & Save
    save_to_supabase(text_chunks)
    
    print("🎉 Done! All chunks are now in your vector database.")

if __name__ == "__main__":
    main()