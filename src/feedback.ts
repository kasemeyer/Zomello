import { recentProblems } from "./logs";
import { isRemote } from "./remote";
import { isServer } from "./server";
import { deviceWord, inTauri, isMobileApp, openExternal } from "./storage";

const CONTACT = "kasey.prichard@gmail.com";

/** Which TCI Boards this is, in plain words ("the Android app", "the Windows app", "a browser on an iPad"…). */
function whichZomello(): string {
  const ua = navigator.userAgent;
  const system = /Android/i.test(ua)
    ? "Android"
    : /iPhone/i.test(ua)
      ? "iPhone"
      : /iPad/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
        ? "iPad"
        : /Windows/i.test(ua)
          ? "Windows"
          : /Macintosh/i.test(ua)
            ? "Mac"
            : /Linux/i.test(ua)
              ? "Linux"
              : "an unknown system";
  const where = isServer ? ", on a TCI Boards server" : isRemote ? ", using a computer's boards" : "";
  if (isMobileApp || inTauri) return `the ${system} app${where}`;
  return `a browser on ${system}${where}`;
}

/** Help > Send feedback: an email to us with the version, device and recent problems already filled in. */
export async function sendFeedback(): Promise<void> {
  const subject = `TCI Boards feedback (${__APP_VERSION__})`;
  // The last few problems from this device's log, if any (a mail link can't carry much more).
  let problems = await recentProblems(8);
  while (problems.join("\n").length > 1200) problems = problems.slice(1);
  const body = [
    "What happened, or what would you like?",
    "",
    "",
    "Steps, if something went wrong:",
    "1. ",
    "",
    "---",
    `TCI Boards ${__APP_VERSION__}, ${whichZomello()} (this ${deviceWord}).`,
    ...(problems.length ? ["", "Recent problems from this device's log:", ...problems] : []),
  ].join("\n");
  void openExternal(`mailto:${CONTACT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
}
