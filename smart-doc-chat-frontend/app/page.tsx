"use client";

import { useState } from "react";
import axios from "axios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, Send, Loader2, FileText } from "lucide-react";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);

  // 1. Handle File Selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFile(e.target.files[0]);
    }
  };

  // 2. Send Data to Backend
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !question) return;

    setLoading(true);
    setAnswer("");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("question", question);

    try {
      // NOTE: We are talking to port 8000 (Your Python Backend)
      const response = await axios.post("http://127.0.0.1:8000/chat", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      setAnswer(response.data.answer);
    } catch (error) {
      console.error("Error:", error);
      setAnswer("❌ Error: Could not get a response. Is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
    <Card className="w-full max-w-2xl shadow-xl p-0 overflow-hidden rounded-xl min-h-[35vh]
">
  
  <CardHeader className="bg-slate-900 text-white px-6 py-4 rounded-t-xl">
    <CardTitle className="flex items-center gap-2 text-xl">
      <FileText className="h-6 w-6" />
      Smart Document Chat
    </CardTitle>
  </CardHeader>
        <CardContent className="p-6 space-y-8">
          {/* File Upload Section */}
          <div className="grid w-full items-center gap-1.5">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Step 1: Upload PDF
            </label>
            <div className="flex items-center gap-2">
              <Input 
                type="file" 
                accept=".pdf" 
                onChange={handleFileChange} 
                className="cursor-pointer"
              />
            </div>
          </div>

          {/* Chat Section */}
          <form onSubmit={handleSubmit} className="space-y-4">
             <label className="text-sm font-medium leading-none">
              Step 2: Ask a Question
            </label>
            <div className="flex gap-2">
              <Input
                placeholder="Ex: Summarize this document..."
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                disabled={!file}
              />
              <Button type="submit" disabled={!file || loading}>
                {loading ? <Loader2 className="animate-spin h-4 w-4" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </form>

          {/* Answer Display */}
          {answer && (
            <div className="mt-6 p-4 bg-slate-100 rounded-lg border border-slate-200">
              <h3 className="font-semibold text-slate-800 mb-2">Gemini says:</h3>
              <p className="text-slate-700 leading-relaxed whitespace-pre-wrap">{answer}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}