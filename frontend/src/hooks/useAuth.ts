import { useContext } from "react";

import { AuthContext } from "@/store/AuthProvider";

export function useAuth() {
  return useContext(AuthContext);
}
