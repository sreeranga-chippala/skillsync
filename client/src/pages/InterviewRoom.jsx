import axios from "axios";

import {
  useEffect,
  useRef,
  useState
} from "react";

import { useParams } from "react-router-dom";

import Editor from "@monaco-editor/react";

import { io } from "socket.io-client";

function InterviewRoom() {

  const { roomId } = useParams();

  const socketRef = useRef(null);

  const localVideoRef = useRef(null);

  const remoteVideo1Ref = useRef(null);

  const remoteVideo2Ref = useRef(null);

  const localStreamRef = useRef(null);

  const peerConnections = useRef({});

  const messagesEndRef = useRef(null);

  const [participants, setParticipants] =
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

  const [remoteStreams, setRemoteStreams] =
    useState([]);

  const user = {

    name:
      localStorage.getItem("name") ||
      "Anonymous",

    role:
      localStorage.getItem("role") ||
      "candidate"

  };

  const defaultCodes = {

    javascript:
`console.log("Hello World");`,

    python:
`print("Hello World")`,

    cpp:
`#include <iostream>
using namespace std;

int main() {

  cout << "Hello World";

  return 0;

}`,

    java:
`class Main {

  public static void main(String[] args) {

    System.out.println("Hello World");

  }

}`

  };

  /* CAMERA */

  useEffect(() => {

    const init = async () => {

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

        if (localVideoRef.current) {

          localVideoRef.current.srcObject =
            stream;

        }

      }

      catch (err) {

        console.log(err);

      }

    };

    init();

  }, []);

  /* SOCKET */

  useEffect(() => {

    socketRef.current =
      io(window.location.origin, {

        transports: ["websocket"]

      });

    const socket =
      socketRef.current;

    socket.on("connect", () => {

      socket.emit("join-room", {

        roomId,

        user

      });

    });

    /* ROOM STATE */

    socket.on(

      "room-state",

      (data) => {

        setCode(
          data.code ||
          defaultCodes.javascript
        );

        setLanguage(
          data.language ||
          "javascript"
        );

        setOutput(
          data.output || ""
        );

        setLogic(
          data.logic || ""
        );

        setMessages(
          data.messages || []
        );

        setParticipants(
          data.participants || []
        );

      }

    );

    /* PARTICIPANTS */

    socket.on(

      "participants-update",

      async (users) => {

        setParticipants(users);

        for (const participant of users) {

          if (
            participant.socketId !==
            socket.id
          ) {

            await createPeerConnection(

              participant.socketId,

              true

            );

          }

        }

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

        socket.emit("answer", {

          targetSocketId:
            senderSocketId,

          answer

        });

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

        if (!pc) return;

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

        if (!pc) return;

        await pc.addIceCandidate(

          new RTCIceCandidate(
            candidate
          )

        );

      }

    );

    /* DISCONNECT */

    socket.on(

      "user-disconnected",

      (socketId) => {

        if (
          peerConnections.current[
            socketId
          ]
        ) {

          peerConnections.current[
            socketId
          ].close();

          delete peerConnections.current[
            socketId
          ];

        }

        setRemoteStreams((prev) =>
          prev.filter(
            (p) =>
              p.socketId !== socketId
          )
        );

      }

    );

    /* CHAT */

    socket.on(

      "receive-message",

      (msg) => {

        setMessages((prev) => [

          ...prev,

          msg

        ]);

      }

    );

    /* EDITOR */

    socket.on(

      "sync-editor",

      (data) => {

        setCode(data.code);

        setLanguage(data.language);

      }

    );

    socket.on(

      "sync-output",

      (data) => {

        setOutput(data);

      }

    );

    socket.on(

      "sync-logic",

      (data) => {

        setLogic(data);

      }

    );

    return () => {

      localStreamRef.current
        ?.getTracks()
        .forEach(
          (track) => track.stop()
        );

      Object.values(
        peerConnections.current
      ).forEach(
        (pc) => pc.close()
      );

      socket.disconnect();

    };

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

      pc.ontrack = (event) => {

        setRemoteStreams((prev) => {

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

        });

      };

      pc.onicecandidate =
        (event) => {

          if (event.candidate) {

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

  /* REMOTE VIDEOS */

  useEffect(() => {

    if (
      remoteStreams[0] &&
      remoteVideo1Ref.current
    ) {

      remoteVideo1Ref.current.srcObject =
        remoteStreams[0].stream;

    }

    if (
      remoteStreams[1] &&
      remoteVideo2Ref.current
    ) {

      remoteVideo2Ref.current.srcObject =
        remoteStreams[1].stream;

    }

  }, [remoteStreams]);

  /* SYNC */

  useEffect(() => {

    socketRef.current?.emit(
      "editor-change",
      {
        roomId,
        code,
        language
      }
    );

  }, [code, language]);

  useEffect(() => {

    socketRef.current?.emit(
      "logic-change",
      {
        roomId,
        logic
      }
    );

  }, [logic]);

  useEffect(() => {

    socketRef.current?.emit(
      "output-change",
      {
        roomId,
        output
      }
    );

  }, [output]);

  /* RUN CODE */

  const runCode = async () => {

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

  const sendMessage = () => {

    if (!message.trim()) return;

    socketRef.current.emit(
      "send-message",
      {
        roomId,
        sender: user.name,
        role: user.role,
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
        color: "white"
      }}
    >

      <h1>
        SkillSync Interview Room
      </h1>

      {/* CAMERAS */}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(3,1fr)",
          gap: "15px",
          marginBottom: "20px"
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
            background: "black",
            borderRadius: "10px"
          }}
        />

        <video
          ref={remoteVideo1Ref}
          autoPlay
          playsInline
          style={{
            width: "100%",
            height: "220px",
            background: "black",
            borderRadius: "10px"
          }}
        />

        <video
          ref={remoteVideo2Ref}
          autoPlay
          playsInline
          style={{
            width: "100%",
            height: "220px",
            background: "black",
            borderRadius: "10px"
          }}
        />

      </div>

      {/* MAIN */}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "1fr 2fr 1fr",
          gap: "15px"
        }}
      >

        {/* CHAT */}

        <div
          style={{
            background: "#1e293b",
            padding: "15px",
            borderRadius: "10px",
            height: "700px"
          }}
        >

          <h2>Chat</h2>

          <div
            style={{
              height: "550px",
              overflowY: "auto"
            }}
          >

            {messages.map(
              (msg, index) => (

                <div
                  key={index}
                  style={{
                    marginBottom: "10px"
                  }}
                >

                  <strong>
                    {msg.sender}
                  </strong>

                  <p>
                    {msg.message}
                  </p>

                </div>

              )
            )}

            <div ref={messagesEndRef} />

          </div>

          <input
            value={message}
            onChange={(e) =>
              setMessage(
                e.target.value
              )
            }
            placeholder="Message..."
            style={{
              width: "100%",
              padding: "12px"
            }}
          />

          <button
            onClick={sendMessage}
            style={{
              marginTop: "10px",
              width: "100%",
              padding: "12px"
            }}
          >
            Send
          </button>

        </div>

        {/* EDITOR */}

        <div
          style={{
            background: "#1e293b",
            padding: "15px",
            borderRadius: "10px"
          }}
        >

          <div
            style={{
              display: "flex",
              justifyContent:
                "space-between",
              marginBottom: "10px"
            }}
          >

            <h2>Code Editor</h2>

            <select
              value={language}
              onChange={(e) => {

                setLanguage(
                  e.target.value
                );

                setCode(
                  defaultCodes[
                    e.target.value
                  ]
                );

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
            height="500px"
            language={language}
            value={code}
            onChange={(value) =>
              setCode(value)
            }
            theme="vs-dark"
          />

          <textarea
            value={logic}
            onChange={(e) =>
              setLogic(
                e.target.value
              )
            }
            placeholder="Write logic..."
            style={{
              width: "100%",
              height: "120px",
              marginTop: "15px"
            }}
          />

          <button
            onClick={runCode}
            style={{
              width: "100%",
              padding: "12px",
              marginTop: "15px"
            }}
          >
            Run Code
          </button>

        </div>

        {/* OUTPUT */}

        <div
          style={{
            background: "#1e293b",
            padding: "15px",
            borderRadius: "10px"
          }}
        >

          <h2>Output</h2>

          <pre
            style={{
              whiteSpace: "pre-wrap"
            }}
          >
            {output}
          </pre>

        </div>

      </div>

    </div>

  );

}

export default InterviewRoom;