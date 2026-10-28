import { AuthProvider } from "@/context/AuthContext";
import { SessionTimeout } from "@/components/auth/SessionTimeout";
import { AppRouter } from "@/routes/AppRouter";
import { ActionToasts } from "@/components/notifications/ActionToasts";

export default function App() {
  return (
    <AuthProvider>
      <ActionToasts />
      <SessionTimeout />
      <AppRouter />
    </AuthProvider>
  );
}
