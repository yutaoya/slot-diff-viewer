import { createContext } from 'react';

export type AccessAccount = {
  name: string;
  email: string;
  logout: () => void;
};

export const AccessAccountContext = createContext<AccessAccount | null>(null);
