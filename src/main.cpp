#include <stdint.h>
#include <stddef.h>
#include <math.h>
#include <string.h>
#include <stdio.h>

struct RuntimeConfig {
  uint8_t cheapStart;
  uint8_t cheapEnd;
  float solarThresholdW;
  char wifiSsid[64];
  char wifiPass[96];
};

struct EnergySample {
  float loadW;
  float solarW;
  float loadWhDelta;
  float solarWhDelta;
  uint32_t ts;
};

struct DeviceDecision {
  bool shiftLoad;
  uint8_t devicesOn;
  float solarEstimate;
  const char *action;
};

/** Returns true when hour is inside a ToU cheap window, end-exclusive. */
bool isCheapHour(uint8_t hour, uint8_t start, uint8_t end) {
  if (hour > 23 || start > 23 || end > 23) return false;
  if (start == end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

/** Converts a centered ACS712 ADC sample into signed instantaneous amps. */
float computeAcsInstantCurrent(uint16_t adc, float adcRefV, uint16_t adcMax, float zeroV, float sensitivityVPerA) {
  if (adcMax == 0 || sensitivityVPerA == 0.0f) return 0.0f;
  const float volts = ((float)adc * adcRefV) / (float)adcMax;
  return (volts - zeroV) / sensitivityVPerA;
}

/** Converts an ACS712 ADC sample into absolute instantaneous amps. */
float computeAcsCurrentFromAdc(uint16_t adc, float adcRefV, uint16_t adcMax, float zeroV, float sensitivityVPerA) {
  const float amps = computeAcsInstantCurrent(adc, adcRefV, adcMax, zeroV, sensitivityVPerA);
  return amps < 0.0f ? -amps : amps;
}

/** Integrates watts over elapsed seconds into watt-hours. */
float integrateWh(float watts, uint32_t seconds) {
  return (watts * (float)seconds) / 3600.0f;
}

/** Computes the one-hour moving average for solar Wh deltas. */
float solarMovingAverageWh(const EnergySample *history, size_t count) {
  if (history == nullptr || count == 0) return 0.0f;
  double sum = 0.0;
  for (size_t i = 0; i < count; ++i) sum += history[i].solarWhDelta;
  return (float)(sum / (double)count);
}

/** Estimates near-term solar availability from the current sample and one-hour history. */
float forecastSolarProbability(const EnergySample *history, size_t count, float currentSolarW, float currentSolarWh, float thresholdW) {
  float probability = currentSolarW >= thresholdW ? 0.55f : 0.15f;
  const float avgWh = solarMovingAverageWh(history, count);
  if (count < 6) {
    probability += currentSolarW >= thresholdW ? 0.25f : 0.0f;
  } else if (avgWh <= 0.001f) {
    probability += currentSolarW >= thresholdW ? 0.35f : 0.0f;
  } else if (currentSolarWh > avgWh * 1.2f) {
    probability += 0.35f;
  }
  if (currentSolarW > thresholdW * 1.5f) probability += 0.1f;
  if (probability < 0.0f) return 0.0f;
  if (probability > 0.98f) return 0.98f;
  return probability;
}

/** Decides whether deferrable loads should run now. */
DeviceDecision decideLoadShift(const EnergySample *history, size_t count, float loadW, float solarW, float solarWhDelta, const RuntimeConfig &config, uint8_t hour, uint8_t maxDevices) {
  const float solarEst = forecastSolarProbability(history, count, solarW, solarWhDelta, config.solarThresholdW);
  const bool cheap = isCheapHour(hour, config.cheapStart, config.cheapEnd);
  const bool surplus = solarW > loadW && solarW >= config.solarThresholdW;
  const bool risingSolar = count < 6 || solarWhDelta > solarMovingAverageWh(history, count) * 1.2f;
  DeviceDecision decision;
  decision.shiftLoad = cheap && surplus && risingSolar && solarEst >= 0.65f;
  const float spareW = solarW > loadW ? solarW - loadW : 0.0f;
  uint8_t computedDevices = (uint8_t)(spareW / 150.0f);
  if (computedDevices == 0 && decision.shiftLoad) computedDevices = 1;
  if (computedDevices > maxDevices) computedDevices = maxDevices;
  decision.devicesOn = decision.shiftLoad ? computedDevices : 0;
  decision.solarEstimate = solarEst;
  decision.action = decision.shiftLoad ? "shift_load" : "idle";
  return decision;
}

/** Formats the only host-visible telemetry shape emitted by the firmware. */
int formatTelemetryJson(char *out, size_t len, uint32_t ts, float powerW, float voltageV, float solarEst, const char *action, uint8_t devicesOn) {
  if (out == nullptr || len == 0 || action == nullptr) return -1;
  return snprintf(out, len, "{\"ts\":%lu,\"p\":%.0f,\"v\":%.0f,\"solar_est\":%.2f,\"action\":\"%s\",\"devices_on\":%u}",
                  (unsigned long)ts, powerW, voltageV, solarEst, action, (unsigned)devicesOn);
}

#ifndef UNIT_TEST

#include <Arduino.h>
#include <ArduinoJson.h>
#include <FS.h>
#include <HTTPClient.h>
#include <PubSubClient.h>
#include <SPIFFS.h>
#include <Update.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_idf_version.h>
#include <esp_task_wdt.h>
#include <mbedtls/md.h>
#include <time.h>

#if __has_include(<ACS712.h>)
#include <ACS712.h>
#endif

#if defined(SOLARSAVER_MATTER_READY) && __has_include(<Matter.h>)
#include <Matter.h>
#define SOLARSAVER_HAS_MATTER 1
#else
#define SOLARSAVER_HAS_MATTER 0
#endif

#ifndef SOLARSAVER_MAX_DEVICES
#define SOLARSAVER_MAX_DEVICES 10
#endif

static constexpr int PIN_ACS712 = 34;
static constexpr int PIN_VOLTAGE = 35;
static constexpr int PIN_ZERO_CROSS = 27;
static constexpr int PIN_LED = 2;
static constexpr int ZIGBEE_RX = 16;
static constexpr int ZIGBEE_TX = 17;
static constexpr uint32_t SAMPLE_PERIOD_MS = 10000;
static constexpr uint32_t OTA_PERIOD_MS = 3600000;
static constexpr uint16_t MQTT_PORT = 8883;
static constexpr char MQTT_BROKER[] = "solarsaver.cloud";
static constexpr char CONFIG_PATH[] = "/config.json";
static constexpr float ADC_REF_V = 3.3f;
static constexpr uint16_t ADC_MAX = 4095;
static constexpr float ACS_ZERO_V = 1.65f;
static constexpr float ACS_SENSITIVITY_V_PER_A = 0.1221f;
static constexpr float VOLTAGE_ZERO_V = 1.65f;
static constexpr float VOLTAGE_SCALE = 690.0f;
static constexpr float POWER_FACTOR = 0.95f;

static const char TLS_ROOT_CA[] PROGMEM = R"EOF(-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)EOF";

struct PowerSample {
  float voltageV;
  float currentA;
  float powerW;
  float solarW;
  float loadWhDelta;
  float solarWhDelta;
  uint32_t ts;
};

struct ZigbeeCommand {
  uint8_t devicesOn;
};

struct TelemetryFrame {
  uint32_t ts;
  float powerW;
  float voltageV;
  float solarEst;
  char action[16];
  uint8_t devicesOn;
};

struct HourAggregate {
  double powerSum;
  double voltageSum;
  double solarSum;
  uint32_t count;
  uint32_t startTs;
  uint8_t devicesOn;
  char action[16];
};

static RuntimeConfig g_config = {22, 6, 500.0f, "", ""};
static PowerSample g_latestSample = {};
static EnergySample g_history[360] = {};
static size_t g_historyCount = 0;
static size_t g_historyHead = 0;
static QueueHandle_t g_zigbeeQueue = nullptr;
static QueueHandle_t g_telemetryQueue = nullptr;
static SemaphoreHandle_t g_sampleMutex = nullptr;
static SemaphoreHandle_t g_configMutex = nullptr;
static portMUX_TYPE g_solarMux = portMUX_INITIALIZER_UNLOCKED;
static volatile float g_solarPowerW = 0.0f;
static volatile bool g_safeMode = false;
static WiFiClientSecure g_tlsClient;
static PubSubClient g_mqtt(g_tlsClient);
static HardwareSerial g_zigbee(2);

/** Enters LED-only safe mode when persistent storage or task creation fails. */
void enterSafeMode() {
  g_safeMode = true;
  WiFi.disconnect(true);
}

/** Returns a Unix timestamp when NTP is ready, else uptime seconds. */
uint32_t nowUnix() {
  const time_t now = time(nullptr);
  if (now > 1600000000) return (uint32_t)now;
  return millis() / 1000UL;
}

/** Returns the current local hour in Asia/Kolkata. */
uint8_t currentLocalHour() {
  time_t now = time(nullptr);
  if (now <= 1600000000) return (uint8_t)((millis() / 3600000UL) % 24UL);
  struct tm localTime;
  localtime_r(&now, &localTime);
  return (uint8_t)localTime.tm_hour;
}

/** Returns the lowercase ESP32 MAC without separators. */
String macId() {
  uint64_t mac = ESP.getEfuseMac();
  char buf[13];
  snprintf(buf, sizeof(buf), "%04x%08x", (uint16_t)(mac >> 32), (uint32_t)mac);
  return String(buf);
}

/** Derives a per-device HMAC key from eFuse MAC and firmware pepper. */
void deriveDeviceKey(uint8_t key[32]) {
  const char pepper[] = "SolarSaverAI-IN-MVP-v1";
  uint64_t mac = ESP.getEfuseMac();
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  const mbedtls_md_info_t *info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  mbedtls_md_setup(&ctx, info, 0);
  mbedtls_md_starts(&ctx);
  mbedtls_md_update(&ctx, (const unsigned char *)pepper, strlen(pepper));
  mbedtls_md_update(&ctx, (const unsigned char *)&mac, sizeof(mac));
  mbedtls_md_finish(&ctx, key);
  mbedtls_md_free(&ctx);
}

/** Converts bytes to lowercase hex. */
String hexOf(const uint8_t *bytes, size_t len) {
  static const char hex[] = "0123456789abcdef";
  String out;
  out.reserve(len * 2);
  for (size_t i = 0; i < len; ++i) {
    out += hex[(bytes[i] >> 4) & 0x0f];
    out += hex[bytes[i] & 0x0f];
  }
  return out;
}

/** Computes HMAC-SHA256 over a String message. */
String hmacSha256Hex(const String &message) {
  uint8_t key[32];
  uint8_t mac[32];
  deriveDeviceKey(key);
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  const mbedtls_md_info_t *info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  mbedtls_md_setup(&ctx, info, 1);
  mbedtls_md_hmac_starts(&ctx, key, sizeof(key));
  mbedtls_md_hmac_update(&ctx, (const unsigned char *)message.c_str(), message.length());
  mbedtls_md_hmac_finish(&ctx, mac);
  mbedtls_md_free(&ctx);
  return hexOf(mac, sizeof(mac));
}

/** Compares fixed-size hex strings without early exit. */
bool secureHexEquals(const String &a, const String &b) {
  if (a.length() != b.length()) return false;
  uint8_t diff = 0;
  for (size_t i = 0; i < a.length(); ++i) diff |= (uint8_t)(a[i] ^ b[i]);
  return diff == 0;
}

/** Saves the default SPIFFS config. */
bool saveDefaultConfig() {
  StaticJsonDocument<256> doc;
  JsonArray tou = doc["tou_cheap"].to<JsonArray>();
  tou.add(22);
  tou.add(6);
  doc["solar_thresh"] = 500;
  doc["wifi_ssid"] = "";
  doc["wifi_pass"] = "";
  File file = SPIFFS.open(CONFIG_PATH, FILE_WRITE);
  if (!file) return false;
  serializeJson(doc, file);
  file.close();
  return true;
}

/** Loads runtime configuration from SPIFFS JSON. */
bool loadConfig() {
  RuntimeConfig loaded = {22, 6, 500.0f, "", ""};
  if (!SPIFFS.exists(CONFIG_PATH)) saveDefaultConfig();
  File file = SPIFFS.open(CONFIG_PATH, FILE_READ);
  if (!file) return false;
  StaticJsonDocument<384> doc;
  DeserializationError err = deserializeJson(doc, file);
  file.close();
  if (err) return false;
  JsonArray tou = doc["tou_cheap"].as<JsonArray>();
  if (tou.size() >= 2) {
    loaded.cheapStart = (uint8_t)tou[0].as<int>();
    loaded.cheapEnd = (uint8_t)tou[1].as<int>();
  }
  loaded.solarThresholdW = doc["solar_thresh"] | 500.0f;
  strlcpy(loaded.wifiSsid, doc["wifi_ssid"] | "", sizeof(loaded.wifiSsid));
  strlcpy(loaded.wifiPass, doc["wifi_pass"] | "", sizeof(loaded.wifiPass));
  if (loaded.cheapStart > 23 || loaded.cheapEnd > 23 || loaded.solarThresholdW < 0.0f) return false;
  xSemaphoreTake(g_configMutex, portMAX_DELAY);
  g_config = loaded;
  xSemaphoreGive(g_configMutex);
  return true;
}

/** Reads the last inverter solar estimate from the Zigbee proxy cache. */
float getSolarPowerW() {
  portENTER_CRITICAL(&g_solarMux);
  float value = g_solarPowerW;
  portEXIT_CRITICAL(&g_solarMux);
  return value;
}

/** Updates the inverter solar estimate received from the Zigbee proxy. */
void setSolarPowerW(float value) {
  if (value < 0.0f || value > 20000.0f) return;
  portENTER_CRITICAL(&g_solarMux);
  g_solarPowerW = value;
  portEXIT_CRITICAL(&g_solarMux);
}

/** Reads an AC RMS current window from ACS712 on GPIO34. */
float readCurrentRmsA() {
  double sumSq = 0.0;
  constexpr uint16_t samples = 96;
  for (uint16_t i = 0; i < samples; ++i) {
    const uint16_t adc = analogRead(PIN_ACS712);
    const float amps = computeAcsInstantCurrent(adc, ADC_REF_V, ADC_MAX, ACS_ZERO_V, ACS_SENSITIVITY_V_PER_A);
    sumSq += (double)amps * (double)amps;
    delayMicroseconds(850);
  }
  const float rms = sqrt(sumSq / (double)samples);
  return rms < 0.03f ? 0.0f : rms;
}

/** Reads an isolated transformer RMS voltage window from GPIO35. */
float readVoltageRmsV() {
  double sumSq = 0.0;
  constexpr uint16_t samples = 96;
  for (uint16_t i = 0; i < samples; ++i) {
    const float volts = ((float)analogRead(PIN_VOLTAGE) * ADC_REF_V) / (float)ADC_MAX;
    const float centered = volts - VOLTAGE_ZERO_V;
    sumSq += (double)centered * (double)centered;
    delayMicroseconds(850);
  }
  const float mains = sqrt(sumSq / (double)samples) * VOLTAGE_SCALE;
  return mains < 80.0f ? 0.0f : mains;
}

/** Appends one sample to the one-hour circular history. */
void appendHistory(const PowerSample &sample) {
  EnergySample entry;
  entry.loadW = sample.powerW;
  entry.solarW = sample.solarW;
  entry.loadWhDelta = sample.loadWhDelta;
  entry.solarWhDelta = sample.solarWhDelta;
  entry.ts = sample.ts;
  g_history[g_historyHead] = entry;
  g_historyHead = (g_historyHead + 1) % (sizeof(g_history) / sizeof(g_history[0]));
  if (g_historyCount < sizeof(g_history) / sizeof(g_history[0])) ++g_historyCount;
}

/** Copies circular history into chronological scratch storage. */
size_t copyHistory(EnergySample *out, size_t maxCount) {
  const size_t count = g_historyCount < maxCount ? g_historyCount : maxCount;
  const size_t cap = sizeof(g_history) / sizeof(g_history[0]);
  for (size_t i = 0; i < count; ++i) {
    const size_t idx = (g_historyHead + cap - count + i) % cap;
    out[i] = g_history[idx];
  }
  return count;
}

/** Parses a Zigbee proxy line for inverter solar power. */
void parseZigbeeLine(const String &line) {
  StaticJsonDocument<384> doc;
  if (deserializeJson(doc, line)) return;
  if (doc["solar_w"].is<float>() || doc["solar_w"].is<int>()) {
    setSolarPowerW(doc["solar_w"].as<float>());
    return;
  }
  JsonObject zb = doc["ZbReceived"].as<JsonObject>();
  if (zb.isNull()) return;
  for (JsonPair kv : zb) {
    JsonVariant v = kv.value();
    if (v["solar_w"].is<float>() || v["solar_w"].is<int>()) {
      setSolarPowerW(v["solar_w"].as<float>());
      return;
    }
    if (v["Power"].is<float>() || v["Power"].is<int>()) {
      setSolarPowerW(v["Power"].as<float>());
      return;
    }
  }
}

/** Sends a Tasmota Zigbee coordinator command for one plug. */
void zigbeeSetPlug(uint8_t plug, bool on) {
  if (plug == 0 || plug > SOLARSAVER_MAX_DEVICES) return;
  g_zigbee.printf("ZbSend {\"Device\":\"plug%u\",\"Send\":{\"Power\":%u}}\n", plug, on ? 1 : 0);
}

/** Ensures WiFi STA is connected when credentials are provisioned. */
bool ensureWifi() {
  RuntimeConfig cfg;
  xSemaphoreTake(g_configMutex, portMAX_DELAY);
  cfg = g_config;
  xSemaphoreGive(g_configMutex);
  if (cfg.wifiSsid[0] == '\0') return false;
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(true);
  WiFi.begin(cfg.wifiSsid, cfg.wifiPass);
  const uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 12000) {
    delay(100);
    esp_task_wdt_reset();
  }
  if (WiFi.status() == WL_CONNECTED) {
    configTime(19800, 0, "pool.ntp.org", "time.google.com");
    return true;
  }
  WiFi.disconnect(false);
  return false;
}

/** Connects to MQTT using HMAC credentials. */
bool ensureMqtt() {
  if (!ensureWifi()) return false;
  if (g_mqtt.connected()) return true;
  g_tlsClient.setCACert(TLS_ROOT_CA);
  g_mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  g_mqtt.setBufferSize(384);
  const String client = "ss-" + macId();
  const String ts = String(nowUnix());
  const String username = macId() + ":" + ts;
  const String password = hmacSha256Hex(client + ":" + ts);
  return g_mqtt.connect(client.c_str(), username.c_str(), password.c_str());
}

/** Publishes the current hourly aggregate. */
void publishAggregate(HourAggregate &agg) {
  if (agg.count == 0 || !ensureMqtt()) return;
  char payload[160];
  const float avgP = (float)(agg.powerSum / (double)agg.count);
  const float avgV = (float)(agg.voltageSum / (double)agg.count);
  const float avgSolar = (float)(agg.solarSum / (double)agg.count);
  formatTelemetryJson(payload, sizeof(payload), agg.startTs, avgP, avgV, avgSolar, agg.action, agg.devicesOn);
  const String topic = "/device/" + macId() + "/data";
  g_mqtt.publish(topic.c_str(), payload, false);
  agg = {};
}

/** Downloads and installs a signed HTTP OTA binary when available. */
void checkHttpOta() {
  if (!ensureWifi()) return;
  HTTPClient http;
  const String url = String("http://") + MQTT_BROKER + "/ota/" + macId() + ".bin";
  const char *headers[] = {"x-solarsaver-signature"};
  http.begin(url);
  http.collectHeaders(headers, 1);
  const int code = http.GET();
  if (code != HTTP_CODE_OK) {
    http.end();
    return;
  }
  const String expected = http.header("x-solarsaver-signature");
  if (expected.length() != 64) {
    http.end();
    return;
  }
  int remaining = http.getSize();
  if (!Update.begin(remaining > 0 ? remaining : UPDATE_SIZE_UNKNOWN)) {
    http.end();
    return;
  }
  uint8_t key[32];
  uint8_t mac[32];
  deriveDeviceKey(key);
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  const mbedtls_md_info_t *info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  mbedtls_md_setup(&ctx, info, 1);
  mbedtls_md_hmac_starts(&ctx, key, sizeof(key));
  WiFiClient *stream = http.getStreamPtr();
  uint8_t buf[512];
  const uint32_t deadline = millis() + 30000UL;
  while (http.connected() && millis() < deadline && (remaining > 0 || remaining == -1)) {
    const size_t avail = stream->available();
    if (avail == 0) {
      delay(5);
      esp_task_wdt_reset();
      continue;
    }
    const int readLen = stream->readBytes(buf, avail > sizeof(buf) ? sizeof(buf) : avail);
    if (readLen <= 0) break;
    mbedtls_md_hmac_update(&ctx, buf, readLen);
    if (Update.write(buf, readLen) != (size_t)readLen) break;
    if (remaining > 0) remaining -= readLen;
  }
  mbedtls_md_hmac_finish(&ctx, mac);
  mbedtls_md_free(&ctx);
  const bool ok = secureHexEquals(hexOf(mac, sizeof(mac)), expected) && Update.end(true);
  if (!ok) Update.abort();
  http.end();
  if (ok) ESP.restart();
}

/** Task1: samples voltage, current, power, and energy every 10 seconds. */
void sensorTask(void *) {
  esp_task_wdt_add(nullptr);
  TickType_t wake = xTaskGetTickCount();
  uint32_t lastTs = nowUnix();
  for (;;) {
    const uint32_t ts = nowUnix();
    const uint32_t dt = ts > lastTs ? ts - lastTs : 10;
    lastTs = ts;
    const float voltage = readVoltageRmsV();
    const float current = readCurrentRmsA();
    const float power = voltage * current * POWER_FACTOR;
    const float solar = getSolarPowerW();
    PowerSample sample;
    sample.voltageV = voltage;
    sample.currentA = current;
    sample.powerW = power;
    sample.solarW = solar;
    sample.loadWhDelta = integrateWh(power, dt);
    sample.solarWhDelta = integrateWh(solar, dt);
    sample.ts = ts;
    xSemaphoreTake(g_sampleMutex, portMAX_DELAY);
    g_latestSample = sample;
    xSemaphoreGive(g_sampleMutex);
    esp_task_wdt_reset();
    vTaskDelayUntil(&wake, pdMS_TO_TICKS(SAMPLE_PERIOD_MS));
  }
}

/** Task2: runs local forecast logic and emits JSON telemetry. */
void logicTask(void *) {
  esp_task_wdt_add(nullptr);
  TickType_t wake = xTaskGetTickCount();
  for (;;) {
    PowerSample sample;
    xSemaphoreTake(g_sampleMutex, portMAX_DELAY);
    sample = g_latestSample;
    xSemaphoreGive(g_sampleMutex);
    EnergySample hist[360];
    const size_t histCount = copyHistory(hist, 360);
    RuntimeConfig cfg;
    xSemaphoreTake(g_configMutex, portMAX_DELAY);
    cfg = g_config;
    xSemaphoreGive(g_configMutex);
    const DeviceDecision decision = decideLoadShift(hist, histCount, sample.powerW, sample.solarW, sample.solarWhDelta, cfg, currentLocalHour(), SOLARSAVER_MAX_DEVICES);
    appendHistory(sample);
    ZigbeeCommand cmd;
    cmd.devicesOn = decision.devicesOn;
    xQueueOverwrite(g_zigbeeQueue, &cmd);
    TelemetryFrame frame;
    frame.ts = sample.ts;
    frame.powerW = sample.powerW;
    frame.voltageV = sample.voltageV;
    frame.solarEst = decision.solarEstimate;
    frame.devicesOn = decision.devicesOn;
    strlcpy(frame.action, decision.action, sizeof(frame.action));
    xQueueSend(g_telemetryQueue, &frame, 0);
    char json[160];
    formatTelemetryJson(json, sizeof(json), frame.ts, frame.powerW, frame.voltageV, frame.solarEst, frame.action, frame.devicesOn);
    Serial.println(json);
    esp_task_wdt_reset();
    vTaskDelayUntil(&wake, pdMS_TO_TICKS(SAMPLE_PERIOD_MS));
  }
}

/** Task3: controls Zigbee plugs and ingests inverter proxy lines. */
void zigbeeTask(void *) {
  esp_task_wdt_add(nullptr);
  ZigbeeCommand last = {0};
  String line;
  for (;;) {
    while (g_zigbee.available()) {
      const char c = (char)g_zigbee.read();
      if (c == '\n') {
        parseZigbeeLine(line);
        line = "";
      } else if (line.length() < 320 && c != '\r') {
        line += c;
      }
    }
    ZigbeeCommand next;
    if (xQueueReceive(g_zigbeeQueue, &next, pdMS_TO_TICKS(100)) == pdTRUE) {
      if (next.devicesOn != last.devicesOn) {
        for (uint8_t i = 1; i <= SOLARSAVER_MAX_DEVICES; ++i) zigbeeSetPlug(i, i <= next.devicesOn);
        last = next;
      }
    }
    esp_task_wdt_reset();
  }
}

/** Task4: maintains WiFi, MQTT, hourly aggregate publishing, and signed HTTP OTA. */
void wifiMqttTask(void *) {
  esp_task_wdt_add(nullptr);
  HourAggregate agg = {};
  uint32_t lastOta = 0;
  for (;;) {
    if (ensureMqtt()) g_mqtt.loop();
    TelemetryFrame frame;
    while (xQueueReceive(g_telemetryQueue, &frame, 0) == pdTRUE) {
      if (agg.count == 0) {
        agg.startTs = frame.ts;
        strlcpy(agg.action, frame.action, sizeof(agg.action));
      }
      agg.powerSum += frame.powerW;
      agg.voltageSum += frame.voltageV;
      agg.solarSum += frame.solarEst;
      agg.devicesOn = frame.devicesOn;
      strlcpy(agg.action, frame.action, sizeof(agg.action));
      ++agg.count;
      if (agg.count >= 360 || frame.ts - agg.startTs >= 3600) publishAggregate(agg);
    }
    if (millis() - lastOta > OTA_PERIOD_MS) {
      lastOta = millis();
      checkHttpOta();
      loadConfig();
    }
    esp_task_wdt_reset();
    vTaskDelay(pdMS_TO_TICKS(250));
  }
}

/** Blinks the status LED in safe mode. */
void safeBlinkTask(void *) {
  pinMode(PIN_LED, OUTPUT);
  for (;;) {
    digitalWrite(PIN_LED, !digitalRead(PIN_LED));
    vTaskDelay(pdMS_TO_TICKS(250));
  }
}

/** Initializes optional Matter-ready integration boundary. */
void initMatterReady() {
#if SOLARSAVER_HAS_MATTER
  Matter.begin();
#endif
}

void setupWatchdog() {
#if ESP_IDF_VERSION_MAJOR >= 5
  esp_task_wdt_config_t cfg = {};
  cfg.timeout_ms = 15000;
  cfg.idle_core_mask = (1 << portNUM_PROCESSORS) - 1;
  cfg.trigger_panic = true;
  esp_task_wdt_init(&cfg);
#else
  esp_task_wdt_init(15, true);
#endif
}

void setup() {
  Serial.begin(115200);
  setCpuFrequencyMhz(80);
  setenv("TZ", "IST-5:30", 1);
  tzset();
  setupWatchdog();
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_ZERO_CROSS, INPUT_PULLUP);
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_ACS712, ADC_11db);
  analogSetPinAttenuation(PIN_VOLTAGE, ADC_11db);
  g_sampleMutex = xSemaphoreCreateMutex();
  g_configMutex = xSemaphoreCreateMutex();
  g_zigbeeQueue = xQueueCreate(1, sizeof(ZigbeeCommand));
  g_telemetryQueue = xQueueCreate(8, sizeof(TelemetryFrame));
  if (!g_sampleMutex || !g_configMutex || !g_zigbeeQueue || !g_telemetryQueue) enterSafeMode();
  if (!SPIFFS.begin(true)) enterSafeMode();
  if (!g_safeMode) loadConfig();
  g_zigbee.begin(115200, SERIAL_8N1, ZIGBEE_RX, ZIGBEE_TX);
  initMatterReady();
  if (g_safeMode) {
    xTaskCreatePinnedToCore(safeBlinkTask, "safe", 2048, nullptr, 2, nullptr, 1);
    return;
  }
  xTaskCreatePinnedToCore(sensorTask, "sensor", 4096, nullptr, 4, nullptr, 1);
  xTaskCreatePinnedToCore(logicTask, "logic", 4096, nullptr, 3, nullptr, 1);
  xTaskCreatePinnedToCore(zigbeeTask, "zigbee", 4096, nullptr, 3, nullptr, 0);
  xTaskCreatePinnedToCore(wifiMqttTask, "net", 8192, nullptr, 2, nullptr, 0);
}

void loop() {
  if (g_safeMode) {
    delay(1000);
    return;
  }
  esp_task_wdt_reset();
  delay(1000);
}

#endif
