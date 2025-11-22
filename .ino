#include <WiFi.h>
#include <WebServer.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Preferences.h>

// ---------------- USER SETTINGS ----------------
const char* ssid     = "vivo T3 5G";
const char* pass     = "shree2378";

const char* mqttHost = "10.169.92.25";
const int   mqttPort = 1883;
const char* mqttUser = "esp32com";
const char* mqttPass = "esp32aug";

const char* deviceId = "esp32-01";

// ---------------- PINS ----------------
#define PIN_SOIL_AO    34
#define PIN_DHT        23
#define PIN_LDR_AO     35
#define PIN_LDR_DO     19
#define RELAY1_PIN     18
#define RELAY2_PIN     5
#define PIN_ALWAYS1    4
#define PIN_ALWAYS2    16
#define LED_PIN        2

// ---------------- DHT ----------------
#define DHTTYPE DHT22
DHT dht(PIN_DHT, DHTTYPE);

// ---------------- NETWORK / MQTT / WEB ----------------
WiFiClient espClient;
PubSubClient client(espClient);
WebServer server(80);

// ---------------- PERSIST (calibration) ----------------
Preferences prefs;

// ADC attenuation shim
#if defined(ADC_ATTEN_DB_11)
  #define ATTEN_11DB ADC_ATTEN_DB_11
#elif defined(ADC_11db)
  #define ATTEN_11DB ADC_11db
#else
  #define ATTEN_11DB (adc_attenuation_t)3
#endif

// ---------------- SAMPLING / TIMING ----------------
static const uint8_t SOIL_SAMPLES = 5;
static const uint8_t LDR_SAMPLES  = 5;
static const unsigned long TELEMETRY_INTERVAL = 5000UL; // 5s

// ---------------- CALIBRATION (defaults) ----------------
struct Calib {
  int soilDry   = 2550; // ADC when soil is very dry
  int soilWet   = 930;  // ADC when soil is wet
  int ldrDark   = 4095; // ADC when dark
  int ldrBright = 0;    // ADC when bright
  bool invertLdrDigital = false;
  bool relayActiveLow   = true;  // typical relay module: active LOW
  bool ledActiveLow     = false; // board LED polarity
} cfg;

// ---------------- STATE ----------------
unsigned long lastTelemetryMs = 0;
bool relay1State = false;
bool relay2State = false;
bool ledState = false;             // LED local state (web / morse)
bool mqttConnectedFlag = false;
unsigned long mqttLastAttempt = 0;
unsigned long mqttRetryMs = 3000;
const unsigned long mqttRetryMax = 15000;

// ---------------- MQTT TOPICS ----------------
const char* T_TELEM   = "esp32/telemetry";
const char* T_R1      = "esp32/relay1";
const char* T_R2      = "esp32/relay2";
const char* T_CMD     = "esp32/cmd";
const char* T_CFG     = "esp32/cfg";
const char* T_CFG_SET = "esp32/cfg/set";

// ---------------- MORSE (G = --.) ----------------
const unsigned long MORSE_UNIT = 200UL;
const unsigned long morsePattern[] = {
  3*MORSE_UNIT, MORSE_UNIT,
  3*MORSE_UNIT, MORSE_UNIT,
  1*MORSE_UNIT, 3*MORSE_UNIT
};
const size_t MORSE_LEN = sizeof(morsePattern) / sizeof(morsePattern[0]);
bool morseRunning = false;
size_t morsePos = 0;
unsigned long morseNext = 0;
bool morsePrevLed = false;

// ---------------- HELPERS ----------------
int clampInt(int v, int lo, int hi){ if (v < lo) return lo; if (v > hi) return hi; return v; }

int readMedianADC(int pin, uint8_t samples){
  int vals[11];
  samples = samples > 11 ? 11 : samples;
  for (uint8_t i = 0; i < samples; ++i) {
    vals[i] = analogRead(pin);
    delay(4); // small delay to let ADC settle between reads
  }
  // simple insertion sort, small arrays
  for (uint8_t i = 1; i < samples; ++i) {
    int key = vals[i];
    int j = i - 1;
    while (j >= 0 && vals[j] > key) { vals[j + 1] = vals[j]; j--; }
    vals[j + 1] = key;
  }
  return vals[samples / 2];
}

