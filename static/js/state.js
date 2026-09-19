/* ── State ─────────────────────────────────────────────────────────────── */
let state = {
  types: new Set(),
  authModes: new Set(),
  authOnlyContains: false,  // true = exclusive (only networks with exactly selected modes), false = inclusive (networks including selected modes)
  chMin: 0, chMax: 196,
  rssiMin: -120, rssiMax: -10,
  dateFrom: null, dateTo: null,
  accMax: 200,
  freqMin: 0, freqMax: 6000,
  q: '',
  advSQL: '',
  sort: 'first_seen', sortDir: 'desc',
  limit: 500, offset: 0,
  mapStyle: 'osm',
  markerSize: 5, opacMin: 0.25,
  heat: false, cluster: true,
  mapLimit: false,  // limit the device table to the current map viewport
};
let currentRows = [];
let totalCount = 0;
let metaInfo = null;
let channelTouched = false;  // only send channel bounds when the user actually moved them
let accTouched = false;      // only send acc/freq bounds once the user constrains them
let freqTouched = false;     // (defaults 200 / 0–6000 cover the full range; NULL-valued rows would otherwise vanish)
let selectedId = null;
const markerById = new Map();
let map, markersLayer, heatLayer, tileLayer;
let hoverPopup; /* single shared popup for marker hover */
let allTypes = [], allAuths = [];
let loadedFiles = []; // List of uploaded files with metadata
let activeFileIds = new Set(); // File IDs currently selected for browsing (empty = all)