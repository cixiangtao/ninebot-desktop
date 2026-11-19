import { app } from "electron";
import { getBundledNineCliBinaryPath, NineCliClient } from "./ninecli.js";
import { createCandidateTravelReader } from "./travel-source.js";
import { createHybridTravelReader } from "./hybrid-travel-source.js";
import { createCandidateVehicleReader } from "./vehicle-source.js";
import { registerIpcHandlers } from "./ipc.js";

export const registerLegacyRuntime = async (configDirectory: string) => {
  const binaryPath = getBundledNineCliBinaryPath({
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  });
  const ninecli = new NineCliClient(configDirectory, binaryPath);
  await ninecli.start();
  const paginatedTravel = createCandidateTravelReader({
    configDirectory,
    legacy: ninecli,
    useLegacyMetadata: true,
  });
  const travelReader = createHybridTravelReader({
    ninecli,
    paginated: paginatedTravel,
    refreshSession: () => ninecli.whoami(),
  });
  const vehicleReader = createCandidateVehicleReader({ configDirectory });
  registerIpcHandlers(ninecli, ninecli, travelReader, vehicleReader);
  app.on("before-quit", () => {
    travelReader.clear?.();
    vehicleReader.clear?.();
  });
};
