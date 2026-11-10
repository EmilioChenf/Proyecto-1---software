import { AuthProvider } from "@/context/AuthContext";
import { SessionTimeout } from "@/components/auth/SessionTimeout";
import { AppRouter } from "@/routes/AppRouter";

export default function App() {
  return (
    <AuthProvider>
      <SessionTimeout />
      <AppRouter />
    </AuthProvider>
  );
}
