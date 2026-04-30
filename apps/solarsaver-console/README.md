# SolarSaver AI Console

Local operations UI for managing SolarSaver edge devices, Zigbee loads, ToU policy, OTA rollout, and security posture.

## Run

```powershell
node apps\solarsaver-console\src\server.js --host 127.0.0.1 --port 49220
```

Open:

```text
http://127.0.0.1:49220
```

## Test

```powershell
node apps\solarsaver-console\scripts\smoke-test.js
```

## UI Surface

- Animated Three.js rooftop energy map.
- Live firmware telemetry in the edge JSON shape.
- Zigbee load manager with Auto, Hold, and Off modes.
- ToU policy controls for cheap hours, solar threshold, reserve, and outage guard.
- Firmware, OTA, Matter readiness, and HMAC MQTTS status.
- Forecast and event panels tuned for Jaipur/Pune rooftop solar operations.
