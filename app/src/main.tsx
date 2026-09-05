import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ProveedorSesion } from "./lib/sesion";
import { ProveedorDatos } from "./lib/datos";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ProveedorSesion>
        <ProveedorDatos>
          <App />
        </ProveedorDatos>
      </ProveedorSesion>
    </BrowserRouter>
  </StrictMode>,
);
