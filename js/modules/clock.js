import { $ } from "./dom.js";

const digitSegments = {
  "0": ["a", "b", "c", "d", "e", "f"],
  "1": ["b", "c"],
  "2": ["a", "b", "g", "e", "d"],
  "3": ["a", "b", "g", "c", "d"],
  "4": ["f", "g", "b", "c"],
  "5": ["a", "f", "g", "c", "d"],
  "6": ["a", "f", "g", "e", "c", "d"],
  "7": ["a", "b", "c"],
  "8": ["a", "b", "c", "d", "e", "f", "g"],
  "9": ["a", "b", "c", "d", "f", "g"]
};

const segmentPaths = {
  a: "M8 3H32L36 7L32 11H8L4 7Z",
  b: "M33 8L37 12V29L33 33L29 29V12Z",
  c: "M33 35L37 39V56L33 60L29 56V39Z",
  d: "M8 57H32L36 61L32 65H8L4 61Z",
  e: "M7 35L11 39V56L7 60L3 56V39Z",
  f: "M7 8L11 12V29L7 33L3 29V12Z",
  g: "M8 30H32L36 34L32 38H8L4 34Z"
};

function renderDigit(digit) {
  const activeSegments = digitSegments[digit];
  const paths = Object.entries(segmentPaths).map(([name, path]) =>
    `<path class="clock-segment${activeSegments.includes(name) ? " is-on" : ""}" d="${path}"/>`
  ).join("");
  return `<svg class="clock-digit" viewBox="0 0 40 68" aria-hidden="true">${paths}</svg>`;
}

export function renderClock() {
  const now = new Date();
  const timeParts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(now);
  const time = ["hour", "minute", "second"].map(type => timeParts.find(part => part.type === type)?.value || "00");
  const clock = $("liveClock");
  clock.innerHTML = time.map((part, index) =>
    `${index ? '<span class="clock-colon" aria-hidden="true"><i></i><i></i></span>' : ""}${[...part].map(renderDigit).join("")}`
  ).join("");
  clock.setAttribute("aria-label", `Current local time ${time[0]}:${time[1]}:${time[2]}`);
  $("liveDate").textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  }).format(now);
}
