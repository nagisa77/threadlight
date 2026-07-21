import { createRoot } from "react-dom/client";
import { ThreadlightClient } from "@threadlight/client";
import { ThreadlightApp } from "@threadlight/ui";
import "@threadlight/ui/styles.css";

import { ElectronTransport } from "./electron-transport.js";

const client = new ThreadlightClient(new ElectronTransport());
const root = document.getElementById("root");

if (!root) throw new Error("Missing root element");

createRoot(root).render(<ThreadlightApp client={client} />);
