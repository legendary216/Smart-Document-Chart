"use client";

import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { 
  Upload, Send, Loader2, MessageSquare, PlusCircle, 
  FileText, Trash2, Paperclip, Bot, User, Sparkles 
} from "lucide-react";
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
  const [isUploading, setIsUploading] = useState(false);

  // Chat State
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isChatting, setIsChatting] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
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

  const handleNewUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
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

  const handleAdditionalUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0] || !currentSessionId) return;
    
    const newFile = e.target.files[0];
    setIsUploading(true);
    
    const formData = new FormData();
    formData.append("file", newFile);
    formData.append("session_id", currentSessionId);

    try {
      const res = await axios.post("http://127.0.0.1:8000/upload", formData);
      setMessages(prev => [...prev, {role: "system", content: `📄 Added document: ${res.data.fileName}`}]);
    } catch (error) {
      alert("Failed to add file.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question || !currentSessionId) return;

    // 1. Setup UI
    const userMsg: Message = { role: "user", content: question };
    const initialAssistantMsg: Message = { role: "assistant", content: "" }; 
    
    setMessages(prev => [...prev, userMsg, initialAssistantMsg]);
    setQuestion("");
    setIsChatting(true);

    const formData = new FormData();
    formData.append("question", question);
    formData.append("session_id", currentSessionId);

    try {
      const response = await fetch("http://127.0.0.1:8000/chat", {
        method: "POST",
        body: formData,
      });

      if (!response.body) return;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let accumalatedAnswer = "";

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        
        if (value) {
          const chunk = decoder.decode(value);
          
          for (let i = 0; i < chunk.length; i++) {
             accumalatedAnswer += chunk[i];

             setMessages((prev) => {
                const newMsgs = [...prev];
                const lastMsg = newMsgs[newMsgs.length - 1]; 
                lastMsg.content = accumalatedAnswer;
                return newMsgs;
             });
             // Typing speed delay
             await new Promise(resolve => setTimeout(resolve, 10)); 
          }
        }
      }
    } catch (e) {
       console.error(e);
       setMessages(prev => [...prev, { role: "system", content: "Error fetching response." }]);
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
    <div className="flex h-screen bg-[#F8FAFC]">
      
      {/* 1. POLISHED SIDEBAR */}
      <div className="w-72 bg-slate-900 text-slate-300 flex flex-col border-r border-slate-800 shadow-2xl z-10">
        
        {/* App Logo Area */}
        <div className="p-6 pb-2">
            <div className="flex items-center gap-3 text-white font-bold text-xl mb-6">
                <div className="p-2 bg-blue-600 rounded-lg shadow-lg shadow-blue-900/50">
                    <Sparkles size={20} className="text-white" />
                </div>
                DocChat AI
            </div>

            <Button 
                onClick={() => setCurrentSessionId(null)} 
                className="w-full justify-start gap-3 bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-900/20 font-medium py-6 rounded-xl transition-all"
            >
                <PlusCircle size={20} /> 
                New Chat
            </Button>
        </div>

        {/* Scrollable List */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2 custom-scrollbar">
          <p className="text-xs font-bold text-slate-500 uppercase px-2 mb-2 tracking-wider">Your Library</p>
          {sessions.map(session => (
            <div 
              key={session.id}
              onClick={() => {
                setCurrentSessionId(session.id);
                setCurrentFileName(session.file_name);
              }}
              className={`
                group p-3 rounded-xl cursor-pointer text-sm flex items-center justify-between transition-all duration-200
                ${currentSessionId === session.id 
                    ? 'bg-slate-800 text-white shadow-lg border-l-4 border-blue-500 translate-x-1' 
                    : 'hover:bg-slate-800/50 hover:text-slate-200'
                }
              `}
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <MessageSquare size={16} className={currentSessionId === session.id ? "text-blue-400" : "text-slate-500"} />
                <span className="truncate font-medium">{session.file_name}</span>
              </div>
              <button 
                onClick={(e) => handleDeleteSession(e, session.id)}
                className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all p-1.5 hover:bg-slate-700/50 rounded-full"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        
        {/* User Profile / Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/50">
            <div className="flex items-center gap-3 text-sm font-medium text-slate-400 hover:text-white cursor-pointer transition-colors">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-500 to-blue-500 flex items-center justify-center text-white text-xs font-bold">
                    ME
                </div>
                <span>My Account</span>
            </div>
        </div>
      </div>

      {/* 2. MAIN CHAT AREA */}
      <div className="flex-1 flex flex-col relative h-full">
        
        {!currentSessionId ? (
          // EMPTY STATE (Modern)
          <div className="flex-1 flex flex-col items-center justify-center p-8 animate-in fade-in zoom-in duration-500">
             <Card className="w-full max-w-lg p-12 space-y-8 text-center bg-white/80 backdrop-blur-xl border-slate-200 shadow-2xl rounded-3xl">
                <div className="mx-auto w-20 h-20 bg-blue-50 text-blue-600 rounded-3xl flex items-center justify-center shadow-inner">
                  <Upload size={40} />
                </div>
                <div className="space-y-2">
                    <h2 className="text-3xl font-bold text-slate-800 tracking-tight">Upload Knowledge</h2>
                    <p className="text-slate-500 text-lg">Drop your PDF here to start chatting instantly.</p>
                </div>
                
                <div className="relative group">
                    <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                    <div className="relative">
                        <Input 
                            type="file" 
                            accept=".pdf" 
                            className="hidden" 
                            id="file-upload"
                            onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)} 
                        />
                        <label 
                            htmlFor="file-upload" 
                            className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer bg-slate-50 hover:bg-white hover:border-blue-500 transition-all"
                        >
                             <span className="text-sm font-medium text-slate-600">
                                {file ? file.name : "Click to select a file"}
                             </span>
                        </label>
                    </div>
                </div>

                <Button 
                    onClick={handleNewUpload} 
                    disabled={!file || isUploading} 
                    className="w-full py-6 text-lg rounded-xl shadow-xl shadow-blue-500/20 bg-blue-600 hover:bg-blue-700 transition-all"
                >
                  {isUploading ? <Loader2 className="animate-spin mr-2" /> : "Start Analysis"}
                </Button>
             </Card>
          </div>
        ) : (
          // ACTIVE CHAT (Claude Style)
          <>
             {/* Header */}
             <div className="h-16 border-b bg-white/50 backdrop-blur-md flex items-center justify-between px-8 sticky top-0 z-10">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-slate-100 rounded-lg text-slate-600">
                        <FileText size={18} />
                    </div>
                    <div>
                        <h2 className="font-semibold text-slate-800">{currentFileName}</h2>
                        {isUploading && <span className="text-xs text-blue-500 flex items-center gap-1 animate-pulse"><Loader2 size={10} className="animate-spin"/> Processing new file...</span>}
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="ghost" size="icon" className="text-slate-400 hover:text-slate-600"><Bot size={18} /></Button>
                </div>
             </div>

             {/* Messages Scroll Area */}
             <div className="flex-1 overflow-y-auto p-4 sm:p-8 scroll-smooth custom-scrollbar">
                <div className="max-w-3xl mx-auto space-y-8 pb-32"> {/* Added pb-32 for input clearance */}
                    {messages.map((msg, i) => (
                      <div key={i} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''} animate-in fade-in slide-in-from-bottom-4 duration-500`}>
                        
                        {/* Avatar */}
                        <div className={`
                            flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center shadow-sm
                            ${msg.role === 'user' 
                                ? 'bg-slate-800 text-white' 
                                : msg.role === 'system' ? 'bg-yellow-100 text-yellow-600' : 'bg-white border border-slate-100 text-blue-600'}
                        `}>
                            {msg.role === 'user' ? <User size={18} /> : msg.role === 'system' ? <Sparkles size={18} /> : <Bot size={20} />}
                        </div>

                        {/* Bubble */}
                        <div className={`
                           group relative px-6 py-4 max-w-[85%] shadow-sm leading-relaxed text-[15px]
                           ${msg.role === 'user' 
                             ? 'bg-slate-800 text-white rounded-2xl rounded-tr-sm shadow-md' 
                             : msg.role === 'system' 
                                ? 'bg-yellow-50 text-yellow-900 border border-yellow-200 rounded-xl text-sm w-full text-center' 
                                : 'bg-white text-slate-800 border border-slate-100 rounded-2xl rounded-tl-sm shadow-sm'}
                        `}>
                           <ReactMarkdown >
                             {msg.content}
                           </ReactMarkdown>
                        </div>
                      </div>
                    ))}

                    {/* Thinking Indicator */}
                    {isChatting && messages[messages.length - 1]?.role === "assistant" && messages[messages.length - 1]?.content === "" && (
                        <div className="flex gap-4">
                            <div className="w-10 h-10 rounded-full bg-white border border-slate-100 flex items-center justify-center shadow-sm text-blue-600">
                                <Bot size={20} />
                            </div>
                            <div className="bg-white border border-slate-100 px-6 py-4 rounded-2xl rounded-tl-sm shadow-sm flex items-center gap-2">
                                <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                                <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                                <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></span>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
             </div>

             {/* 3. FLOATING INPUT CAPSULE */}
             <div className="absolute bottom-6 left-0 right-0 px-4 flex justify-center z-20">
                 <form 
                    onSubmit={handleChat} 
                    className="w-full max-w-3xl bg-white rounded-3xl shadow-2xl border border-slate-200 p-2 flex items-end gap-2 transition-all ring-offset-2 focus-within:ring-2 ring-blue-500/50"
                 >
                   {/* File Upload Button */}
                   <input 
                      type="file" 
                      ref={fileInputRef} 
                      className="hidden" 
                      accept=".pdf"
                      onChange={handleAdditionalUpload} 
                   />
                   <Button 
                     type="button" 
                     variant="ghost"
                     size="icon"
                     className="rounded-full text-slate-400 hover:text-blue-600 hover:bg-blue-50 mb-1"
                     onClick={() => fileInputRef.current?.click()}
                     disabled={isUploading || isChatting}
                     title="Add context"
                   >
                     <Paperclip size={20} />
                   </Button>

                   {/* Text Input */}
                   <div className="flex-1 py-3">
                       <input
                         value={question} 
                         onChange={(e) => setQuestion(e.target.value)} 
                         placeholder="Message DocChat..." 
                         className="w-full bg-transparent border-none focus:ring-0 text-slate-800 placeholder:text-slate-400 text-base resize-none max-h-32 py-0 focus:outline-none shadow-none"
                         disabled={isUploading || isChatting}
                         autoComplete="off"
                       />
                   </div>

                   {/* Send Button */}
                   <Button 
                        type="submit" 
                        disabled={!question.trim() || isUploading || isChatting}
                        className={`rounded-2xl h-10 w-10 p-0 mb-1 transition-all duration-300 ${question.trim() ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/30' : 'bg-slate-100 text-slate-300'}`}
                    >
                     {isChatting ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                   </Button>
                 </form>
             </div>
             
             {/* Gradient Fade at bottom to hide scrolling text behind input */}
             <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#F8FAFC] to-transparent pointer-events-none z-10" />
          </>
        )}
      </div>
    </div>
  );
}