int mapToPercent(int raw, int lowRef, int highRef) {
  if (lowRef == highRef) return 0;
  int lo = lowRef, hi = highRef;
  if (lo > hi) { int t = lo; lo = hi; hi = t; }
  int v = clampInt(raw, lo, hi);
  // integer arithmetic to save float ops
  int pct = ((v - lo) * 100) / (hi - lo);
  if (lowRef > highRef) pct = 100 - pct;
  return clampInt(pct, 0, 100);
}

inline void applyRelayOutputs() {
  int onLevel  = cfg.relayActiveLow ? LOW : HIGH;
  int offLevel = cfg.relayActiveLow ? HIGH : LOW;
  digitalWrite(RELAY1_PIN, relay1State ? onLevel : offLevel);
  digitalWrite(RELAY2_PIN, relay2State ? onLevel : offLevel);
}

inline void applyLedOutput() {
  int onLevel  = cfg.ledActiveLow ? LOW : HIGH;
  int offLevel = cfg.ledActiveLow ? HIGH : LOW;
  digitalWrite(LED_PIN, ledState ? onLevel : offLevel);
}

// ---------------- PERSIST ----------------
void saveCalibration() {
  prefs.begin("calib", false);
  prefs.putInt("soilDry",   cfg.soilDry);
  prefs.putInt("soilWet",   cfg.soilWet);
  prefs.putInt("ldrDark",   cfg.ldrDark);
  prefs.putInt("ldrBright", cfg.ldrBright);
  prefs.putBool("invLdrD",  cfg.invertLdrDigital);
  prefs.putBool("relInv",   cfg.relayActiveLow);
  prefs.putBool("ledInv",   cfg.ledActiveLow);
  prefs.end();
}

void loadCalibration() {
  prefs.begin("calib", true);
  cfg.soilDry          = prefs.getInt("soilDry",   cfg.soilDry);
  cfg.soilWet          = prefs.getInt("soilWet",   cfg.soilWet);
  cfg.ldrDark          = prefs.getInt("ldrDark",   cfg.ldrDark);
  cfg.ldrBright        = prefs.getInt("ldrBright", cfg.ldrBright);
  cfg.invertLdrDigital = prefs.getBool("invLdrD",  cfg.invertLdrDigital);
  cfg.relayActiveLow   = prefs.getBool("relInv",   cfg.relayActiveLow);
  cfg.ledActiveLow     = prefs.getBool("ledInv",   cfg.ledActiveLow);
  prefs.end();
}

void publishCalibration() {
  if (!client.connected()) return;
  StaticJsonDocument<192> d;
  d["soilDry"] = cfg.soilDry;
  d["soilWet"] = cfg.soilWet;
  d["ldrDark"] = cfg.ldrDark;
  d["ldrBright"] = cfg.ldrBright;
  d["invLdrD"] = cfg.invertLdrDigital;
  d["relayInv"] = cfg.relayActiveLow;
  d["ledInv"] = cfg.ledActiveLow;
  String out;
  serializeJson(d, out);
  client.publish(T_CFG, out.c_str());
}

