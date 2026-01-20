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
from google.generativeai.types import HarmCategory, HarmBlockThreshold

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

# def get_text_from_pdf(pdf_bytes):
#     pdf_file = io.BytesIO(pdf_bytes)
#     reader = PdfReader(pdf_file)
#     text = ""
#     for page in reader.pages:
#         text += page.extract_text() or ""
#     return text

# def split_text(text):
#     """
#     Splits text recursively: checks for paragraphs, then sentences, then words.
#     """
#     text_splitter = RecursiveCharacterTextSplitter(
#         chunk_size=1000,       # Aim for ~1000 characters per chunk
#         chunk_overlap=100,     # Keep 100 characters of history between chunks
#         length_function=len,
#         is_separator_regex=False,
#     )
#     chunks = text_splitter.split_text(text)
#     return chunks

# REMOVE the old 'get_text_from_pdf' function. We don't need it anymore.
# REMOVE the old 'split_text' function. We will do it inside the loop.

from langchain_text_splitters import RecursiveCharacterTextSplitter

async def ingest_document(file: UploadFile, session_id: str):
    # 1. Read the PDF file
    content = await file.read()
    pdf_file = io.BytesIO(content)
    reader = PdfReader(pdf_file)
    
    # 2. Setup Splitter
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=100
    )
    
    total_chunks = 0

    print(f"📖 Processing {len(reader.pages)} pages...")

    # 3. Iterate Page by Page (Crucial for Citations)
    for i, page in enumerate(reader.pages):
        page_number = i + 1
        page_text = page.extract_text()
        
        if not page_text: 
            continue

        # Split THIS page's text into chunks
        chunks = text_splitter.split_text(page_text)
        
        for chunk in chunks:
            # Generate Embedding
            response = genai.embed_content(
                model="models/text-embedding-004",
                content=chunk,
                task_type="retrieval_document"
            )
            
            # Save to DB with Page Number in metadata!
            data = {
                "content": chunk, 
                "embedding": response['embedding'],
                "session_id": session_id,
                "metadata": {"page": page_number} # <--- THE MAGIC SAUCE
            }
            supabase.table("documents").insert(data).execute()
            total_chunks += 1
            
    print(f"✅ Finished! Created {total_chunks} chunks.")
    return total_chunks

def get_relevant_context(user_question: str, session_id: str):
    response = genai.embed_content(
        model="models/text-embedding-004",
        content=user_question,
        task_type="retrieval_query"
    )
    
    # We use the standard match_documents (or hybrid_search if you added it)
    # Note: We need to make sure our SQL function returns 'metadata' column!
    # Let's use a simple Select for now to be safe, or update the RPC.
    
    # For simplicity, let's assume standard retrieval but formatted differently:
    result = supabase.rpc(
        "match_documents", 
        {
            "query_embedding": response['embedding'], 
            "match_threshold": 0.3, 
            "match_count": 5,
            "filter_session_id": session_id
        }
    ).execute()
    
    # PROBLEM: The SQL function 'match_documents' we wrote earlier 
    # only returns (id, content, similarity). It DOES NOT return metadata.
    # We need to fix the SQL function first! (See Step 4 below)
    
    context_text = ""
    for match in result.data:
        # We append the page number to the text so Gemini sees it
        page_num = match.get('metadata', {}).get('page', 'Unknown')
        context_text += f"Source (Page {page_num}):\n{match['content']}\n\n"
        
    return context_text

# --- ENDPOINTS ---
@app.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    session_id: str = Form(None) # <--- NEW: Optional Session ID
):
    try:
        if not file.filename.endswith(".pdf"):
             raise HTTPException(status_code=400, detail="Only PDFs are allowed")
        
        # Scenario 1: New Chat (No Session ID provided)
        if not session_id:
            # Create a new session with the first file's name
            session_data = {"file_name": file.filename}
            session_res = supabase.table("sessions").insert(session_data).execute()
            session_id = session_res.data[0]['id']
        else:
            # Scenario 2: Existing Chat (Adding to a session)
            # Optional: We could update the session name to say "Math.pdf + others"
            # But for now, we just keep the original name.
            print(f"🔗 Adding {file.filename} to existing session {session_id}")

        # Process the file and tag it with the session_id
        await ingest_document(file, session_id)
        
        return {
            "message": "Upload success", 
            "sessionId": session_id, 
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
        # 1. Save USER message
        supabase.table("messages").insert({
            "session_id": session_id,
            "role": "user",
            "content": question
        }).execute()

        # 2. Get Context
        context = get_relevant_context(question, session_id)
        if not context:
            answer = "I couldn't find any information in this document."
        else:
            model = genai.GenerativeModel('gemini-3-flash-preview')
            
            prompt = f"""
            You are a helpful assistant. Answer the user's question based strictly on the context provided.
            
            CRITICAL CITATION RULES:
        1. Every time you use information, you MUST cite the page number in square brackets at the end of the sentence.
        2. If information comes from multiple pages, combine them with commas.
           - Bad: [Page 1] [Page 2]
           - Good: [Page 1, 2]
        3. If you don't know the answer from the context, say "I couldn't find that in the document."
            Context:
            {context}
            
            Question: {question}
            """

            # --- NEW: DISABLE SAFETY FILTERS ---
            # This prevents the "Valid Part" error on benign documents
            safety_settings = {
                HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
                HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
                HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
                HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
            }

            response = model.generate_content(prompt, safety_settings=safety_settings)

            # --- NEW: CRASH PROTECTION ---
            # If Gemini still refuses, we handle it gracefully instead of crashing
            if response.parts:
                answer = response.text
            else:
                # Log the reason for debugging
                print(f"⚠️ Gemini Refused. Finish Reason: {response.candidates[0].finish_reason}")
                print(f"⚠️ Safety Ratings: {response.candidates[0].safety_ratings}")
                answer = "I'm sorry, but I cannot answer that question (The AI model returned an empty response)."

        # 3. Save AI message
        supabase.table("messages").insert({
            "session_id": session_id,
            "role": "assistant",
            "content": answer
        }).execute()

        return {"answer": answer}

    except Exception as e:
        print(f"Error: {e}")
        # Send the actual error to the frontend so you can see it
        return {"answer": f"System Error: {str(e)}"}

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