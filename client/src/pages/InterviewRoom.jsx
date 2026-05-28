import axios from "axios";

import { BACKEND_URL }
from "../config";

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

  const socketRef =
    useRef(null);

  const localVideoRef =
    useRef(null);

  const localStreamRef =
    useRef(null);

  const peerConnections =
    useRef({});

  const [participants, setParticipants] =
    useState([]);

  const [remoteStreams, setRemoteStreams] =
    useState([]);

  const [messages, setMessages] =
    useState([]);

  const [message, setMessage] =
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

  const [language, setLanguage] =
    useState("");

  const [code, setCode] =
    useState("");

  const [output, setOutput] =
    useState("");

  const [logic, setLogic] =
    useState("");

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

    const init =
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

    init();

  }, []);

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

      pc.ontrack =
        (event) => {

          setRemoteStreams(
            (prev) => {

              const exists =
                prev.find(
                  (p) =>
                    p.socketId ===
                    targetSocketId
                );

              if (exists)
                return prev;

              return [

                ...prev,

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
      io(BACKEND_URL);

    const socket =
      socketRef.current;

    /* LOAD CHAT */

    axios
      .get(
        `${BACKEND_URL}/messages/${roomId}`
      )

      .then((res) => {

        setMessages(
          res.data
        );

      })

      .catch(console.log);

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
              u.name !== user.name
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
              u.name !== user.name
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
            candidate
          )
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

    /* OUTPUT */

    socket.on(
      "sync-output",
      (data) => {

        setOutput(data);

      }
    );

    /* LOGIC */

    socket.on(
      "sync-logic",
      (data) => {

        setLogic(data);

      }
    );

    return () => {

      socket.disconnect();

    };

  }, []);

  /* RUN */

  const runCode =
    async () => {

      try {

        const response =
          await axios.post(

            "BACKEND_URL/run",

            {

              code,

              language

            }

          );

        setOutput(
          response.data.output
        );

        socketRef.current.emit(
          "output-change",

          {

            roomId,

            output:
              response.data.output

          }

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

          marginBottom: "25px",

          fontSize: "42px"

        }}
      >

        SkillSync Interview Room

      </h1>

      {/* CAMERAS */}

      <div
        style={{

          display: "grid",

          gridTemplateColumns:
            "1fr 1fr 1fr",

          gap: "20px",

          marginBottom: "25px"

        }}
      >

        {/* LOCAL */}

        <div
          style={{

            background: "#1e293b",

            borderRadius: "16px",

            padding: "15px",

            border:
              "2px solid #334155"

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

              background: "black"

            }}

          />

          <h3
            style={{
              marginTop: "12px"
            }}
          >

            {user.name}

          </h3>

          <p>

            {user.role}

          </p>

        </div>

        {

          [0, 1].map(
            (index) => {

              const remoteUser =
                remoteStreams[index];

              return (

                <div

                  key={index}

                  style={{

                    background:
                      "#1e293b",

                    borderRadius:
                      "16px",

                    padding:
                      "15px",

                    border:
                      "2px solid #334155"

                  }}
                >

                  {

                    remoteUser

                    ?

                    <video

                      autoPlay

                      playsInline

                      ref={(video) => {

                        if (video) {

                          video.srcObject =
                            remoteUser.stream;

                        }

                      }}

                      style={{

                        width: "100%",

                        height: "240px",

                        objectFit:
                          "cover",

                        borderRadius:
                          "12px",

                        background:
                          "black"

                      }}

                    />

                    :

                    <div
                      style={{

                        height:
                          "240px",

                        display:
                          "flex",

                        justifyContent:
                          "center",

                        alignItems:
                          "center",

                        background:
                          "#0f172a",

                        borderRadius:
                          "12px",

                        border:
                          "2px dashed #475569"

                      }}
                    >

                      Waiting...

                    </div>

                  }

                  <h3
                    style={{
                      marginTop: "12px"
                    }}
                  >

                    {

                      remoteUser

                      ?

                      participants.find(
                        (p) =>
                          p.socketId ===
                          remoteUser.socketId
                      )?.name

                      :

                      `Interviewer ${index + 1}`

                    }

                  </h3>

                </div>

              );

            }
          )

        }

      </div>

      {/* MAIN */}

      <div
        style={{

          display: "grid",

          gridTemplateColumns:
            "320px 1fr 350px",

          gap: "20px",

          marginBottom: "25px"

        }}
      >

        {/* CHAT */}

        <div
          style={{

            background: "#111827",

            borderRadius: "16px",

            padding: "20px",

            border:
              "2px solid #334155",

            display: "flex",

            flexDirection: "column",

            height: "650px"

          }}
        >

          <h2>

            Chat

          </h2>

          <div
            style={{

              flex: 1,

              overflowY: "auto",

              marginBottom: "15px"

            }}
          >

            {

              messages.map(
                (
                  msg,
                  index
                ) => (

                  <div

                    key={index}

                    style={{

                      background:
                        "#1e293b",

                      padding: "12px",

                      borderRadius:
                        "10px",

                      marginBottom:
                        "10px"

                    }}
                  >

                    <strong>

                      {msg.sender}

                    </strong>

                    <div>

                      {msg.message}

                    </div>

                  </div>

                )
              )

            }

          </div>

          <div
            style={{
              display: "flex"
            }}
          >

            <input

              value={message}

              onChange={(e) =>
                setMessage(
                  e.target.value
                )
              }

              style={{

                flex: 1,

                padding: "12px",

                borderRadius:
                  "10px",

                fontSize: "16px"

              }}

            />

            <button

              onClick={sendMessage}

              style={{

                marginLeft: "10px",

                padding:
                  "12px 18px",

                borderRadius:
                  "10px",

                border: "none",

                background:
                  "#2563eb",

                color: "white"

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

            border:
              "2px solid #334155"

          }}
        >

          <div
            style={{

              display: "flex",

              justifyContent:
                "space-between",

              marginBottom: "15px"

            }}
          >

            <select

  value={language}

  onChange={(e) => {

    const newLanguage =
      e.target.value;

    const starterCode =
      defaultCodes[
        newLanguage
      ];

    /* UPDATE LOCAL */

    setLanguage(
      newLanguage
    );

    setCode(
      starterCode
    );

    /* REALTIME SYNC */

    socketRef.current.emit(

      "editor-change",

      {

        roomId,

        code:
          starterCode,

        language:
          newLanguage

      }

    );

  }}

  style={{

    padding: "12px",

    fontSize: "18px",

    borderRadius: "10px",

    border: "none",

    outline: "none",

    background: "#1e293b",

    color: "white",

    cursor: "pointer"

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

            <button

              onClick={runCode}

              style={{

                padding:
                  "12px 25px",

                fontSize: "18px",

                borderRadius:
                  "10px",

                border: "none",

                background:
                  "#16a34a",

                color: "white"

              }}

            >

              Run Code

            </button>

          </div>

          <Editor

            height="550px"

            theme="vs-dark"

            language={language}

            value={code}

            onChange={(value) => {

              setCode(value);

              socketRef.current.emit(

                "editor-change",

                {

                  roomId,

                  code: value,

                  language

                }

              );

            }}

          />

        </div>

        {/* OUTPUT */}

        <div
          style={{

            background: "#111827",

            borderRadius: "16px",

            padding: "20px",

            border:
              "2px solid #334155"

          }}
        >

          <h2>

            Output

          </h2>

          <pre
            style={{

              color: "#22c55e",

              fontSize: "18px",

              whiteSpace:
                "pre-wrap"

            }}
          >

            {

              output ||

              "Run code to see output"

            }

          </pre>

        </div>

      </div>

      {/* LOGIC */}

      <div
        style={{

          background: "white",

          padding: "25px",

          borderRadius: "16px"

        }}
      >

        <h2
          style={{
            color: "black"
          }}
        >

          Logic / System Design

        </h2>

        <textarea

          value={logic}

          onChange={(e) => {

            setLogic(
              e.target.value
            );

            socketRef.current.emit(

              "logic-change",

              {

                roomId,

                logic:
                  e.target.value

              }

            );

          }}

          style={{

            width: "100%",

            height: "250px",

            fontSize: "20px",

            padding: "20px",

            borderRadius:
              "12px",

            border:
              "2px solid #cbd5e1"

          }}

        />

      </div>

    </div>

  );

}

export default InterviewRoom;