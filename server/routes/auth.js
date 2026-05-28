const express = require("express");

const bcrypt = require("bcryptjs");

const jwt = require("jsonwebtoken");

const User = require("../models/User");

const router = express.Router();

/* GENERATE TOKEN */

const generateToken =
  (user) => {

    return jwt.sign(

      {

        id:
          user._id,

        email:
          user.email,

        role:
          user.role,

        name:
          user.name

      },

      process.env.JWT_SECRET,

      {

        expiresIn:
          "7d"

      }

    );

  };

/* REGISTER */

router.post(
  "/register",
  async (req, res) => {

    try {

      const {

        name,
        email,
        password,
        role

      } = req.body;

      /* VALIDATION */

      if (

        !name ||
        !email ||
        !password

      ) {

        return res.status(400).json({

          success: false,

          message:
            "All fields are required"

        });

      }

      /* CHECK EXISTING USER */

      const existingUser =
        await User.findOne({

          email:
            email.toLowerCase()

        });

      if (existingUser) {

        return res.status(400).json({

          success: false,

          message:
            "User already exists"

        });

      }

      /* HASH PASSWORD */

      const hashedPassword =
        await bcrypt.hash(

          password,
          10

        );

      /* CREATE USER */

      const user =
        await User.create({

          name,

          email:
            email.toLowerCase(),

          password:
            hashedPassword,

          role:
            role || "candidate"

        });

      /* TOKEN */

      const token =
        generateToken(user);

      /* RESPONSE */

      return res.status(201).json({

        success: true,

        message:
          "User registered successfully",

        token,

        user: {

          id:
            user._id,

          name:
            user.name,

          email:
            user.email,

          role:
            user.role

        }

      });

    }

    catch (error) {

      console.log(error);

      return res.status(500).json({

        success: false,

        message:
          "Server Error"

      });

    }

  }
);

/* LOGIN */

router.post(
  "/login",
  async (req, res) => {

    try {

      const {

        email,
        password

      } = req.body;

      /* VALIDATION */

      if (

        !email ||
        !password

      ) {

        return res.status(400).json({

          success: false,

          message:
            "Email and password required"

        });

      }

      /* FIND USER */

      const user =
        await User.findOne({

          email:
            email.toLowerCase()

        }).select("+password");

      /* USER NOT FOUND */

      if (!user) {

        return res.status(401).json({

          success: false,

          message:
            "Invalid credentials"

        });

      }

      /* PASSWORD MATCH */

      const isMatch =
        await bcrypt.compare(

          password,
          user.password

        );

      if (!isMatch) {

        return res.status(401).json({

          success: false,

          message:
            "Invalid credentials"

        });

      }

      /* TOKEN */

      const token =
        generateToken(user);

      /* RESPONSE */

      return res.status(200).json({

        success: true,

        token,

        user: {

          id:
            user._id,

          name:
            user.name,

          email:
            user.email,

          role:
            user.role

        }

      });

    }

    catch (error) {

      console.log(error);

      return res.status(500).json({

        success: false,

        message:
          "Server Error"

      });

    }

  }
);

module.exports = router;