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

        padding:

          window.innerWidth < 768

          ?

          "10px"

          :

          "20px",

        color: "white",

        fontFamily: "sans-serif"

      }}
    >

      <h1
        style={{

          marginBottom: "25px",

          fontSize:

            window.innerWidth < 768

            ?

            "28px"

            :

            "42px"

        }}
      >

        SkillSync Interview Room

      </h1>

      {/* CAMERAS */}

      <div
        style={{

          display: "grid",

          gridTemplateColumns:

            window.innerWidth < 1100

            ?

            "1fr"

            :

            "repeat(auto-fit, minmax(320px, 1fr))",

          gap:

            window.innerWidth < 768

            ?

            "12px"

            :

            "20px",

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

              height:

                window.innerWidth < 768

                ?

                "200px"

                :

                "240px",

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
                    "15px",

                  border:
                    "2px solid #334155"

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

                    height:

                      window.innerWidth < 768

                      ?

                      "200px"

                      :

                      "240px",

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