// ---------------- MQTT: control relays only ----------------
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  // small stack buffer — topics are known and payloads short
  char msg[16] = {0};
  if (length >= sizeof(msg)) length = sizeof(msg) - 1;
  memcpy(msg, payload, length);
  msg[length] = '\0';

  // Respect only relay topics and cmd for calibration/morse; do NOT change LED via MQTT
  if (strcmp(topic, T_R1) == 0) {
    relay1State = (strcmp(msg, "ON") == 0 || strcmp(msg, "1") == 0);
    applyRelayOutputs();
  } else if (strcmp(topic, T_R2) == 0) {
    relay2State = (strcmp(msg, "ON") == 0 || strcmp(msg, "1") == 0);
    applyRelayOutputs();
  } else if (strcmp(topic, T_CMD) == 0) {
    // Allow a few safe commands over MQTT (calibration & morse) if you want
    if (strcmp(msg, "soil_dry") == 0) cfg.soilDry = readMedianADC(PIN_SOIL_AO, SOIL_SAMPLES);
    else if (strcmp(msg, "soil_wet") == 0) cfg.soilWet = readMedianADC(PIN_SOIL_AO, SOIL_SAMPLES);
    else if (strcmp(msg, "ldr_dark") == 0) cfg.ldrDark = readMedianADC(PIN_LDR_AO, LDR_SAMPLES);
    else if (strcmp(msg, "ldr_bright") == 0) cfg.ldrBright = readMedianADC(PIN_LDR_AO, LDR_SAMPLES);
    else if (strcmp(msg, "save_cfg") == 0) saveCalibration();
    else if (strcmp(msg, "load_cfg") == 0) { loadCalibration(); applyRelayOutputs(); applyLedOutput(); }
    else if (strcmp(msg, "morse_g") == 0) {
      if (!morseRunning) {
        morseRunning = true;
        morsePos = 0;
        morsePrevLed = ledState;
        ledState = true;
        applyLedOutput();
        morseNext = millis() + morsePattern[0];
      }
    }
    publishCalibration();
  } else if (strcmp(topic, T_CFG_SET) == 0) {
    StaticJsonDocument<256> doc;
    DeserializationError err = deserializeJson(doc, msg);
    if (err == DeserializationError::Ok) {
      if (doc.containsKey("soilDry")) cfg.soilDry = doc["soilDry"].as<int>();
      if (doc.containsKey("soilWet")) cfg.soilWet = doc["soilWet"].as<int>();
      if (doc.containsKey("ldrDark")) cfg.ldrDark = doc["ldrDark"].as<int>();
      if (doc.containsKey("ldrBright")) cfg.ldrBright = doc["ldrBright"].as<int>();
      if (doc.containsKey("invLdrD")) cfg.invertLdrDigital = doc["invLdrD"].as<bool>();
      if (doc.containsKey("relayInv")) cfg.relayActiveLow = doc["relayInv"].as<bool>();
      if (doc.containsKey("ledInv")) cfg.ledActiveLow = doc["ledInv"].as<bool>();
      applyRelayOutputs(); applyLedOutput(); saveCalibration(); publishCalibration();
    }
  }
}

// Non-blocking reconnect — web UI unaffected while reconnecting
void mqttReconnectNonBlocking(){
  if (client.connected()) {
    mqttConnectedFlag = true;
    return;
  }
  mqttConnectedFlag = false;
  unsigned long now = millis();
  if (now - mqttLastAttempt < mqttRetryMs) return;
  mqttLastAttempt = now;

  Serial.printf("[MQTT] connect %s:%d ... ", mqttHost, mqttPort);
  client.setServer(mqttHost, mqttPort);
  client.setCallback(mqttCallback);
  if (client.connect(deviceId, mqttUser, mqttPass)) {
    Serial.println("OK");
    client.subscribe(T_R1);
    client.subscribe(T_R2);
    client.subscribe(T_CMD);
    client.subscribe(T_CFG_SET);
    publishCalibration();
    mqttRetryMs = 3000;
    mqttConnectedFlag = true;
  } else {
    Serial.printf("FAIL (state=%d)\n", client.state());
    mqttRetryMs = min(mqttRetryMs + 2000, mqttRetryMax);
  }
}

