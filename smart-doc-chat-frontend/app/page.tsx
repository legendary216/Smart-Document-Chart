"use client";

import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Upload, Send, Loader2, MessageSquare, PlusCircle, FileText, Trash2, Paperclip } from "lucide-react";
import ReactMarkdown from "react-markdown";

type Session = {
  id: string;
  file_name: string;
  created_at: string;
};

type Message = {
  role: string;
  content: string;
};

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentFileName, setCurrentFileName] = useState("");
  
  // Upload State
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false); // New distinct loading state for uploads

  // Chat State
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isChatting, setIsChatting] = useState(false); // Distinct loading state for chat
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Hidden input ref for the "Add File" button
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSessions();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isChatting]);

  useEffect(() => {
    if (!currentSessionId) {
      setMessages([]);
      return;
    }
    const loadMessages = async () => {
      try {
        const res = await axios.get(`http://127.0.0.1:8000/sessions/${currentSessionId}/messages`);
        setMessages(res.data);
      } catch (error) {
        console.error("Error loading messages:", error);
      }
    };
    loadMessages();
  }, [currentSessionId]);

  const fetchSessions = async () => {
    try {
      const res = await axios.get("http://127.0.0.1:8000/sessions");
      setSessions(res.data);
    } catch (e) {
      console.error("Failed to load sessions");
    }
  };

  // 1. ORIGINAL UPLOAD (New Chat)
  const handleNewUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      // Don't send session_id -> Backend creates new session
      const res = await axios.post("http://127.0.0.1:8000/upload", formData);
      await fetchSessions();
      setCurrentSessionId(res.data.sessionId);
      setCurrentFileName(res.data.fileName);
      setMessages([{role: "system", content: `Started new chat with ${res.data.fileName}`}]);
      setFile(null); 
    } catch (e) {
      alert("Error uploading");
    } finally {
      setIsUploading(false);
    }
  };

  // 2. NEW: ADD FILE TO EXISTING CHAT
  const handleAdditionalUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0] || !currentSessionId) return;
    
    const newFile = e.target.files[0];
    setIsUploading(true);
    
    const formData = new FormData();
    formData.append("file", newFile);
    formData.append("session_id", currentSessionId); // <--- LINK TO CURRENT SESSION

    try {
      const res = await axios.post("http://127.0.0.1:8000/upload", formData);
      // Add a system message saying file was added
      setMessages(prev => [...prev, {role: "system", content: `📄 Added document: ${res.data.fileName}`}]);
    } catch (error) {
      alert("Failed to add file.");
    } finally {
      setIsUploading(false);
      // Clear the input so you can upload the same file again if needed
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question || !currentSessionId) return;

    const newMsgs = [...messages, { role: "user", content: question }];
    setMessages(newMsgs);
    setQuestion("");
    setIsChatting(true);

    const formData = new FormData();
    formData.append("question", question);
    formData.append("session_id", currentSessionId);

    try {
      const res = await axios.post("http://127.0.0.1:8000/chat", formData);
      setMessages([...newMsgs, { role: "assistant", content: res.data.answer }]);
    } catch (e) {
       setMessages([...newMsgs, { role: "system", content: "Error fetching response." }]);
    } finally {
      setIsChatting(false);
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (!confirm("Delete this chat?")) return;
    try {
      await axios.delete(`http://127.0.0.1:8000/sessions/${sessionId}`);
      setSessions(sessions.filter(s => s.id !== sessionId));
      if (currentSessionId === sessionId) setCurrentSessionId(null);
    } catch (error) {
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
                setCurrentFileName(session.file_name);
              }}
              className={`group p-2 rounded cursor-pointer text-sm hover:bg-slate-800 flex items-center justify-between ${currentSessionId === session.id ? 'bg-slate-800 text-white' : ''}`}
            >
              <div className="flex items-center gap-2 overflow-hidden">
                <MessageSquare size={14} className="flex-shrink-0" />
                <span className="truncate">{session.file_name}</span>
              </div>
              <button 
                onClick={(e) => handleDeleteSession(e, session.id)}
                className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity p-1"
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
          // UPLOAD SCREEN (Initial)
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
             <Button onClick={handleNewUpload} disabled={!file || isUploading} className="w-full">
               {isUploading ? <Loader2 className="animate-spin mr-2" /> : "Start Chat"}
             </Button>
          </Card>
        ) : (
          // CHAT SCREEN
          <div className="w-full max-w-3xl flex flex-col h-full">
            <div className="mb-4 pb-2 border-b flex justify-between items-center">
                <h2 className="font-semibold text-lg">{currentFileName}</h2>
                {/* NEW: Spinner if uploading extra files */}
                {isUploading && <span className="text-sm text-blue-500 flex items-center gap-2"><Loader2 className="animate-spin" size={14} /> Adding file...</span>}
            </div>

             <div className="flex-1 overflow-y-auto space-y-4 p-4 border rounded-lg bg-white mb-4 shadow-sm">
                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] p-3 rounded-lg overflow-hidden ${
                       msg.role === 'user' ? 'bg-blue-600 text-white' : 
                       msg.role === 'system' ? 'bg-yellow-50 text-yellow-800 text-sm border border-yellow-200' : 
                       'bg-slate-100 text-slate-800'
                     }`}>
                       <ReactMarkdown >
                         {msg.content}
                       </ReactMarkdown>
                     </div>
                  </div>
                ))}
                {isChatting && (
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
             
             <form onSubmit={handleChat} className="flex gap-2 items-center">
               {/* NEW: Paperclip Button for adding files */}
               <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept=".pdf"
                  onChange={handleAdditionalUpload} 
               />
               <Button 
                 type="button" 
                 variant="outline"
                 size="icon"
                 onClick={() => fileInputRef.current?.click()}
                 disabled={isUploading || isChatting}
                 title="Add another PDF to this chat"
               >
                 <Paperclip size={18} />
               </Button>

               <Input 
                 value={question} 
                 onChange={(e) => setQuestion(e.target.value)} 
                 placeholder="Ask something..." 
                 className="flex-1"
                 disabled={isUploading || isChatting}
               />
               <Button type="submit" disabled={isUploading || isChatting}>
                 {isChatting ? <Loader2 className="animate-spin" /> : <Send size={16} />}
               </Button>
             </form>
          </div>
        )}
      </div>
    </div>
  );
}