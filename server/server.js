const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { exec } = require("child_process");
const { Server } = require("socket.io");

const authRoutes = require("./routes/auth");
const Message = require("./models/Message");

dotenv.config();

const app = express();

const server = http.createServer(app);
const io = new Server(

  server,

  {

    cors: {

      origin: "*",

      methods: [

        "GET",
        "POST"

      ]

    }

  }

);
/* MIDDLEWARE */

app.use(

  cors({

    origin: "*",

    methods: [

      "GET",
      "POST"

    ],

    credentials: true

  })

);

app.use(express.json());

/* ROUTES */

app.use(
  "/api/auth",
  authRoutes
);

/* DATABASE */

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {

    console.log(
      "MongoDB Connected"
    );

  })
  .catch(console.log);

/* TEST */

app.get("/", (req, res) => {

  res.send(
    "SkillSync Backend Running"
  );

});

/* ROOMS */

const rooms = {};

/* ROOM STATES */

const roomStates = {};

/* SOCKET */

io.on(
  "connection",
  (socket) => {

    console.log(
      "CONNECTED:",
      socket.id
    );

    /* JOIN ROOM */

    socket.on(

      "join-room",

      ({ roomId, user }) => {

        socket.join(roomId);

        /* ROOM STATE */

        if (
          !roomStates[roomId]
        ) {

          roomStates[roomId] = {

            code:
`console.log("Hello SkillSync");`,

            language:
              "javascript",

            logic:
              "",

            output:
              ""

          };

        }

        /* PARTICIPANTS */

        if (
          !rooms[roomId]
        ) {

          rooms[roomId] = [];

        }

        /* LIMIT */

        if (
          rooms[roomId].length >= 3
        ) {

          socket.emit(
            "room-full"
          );

          return;

        }

        const participant = {

          socketId:
            socket.id,

          name:
            user?.name ||
            "Anonymous",

          role:
            user?.role ||
            "candidate"

        };

        rooms[roomId].push(
          participant
        );

        /* SEND ROOM STATE */

        socket.emit(

          "room-state",

          roomStates[roomId]

        );

        /* EXISTING USERS */

        const existingUsers =
          rooms[roomId].filter(
            (u) =>
              u.socketId !== socket.id
          );

        socket.emit(
          "existing-users",
          existingUsers
        );

        /* NEW USER */

        socket.to(roomId).emit(
          "user-joined",
          participant
        );

        /* UPDATE PARTICIPANTS */

        io.to(roomId).emit(

          "participants-update",

          rooms[roomId]

        );

      }
    );

    /* OFFER */

    socket.on(

      "offer",

      ({
        targetSocketId,
        offer
      }) => {

        io.to(
          targetSocketId
        ).emit(

          "offer",

          {

            offer,

            senderSocketId:
              socket.id

          }

        );

      }
    );

    /* ANSWER */

    socket.on(

      "answer",

      ({
        targetSocketId,
        answer
      }) => {

        io.to(
          targetSocketId
        ).emit(

          "answer",

          {

            answer,

            senderSocketId:
              socket.id

          }

        );

      }
    );

    /* ICE */

    socket.on(

      "ice-candidate",

      ({
        targetSocketId,
        candidate
      }) => {

        io.to(
          targetSocketId
        ).emit(

          "ice-candidate",

          {

            candidate,

            senderSocketId:
              socket.id

          }

        );

      }
    );

    /* CHAT */

    socket.on(

      "send-message",

      async (data) => {

        try {

          const saved =
            await Message.create({

              roomId:
                data.roomId,

              sender:
                data.sender,

              role:
                data.role,

              message:
                data.message

            });

          io.to(
            data.roomId
          ).emit(

            "receive-message",

            saved

          );

        }

        catch (err) {

          console.log(err);

        }

      }
    );

    /* EDITOR */

    socket.on(

      "editor-change",

      (data) => {

        if (
          roomStates[data.roomId]
        ) {

          roomStates[data.roomId].code =
            data.code;

          roomStates[data.roomId].language =
            data.language;

        }

        socket.to(
          data.roomId
        ).emit(

          "sync-editor",

          {

            code:
              data.code,

            language:
              data.language

          }

        );

      }
    );

    /* LOGIC */

    socket.on(

      "logic-change",

      (data) => {

        if (
          roomStates[data.roomId]
        ) {

          roomStates[data.roomId].logic =
            data.logic;

        }

        socket.to(
          data.roomId
        ).emit(

          "sync-logic",

          data.logic

        );

      }
    );

    /* OUTPUT */

    socket.on(

      "output-change",

      (data) => {

        if (
          roomStates[data.roomId]
        ) {

          roomStates[data.roomId].output =
            data.output;

        }

        socket.to(
          data.roomId
        ).emit(

          "sync-output",

          data.output

        );

      }
    );

    /* DISCONNECT */

    socket.on(

      "disconnect",

      () => {

        console.log(
          "DISCONNECTED:",
          socket.id
        );

        for (
          const roomId
          in rooms
        ) {

          rooms[roomId] =
            rooms[roomId].filter(
              (u) =>
                u.socketId !== socket.id
            );

          io.to(roomId).emit(

            "participants-update",

            rooms[roomId]

          );

          socket.to(roomId).emit(

            "user-left",

            socket.id

          );

          if (
            rooms[roomId].length === 0
          ) {

            delete rooms[roomId];

          }

        }

      }
    );

  }
);