// ---------------- WEB UI (single page, minimal) ----------------
const char INDEX_HTML[] PROGMEM = R"HTML(
<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>AgriVerse360</title>
<style>:root{--g:#11d373;--bg:#0f1417;--card:#171e23;--txt:#f2fff7;--mut:#a7c8b2;--line:#263039}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font-family:system-ui,Arial}.wrap{max-width:900px;margin:0 auto;padding:24px}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}h1{font-size:28px;margin:0;color:var(--g);cursor:pointer}.badge{padding:8px 12px;border-radius:999px;font-weight:700;border:1px solid var(--line)}.ok{background:#0f2e1e;color:#9ff0c6}.bad{background:#2e1713;color:#f0b0a6}.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}.kv{display:flex;justify-content:space-between;padding:10px 0;font-size:20px;border-bottom:1px dashed rgba(255,255,255,.03)}.kv:last-child{border-bottom:0}.mut{color:var(--mut);font-size:14px}.toggle{display:flex;justify-content:space-between;align-items:center;padding:12px;border-radius:10px;border:1px solid var(--line);background:#0f161a;font-size:18px;font-weight:800;cursor:pointer;user-select:none}.toggle.on{background:linear-gradient(180deg,var(--g),#0cbc6b);color:#042612;border-color:#165938}</style></head><body>
<div class=wrap>
<header>
<h1 id=title>AgriVerse360</h1>
<div id=status class="badge bad">OFFLINE</div>
</header>
<div class=grid>
<div class=card>
<div class=kv><div class=mut>Temperature</div><div id=t>--</div></div>
<div class=kv><div class=mut>Humidity</div><div id=h>--</div></div>
<div class=kv><div class=mut>Soil moisture</div><div id=soil>--%</div></div>
<div class=kv><div class=mut>LDR</div><div id=ldr>--%</div></div>
</div>
<div class=card>
<div id=r1 class=toggle>Relay 1: <span id=r1s>OFF</span></div>
<div style=height:10px></div>
<div id=r2 class=toggle>Relay 2: <span id=r2s>OFF</span></div>
</div>
</div>
</div>
<script>let state={r1:0,r2:0};const pattern=[600,200,600,200,200,600];async function fetchJSON(url){const res=await fetch(url,{cache:'no-cache'});if(!res.ok)throw 0;return res.json();}
async function postJSON(url,body){try{await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}catch(e){}}
function setText(id,v){const e=document.getElementById(id);if(e)e.textContent=v;}
function setBadge(on){const b=document.getElementById('status');b.textContent=on?'ONLINE':'OFFLINE';b.className='badge '+(on?'ok':'bad');}
function paintRelays(){const r1=document.getElementById('r1'),r1s=document.getElementById('r1s'),r2=document.getElementById('r2'),r2s=document.getElementById('r2s');if(r1){r1.className='toggle'+(state.r1?' on':'');if(r1s)r1s.textContent=state.r1?'ON':'OFF';}
if(r2){r2.className='toggle'+(state.r2?' on':'');if(r2s)r2s.textContent=state.r2?'ON':'OFF';}}
async function refresh(){try{const d=await fetchJSON('/api/telemetry');setText('t',d.temperature??'--');setText('h',d.humidity??'--');setText('soil',(d.soilPct!==undefined)?(d.soilPct+'%'):'--');setText('ldr',(d.ldrPct!==undefined)?(d.ldrPct+'%'):'--');state.r1=d.relay1?1:0;state.r2=d.relay2?1:0;paintRelays();setBadge(!!d.mqtt);}catch(e){setBadge(false);}}
setInterval(refresh,2000);refresh();document.getElementById('r1').onclick=async()=>{state.r1=state.r1?0:1;paintRelays();postJSON('/api/relay',{ch:1,state:state.r1?'ON':'OFF'});};document.getElementById('r2').onclick=async()=>{state.r2=state.r2?0:1;paintRelays();postJSON('/api/relay',{ch:2,state:state.r2?'ON':'OFF'});};document.getElementById('title').addEventListener('click',()=>{postJSON('/api/cmd',{name:'morse_g'});const t=document.getElementById('title');let i=0;(function step(){const on=(i%2===0);t.style.opacity=on?'1':'0.5';const delay=pattern[i++];if(i<pattern.length)setTimeout(step,delay);else t.style.opacity='1';})();});</script>
</body></html>
)HTML";

// ---------------- HTTP handlers ----------------
void httpRoot() { server.send_P(200, "text/html; charset=utf-8", INDEX_HTML); }

