import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

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
  const [selectedClientId, setSelectedClientId] = useState<string | null>(() => {
    return localStorage.getItem("hr_selected_client_id");
  });

  useEffect(() => {
    if (selectedClientId) {
      localStorage.setItem("hr_selected_client_id", selectedClientId);
    } else {
      localStorage.removeItem("hr_selected_client_id");
    }
  }, [selectedClientId]);

  return (
    <ClientContext.Provider value={{ selectedClientId, setSelectedClientId }}>
      {children}
    </ClientContext.Provider>
  );
}
