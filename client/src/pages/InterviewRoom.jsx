import axios from "axios";
import { useEffect, useRef, useState, memo } from "react";
import { useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import { io } from "socket.io-client";

/* ─────────────────────────────────────────────
   VIDEO TILE — memo so it NEVER re-renders
   unless its own stream/name prop changes
───────────────────────────────────────────── */
const VideoTile = memo(({ stream, name, role, muted = false }) => {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div style={{
      background: "#1e293b",
      borderRadius: "16px",
      padding: "15px",
      minHeight: "320px",
    }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        style={{
          width: "100%",
          height: "240px",
          objectFit: "cover",
          borderRadius: "12px",
          background: "black",
        }}
      />
      <h3 style={{ marginTop: "10px", color: "white" }}>{name}</h3>
      {role && <p style={{ color: "#94a3b8" }}>{role}</p>}
    </div>
  );
});

/* ─────────────────────────────────────────────
   WAITING TILE
───────────────────────────────────────────── */
const WaitingTile = memo(() => (
  <div style={{
    background: "#1e293b",
    borderRadius: "16px",
    minHeight: "320px",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    fontSize: "22px",
    color: "white",
  }}>
    Waiting...
  </div>
));

/* ─────────────────────────────────────────────
   CODE EDITOR — memo + fully uncontrolled Monaco
   No value= prop. Uses editor.setValue() for
   remote changes. onChange never calls setState.
───────────────────────────────────────────── */
const CodeEditor = memo(({ onMount, onChange, defaultValue, language }) => {
  return (
    <Editor
      height="550px"
      theme="vs-dark"
      language={language}
      defaultValue={defaultValue}
      options={{
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontSize: 14,
      }}
      onMount={onMount}
      onChange={onChange}
    />
  );
});

/* ─────────────────────────────────────────────
   CHAT PANEL — memo, only re-renders when
   messages array changes
───────────────────────────────────────────── */
const ChatPanel = memo(({ messages, onSend }) => {
  const [message, setMessage] = useState("");
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = () => {
    if (!message.trim()) return;
    onSend(message);
    setMessage("");
  };

  return (
    <div style={{
      background: "#111827",
      borderRadius: "16px",
      padding: "20px",
      display: "flex",
      flexDirection: "column",
      height: "650px",
    }}>
      <h2 style={{ color: "white" }}>Chat</h2>
      <div style={{ flex: 1, overflowY: "auto", marginBottom: "15px" }}>
        {messages.map((msg, index) => (
          <div key={index} style={{
            background: "#1e293b",
            padding: "12px",
            borderRadius: "10px",
            marginBottom: "10px",
            color: "white",
          }}>
            <strong>{msg.sender}</strong>
            <div>{msg.message}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div style={{ display: "flex" }}>
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          style={{ flex: 1, padding: "12px", borderRadius: "10px", border: "none" }}
        />
        <button
          onClick={send}
          style={{
            marginLeft: "10px",
            padding: "12px 18px",
            background: "#2563eb",
            border: "none",
            color: "white",
            borderRadius: "10px",
            cursor: "pointer",
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
});

/* ─────────────────────────────────────────────
   MAIN COMPONENT — manages only socket/WebRTC
   state. UI state lives in child components.
───────────────────────────────────────────── */
function InterviewRoom() {
  const { roomId } = useParams();

  // Refs — never cause re-renders
  const socketRef        = useRef(null);
  const localStreamRef   = useRef(null);
  const peerConnections  = useRef({});
  const initialLoadDone  = useRef(false);
  const socketInitialized = useRef(false);
  const editorRef        = useRef(null);
  const codeRef          = useRef(`console.log("Hello SkillSync");`);
  const languageRef      = useRef("javascript");
  const editorDebounce   = useRef(null);
  const isEditingRef     = useRef(false);
  const suppressSyncRef  = useRef(false);

  // Minimal state — only what drives visible UI in THIS component
  const [localStream,   setLocalStream]   = useState(null);
  const [remoteStreams, setRemoteStreams]  = useState([]);
  const [participants,  setParticipants]  = useState([]);
  const [messages,      setMessages]      = useState([]);
  const [language,      setLanguage]      = useState("javascript");
  const [output,        setOutput]        = useState("");
  const [logic,         setLogic]         = useState("");

  const defaultCodes = {
    javascript: `console.log("Hello SkillSync");`,
    python: `print("Hello SkillSync")`,
    cpp: `#include <iostream>\nusing namespace std;\nint main() {\n  cout << "Hello SkillSync";\n  return 0;\n}`,
    java: `class Main {\n  public static void main(String[] args) {\n    System.out.println("Hello SkillSync");\n  }\n}`,
  };

  const user = {
    name: localStorage.getItem("name") || "Anonymous",
    role: localStorage.getItem("role") || "candidate",
  };

  /* ── CAMERA ── */
  useEffect(() => {
    let mounted = true;
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (!mounted) return;
        localStreamRef.current = stream;
        setLocalStream(stream); // only set once — VideoTile memo handles the rest
      })
      .catch((err) => console.log("Camera Error:", err));
    return () => { mounted = false; };
  }, []);

  /* ── PEER CONNECTION ── */
  const createPeerConnection = async (targetSocketId, createOffer = false) => {
    if (peerConnections.current[targetSocketId]) {
      return peerConnections.current[targetSocketId];
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        {
          urls: [
            "turn:openrelay.metered.ca:80",
            "turn:openrelay.metered.ca:443",
            "turn:openrelay.metered.ca:443?transport=tcp",
          ],
          username: "openrelayproject",
          credential: "openrelayproject",
        },
      ],
    });

    peerConnections.current[targetSocketId] = pc;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      setRemoteStreams((prev) => {
        const exists = prev.find((p) => p.socketId === targetSocketId);
        if (exists) {
          // Return same array if stream unchanged — avoids re-render
          if (exists.stream === remoteStream) return prev;
          return prev.map((p) =>
            p.socketId === targetSocketId ? { ...p, stream: remoteStream } : p
          );
        }
        return [...prev, { socketId: targetSocketId, stream: remoteStream }];
      });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit("ice-candidate", { targetSocketId, candidate: event.candidate });
      }
    };

    if (createOffer) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current.emit("offer", { targetSocketId, offer });
      } catch (err) {
        console.log(err);
      }
    }

    return pc;
  };

  /* ── SOCKET ── */
  useEffect(() => {
    if (socketInitialized.current) return;
    socketInitialized.current = true;

    socketRef.current = io("/", {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
    });

    const socket = socketRef.current;
    socket.emit("join-room", { roomId, user });

    axios.get(`/messages/${roomId}`)
      .then((r) => setMessages(r.data))
      .catch(console.log);

    socket.on("room-state", (data) => {
      initialLoadDone.current = true;
      const newCode = data.code || defaultCodes.javascript;
      const newLang = data.language || "javascript";
      codeRef.current = newCode;
      languageRef.current = newLang;
      if (editorRef.current) editorRef.current.setValue(newCode);
      setLanguage(newLang);
      setLogic(data.logic || "");
      setOutput(data.output || "");
    });

    socket.on("existing-users", async (users) => {
      const filtered = users.filter((u) => u.socketId !== socket.id);
      setParticipants(Array.from(new Map(filtered.map((p) => [p.socketId, p])).values()));
      for (const p of filtered) await createPeerConnection(p.socketId, true);
    });

    socket.on("user-joined", async (participant) => {
      if (participant.socketId === socket.id) return;
      setParticipants((prev) => {
        if (prev.find((p) => p.socketId === participant.socketId)) return prev;
        return [...prev, participant];
      });
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
      if (peerConnections.current[socketId]) {
        peerConnections.current[socketId].close();
        delete peerConnections.current[socketId];
      }
      setRemoteStreams((prev) => prev.filter((p) => p.socketId !== socketId));
      setParticipants((prev) => prev.filter((p) => p.socketId !== socketId));
    });

    socket.on("receive-message", (msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on("sync-editor", (data) => {
      if (isEditingRef.current) return;
      suppressSyncRef.current = true;
      codeRef.current = data.code;
      languageRef.current = data.language;
      if (editorRef.current) editorRef.current.setValue(data.code);
      setLanguage(data.language); // only updates <select>, not editor
      suppressSyncRef.current = false;
    });

    socket.on("sync-logic", (data) => {
      setLogic((prev) => (prev === data ? prev : data));
    });

    socket.on("sync-output", (data) => {
      setOutput((prev) => (prev === data ? prev : data));
    });

    return () => {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      Object.values(peerConnections.current).forEach((pc) => pc.close());
      socket.disconnect();
      socketInitialized.current = false;
    };
  }, []);

  /* ── LOGIC SYNC ── */
  useEffect(() => {
    if (!initialLoadDone.current) return;
    socketRef.current?.emit("logic-change", { roomId, logic });
  }, [logic]);

  /* ── OUTPUT SYNC ── */
  useEffect(() => {
    if (!initialLoadDone.current) return;
    socketRef.current?.emit("output-change", { roomId, output });
  }, [output]);

  /* ── RUN CODE ── */
  const runCode = async () => {
    try {
      const res = await axios.post("/run", {
        code: codeRef.current,
        language: languageRef.current,
      });
      setOutput(res.data.output);
    } catch (err) {
      console.log(err);
    }
  };

  /* ── SEND MESSAGE ── */
  const sendMessage = (text) => {
    socketRef.current?.emit("send-message", {
      roomId,
      sender: user.name,
      role: user.role,
      message: text,
    });
  };

  /* ── LANGUAGE CHANGE ── */
  const handleLanguageChange = (e) => {
    const newLang = e.target.value;
    const newCode = defaultCodes[newLang];
    languageRef.current = newLang;
    codeRef.current = newCode;
    setLanguage(newLang);
    if (editorRef.current) editorRef.current.setValue(newCode);
    clearTimeout(editorDebounce.current);
    editorDebounce.current = setTimeout(() => {
      if (!initialLoadDone.current) return;
      socketRef.current?.emit("editor-change", { roomId, code: newCode, language: newLang });
    }, 100);
  };

  /* ── EDITOR CALLBACKS (stable refs, never recreated) ── */
  const handleEditorMount = useRef((editor) => {
    editorRef.current = editor;
    editor.onDidFocusEditorWidget(() => { isEditingRef.current = true; });
    editor.onDidBlurEditorWidget(() => { isEditingRef.current = false; });
  }).current;

  const handleEditorChange = useRef((value) => {
    if (suppressSyncRef.current) return;
    codeRef.current = value || "";
    clearTimeout(editorDebounce.current);
    editorDebounce.current = setTimeout(() => {
      if (!initialLoadDone.current) return;
      socketRef.current?.emit("editor-change", {
        roomId,
        code: codeRef.current,
        language: languageRef.current,
      });
    }, 300);
  }).current;

  // Find participant names for remote streams
  const getName = (socketId) =>
    participants.find((p) => p.socketId === socketId)?.name || "Participant";

  return (
    <div style={{
      background: "#0f172a",
      minHeight: "100vh",
      padding: "20px",
      color: "white",
      fontFamily: "sans-serif",
    }}>
      <h1 style={{ marginBottom: "25px", fontSize: "36px" }}>
        SkillSync Interview Room
      </h1>

      {/* CAMERAS */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: "20px",
        marginBottom: "25px",
      }}>
        {/* Local — stream only set once, VideoTile is memoized */}
        <VideoTile
          stream={localStream}
          name={user.name}
          role={user.role}
          muted={true}
        />

        {/* Remote 1 */}
        {remoteStreams[0]
          ? <VideoTile stream={remoteStreams[0].stream} name={getName(remoteStreams[0].socketId)} />
          : <WaitingTile />
        }

        {/* Remote 2 */}
        {remoteStreams[1]
          ? <VideoTile stream={remoteStreams[1].stream} name={getName(remoteStreams[1].socketId)} />
          : <WaitingTile />
        }
      </div>

      {/* DASHBOARD */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "300px 1fr 300px",
        gap: "20px",
        marginBottom: "25px",
      }}>
        {/* Chat — memoized, only re-renders when messages change */}
        <ChatPanel messages={messages} onSend={sendMessage} />

        {/* Editor */}
        <div style={{
          background: "#111827",
          borderRadius: "16px",
          padding: "20px",
          overflow: "hidden",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "15px" }}>
            <select
              value={language}
              onChange={handleLanguageChange}
              style={{ padding: "12px", borderRadius: "10px" }}
            >
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
              <option value="cpp">C++</option>
              <option value="java">Java</option>
            </select>
            <button
              onClick={runCode}
              style={{
                padding: "12px 25px",
                background: "#16a34a",
                border: "none",
                color: "white",
                borderRadius: "10px",
                cursor: "pointer",
              }}
            >
              Run Code
            </button>
          </div>

          {/* CodeEditor is memoized — language prop change is the only allowed re-render trigger */}
          <CodeEditor
            language={language}
            defaultValue={codeRef.current}
            onMount={handleEditorMount}
            onChange={handleEditorChange}
          />
        </div>

        {/* Output */}
        <div style={{ background: "#111827", borderRadius: "16px", padding: "20px" }}>
          <h2>Output</h2>
          <pre style={{ color: "#22c55e", whiteSpace: "pre-wrap" }}>
            {output || "Run code to see output"}
          </pre>
        </div>
      </div>

      {/* LOGIC */}
      <div style={{ background: "white", padding: "25px", borderRadius: "16px" }}>
        <h2 style={{ color: "black" }}>Logic / Notes</h2>
        <textarea
          value={logic}
          onChange={(e) => setLogic(e.target.value)}
          style={{
            width: "100%",
            height: "250px",
            padding: "20px",
            fontSize: "18px",
            borderRadius: "12px",
            boxSizing: "border-box",
          }}
        />
      </div>
    </div>
  );
}

export default InterviewRoom;