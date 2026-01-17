import axios from 'axios';
import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig
} from 'homebridge';

const SUPPORTED_DEVICES = [
  '5in1WS',
  '2in1T'
];
const SUPPORTED_CODES = [
  'Temperature',
  'Humidity'
];
const DEFAULT_REFRESH_INTERVAL_SECONDS = 300;
const DEFAULT_BATTERY_LOW_THRESHOLD = 20;

type SensorReading = {
  id: number | string;
  device_name: string;
  model: { id: string | number; description: string };
  battery_level?: number;
  sensor_name: string;
  sensor_code?: string;
  last_reading_value: number | string;
  chart_unit?: string;
};

type MyAcuriteConfig = PlatformConfig & {
  email?: string;
  password?: string;
  accountId?: string;
  refreshIntervalSeconds?: number;
  supportedDeviceCodes?: string[];
  supportedSensorCodes?: string[];
  batteryLowThreshold?: number;
  nameOverrides?: Record<string, string>;
};

type Device = {
  model_code: string;
  name: string;
  model: { id: string | number; description: string };
  battery_level?: number;
  sensors?: Sensor[];
};

type Sensor = {
  id: number | string;
  sensor_name: string;
  sensor_code: string;
  last_reading_value: number | string;
  chart_unit?: string;
};

function resolveAccountId(userInfo: any): number | null {
  const accountUsers = userInfo && userInfo.user && userInfo.user.account_users;
  const accountId = accountUsers && accountUsers[0] && accountUsers[0].account_id;
  return accountId || null;
}

function mapDevicesToReadings(
  devices: Device[] | undefined,
  supportedDeviceCodes: string[],
  supportedSensorCodes: string[]
): SensorReading[] {
  const filteredDevices = (devices || [])
    .filter(d => supportedDeviceCodes.includes(d.model_code))
    .map(d => {
      d.sensors = (d.sensors || []).filter(s => supportedSensorCodes.includes(s.sensor_code));
      return d;
    });
  return filteredDevices.reduce((a, b) => {
    const values = (b.sensors || []).map(s => {
      return {
        id: s.id,
        device_name: b.name,
        model: b.model,
        battery_level: b.battery_level,
        sensor_name: s.sensor_name,
        sensor_code: s.sensor_code,
        last_reading_value: s.last_reading_value,
        chart_unit: s.chart_unit
      };
    });
    a.push(values);
    return a;
  }, [] as SensorReading[][]).reduce((a, v) => a.concat(v), []);
}

function buildAccessoryName(reading: SensorReading, nameOverrides: Record<string, string> | undefined): string {
  const byId = nameOverrides && nameOverrides[`${reading.id}`];
  if (byId) {
    return byId;
  }
  const byComposite = nameOverrides && nameOverrides[`${reading.device_name}:${reading.sensor_name}`];
  if (byComposite) {
    return byComposite;
  }
  return `${reading.device_name} ${reading.sensor_name}`;
}

class MyAcuRitePlatformPlugin implements DynamicPlatformPlugin {
  private readonly log: Logger;
  private readonly api: API;
  private readonly config: MyAcuriteConfig;
  private readonly accessories: PlatformAccessory[] = [];
  private readonly cachedAccessories: PlatformAccessory[] = [];
  private readonly lastReadings = new Map<string, number>();
  private readonly supportedDeviceCodes: string[];
  private readonly supportedSensorCodes: string[];
  private readonly batteryLowThreshold: number;
  private readonly nameOverrides: Record<string, string>;
  private readonly refreshIntervalMs: number;
  private pollTimeout: NodeJS.Timeout | null = null;
  private loadedAccessories: string[] = [];
  private userInfo: any = null;
  private failureCount = 0;