/* GET MESSAGES */

app.get(

  "/messages/:roomId",

  async (req, res) => {

    try {

      const messages =
        await Message.find({

          roomId:
            req.params.roomId

        });

      res.json(messages);

    }

    catch (err) {

      console.log(err);

      res.status(500).json([]);

    }

  }
);

/* RUN CODE */

app.post(

  "/run",

  async (req, res) => {

    try {

      const {
        code,
        language
      } = req.body;

      const uniqueId =
        crypto.randomUUID();

      const tempDir =
        path.join(
          __dirname,
          "temp"
        );

      if (
        !fs.existsSync(
          tempDir
        )
      ) {

        fs.mkdirSync(
          tempDir
        );

      }

      let filePath = "";

      let executablePath = "";

      let command = "";

      /* JAVASCRIPT */

      if (
        language ===
        "javascript"
      ) {

        filePath =
          path.join(
            tempDir,
            `${uniqueId}.js`
          );

        fs.writeFileSync(
          filePath,
          code
        );

        command =
          `node "${filePath}"`;

      }

      /* PYTHON */

      else if (
        language ===
        "python"
      ) {

        filePath =
          path.join(
            tempDir,
            `${uniqueId}.py`
          );

        fs.writeFileSync(
          filePath,
          code
        );

        command =
          `python3 "${filePath}"`;

      }

      /* CPP */

      else if (
        language ===
        "cpp"
      ) {

        filePath =
          path.join(
            tempDir,
            `${uniqueId}.cpp`
          );

        executablePath =
          path.join(
            tempDir,
            `${uniqueId}`
          );

        fs.writeFileSync(
          filePath,
          code
        );

        command =
`g++ "${filePath}" -o "${executablePath}" && "${executablePath}"`;

      }

      /* JAVA */

      else if (
        language ===
        "java"
      ) {

        const className =
          `Main${uniqueId.replace(/-/g, "")}`;

        const javaCode =
          code.replace(
            /class\s+Main/g,
            `class ${className}`
          );

        filePath =
          path.join(
            tempDir,
            `${className}.java`
          );

        fs.writeFileSync(
          filePath,
          javaCode
        );

        command =
`cd "${tempDir}" && javac "${className}.java" && java "${className}"`;

      }

      else {

        return res.status(400).json({

          output:
            "Unsupported language"

        });

      }

      exec(

        command,

        {

          timeout: 10000

        },

        (
          error,
          stdout,
          stderr
        ) => {

          try {

            if (
              filePath &&
              fs.existsSync(
                filePath
              )
            ) {

              fs.unlinkSync(
                filePath
              );

            }

            if (
              executablePath &&
              fs.existsSync(
                executablePath
              )
            ) {

              fs.unlinkSync(
                executablePath
              );

            }

          }

          catch (cleanupError) {

            console.log(
              cleanupError
            );

          }

          if (error) {

            return res.json({

              output:
                stderr ||
                error.message

            });

          }

          return res.json({

            output:
              stdout

          });

        }

      );

    }

    catch (err) {

      console.log(err);

      return res.status(500).json({

        output:
          "Execution Error"

      });

    }

  }
);

/* START */

server.listen(

  process.env.PORT,

  () => {

    console.log(

      `Server Running On Port ${process.env.PORT}`

    );

  }
);
