// Entry point. `registerRootComponent` wires the root into both native runtimes and sets up the
// development-client bridge; there is no expo-router here on purpose (EIA Field has five screens
// and a hand-written navigator, which is smaller than the router's dependency tree).
import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);
