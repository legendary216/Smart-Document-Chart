import os
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware  
from pypdf import PdfReader
import google.generativeai as genai
import io

# 1. Load the keys from your .env file
load_dotenv()

# 2. Check if the API key was found
api_key = os.getenv("GOOGLE_API_KEY")
if not api_key:
    print("Error: GOOGLE_API_KEY not found. Check your .env file!")
else:
    genai.configure(api_key=api_key)

# 3. Create the App
app = FastAPI()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins (for development)
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

def get_gemini_response(text_content, user_question):
    model = genai.GenerativeModel('gemini-3-flash-preview')
    prompt = f"""
    Answer based on this text:
    {text_content}
    
    Question: {user_question}
    """
    response = model.generate_content(prompt)
    return response.text

@app.post("/chat")
async def chat_with_pdf(file: UploadFile = File(...), question: str = Form(...)):
    # Read the PDF
    contents = await file.read()
    pdf_file = io.BytesIO(contents)
    reader = PdfReader(pdf_file)
    text = ""
    for page in reader.pages:
        text += page.extract_text()
    
    # Get answer
    answer = get_gemini_response(text, question)
    return {"answer": answer}

@app.get("/")
def home():
    return {"message": "Server is running!"}