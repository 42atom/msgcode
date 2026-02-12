import { After } from "@cucumber/cucumber";
import type { MsgcodeWorld } from "./world.ts";

After(function (this: MsgcodeWorld) {
  this.cleanup();
});

