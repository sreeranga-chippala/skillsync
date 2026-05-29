import axios from "axios";
import { useEffect, useRef, useState, memo } from "react";
import { useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import { io } from "socket.io-client";

/* ─────────────────────────────────────────────
   VIDEO TILE — memo, sets srcObject directly
───────────────────────────────────────────── */
const VideoTile = memo(({ stream, name, role, muted = false }) => {
  const videoRef = useRef(null);

  useEffect(() => {
    if (!videoRef.current) return;
    if (stream && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div style={{
      background: "#1e293b", borderRadius: "16px",
      padding: "15px", minHeight: "320px",
    }}>
      <video ref={videoRef} autoPlay playsInline muted={muted}
        style={{ width: "100%", height: "240px", objectFit: "cover",
          borderRadius: "12px", background: "black" }}
      />
      <h3 style={{ marginTop: "10px", color: "white" }}>{name}</h3>
      {role && <p style={{ color: "#94a3b8" }}>{role}</p>}
    </div>
  );
}, (prev, next) => prev.stream === next.stream && prev.name === next.name);

/* ─────────────────────────────────────────────
   WAITING TILE — static, never re-renders
───────────────────────────────────────────── */
const WaitingTile = memo(() => (
  <div style={{
    background: "#1e293b", borderRadius: "16px", minHeight: "320px",
    display: "flex", justifyContent: "center",
    alignItems: "center", fontSize: "22px", color: "white",
  }}>
    Waiting...
  </div>
));

/* ─────────────────────────────────────────────
   CODE EDITOR — fully uncontrolled Monaco
   onMount/onChange passed as stable refs so
   memo is never broken by new function refs
───────────────────────────────────────────── */
const CodeEditor = memo(({ language, defaultValue, onMount, onChange }) => (
  <Editor
    height="550px"
    theme="vs-dark"
    language={language}
    defaultValue={defaultValue}
    options={{ minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 14 }}
    onMount={onMount}
    onChange={onChange}
  />
), (prev, next) => prev.language === next.language);
// Only re-render when language changes — nothing else should cause Monaco to remount

/* ─────────────────────────────────────────────
   CHAT PANEL — self-contained state
───────────────────────────────────────────── */
const ChatPanel = memo(({ messages, onSend }) => {
  const [msg, setMsg] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = () => {
    if (!msg.trim()) return;
    onSend(msg);
    setMsg("");
  };

  return (
    <div style={{
      background: "#111827", borderRadius: "16px", padding: "20px",
      display: "flex", flexDirection: "column", height: "650px",
    }}>
      <h2 style={{ color: "white" }}>Chat</h2>
      <div style={{ flex: 1, overflowY: "auto", marginBottom: "15px" }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            background: "#1e293b", padding: "12px",
            borderRadius: "10px", marginBottom: "10px", color: "white",
          }}>
            <strong>{m.sender}</strong>
            <div>{m.message}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div style={{ display: "flex" }}>
        <input value={msg} onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          style={{ flex: 1, padding: "12px", borderRadius: "10px", border: "none" }}
        />
        <button onClick={send} style={{
          marginLeft: "10px", padding: "12px 18px", background: "#2563eb",
          border: "none", color: "white", borderRadius: "10px", cursor: "pointer",
        }}>Send</button>
      </div>
    </div>
  );
});

/* ─────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────── */
function InterviewRoom() {
  const { roomId } = useParams();

  // All mutable state that should NOT cause re-renders lives in refs
  const socketRef         = useRef(null);
  const localStreamRef    = useRef(null);
  const peerConnections   = useRef({});
  const initialLoadDone   = useRef(false);
  const editorRef         = useRef(null);
  const codeRef           = useRef(`console.log("Hello SkillSync");`);
  const languageRef       = useRef("javascript");
  const editorDebounce    = useRef(null);
  const isEditingRef      = useRef(false);
  const suppressSyncRef   = useRef(false);

  // FIX: single init flag that survives Strict Mode double-invoke
  // We attach it to the socket ref itself — if socket exists, don't reinit
  const didInit = useRef(false);

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

  const user = useRef({
    name: localStorage.getItem("name") || "Anonymous",
    role: localStorage.getItem("role") || "candidate",
  }).current; // stable object, never recreated

  /* ── CAMERA — one-time init ── */
  useEffect(() => {
    // Guard against Strict Mode double-invoke
    if (localStreamRef.current) return;

    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        localStreamRef.current = stream;
        setLocalStream(stream);
      })
      .catch((err) => console.log("Camera Error:", err));

    return () => {
      // Only stop tracks on true unmount, not Strict Mode remount
      // We check if component is actually gone by delaying
    };
  }, []);

  /* ── PEER CONNECTION ── */
  const createPeerConnection = useRef(async (targetSocketId, createOffer = false) => {
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
          if (exists.stream === remoteStream) return prev; // no change, no re-render
          return prev.map((p) =>
            p.socketId === targetSocketId ? { ...p, stream: remoteStream } : p
          );
        }
        return [...prev, { socketId: targetSocketId, stream: remoteStream }];
      });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit("ice-candidate", {
          targetSocketId, candidate: event.candidate,
        });
      }
    };

    if (createOffer) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current?.emit("offer", { targetSocketId, offer });
      } catch (err) {
        console.log(err);
      }
    }

    return pc;
  }).current;

  /* ── SOCKET — strict-mode safe init ── */
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    const socket = io("/", {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

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
      setParticipants(Array.from(
        new Map(filtered.map((p) => [p.socketId, p])).values()
      ));
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
      setLanguage(data.language);
      suppressSyncRef.current = false;
    });

    socket.on("sync-logic", (data) => {
      setLogic((prev) => (prev === data ? prev : data));
    });

    socket.on("sync-output", (data) => {
      setOutput((prev) => (prev === data ? prev : data));
    });

    return () => {
      // True cleanup only — didInit stays true so Strict Mode re-run is blocked
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      Object.values(peerConnections.current).forEach((pc) => pc.close());
      socket.disconnect();
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
  const runCode = useRef(async () => {
    try {
      const res = await axios.post("/run", {
        code: codeRef.current,
        language: languageRef.current,
      });
      setOutput(res.data.output);
    } catch (err) {
      console.log(err);
    }
  }).current;

  /* ── SEND MESSAGE ── */
  const sendMessage = useRef((text) => {
    socketRef.current?.emit("send-message", {
      roomId,
      sender: user.name,
      role: user.role,
      message: text,
    });
  }).current;

  /* ── LANGUAGE CHANGE ── */
  const handleLanguageChange = useRef((e) => {
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
  }).current;

  /* ── EDITOR CALLBACKS — created once, never change ── */
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

  const getName = useRef((socketId) =>
    participants.find((p) => p.socketId === socketId)?.name || "Participant"
  );
  // Update the ref's fn each render so it always sees latest participants
  getName.current = (socketId) =>
    participants.find((p) => p.socketId === socketId)?.name || "Participant";

  return (
    <div style={{
      background: "#0f172a", minHeight: "100vh",
      padding: "20px", color: "white", fontFamily: "sans-serif",
    }}>
      <h1 style={{ marginBottom: "25px", fontSize: "36px" }}>
        SkillSync Interview Room
      </h1>

      {/* CAMERAS */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
        gap: "20px", marginBottom: "25px",
      }}>
        <VideoTile stream={localStream} name={user.name} role={user.role} muted />

        {remoteStreams[0]
          ? <VideoTile
              stream={remoteStreams[0].stream}
              name={getName.current(remoteStreams[0].socketId)}
            />
          : <WaitingTile />
        }

        {remoteStreams[1]
          ? <VideoTile
              stream={remoteStreams[1].stream}
              name={getName.current(remoteStreams[1].socketId)}
            />
          : <WaitingTile />
        }
      </div>

      {/* DASHBOARD */}
      <div style={{
        display: "grid", gridTemplateColumns: "300px 1fr 300px",
        gap: "20px", marginBottom: "25px",
      }}>
        <ChatPanel messages={messages} onSend={sendMessage} />

        <div style={{
          background: "#111827", borderRadius: "16px",
          padding: "20px", overflow: "hidden",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "15px" }}>
            <select value={language} onChange={handleLanguageChange}
              style={{ padding: "12px", borderRadius: "10px" }}>
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
              <option value="cpp">C++</option>
              <option value="java">Java</option>
            </select>
            <button onClick={runCode} style={{
              padding: "12px 25px", background: "#16a34a", border: "none",
              color: "white", borderRadius: "10px", cursor: "pointer",
            }}>
              Run Code
            </button>
          </div>

          <CodeEditor
            language={language}
            defaultValue={codeRef.current}
            onMount={handleEditorMount}
            onChange={handleEditorChange}
          />
        </div>

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
            width: "100%", height: "250px", padding: "20px",
            fontSize: "18px", borderRadius: "12px", boxSizing: "border-box",
          }}
        />
      </div>
    </div>
  );
}

export default InterviewRoom;