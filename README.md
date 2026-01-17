# homebridge-myacurite

Homebridge platform plugin for MyAcurite temperature and humidity sensors.

## Project Status

Active development; core functionality in place; TypeScript migration complete; limited device/sensor support; lightly maintained as time allows; contributions welcome.

## Setup

1) Install dependencies:
```shell
npm install
```

2) Configure the platform in Homebridge. Example:
```json
{
  "platform": "MyAcurite",
  "name": "MyAcurite",
  "email": "you@example.com",
  "password": "your-password",
  "accountId": "123456",
  "refreshIntervalSeconds": 300,
  "batteryLowThreshold": 20,
  "supportedDeviceCodes": ["5in1WS", "2in1T"],
  "supportedSensorCodes": ["Temperature", "Humidity"],
  "nameOverrides": {
    "123456789": "Backyard Temp",
    "AcuRite 5-in-1:Humidity": "Outdoor Humidity"
  }
}
```

`accountId` is optional; the plugin will infer it from `user.account_users[0].account_id` in the login response. Polling uses `refreshIntervalSeconds` and backs off on failures.

## Supported Devices & Sensors

- Devices: `5in1WS`, `2in1T`
- Sensors: `Temperature`, `Humidity`
- Battery level is exposed via the Battery service when available.

## Development Commands

- `npm run build` compiles TypeScript from `src/` to `dist/`.
- `npm run lint` runs a TypeScript type check with no output.
- `npm test` runs the Node.js test suite.
- `npm run watch` runs the TypeScript compiler in watch mode.