  constructor(log: Logger, config: MyAcuriteConfig, api: API) {
    this.log = log;
    this.config = config || { name: 'MyAcurite', platform: 'MyAcurite' };
    this.api = api;
    this.refreshIntervalMs = Number(this.config.refreshIntervalSeconds || DEFAULT_REFRESH_INTERVAL_SECONDS) * 1000;
    this.supportedDeviceCodes = Array.isArray(this.config.supportedDeviceCodes) && this.config.supportedDeviceCodes.length > 0
      ? this.config.supportedDeviceCodes
      : SUPPORTED_DEVICES;
    this.supportedSensorCodes = Array.isArray(this.config.supportedSensorCodes) && this.config.supportedSensorCodes.length > 0
      ? this.config.supportedSensorCodes
      : SUPPORTED_CODES;
    this.batteryLowThreshold = Number(this.config.batteryLowThreshold || DEFAULT_BATTERY_LOW_THRESHOLD);
    this.nameOverrides = this.config.nameOverrides || {};

    api.on('didFinishLaunching', () => {
      if (!this.config.email || !this.config.password) {
        this.logError('Missing required config: email and password are required.');
        return;
      }
      for (const a of this.accessories) {
        this.cachedAccessories.push(a);
      }
      this.startPolling();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.push(accessory);
  }

  private startPolling(): void {
    this.pollOnce()
      .then(() => {
        this.failureCount = 0;
        this.scheduleNextPoll(this.refreshIntervalMs);
      })
      .catch((e) => {
        this.failureCount += 1;
        const backoffMs = Math.min(
          this.refreshIntervalMs * Math.pow(2, this.failureCount),
          this.refreshIntervalMs * 10
        );
        this.logError(
          `Polling failed, retrying in ${Math.round(backoffMs / 1000)}s.`,
          e
        );
        this.scheduleNextPoll(backoffMs);
      });
  }

  private scheduleNextPoll(delayMs: number): void {
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
    }
    this.pollTimeout = setTimeout(() => {
      this.startPolling();
    }, delayMs);
  }

  private async pollOnce(): Promise<void> {
    this.loadedAccessories = [];
    const hubs = await this.fetchHubs();
    for (const hub of hubs) {
      const readings = await this.fetchHubData(hub.id);
      readings.forEach((reading) => this.processReading(reading));
    }
    this.pruneAccessories();
  }

  private processReading(reading: SensorReading): void {
    let lastReadingValue = reading.last_reading_value;
    const uuid = this.api.hap.uuid.generate(`${reading.id}${reading.sensor_name}`);
    let accessory = this.accessories.find(existing => existing.UUID === uuid);
    if (!accessory) {
      const accessoryName = this.getAccessoryName(reading);
      accessory = new this.api.platformAccessory(accessoryName, uuid);
      this.api.registerPlatformAccessories("homebridge-myacurite", 'MyAcurite', [accessory]);
    }
    accessory.displayName = this.getAccessoryName(reading);

    if (reading.sensor_name === 'Temperature') {
      if (reading.chart_unit === "F") {
        lastReadingValue = (Number(reading.last_reading_value) - 32.0) * 5 / 9;
      }
      const temperatureSensorService = accessory.getService(this.api.hap.Service.TemperatureSensor) ||
        accessory.addService(this.api.hap.Service.TemperatureSensor);
      const value = Number(lastReadingValue);
      if (!Number.isNaN(value)) {
        if (this.shouldUpdate(uuid, value)) {
          temperatureSensorService
            .getCharacteristic(this.api.hap.Characteristic.CurrentTemperature)
            .updateValue(value);
        }
      } else {
        this.logError(`Skipping invalid temperature value for sensor ${reading.id}.`);
      }
      temperatureSensorService
        .getCharacteristic(this.api.hap.Characteristic.StatusActive)
        .updateValue(true);
    } else if (reading.sensor_name === 'Humidity') {
      const humiditySensorService = accessory.getService(this.api.hap.Service.HumiditySensor) ||
        accessory.addService(this.api.hap.Service.HumiditySensor);
      const value = Number(parseFloat(String(reading.last_reading_value)));
      if (!Number.isNaN(value)) {
        if (this.shouldUpdate(uuid, value)) {
          humiditySensorService
            .getCharacteristic(this.api.hap.Characteristic.CurrentRelativeHumidity)
            .updateValue(value);
        }
      } else {
        this.logError(`Skipping invalid humidity value for sensor ${reading.id}.`);
      }
      humiditySensorService
        .getCharacteristic(this.api.hap.Characteristic.StatusActive)
        .updateValue(true);
    } else {
      this.logInfo(`Unsupported sensor type "${reading.sensor_name}" (${reading.sensor_code}).`);
    }

    accessory.getService(this.api.hap.Service.AccessoryInformation)
      .setCharacteristic(this.api.hap.Characteristic.Manufacturer, "Acurite")
      .setCharacteristic(this.api.hap.Characteristic.Model, reading.model.description)
      .setCharacteristic(this.api.hap.Characteristic.SerialNumber, String(reading.model.id))
      .setCharacteristic(this.api.hap.Characteristic.Name, accessory.displayName);

    if (reading.battery_level !== undefined && reading.battery_level !== null) {
      const batteryService = accessory.getService(this.api.hap.Service.BatteryService) ||
        accessory.addService(this.api.hap.Service.BatteryService);
      const batteryLevel = Number(reading.battery_level);
      if (!Number.isNaN(batteryLevel)) {
        batteryService
          .getCharacteristic(this.api.hap.Characteristic.BatteryLevel)
          .updateValue(batteryLevel);
        batteryService
          .getCharacteristic(this.api.hap.Characteristic.StatusLowBattery)
          .updateValue(batteryLevel <= this.batteryLowThreshold ? 1 : 0);
      }
    }

    this.loadedAccessories.push(accessory.UUID);
  }

  private getAccessoryName(reading: SensorReading): string {
    return buildAccessoryName(reading, this.nameOverrides);
  }

  private shouldUpdate(uuid: string, value: number): boolean {
    if (!this.lastReadings.has(uuid)) {
      this.lastReadings.set(uuid, value);
      return true;
    }
    const lastValue = this.lastReadings.get(uuid);
    if (lastValue !== value) {
      this.lastReadings.set(uuid, value);
      return true;
    }
    return false;
  }

  private pruneAccessories(): void {
    this.cachedAccessories.forEach(a => {
      if (!this.loadedAccessories.includes(a.UUID)) {
        this.api.unregisterPlatformAccessories("homebridge-myacurite", 'MyAcurite', [a]);
      }
    });
  }

  private getAccountId(): string {
    if (this.config.accountId) {
      return `${this.config.accountId}`;
    }
    const accountId = resolveAccountId(this.userInfo);
    if (accountId) {
      this.config.accountId = String(accountId);
      return `${accountId}`;
    }
    this.logError('Account ID not found. Set accountId in config.');
    throw new Error('Account ID not found');
  }

  private logError(message: string, error?: any): void {
    if (this.log && this.log.error) {
      if (error) {
        this.log.error(`${message} ${this.formatError(error)}`);
      } else {
        this.log.error(message);
      }
      return;
    }
    console.error(message, error ? this.formatError(error) : '');
  }

  private logInfo(message: string): void {
    if (this.log && this.log.info) {
      this.log.info(message);
      return;
    }
    console.log(message);
  }

  private formatError(error: any): string {
    if (!error) {
      return '';
    }
    if (error.response) {
      const status = error.response.status;
      const statusText = error.response.statusText || '';
      const data = error.response.data || {};
      const detail = data.message || data.error || '';
      return `(${status}${statusText ? ` ${statusText}` : ''}) ${detail}`.trim();
    }
    return `${error.message || error}`.trim();
  }

  private async login(email: string, password: string): Promise<any> {
    try {
      const response = await axios.post('https://marapi.myacurite.com/users/login', {
        "remember": true,
        "email": email,
        "password": password
      });
      this.userInfo = response.data;
      if (!this.config.accountId) {
        try {
          this.getAccountId();
        } catch (e) {
          this.logError('Unable to resolve account ID from login response.', e);
        }
      }
      return response;
    } catch (e) {
      this.logError('Login failed.', e);
      throw e;
    }
  }

  private async fetchHubs(): Promise<any[]> {
    let hubs: any[] = [];
    try {
      if (!this.userInfo) {
        await this.login(this.config.email || '', this.config.password || '');
      }
      const accountId = this.getAccountId();
      const response = await axios.get(`https://marapi.myacurite.com/accounts/${accountId}/dashboard/hubs`,
        {
          headers: {
            'X-One-Vue-Token': this.userInfo.token_id
          }
        });
      hubs = response.data.account_hubs;
    } catch (e) {
      this.logError('Failed to fetch hubs.', e);
      throw e;
    }
    return hubs;
  }

  private async fetchHubData(hub: string | number): Promise<SensorReading[]> {
    try {
      if (!this.userInfo) {
        const loginResponse = await this.login(this.config.email || '', this.config.password || '');
        this.userInfo = loginResponse.data;
      }
      const accountId = this.getAccountId();
      const response = await axios.get(`https://marapi.myacurite.com/accounts/${accountId}/dashboard/hubs/${hub}`,
        {
          headers: {
            'X-One-Vue-Token': this.userInfo.token_id
          }
        });
      return mapDevicesToReadings(response.data.devices, this.supportedDeviceCodes, this.supportedSensorCodes);
    } catch (e) {
      this.logError(`Failed to fetch hub data for hub ${hub}.`, e);
      throw e;
    }
  }
}

const registerPlatform = (api: API): void => {
  api.registerPlatform("homebridge-myacurite", "MyAcurite", MyAcuRitePlatformPlugin);
};

module.exports = registerPlatform;
module.exports._test = { resolveAccountId, mapDevicesToReadings, buildAccessoryName };
