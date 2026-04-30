# SolarSaver AI Workspace

This workspace contains the SolarSaver AI ESP32 edge firmware and a local management console for operating the rooftop solar optimizer MVP.

## UI Console

Run the local management UI:

```powershell
node apps\solarsaver-console\src\server.js --host 127.0.0.1 --port 49220
```

Open:

```text
http://127.0.0.1:49220
```

The console includes an animated 3D rooftop energy map, Zigbee load controls, ToU policy controls, edge telemetry JSON, OTA rollout status, HMAC MQTTS status, Matter readiness, forecasts, and operations events.

Run its smoke test and browser verification:

```powershell
cd apps\solarsaver-console
npm run smoke-test
npm run verify-ui
```

## Edge Firmware

Week 1-2 MVP firmware for an ESP32-WROOM-32 rooftop solar optimizer node. It samples isolated voltage and ACS712 current every 10 seconds, estimates surplus solar from a Zigbee inverter proxy, shifts up to 10 Zigbee loads locally, publishes hourly MQTT JSON when WiFi is available, and accepts signed HTTP OTA firmware.

## Pinout

```text
ESP32-WROOM-32 DevKit

          +-----------------------------+
      5V  | VIN                     3V3 |  Zigbee VCC if 3.3V module
     GND  | GND                     GND |  Common low-voltage ground
  ACS OUT | GPIO34 ADC1_CH6      GPIO17 |  UART2 TX -> Zigbee RX
  VT OUT  | GPIO35 ADC1_CH7      GPIO16 |  UART2 RX <- Zigbee TX
 ZC OUT   | GPIO27              GPIO2  |  Status LED
          +-----------------------------+

Mains 220V AC -> isolated 9V/12V transformer -> burden/divider -> GPIO35
Load live wire -> ACS712 isolated current path -> scaled OUT -> GPIO34
Zigbee 3.0 coordinator UART -> GPIO16/GPIO17 at 115200 baud
```

## Wiring

Use only isolated low-voltage signals on the ESP32. The ACS712 current path can carry AC load current, but its output to GPIO34 must be divided/biased to the ESP32 ADC range with a 1.65V midpoint. The voltage sensor must come from an isolated transformer, not from direct mains. The optional zero-cross optocoupler output goes to GPIO27 with pull-up enabled.

The Zigbee coordinator uses a Tasmota-compatible serial command surface. The firmware sends commands like:

```text
ZbSend {"Device":"plug1","Send":{"Power":1}}
```

The Growatt/Sungrow inverter Modbus proxy can publish a serial JSON line:

```json
{"solar_w":734}
```

## Files

- [platformio.ini](C:/Users/ashis/OneDrive/Documents/New%20project/platformio.ini): ESP32 and native Unity test environments.
- [src/main.cpp](C:/Users/ashis/OneDrive/Documents/New%20project/src/main.cpp): FreeRTOS firmware.
- [data/config.json](C:/Users/ashis/OneDrive/Documents/New%20project/data/config.json): SPIFFS runtime config.
- [test/test_cases.cpp](C:/Users/ashis/OneDrive/Documents/New%20project/test/test_cases.cpp): Unity tests for sensor math and forecast logic.

## Flash

Install PlatformIO Core, connect the ESP32 over USB, then run:

```powershell
pio run -e esp32dev
pio run -e esp32dev -t uploadfs
pio run -e esp32dev -t upload
pio device monitor -b 115200
```

Provision WiFi by editing [data/config.json](C:/Users/ashis/OneDrive/Documents/New%20project/data/config.json), then re-run `uploadfs`. Keep production credentials out of source control and use a per-device generated config artifact for field kits.

## Serial Output

The host serial output is telemetry JSON only:

```json
{"ts":1777535400,"p":234,"v":220,"solar_est":0.80,"action":"shift_load","devices_on":3}
{"ts":1777535410,"p":189,"v":221,"solar_est":0.15,"action":"idle","devices_on":0}
```

MQTT publishes hourly aggregates to:

```text
/device/{mac}/data
```

The MQTT client uses MQTTS on port 8883 with HMAC-SHA256 credentials derived per device. HTTP OTA firmware is accepted only when the `x-solarsaver-signature` header matches the firmware HMAC.

The firmware includes a guarded Matter boundary. When built with an Arduino-ESP32 core that ships Espressif Matter support, `Matter.begin()` is enabled automatically; otherwise the UART Zigbee coordinator remains the MVP control plane.

## Test

Run native unit tests:

```powershell
pio test -e native
```

Optional embedded build check:

```powershell
pio run -e esp32dev
```

## Calibration

The MVP constants in [src/main.cpp](C:/Users/ashis/OneDrive/Documents/New%20project/src/main.cpp) assume:

- ACS712 5A module scaled from 5V output to ESP32 ADC range.
- ADC midpoint at 1.65V.
- `ACS_SENSITIVITY_V_PER_A = 0.1221`.
- `VOLTAGE_SCALE = 690.0` for the isolated transformer divider.

Calibrate with a known 100W incandescent or resistive load and a true-RMS meter before switching inductive loads.