void httpGetTelemetry(){
  StaticJsonDocument<256> doc;
  // re-use last DHT read (we read in telemetry publish) - but to keep web fast we will read sensors on demand but cheaply
  float temp = dht.readTemperature();
  float hum = dht.readHumidity();
  int soilRaw = readMedianADC(PIN_SOIL_AO, SOIL_SAMPLES);
  int ldrRaw  = readMedianADC(PIN_LDR_AO, LDR_SAMPLES);
  doc["deviceId"] = deviceId;
  if (isnan(temp)) doc["temperature"] = nullptr; else doc["temperature"] = temp;
  if (isnan(hum))  doc["humidity"] = nullptr;    else doc["humidity"] = hum;
  doc["soilPct"] = mapToPercent(soilRaw, cfg.soilDry, cfg.soilWet);
  doc["ldrPct"]  = mapToPercent(ldrRaw,  cfg.ldrDark, cfg.ldrBright);
  doc["relay1"]  = relay1State ? 1 : 0;
  doc["relay2"]  = relay2State ? 1 : 0;
  doc["mqtt"]    = mqttConnectedFlag ? 1 : 0;
  String out;
  serializeJson(doc, out);
  server.send(200, "application/json", out);
}

void httpPostRelay(){
  StaticJsonDocument<128> d;
  DeserializationError err = deserializeJson(d, server.arg("plain"));
  if (err) { server.send(400, "application/json", "{\"error\":\"bad json\"}"); return; }
  int ch = d["ch"] | 0;
  String state = d["state"] | "";
  bool on = (state == "ON" || state == "1");
  if (ch == 1) relay1State = on;
  else if (ch == 2) relay2State = on;
  else { server.send(400, "application/json", "{\"error\":\"bad channel\"}"); return; }
  applyRelayOutputs();
  server.send(200, "application/json", "{\"ok\":true}");
}

void httpPostCmd(){
  StaticJsonDocument<128> d;
  DeserializationError err = deserializeJson(d, server.arg("plain"));
  if (err) { server.send(400, "application/json", "{\"error\":\"bad json\"}"); return; }
  String name = d["name"] | "";
  if (name.length() == 0) { server.send(400, "application/json", "{\"error\":\"missing name\"}"); return; }

  if (name == "soil_dry") cfg.soilDry = readMedianADC(PIN_SOIL_AO, SOIL_SAMPLES);
  else if (name == "soil_wet") cfg.soilWet = readMedianADC(PIN_SOIL_AO, SOIL_SAMPLES);
  else if (name == "ldr_dark") cfg.ldrDark = readMedianADC(PIN_LDR_AO, LDR_SAMPLES);
  else if (name == "ldr_bright") cfg.ldrBright = readMedianADC(PIN_LDR_AO, LDR_SAMPLES);
  else if (name == "save_cfg") saveCalibration();
  else if (name == "load_cfg") { loadCalibration(); applyRelayOutputs(); applyLedOutput(); }
  else if (name == "reset_cfg") { prefs.begin("calib", false); prefs.clear(); prefs.end(); }
  else if (name == "morse_g") {
    if (!morseRunning) {
      morseRunning = true; morsePos = 0; morsePrevLed = ledState; ledState = true; applyLedOutput();
      morseNext = millis() + morsePattern[0];
    }
  }
  publishCalibration();
  server.send(200, "application/json", "{\"ok\":true}");
}

void httpGetCfg(){
  StaticJsonDocument<256> d;
  d["soilDry"] = cfg.soilDry; d["soilWet"] = cfg.soilWet;
  d["ldrDark"] = cfg.ldrDark; d["ldrBright"] = cfg.ldrBright;
  d["invLdrD"] = cfg.invertLdrDigital; d["relayInv"] = cfg.relayActiveLow; d["ledInv"] = cfg.ledActiveLow;
  String out; serializeJson(d, out);
  server.send(200, "application/json", out);
}

