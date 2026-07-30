import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { ArchWalletKitProvider } from "@arch-network/wallet-connect-kit";
import { Shell } from "./components/Shell";
import { AnsWalletPortBridge, WalletPicker } from "./components/WalletPicker";
import { ArchWalletProvider, useArchWallet } from "./hooks/useArchWallet";
import { ANS_WALLET_KIT_CONFIG } from "./lib/kit-config";
import { ManageView } from "./views/ManageView";
import { MyNamesView } from "./views/MyNamesView";
import { RegisterView } from "./views/RegisterView";
import { SearchView } from "./views/SearchView";
import { ViewNameView } from "./views/ViewNameView";

function WalletPickerHost() {
  const { walletPickerOpen, closeWalletPicker } = useArchWallet();
  return <WalletPicker open={walletPickerOpen} onClose={closeWalletPicker} />;
}

export default function App() {
  return (
    <ArchWalletKitProvider config={ANS_WALLET_KIT_CONFIG}>
      <ArchWalletProvider>
        <AnsWalletPortBridge />
        <WalletPickerHost />
        <HashRouter>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<SearchView />} />
              <Route path="register" element={<RegisterView />} />
              <Route path="view" element={<ViewNameView />} />
              <Route path="manage" element={<ManageView />} />
              <Route path="names" element={<MyNamesView />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </HashRouter>
      </ArchWalletProvider>
    </ArchWalletKitProvider>
  );
}
