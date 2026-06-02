import { config as loadDotenv } from "dotenv";

let loaded = false;

export function loadAppEnv() {
  if (loaded) {
    return;
  }

  loadDotenv({ path: ".env.dev", override: false });
  loadDotenv({ override: false });
  loaded = true;
}
