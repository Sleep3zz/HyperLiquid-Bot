const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'paper-trading');

function writeHybridState(coin, hybridState) {
    const filePath = path.join(DATA_DIR, `${coin}-paper-trades.json`);

    let data = {};
    if (fs.existsSync(filePath)) {
        try {
            data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) {
            data = {};
        }
    }

    data.hybrid = {
        regime: hybridState.regime || 'UNKNOWN',
        activeStrategy: hybridState.activeStrategy || null,
        dailySwitches: hybridState.dailySwitches || 0,
        paused: !!hybridState.paused,
        pauseReason: hybridState.pauseReason || null,
        lastUpdated: Date.now()
    };

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

module.exports = { writeHybridState };
