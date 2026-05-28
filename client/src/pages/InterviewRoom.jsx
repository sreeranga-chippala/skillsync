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

  const socketRef =
    useRef(null);

  const localVideoRef =
    useRef(null);

  const localStreamRef =
    useRef(null);

  const peerConnections =
    useRef({});

  const messagesEndRef =
    useRef(null);

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
    useState(
`console.log("Hello SkillSync");`
    );

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

      let pc =
        peerConnections.current[
          targetSocketId
        ];

      if (pc)
        return pc;

      pc =
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

      /* LOCAL TRACKS */

      if (
        localStreamRef.current
      ) {

        localStreamRef.current
          .getTracks()
          .forEach((track) => {

            pc.addTrack(

              track,

              localStreamRef.current

            );

          });

      }

      /* REMOTE STREAM */

      pc.ontrack =
        (event) => {

          const remoteStream =
            event.streams[0];

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
                    remoteStream

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

      return pc;

    };

  /* SOCKET */

  useEffect(() => {

    socketRef.current =
      io(

        "/",

        {

          transports: [

            "websocket",

            "polling"

          ],

          reconnection: true,

          reconnectionAttempts: 20,

          reconnectionDelay: 1000

        }

      );

    const socket =
      socketRef.current;

    /* JOIN */

    socket.emit(

      "join-room",

      {

        roomId,

        user

      }

    );

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

    /* EXISTING USERS */

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

    /* NEW USER */

    socket.on(

      "user-joined",

      async (participant) => {

        if (
          participant.socketId ===
          socket.id
        ) return;

        setParticipants(
          (prev) => {

            const exists =
              prev.find(

                (p) =>

                  p.socketId ===
                  participant.socketId

              );

            if (exists)
              return prev;

            return [

              ...prev,

              participant

            ];

          }
        );

        await createPeerConnection(

          participant.socketId,

          true

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

        const pc =
          await createPeerConnection(

            senderSocketId,

            false

          );

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

        try {

          await pc.addIceCandidate(

            new RTCIceCandidate(
              candidate
            )

          );

        }

        catch (err) {

          console.log(err);

        }

      }

    );

    /* USER LEFT */

    socket.on(

      "user-left",

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

        setRemoteStreams(
          (prev) =>

            prev.filter(

              (p) =>

                p.socketId !==
                socketId

            )

        );

        setParticipants(
          (prev) =>

            prev.filter(

              (p) =>

                p.socketId !==
                socketId

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

          marginBottom: "25px",

          fontSize: "36px"

        }}
      >

        SkillSync Interview Room

      </h1>

      {/* CAMERA GRID */}

      <div
        style={{

          display: "grid",

          gridTemplateColumns:
            "repeat(auto-fit, minmax(320px, 1fr))",

          gap: "20px",

          marginBottom: "25px"

        }}
      >

        {/* LOCAL */}

        <div
          style={{

            background: "#1e293b",

            borderRadius: "16px",

            padding: "15px"

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

        </div>

        {/* REMOTE */}

        {

          remoteStreams.map(

            (remoteUser, index) => (

              <div

                key={remoteUser.socketId}

                style={{

                  background:
                    "#1e293b",

                  borderRadius:
                    "16px",

                  padding:
                    "15px"

                }}

              >

                <video

                  autoPlay

                  playsInline

                  ref={(video) => {

                    if (
                      video &&
                      remoteUser.stream
                    ) {

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

                <h3
                  style={{
                    marginTop: "12px"
                  }}
                >

                  {

                    participants.find(

                      (p) =>

                        p.socketId ===
                        remoteUser.socketId

                    )?.name ||

                    `User ${index + 1}`

                  }

                </h3>

              </div>

            )

          )

        }

      </div>

    </div>

  );

}

export default InterviewRoom;