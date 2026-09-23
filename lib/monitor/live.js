'use strict';
/*
  Live provider for the monitor page: reads real data from the M-Carbon Dashboard.

  It reuses lib/dashboard.js for the login and requests, because that code is the part
  already proven against the real API (mobile + password login, `token` header, appType 1002).

  Mapped so far (from responses the billing app already relies on, plus tools/probe-monitor.js):
    listProjects()          <- the province > city > district > project walk
    history(id, week|month) <- statisticsBigScreen.powerDetail (kWh per day)
    listMeters(id)          <- getMeterList (keyed by projectId, not familyId — translated below)
    readNow(id)             <- getMeterInfo per meter (voltage x current; see readNow for why)
    overview()              <- bigScreenAgent/statistics (some totals still unmapped — see buildOverview)

  Not mapped yet:
    history(id, day)        <- hourly figures for today
    getBreakerPowerUsed     <- returns all zeros for every body shape tried so far except
                                breakerId, which hasn't been tried yet — worth another probe

  To finish them, run `node tools/probe-monitor.js` and send back the files it writes to
  probe-output/. Each todo() below names the call it needs.
*/

const dashboard = require('../dashboard');

const todo = (what) => { throw new Error(`Not mapped yet: ${what}. Run tools/probe-monitor.js to capture it.`); };
const r2 = (n) => Number(Number(n).toFixed(2));

// Philippine time (UTC+8, no daylight saving) so "today" matches what the site shows.
const manilaDate = (offsetDays = 0) =>
  new Date(Date.now() + 8 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);

// Walking four levels of the project tree is slow, so keep the result for a few minutes.
let projectCache = { at: 0, rows: null };
async function projects() {
  if (!projectCache.rows || Date.now() - projectCache.at > 10 * 60e3) {
    const rows = await dashboard.listProjects();
    projectCache = { at: Date.now(), rows };
  }
  return projectCache.rows;
}

// listMeters/readNow are keyed by the dashboard's numeric projectId, but this module
// (and the rest of the app) addresses a site by familyId, so translate on the way in.
async function projectIdFor(familyId) {
  const rows = await projects();
  const row = rows.find((p) => String(p.family_id) === String(familyId));
  if (!row) throw new Error(`Unknown site ${familyId}`);
  return row.project_id;
}

// getMeterList and getMeterInfo results per site, kept briefly so a poll every couple of
// seconds isn't re-fetching the meter list on every tick.
let meterCache = new Map(); // familyId -> { at, meters: [{accessoryId, name, category, on}] }

// Confirmed against two real meters: DENR's offline meter reported isOnline: 2, Marco
// Polo's online one reported isOnline: 1. So 1 = online, 2 = (presumably) offline.
const meterIsOn = (m) => Number(m.isOnline) === 1;

async function fetchMeters(familyId) {
  const projectId = await projectIdFor(familyId);
  const data = await dashboard.call('/api/iotphp/agent/getMeterList', { projectId });
  const meters = (data.lists || []).map((m) => ({
    accessoryId: m.accessoryId,
    name: m.name || `Meter ${m.accessoryId}`,
    category: m.category,
    on: meterIsOn(m),
  }));
  meterCache.set(String(familyId), { at: Date.now(), meters });
  return meters;
}

async function cachedMeters(familyId) {
  const hit = meterCache.get(String(familyId));
  if (hit && Date.now() - hit.at < 60e3) return hit.meters;
  return fetchMeters(familyId);
}

const CO2_KG_PER_KWH = Number(process.env.CO2_KG_PER_KWH) || 0.785;

// The dashboard's own overview call gives district/city, not lat/lon, so sites are pinned
// by city here rather than individually. Coordinates for Quezon City, Pasig and Makati are
// copied from lib/monitor/mock.js (already used elsewhere in this app); Cainta is a
// town-centre approximation and hasn't been checked against the dashboard's own map.
const CITY_COORDS = {
  'Quezon City': [14.6760, 121.0437],
  'Pasig': [14.5764, 121.0851],
  'Makati': [14.5547, 121.0244],
  'Cainta': [14.5787, 121.1223],
};

let overviewCache = { at: 0, data: null };

