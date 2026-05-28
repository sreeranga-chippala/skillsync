import axios from "axios";

import {
  useEffect,
  useRef,
  useState
} from "react";

import {
  useParams
} from "react-router-dom";

import Editor from "@monaco-editor/react";

import {
  io
} from "socket.io-client";

function InterviewRoom() {

  const { roomId } =
    useParams();

  const messagesEndRef =
    useRef(null);

  const socketRef =
    useRef(null);

  const localVideoRef =
    useRef(null);

  const localStreamRef =
    useRef(null);

  const peerConnections =
    useRef({});

  const initialLoadDone =
    useRef(false);

  const [participants, setParticipants] =
    useState([]);

  const [remoteStreams, setRemoteStreams] =
    useState([]);

  const [messages, setMessages] =
    useState([]);

  const [message, setMessage] =
    useState("");

  const [language, setLanguage] =
    useState("javascript");

  const [code, setCode] =
    useState("");

  const [output, setOutput] =
    useState("");

  const [logic, setLogic] =
    useState("");

  const defaultCodes = {

    javascript:
`console.log("Hello SkillSync");`,

    python:
`print("Hello SkillSync")`,

    cpp:
`#include <iostream>

using namespace std;

int main() {

  cout << "Hello SkillSync";

  return 0;

}`,

    java:
`class Main {

  public static void main(String[] args) {

    System.out.println("Hello SkillSync");

  }

}`

  };

  const user = {

    name:
      localStorage.getItem("name") ||
      "Anonymous",

    role:
      localStorage.getItem("role") ||
      "candidate"

  };

  /* CAMERA */

  useEffect(() => {

    const initCamera =
      async () => {

        try {

          const stream =
            await navigator
              .mediaDevices
              .getUserMedia({

                video: true,
                audio: true

              });

          localStreamRef.current =
            stream;

          if (
            localVideoRef.current
          ) {

            localVideoRef.current.srcObject =
              stream;

          }

        }

        catch (err) {

          console.log(err);

        }

      };

    initCamera();

  }, []);

  /* AUTO SCROLL */

  useEffect(() => {

    messagesEndRef.current
      ?.scrollIntoView({

        behavior: "smooth"

      });

  }, [messages]);

  /* PEER */

  const createPeerConnection =
    async (
      targetSocketId,
      createOffer = false
    ) => {

      if (
        peerConnections.current[
          targetSocketId
        ]
      ) return;

      const pc =
        new RTCPeerConnection({

          iceServers: [

            {
              urls:
                "stun:stun.l.google.com:19302"
            },

            {

              urls: [

                "turn:openrelay.metered.ca:80",

                "turn:openrelay.metered.ca:443",

                "turn:openrelay.metered.ca:443?transport=tcp"

              ],

              username:
                "openrelayproject",

              credential:
                "openrelayproject"

            }

          ]

        });

      peerConnections.current[
        targetSocketId
      ] = pc;

      localStreamRef.current
        ?.getTracks()
        .forEach((track) => {

          pc.addTrack(
            track,
            localStreamRef.current
          );

        });

      /* REMOTE STREAM */

      pc.ontrack =
        (event) => {

          setRemoteStreams(
            (prev) => {

              const filtered =
                prev.filter(

                  (p) =>

                    p.socketId !==
                    targetSocketId

                );

              return [

                ...filtered,

                {

                  socketId:
                    targetSocketId,

                  stream:
                    event.streams[0]

                }

              ];

            }
          );

        };

      /* ICE */

      pc.onicecandidate =
        (event) => {

          if (
            event.candidate
          ) {

            socketRef.current.emit(

              "ice-candidate",

              {

                targetSocketId,

                candidate:
                  event.candidate

              }

            );

          }

        };

      /* OFFER */

      if (createOffer) {

        const offer =
          await pc.createOffer();

        await pc.setLocalDescription(
          offer
        );

        socketRef.current.emit(

          "offer",

          {

            targetSocketId,

            offer

          }

        );

      }

    };

  /* SOCKET */

  useEffect(() => {

    socketRef.current =
      io(

        window.location.origin,

        {

          transports:
            ["websocket"],

          reconnection:
            true,

          reconnectionAttempts:
            10,

          reconnectionDelay:
            1000

        }

      );

    const socket =
      socketRef.current;

    /* LOAD CHAT */

    const fetchMessages =
      async () => {

        try {

          const response =
            await axios.get(

              `/messages/${roomId}`

            );

          setMessages(
            response.data
          );

        }

        catch (err) {

          console.log(err);

        }

      };

    fetchMessages();

    /* JOIN */

    socket.emit(

      "join-room",

      {

        roomId,

        user

      }

    );

    /* ROOM STATE */

    socket.on(

      "room-state",

      (data) => {

        initialLoadDone.current =
          true;

        setCode(

          data.code ||

          defaultCodes.javascript

        );

        setLanguage(

          data.language ||

          "javascript"

        );

        setLogic(

          data.logic || ""

        );

        setOutput(

          data.output || ""

        );

      }

    );

    /* USERS */

    socket.on(

      "existing-users",

      async (users) => {

        const filtered =
          users.filter(
            (u) =>
              u.socketId !==
              socket.id
          );

        setParticipants(
          filtered
        );

        for (
          const participant
          of filtered
        ) {

          await createPeerConnection(
            participant.socketId,
            true
          );

        }

      }

    );

    socket.on(

      "participants-update",

      (users) => {

        const filtered =
          users.filter(
            (u) =>
              u.socketId !==
              socket.id
          );

        setParticipants(
          filtered
        );

      }

    );

    /* OFFER */

    socket.on(

      "offer",

      async ({
        offer,
        senderSocketId
      }) => {

        await createPeerConnection(
          senderSocketId,
          false
        );

        const pc =
          peerConnections.current[
            senderSocketId
          ];

        await pc.setRemoteDescription(

          new RTCSessionDescription(
            offer
          )

        );

        const answer =
          await pc.createAnswer();

        await pc.setLocalDescription(
          answer
        );

        socket.emit(

          "answer",

          {

            targetSocketId:
              senderSocketId,

            answer

          }

        );

      }

    );

    /* ANSWER */

    socket.on(

      "answer",

      async ({
        answer,
        senderSocketId
      }) => {

        const pc =
          peerConnections.current[
            senderSocketId
          ];

        if (!pc)
          return;

        await pc.setRemoteDescription(

          new RTCSessionDescription(
            answer
          )

        );

      }

    );

    /* ICE */

    socket.on(

      "ice-candidate",

      async ({
        candidate,
        senderSocketId
      }) => {

        const pc =
          peerConnections.current[
            senderSocketId
          ];

        if (!pc)
          return;

        await pc.addIceCandidate(

          new RTCIceCandidate(
            candidate)

        );

      }

    );

    /* CHAT */

    socket.on(

      "receive-message",

      (msg) => {

        setMessages(

          (prev) => [

            ...prev,

            msg

          ]

        );

      }

    );

    /* EDITOR */

    socket.on(

      "sync-editor",

      (data) => {

        setCode(
          data.code
        );

        setLanguage(
          data.language
        );

      }

    );

    /* LOGIC */

    socket.on(

      "sync-logic",

      (data) => {

        setLogic(data);

      }

    );

    /* OUTPUT */

    socket.on(

      "sync-output",

      (data) => {

        setOutput(data);

      }

    );

    return () => {

      localStreamRef.current
        ?.getTracks()
        .forEach(

          (track) =>
            track.stop()

        );

      Object.values(

        peerConnections.current

      ).forEach(

        (pc) =>
          pc.close()

      );

      socket.disconnect();

    };

  }, []);

  /* EDITOR SYNC */

  useEffect(() => {

    if (
      !initialLoadDone.current
    ) return;

    socketRef.current?.emit(

      "editor-change",

      {

        roomId,

        code,

        language

      }

    );

  }, [

    code,
    language

  ]);

  /* LOGIC SYNC */

  useEffect(() => {

    if (
      !initialLoadDone.current
    ) return;

    socketRef.current?.emit(

      "logic-change",

      {

        roomId,

        logic

      }

    );

  }, [

    logic

  ]);

  /* OUTPUT SYNC */

  useEffect(() => {

    if (
      !initialLoadDone.current
    ) return;

    socketRef.current?.emit(

      "output-change",

      {

        roomId,

        output

      }

    );

  }, [

    output

  ]);

  /* RUN */

  const runCode =
    async () => {

      try {

        const response =
          await axios.post(

            "/run",

            {

              code,

              language

            }

          );

        setOutput(
          response.data.output
        );

      }

      catch (err) {

        console.log(err);

      }

    };

  /* SEND MESSAGE */

  const sendMessage =
    () => {

      if (!message.trim())
        return;

      socketRef.current.emit(

        "send-message",

        {

          roomId,

          sender:
            user.name,

          role:
            user.role,

          message

        }

      );

      setMessage("");

    };

  return (
  <div
    style={{
      background: "#0f172a",
      minHeight: "100vh",
      padding: "20px",
      color: "white",
      fontFamily: "sans-serif"
    }}
  >
    <h1
      style={{
        fontSize: "38px",
        marginBottom: "20px"
      }}
    >
      SkillSync Interview Room
    </h1>

    {/* TOP SECTION */}

    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          window.innerWidth < 1200
            ? "1fr"
            : "2fr 1fr",
        gap: "20px"
      }}
    >

      {/* LEFT SIDE */}

      <div>

        {/* VIDEO SECTION */}

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit,minmax(280px,1fr))",
            gap: "15px",
            marginBottom: "20px"
          }}
        >

          {/* LOCAL VIDEO */}

          <div
            style={{
              background: "#1e293b",
              padding: "12px",
              borderRadius: "15px",
              border: "2px solid #334155"
            }}
          >
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              style={{
                width: "100%",
                height: "220px",
                objectFit: "cover",
                borderRadius: "10px",
                background: "black"
              }}
            />

            <h3 style={{ marginTop: "10px" }}>
              {user.name} (You)
            </h3>

            <p>{user.role}</p>
          </div>

          {/* REMOTE USERS */}

          {remoteStreams.map((remoteUser, index) => (
            <div
              key={remoteUser.socketId}
              style={{
                background: "#1e293b",
                padding: "12px",
                borderRadius: "15px",
                border: "2px solid #334155"
              }}
            >
              <video
                autoPlay
                playsInline
                ref={(video) => {
                  if (video && remoteUser.stream) {
                    video.srcObject =
                      remoteUser.stream;
                  }
                }}
                style={{
                  width: "100%",
                  height: "220px",
                  objectFit: "cover",
                  borderRadius: "10px",
                  background: "black"
                }}
              />

              <h3 style={{ marginTop: "10px" }}>
                {participants.find(
                  (p) =>
                    p.socketId ===
                    remoteUser.socketId
                )?.name || `User ${index + 1}`}
              </h3>

              <p>
                {
                  participants.find(
                    (p) =>
                      p.socketId ===
                      remoteUser.socketId
                  )?.role
                }
              </p>
            </div>
          ))}

        </div>

        {/* CODE EDITOR */}

        <div
          style={{
            background: "#1e293b",
            padding: "15px",
            borderRadius: "15px",
            marginBottom: "20px"
          }}
        >

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "10px"
            }}
          >

            <h2>Code Editor</h2>

            <select
              value={language}
              onChange={(e) => {
                setLanguage(e.target.value);
                setCode(
                  defaultCodes[e.target.value]
                );
              }}
              style={{
                padding: "10px",
                borderRadius: "8px"
              }}
            >
              <option value="javascript">
                JavaScript
              </option>

              <option value="python">
                Python
              </option>

              <option value="cpp">
                C++
              </option>

              <option value="java">
                Java
              </option>
            </select>

          </div>

          <Editor
            height="450px"
            language={language}
            value={code}
            onChange={(value) =>
              setCode(value)
            }
            theme="vs-dark"
          />

          <button
            onClick={runCode}
            style={{
              marginTop: "15px",
              padding: "12px 20px",
              background: "#2563eb",
              border: "none",
              color: "white",
              borderRadius: "10px",
              cursor: "pointer"
            }}
          >
            Run Code
          </button>

        </div>

        {/* TEXT EDITOR */}

        <div
          style={{
            background: "#1e293b",
            padding: "15px",
            borderRadius: "15px",
            marginBottom: "20px"
          }}
        >

          <h2>Logic / Notes</h2>

          <textarea
            value={logic}
            onChange={(e) =>
              setLogic(e.target.value)
            }
            placeholder="Write approach, notes, algorithms..."
            style={{
              width: "100%",
              height: "180px",
              background: "#0f172a",
              color: "white",
              border: "1px solid #334155",
              borderRadius: "10px",
              padding: "15px",
              marginTop: "10px"
            }}
          />

        </div>

        {/* OUTPUT */}

        <div
          style={{
            background: "#1e293b",
            padding: "15px",
            borderRadius: "15px"
          }}
        >

          <h2>Output Console</h2>

          <pre
            style={{
              background: "black",
              color: "#22c55e",
              padding: "15px",
              borderRadius: "10px",
              minHeight: "120px",
              overflowX: "auto"
            }}
          >
            {output}
          </pre>

        </div>

      </div>

      {/* RIGHT SIDE */}

      <div
        style={{
          background: "#1e293b",
          borderRadius: "15px",
          padding: "15px",
          height: "fit-content"
        }}
      >

        <h2>Live Chat</h2>

        {/* CHAT MESSAGES */}

        <div
          style={{
            height: "500px",
            overflowY: "auto",
            background: "#0f172a",
            padding: "10px",
            borderRadius: "10px",
            marginBottom: "15px"
          }}
        >

          {messages.map((msg, index) => (

            <div
              key={index}
              style={{
                marginBottom: "12px"
              }}
            >

              <strong>
                {msg.sender}
              </strong>

              <p
                style={{
                  marginTop: "4px"
                }}
              >
                {msg.message}
              </p>

            </div>

          ))}

          <div ref={messagesEndRef} />

        </div>

        {/* SEND MESSAGE */}

        <div
          style={{
            display: "flex",
            gap: "10px"
          }}
        >

          <input
            value={message}
            onChange={(e) =>
              setMessage(e.target.value)
            }
            placeholder="Type message..."
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: "10px",
              border: "none"
            }}
          />

          <button
            onClick={sendMessage}
            style={{
              padding: "12px 18px",
              borderRadius: "10px",
              border: "none",
              background: "#2563eb",
              color: "white",
              cursor: "pointer"
            }}
          >
            Send
          </button>

        </div>

      </div>

    </div>

  </div>
);

}

export default InterviewRoom;