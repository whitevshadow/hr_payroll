import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface ClientContextType {
  selectedClientId: string | null;
  setSelectedClientId: (id: string | null) => void;
}

const ClientContext = createContext<ClientContextType>({
  selectedClientId: null,
  setSelectedClientId: () => {},
});

export const useClientContext = () => useContext(ClientContext);

export function ClientProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [selectedClientId, setSelectedClientId] = useState<string | null>(() => {
    return localStorage.getItem("hr_selected_client_id");
  });
  // Tracks the client the cache currently holds data for, so we only reset on a
  // real change (not on mount or React StrictMode's double-invoked effect).
  const cachedClientRef = useRef<string | null>(selectedClientId);

  useEffect(() => {
    if (selectedClientId) {
      localStorage.setItem("hr_selected_client_id", selectedClientId);
    } else {
      localStorage.removeItem("hr_selected_client_id");
    }

    if (cachedClientRef.current !== selectedClientId) {
      cachedClientRef.current = selectedClientId;
      // Query keys are client-agnostic, but the data is client-scoped via the
      // x-client-id request header. Drop all cached queries on a client switch
      // so the previous client's cycles/compliance/dashboard are not shown;
      // active queries then refetch under the new client. The auth "me" query
      // is preserved so this doesn't trigger a full-page auth spinner.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    }
  }, [selectedClientId, qc]);

  return (
    <ClientContext.Provider value={{ selectedClientId, setSelectedClientId }}>
      {children}
    </ClientContext.Provider>
  );
}
