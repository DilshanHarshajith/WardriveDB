/* ── Config ─────────────────────────────────────────────────────────────── */
const COLUMNS = ["mac","ssid","auth_mode","first_seen","channel","frequency","rssi","latitude","longitude","altitude","accuracy","type"];
const COL_LABELS = {mac:"MAC", ssid:"SSID", auth_mode:"Auth", first_seen:"First seen", channel:"Ch", frequency:"Freq", rssi:"RSSI", latitude:"Lat", longitude:"Lng", altitude:"Alt", accuracy:"Acc", type:"Type"};
const TYPE_COLORS = {WIFI:"#22c1ff", BLE:"#2dd4bf", BT:"#f59e0b", LTE:"#a78bfa", GSM:"#f43f5e"};

const TILES = {
  osm:  {url:'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', opt:{attribution:'© OpenStreetMap', maxZoom:19}},
  sat:  {url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', opt:{attribution:'© Esri', maxZoom:18}},
};