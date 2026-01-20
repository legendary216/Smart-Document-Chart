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
from fastapi.responses import StreamingResponse
from google.api_core.exceptions import ResourceExhausted # <--- ADD THIS
import re

import fitz  # PyMuPDF
from PIL import Image
import io

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

def get_image_description(image_bytes):
    try:
        # 1. Open the image with Pillow
        image = Image.open(io.BytesIO(image_bytes))
        
        # 2. Ask Gemini to describe it
        model = genai.GenerativeModel('gemini-2.5-flash')
        response = model.generate_content([
            "Describe this image in detail. If it's a chart or graph, explain the data trends.", 
            image
        ])
        
        return response.text.strip()
    except Exception as e:
        print(f"⚠️ Could not describe image: {e}")
        return "(Image processing failed)"

async def ingest_document(file: UploadFile, session_id: str):
    # 1. Read the PDF file into memory
    content = await file.read()
    
    # Open with PyMuPDF (Fitz)
    doc = fitz.open(stream=content, filetype="pdf")
    
    # Setup Splitter
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=100
    )
    
    total_chunks = 0
    print(f"📖 Processing {len(doc)} pages with Multi-Modal Vision...")

    # 2. Iterate Page by Page
    for i, page in enumerate(doc):
        page_number = i + 1
        
        # --- A. Extract Text ---
        page_text = page.get_text()
        
        # --- B. Extract & Describe Images ---
        image_list = page.get_images(full=True)
        
        if image_list:
            print(f"   found {len(image_list)} images on page {page_number}...")
            
            for img_index, img in enumerate(image_list):
                xref = img[0] # The image reference ID
                base_image = doc.extract_image(xref)
                image_bytes = base_image["image"]
                
                # Ask Gemini to describe it
                # We add a small description to the text so the vector search can find it!
                description = get_image_description(image_bytes)
                
                page_text += f"\n\n[IMAGE ON PAGE {page_number}]: {description}\n\n"
                
                # Sleep briefly to avoid hitting Rate Limits (Free Tier)
                import time
                time.sleep(2) 

        # --- C. Chunk & Save (Standard RAG) ---
        if not page_text: 
            continue

        chunks = text_splitter.split_text(page_text)
        
        for chunk in chunks:
            response = genai.embed_content(
                model="models/text-embedding-004",
                content=chunk,
                task_type="retrieval_document"
            )
            
            data = {
                "content": chunk, 
                "embedding": response['embedding'],
                "session_id": session_id,
                "metadata": {"page": page_number}
            }
            supabase.table("documents").insert(data).execute()
            total_chunks += 1
            
    print(f"✅ Finished! Created {total_chunks} multi-modal chunks.")
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
    # 1. Save USER message
    supabase.table("messages").insert({
        "session_id": session_id,
        "role": "user",
        "content": question
    }).execute()

    context = get_relevant_context(question, session_id)
    
    # 3. Generator Function with ERROR HANDLING
    async def generate():
        model = genai.GenerativeModel('gemini-3-flash-preview')
        
        # ... (safety settings code) ...
        safety_settings = {
            HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
        }

        prompt = f"""
        You are a helpful assistant. Answer based on the context.
           CRITICAL CITATION RULES:
        1. Every time you use information, you MUST cite the page number in square brackets at the end of the sentence.
        2. If information comes from multiple pages, combine them with commas.
           - Bad: [Page 1] [Page 2]
           - Good: [Page 1, 2]
        3. If you don't know the answer from the context, say "I couldn't find that in the document."
        
        Context: {context}
        Question: {question}
        """

        full_response_text = ""

        try:
            # --- TRY TO GENERATE ---
            response = await model.generate_content_async(
                prompt, 
                stream=True, 
                safety_settings=safety_settings
            )
            
            async for chunk in response:
                if chunk.text:
                    full_response_text += chunk.text
                    yield chunk.text
                    
        except ResourceExhausted as e:
            error_text = str(e)
            
            # 1. Default Message
            clean_message = "Quota exceeded. Please wait a moment."

            # 2. Try to find the EXACT time using Regex
            # This looks for the pattern: "retry in" followed by numbers
            match = re.search(r"retry in (\d+\.?\d*)s", error_text)
            
            if match:
                # We found the exact seconds! (e.g., "30.26")
                seconds = float(match.group(1))
                # Round it up to be nice (e.g., 31 seconds)
                clean_message = f"Quota exceeded. Please wait {int(seconds) + 1} seconds."
            
            # 3. If exact time isn't found, check generic limits
            elif "per day" in error_text.lower():
                clean_message = "Daily quota exceeded. Please try again tomorrow."
            elif "per minute" in error_text.lower():
                clean_message = "Rate limit hit. Please wait 1 minute."

            # 4. Send ONLY the clean message
            # We add a double newline \n\n so it appears as a new paragraph
            formatted_error = f"\n\n⏳ **{clean_message}**"
            
            full_response_text += formatted_error
            yield formatted_error
            
        except Exception as e:
            # --- CATCH GENERIC ERRORS ---
            error_msg = f"\n\n⚠️ **System Error:** {str(e)}"
            full_response_text += error_msg
            yield error_msg

        # Save whatever we got (even if it's just the error message)
        supabase.table("messages").insert({
            "session_id": session_id,
            "role": "assistant",
            "content": full_response_text
        }).execute()

    return StreamingResponse(generate(), media_type="text/plain")

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