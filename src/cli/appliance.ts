import { Command } from "commander";
import { registerApplianceProfileCommands } from "./appliance-profile.js";
import { registerApplianceCapabilityCommands } from "./appliance-capabilities.js";
import { registerAppliancePeopleCommands } from "./appliance-people.js";
import { registerApplianceArchiveCommands } from "./appliance-archive.js";
import { registerApplianceSurfaceCommands } from "./appliance-surfaces.js";

export function createApplianceCommand(): Command {
  const cmd = new Command("appliance");
  cmd.description("Appliance 主机壳合同（门厅 JSON）");

  registerApplianceProfileCommands(cmd);
  registerApplianceCapabilityCommands(cmd);
  registerAppliancePeopleCommands(cmd);
  registerApplianceArchiveCommands(cmd);
  registerApplianceSurfaceCommands(cmd);

  return cmd;
}