async function buildOverview() {
  const s = await dashboard.call('/api/iotphp/bigScreenAgent/statistics', {});
  const rank = s.projectRank || [];

  // Verified: these rows and their powerSave figures come straight off the dashboard's own
  // ranking table, one row per district (a district can group more than one project — e.g.
  // three sites all show up under one "San Antonio" row).
  const savedKwh = r2(rank.reduce((sum, r) => sum + (Number(r.powerSave) || 0), 0));
  const areas = rank.map((r) => ({
    area: `${r.district}, ${r.city}`,
    savedKwh: r2(Number(r.powerSave) || 0),
    projects: r.projectCount || 0,
  }));
  const projects = rank.map((r, i) => {
    const coord = CITY_COORDS[r.city] || null;
    return {
      id: `district-${r.districtId ?? i}`,
      name: `${r.district}${r.projectCount > 1 ? ` (${r.projectCount} sites)` : ''}`,
      city: r.city, area: r.provice || r.city, region: r.provice || '',
      lat: coord ? coord[0] : 12.8797, // falls back to the country's centroid if the city isn't in the table above
      lon: coord ? coord[1] : 121.7740,
      savedKwh: r2(Number(r.powerSave) || 0),
      todaySavedKwh: 0,
    };
  });

  // UNVERIFIED: neither of these two blocks says whether it's summed across every site or
  // just showing one project. Treated as all-sites for now — confirm against known totals
  // before trusting the numbers on a report.
  const today = (s.weekPowerSave || [])[((s.weekPowerSave || []).length || 1) - 1] || {};
  const todayBefore = Number(today.beforePower) || 0;
  const todayAfter = Number(today.afterPower) || 0;
  const todaySavedKwh = r2(Math.max(0, todayBefore - todayAfter));
  const todaySavingRate = todayBefore > 0 ? r2((todaySavedKwh / todayBefore) * 100) : 0;

  const now = Date.now();
  const hourly = (s.latest24?.powerList || []).map((h, i, arr) =>
    ({ t: now - (arr.length - 1 - i) * 3600e3, kwh: Number(h.powerUsed) || 0 }));

  const prePost = (s.weekPowerSave || []).map((r) => ({
    t: new Date(r.record_date + 'T00:00:00+08:00').getTime(),
    before: Number(r.beforePower) || 0,
    after: Number(r.afterPower) || 0,
  }));

  return {
    generatedAt: now,
    totals: {
      savedKwh,
      // Not sourced from any probed endpoint yet — no call returns an all-sites before/after
      // total to compute a lifetime rate from, so this stays 0 rather than a guess.
      savingRate: 0,
      todaySavedKwh, todaySavingRate,
      co2Kg: r2(savedKwh * CO2_KG_PER_KWH), // estimated from the app's own emission factor, not read from the dashboard
      todayCo2Kg: r2(todaySavedKwh * CO2_KG_PER_KWH),
      projects: s.projectStatus?.totalProject || rank.reduce((n, r) => n + (r.projectCount || 0), 0),
      meters: 0, // not wired up — would need a getMeterList call per site
    },
    projects, areas, hourly, prePost,
    categories: { lighting: 0, ac: 0, other: 0 }, // not mapped — no probed call breaks savings down this way
  };
}

module.exports = {
  async listProjects() {
    const rows = await projects();
    // The dashboard identifies a site by its familyId; that is what every later call needs.
    return rows
      .filter((p) => p.family_id)
      .map((p) => ({ id: String(p.family_id), name: p.name, location: p.district || "" }));
  },

  async listMeters(pid) {
    const meters = await fetchMeters(pid);
    return meters.map((m) => ({
      id: String(m.accessoryId),
      name: m.name,
      type: m.category === 2 ? 'Lighting' : 'Other', // category codes beyond 2 (lighting) aren't confirmed yet
      online: m.on,
    }));
  },

  async readNow(pid, at = Date.now()) {
    const meters = await cachedMeters(pid);
    const out = [];
    for (const m of meters) {
      if (!m.on) {
        out.push({ meterId: String(m.accessoryId), on: false, kw: 0, volts: 0, ts: at });
        continue;
      }
      // getMeterInfo returns three power-shaped fields — `power`, `powerReal`, and the
      // measured `voltage`/`electricCurrent`. On Marco Polo's online meter, voltage (237V) x
      // current (2.078A) = ~492W, but powerReal reported 719W — real power cannot exceed
      // volts x amps, so powerReal (and by extension `power`) is reporting something other
      // than a live reading, most likely a rated/reference figure. voltage x current is the
      // only field pair here that's a direct instrument reading rather than a computed or
      // labelled one, so that's what's used for the live kW. It may still look flat between
      // polls if the meter itself only reports every few minutes — that would be a hardware
      // reporting-interval fact, not a bug here.
      const info = await dashboard.call('/api/iotphp/agent/getMeterInfo', { accessoryId: m.accessoryId });
      const volts = Number(info.voltage) || 0;
      const amps = Number(info.electricCurrent) || 0;
      out.push({
        meterId: String(m.accessoryId),
        on: meterIsOn(info),
        kw: r2((volts * amps) / 1000),
        volts,
        ts: at,
      });
    }
    return out;
  },

  async history(pid, range) {
    if (range === "day") todo(`hourly figures for today at site ${pid}`);
    const days = range === "week" ? 7 : 30;
    const start = manilaDate(-(days - 1));
    const end = manilaDate(0);
    const stats = await dashboard.getRangeStats(pid, start, end);
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = manilaDate(-i);
      out.push({ t: new Date(date + "T12:00:00+08:00").getTime(), kwh: r2(stats.dailyKwh[date] || 0) });
    }
    return out;
  },

  async overview() {
    if (!overviewCache.data || Date.now() - overviewCache.at > 20e3) {
      overviewCache = { at: Date.now(), data: await buildOverview() };
    }
    return overviewCache.data;
  },
};