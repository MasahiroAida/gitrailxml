#!/usr/bin/env node
import { main } from "../lib/main.js";

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
