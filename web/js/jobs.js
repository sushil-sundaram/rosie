import { api } from "./api.js";

const waiters = new Map();
const activeKinds = new Set();

export function isJobPending(kind) {
  return activeKinds.has(kind);
}

export function notifyJobEvent(msg) {
  if (!msg || !msg.job_id) return;
  const w = waiters.get(msg.job_id);
  if (w) w.checkNow();
}

export async function waitForJob(jobId, kind) {
  if (kind) activeKinds.add(kind);
  return new Promise((resolve, reject) => {
    let settled = false;
    let pollTimer = null;

    const cleanup = () => {
      clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", onVisible);
      waiters.delete(jobId);
      if (kind) activeKinds.delete(kind);
    };

    const checkNow = async () => {
      if (settled) return;
      try {
        const job = await api(`/jobs/${encodeURIComponent(jobId)}`);
        if (!job || settled) return;
        if (job.status === "done") {
          settled = true;
          cleanup();
          resolve(job.result);
        } else if (job.status === "error") {
          settled = true;
          cleanup();
          reject(new Error(job.error || "Local AI scan failed"));
        }
      } catch (err) {
        if (settled) return;
        // Stop only on permanent 401/404; transient network drops recover when visible/SSE reconnects.
        if (/^(HTTP 404|Scan job not found|Sign in required)/.test(err.message)) {
          settled = true;
          cleanup();
          reject(err);
        }
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") checkNow();
    };

    waiters.set(jobId, { checkNow });
    document.addEventListener("visibilitychange", onVisible);
    pollTimer = setInterval(checkNow, 2500);
  });
}

/**
 * Posts to an AI endpoint. Returns immediately for synchronous 200 results
 * (e.g. structured recipe URLs) or waits for 202 background jobs via SSE/poll.
 */
export async function submitAiJob(path, body, kindHint) {
  const out = await api(path, { method: "POST", body });
  if (out && out.job_id && out.status === "pending") {
    return waitForJob(out.job_id, out.kind || kindHint);
  }
  return out;
}
