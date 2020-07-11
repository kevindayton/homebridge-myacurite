const axios = require('axios');
const SUPPORTED_DEVICES = [
  '5in1WS',
  '2in1T'
]
const SUPPORTED_CODES = [
  'Temperature',
  'Humidity'
]

module.exports = (api) => {
  api.registerPlatform("homebridge-myacurite", "MyAcurite", MyAcuRitePlatformPlugin);
}

class MyAcuRitePlatformPlugin {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.accessories = [];
    this.userInfo = null;
    this.api = api;
    this.cachedAccessories = [];
    this.loadedAccessories = [];

    api.on('didFinishLaunching', () => { 
      for(const a of this.accessories) {
        this.cachedAccessories.push(a)
      }
      this.fetchHubs().then((hubs) =>
        hubs.forEach(h => {
          this.fetchHubData(h.id).then((hd) => {
            hd.forEach((d) => {
            let lastReadingValue = d.last_reading_value;
            let uuid = api.hap.uuid.generate(''+d.id+d.sensor_name);
            var accessory = this.accessories.find(accessory => accessory.UUID === uuid);
            if (!accessory) {
              let accessoryName = d.device_name+' '+d.sensor_name;
              accessory = new api.platformAccessory(accessoryName, uuid);
              api.registerPlatformAccessories("homebridge-myacurite", 'MyAcurite', [accessory]);
            }
            if (d.sensor_name == 'Temperature') {
              if(d.chart_unit == "F") {
                lastReadingValue = (d.last_reading_value - 32.0) * 5/9
              }
              var temperatureSensorService = accessory.getService(this.api.hap.Service.TemperatureSensor)
              if (!temperatureSensorService) {
                temperatureSensorService = accessory.addService(this.api.hap.Service.TemperatureSensor);
              }
              temperatureSensorService
              .getCharacteristic(this.api.hap.Characteristic.CurrentTemperature)
              .updateValue(''+lastReadingValue)
            } else if(d.sensor_name == 'Humidity') {
              var humiditySensorService = accessory.getService(this.api.hap.Service.HumiditySensor)
              if (!humiditySensorService) {
                humiditySensorService = accessory.addService(this.api.hap.Service.HumiditySensor);
              }
              humiditySensorService
              .getCharacteristic(this.api.hap.Characteristic.CurrentRelativeHumidity)
              .updateValue(parseFloat(d.last_reading_value))
            }
            accessory.getService(this.api.hap.Service.AccessoryInformation)
              .setCharacteristic(this.api.hap.Characteristic.Manufacturer, "Acurite")
              .setCharacteristic(this.api.hap.Characteristic.Model, d.model.description)
              .setCharacteristic(this.api.hap.Characteristic.SerialNumber, d.model.id);
            this.loadedAccessories.push(accessory.UUID);
          })
          this.cachedAccessories.forEach(a => {
            if(!this.loadedAccessories.includes(a.UUID)) {
              api.unregisterPlatformAccessories("homebridge-myacurite", 'MyAcurite', [a]);
            }
          })
        })
      })
      )
    });
  }

  configureAccessory(accessory) {
    this.accessories.push(accessory);
  }

  async login(email, password) {
    let response = await axios.post('https://marapi.myacurite.com/users/login', {
        "remember": true,
        "email": email,
        "password": password
      })
    this.userInfo = response.data
    return response
  }

  async fetchHubs() {
    var hubs = [];
    if(!this.userInfo) {
      await this.login(this.config["email"],this.config["password"]);
    }
    try {
      let response = await axios.get(`https://marapi.myacurite.com/accounts/176464/dashboard/hubs`,
        {
        headers: {
          'X-One-Vue-Token': this.userInfo.token_id,
        }
      })
      hubs = response.data.account_hubs;
    } catch (e) {
      this.log(e)
    } finally {
    }
    return hubs
  }

  async fetchHubData(hub, userInfo) {
    if(!userInfo) {
      var l = await this.login(this.config["email"],this.config["password"])
      this.userInfo = l.data
    }
    try {
      let response = await axios.get(`https://marapi.myacurite.com/accounts/176464/dashboard/hubs/${hub}`,
        {
        headers: {
          'X-One-Vue-Token': this.userInfo.token_id,
        }
      })
      let devices = response.data.devices
        .filter(d => SUPPORTED_DEVICES.includes(d.model_code))
        .map(d => {
          d.sensors = d.sensors.filter(s => SUPPORTED_CODES.includes(s.sensor_code))
          return d
        })
      var lastTemperatureReadings = devices.reduce((a,b) => {
        let values = b.sensors.map(s => {
          return {
            id : s.id,
            device_name : b.name,
            model: b.model, 
            battery_level: b.battery_level,
            sensor_name: s.sensor_name,
            last_reading_value : s.last_reading_value,
            chart_unit : s.chart_unit
          }
        })
        a.push(values)
        return a
      },[]).reduce((a, v) => a.concat(v), [])
      return lastTemperatureReadings
    } catch (e) {
      console.log(e)
    } finally {

     }
   }
}