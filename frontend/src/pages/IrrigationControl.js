import React, { useState } from 'react';

const IrrigationControl = () => {
  const [activeTab, setActiveTab] = useState('manual');
  const [zones, setZones] = useState([
    { id: 'A', name: 'Zone A', manualOn: false, autoThreshold: 30, aiEnabled: true },
    { id: 'B', name: 'Zone B', manualOn: false, autoThreshold: 25, aiEnabled: true },
    { id: 'C', name: 'Zone C', manualOn: false, autoThreshold: 35, aiEnabled: false }
  ]);
  const [timing, setTiming] = useState({ start: '06:00', end: '07:00' });

  const toggleManual = (zoneId) => {
    setZones(zones.map(zone => 
      zone.id === zoneId ? { ...zone, manualOn: !zone.manualOn } : zone
    ));
  };

  const updateThreshold = (zoneId, value) => {
    setZones(zones.map(zone => 
      zone.id === zoneId ? { ...zone, autoThreshold: value } : zone
    ));
  };

  const toggleAI = (zoneId) => {
    setZones(zones.map(zone => 
      zone.id === zoneId ? { ...zone, aiEnabled: !zone.aiEnabled } : zone
    ));
  };

  return (
    <div className="py-8">
      <h1 className="text-3xl font-bold text-green-700 mb-6">Irrigation Control</h1>
      
      <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
        <div className="flex border-b border-gray-200 mb-6">
          <button 
            className={`py-2 px-4 font-semibold ${activeTab === 'manual' ? 'text-green-600 border-b-2 border-green-600' : 'text-gray-500'}`}
            onClick={() => setActiveTab('manual')}
          >
            🔘 Manual Mode
          </button>
          <button 
            className={`py-2 px-4 font-semibold ${activeTab === 'auto' ? 'text-green-6000 border-b-2 border-green-600' : 'text-gray-500'}`}
            onClick={() => setActiveTab('auto')}
          >
            🔘 Automatic Mode
          </button>
          <button 
            className={`py-2 px-4 font-semibold ${activeTab === 'ai' ? 'text-green-600 border-b-2 border-green-600' : 'text-gray-500'}`}
            onClick={() => setActiveTab('ai')}
          >
            🤖 AI Mode
          </button>
        </div>
        
        {activeTab === 'manual' && (
          <div>
            <h2 className="text-2xl font-bold mb-4">Manual Control</h2>
            <p className="mb-6">Toggle pumps/valves on or off for each zone</p>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {zones.map(zone => (
                <div key={zone.id} className="border border-gray-200 rounded-lg p-4">
                  <h3 className="text-xl font-bold mb-3">{zone.name}</h3>
                  <div className="flex items-center justify-between">
                    <span>Water Pump</span>
                    <button 
                      onClick={() => toggleManual(zone.id)}
                      className={`w-12 h-6 rounded-full p-1 transition-colors duration-300 ease-in-out ${zone.manualOn ? 'bg-green-500' : 'bg-gray-300'}`}
                    >
                      <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-300 ease-in-out ${zone.manualOn ? 'translate-x-6' : ''}`}></div>
                    </button>
                  </div>
                  <div className="mt-4 text-sm text-gray-500">
                    Status: {zone.manualOn ? 'ON' : 'OFF'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {activeTab === 'auto' && (
          <div>
            <h2 className="text-2xl font-bold mb-4">Automatic Mode</h2>
            <p className="mb-6">Set soil moisture thresholds for automatic irrigation</p>
            
            <div className="mb-6">
              <label className="block text-lg font-medium mb-2">Timing Intervals</label>
              <div className="flex gap-4">
                <div>
                  <label className="block text-sm text-gray-500 mb-1">Start Time</label>
                  <input 
                    type="time" 
                    value={timing.start}
                    onChange={(e) => setTiming({...timing, start: e.target.value})}
                    className="border border-gray-300 rounded p-2"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-500 mb-1">End Time</label>
                  <input 
                    type="time" 
                    value={timing.end}
                    onChange={(e) => setTiming({...timing, end: e.target.value})}
                    className="border border-gray-300 rounded p-2"
                  />
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {zones.map(zone => (
                <div key={zone.id} className="border border-gray-200 rounded-lg p-4">
                  <h3 className="text-xl font-bold mb-3">{zone.name}</h3>
                  <div className="mb-3">
                    <label className="block text-sm text-gray-500 mb-1">Moisture Threshold (%)</label>
                    <input 
                      type="range" 
                      min="0" 
                      max="100" 
                      value={zone.autoThreshold}
                      onChange={(e) => updateThreshold(zone.id, parseInt(e.target.value))}
                      className="w-full"
                    />
                    <div className="flex justify-between text-sm text-gray-500">
                      <span>0%</span>
                      <span className="font-bold">{zone.autoThreshold}%</span>
                      <span>100%</span>
                    </div>
                  </div>
                  <div className="mt-4 text-sm">
                    Current Soil Moisture: <span className="font-bold">42%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {activeTab === 'ai' && (
          <div>
            <h2 className="text-2xl font-bold mb-4">AI Prediction Mode</h2>
            <p className="mb-6">LSTM/ML prediction-based irrigation control</p>
            
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <h3 className="font-bold text-blue-800">AI Insights</h3>
              <p className="text-blue-700">Based on weather forecasts and soil data, irrigation is recommended for tomorrow morning.</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {zones.map(zone => (
                <div key={zone.id} className="border border-gray-200 rounded-lg p-4">
                  <h3 className="text-xl font-bold mb-3">{zone.name}</h3>
                  <div className="flex items-center justify-between mb-3">
                    <span>AI Control</span>
                    <button 
                      onClick={() => toggleAI(zone.id)}
                      className={`w-12 h-6 rounded-full p-1 transition-colors duration-300 ease-in-out ${zone.aiEnabled ? 'bg-green-500' : 'bg-gray-300'}`}
                    >
                      <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-300 ease-in-out ${zone.aiEnabled ? 'translate-x-6' : ''}`}></div>
                    </button>
                  </div>
                  <div className="text-sm">
                    <div className="mb-1">Next watering: <span className="font-bold">Tomorrow 6:00 AM</span></div>
                    <div>Confidence: <span className="font-bold">92%</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h2 className="text-2xl font-bold mb-4">Irrigation History</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Zone</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              <tr>
                <td className="px-6 py-4 whitespace-nowrap">2023-06-15</td>
                <td className="px-6 py-4 whitespace-nowrap">Zone A</td>
                <td className="px-6 py-4 whitespace-nowrap">25 min</td>
                <td className="px-6 py-4 whitespace-nowrap">Manual</td>
              </tr>
              <tr>
                <td className="px-6 py-4 whitespace-nowrap">2023-06-15</td>
                <td className="px-6 py-4 whitespace-nowrap">Zone B</td>
                <td className="px-6 py-4 whitespace-nowrap">18 min</td>
                <td className="px-6 py-4 whitespace-nowrap">Automatic</td>
              </tr>
              <tr>
                <td className="px-6 py-4 whitespace-nowrap">2023-06-14</td>
                <td className="px-6 py-4 whitespace-nowrap">Zone A</td>
                <td className="px-6 py-4 whitespace-nowrap">30 min</td>
                <td className="px-6 py-4 whitespace-nowrap">AI Predicted</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default IrrigationControl;