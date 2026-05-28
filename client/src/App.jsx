import {
  Routes,
  Route
} from "react-router-dom";

import Login from "./pages/Login";

import Dashboard from "./pages/Dashboard";

import InterviewRoom from "./pages/InterviewRoom";

import ProtectedRoute from "./ProtectedRoute";

function App() {

  return (

    <Routes>

      {/* LOGIN */}

      <Route
        path="/"
        element={<Login />}
      />

      {/* DASHBOARD */}

      <Route
        path="/dashboard"

        element={

          <ProtectedRoute>

            <Dashboard />

          </ProtectedRoute>

        }
      />

      {/* ROOM */}

      <Route
        path="/room/:roomId"
        element={<InterviewRoom />}
      />

    </Routes>

  );

}

export default App;