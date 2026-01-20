import os
from dotenv import load_dotenv
from fastapi import FastAPI, Form, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client
from pypdf import PdfReader
import google.generativeai as genai
import io
import uuid
from langchain_text_splitters import RecursiveCharacterTextSplitter

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

def split_text(text):
    """
    Splits text recursively: checks for paragraphs, then sentences, then words.
    """
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,       # Aim for ~1000 characters per chunk
        chunk_overlap=100,     # Keep 100 characters of history between chunks
        length_function=len,
        is_separator_regex=False,
    )
    chunks = text_splitter.split_text(text)
    return chunks

async def ingest_document(file: UploadFile, session_id: str):
    content = await file.read()
    text = get_text_from_pdf(content)
    chunks = split_text(text)
    
    for chunk in chunks:
        response = genai.embed_content(
            model="models/text-embedding-004",
            content=chunk,
            task_type="retrieval_document"
        )
        data = {
            "content": chunk, 
            "embedding": response['embedding'],
            "session_id": session_id
        }
        supabase.table("documents").insert(data).execute()
    
    return len(chunks)

def get_relevant_context(user_question: str, session_id: str):
    response = genai.embed_content(
        model="models/text-embedding-004",
        content=user_question,
        task_type="retrieval_query"
    )
    result = supabase.rpc(
        "match_documents", 
        {
            "query_embedding": response['embedding'], 
            "match_threshold": 0.3, 
            "match_count": 5,
            "filter_session_id": session_id
        }
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
        
        session_data = {"file_name": file.filename}
        session_res = supabase.table("sessions").insert(session_data).execute()
        new_session_id = session_res.data[0]['id']
        
        await ingest_document(file, new_session_id)
        
        return {
            "message": "Upload success", 
            "sessionId": new_session_id, 
            "fileName": file.filename
        }
    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat")
async def chat(
    question: str = Form(...),
    session_id: str = Form(...) 
):
    try:
        # 1. Save USER message immediately
        supabase.table("messages").insert({
            "session_id": session_id,
            "role": "user",
            "content": question
        }).execute()

        # 2. Get Answer
        context = get_relevant_context(question, session_id)
        if not context:
            answer = "I couldn't find any information in this document."
        else:
            model = genai.GenerativeModel('gemini-3-flash-preview')
            prompt = f"""
            Answer based strictly on this context:
            {context}
            
            Question: {question}
            """
            response = model.generate_content(prompt)
            answer = response.text

        # 3. Save AI message
        supabase.table("messages").insert({
            "session_id": session_id,
            "role": "assistant",
            "content": answer
        }).execute()

        return {"answer": answer}

    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- NEW: Get Messages for a Session ---
@app.get("/sessions/{session_id}/messages")
async def get_messages(session_id: str):
    try:
        # Fetch all messages for this session, sorted by time
        response = supabase.table("messages")\
            .select("*")\
            .eq("session_id", session_id)\
            .order("created_at", desc=False)\
            .execute()
        return response.data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/sessions")
def get_sessions():
    res = supabase.table("sessions").select("*").order("created_at", desc=True).execute()
    return res.data

@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    try:
        supabase.table("sessions").delete().eq("id", session_id).execute()
        return {"message": "Session deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))