import React from "react";
import { createRoot } from "react-dom/client";
import A218RealEvidencePage from "../app/eval/certificate-qr-stage-a21-8-real-evidence/page.jsx";

const root = document.getElementById("root");
if (!root) throw new Error("A218_STANDALONE_ROOT_MISSING");
createRoot(root).render(<A218RealEvidencePage />);