void webSetup(){
  server.on("/", HTTP_GET, httpRoot);
  server.on("/api/telemetry", HTTP_GET,  httpGetTelemetry);
  server.on("/api/relay",     HTTP_POST, httpPostRelay);
  server.on("/api/cmd",       HTTP_POST, httpPostCmd);
  server.on("/api/cfg",       HTTP_GET,  httpGetCfg);
  server.onNotFound([](){ server.send(404, "application/json", "{\"error\":\"not found\"}"); });
  server.begin();
  Serial.println("[HTTP] server started on :80");
}

// ---------------- SETUP / LOOP ----------------
void setup(){
  Serial.begin(115200);

  pinMode(RELAY1_PIN, OUTPUT); pinMode(RELAY2_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(PIN_ALWAYS1, OUTPUT); pinMode(PIN_ALWAYS2, OUTPUT);
  pinMode(PIN_LDR_DO, INPUT);
  digitalWrite(PIN_ALWAYS1, HIGH); digitalWrite(PIN_ALWAYS2, HIGH);

  relay1State = false; relay2State = false; ledState = false; mqttConnectedFlag = false;

  // ADC
  analogSetPinAttenuation(PIN_SOIL_AO, ATTEN_11DB);
  analogSetPinAttenuation(PIN_LDR_AO,  ATTEN_11DB);
  analogReadResolution(12);

  // calibration
  loadCalibration();
  applyRelayOutputs();
  applyLedOutput();

  // network
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, pass);
  Serial.print("WiFi connecting");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(200);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("WiFi IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("WiFi connect failed (will keep trying in background).");
  }

  // MQTT & web
  client.setServer(mqttHost, mqttPort);
  client.setCallback(mqttCallback);
  webSetup();

  dht.begin();
  lastTelemetryMs = millis();
  Serial.println("=== AgriVerse360 started ===");
}

void loop(){
  // Web server — highest priority (quick non-blocking)
  server.handleClient();

  // Morse (non-blocking)
  if (morseRunning && millis() >= morseNext) {
    morsePos++;
    if (morsePos >= MORSE_LEN) {
      morseRunning = false;
      ledState = morsePrevLed;
      applyLedOutput();
    } else {
      bool on = (morsePos % 2 == 0);
      ledState = on;
      applyLedOutput();
      morseNext = millis() + morsePattern[morsePos];
    }
  }

  // MQTT recon (non-blocking) and loop if connected
  mqttReconnectNonBlocking();
  if (client.connected()) {
    client.loop();
  }

  // Publish telemetry every 5s
  unsigned long now = millis();
  if (now - lastTelemetryMs >= TELEMETRY_INTERVAL) {
    lastTelemetryMs = now;
    float temp = dht.readTemperature();
    float hum  = dht.readHumidity();
    int soilRaw = readMedianADC(PIN_SOIL_AO, SOIL_SAMPLES);
    int ldrRaw  = readMedianADC(PIN_LDR_AO,  LDR_SAMPLES);
    int soilPct = mapToPercent(soilRaw, cfg.soilDry, cfg.soilWet); // orientation: low->high handled in map
    int ldrPct  = mapToPercent(ldrRaw, cfg.ldrDark, cfg.ldrBright);

    StaticJsonDocument<384> doc;
    doc["deviceId"] = deviceId;
    if (isnan(temp)) doc["temperature"] = nullptr; else doc["temperature"] = temp;
    if (isnan(hum))  doc["humidity"] = nullptr;    else doc["humidity"] = hum;
    doc["soilPct"] = soilPct;
    doc["ldrPct"]  = ldrPct;
    doc["relay1"]  = relay1State ? 1 : 0;
    doc["relay2"]  = relay2State ? 1 : 0;
    doc["mqtt"]    = mqttConnectedFlag ? 1 : 0;

    String out;
    serializeJson(doc, out);
    if (client.connected()) {
      client.publish(T_TELEM, out.c_str());
      Serial.print("[PUB] "); Serial.println(out);
    } else {
      Serial.print("[PUB SKIP] "); Serial.println(out);
    }
  }

  // be cooperative with the system
  yield();
}
