const config = require("./data/delivery-rules.json");

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const settings = config.settings || {};
const messages = config.messages || {};
const rulesCfg = config.rules || {};

// ---- Timezone: us timezone ka abhi ka time (UTC getters se padho) ----
function getZonedNow() {
  const tz = settings.timezone || "Asia/Kolkata";
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
  } catch (e) {
    console.error("Invalid timezone in delivery-rules.json:", tz);
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
  }
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")));
}

// ---- Din jodna (Sunday skip sirf businessDays me) ----
function addDays(start, days, skipSunday) {
  const d = new Date(start.getTime());
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (!(skipSunday && d.getUTCDay() === 0)) added++;
  }
  return d;
}

// ---- Format tokens: YYYY, MMMM, MMM, dddd, ddd, DD, D ----
function formatDate(d, fmt) {
  return String(fmt || "DD MMM").replace(/YYYY|MMMM|MMM|dddd|ddd|DD|D/g, (t) => {
    switch (t) {
      case "YYYY": return String(d.getUTCFullYear());
      case "MMMM": return MONTHS_LONG[d.getUTCMonth()];
      case "MMM": return MONTHS_SHORT[d.getUTCMonth()];
      case "dddd": return DAYS_LONG[d.getUTCDay()];
      case "ddd": return DAYS_SHORT[d.getUTCDay()];
      case "DD": return String(d.getUTCDate()).padStart(2, "0");
      default: return String(d.getUTCDate());
    }
  });
}

function isBlocked(pincode) {
  return (config.blocked || []).some((b) => pincode.startsWith(String(b)));
}

// ---- Priority ke order me rule dhundho ----
function findRule(pincode) {
  const order = rulesCfg.priority || ["blocked", "pincodes", "prefixes", "defaultDays"];
  for (const key of order) {
    if (key === "blocked" && isBlocked(pincode)) return { type: "blocked" };
    if (key === "pincodes" && config.pincodes && config.pincodes[pincode]) {
      const r = config.pincodes[pincode];
      if (r.enabled === false) return { type: "unavailable" };
      return { type: "rule", city: r.city || null, days: r.days };
    }
    if (key === "prefixes" && config.prefixes && config.prefixes[pincode.slice(0, 3)]) {
      const r = config.prefixes[pincode.slice(0, 3)];
      return { type: "rule", city: r.city || null, days: r.days };
    }
    if (key === "defaultDays") {
      return { type: "rule", city: null, days: settings.defaultDays ?? 5 };
    }
  }
  return { type: "unavailable" };
}

const fail = (status, error) => ({ status, body: { ok: false, error } });

// ---- Main function: index.js isi ko call karta hai ----
function checkPincode(raw) {
  const pincode = String(raw || "").trim();
  const len = rulesCfg.pincodeLength || 6;

  if (!new RegExp(`^[1-9][0-9]{${len - 1}}$`).test(pincode)) {
    return fail(400, messages.invalidPincodeMessage || "Invalid pincode.");
  }

  const rule = findRule(pincode);
  if (rule.type === "blocked") return fail(200, messages.blockedPincodeMessage || "Delivery not available.");
  if (rule.type === "unavailable") return fail(200, messages.unavailableMessage || "Delivery unavailable.");

  const now = getZonedNow();
  const skipSunday = rulesCfg.deliveryDaysType !== "calendarDays" && settings.skipSunday !== false;

  let days = rule.days + (settings.handlingDays || 0);
  if (rulesCfg.cutoffBehavior === "nextDay" && now.getUTCHours() >= (settings.cutoffHourIST ?? 14)) {
    days += 1;
  }

  const minSetting = settings.minimumDeliveryDays ?? 1;
  const minDays = settings.allowSameDayDelivery ? minSetting : Math.max(1, minSetting);
  days = Math.max(minDays, days);

  // Max se zyada ho to kam din ka jhootha vaada nahi, delivery unavailable batao
  if (settings.maximumDeliveryDays != null && days > settings.maximumDeliveryDays) {
    return fail(200, messages.unavailableMessage || "Delivery unavailable.");
  }

  const extra = settings.rangeExtraDays ?? 1;
  const fmt = settings.deliveryDateFormat;
  const start = formatDate(addDays(now, days, skipSunday), fmt);
  const end = formatDate(addDays(now, days + extra, skipSunday), fmt);

  let deliveryText;
  if (settings.showDeliveryDate === false) {
    deliveryText = settings.showDeliveryRange
      ? `${days}-${days + extra} days`
      : `${days} ${days === 1 ? "day" : "days"}`;
  } else {
    deliveryText = settings.showDeliveryRange ? `${start} - ${end}` : start;
  }

  return {
    status: 200,
    body: {
      ok: true,
      pincode,
      city: rule.city || messages.defaultCity || null,
      days,
      label: messages.deliveryLabel || "Estimated delivery",
      deliveryText,
    },
  };
}

module.exports = { checkPincode };