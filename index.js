var Service, Characteristic;

const axios = require('axios');

const CELSIUS_UNITS = 'C',
      FAHRENHEIT_UNITS = 'F';
const DEF_MIN_TEMPERATURE = -100,
      DEF_MAX_TEMPERATURE = 100,
      DEF_UNITS = CELSIUS_UNITS,
      DEF_TIMEOUT = 5000,
      DEF_INTERVAL = 120000; //120s
const SUPPORTED_DEVICES = [
  '5-in-1 Weather Station'
]
const SUPPORTED_CODES = [
  'Temperature'
]

module.exports = function (homebridge) {
   Service = homebridge.hap.Service;
   Characteristic = homebridge.hap.Characteristic;
   homebridge.registerAccessory("homebridge-MyAcurite", "MyAcurite", MyAcurite);
}


function MyAcurite(log, config) {
   this.log = log;
   this.config = config;

   this.name = config["name"] || "MyAcurite";
   this.minTemperature = config["min_temp"] || DEF_MIN_TEMPERATURE;
   this.maxTemperature = config["max_temp"] || DEF_MAX_TEMPERATURE;
   this.units = config["units"] || DEF_UNITS;
   this.update_interval = Number( config["update_interval"] || DEF_INTERVAL );

   //Check if units field is valid
   this.units = this.units.toUpperCase()
   if (this.units !== CELSIUS_UNITS && this.units !== FAHRENHEIT_UNITS) {
      this.log('Bad temperature units : "' + this.units + '" (assuming Celsius).');
      this.units = CELSIUS_UNITS;
   }

   // Internal variables
   this.last_value = null;
   this.waiting_response = false;
}

MyAcurite.prototype = {

   updateState: function () {
      //Ensure previous call finished
      if (this.waiting_response) {
         this.log('Avoid updateState as previous response does not arrived yet');
         return;
      }
      this.waiting_response = false;

      this.last_value = this.fetchHubData(978773,null);
   },

   getState: function (callback) {
      this.log('Call to getState: waiting_response is "' + this.waiting_response + '"' );
      this.updateState(); //This sets the promise in last_value
      this.last_value.then((value) => {
        this.log(value)
         callback(null, value);
         return value;
      }, (error) => {
         callback(error, null);
         return error;
      });
   },

   getServices: function () {
      this.informationService = new Service.AccessoryInformation();
      this.informationService
      .setCharacteristic(Characteristic.Manufacturer, "Acurite")
      .setCharacteristic(Characteristic.Model, "00000")
      .setCharacteristic(Characteristic.SerialNumber, "00000");

      this.temperatureService = new Service.TemperatureSensor(this.name);
      this.temperatureService
         .getCharacteristic(Characteristic.CurrentTemperature)
         .on('get', this.getState.bind(this))
         .setProps({
             minValue: this.minTemperature,
             maxValue: this.maxTemperature
         });

      if (this.update_interval > 0) {
         this.timer = setInterval(this.updateState.bind(this), this.update_interval);
      }

      return [this.informationService, this.temperatureService];
   },

   fetchHubData : async function(hub, userInfo) {
     if(!userInfo) {
       var l = await this.login(this.config["email"],this.config["password"])
       userInfo = l.data
     }
     try {
       let response = await axios.get(`https://marapi.myacurite.com/accounts/176464/dashboard/hubs/${hub}`,
         {
         headers: {
           'X-One-Vue-Token': userInfo.token_id,
         }
       })
       devices = response.data.devices
         .filter(d => SUPPORTED_DEVICES.includes(d.name))
         .map(d => {
           d.sensors = d.sensors.filter(s => SUPPORTED_CODES.includes(s.sensor_code))
           return d
         })
       var lastTemperatureReadings = devices.reduce((a,b) => {
         let values = b.sensors.map(s => {
           return {
             id : s.id,
             last_reading_value : s.last_reading_value,
             chart_unit : s.chart_unit
           }
         })
         a.push(values)
         return a
       },[]).reduce((a, v) => a.concat(v), [])
       lastTemperatureReading = lastTemperatureReadings[0]
       value = lastTemperatureReading["last_reading_value"]
       if (lastTemperatureReading["chart_unit"] === 'F') {
                      value = (value - 32)/1.8;
                      this.log('Converted Fahrenheit temperature to celsius: ' + value);
                   }
       return value
     } catch (e) {
       console.log(e)
     } finally {

     }
   },

   login : async function(email, password) {
     let response = await axios.post('https://marapi.myacurite.com/users/login', {
         "remember": true,
         "email": email,
         "password": password
       })
     return response
   },
};
