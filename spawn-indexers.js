let fork = require('child_process').fork;
let {openSync} = require('fs');

let dgsiLog = openSync('./dgsi.log', 'a');
fork('./dgsi-indexer.js', {
    stdio: ['ignore', dgsiLog, dgsiLog, 'ipc']
})

let tconLog = openSync('./tcon.log', 'a');
fork('./tcon-indexer.js', {
    stdio: ['ignore', tconLog, tconLog, 'ipc']
});

let csmLog = openSync('./csm.log', 'a');
fork('./csm-indexer.js', {
    stdio: ['ignore', csmLog, csmLog, 'ipc']
});