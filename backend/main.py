import os
from dotenv import load_dotenv
from fastapi import FastAPI, Form, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client
from pypdf import PdfReader
import google.generativeai as genai
import io

# 1. Load Keys
load_dotenv()

genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

supabase: Client = create_client(
    os.getenv("SUPABASE_URL"), 
    os.getenv("SUPABASE_KEY")
)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- HELPER FUNCTIONS ---

def get_text_from_pdf(pdf_bytes):
    pdf_file = io.BytesIO(pdf_bytes)
    reader = PdfReader(pdf_file)
    text = ""
    for page in reader.pages:
        text += page.extract_text() or ""
    return text

def split_text(text, chunk_size=1000, overlap=100):
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start += chunk_size - overlap
    return chunks

async def ingest_document(file: UploadFile):
    # A. Clear existing data (So we only chat with THIS file)
    # We delete all rows where ID is greater than 0
    print("🧹 Clearing old documents...")
    supabase.table("documents").delete().gt("id", 0).execute()

    # B. Read and Split PDF
    content = await file.read()
    text = get_text_from_pdf(content)
    chunks = split_text(text)
    
    print(f"🔪 Split into {len(chunks)} chunks. Uploading...")

    # C. Embed and Save to Supabase
    for chunk in chunks:
        response = genai.embed_content(
            model="models/text-embedding-004",
            content=chunk,
            task_type="retrieval_document"
        )
        data = {"content": chunk, "embedding": response['embedding']}
        supabase.table("documents").insert(data).execute()
    
    return len(chunks)

def get_relevant_context(user_question: str):
    response = genai.embed_content(
        model="models/text-embedding-004",
        content=user_question,
        task_type="retrieval_query"
    )
    result = supabase.rpc(
        "match_documents", 
        {"query_embedding": response['embedding'], "match_threshold": 0.3, "match_count": 5}
    ).execute()
    
    context = ""
    for match in result.data:
        context += match['content'] + "\n---\n"
    return context

# --- ENDPOINTS ---

@app.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    try:
        if not file.filename.endswith(".pdf"):
             raise HTTPException(status_code=400, detail="Only PDFs are allowed")
             
        num_chunks = await ingest_document(file)
        return {"message": f"Successfully processed {num_chunks} chunks. Ready to chat!"}
    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat")
async def chat(question: str = Form(...)):
    try:
        context = get_relevant_context(question)
        if not context:
            return {"answer": "I couldn't find any information in the document."}

        model = genai.GenerativeModel('gemini-3-flash-preview')
        prompt = f"""
        Answer based strictly on this context:
        {context}
        
        Question: {question}
        """
        response = model.generate_content(prompt)
        return {"answer": response.text}
    except Exception as e:
         raise HTTPException(status_code=500, detail=str(e))