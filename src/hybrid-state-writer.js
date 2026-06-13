const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'paper-trading');

function writeHybridState(coin, hybridState) {
    const filePath = path.join(DATA_DIR, `${coin}-paper-trades.json`);

    let data = {};
    if (fs.existsSync(filePath)) {
        data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }

    data.hybrid = {
        regime: hybridState.regime,
        activeStrategy: hybridState.activeStrategy,
        dailySwitches: hybridState.dailySwitches,
        paused: hybridState.paused,
        pauseReason: hybridState.pauseReason,
        lastUpdated: Date.now()
    };

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

module.exports = { writeHybridState };
