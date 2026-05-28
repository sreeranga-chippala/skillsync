import React from "react";

const LogicPanel = ({
  logic,
  setLogic,
  socket,
  roomId
}) => {

  const handleChange = (e) => {

    const value = e.target.value;

    setLogic(value);

    socket.emit(
      "logic-change",
      {
        roomId,
        logic: value
      }
    );

  };

  return (

    <div
      className="
        bg-white
        rounded
        p-3
      "
    >

      <h3
        className="mb-3"
        style={{
          color: "black"
        }}
      >

        Logic / System Design

      </h3>

      <textarea

        value={logic}

        onChange={handleChange}

        placeholder="
Discuss architecture,
pseudocode,
database design...
"

        style={{

          width: "100%",

          height: "180px",

          padding: "15px",

          resize: "none",

          border:
            "1px solid #ccc",

          borderRadius:
            "10px",

          outline: "none",

          background:
            "#f9fafb",

          color: "black",

          fontSize: "16px"

        }}

      />

    </div>

  );

};

export default LogicPanel;