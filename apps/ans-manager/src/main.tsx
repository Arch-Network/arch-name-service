import "./polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ANS_BUILD } from "./lib/build-stamp";
import "./styles/app.css";

// Unconditional, unlike `debugLog`: identifying the running bundle has to work
// before anyone thinks to turn diagnostics on.
window.__ansBuild = ANS_BUILD;
// eslint-disable-next-line no-console
console.info(`[ans] build ${ANS_BUILD}`);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
