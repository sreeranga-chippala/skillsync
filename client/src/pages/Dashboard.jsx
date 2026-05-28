import {
  useState
} from "react";

import {
  useNavigate
} from "react-router-dom";

function Dashboard() {

  const navigate =
    useNavigate();

  const [roomId, setRoomId] =
    useState("");

  /* CREATE ROOM */

  const createRoom =
    () => {

      const newRoomId =
        "skillsync" +
        Math.floor(
          Math.random() * 100000
        );

      navigate(
        `/room/${newRoomId}`
      );

    };

  /* JOIN ROOM */

  const joinRoom =
    () => {

      if (!roomId.trim()) {

        return alert(
          "Enter Room ID"
        );

      }

      navigate(
        `/room/${roomId}`
      );

    };

  return (

    <div
      className="vh-100 d-flex justify-content-center align-items-center"
      style={{
        background:
          "#0f172a"
      }}
    >

      <div
        className="p-5 rounded"
        style={{
          width: "400px",
          background:
            "#111827"
        }}
      >

        <h1
          className="text-center mb-4 text-light"
        >

          SkillSync

        </h1>

        <button
          className="btn btn-primary w-100 mb-4"
          onClick={createRoom}
        >

          Create Interview Room

        </button>

        <input
          type="text"
          className="form-control mb-3"
          placeholder="Enter Room ID"
          value={roomId}
          onChange={(e) =>
            setRoomId(
              e.target.value
            )
          }
        />

        <button
          className="btn btn-success w-100"
          onClick={joinRoom}
        >

          Join Room

        </button>

      </div>

    </div>

  );

}

export default Dashboard;