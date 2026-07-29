import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { ManageView } from "./views/ManageView";
import { MyNamesView } from "./views/MyNamesView";
import { RegisterView } from "./views/RegisterView";
import { SearchView } from "./views/SearchView";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<SearchView />} />
          <Route path="register" element={<RegisterView />} />
          <Route path="manage" element={<ManageView />} />
          <Route path="names" element={<MyNamesView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
