import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { LanguageProvider } from "./context/LanguageContext";
import { Navbar } from "./components/Navbar";
import { ChatBot } from "./components/ChatBot";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Landing } from "./pages/Landing";
import { Register } from "./pages/Register";
import { Login } from "./pages/Login";
import { FarmerDashboard } from "./pages/FarmerDashboard";
import { BookingHistory } from "./pages/BookingHistory";
import { SlotBooking } from "./pages/SlotBooking";
import { OperatorQueue } from "./pages/OperatorQueue";
import { AdminDashboard } from "./pages/AdminDashboard";
import { OfficerDashboard } from "./pages/OfficerDashboard";

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <BrowserRouter>
          <div className="min-h-screen bg-paper">
            <Navbar />
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/register" element={<Register />} />
              <Route path="/login" element={<Login />} />
              <Route
                path="/farmer/dashboard"
                element={
                  <ProtectedRoute allowedRoles={["FARMER"]}>
                    <FarmerDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/farmer/history"
                element={
                  <ProtectedRoute allowedRoles={["FARMER"]}>
                    <BookingHistory />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/farmer/book-slot"
                element={
                  <ProtectedRoute allowedRoles={["FARMER"]}>
                    <SlotBooking />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/operator/queue"
                element={
                  <ProtectedRoute allowedRoles={["OPERATOR"]}>
                    <OperatorQueue />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/dashboard"
                element={
                  <ProtectedRoute allowedRoles={["ADMIN"]}>
                    <AdminDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/manager/dashboard"
                element={
                  <ProtectedRoute allowedRoles={["MANAGER"]}>
                    <AdminDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/officer/dashboard"
                element={
                  <ProtectedRoute
                    allowedRoles={["GATE_OFFICER", "DOCUMENT_OFFICER", "QUALITY_OFFICER", "WEIGHT_OFFICER", "PROCUREMENT_OFFICER", "PAYMENT_OFFICER"]}
                  >
                    <OfficerDashboard />
                  </ProtectedRoute>
                }
              />
            </Routes>
            <ChatBot />
          </div>
        </BrowserRouter>
      </AuthProvider>
    </LanguageProvider>
  );
}
