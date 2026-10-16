import "../src/runtime/load-local-env";
import { validateRuntimeEnvironment } from "../src/runtime/environment-config";

validateRuntimeEnvironment();
console.log(JSON.stringify({ event: "runtime_config.valid", secretValuesDisplayed: false, sourceNetworkEnabled: process.env.SOURCE_NETWORK_ENABLED === "true" }));
