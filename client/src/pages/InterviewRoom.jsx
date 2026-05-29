import axios from "axios";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import { io } from "socket.io-client";

function InterviewRoom() {
  const { roomId } = useParams();

  const socketRef = useRef(null);
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const peerConnections = useRef({});
  const messagesEndRef = useRef(null);
  const initialLoadDone = useRef(false);

  // FIX 1: Use a ref instead of state for camera readiness
  // State causes re-renders which re-run the socket useEffect → reconnects → blinks
  const cameraReadyRef = useRef(false);
  const socketInitialized = useRef(false);

  // FIX 2: Track editor focus via Monaco events, not fragile className checks
  const isEditingRef = useRef(false);

  const [participants, setParticipants] = useState([]);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [language, setLanguage] = useState("javascript");
  const [code, setCode] = useState(`console.log("Hello SkillSync");`);
  const [output, setOutput] = useState("");
  const [logic, setLogic] = useState("");

  const defaultCodes = {
    javascript: `console.log("Hello SkillSync");`,
    python: `print("Hello SkillSync")`,
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
}`,
  };

  const user = {
    name: localStorage.getItem("name") || "Anonymous",
    role: localStorage.getItem("role") || "candidate",
  };

  // FIX 1: Camera init — no state update, just a ref flag
  // This means no re-render fires, so the socket useEffect stays stable
  useEffect(() => {
    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        cameraReadyRef.current = true;

        // Now that camera is ready, add tracks to any already-created peer connections
        Object.values(peerConnections.current).forEach((pc) => {
          stream.getTracks().forEach((track) => {
            const senders = pc.getSenders();
            const alreadyAdded = senders.some((s) => s.track === track);
            if (!alreadyAdded) {
              pc.addTrack(track, stream);
            }
          });
        });
      } catch (err) {
        console.log("Camera Error:", err);
      }
    };
    initCamera();
  }, []); // runs exactly once, no state → no re-render → no blink

  /* AUTO SCROLL */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* PEER */
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

    // Add local tracks if stream is ready
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    /* REMOTE */
    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      setRemoteStreams((prev) => {
        const exists = prev.find((p) => p.socketId === targetSocketId);
        if (exists) {
          return prev.map((p) =>
            p.socketId === targetSocketId ? { ...p, stream: remoteStream } : p
          );
        }
        return [...prev, { socketId: targetSocketId, stream: remoteStream }];
      });
    };

    /* ICE */
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit("ice-candidate", {
          targetSocketId,
          candidate: event.candidate,
        });
      }
    };

    /* OFFER */
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

  /* SOCKET — runs once, no dependencies that change */
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

    // Emit join immediately — camera readiness doesn't block socket setup
    socket.emit("join-room", { roomId, user });

    /* LOAD CHAT */
    const fetchMessages = async () => {
      try {
        const response = await axios.get(`/messages/${roomId}`);
        setMessages(response.data);
      } catch (err) {
        console.log(err);
      }
    };
    fetchMessages();

    /* ROOM STATE */
    socket.on("room-state", (data) => {
      initialLoadDone.current = true;
      setCode(data.code || defaultCodes.javascript);
      setLanguage(data.language || "javascript");
      setLogic(data.logic || "");
      setOutput(data.output || "");
    });

    /* EXISTING USERS */
    socket.on("existing-users", async (users) => {
      const filtered = users.filter((u) => u.socketId !== socket.id);
      setParticipants(
        Array.from(
          new Map(filtered.map((p) => [p.socketId, p])).values()
        )
      );
      for (const participant of filtered) {
        await createPeerConnection(participant.socketId, true);
      }
    });

    /* NEW USER */
    socket.on("user-joined", async (participant) => {
      if (participant.socketId === socket.id) return;
      setParticipants((prev) => {
        const exists = prev.find((p) => p.socketId === participant.socketId);
        if (exists) return prev;
        return [...prev, participant];
      });
      await createPeerConnection(participant.socketId, true);
    });

    /* OFFER */
    socket.on("offer", async ({ offer, senderSocketId }) => {
      const pc = await createPeerConnection(senderSocketId, false);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("answer", { targetSocketId: senderSocketId, answer });
    });

    /* ANSWER */
    socket.on("answer", async ({ answer, senderSocketId }) => {
      const pc = peerConnections.current[senderSocketId];
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    });

    /* ICE */
    socket.on("ice-candidate", async ({ candidate, senderSocketId }) => {
      const pc = peerConnections.current[senderSocketId];
      if (!pc) return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.log(err);
      }
    });

    /* USER LEFT */
    socket.on("user-left", (socketId) => {
      if (peerConnections.current[socketId]) {
        peerConnections.current[socketId].close();
        delete peerConnections.current[socketId];
      }
      setRemoteStreams((prev) => prev.filter((p) => p.socketId !== socketId));
      setParticipants((prev) => prev.filter((p) => p.socketId !== socketId));
    });

    /* CHAT */
    socket.on("receive-message", (msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    // FIX 2: Guard sync-editor with isEditingRef so typing is never interrupted
    socket.on("sync-editor", (data) => {
      if (isEditingRef.current) return;
      setCode(data.code);
      setLanguage(data.language);
    });

    /* LOGIC — equality guard prevents unnecessary re-renders */
    socket.on("sync-logic", (data) => {
      setLogic((prev) => (prev === data ? prev : data));
    });

    /* OUTPUT — equality guard */
    socket.on("sync-output", (data) => {
      setOutput((prev) => (prev === data ? prev : data));
    });

    return () => {
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      Object.values(peerConnections.current).forEach((pc) => pc.close());
      setRemoteStreams([]);
      setParticipants([]);
      socket.disconnect();
      socketInitialized.current = false;
    };
  }, []); // empty deps — runs once, never reconnects

  /* EDITOR SYNC */
  useEffect(() => {
    if (!initialLoadDone.current) return;
    const timer = setTimeout(() => {
      socketRef.current?.emit("editor-change", { roomId, code, language });
    }, 300);
    return () => clearTimeout(timer);
  }, [code, language]);

  /* LOGIC SYNC */
  useEffect(() => {
    if (!initialLoadDone.current) return;
    socketRef.current?.emit("logic-change", { roomId, logic });
  }, [logic]);

  /* OUTPUT SYNC */
  useEffect(() => {
    if (!initialLoadDone.current) return;
    socketRef.current?.emit("output-change", { roomId, output });
  }, [output]);

  /* RUN */
  const runCode = async () => {
    try {
      const response = await axios.post("/run", { code, language });
      setOutput(response.data.output);
    } catch (err) {
      console.log(err);
    }
  };

  /* SEND MESSAGE */
  const sendMessage = () => {
    if (!message.trim()) return;
    socketRef.current.emit("send-message", {
      roomId,
      sender: user.name,
      role: user.role,
      message,
    });
    setMessage("");
  };

  // FIX 3: Callback ref for remote videos — no useEffect needed, no flicker
  // Each video element sets its own srcObject as soon as it mounts
  const setRemoteVideoRef = (socketId) => (el) => {
    if (!el) return;
    const found = remoteStreams.find((s) => s.socketId === socketId);
    if (found && el.srcObject !== found.stream) {
      el.srcObject = found.stream;
    }
  };

  return (
    <div
      style={{
        background: "#0f172a",
        minHeight: "100vh",
        padding: "20px",
        color: "white",
        fontFamily: "sans-serif",
      }}
    >
      <h1 style={{ marginBottom: "25px", fontSize: "36px" }}>
        SkillSync Interview Room
      </h1>

      {/* CAMERA SECTION */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "20px",
          marginBottom: "25px",
        }}
      >
        {/* LOCAL USER */}
        <div
          style={{
            background: "#1e293b",
            borderRadius: "16px",
            padding: "15px",
            minHeight: "320px",
          }}
        >
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            style={{
              width: "100%",
              height: "240px",
              objectFit: "cover",
              borderRadius: "12px",
              background: "black",
            }}
          />
          <h3 style={{ marginTop: "10px" }}>{user.name}</h3>
          <p>{user.role}</p>
        </div>

        {/* REMOTE 1 — FIX 3: callback ref, no useEffect */}
        {remoteStreams[0] ? (
          <div
            style={{
              background: "#1e293b",
              borderRadius: "16px",
              padding: "15px",
              minHeight: "320px",
            }}
          >
            <video
              autoPlay
              playsInline
              ref={setRemoteVideoRef(remoteStreams[0].socketId)}
              style={{
                width: "100%",
                height: "240px",
                objectFit: "cover",
                borderRadius: "12px",
                background: "black",
              }}
            />
            <h3 style={{ marginTop: "10px" }}>
              {participants.find((p) => p.socketId === remoteStreams[0].socketId)
                ?.name || "Participant"}
            </h3>
          </div>
        ) : (
          <div
            style={{
              background: "#1e293b",
              borderRadius: "16px",
              minHeight: "320px",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              fontSize: "22px",
            }}
          >
            Waiting...
          </div>
        )}

        {/* REMOTE 2 — FIX 3: callback ref, no useEffect */}
        {remoteStreams[1] ? (
          <div
            style={{
              background: "#1e293b",
              borderRadius: "16px",
              padding: "15px",
              minHeight: "320px",
            }}
          >
            <video
              autoPlay
              playsInline
              ref={setRemoteVideoRef(remoteStreams[1].socketId)}
              style={{
                width: "100%",
                height: "240px",
                objectFit: "cover",
                borderRadius: "12px",
                background: "black",
              }}
            />
            <h3 style={{ marginTop: "10px" }}>
              {participants.find((p) => p.socketId === remoteStreams[1].socketId)
                ?.name || "Participant"}
            </h3>
          </div>
        ) : (
          <div
            style={{
              background: "#1e293b",
              borderRadius: "16px",
              minHeight: "320px",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              fontSize: "22px",
            }}
          >
            Waiting...
          </div>
        )}
      </div>

      {/* MAIN DASHBOARD */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "300px 1fr 300px",
          gap: "20px",
          marginBottom: "25px",
        }}
      >
        {/* CHAT */}
        <div
          style={{
            background: "#111827",
            borderRadius: "16px",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            height: "650px",
          }}
        >
          <h2>Chat</h2>
          <div style={{ flex: 1, overflowY: "auto", marginBottom: "15px" }}>
            {messages.map((msg, index) => (
              <div
                key={index}
                style={{
                  background: "#1e293b",
                  padding: "12px",
                  borderRadius: "10px",
                  marginBottom: "10px",
                }}
              >
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
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              style={{
                flex: 1,
                padding: "12px",
                borderRadius: "10px",
                border: "none",
              }}
            />
            <button
              onClick={sendMessage}
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

        {/* EDITOR */}
        <div
          style={{
            background: "#111827",
            borderRadius: "16px",
            padding: "20px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "15px",
            }}
          >
            <select
              value={language}
              onChange={(e) => {
                const newLanguage = e.target.value;
                setLanguage(newLanguage);
                setCode(defaultCodes[newLanguage]);
              }}
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

          {/* FIX 2: Use Monaco's own focus/blur events to track editing state */}
          <Editor
            height="550px"
            theme="vs-dark"
            language={language}
            value={code}
            onMount={(editor) => {
              editor.onDidFocusEditorWidget(() => {
                isEditingRef.current = true;
              });
              editor.onDidBlurEditorWidget(() => {
                isEditingRef.current = false;
              });
            }}
            onChange={(value) => setCode(value || "")}
          />
        </div>

        {/* OUTPUT */}
        <div
          style={{
            background: "#111827",
            borderRadius: "16px",
            padding: "20px",
          }}
        >
          <h2>Output</h2>
          <pre style={{ color: "#22c55e", whiteSpace: "pre-wrap" }}>
            {output || "Run code to see output"}
          </pre>
        </div>
      </div>

      {/* LOGIC */}
      <div
        style={{
          background: "white",
          padding: "25px",
          borderRadius: "16px",
        }}
      >
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