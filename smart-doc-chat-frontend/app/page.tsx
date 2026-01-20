"use client";

import { useState, useEffect } from "react";
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

  // Load previous sessions on startup
  useEffect(() => {
    fetchSessions();
  }, []);

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
      const newSessionId = res.data.sessionId;
      
      // Refresh list and select new session
      await fetchSessions();
      setCurrentSessionId(newSessionId);
      setMessages([{role: "system", text: `Ready to chat about ${res.data.fileName}!`}]);
      setFile(null); // Reset file input
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
    setLoading(true);

    const formData = new FormData();
    formData.append("question", question);
    formData.append("session_id", currentSessionId);

    try {
      const res = await axios.post("http://127.0.0.1:8000/chat", formData);
      setMessages([...newMsgs, { role: "assistant", text: res.data.answer }]);
    } catch (e) {
      setMessages([...newMsgs, { role: "system", text: "Error fetching response." }]);
    } finally {
      setLoading(false);
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
             </div>
             
             <form onSubmit={handleChat} className="flex gap-2">
               <Input 
                 value={question} 
                 onChange={(e) => setQuestion(e.target.value)} 
                 placeholder="Ask something..." 
                 className="flex-1"
               />
               <Button type="submit" disabled={loading}>
                 <Send size={16} />
               </Button>
             </form>
          </div>
        )}
      </div>
    </div>
  );
}