import { execFileSync } from "node:child_process";

const PROJECTS = [
  "tsconfig.json",
  "tsconfig.server.json",
  "tsconfig.test.json",
];
const run = (command: string, args: string[]): void => {
  execFileSync("bunx", [command, ...args], { stdio: "inherit" });
};
export default function globalSetup(): void {
  run("vp", ["check"]);
  for (const project of PROJECTS) {
    run("tsc", ["-p", project]);
  }
  run("vp", ["build"]);
}
