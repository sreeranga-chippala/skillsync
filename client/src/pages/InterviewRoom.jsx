import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import { io } from "socket.io-client";

/* ─── constants ──────────────────────────────────────── */

const DEFAULT_CODES = {
  javascript: 'console.log("Hello SkillSync");',
  python:     'print("Hello SkillSync")',
  cpp: `#include <iostream>
using namespace std;
int main() {
  cout << "Hello SkillSync";
  return 0;
}`,
  java: `class Main {
  public static void main(String[] args) {
    System.out.println("Hello SkillSync");
  }
}`
};

const ROLE_COLORS = {
  interviewer: "#4ade80",
  candidate:   "#60a5fa",
};
const roleColor = (r = "candidate") => ROLE_COLORS[r?.toLowerCase()] ?? "#a78bfa";

const fmtTime = (d) =>
  new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/* ─── VideoCard ──────────────────────────────────────── */
function VideoCard({ videoRef, stream, name, role, muted = false }) {
  const internalRef = useRef(null);
  const ref = videoRef || internalRef;

  useEffect(() => {
    if (stream && ref.current) ref.current.srcObject = stream;
  }, [stream]);

  return (
    <div style={S.videoCard}>
      <video ref={ref} autoPlay muted={muted} playsInline style={S.videoEl} />
      <div style={S.videoLabel}>
        <span style={S.videoName}>{name || "Unknown"}</span>
        <span style={{ ...S.videoRole, color: roleColor(role) }}>{role || "—"}</span>
      </div>
    </div>
  );
}

/* ─── ChatBubble ─────────────────────────────────────── */
function ChatBubble({ msg, isSelf }) {
  return (
    <div style={{ ...S.bubbleRow, alignItems: isSelf ? "flex-end" : "flex-start" }}>
      <div style={S.bubbleMeta}>
        <span style={{ ...S.bubbleSender, color: roleColor(msg.role) }}>
          {isSelf ? "You" : msg.sender}
        </span>
        <span style={S.bubbleRoleTag}>· {msg.role}</span>
      </div>
      <div style={isSelf ? S.bubbleSelf : S.bubbleOther}>
        <span style={S.bubbleText}>{msg.message}</span>
        <span style={S.bubbleTime}>{fmtTime(msg.createdAt || Date.now())}</span>
      </div>
    </div>
  );
}

