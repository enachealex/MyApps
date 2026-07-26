import React from "react";
import ReactDOM from "react-dom/client";
import { installStorageShim } from "./storage.js";
import OnCallApp from "./OnCallApp.jsx";
import "./index.css";

installStorageShim();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <OnCallApp />
  </React.StrictMode>
);
