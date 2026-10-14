/**
 * One-time interactive Alarm.com login. Handles the two-factor code and
 * registers this machine as a trusted device, so the server can log in
 * unattended afterwards. Run from server/:  npm run adc:login
 */
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { AdcAuth, OtpType, otpLabel } from "../adapters/alarmcom/auth.js";
import { AdcClient } from "../adapters/alarmcom/client.js";
import { AdcHttp } from "../adapters/alarmcom/http.js";
import { sessionFilePath } from "../adapters/alarmcom/index.js";
import { loadConfig } from "../config.js";

async function promptHidden(question: string): Promise<string> {
  stdout.write(question);
  return new Promise((resolve) => {
    let value = "";
    const wasRaw = stdin.isRaw;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode?.(wasRaw ?? false);
          stdin.removeListener("data", onData);
          stdin.pause();
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "") process.exit(130);
        if (ch === "" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const preset = cfg.adapters.alarmcom;
  const rl = readline.createInterface({ input: stdin, output: stdout });

  const username = (await rl.question(`Alarm.com username${preset?.username ? ` [${preset.username}]` : ""}: `)).trim() || preset?.username || "";
  rl.pause();
  const password = preset?.password && (await rl.question("Use password from config.json? [Y/n] ")).trim().toLowerCase() !== "n"
    ? preset.password
    : await promptHidden("Alarm.com password (hidden): ");

  const http = new AdcHttp(sessionFilePath(cfg.dataDir));
  http.load();
  const auth = new AdcAuth(http, username, password, preset?.deviceName ?? "Surveil");

  console.log("\nLogging in…");
  const result = await auth.login();

  if (result === "mfa_required") {
    const { methods } = await auth.checkMfa();
    console.log("Two-factor authentication is required. Methods enabled on your account:");
    methods.forEach((m, i) => console.log(`  ${i + 1}. ${otpLabel[m]}`));
    let method = methods[0];
    if (methods.length > 1) {
      const pick = Number((await rl.question(`Choose [1-${methods.length}]: `)).trim());
      method = methods[pick - 1] ?? methods[0];
    }
    if (method !== OtpType.app) {
      await auth.requestOtp(method);
      console.log(`A code has been sent via ${otpLabel[method]}.`);
    } else {
      console.log("Open your authenticator app.");
    }
    const code = (await rl.question("Enter the code: ")).trim();
    await auth.submitOtp(code, method);
    console.log("Code accepted. This machine is now a trusted device.");
  }

  const client = new AdcClient(http);
  const cameras = await client.listCameras();
  console.log(`\nLogged in. ${cameras.length} camera(s):`);
  for (const c of cameras) {
    console.log(`  ${c.id.padEnd(16)} ${c.name.padEnd(24)} ${c.model ?? "?"}  ${c.unreachable ? "OFFLINE" : "online"}${c.privateIp ? "  " + c.privateIp : ""}`);
  }
  if (cameras[0]) console.log(`\nAttribute keys on the first camera (for the Phase 0 notes):\n  ${cameras[0].attributeKeys.join(", ")}`);
  console.log(`\nSession saved to ${sessionFilePath(cfg.dataDir)}`);
  if (!preset?.enabled) {
    console.log("Now set adapters.alarmcom.enabled = true (with username/password) in server/config.json and start the server.");
  }
  rl.close();
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