/* ─── InterviewRoom ──────────────────────────────────── */
function InterviewRoom() {
  const { roomId } = useParams();

  const socketRef       = useRef(null);
  const localVideoRef   = useRef(null);
  const localStreamRef  = useRef(null);
  const peerConnections = useRef({});
  const chatEndRef      = useRef(null);
  const initialLoadDone = useRef(false);

  const [participants,  setParticipants]  = useState([]);
  const [remoteStreams, setRemoteStreams]  = useState([]);
  const [messages,      setMessages]      = useState([]);
  const [message,       setMessage]       = useState("");
  const [language,      setLanguage]      = useState("javascript");
  const [code,          setCode]          = useState(DEFAULT_CODES.javascript);
  const [output,        setOutput]        = useState("");
  const [logic,         setLogic]         = useState("");
  const [running,       setRunning]       = useState(false);

  const user = {
    name: localStorage.getItem("name") || "Anonymous",
    role: localStorage.getItem("role") || "candidate",
  };

  /* ── camera ── */
  useEffect(() => {
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch (err) {
        console.log("Camera error:", err);
      }
    })();
    return () => localStreamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  /* ── auto-scroll chat ── */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ── peer connection factory ── */
  const createPeerConnection = async (targetSocketId, createOffer = false) => {
    if (peerConnections.current[targetSocketId]) return peerConnections.current[targetSocketId];

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        {
          urls: [
            "turn:openrelay.metered.ca:80",
            "turn:openrelay.metered.ca:443",
            "turn:openrelay.metered.ca:443?transport=tcp"
          ],
          username:   "openrelayproject",
          credential: "openrelayproject"
        }
      ]
    });

    peerConnections.current[targetSocketId] = pc;

    localStreamRef.current?.getTracks().forEach((t) =>
      pc.addTrack(t, localStreamRef.current)
    );

    pc.ontrack = (e) => {
      setRemoteStreams((prev) => {
        const filtered = prev.filter((p) => p.socketId !== targetSocketId);
        return [...filtered, { socketId: targetSocketId, stream: e.streams[0] }];
      });
    };

    pc.onicecandidate = (e) => {
      if (e.candidate)
        socketRef.current.emit("ice-candidate", { targetSocketId, candidate: e.candidate });
    };

    if (createOffer) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketRef.current.emit("offer", { targetSocketId, offer });
    }

    return pc;
  };

  /* ── socket ── */
  useEffect(() => {
    socketRef.current = io("/", {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
    });
    const socket = socketRef.current;

    socket.emit("join-room", { roomId, user });

    /* load chat history */
    axios.get(`/messages/${roomId}`)
      .then((r) => setMessages(r.data))
      .catch(console.log);

    /* room state (code/logic/output catch-up) */
    socket.on("room-state", (data) => {
      initialLoadDone.current = true;
      setCode(data.code     || DEFAULT_CODES.javascript);
      setLanguage(data.language || "javascript");
      setLogic(data.logic   || "");
      setOutput(data.output || "");
    });

    /* existing users → create peer connections */
    socket.on("existing-users", async (users) => {
      const others = users.filter((u) => u.socketId !== socket.id);
      setParticipants(others);
      for (const p of others) await createPeerConnection(p.socketId, true);
    });

    socket.on("participants-update", (users) => {
      setParticipants(users.filter((u) => u.socketId !== socket.id));
    });

    socket.on("user-joined", async (participant) => {
      if (participant.socketId === socket.id) return;
      setParticipants((prev) =>
        prev.find((p) => p.socketId === participant.socketId) ? prev : [...prev, participant]
      );
      await createPeerConnection(participant.socketId, true);
    });

    socket.on("offer", async ({ offer, senderSocketId }) => {
      const pc = await createPeerConnection(senderSocketId, false);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("answer", { targetSocketId: senderSocketId, answer });
    });

    socket.on("answer", async ({ answer, senderSocketId }) => {
      const pc = peerConnections.current[senderSocketId];
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on("ice-candidate", async ({ candidate, senderSocketId }) => {
      const pc = peerConnections.current[senderSocketId];
      if (!pc) return;
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
      catch (err) { console.log(err); }
    });

    socket.on("user-left", (socketId) => {
      peerConnections.current[socketId]?.close();
      delete peerConnections.current[socketId];
      setRemoteStreams((prev) => prev.filter((p) => p.socketId !== socketId));
      setParticipants((prev)  => prev.filter((p) => p.socketId !== socketId));
    });

    socket.on("receive-message", (msg) => setMessages((prev) => [...prev, msg]));
    socket.on("sync-editor",     (d)   => { setCode(d.code); setLanguage(d.language); });
    socket.on("sync-logic",      (d)   => setLogic(d));
    socket.on("sync-output",     (d)   => setOutput(d));

    return () => {
      Object.values(peerConnections.current).forEach((pc) => pc.close());
      socket.disconnect();
    };
  }, []);

  /* ── emit editor changes ── */
  const handleCodeChange = (value) => {
    setCode(value);
    socketRef.current?.emit("editor-change", { roomId, code: value, language });
  };

  const handleLanguageChange = (lang) => {
    const newCode = DEFAULT_CODES[lang] || "";
    setLanguage(lang);
    setCode(newCode);
    socketRef.current?.emit("editor-change", { roomId, code: newCode, language: lang });
  };

  /* ── emit logic changes ── */
  const handleLogicChange = (e) => {
    const val = e.target.value;
    setLogic(val);
    socketRef.current?.emit("logic-change", { roomId, logic: val });
  };

  /* ── run code ── */
  const runCode = async () => {
    setRunning(true);
    try {
      const res = await axios.post("/run", { code, language });
      const out = res.data.output;
      setOutput(out);
      socketRef.current?.emit("output-change", { roomId, output: out });
    } catch (err) {
      const msg = err.message || "Execution error";
      setOutput(msg);
    } finally {
      setRunning(false);
    }
  };

  /* ── send chat ── */
  const sendMessage = () => {
    if (!message.trim()) return;
    socketRef.current.emit("send-message", {
      roomId, sender: user.name, role: user.role, message
    });
    setMessage("");
  };

  const handleChatKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  /* ══════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════ */
  return (
    <div style={S.root}>

      {/* ══ LEFT SIDEBAR ══ */}
      <div style={S.sidebar}>

        {/* header */}
        <div style={S.sidebarHeader}>
          <span style={S.logo}>Skill<span style={{ color: "#6366f1" }}>Sync</span></span>
          <span style={S.roomTag}>{roomId}</span>
        </div>

        {/* participants label */}
        <div style={S.sectionLabel}>Participants ({1 + remoteStreams.length}/3)</div>

        {/* video grid */}
        <div style={S.videoGrid}>
          <VideoCard videoRef={localVideoRef} name={`${user.name} (you)`} role={user.role} muted />

          {remoteStreams[0] ? (
            <VideoCard
              stream={remoteStreams[0].stream}
              name={participants.find((p) => p.socketId === remoteStreams[0].socketId)?.name}
              role={participants.find((p) => p.socketId === remoteStreams[0].socketId)?.role}
            />
          ) : (
            <div style={S.videoPlaceholder}>
              <span style={{ fontSize: 22, marginBottom: 6 }}>👤</span>
              Waiting for peer 2…
            </div>
          )}

          {remoteStreams[1] ? (
            <VideoCard
              stream={remoteStreams[1].stream}
              name={participants.find((p) => p.socketId === remoteStreams[1].socketId)?.name}
              role={participants.find((p) => p.socketId === remoteStreams[1].socketId)?.role}
            />
          ) : (
            <div style={S.videoPlaceholder}>
              <span style={{ fontSize: 22, marginBottom: 6 }}>👤</span>
              Waiting for peer 3…
            </div>
          )}
        </div>

        {/* chat */}
        <div style={S.sectionLabel}>Chat</div>
        <div style={S.chat}>
          <div style={S.chatMessages}>
            {messages.length === 0 && (
              <div style={S.chatEmpty}>No messages yet</div>
            )}
            {messages.map((msg, i) => (
              <ChatBubble key={msg._id || i} msg={msg} isSelf={msg.sender === user.name} />
            ))}
            <div ref={chatEndRef} />
          </div>
          <div style={S.chatInputRow}>
            <input
              style={S.chatInput}
              type="text"
              placeholder="Message…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleChatKey}
            />
            <button style={S.chatSendBtn} onClick={sendMessage} aria-label="Send">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        </div>

      </div>

      {/* ══ MAIN AREA ══ */}
      <div style={S.main}>

        {/* lang bar + editor + output */}
        <div style={S.editorSection}>

          {/* language selector */}
          <div style={S.langBar}>
            <span style={S.langLabel}>Language</span>
            {["javascript", "python", "cpp", "java"].map((lang) => (
              <button
                key={lang}
                style={{
                  ...S.langBtn,
                  ...(language === lang ? S.langBtnActive : {})
                }}
                onClick={() => handleLanguageChange(lang)}
              >
                {lang}
              </button>
            ))}
          </div>

          <div style={S.editorOutputRow}>
            {/* editor */}
            <div style={S.editorWrap}>
              <Editor
                height="100%"
                theme="vs-dark"
                language={language === "cpp" ? "cpp" : language}
                value={code}
                onChange={handleCodeChange}
                options={{
                  fontSize: 13,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  fontLigatures: true,
                  padding: { top: 12 }
                }}
              />
            </div>

            {/* output panel */}
            <div style={S.outputPanel}>
              <div style={S.outputToolbar}>
                <span style={S.outputTitle}>Output</span>
                <button style={S.runBtn} onClick={runCode} disabled={running}>
                  {running ? (
                    <>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                      </svg>
                      Running…
                    </>
                  ) : (
                    <>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                      </svg>
                      Run
                    </>
                  )}
                </button>
              </div>
              <div style={S.outputContent}>
                {output
                  ? output
                  : <span style={S.outputPlaceholder}>Run your code to see output…</span>
                }
              </div>
            </div>
          </div>
        </div>

        {/* logic / system design panel */}
        <div style={S.logicSection}>
          <div style={S.logicHeader}>
            <span style={S.sectionLabel}>Logic / System Design</span>
          </div>
          <textarea
            style={S.logicTextarea}
            value={logic}
            onChange={handleLogicChange}
            placeholder="Discuss architecture, pseudocode, database design, system design…"
          />
        </div>

      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   STYLES
══════════════════════════════════════════ */
const S = {
  root: {
    display: "grid",
    gridTemplateColumns: "300px 1fr",
    height: "100vh",
    background: "#080b12",
    color: "#e2e8f0",
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    overflow: "hidden",
  },

  /* sidebar */
  sidebar: {
    display: "flex",
    flexDirection: "column",
    background: "#0d1017",
    borderRight: "1px solid #1e2540",
    overflow: "hidden",
    padding: "0 0 12px 0",
  },
  sidebarHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 16px 12px",
    borderBottom: "1px solid #1e2540",
  },
  logo: {
    fontSize: 18,
    fontWeight: 800,
    color: "#f1f5f9",
    letterSpacing: "-0.5px",
  },
  roomTag: {
    fontSize: 10,
    color: "#4b5563",
    background: "#1e2540",
    padding: "3px 8px",
    borderRadius: 6,
    letterSpacing: "0.05em",
  },
  sectionLabel: {
    fontSize: 10,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#4b5563",
    padding: "10px 16px 6px",
  },

  /* video */
  videoGrid: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "0 12px",
  },
  videoCard: {
    position: "relative",
    borderRadius: 10,
    overflow: "hidden",
    background: "#060810",
    border: "1px solid #1e2540",
    aspectRatio: "16/10",
    flexShrink: 0,
  },
  videoEl: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  videoLabel: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    background: "linear-gradient(transparent, rgba(0,0,0,0.85))",
    fontSize: 11,
  },
  videoName: { fontWeight: 600, color: "#f1f5f9" },
  videoRole: { fontSize: 10, fontWeight: 500 },
  videoPlaceholder: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    aspectRatio: "16/10",
    borderRadius: 10,
    border: "1px dashed #1e2540",
    background: "#060810",
    color: "#2d3748",
    fontSize: 11,
    letterSpacing: "0.06em",
  },

  /* chat */
  chat: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
    margin: "0 0 0 0",
    overflow: "hidden",
  },
  chatMessages: {
    flex: 1,
    overflowY: "auto",
    padding: "8px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    scrollBehavior: "smooth",
  },
  chatEmpty: {
    color: "#2d3748",
    fontSize: 11,
    textAlign: "center",
    marginTop: 20,
  },
  chatInputRow: {
    display: "flex",
    gap: 6,
    padding: "8px 10px",
    borderTop: "1px solid #1a1e28",
    flexShrink: 0,
  },
  chatInput: {
    flex: 1,
    background: "#080b12",
    border: "1px solid #1e2540",
    borderRadius: 20,
    padding: "8px 14px",
    fontSize: 12,
    color: "#e2e8f0",
    fontFamily: "inherit",
    outline: "none",
  },
  chatSendBtn: {
    width: 34, height: 34,
    borderRadius: "50%",
    background: "#4f46e5",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    color: "#fff",
  },

  /* chat bubbles */
  bubbleRow: {
    display: "flex",
    flexDirection: "column",
    maxWidth: "90%",
    alignSelf: "flex-start",
  },
  bubbleMeta: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    marginBottom: 2,
    padding: "0 4px",
  },
  bubbleSender: { fontSize: 10, fontWeight: 700 },
  bubbleRoleTag: { fontSize: 9, color: "#6b7280" },
  bubbleSelf: {
    display: "flex",
    alignItems: "flex-end",
    gap: 8,
    padding: "8px 12px",
    borderRadius: 14,
    borderBottomRightRadius: 4,
    background: "#3730a3",
    color: "#ffffff",
    fontSize: 12,
    lineHeight: 1.5,
    wordBreak: "break-word",
  },
  bubbleOther: {
    display: "flex",
    alignItems: "flex-end",
    gap: 8,
    padding: "8px 12px",
    borderRadius: 14,
    borderBottomLeftRadius: 4,
    background: "#1e2540",
    color: "#f1f5f9",
    border: "1px solid #2d3748",
    fontSize: 12,
    lineHeight: 1.5,
    wordBreak: "break-word",
  },
  bubbleText: { flex: 1 },
  bubbleTime: { fontSize: 9, color: "rgba(255,255,255,0.4)", whiteSpace: "nowrap", flexShrink: 0 },

  /* main */
  main: {
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    padding: "12px 16px 12px 12px",
    gap: 12,
    minHeight: 0,
  },

  /* editor section */
  editorSection: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
    gap: 0,
  },
  langBar: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 12px",
    background: "#0d1017",
    border: "1px solid #1e2540",
    borderBottom: "none",
    borderRadius: "10px 10px 0 0",
  },
  langLabel: {
    fontSize: 10,
    color: "#4b5563",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    marginRight: 4,
  },
  langBtn: {
    padding: "4px 12px",
    borderRadius: 6,
    border: "1px solid #1e2540",
    background: "transparent",
    color: "#4b5563",
    fontSize: 11,
    fontFamily: "inherit",
    cursor: "pointer",
    transition: "all 0.15s",
  },
  langBtnActive: {
    background: "#1e2540",
    color: "#a5b4fc",
    borderColor: "#4f46e5",
  },
  editorOutputRow: {
    display: "grid",
    gridTemplateColumns: "1fr 260px",
    flex: 1,
    minHeight: 0,
    gap: 12,
  },
  editorWrap: {
    borderRadius: "0 0 10px 10px",
    overflow: "hidden",
    border: "1px solid #1e2540",
    minHeight: 0,
  },
  outputPanel: {
    display: "flex",
    flexDirection: "column",
    background: "#06080e",
    border: "1px solid #1e2540",
    borderRadius: 10,
    overflow: "hidden",
    minHeight: 0,
  },
  outputToolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 14px",
    borderBottom: "1px solid #1a1e28",
    flexShrink: 0,
  },
  outputTitle: {
    fontSize: 10,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "#4b5563",
  },
  runBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 14px",
    background: "#16a34a",
    border: "none",
    borderRadius: 6,
    color: "#fff",
    fontSize: 11,
    fontFamily: "inherit",
    fontWeight: 600,
    cursor: "pointer",
    letterSpacing: "0.06em",
  },
  outputContent: {
    flex: 1,
    overflowY: "auto",
    padding: "12px 14px",
    fontSize: 12,
    lineHeight: 1.6,
    color: "#4ade80",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  outputPlaceholder: {
    color: "#374151",
    fontStyle: "italic",
  },

  /* logic */
  logicSection: {
    display: "flex",
    flexDirection: "column",
    background: "#0d1017",
    border: "1px solid #1e2540",
    borderRadius: 10,
    overflow: "hidden",
    flexShrink: 0,
  },
  logicHeader: {
    borderBottom: "1px solid #1e2540",
    padding: "2px 0",
  },
  logicTextarea: {
    width: "100%",
    height: 130,
    background: "transparent",
    border: "none",
    padding: "12px 16px",
    fontSize: 12,
    color: "#cbd5e1",
    fontFamily: "inherit",
    resize: "none",
    outline: "none",
    lineHeight: 1.6,
    boxSizing: "border-box",
  },
};

export default InterviewRoom;
