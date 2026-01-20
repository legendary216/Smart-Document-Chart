import os
from dotenv import load_dotenv
from fastapi import FastAPI, Form, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client
import google.generativeai as genai

# 1. Load Keys
load_dotenv()

# Setup Google Gemini
genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

# Setup Supabase
supabase: Client = create_client(
    os.getenv("SUPABASE_URL"), 
    os.getenv("SUPABASE_KEY")
)

app = FastAPI()

# Allow Frontend to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_relevant_context(user_question: str):
    """
    1. Turn user question into a vector.
    2. Search Supabase for similar vectors.
    3. Return the text content of those matches.
    """
    print(f"🔍 Searching database for: {user_question}")
    
    # A. Embed the question
    response = genai.embed_content(
        model="models/text-embedding-004",
        content=user_question,
        task_type="retrieval_query"
    )
    query_embedding = response['embedding']
    
    # B. Search Supabase (RPC call)
    # We call the 'match_documents' function we created in SQL earlier
    result = supabase.rpc(
        "match_documents", 
        {
            "query_embedding": query_embedding,
            "match_threshold": 0.3, # Adjust this if matches are too loose/strict
            "match_count": 5        # How many chunks to retrieve
        }
    ).execute()
    
    # C. Combine the text from the matches
    matches = result.data
    context_text = ""
    print(f"found {len(matches)} matches")
    for match in matches:
        context_text += match['content'] + "\n---\n"
        
    return context_text

@app.post("/chat")
async def chat_with_rag(
    question: str = Form(...),
    # We keep 'file' here so the frontend doesn't break, 
    # but we won't use it for the answer anymore!
    file: UploadFile = File(None) 
):
    try:
        # 1. Retrieve Context from Database
        context = get_relevant_context(question)
        
        if not context:
            return {"answer": "I couldn't find any information about that in the database."}

        # 2. Ask Gemini with the Context
        model = genai.GenerativeModel('gemini-3-flash-preview')
        
        prompt = f"""
        You are a helpful assistant. Answer the user's question based strictly on the context provided below.
        
        CONTEXT FROM DATABASE:
        {context}
        
        USER QUESTION:
        {question}
        """
        
        print("🤖 Asking Gemini...")
        response = model.generate_content(prompt)
        return {"answer": response.text}
        
    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/")
def home():
    return {"message": "RAG Brain is active!"}