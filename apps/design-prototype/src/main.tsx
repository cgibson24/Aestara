import "@aestara/design-tokens/tokens.css";
import "./styles/app.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { Prototype } from "./prototype/Prototype";

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing");
createRoot(root).render(<Prototype />);
