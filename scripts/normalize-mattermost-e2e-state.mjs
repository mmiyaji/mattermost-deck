import fs from "node:fs/promises";
import path from "node:path";

const inputPath = process.env.CAB_MATTERMOST_E2E_STATE_FILE;
const outputPath = process.env.MM_DECK_E2E_STATE_OUTPUT;
const mattermostVersion = process.env.MM_DECK_E2E_MATTERMOST_VERSION;

if (!inputPath || !outputPath || !mattermostVersion) {
  throw new Error(
    "Set CAB_MATTERMOST_E2E_STATE_FILE, MM_DECK_E2E_STATE_OUTPUT, and MM_DECK_E2E_MATTERMOST_VERSION",
  );
}

const raw = JSON.parse(await fs.readFile(inputPath, "utf8"));
const adminUser = raw.adminUser ?? raw.bridgeUser;
if (!raw.team?.id || !raw.team?.name || !adminUser || !raw.memberUser) {
  throw new Error(
    "Mattermost E2E state must include team, adminUser or bridgeUser, and memberUser",
  );
}

const normalized = {
  baseUrl:
    process.env.MATTERMOST_BASE_URL ??
    raw.baseUrl ??
    raw.serverUrl,
  mattermostVersion,
  team: raw.team,
  teamName: raw.teamName ?? raw.team.name,
  adminUser,
  memberUser: raw.memberUser,
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(normalized, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
console.log(`Normalized Mattermost E2E state: ${outputPath}`);
