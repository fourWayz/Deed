"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, lightTheme } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { PassportProvider, getConfig, getDefaultWallets } from "@mezo-org/passport";

const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID;
if (!projectId) {
  // injected wallets still work, WalletConnect will be refused until a project id is set in frontend/.env.local
  console.warn("NEXT_PUBLIC_WC_PROJECT_ID is not set, WalletConnect is disabled");
}

const config = getConfig({
  appName: "Deed",
  mezoNetwork: "testnet",
  // Passport's defaults are Bitcoin wallets and WalletConnect, plain EVM wallets like MetaMask need this entry
  wallets: [...getDefaultWallets("testnet"), { groupName: "Browser", wallets: [injectedWallet] }],
  walletConnectProjectId: projectId ?? "",
  ssr: true,
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={lightTheme({ accentColor: "#3b5bdb", borderRadius: "large" })}>
          <PassportProvider environment="testnet">{children}</PassportProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
