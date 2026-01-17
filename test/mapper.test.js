const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../dist/index.js');

const { resolveAccountId, mapDevicesToReadings, buildAccessoryName } = plugin._test;

test('resolveAccountId uses account_users[0].account_id', () => {
  const userInfo = {
    user: {
      account_users: [
        { account_id: 176464 }
      ]
    }
  };
  assert.equal(resolveAccountId(userInfo), 176464);
});

test('mapDevicesToReadings filters by device and sensor codes', () => {
  const devices = [
    {
      model_code: '5in1WS',
      name: 'AcuRite 5-in-1',
      model: { id: 'm1', description: 'Model One' },
      battery_level: 88,
      sensors: [
        { id: 1, sensor_name: 'Temperature', sensor_code: 'Temperature', last_reading_value: 70, chart_unit: 'F' },
        { id: 2, sensor_name: 'Humidity', sensor_code: 'Humidity', last_reading_value: 40, chart_unit: '%' },
        { id: 3, sensor_name: 'Rain', sensor_code: 'Rain', last_reading_value: 1, chart_unit: 'in' }
      ]
    },
    {
      model_code: 'Other',
      name: 'Other Device',
      model: { id: 'm2', description: 'Model Two' },
      battery_level: 50,
      sensors: [
        { id: 4, sensor_name: 'Temperature', sensor_code: 'Temperature', last_reading_value: 60, chart_unit: 'F' }
      ]
    }
  ];

  const readings = mapDevicesToReadings(devices, ['5in1WS'], ['Temperature', 'Humidity']);
  assert.equal(readings.length, 2);
  assert.deepEqual(
    readings.map(r => r.sensor_name).sort(),
    ['Humidity', 'Temperature']
  );
});

test('buildAccessoryName supports id and composite overrides', () => {
  const reading = { id: 123, device_name: 'Device', sensor_name: 'Temperature' };
  assert.equal(buildAccessoryName(reading, { '123': 'By Id' }), 'By Id');
  assert.equal(buildAccessoryName(reading, { 'Device:Temperature': 'By Composite' }), 'By Composite');
  assert.equal(buildAccessoryName(reading, {}), 'Device Temperature');
});
