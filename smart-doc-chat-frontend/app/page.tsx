"use client";

import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Upload, Send, Loader2, MessageSquare, PlusCircle, FileText } from "lucide-react";

type Session = {
  id: string;
  file_name: string;
  created_at: string;
};

type Message = {
  role: string;
  text: string;
};

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  
  // Chat State
  const [file, setFile] = useState<File | null>(null);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  
  // Auto-scroll to bottom ref
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSessions();
  }, []);

  // Scroll to bottom whenever messages or loading changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const fetchSessions = async () => {
    try {
      const res = await axios.get("http://127.0.0.1:8000/sessions");
      setSessions(res.data);
    } catch (e) {
      console.error("Failed to load sessions");
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await axios.post("http://127.0.0.1:8000/upload", formData);
      await fetchSessions();
      setCurrentSessionId(res.data.sessionId);
      setMessages([{role: "system", text: `Ready to chat about ${res.data.fileName}!`}]);
      setFile(null); 
    } catch (e) {
      alert("Error uploading");
    } finally {
      setLoading(false);
    }
  };

  const handleChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question || !currentSessionId) return;

    const newMsgs = [...messages, { role: "user", text: question }];
    setMessages(newMsgs);
    setQuestion("");
    setLoading(true); // <--- START LOADING UI

    const formData = new FormData();
    formData.append("question", question);
    formData.append("session_id", currentSessionId);

    try {
      const res = await axios.post("http://127.0.0.1:8000/chat", formData);
      // Remove loading UI by adding the real answer
      setMessages([...newMsgs, { role: "assistant", text: res.data.answer }]);
    } catch (e) {
      // Capture detailed error if backend sends one
      const errorMsg = axios.isAxiosError(e) && e.response?.data?.answer 
        ? e.response.data.answer 
        : "Error fetching response.";
      setMessages([...newMsgs, { role: "system", text: errorMsg }]);
    } finally {
      setLoading(false); // <--- STOP LOADING UI
    }
  };

  return (
    <div className="flex h-screen bg-slate-50">
      
      {/* SIDEBAR */}
      <div className="w-64 bg-slate-900 text-slate-300 p-4 flex flex-col gap-4">
        <div className="font-bold text-white text-xl flex items-center gap-2">
           <FileText /> DocChat
        </div>
        
        <Button onClick={() => setCurrentSessionId(null)} className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white">
          <PlusCircle size={16} /> New Chat
        </Button>

        <div className="flex-1 overflow-y-auto space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase">Recent Chats</p>
          {sessions.map(session => (
            <div 
              key={session.id}
              onClick={() => {
                setCurrentSessionId(session.id);
                setMessages([{role: 'system', text: `Switched to: ${session.file_name}`}]);
              }}
              className={`p-2 rounded cursor-pointer text-sm hover:bg-slate-800 flex items-center gap-2 ${currentSessionId === session.id ? 'bg-slate-800 text-white' : ''}`}
            >
              <MessageSquare size={14} />
              <span className="truncate">{session.file_name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="flex-1 p-8 flex flex-col items-center">
        {!currentSessionId ? (
          // UPLOAD SCREEN
          <Card className="w-full max-w-md p-6 space-y-6 text-center mt-20">
             <div className="mx-auto w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center">
               <Upload />
             </div>
             <h2 className="text-xl font-semibold">Upload a Document to Start</h2>
             <Input 
                type="file" 
                accept=".pdf" 
                onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)} 
             />
             <Button onClick={handleUpload} disabled={!file || loading} className="w-full">
               {loading ? <Loader2 className="animate-spin mr-2" /> : "Start Chat"}
             </Button>
          </Card>
        ) : (
          // CHAT SCREEN
          <div className="w-full max-w-3xl flex flex-col h-full">
             <div className="flex-1 overflow-y-auto space-y-4 p-4 border rounded-lg bg-white mb-4 shadow-sm">
                
                {/* 1. Render All Messages */}
                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] p-3 rounded-lg ${
                       msg.role === 'user' ? 'bg-blue-600 text-white' : 
                       msg.role === 'system' ? 'bg-yellow-50 text-yellow-800 text-sm border border-yellow-200' : 
                       'bg-slate-100 text-slate-800'
                     }`}>
                       {msg.text}
                     </div>
                  </div>
                ))}

                {/* 2. THE LOADING BUBBLE (Only shows when loading is true) */}
                {loading && (
                  <div className="flex justify-start">
                    <div className="bg-slate-100 text-slate-800 p-4 rounded-lg flex items-center gap-1">
                      <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                      <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                      <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></span>
                    </div>
                  </div>
                )}
                
                {/* Invisible element to auto-scroll to */}
                <div ref={messagesEndRef} />
             </div>
             
             {/* 3. INPUT AREA */}
             <form onSubmit={handleChat} className="flex gap-2">
               <Input 
                 value={question} 
                 onChange={(e) => setQuestion(e.target.value)} 
                 placeholder="Ask something..." 
                 className="flex-1"
                 disabled={loading} // Prevent typing while waiting
               />
               <Button type="submit" disabled={loading}>
                 {/* 4. LOADING ICON SWITCH */}
                 {loading ? <Loader2 className="animate-spin" /> : <Send size={16} />}
               </Button>
             </form>
          </div>
        )}
      </div>
    </div>
  );
}