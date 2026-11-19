import { sdkOnlyBuild, sdkSmokeChannels } from "../../shared/sdk-native-smoke";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import App from "./App";
import "./styles.css";
import { applyTheme, readSavedTheme } from "./lib/theme";

applyTheme(readSavedTheme());

const root = document.querySelector<HTMLDivElement>("#root");
if (!root) throw new Error("Missing #root element");

const StartupSignal = () => {
  useEffect(() => {
    if (sdkOnlyBuild) window.dispatchEvent(new Event(sdkSmokeChannels.mounted));
  }, []);
  return null;
};

createRoot(root).render(
  <StrictMode>
    <App />
    {sdkOnlyBuild ? <StartupSignal /> : null}
  </StrictMode>,
);
