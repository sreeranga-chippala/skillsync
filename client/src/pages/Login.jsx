import {
  useState
} from "react";
import { BACKEND_URL }
from "../config";
import {
  useNavigate
} from "react-router-dom";

import axios from "axios";

function Login() {

  const navigate =
    useNavigate();

  /* STATES */

  const [isLogin, setIsLogin] =
    useState(true);

  const [name, setName] =
    useState("");

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  /* SUBMIT */
const handleSubmit =
  async () => {

    try {

      const endpoint =
        isLogin
          ? "login"
          : "register";

      const response =
        await axios.post(

          `${BACKEND_URL}/api/auth/${endpoint}`,

          {

            name,

            email,

            password

          }

        );

      localStorage.setItem(
        "token",
        response.data.token
      );

      localStorage.setItem(
        "user",
        JSON.stringify(
          response.data.user
        )
      );

      localStorage.setItem(
        "name",
        response.data.user.name
      );

      localStorage.setItem(
        "role",
        response.data.user.role
      );

      localStorage.setItem(
        "email",
        response.data.user.email
      );

      navigate(
        "/dashboard"
      );

    }

    catch (err) {

      console.log(err);

      console.log(
        err.response?.data
      );

      alert(

        err.response?.data?.message ||

        err.response?.data?.error ||

        err.message ||

        "Something went wrong"

      );

    }

  };
  return (

    <div
      className="vh-100 d-flex justify-content-center align-items-center"
    >

      <div
        className="bg-dark p-4 rounded"
        style={{
          width: "400px"
        }}
      >

        <h2 className="text-center mb-4">

          SkillSync

        </h2>

        {/* SIGNUP NAME */}

        {!isLogin && (

          <input
            type="text"
            placeholder="Name"
            className="form-control mb-3"
            value={name}
            onChange={(e) =>
              setName(
                e.target.value
              )
            }
          />

        )}

        {/* EMAIL */}

        <input
          type="email"
          placeholder="Email"
          className="form-control mb-3"
          value={email}
          onChange={(e) =>
            setEmail(
              e.target.value
            )
          }
        />

        {/* PASSWORD */}

        <input
          type="password"
          placeholder="Password"
          className="form-control mb-3"
          value={password}
          onChange={(e) =>
            setPassword(
              e.target.value
            )
          }
        />

        {/* BUTTON */}

        <button
          className="btn btn-primary w-100 mb-3"
          onClick={handleSubmit}
        >

          {isLogin
            ? "Login"
            : "Signup"}

        </button>

        {/* TOGGLE */}

        <p
          className="text-center"
          style={{
            cursor: "pointer"
          }}
          onClick={() =>
            setIsLogin(
              !isLogin
            )
          }
        >

          {isLogin
            ? "Create new account"
            : "Already have an account?"}

        </p>

      </div>

    </div>

  );

}

export default Login;