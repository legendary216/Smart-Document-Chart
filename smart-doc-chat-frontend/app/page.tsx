"use client";

import { useState } from "react";
import axios from "axios";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, Send, Loader2, FileText, CheckCircle } from "lucide-react";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<{role: string, text: string}[]>([]);
  const [isProcessed, setIsProcessed] = useState(false);
  const [loading, setLoading] = useState(false);

  // 1. Upload & Process File
  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    
    const formData = new FormData();
    formData.append("file", file);

    try {
      await axios.post("http://127.0.0.1:8000/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setIsProcessed(true);
      setMessages([{role: "system", text: "Document processed! Ask me anything."}]);
    } catch (error) {
      console.error(error);
      alert("Error uploading file");
    } finally {
      setLoading(false);
    }
  };

  // 2. Chat Logic
  const handleChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question) return;

    // Add user message immediately
    const newMessages = [...messages, { role: "user", text: question }];
    setMessages(newMessages);
    setQuestion("");
    setLoading(true);

    const formData = new FormData();
    formData.append("question", question);

    try {
      const response = await axios.post("http://127.0.0.1:8000/chat", formData);
      setMessages([...newMessages, { role: "assistant", text: response.data.answer }]);
    } catch (error) {
      setMessages([...newMessages, { role: "system", text: "Error fetching response." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl shadow-xl">
        <CardHeader className="bg-slate-900 text-white rounded-t-lg">
          <CardTitle className="flex items-center gap-2 text-xl">
            <FileText className="h-6 w-6" />
            RAG Document Chat
          </CardTitle>
        </CardHeader>
        
        <CardContent className="space-y-6 pt-6">
          {/* STEP 1: UPLOAD AREA */}
          {!isProcessed ? (
            <div className="space-y-4 border-2 border-dashed border-slate-200 p-8 rounded-lg text-center">
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-10 w-10 text-slate-400" />
                <h3 className="font-semibold text-lg">Upload your PDF</h3>
              </div>
              <Input 
                type="file" 
                accept=".pdf" 
                onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)} 
                className="max-w-xs mx-auto"
              />
              <Button onClick={handleUpload} disabled={!file || loading} className="w-full max-w-xs">
                {loading ? <Loader2 className="animate-spin mr-2" /> : "Process Document"}
              </Button>
            </div>
          ) : (
            // STEP 2: CHAT AREA
            <div className="space-y-4">
               <div className="flex items-center gap-2 text-green-600 bg-green-50 p-3 rounded-md">
                 <CheckCircle className="h-5 w-5" />
                 <span className="font-medium">Using document: {file?.name}</span>
                 <Button variant="ghost" size="sm" onClick={() => setIsProcessed(false)} className="ml-auto text-slate-500">
                   Change File
                 </Button>
               </div>

               <div className="h-[400px] overflow-y-auto border rounded-lg p-4 bg-white space-y-4">
                 {messages.map((msg, i) => (
                   <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                     <div className={`max-w-[80%] p-3 rounded-lg ${
                       msg.role === 'user' ? 'bg-blue-600 text-white' : 
                       msg.role === 'system' ? 'bg-yellow-100 text-yellow-800' : 'bg-slate-100 text-slate-800'
                     }`}>
                       {msg.text}
                     </div>
                   </div>
                 ))}
               </div>

               <form onSubmit={handleChat} className="flex gap-2">
                 <Input 
                   value={question} 
                   onChange={(e) => setQuestion(e.target.value)} 
                   placeholder="Ask about the document..." 
                 />
                 <Button type="submit" disabled={loading}>
                   {loading ? <Loader2 className="animate-spin" /> : <Send />}
                 </Button>
               </form>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}