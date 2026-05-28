const rooms = {};

io.on("connection", (socket) => {

  let currentRoom = null;

  socket.on(
    "join-room",
    ({ roomId, user }) => {

      currentRoom = roomId;

      if (!rooms[roomId]) {

        rooms[roomId] = {

          participants: [],

          code:
            `console.log("Hello World");`,

          language: "javascript",

          output: "",

          logic: "",

          messages: []

        };

      }

      const room =
        rooms[roomId];

      const alreadyExists =
        room.participants.find(
          (p) =>
            p.socketId === socket.id
        );

      if (!alreadyExists) {

        room.participants.push({

          socketId: socket.id,

          name: user.name,

          role: user.role

        });

      }

      socket.join(roomId);

      socket.emit(
        "room-state",
        room
      );

      io.to(roomId).emit(
        "participants-update",
        room.participants
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

      io.to(targetSocketId).emit(
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

      io.to(targetSocketId).emit(
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

      io.to(targetSocketId).emit(
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
    (data) => {

      rooms[data.roomId]
        .messages
        .push(data);

      io.to(data.roomId).emit(
        "receive-message",
        data
      );

    }
  );

  /* EDITOR */

  socket.on(
    "editor-change",
    (data) => {

      rooms[data.roomId].code =
        data.code;

      rooms[data.roomId].language =
        data.language;

      socket.to(data.roomId).emit(
        "sync-editor",
        data
      );

    }
  );

  /* LOGIC */

  socket.on(
    "logic-change",
    (data) => {

      rooms[data.roomId].logic =
        data.logic;

      socket.to(data.roomId).emit(
        "sync-logic",
        data.logic
      );

    }
  );

  /* OUTPUT */

  socket.on(
    "output-change",
    (data) => {

      rooms[data.roomId].output =
        data.output;

      socket.to(data.roomId).emit(
        "sync-output",
        data.output
      );

    }
  );

  /* DISCONNECT */

  socket.on(
    "disconnect",
    () => {

      if (
        currentRoom &&
        rooms[currentRoom]
      ) {

        rooms[
          currentRoom
        ].participants =
          rooms[
            currentRoom
          ].participants.filter(
            (p) =>
              p.socketId !== socket.id
          );

        io.to(currentRoom).emit(
          "participants-update",

          rooms[currentRoom]
            .participants
        );

        io.to(currentRoom).emit(
          "user-disconnected",
          socket.id
        );

      }

    }
  );

});