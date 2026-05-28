const mongoose =
  require("mongoose");

const roomSchema =
  new mongoose.Schema({

    roomId: {

      type: String,

      required: true,

      unique: true

    },

    code: {

      type: String,

      default:
        `console.log("Hello SkillSync");`

    },

    language: {

      type: String,

      default:
        "javascript"

    },

    logic: {

      type: String,

      default: ""

    },

    output: {

      type: String,

      default: ""

    }

  },

  {

    timestamps: true

  }

);

module.exports =
  mongoose.model(
    "Room",
    roomSchema
  );