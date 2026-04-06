#!/usr/bin/env node
/**
 * Mattermost 9.5 テーマ検証用コンテナ起動・初期化スクリプト
 *
 * Usage:
 *   node scripts/mm95-start.mjs          # 起動 + 初期化
 *   node scripts/mm95-start.mjs --stop   # コンテナ停止・削除
 */

import { execSync, spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const CONTAINER_NAME = "mm95-theme-test";
const IMAGE = "mattermost/mattermost-preview:9.5.4";
const HOST_PORT = 8066;
const BASE_URL = `http://127.0.0.1:${HOST_PORT}`;

const ADMIN_EMAIL = "admin@mm95test.local";
const ADMIN_USERNAME = "mm95admin";
const ADMIN_PASSWORD = "Admin1234!";
const TEAM_NAME = "testteam";
const TEAM_DISPLAY = "Test Team";
const MEMBER_USERNAME = "mm95user";
const MEMBER_PASSWORD = "User1234!";
const MEMBER_EMAIL = "user@mm95test.local";

// ── helpers ──────────────────────────────────────────────────────────────────

function run(cmd) {
  const r = spawnSync(cmd, { shell: true, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout?.trim(), stderr: r.stderr?.trim() };
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function apiCall(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}/api/v4${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function waitForHealth(maxWaitMs = 120_000) {
  const deadline = Date.now() + maxWaitMs;
  process.stdout.write("Waiting for Mattermost 9.5 to be ready");
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/v4/system/ping`);
      if (res.ok) {
        const j = await res.json();
        if (j.status === "OK") {
          console.log(" ready.");
          return;
        }
      }
    } catch {
      // not up yet
    }
    process.stdout.write(".");
    await sleep(3000);
  }
  throw new Error("Timed out waiting for Mattermost to start");
}

// ── main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes("--stop")) {
  console.log("Stopping and removing container...");
  run(`docker stop ${CONTAINER_NAME}`);
  run(`docker rm ${CONTAINER_NAME}`);
  console.log("Done.");
  process.exit(0);
}

// Check if already running
const running = run(`docker inspect --format '{{.State.Running}}' ${CONTAINER_NAME}`);
if (running.code === 0 && running.stdout === "true") {
  console.log(`Container ${CONTAINER_NAME} is already running on port ${HOST_PORT}.`);
} else {
  // Remove stopped container if exists
  run(`docker rm -f ${CONTAINER_NAME}`);

  console.log(`Starting ${IMAGE} on port ${HOST_PORT}...`);
  const startResult = run(
    `docker run -d --name ${CONTAINER_NAME} -p ${HOST_PORT}:8065 ` +
    `-e MM_SERVICESETTINGS_ENABLEDEVELOPER=true ` +
    `-e MM_SERVICESETTINGS_ENABLETESTING=true ` +
    `${IMAGE}`,
  );
  if (startResult.code !== 0) {
    console.error("Failed to start container:", startResult.stderr);
    process.exit(1);
  }
  console.log("Container started:", startResult.stdout);
}

await waitForHealth();

// ── initial setup ─────────────────────────────────────────────────────────────

// Check if admin already exists by trying to log in
let adminToken;
try {
  const loginRes = await fetch(`${BASE_URL}/api/v4/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login_id: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
  });
  if (loginRes.ok) {
    adminToken = loginRes.headers.get("Token");
    console.log("Admin already exists, logged in.");
  }
} catch {
  // ignore
}

if (!adminToken) {
  console.log("Creating admin user...");
  try {
    await apiCall("POST", "/users", {
      email: ADMIN_EMAIL,
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
      allow_marketing: false,
    });
  } catch (e) {
    // May already exist or need initial setup
    console.log("Note:", e.message);
  }

  // Login
  const loginRes = await fetch(`${BASE_URL}/api/v4/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login_id: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
  });
  if (!loginRes.ok) {
    const t = await loginRes.text();
    console.error("Admin login failed:", t);
    process.exit(1);
  }
  adminToken = loginRes.headers.get("Token");
  console.log("Admin logged in.");
}

// Ensure SiteURL is configured (required for some API calls)
try {
  await apiCall("PUT", "/config/patch", {
    ServiceSettings: { SiteURL: BASE_URL },
  }, adminToken);
} catch (e) {
  console.log("SiteURL patch note:", e.message);
}

// Create team
let teamId;
try {
  const team = await apiCall("POST", "/teams", {
    name: TEAM_NAME,
    display_name: TEAM_DISPLAY,
    type: "O",
  }, adminToken);
  teamId = team.id;
  console.log("Team created:", TEAM_NAME);
} catch {
  // Already exists
  const teams = await apiCall("GET", "/teams", undefined, adminToken);
  const found = teams.find((t) => t.name === TEAM_NAME);
  if (!found) throw new Error("Could not find or create team");
  teamId = found.id;
  console.log("Team already exists:", TEAM_NAME);
}

// Create member user
let memberToken;
let memberId;
try {
  const member = await apiCall("POST", "/users", {
    email: MEMBER_EMAIL,
    username: MEMBER_USERNAME,
    password: MEMBER_PASSWORD,
    allow_marketing: false,
  }, adminToken);
  memberId = member.id;
  console.log("Member user created:", MEMBER_USERNAME);
} catch {
  // Already exists — get by username
  try {
    const existing = await apiCall("GET", `/users/username/${MEMBER_USERNAME}`, undefined, adminToken);
    memberId = existing.id;
    console.log("Member user already exists:", MEMBER_USERNAME);
  } catch (e) {
    console.error("Could not find member user:", e.message);
    process.exit(1);
  }
}

// Add member to team
try {
  await apiCall("POST", `/teams/${teamId}/members`, {
    team_id: teamId,
    user_id: memberId,
  }, adminToken);
  console.log("Member added to team.");
} catch {
  // already member
}

// Login as member to get token
{
  const loginRes = await fetch(`${BASE_URL}/api/v4/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login_id: MEMBER_USERNAME, password: MEMBER_PASSWORD }),
  });
  if (!loginRes.ok) {
    const t = await loginRes.text();
    console.error("Member login failed:", t);
    process.exit(1);
  }
  memberToken = loginRes.headers.get("Token");
}

// Write state file
const stateDir = "./e2e";
const stateFile = `${stateDir}/mm95-state.json`;
mkdirSync(stateDir, { recursive: true });
writeFileSync(stateFile, JSON.stringify({
  baseUrl: BASE_URL,
  teamName: TEAM_NAME,
  memberUser: {
    id: memberId,
    username: MEMBER_USERNAME,
    password: MEMBER_PASSWORD,
    token: memberToken,
  },
}, null, 2));

console.log(`\nState written to ${stateFile}`);
console.log(`Mattermost 9.5.4 is ready at ${BASE_URL}`);
console.log(`  Admin:  ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
console.log(`  Member: ${MEMBER_USERNAME} / ${MEMBER_PASSWORD}`);
console.log(`\nRun theme test:`);
console.log(`  MATTERMOST_BASE_URL=${BASE_URL} MM95_STATE_FILE=${stateFile} npx playwright test e2e/theme-compat.spec.ts`);
