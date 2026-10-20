/**
 * Finding, and stopping, a clinic that is already running.
 *
 * Shared by the tidy-up script and the Windows launchers, because "I replaced
 * the files and nothing changed" is almost always a server that was still up:
 * Node reads its code once, at startup.
 *
 * Nothing here shells out to a tool that only exists on one operating system.
 * The server tells us its own process id over the loopback address, so the
 * same two functions work on a Mac, on Windows and on a Linux box.
 */
const PORT = () => Number(process.env.PORT || 4000);

/** What is answering on the port, or null if nothing is. */
export async function whatIsRunning(port = PORT(), timeoutMs = 1500) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return { version: body.version || null, pid: body.pid || null };
  } catch {
    return null;
  }
}

/** Waits for the clinic to come up; returns its version, or null if it never does. */
export async function waitForHealth(port = PORT(), seconds = 20) {
  for (let attempt = 0; attempt < seconds; attempt += 1) {
    const running = await whatIsRunning(port);
    if (running) return running.version;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return null;
}

/**
 * Stops the clinic on this port and waits for the port to actually free up.
 *
 * Returns what was stopped, or null if nothing was running. A server that
 * ignores the polite signal gets a firm one after three seconds — otherwise
 * the copy about to be started would fail to bind and look broken.
 */
export async function stopRunning(port = PORT()) {
  const running = await whatIsRunning(port);
  if (!running || !running.pid) return null;

  try { process.kill(running.pid); } catch { return null; }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (!(await whatIsRunning(port, 400))) return running;
    if (attempt === 9) {
      try { process.kill(running.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  return running;
}

// Also usable straight from a .cmd file, where writing this in batch would be
// far worse than calling it:  node scripts/running.js stop
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const command = process.argv[2] || 'status';
  if (command === 'stop') {
    const stopped = await stopRunning();
    console.log(stopped ? `Stopped the clinic (version ${stopped.version}).`
      : 'Nothing was running.');
  } else if (command === 'wait') {
    const version = await waitForHealth(PORT(), Number(process.argv[3] || 20));
    if (version) console.log(`The clinic is up, version ${version}.`);
    else console.log('The clinic did not answer.');
    process.exit(version ? 0 : 1);
  } else {
    const running = await whatIsRunning();
    console.log(running ? `Running, version ${running.version}.` : 'Not running.');
    process.exit(running ? 0 : 1);
  }
}
