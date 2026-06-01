#!/usr/bin/env node
/**
 * One-time account provisioning for the GRUBUS Settlement app.
 *
 * Creates Firebase Auth users (email + password) AND the matching
 *   users/{uid} = { email, name, role }
 * doc that the security rules read for role-based access.
 *
 * Usage:
 *   1. Put the service-account JSON for the NEW dedicated Firebase project
 *      at: ./service-account.json  (this path is git-ignored).
 *   2. Edit the USERS list below — email, name, role, tempPassword.
 *      Roles: 'basic' | 'manager' | 'admin'.
 *   3. From the new-settlement-app-2.0 directory run:
 *        node scripts/provision-users.mjs
 *
 * Idempotent: if a user already exists, the script updates the role doc.
 * Re-run safely after adding/removing users.
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Edit this list before running ─────────────────────────────────────
const USERS = [
  { email: 'admin@traq.in',    name: 'Admin',     role: 'admin',   tempPassword: 'Traq@2026' },
  { email: 'manager1@traq.in', name: 'Manager 1', role: 'manager', tempPassword: 'Traq@2026' },
  { email: 'manager2@traq.in', name: 'Manager 2', role: 'manager', tempPassword: 'Traq@2026' },
  { email: 'basic1@traq.in',   name: 'Basic 1',   role: 'basic',   tempPassword: 'Traq@2026' },
  { email: 'basic2@traq.in',   name: 'Basic 2',   role: 'basic',   tempPassword: 'Traq@2026' },
];
// ──────────────────────────────────────────────────────────────────────

const VALID_ROLES = new Set(["basic", "manager", "admin"]);

function loadServiceAccount() {
  const path = resolve(__dirname, "..", "service-account.json");
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`✖ Could not read service-account.json at ${path}\n  ${err.message}`);
    console.error("  Download a service-account key from Firebase Console → Project Settings → Service accounts → Generate new private key.");
    process.exit(1);
  }
}

async function main() {
  if (USERS.length === 0) {
    console.error("✖ USERS list is empty. Edit scripts/provision-users.mjs and add entries.");
    process.exit(1);
  }
  for (const u of USERS) {
    if (!u.email || !u.name || !u.role || !u.tempPassword) {
      console.error(`✖ Invalid entry (missing field): ${JSON.stringify(u)}`);
      process.exit(1);
    }
    if (!VALID_ROLES.has(u.role)) {
      console.error(`✖ Invalid role "${u.role}" for ${u.email} — use basic/manager/admin.`);
      process.exit(1);
    }
  }

  initializeApp({ credential: cert(loadServiceAccount()) });
  const auth = getAuth();
  const db = getFirestore();

  console.log(`Provisioning ${USERS.length} user(s)…\n`);
  let created = 0, updated = 0;

  for (const u of USERS) {
    let uid;
    try {
      const rec = await auth.getUserByEmail(u.email);
      uid = rec.uid;
      console.log(`  ↻ exists  ${u.email}  (uid ${uid.slice(0, 8)}…)`);
      updated++;
    } catch (err) {
      if (err.code === "auth/user-not-found") {
        const rec = await auth.createUser({
          email: u.email,
          password: u.tempPassword,
          displayName: u.name,
        });
        uid = rec.uid;
        console.log(`  ✓ created ${u.email}  (uid ${uid.slice(0, 8)}…)`);
        created++;
      } else {
        throw err;
      }
    }
    await db.collection("users").doc(uid).set({
      email: u.email,
      name: u.name,
      role: u.role,
    }, { merge: true });
  }

  console.log(`\n✓ Done — ${created} created, ${updated} updated.`);
  console.log("  Have users change their password on first login (browser → Reset password, or via Firebase console).");
  process.exit(0);
}

main().catch((err) => {
  console.error("✖ Provisioning failed:", err.message || err);
  process.exit(1);
});
