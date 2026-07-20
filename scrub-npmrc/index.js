// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2025 The Linux Foundation

// Securely removes a generated .npmrc file at the end of a job.
//
// GitHub composite actions cannot declare their own post step, so this
// small Node action carries the post hook. The single entry point runs
// twice: first in the main phase (to record the file path), then again in
// the post phase (to scrub the file). The phase is detected through the
// STATE_isPost variable that the runner exposes from saved state, matching
// the convention used by @actions/core, so no external dependency is
// required.

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Append a key/value pair to the runner state file. The runner re-exports
// each saved entry to the post phase as a STATE_<key> environment variable.
// A random heredoc delimiter prevents a value that contains newlines from
// injecting additional state entries. State recording is best effort, so an
// I/O problem here never fails the job.
function saveState(name, value) {
  try {
    const stateFile = process.env.GITHUB_STATE;
    if (!stateFile) {
      return;
    }
    const safe = value == null ? "" : String(value);
    let delimiter;
    do {
      delimiter = `ghadelim_${crypto.randomBytes(12).toString("hex")}`;
    } while (safe.includes(delimiter));
    fs.appendFileSync(stateFile, `${name}<<${delimiter}\n${safe}\n${delimiter}\n`);
    // aislop-ignore-next-line ai-slop/swallowed-exception -- state recording is best effort; an I/O failure here must never fail the job
  } catch (error) {
    console.log(`State recording skipped: ${error.message}`);
  }
}

// Overwrite an open descriptor's current contents with random bytes, then
// flush. The size is read from the descriptor (not an earlier lstat) so a
// file replaced or resized between lstat and open is still fully covered.
function overwriteDescriptor(fd) {
  const overwriteSize = fs.fstatSync(fd).size;
  // Overwrite in fixed-size chunks so an unexpectedly large file cannot
  // exhaust memory before the caller's catch can recover.
  const chunkSize = 65536;
  let remaining = overwriteSize;
  while (remaining > 0) {
    const n = remaining < chunkSize ? remaining : chunkSize;
    // writeSync may perform a short write; decrement by the actual count and
    // treat zero progress as a failure rather than looping forever or
    // leaving bytes un-overwritten.
    const written = fs.writeSync(fd, crypto.randomBytes(n), 0, n);
    if (!written) {
      throw new Error("overwrite made no progress (0 bytes written)");
    }
    remaining -= written;
  }
  if (overwriteSize > 0) {
    fs.fsyncSync(fd);
  }
}

// Best-effort overwrite of a regular file's contents before deletion. Opens
// with O_NOFOLLOW so a symlink swapped in after lstat cannot redirect the
// overwrite to another target. Throws on failure; the caller still unlinks.
function overwriteFileContents(file) {
  const noFollow = fs.constants.O_NOFOLLOW;
  if (!noFollow) {
    // Without O_NOFOLLOW the open could follow a symlink swapped in after
    // lstat; skip the overwrite and rely on unlink alone.
    console.log("O_NOFOLLOW unsupported; skipping overwrite, will unlink.");
    return;
  }
  const fd = fs.openSync(file, fs.constants.O_RDWR | noFollow);
  try {
    overwriteDescriptor(fd);
  } finally {
    // Always close, even if the overwrite throws, so unlink can remove the
    // file on platforms that refuse to unlink an open descriptor.
    fs.closeSync(fd);
  }
}

// Overwrite (best effort) and delete the .npmrc. On ephemeral runners the
// workspace is discarded anyway; the overwrite hardens the self-hosted case
// where the filesystem persists between jobs. The path is inspected with
// lstat and opened with O_NOFOLLOW so a symlink swapped in between the main
// and post phases cannot redirect the overwrite to another target. Cleanup
// never throws, so a failure here cannot fail the job.
function scrub(file) {
  try {
    if (!file) {
      console.log("No .npmrc path recorded; nothing to scrub.");
      return;
    }
    let info;
    try {
      info = fs.lstatSync(file);
    } catch (statError) {
      console.log(`.npmrc not found; nothing to scrub: ${file}`);
      return;
    }
    if (info.isSymbolicLink()) {
      // Remove the link itself without following it to its target.
      fs.unlinkSync(file);
      console.log(`Removed .npmrc symlink without following it: ${file}`);
      return;
    }
    if (!info.isFile()) {
      console.log(`.npmrc is not a regular file; skipping: ${file}`);
      return;
    }
    try {
      overwriteFileContents(file);
      // aislop-ignore-next-line ai-slop/swallowed-exception -- overwrite is best-effort hardening; the file is still unlinked below
    } catch (overwriteError) {
      console.log(`Overwrite skipped: ${overwriteError.message}`);
    }
    fs.unlinkSync(file);
    console.log(`Securely removed .npmrc: ${file}`);
  } catch (error) {
    console.log(`Cleanup error (ignored): ${error.message}`);
  }
}

// Accept a recorded .npmrc path only when it is an absolute path free of
// newline characters. The composite action always emits such a path; this
// guard keeps an unexpected value from registering deletion of a stray file.
// An invalid path is skipped (recorded as empty) rather than failing the job.
function safeNpmrcPath(value) {
  if (!value) {
    return "";
  }
  if (value.includes("\n") || value.includes("\r")) {
    console.log("Ignoring .npmrc path containing newline characters.");
    return "";
  }
  if (!path.isAbsolute(value)) {
    console.log(`Ignoring non-absolute .npmrc path: ${value}`);
    return "";
  }
  if (path.basename(value) !== ".npmrc") {
    console.log(`Ignoring path whose basename is not .npmrc: ${value}`);
    return "";
  }
  return value;
}

function main() {
  const isPost = process.env.STATE_isPost === "true";
  if (!isPost) {
    // Main phase: record state so the post phase knows what to remove.
    const recordPath = safeNpmrcPath(process.env.INPUT_NPMRC_PATH || "");
    saveState("isPost", "true");
    saveState("npmrcPath", recordPath);
    console.log(`Registered post-job cleanup for: ${recordPath || "(none)"}`);
  } else {
    // Post phase: securely remove the recorded .npmrc. Re-validate the
    // recorded path defensively so an accidental or environment-injected
    // STATE_* value cannot trigger a deletion attempt on a non-.npmrc or
    // newline-bearing path.
    const recordedPath = safeNpmrcPath(process.env.STATE_npmrcPath || "");
    scrub(recordedPath);
  }
}

main();
