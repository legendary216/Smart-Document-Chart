"use client";

import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Upload, Send, Loader2, MessageSquare, PlusCircle, FileText, Trash2 } from "lucide-react";

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
  
  const [file, setFile] = useState<File | null>(null);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSessions();
  }, []);

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
    setLoading(true);

    const formData = new FormData();
    formData.append("question", question);
    formData.append("session_id", currentSessionId);

    try {
      const res = await axios.post("http://127.0.0.1:8000/chat", formData);
      setMessages([...newMsgs, { role: "assistant", text: res.data.answer }]);
    } catch (e) {
      const errorMsg = axios.isAxiosError(e) && e.response?.data?.answer 
        ? e.response.data.answer 
        : "Error fetching response.";
      setMessages([...newMsgs, { role: "system", text: errorMsg }]);
    } finally {
      setLoading(false);
    }
  };

  // --- NEW: DELETE FUNCTION ---
  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    // 1. Stop the click from opening the chat
    e.stopPropagation();
    
    // 2. Confirm user intent
    if (!confirm("Are you sure? This will delete the document and all chats.")) return;

    try {
      // 3. Call Backend
      await axios.delete(`http://127.0.0.1:8000/sessions/${sessionId}`);
      
      // 4. Update UI
      setSessions(sessions.filter(s => s.id !== sessionId));
      
      // 5. If we deleted the active chat, close it
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
        setMessages([]);
      }
    } catch (error) {
      console.error("Error deleting session:", error);
      alert("Failed to delete session.");
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
              // Added "group" to help with hover effects
              className={`group p-2 rounded cursor-pointer text-sm hover:bg-slate-800 flex items-center justify-between ${currentSessionId === session.id ? 'bg-slate-800 text-white' : ''}`}
            >
              <div className="flex items-center gap-2 overflow-hidden">
                <MessageSquare size={14} className="flex-shrink-0" />
                <span className="truncate">{session.file_name}</span>
              </div>

              {/* DELETE BUTTON (Visible on hover) */}
              <button 
                onClick={(e) => handleDeleteSession(e, session.id)}
                className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity p-1"
                title="Delete Chat"
              >
                <Trash2 size={14} />
              </button>
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

                {loading && (
                  <div className="flex justify-start">
                    <div className="bg-slate-100 text-slate-800 p-4 rounded-lg flex items-center gap-1">
                      <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                      <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                      <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></span>
                    </div>
                  </div>
                )}
                
                <div ref={messagesEndRef} />
             </div>
             
             <form onSubmit={handleChat} className="flex gap-2">
               <Input 
                 value={question} 
                 onChange={(e) => setQuestion(e.target.value)} 
                 placeholder="Ask something..." 
                 className="flex-1"
                 disabled={loading}
               />
               <Button type="submit" disabled={loading}>
                 {loading ? <Loader2 className="animate-spin" /> : <Send size={16} />}
               </Button>
             </form>
          </div>
        )}
      </div>
    </div>
  );
}